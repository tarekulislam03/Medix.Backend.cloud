import bwipjs from "bwip-js";
import crypto from "crypto";
import Inventory from "../models/productModel.js";
import { extractWithCascade } from "../../../core/services/llmService.js";
import { safeParseJSON } from "../../../core/services/jsonParser.js";
import { optimizeInvoiceImage } from "../../../core/services/imageOptimizer.js";
import { normalizeImage } from "../../../core/middleware/imageNormalizationMiddleware.js";
import { extractTextFromOCRSpace } from "../../../core/middleware/textExtractorMiddleware.js";

import { uploadToCloudinary } from "../../purchase/controllers/purchaseController.js";
import Purchase from "../../purchase/models/purchaseModel.js";
import Counter from "../../../core/models/counterModel.js";
import StockMovement from "../../stockMovement/models/stockMovementModel.js";

const escapeRegExp = (string) => {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

const getNextShortBarcode = async (storeId) => {
    return Math.floor(10000000 + Math.random() * 90000000).toString();
};

// Create product
const createProduct = async (req, res) => {
    try {
        const {
            medicine_name,
            mrp,
            quantity,
            supplier_name,
            expiry_date,
            alert_threshold,
            tablets_per_strip,
            cost_price,
            batch_number,
            hsn_code,
            gst,
            force_update
        } = req.body;

        if (!medicine_name || !mrp || !quantity) {
            return res.status(400).json({
                message: "medicine_name, mrp and quantity are required"
            });
        }

        const cleanNumber = (val) =>
            Number(String(val || 0).replace(/[^\d.]/g, "")) || 0;

        const normalizedName = medicine_name.trim().toUpperCase();

        let product = await Inventory.findOne({
            storeId: req.storeId,
            medicine_name: {
                $regex: new RegExp(`^${escapeRegExp(normalizedName)}$`, "i")
            },
            batch_number: batch_number || ""
        });

        if (product) {
            const incomingMrp = cleanNumber(mrp);
            const existingMrp = product.mrp;

            // Normalize dates for comparison (Y-m-d)
            const incomingExpiry = expiry_date ? new Date(expiry_date).toISOString().split('T')[0] : null;
            const existingExpiry = product.expiry_date ? new Date(product.expiry_date).toISOString().split('T')[0] : null;

            const isUnbatched = !product.batch_number || product.batch_number.trim() === '';
            const hasConflict = !isUnbatched && ((incomingMrp !== existingMrp) || (incomingExpiry !== existingExpiry));

            if (hasConflict && !force_update) {
                return res.status(409).json({
                    success: false,
                    has_conflict: true,
                    conflict: {
                        medicine_name: product.medicine_name,
                        batch_number: product.batch_number,
                        existing_mrp: existingMrp,
                        incoming_mrp: incomingMrp,
                        existing_expiry: existingExpiry,
                        incoming_expiry: incomingExpiry,
                        conflict_fields: [
                            ...(incomingMrp !== existingMrp ? ['mrp'] : []),
                            ...(incomingExpiry !== existingExpiry ? ['expiry_date'] : [])
                        ]
                    },
                    message: `Batch conflict detected for ${product.medicine_name} (Batch: ${product.batch_number || 'None'}).`
                });
            }

            const previousQuantity = product.quantity;
            product.quantity += cleanNumber(quantity);
            product.mrp = incomingMrp;
            product.supplier_name = supplier_name || null;
            product.expiry_date = expiry_date || null;
            product.alert_threshold = alert_threshold || 2;
            product.tablets_per_strip = tablets_per_strip ? cleanNumber(tablets_per_strip) : null;
            product.cost_price = cost_price ? cleanNumber(cost_price) : null;
            product.batch_number = batch_number || "";
            product.hsn_code = hsn_code || "";
            product.gst = gst ? cleanNumber(gst) : 0;

            await product.save();

            if (cleanNumber(quantity) !== 0) {
                await StockMovement.create({
                    storeId: req.storeId,
                    productId: product._id,
                    medicine_name: product.medicine_name,
                    transaction_type: "MANUAL_ADJUSTMENT",
                    reference_id: null,
                    quantity_change: cleanNumber(quantity),
                    previous_stock: previousQuantity,
                    current_stock: product.quantity,
                    remarks: "Added via Create/Update Product"
                });
            }



            return res.status(200).json({
                message: "Product updated",
                data: product
            });

        } else {

            const barcodeString =
                `${normalizedName.replace(/\s/g, '')}-${Date.now()}-${crypto.randomUUID().split('-')[0]}`;

            const shortBarcodeString = await getNextShortBarcode(req.storeId);

            product = await Inventory.create({
                storeId: req.storeId,
                medicine_name: normalizedName,
                barcode: barcodeString,
                short_barcode: shortBarcodeString,
                mrp: cleanNumber(mrp),
                quantity: cleanNumber(quantity),
                supplier_name: supplier_name || null,
                expiry_date: expiry_date || null,
                alert_threshold: alert_threshold || 2,
                tablets_per_strip: tablets_per_strip ? cleanNumber(tablets_per_strip) : null,
                cost_price: cost_price ? cleanNumber(cost_price) : null,
                batch_number: batch_number || "",
                hsn_code: hsn_code || "",
                gst: gst ? cleanNumber(gst) : 0
            });

            await StockMovement.create({
                storeId: req.storeId,
                productId: product._id,
                medicine_name: product.medicine_name,
                transaction_type: "INITIAL_STOCK",
                reference_id: null,
                quantity_change: cleanNumber(quantity),
                previous_stock: 0,
                current_stock: cleanNumber(quantity),
                remarks: "Initial stock via Create Product"
            });



            return res.status(201).json({
                message: "Product created",
                data: product
            });
        }

    } catch (error) {

        if (error.code === 11000) {
            return res.status(409).json({
                message: "Duplicate barcode prevented"
            });
        }

        console.error("Create Product Error:", error);

        return res.status(500).json({
            message: error.message
        });
    }
};


// Get all Products
const getProducts = async (req, res) => {
    try {

        const product = await Inventory.find({ storeId: req.storeId });

        if (!product) {
            return res.status(400).json({
                message: "No  products found"
            })
        }

        res.status(200).json({
            message: "Products fetched successfully!",
            count: `Total Products - ${product.length}`,
            data: product
        })


    } catch (error) {
        res.status(500).json({
            message: "Internal Server Error"
        })
    }
}

// get a product by id
const getProductById = async (req, res) => {
    try {

        const product = await Inventory.findOne({ _id: req.params.id, storeId: req.storeId });

        if (!product) {
            return res.status(400).json({
                message: "No  products found"
            })
        }

        res.status(200).json({
            message: "Product fetched successfully!",
            data: product
        })

    } catch (error) {
        res.status(500).json({
            message: "Internal Server Error"
        })
    }
}

// Update product by id
const updateProduct = async (req, res) => {
    try {
        const oldProduct = await Inventory.findOne({ _id: req.params.id, storeId: req.storeId });
        
        if (!oldProduct) {
            return res.status(400).json({
                message: "No products found"
            })
        }

        const previousQuantity = oldProduct.quantity;

        const update = await Inventory.findOneAndUpdate(
            { _id: req.params.id, storeId: req.storeId },
            req.body,
            { returnDocument: "after" }
        );

        if (update && update.quantity !== previousQuantity) {
            await StockMovement.create({
                storeId: req.storeId,
                productId: update._id,
                medicine_name: update.medicine_name,
                transaction_type: "MANUAL_ADJUSTMENT",
                reference_id: null,
                quantity_change: update.quantity - previousQuantity,
                previous_stock: previousQuantity,
                current_stock: update.quantity,
                remarks: "Manual update via product edit"
            });
        }

        res.status(200).json({
            message: "Product updated successfully!",
            data: update
        })


    } catch (error) {
        res.status(500).json({
            message: "Internal Server Error"
        })
    }
}

// Delete Product
const deleteProduct = async (req, res) => {
    try {

        const deleteitems = await Inventory.findOneAndDelete({ _id: req.params.id, storeId: req.storeId });

        if (!deleteitems) {
            return res.status(400).json({
                message: "No products found"
            })
        }

        res.status(200).json({
            message: "Product delted successfully!",
        })


    } catch (error) {
        res.status(500).json({
            message: "Internal Server Error",
            data: error
        })
    }
}

// Search Products (in-memory cache — zero DB queries)

const searchProduct = async (req, res) => {
    try {
        const keyword = req.query.keyword || req.query.q || "";

        // Handle empty or missing query
        if (!keyword || keyword.trim() === "") {
            return res.status(200).json({
                count: "0 products found",
                data: [],
            });
        }

        // Search from MongoDB directly
        const queryRegex = new RegExp(escapeRegExp(keyword), 'i');
        const results = await Inventory.find({
            storeId: req.storeId,
            $or: [
                { medicine_name: queryRegex },
                { short_barcode: queryRegex },
                { batch_number: queryRegex },
                { barcode: queryRegex }
            ]
        }).limit(10).lean();

        return res.status(200).json({
            count: `${results.length} products found for this keyword`,
            data: results,
        });

    } catch (error) {
        console.error("Search error:", error);
        res.status(500).json({
            message: "Internal Server Error",
            data: error.message,
        });
    }
}

const lowStock = async (req, res) => {
    try {

        // find low stock products ( quantity <= alert_threshold )
        const low = await Inventory.find({
            storeId: req.storeId,
            returned_to_supplier: { $ne: true },
            $expr: { $lte: ["$quantity", "$alert_threshold"] }
        })

        if (low) {
            return res.status(200).json({
                count: `Total Low Stock Products - ${low.length}`,
                data: low
            })
        }
    } catch (error) {
        res.status(500).json({
            message: "Internal Server Error"
        })
    }
}

// Soon to expiry products
const soonToExpiry = async (req, res) => {
    try {

        const today = new Date();
        const next90Days = new Date();
        next90Days.setDate(today.getDate() + 90);


        const expiry = await Inventory.find({
            storeId: req.storeId,
            returned_to_supplier: { $ne: true },
            expiry_date: { $lte: next90Days }
        })

        if (expiry) {
            res.status(200).json({
                count: `Total Soon to Expiry Products - ${expiry.length}`,
                data: expiry
            })
        }

    } catch (error) {

    }
}


// Get loose medicine price per tablet
const getLooseMedicinePrice = async (req, res) => {
    try {
        const { id } = req.params;
        const { quantity } = req.query; // optional: number of tablets requested

        const product = await Inventory.findOne({ _id: id, storeId: req.storeId });

        if (!product) {
            return res.status(404).json({
                success: false,
                message: "Product not found"
            });
        }

        if (!product.tablets_per_strip || product.tablets_per_strip <= 0) {
            return res.status(400).json({
                success: false,
                message: "This product is not configured for loose sale. Please set tablets_per_strip."
            });
        }

        const pricePerTablet = Number((product.mrp / product.tablets_per_strip).toFixed(2));

        const requestedQty = quantity ? Number(quantity) : null;
        const totalPrice = requestedQty
            ? Number((pricePerTablet * requestedQty).toFixed(2))
            : null;

        return res.status(200).json({
            success: true,
            medicine_name: product.medicine_name,
            mrp_per_strip: product.mrp,
            tablets_per_strip: product.tablets_per_strip,
            price_per_tablet: pricePerTablet,
            ...(requestedQty && {
                requested_tablets: requestedQty,
                total_price: totalPrice
            })
        });

    } catch (error) {
        console.error("Loose Medicine Price Error:", error);
        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// auto product import from bill image using Python OCR pipeline
const autoImportProducts = async (req, res) => {
    const t0 = Date.now();

    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: "No image uploaded",
            });
        }

        console.log("[1] Request received for auto-import");

        const originalBuffer = req.file.buffer;
        const originalName = req.file.originalname;
        const originalMime = req.file.mimetype;
        const storeId = req.storeId;
        
        const manualSupplierName = req.body.supplier_name || "";
        const manualBillDate = req.body.bill_date || "";
        const manualTotalAmount = req.body.total_amount || 0;

        // 1. Create Purchase record immediately
        const purchase = await Purchase.create({
            storeId,
            source: "auto_import",
            status: "processing",
            bill_image_url: "", 
            cloudinary_public_id: "",
            supplier_name: manualSupplierName,
            bill_date: manualBillDate,
            total_amount: manualTotalAmount ? Number(manualTotalAmount) : 0,
            processing_progress: 5, // Just started
        });

        const pendingPurchaseId = purchase._id.toString();

        // 2. Respond to client immediately
        res.status(202).json({
            success: true,
            message: "Upload successful, processing in background.",
            purchase_id: pendingPurchaseId
        });

        // 3. Process in background
        (async () => {
            try {
                console.log("[1.5] Image compression start for", pendingPurchaseId);
                await Purchase.findByIdAndUpdate(pendingPurchaseId, { processing_progress: 15 });
                const { buffer: compressedBuffer, base64: imageBase64, mimeType } = await optimizeInvoiceImage(originalBuffer, originalMime);

                // Start Cloudinary upload in parallel
                let cloudResult = null;
                uploadToCloudinary(compressedBuffer, originalName, 'image/jpeg')
                    .then(res => { cloudResult = res; })
                    .catch(err => console.warn("[Cloudinary Async Error]", err.message));

                console.log("[2] LLM OCR Pipeline start for", pendingPurchaseId);
                await Purchase.findByIdAndUpdate(pendingPurchaseId, { processing_progress: 40 }); // Uploading/Vision
                const parsed = await extractWithCascade([{ base64: imageBase64, mimeType }]);
                console.log("[3] LLM OCR Pipeline completed for", pendingPurchaseId);
                await Purchase.findByIdAndUpdate(pendingPurchaseId, { processing_progress: 85 }); // Extraction complete

                if (!parsed || !parsed.items || !Array.isArray(parsed.items)) {
                    throw new Error("Invalid pipeline response format: missing items array");
                }

                const items = parsed.items;
                const invMeta = parsed.invoice || {};                
                const storeMeta = parsed.store || {};
                const totalsMeta = parsed.totals || {};

                const metadata = {
                    supplier_name: manualSupplierName || storeMeta.name || "",
                    supplier_gstin: storeMeta.gstin || "",
                    invoice_no: invMeta.number || "",
                    invoice_date: manualBillDate || invMeta.date || "",
                    subtotal: Number(totalsMeta.subtotal) || 0,
                    taxable_amount: Number(totalsMeta.taxable_amount) || 0,
                    cgst_amount: Number(totalsMeta.cgst_amount) || 0,
                    sgst_amount: Number(totalsMeta.sgst_amount) || 0,
                    total_amount: manualTotalAmount ? Number(manualTotalAmount) : (Number(totalsMeta.grand_total) || 0)
                };

                // Update Purchase record with extracted data
                await Purchase.findByIdAndUpdate(pendingPurchaseId, {
                    status: "pending",
                    supplier_name: metadata.supplier_name,
                    supplier_gstin: metadata.supplier_gstin,
                    bill_no: metadata.invoice_no,
                    bill_date: metadata.invoice_date,
                    subtotal: metadata.subtotal,
                    taxable_amount: metadata.taxable_amount,
                    cgst_amount: metadata.cgst_amount,
                    sgst_amount: metadata.sgst_amount,
                    total_amount: metadata.total_amount,
                    items_count: items.length,
                    extracted_items: items,
                    confidence_score: parsed.overallConfidence || 0.0,
                    needs_manual_review: true, // Always require review for now
                    validation_warnings: parsed.validationWarnings || [],
                    processing_progress: 100,
                    ...(cloudResult && {
                        bill_image_url: cloudResult.secure_url,
                        cloudinary_public_id: cloudResult.public_id
                    })
                });

                console.log("[6] Background Import completed for", pendingPurchaseId);

            } catch (bgError) {
                console.error("[BACKGROUND AUTO IMPORT ERROR]", bgError);
                await Purchase.findByIdAndUpdate(pendingPurchaseId, {
                    status: "failed",
                    processing_progress: 0,
                    notes: bgError.message
                }).catch(() => {}); // ignore db errors during failure update
            }
        })();

    } catch (error) {
        console.error("[AUTO IMPORT ERROR]", error);
        if (!res.headersSent) {
            return res.status(500).json({
                success: false,
                message: "Auto import failed to start",
                error: error.message,
            });
        }
    }
};

