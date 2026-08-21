import axios from "axios";
import FormData from "form-data";
import mongoose from "mongoose";
import Purchase from "../models/purchaseModel.js";
import Inventory from "../../product/models/productModel.js";
import StockMovement from "../../stockMovement/models/stockMovementModel.js";
import heicConvert from "heic-convert";
import sharp from "sharp";


// ── Shared Cloudinary uploader ─────────────────────────────────────────────
// Exported so productController can reuse it without duplication.
export const uploadToCloudinary = async (fileBuffer, originalName, mimeType) => {
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey    = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;

    if (!cloudName || !apiKey || !apiSecret) {
        throw new Error("Cloudinary credentials are not configured in .env");
    }

    const url  = `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`;
    const form = new FormData();

    form.append("file", fileBuffer, {
        filename:    originalName || "purchase_bill.jpg",
        contentType: mimeType     || "image/jpeg",
    });
    form.append("upload_preset", process.env.CLOUDINARY_UPLOAD_PRESET || "medix_bills");
    form.append("folder", "medix/purchase_bills");

    const response = await axios.post(url, form, {
        headers: {
            ...form.getHeaders(),
            Authorization: `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString("base64")}`,
        },
        maxBodyLength: Infinity,
    });

    return {
        secure_url: response.data.secure_url,
        public_id:  response.data.public_id,
    };
};

// ── POST /api/v1/purchase/upload-bill ─────────────────────────────────────
// Manual upload from the Purchase page.
const uploadBill = async (req, res) => {
    try {
        console.log("=== NEW BACKEND VERSION ===");
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: "No bill image provided",
            });
        }

        let fileBuffer = req.file.buffer;
        let fileName = req.file.originalname;
        let mimeType = req.file.mimetype;

        // Convert HEIC/HEIF (iPhone photos) to JPEG
        const isHeic =
            mimeType === "image/heic" ||
            mimeType === "image/heif" ||
            /\.(heic|heif)$/i.test(fileName);

        if (isHeic) {
            console.log("Converting HEIC to JPEG:", fileName);
            try {
                const outputBuffer = await heicConvert({
                    buffer: fileBuffer,
                    format: "JPEG",
                    quality: 0.9,
                });

                fileBuffer = Buffer.from(outputBuffer);
                fileName = fileName.replace(/\.(heic|heif)$/i, ".jpg");
                mimeType = "image/jpeg";
            } catch (heicErr) {
                console.warn("HEIC convert bypass / fallback:", heicErr.message);
            }
        }

        // Optimize image
        fileBuffer = await sharp(fileBuffer)
            .rotate() // Fix phone orientation
            .resize({
                width: 2000,
                height: 2000,
                fit: "inside",
                withoutEnlargement: true,
            })
            .jpeg({
                quality: 85,
                mozjpeg: true,
            })
            .toBuffer();

        const { secure_url, public_id } = await uploadToCloudinary(
            fileBuffer,
            fileName,
            mimeType
        );

        const statusToUse = req.body.status || "draft";
        const sourceToUse = req.body.source || "manual";

        const purchase = await Purchase.create({
            storeId: req.storeId,
            bill_image_url: secure_url,
            cloudinary_public_id: public_id,
            supplier_name: req.body.supplier_name || "",
            supplier_gstin: req.body.supplier_gstin || "",
            bill_no: req.body.bill_no || "",
            bill_date: req.body.bill_date || "",
            notes: req.body.notes || "",
            total_amount: Number(req.body.total_amount) || 0,
            source: sourceToUse,
            status: statusToUse,
        });

        return res.status(201).json({
            success: true,
            message: "Bill uploaded successfully",
            data: purchase,
        });
    } catch (error) {
        console.error("Upload Bill Error:", error);
        return res.status(500).json({
            success: false,
            message: error.message,
        });
    }
};

