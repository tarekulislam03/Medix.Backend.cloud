import AIImportJob from "../models/aiImportJobModel.js";
import Purchase from "../models/purchaseModel.js";
import Inventory from "../../product/models/productModel.js";
import StockMovement from "../../stockMovement/models/stockMovementModel.js";
import { optimizeInvoiceImage } from "../../../core/services/imageOptimizer.js";
import { extractWithCascade } from "../../../core/services/llmService.js";
import { uploadToCloudinary } from "./purchaseController.js";
import mongoose from "mongoose";
import crypto from "crypto";

// ═══════════════════════════════════════════════════════════════════════════════
// POST /purchase/ai-import — Start a new AI import job (bulk images)
// ═══════════════════════════════════════════════════════════════════════════════
export const startImport = async (req, res) => {
    const t0 = Date.now();

    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({
                success: false,
                message: "No images uploaded. Please select at least one bill image.",
            });
        }

        console.log(`[AI Import] Received ${req.files.length} image(s) for processing`);

        const storeId = req.storeId;
        const supplierName = req.body.supplier_name || "";
        const billDate = req.body.bill_date || "";
        const totalAmount = Number(req.body.total_amount) || 0;

        // 1. Create job record immediately
        const job = await AIImportJob.create({
            storeId,
            status: "uploading",
            supplier_name: supplierName,
            bill_date: billDate,
            total_amount: totalAmount,
        });

        const jobId = job._id.toString();

        // 2. Respond immediately — user can continue working
        res.status(202).json({
            success: true,
            message: "Upload received. AI processing started in background.",
            job_id: jobId,
        });

        // 3. Background processing pipeline
        (async () => {
            try {
                const files = req.files;

                // ── Step 1: Normalize, optimize & upload to Cloudinary ────────
                console.log(`[AI Import][${jobId}] Step 1: Optimizing ${files.length} image(s)...`);

                const imageResults = [];
                const optimizedImages = []; // { base64, mimeType } for LLM

                for (let i = 0; i < files.length; i++) {
                    const file = files[i];
                    try {
                        // Optimize (handles HEIC/HEIF conversion via imageOptimizer)
                        const optimized = await optimizeInvoiceImage(
                            file.buffer,
                            file.mimetype
                        );

                        optimizedImages.push({
                            base64: optimized.base64,
                            mimeType: optimized.mimeType,
                        });

                        // Upload to Cloudinary (parallel-safe, fire and collect)
                        let cloudResult = null;
                        try {
                            cloudResult = await uploadToCloudinary(
                                optimized.buffer,
                                file.originalname,
                                optimized.mimeType
                            );
                        } catch (cloudErr) {
                            console.warn(
                                `[AI Import][${jobId}] Cloudinary upload failed for page ${i + 1}:`,
                                cloudErr.message
                            );
                        }

                        imageResults.push({
                            original_name: file.originalname,
                            cloudinary_url: cloudResult?.secure_url || "",
                            cloudinary_public_id: cloudResult?.public_id || "",
                            page_number: i + 1,
                        });
                    } catch (imgErr) {
                        console.error(
                            `[AI Import][${jobId}] Image ${i + 1} optimization failed:`,
                            imgErr.message
                        );
                        // Still record the image entry with empty URLs
                        imageResults.push({
                            original_name: file.originalname,
                            cloudinary_url: "",
                            cloudinary_public_id: "",
                            page_number: i + 1,
                        });
                    }
                }

                // Update job with image URLs and move to processing
                await AIImportJob.findByIdAndUpdate(jobId, {
                    images: imageResults,
                    status: "processing",
                });

                if (optimizedImages.length === 0) {
                    throw new Error("All images failed optimization. Cannot proceed with AI extraction.");
                }

                // ── Step 2: LLM Cascade (multi-image prompt) ─────────────────
                console.log(
                    `[AI Import][${jobId}] Step 2: Running LLM cascade with ${optimizedImages.length} image(s)...`
                );

                const cascadeResult = await extractWithCascade(optimizedImages);

                const processingTime = Date.now() - t0;

                // ── Step 3: Extract invoice metadata ─────────────────────────
                const invoiceMeta = cascadeResult.invoice || {};

                // ── Step 4: Update job with results ──────────────────────────
                await AIImportJob.findByIdAndUpdate(jobId, {
                    status: cascadeResult.status,
                    extracted_items: cascadeResult.items,
                    overall_confidence: cascadeResult.overallConfidence,
                    llm_used: cascadeResult.modelUsed,
                    llm_attempts: cascadeResult.attempts,
                    processing_time_ms: processingTime,
                    validation_warnings: cascadeResult.validationWarnings,

                    // Fill in LLM-extracted metadata (user-provided values take priority)
                    bill_no: invoiceMeta.invoice_number || "",
                    supplier_gstin: invoiceMeta.supplier_gstin || "",
                    supplier_name:
                        supplierName || invoiceMeta.supplier_name || "",
                    bill_date:
                        billDate || invoiceMeta.invoice_date || "",
                });

                console.log(
                    `[AI Import][${jobId}] ✓ Complete — status: ${cascadeResult.status}, ` +
                    `confidence: ${cascadeResult.overallConfidence}%, ` +
                    `items: ${cascadeResult.items.length}, ` +
                    `model: ${cascadeResult.modelUsed}, ` +
                    `time: ${processingTime}ms`
                );
            } catch (bgError) {
                console.error(`[AI Import][${jobId}] FATAL:`, bgError);
                await AIImportJob.findByIdAndUpdate(jobId, {
                    status: "failed",
                    error_message: bgError.message,
                    processing_time_ms: Date.now() - t0,
                }).catch(() => {}); // swallow DB errors during failure update
            }
        })();
    } catch (error) {
        console.error("[AI Import] Failed to start:", error);
        if (!res.headersSent) {
            return res.status(500).json({
                success: false,
                message: "AI import failed to start",
                error: error.message,
            });
        }
    }
};