const autoImportConfirm = async (req, res) => {
    try {
        const { purchaseId, items } = req.body;

        if (!Array.isArray(items) || !items.length) {
            return res.status(400).json({
                success: false,
                message: "Invalid items format"
            });
        }

        if (!purchaseId) {
            return res.status(400).json({
                success: false,
                message: "Missing purchaseId"
            });
        }

        const cleanNumber = (val) =>
            Number(String(val || 0).replace(/[^\d.]/g, "")) || 0;

        const timestamp = Date.now();

        /*
        ===================================
        STEP 1: MERGE DUPLICATES IN FILE
        ===================================
        */

        const mergedItems = new Map();

        for (const item of items) {
            const medicineNameRaw =
                item.medicine_name || item.product_name;

            if (!medicineNameRaw) continue;

            const normalizedName =
                medicineNameRaw.trim().toUpperCase();

            const batchNumber =
                (item.batch_number || "").trim();

            const key =
                `${normalizedName}__${batchNumber}`;

            const quantity =
                cleanNumber(item.quantity);

            if (mergedItems.has(key)) {
                mergedItems.get(key).quantity += quantity;
            } else {
                mergedItems.set(key, {
                    ...item,
                    normalizedName,
                    batchNumber,
                    quantity
                });
            }
        }

        const finalItems = [...mergedItems.values()];

        /*
        ===================================
        STEP 2: BARCODE GENERATION
        ===================================
        */
        // Generating random short barcodes directly per item

        /*
        ===================================
        STEP 3: FIND EXISTING PRODUCTS
        ===================================
        */

        const escapeRegExpInner = (string) => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const filters = finalItems.map((item) => ({
            storeId: req.storeId,
            medicine_name: { $regex: new RegExp(`^${escapeRegExpInner(item.normalizedName)}$`, "i") },
            batch_number: item.batchNumber
        }));

        const existingProducts =
            await Inventory.find({
                $or: filters
            })
                .select(
                    "_id medicine_name batch_number"
                )
                .lean();

        const existingMap = new Map();

        existingProducts.forEach((product) => {
            const nameUpper = String(product.medicine_name).toUpperCase();
            const key =
                `${nameUpper}__${product.batch_number || ""}`;

            existingMap.set(key, product);
        });

        /*
        ===================================
        STEP 4: BUILD BULK OPERATIONS
        ===================================
        */

        const bulkOps = [];

        let createdCount = 0;
        let updatedCount = 0;

        const importedItemsList = [];

        finalItems.forEach((item, index) => {
            const key =
                `${item.normalizedName}__${item.batchNumber}`;

            const existing =
                existingMap.get(key);

            if (existing) {
                updatedCount++;

                importedItemsList.push({
                    inventoryId: existing._id,
                    quantity: item.quantity,
                    mrp: cleanNumber(item.mrp)
                });
            } else {
                createdCount++;
            }

            const shortBarcode =
                Math.floor(10000000 + Math.random() * 90000000).toString();

            const barcode =
                `${item.normalizedName.replace(/\s/g, "")}-${timestamp}-${crypto.randomUUID().split('-')[0]}`;

            bulkOps.push({
                updateOne: {
                    filter: {
                        storeId: req.storeId,
                        medicine_name: existing ? existing.medicine_name : item.normalizedName,
                        batch_number:
                            item.batchNumber
                    },
                    update: {
                        $inc: {
                            quantity: item.quantity
                        },

                        $set: {
                            medicine_name: existing ? existing.medicine_name : item.normalizedName,

                            mrp:
                                cleanNumber(item.mrp),

                            expiry_date:
                                item.expiry_date || null,

                            cost_price:
                                item.cost_price
                                    ? cleanNumber(item.cost_price)
                                    : null,

                            supplier_name:
                                item.supplier_name || null,

                            hsn_code:
                                item.hsn_code || "",

                            gst:
                                item.gst
                                    ? cleanNumber(item.gst)
                                    : 0
                        },

                        $setOnInsert: {
                            storeId:
                                req.storeId,

                            barcode,

                            short_barcode:
                                shortBarcode,

                            alert_threshold:
                                item.alert_threshold || null
                        }
                    },
                    upsert: true
                }
            });
        });

        /*
        ===================================
        STEP 5: SINGLE DB WRITE
        ===================================
        */

        await Inventory.bulkWrite(
            bulkOps,
            {
                ordered: false
            }
        );

        /*
        ===================================
        STEP 6: UPDATE PURCHASE RECORD
        ===================================
        */
        await Purchase.findByIdAndUpdate(purchaseId, {
            status: "received",
            needs_manual_review: false,
            items_count: finalItems.length
        });

        return res.json({
            success: true,
            updated_products: updatedCount,
            new_products: createdCount,
            imported_items: importedItemsList
        });
    } catch (error) {
        console.error(
            "Confirm Import Error:",
            error
        );

        if (error.code === 11000) {
            return res.status(409).json({
                success: false,
                message:
                    "Duplicate inventory record detected"
            });
        }

        return res.status(500).json({
            success: false,
            message:
                "Confirm import failed",
            error: error.message
        });
    }
};
// @desc    Bulk add products from master database
// @route   POST /api/v1/product/bulk-from-master
// @access  Private
const bulkAddFromMaster = async (req, res) => {
    try {
        const { items } = req.body;

        if (!items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ success: false, message: "No items provided" });
        }

        const storeId = req.storeId;
        const added = [];
        const skipped = [];

        // short barcodes will be generated randomly per item

        for (const item of items) {
            const normalizedName = String(item.medicine_name || "").trim().toUpperCase();

            if (!normalizedName) {
                skipped.push({ medicine_name: "UNKNOWN", reason: "Empty name" });
                continue;
            }

            // Check if it already exists for this store
            const existing = await Inventory.findOne({
                storeId,
                medicine_name: normalizedName
            }).collation({ locale: "en", strength: 2 });

            if (existing) {
                const stockToAdd = item.stock ? Number(item.stock) : 0;
                let updated = false;

                if (!isNaN(stockToAdd) && stockToAdd > 0) {
                    existing.quantity = (existing.quantity || 0) + stockToAdd;
                    updated = true;
                }

                if (item.mrp !== undefined && item.mrp !== "" && !isNaN(Number(item.mrp)) && Number(item.mrp) !== existing.mrp) {
                    existing.mrp = Number(item.mrp);
                    updated = true;
                }

                let validExpiry = null;
                if (item.expiry_date) {
                    const d = new Date(item.expiry_date);
                    if (!isNaN(d.getTime())) {
                        validExpiry = d;
                    }
                }

                if (validExpiry) {
                    existing.expiry_date = validExpiry;
                    updated = true;
                }

                if (updated) {
                    await existing.save();
                    added.push(existing);
                } else {
                    skipped.push({ medicine_name: normalizedName, reason: "Already exists and no changes made" });
                }
                continue;
            }

            const barcodeString = `${normalizedName.replace(/\s/g, '')}-${Date.now()}-${crypto.randomUUID().split('-')[0]}`;
            const shortBarcodeString = Math.floor(10000000 + Math.random() * 90000000).toString();

            const batchNumber = 'B' + Math.random().toString(36).substring(2, 8).toUpperCase();

            let validExpiry = null;
            if (item.expiry_date) {
                const d = new Date(item.expiry_date);
                if (!isNaN(d.getTime())) {
                    validExpiry = d;
                }
            }

            const newProduct = await Inventory.create({
                storeId,
                medicine_name: normalizedName,
                mrp: Number(item.mrp || 0),
                quantity: item.stock ? Number(item.stock) : 0,
                gst: 5,
                barcode: barcodeString,
                short_barcode: shortBarcodeString,
                batch_number: batchNumber,
                ...(validExpiry ? { expiry_date: validExpiry } : {})
            });


            added.push(newProduct);
        }

        res.status(201).json({
            success: true,
            added,
            skipped,
            message: `Added ${added.length} products, skipped ${skipped.length}`
        });
    } catch (error) {
        console.error("bulkAddFromMaster error:", error);
        res.status(500).json({ success: false, message: "Server error during bulk add" });
    }
};

export { createProduct, getProducts, getProductById, updateProduct, deleteProduct, searchProduct, lowStock, soonToExpiry, autoImportProducts, autoImportConfirm, getLooseMedicinePrice, bulkAddFromMaster };