// ── POST /api/v1/purchase/draft ───────────────────────────────────────────
const createDraftPurchase = async (req, res) => {
    try {
        const { supplier_name, supplier_gstin, bill_no, bill_date, notes, total_amount, bill_image_url } = req.body;
        const purchase = await Purchase.create({
            storeId: req.storeId,
            supplier_name: supplier_name || "",
            supplier_gstin: supplier_gstin || "",
            bill_no: bill_no || "",
            bill_date: bill_date || "",
            notes: notes || "",
            total_amount: Number(total_amount) || 0,
            bill_image_url: bill_image_url || null,
            source: "manual",
            status: "draft",
        });

        return res.status(201).json({
            success: true,
            message: "Purchase draft created successfully",
            data: purchase,
        });
    } catch (error) {
        console.error("Create Draft Purchase Error:", error.message);
        return res.status(500).json({ success: false, message: error.message });
    }
};

// ── GET /api/v1/purchase/admin/auto-import-bills ──────────────────────────
const getAutoImportBills = async (req, res) => {
    try {
        const purchases = await Purchase.find({ 
            source: "auto_import", 
            // We can fetch all auto-import or just processing. Let's fetch all.
        })
        .populate("storeId", "storeName")
        .sort({ createdAt: -1 });

        return res.status(200).json({ success: true, data: purchases });
    } catch (error) {
        console.error("Get Auto-Import Bills Error:", error.message);
        return res.status(500).json({ success: false, message: error.message });
    }
};

// ── PATCH /api/v1/purchase/:id/finalize ───────────────────────────────────
// Called after the user confirms the auto-import review.
// Marks the Purchase record as received and fills in aggregated metadata.
const finalizePurchase = async (req, res) => {
    try {
        const { id } = req.params;
        const { supplier_name, total_amount, items_count, imported_items } = req.body;

        const purchase = await Purchase.findOneAndUpdate(
            { _id: id, storeId: req.storeId },
            {
                $set: {
                    status:         "received",
                    supplier_name:  supplier_name  || "",
                    total_amount:   Number(total_amount)  || 0,
                    items_count:    Number(items_count)   || 0,
                    imported_items: imported_items || [],
                },
            },
            { returnDocument: "after" }
        );

        if (!purchase) {
            return res.status(404).json({ success: false, message: "Purchase record not found" });
        }

        return res.status(200).json({ success: true, data: purchase });
    } catch (error) {
        console.error("Finalize Purchase Error:", error.message);
        return res.status(500).json({ success: false, message: error.message });
    }
};

// ── PATCH /api/v1/purchase/:id/save-json ─────────────────────────────────
// Called when admin uploads JSON. Updates the Purchase record so it's ready for manual review.
const savePurchaseJson = async (req, res) => {
    try {
        const { id } = req.params;
        const { supplier_name, supplier_gstin, bill_no, bill_date, items, total_amount, taxable_amount, cgst_amount, sgst_amount } = req.body;

        const purchase = await Purchase.findOneAndUpdate(
            { _id: id, storeId: req.storeId },
            {
                $set: {
                    supplier_name: supplier_name || "",
                    supplier_gstin: supplier_gstin || "",
                    bill_no: bill_no || "",
                    bill_date: bill_date || null,
                    extracted_items: items || [],
                    total_amount: Number(total_amount) || 0,
                    taxable_amount: Number(taxable_amount) || 0,
                    cgst_amount: Number(cgst_amount) || 0,
                    sgst_amount: Number(sgst_amount) || 0,
                    needs_manual_review: true,
                    status: "pending",
                },
            },
            { returnDocument: "after" }
        );

        if (!purchase) {
            return res.status(404).json({ success: false, message: "Purchase record not found" });
        }

        return res.status(200).json({ success: true, data: purchase });
    } catch (error) {
        console.error("Save Purchase JSON Error:", error.message);
        return res.status(500).json({ success: false, message: error.message });
    }
};