// ═══════════════════════════════════════════════════════════════════════════════
// GET /purchase/ai-import/jobs — List AI import jobs for this store
// ═══════════════════════════════════════════════════════════════════════════════
export const getJobs = async (req, res) => {
    try {
        const { status } = req.query;

        const filter = { storeId: req.storeId };
        if (status) {
            filter.status = status;
        }

        const jobs = await AIImportJob.find(filter)
            .sort({ createdAt: -1 })
            .lean();

        // Compute status counts for UI badges
        const allJobs = await AIImportJob.aggregate([
            { $match: { storeId: new mongoose.Types.ObjectId(req.storeId) } },
            { $group: { _id: "$status", count: { $sum: 1 } } },
        ]);

        const statusCounts = {};
        allJobs.forEach((s) => {
            statusCounts[s._id] = s.count;
        });

        return res.status(200).json({
            success: true,
            data: jobs,
            counts: statusCounts,
        });
    } catch (error) {
        console.error("Get AI Import Jobs Error:", error.message);
        return res.status(500).json({ success: false, message: error.message });
    }
};

// ═══════════════════════════════════════════════════════════════════════════════
// POST /purchase/ai-import/confirm — Confirm import, create Purchase + Inventory
// ═══════════════════════════════════════════════════════════════════════════════
export const confirmImport = async (req, res) => {
    try {
        const { job_id, items, supplier_name, bill_no, total_amount } = req.body;

        if (!job_id) {
            return res.status(400).json({ success: false, message: "Missing job_id" });
        }
        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ success: false, message: "No items to import" });
        }

        const job = await AIImportJob.findOne({
            _id: job_id,
            storeId: req.storeId,
        });

        if (!job) {
            return res.status(404).json({ success: false, message: "Import job not found" });
        }
        if (job.status === "confirmed") {
            return res.status(409).json({ success: false, message: "This import was already confirmed" });
        }

        const storeId = req.storeId;
        const cleanNumber = (val) => Number(String(val || 0).replace(/[^\d.]/g, "")) || 0;

        // ── Transaction: Create inventory records + stock movements ──────────
        const session = await mongoose.startSession();
        session.startTransaction();

        try {
            const importedItems = [];
            const movementOps = [];

            const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

            for (const item of items) {
                const nameRaw = item.medicine_name || "";
                const normalizedName = nameRaw.trim().toUpperCase();
                if (!normalizedName) continue;

                const batchNumber = (item.batch_number || "").trim();
                const addedQuantity = cleanNumber(item.quantity);
                const mrpValue = cleanNumber(item.mrp);
                const purchasePrice = cleanNumber(item.purchase_price);

                // Format expiry_date
                let expiryDate = item.expiry_date || null;
                if (expiryDate && typeof expiryDate === "string") {
                    if (/^\d{4}-\d{2}$/.test(expiryDate)) {
                        const [year, month] = expiryDate.split("-");
                        const lastDay = new Date(parseInt(year), parseInt(month), 0).getDate();
                        expiryDate = `${year}-${month}-${String(lastDay).padStart(2, "0")}`;
                    } else if (/^\d{1,2}\/\d{2,4}$/.test(expiryDate)) {
                        const [month, yy] = expiryDate.split("/");
                        const year = yy.length === 2 ? `20${yy}` : yy;
                        const lastDay = new Date(parseInt(year), parseInt(month), 0).getDate();
                        expiryDate = `${year}-${month.padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
                    }
                }

                // Find or create in Inventory
                let inventoryItem = await Inventory.findOne({
                    storeId,
                    medicine_name: {
                        $regex: new RegExp(`^${escapeRegExp(normalizedName)}$`, "i"),
                    },
                    batch_number: batchNumber,
                }).session(session);

                let previousStock = 0;
                let newStock = 0;

                if (inventoryItem) {
                    previousStock = inventoryItem.quantity;
                    inventoryItem.quantity += addedQuantity;
                    newStock = inventoryItem.quantity;
                    inventoryItem.mrp = mrpValue;
                    if (expiryDate) inventoryItem.expiry_date = expiryDate;
                    if (purchasePrice > 0) inventoryItem.cost_price = purchasePrice;
                    if (item.hsn_code) inventoryItem.hsn_code = item.hsn_code;
                    if (item.gst_percentage !== undefined) inventoryItem.gst = cleanNumber(item.gst_percentage);

                    await inventoryItem.save({ session });
                } else {
                    const shortBarcode = Math.floor(10000000 + Math.random() * 90000000).toString();
                    const barcode = `${normalizedName.replace(/\s/g, "")}-${Date.now()}-${crypto.randomUUID().split("-")[0]}`;

                    const created = await Inventory.create(
                        [
                            {
                                storeId,
                                medicine_name: normalizedName,
                                mrp: mrpValue,
                                quantity: addedQuantity,
                                cost_price: purchasePrice > 0 ? purchasePrice : null,
                                expiry_date: expiryDate || null,
                                batch_number: batchNumber,
                                hsn_code: item.hsn_code || "",
                                gst: (item.gst_percentage !== undefined && item.gst_percentage !== null && Number(item.gst_percentage) > 0) ? cleanNumber(item.gst_percentage) : 5,
                                barcode,
                                short_barcode: shortBarcode,
                            },
                        ],
                        { session }
                    );
                    inventoryItem = created[0];
                    newStock = addedQuantity;
                }

                movementOps.push({
                    storeId,
                    productId: inventoryItem._id,
                    medicine_name: inventoryItem.medicine_name,
                    transaction_type: "PURCHASE",
                    reference_id: null, // updated after Purchase is created
                    quantity_change: addedQuantity,
                    previous_stock: previousStock,
                    current_stock: newStock,
                    remarks: "AI Import — confirmed by user",
                });

                importedItems.push({
                    inventoryId: inventoryItem._id,
                    quantity: addedQuantity,
                    mrp: mrpValue,
                });
            }

            // Create Purchase record
            const purchase = await Purchase.create(
                [
                    {
                        storeId,
                        source: "auto_import",
                        status: "received",
                        supplier_name: supplier_name || job.supplier_name || "",
                        supplier_gstin: job.supplier_gstin || "",
                        bill_no: bill_no || job.bill_no || "",
                        bill_date: job.bill_date || "",
                        total_amount: Number(total_amount) || job.total_amount || 0,
                        items_count: items.length,
                        imported_items: importedItems,
                        needs_manual_review: false,
                        confidence_score: job.overall_confidence / 100,
                        // Attach first bill image if available
                        bill_image_url: job.images?.[0]?.cloudinary_url || "",
                        cloudinary_public_id: job.images?.[0]?.cloudinary_public_id || "",
                    },
                ],
                { session }
            );

            const purchaseDoc = purchase[0];

            // Link stock movements to purchase
            if (movementOps.length > 0) {
                const opsWithRef = movementOps.map((op) => ({
                    ...op,
                    reference_id: purchaseDoc._id,
                }));
                await StockMovement.insertMany(opsWithRef, { session });
            }

            await session.commitTransaction();
            session.endSession();

            // Update AI import job
            await AIImportJob.findByIdAndUpdate(job_id, {
                status: "confirmed",
                purchaseId: purchaseDoc._id,
            });

            return res.status(200).json({
                success: true,
                message: `Import confirmed — ${importedItems.length} item(s) added to inventory.`,
                purchase_id: purchaseDoc._id,
                items_imported: importedItems.length,
            });
        } catch (txError) {
            await session.abortTransaction();
            session.endSession();
            throw txError;
        }
    } catch (error) {
        console.error("Confirm AI Import Error:", error);

        if (error.code === 11000) {
            return res.status(409).json({
                success: false,
                message: "Duplicate inventory record detected",
            });
        }

        return res.status(500).json({
            success: false,
            message: error.message || "Failed to confirm import",
        });
    }
};

// ═══════════════════════════════════════════════════════════════════════════════
// PATCH /purchase/ai-import/:id/reject — Reject/discard an import job
// ═══════════════════════════════════════════════════════════════════════════════
export const rejectImport = async (req, res) => {
    try {
        const { id } = req.params;

        const job = await AIImportJob.findOneAndUpdate(
            {
                _id: id,
                storeId: req.storeId,
                status: { $in: ["review_ready", "low_confidence", "failed"] },
            },
            { status: "rejected" },
            { returnDocument: "after" }
        );

        if (!job) {
            return res.status(404).json({
                success: false,
                message: "Import job not found or cannot be rejected",
            });
        }

        return res.status(200).json({
            success: true,
            message: "Import job rejected",
        });
    } catch (error) {
        console.error("Reject AI Import Error:", error.message);
        return res.status(500).json({ success: false, message: error.message });
    }
};