// ── GET /api/v1/purchase/ ─────────────────────────────────────────────────
const getPurchases = async (req, res) => {
    try {
        const purchases = await Purchase.find({ storeId: req.storeId }).sort({ createdAt: -1 });
        return res.status(200).json({ success: true, data: purchases });
    } catch (error) {
        console.error("Get Purchases Error:", error.message);
        return res.status(500).json({ success: false, message: error.message });
    }
};

// ── DELETE /api/v1/purchase/:id ───────────────────────────────────────────
const deletePurchase = async (req, res) => {
    try {
        const purchase = await Purchase.findOneAndDelete({ _id: req.params.id, storeId: req.storeId });
        if (!purchase) {
            return res.status(404).json({ success: false, message: "Purchase not found" });
        }
        return res.status(200).json({ success: true, message: "Purchase deleted" });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

const getNextShortBarcode = async (storeId) => {
    // Generate 8-digit random number
    return Math.floor(10000000 + Math.random() * 90000000).toString();
};

const escapeRegExp = (string) => {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

const createManualPurchase = async (req, res) => {
    try {
        const { 
            supplier_name,
            supplier_gstin,
            bill_no, 
            bill_date, 
            items, 
            taxable_amount, 
            cgst_amount,
            sgst_amount,
            total_amount,
            notes,
            storeId,
            purchase_id
        } = req.body;

        const storeIdToUse = storeId || req.storeId;

        if (!items || items.length === 0) {
            return res.status(400).json({ success: false, message: "Purchase must contain at least one item." });
        }

        const session = await mongoose.startSession();
        session.startTransaction();

        try {
            const imported_items = [];
            const movementOps = [];
            
            for (let item of items) {
                const nameToUse = item.medicine_name || item.product_name || "";
                const normalizedName = nameToUse.trim().toUpperCase();
                if (!normalizedName) continue;
                
                const cleanNumber = (val) => Number(String(val || 0).replace(/[^\d.]/g, "")) || 0;
                const addedQuantity = cleanNumber(item.quantity);
                let rateAmount = cleanNumber(item.rate);
                let discountPercent = cleanNumber(item.discount);
                let costPriceAfterDiscount = rateAmount - (rateAmount * (discountPercent / 100));
                
                // Format expiry_date to last day of the month if it's YYYY-MM or MM/YY
                let exp = item.expiry_date;
                if (exp && typeof exp === 'string') {
                    if (/^\d{4}-\d{2}$/.test(exp)) {
                        const [year, month] = exp.split('-');
                        const lastDay = new Date(parseInt(year), parseInt(month), 0).getDate();
                        item.expiry_date = `${year}-${month}-${String(lastDay).padStart(2, '0')}`;
                    } else if (/^\d{2}\/\d{2}$/.test(exp)) {
                        const [month, yy] = exp.split('/');
                        const year = `20${yy}`;
                        const lastDay = new Date(parseInt(year), parseInt(month), 0).getDate();
                        item.expiry_date = `${year}-${month}-${String(lastDay).padStart(2, '0')}`;
                    }
                }
                
                // Find or Create in Inventory
                let inventoryItem = await Inventory.findOne({
                    storeId: storeIdToUse,
                    medicine_name: {
                        $regex: new RegExp(`^${escapeRegExp(normalizedName)}$`, "i")
                    },
                    batch_number: item.batch_number || ""
                }).session(session);

                let previousStock = 0;
                let newStock = 0;

                if (inventoryItem) {
                    previousStock = inventoryItem.quantity;
                    inventoryItem.quantity += addedQuantity;
                    newStock = inventoryItem.quantity;
                    inventoryItem.mrp = cleanNumber(item.mrp);
                    if (item.expiry_date) inventoryItem.expiry_date = item.expiry_date;
                    if (item.rate !== undefined) inventoryItem.cost_price = costPriceAfterDiscount;
                    if (item.hsn_code) inventoryItem.hsn_code = item.hsn_code;
                    if (item.gst !== undefined) inventoryItem.gst = cleanNumber(item.gst);
                    
                    await inventoryItem.save({ session });
                } else {
                    const short_barcode = await getNextShortBarcode(storeIdToUse);
                    inventoryItem = await Inventory.create([{
                        medicine_name: normalizedName,
                        mrp: cleanNumber(item.mrp),
                        quantity: addedQuantity,
                        cost_price: item.rate !== undefined ? costPriceAfterDiscount : null,
                        expiry_date: item.expiry_date || null,
                        batch_number: item.batch_number || "",
                        hsn_code: item.hsn_code || "",
                        gst: item.gst ? cleanNumber(item.gst) : 0,
                        short_barcode: short_barcode,
                        storeId: storeIdToUse
                    }], { session });
                    inventoryItem = inventoryItem[0];
                    newStock = addedQuantity;
                }
                
                movementOps.push({
                    storeId: storeIdToUse,
                    productId: inventoryItem._id,
                    medicine_name: inventoryItem.medicine_name,
                    transaction_type: "PURCHASE",
                    reference_id: null, // will be updated after purchase doc is saved/found
                    quantity_change: addedQuantity,
                    previous_stock: previousStock,
                    current_stock: newStock,
                    remarks: "Purchased items"
                });
                
                imported_items.push({
                    inventoryId: inventoryItem._id,
                    quantity: addedQuantity,
                    mrp: cleanNumber(item.mrp)
                });
            }

            let purchase;
            if (purchase_id) {
                purchase = await Purchase.findOneAndUpdate(
                    { _id: purchase_id, storeId: storeIdToUse },
                    {
                        $set: {
                            supplier_name: supplier_name || "",
                            supplier_gstin: supplier_gstin || "",
                            bill_no: bill_no || "",
                            bill_date: bill_date || "",
                            notes: notes || "",
                            taxable_amount: Number(taxable_amount) || 0,
                            cgst_amount: Number(cgst_amount) || 0,
                            sgst_amount: Number(sgst_amount) || 0,
                            total_amount: Number(total_amount) || 0,
                            items_count: items.length,
                            imported_items: imported_items,
                            status: "received",
                            needs_manual_review: false
                        }
                    },
                    { new: true, session }
                );
                if (!purchase) {
                    throw new Error("Purchase document not found for update.");
                }
            } else {
                purchase = await Purchase.create([{
                    storeId: storeIdToUse,
                    supplier_name: supplier_name || "",
                    supplier_gstin: supplier_gstin || "",
                    bill_no: bill_no || "",
                    bill_date: bill_date || "",
                    notes: notes || "",
                    taxable_amount: Number(taxable_amount) || 0,
                    cgst_amount: Number(cgst_amount) || 0,
                    sgst_amount: Number(sgst_amount) || 0,
                    total_amount: Number(total_amount) || 0,
                    items_count: items.length,
                    imported_items: imported_items,
                    source: "manual",
                    status: "received"
                }], { session });
                purchase = purchase[0];
            }

            // Save Stock Movements
            if (movementOps.length > 0) {
                const opsWithRef = movementOps.map(op => ({
                    ...op,
                    reference_id: purchase._id
                }));
                await StockMovement.insertMany(opsWithRef, { session });
            }

            await session.commitTransaction();
            session.endSession();

            return res.status(201).json({
                success: true,
                message: "Manual purchase saved and inventory updated successfully.",
                data: purchase,
            });

        } catch (error) {
            await session.abortTransaction();
            session.endSession();
            throw error;
        }

    } catch (error) {
        console.error("Create Manual Purchase Error:", error.message);
        return res.status(500).json({ success: false, message: error.message });
    }
};

export { uploadBill, createDraftPurchase, getAutoImportBills, getPurchases, deletePurchase, finalizePurchase, createManualPurchase, savePurchaseJson };
