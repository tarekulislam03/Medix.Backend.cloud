import mongoose, { Schema } from "mongoose";

/**
 * AIImportJob — tracks the full lifecycle of an AI-powered purchase bill import.
 *
 * Lifecycle:  uploading → processing → review_ready | low_confidence | failed
 *             review_ready / low_confidence → confirmed | rejected
 *
 * A Purchase record is only created when the user confirms (status → confirmed).
 */
const aiImportJobSchema = new Schema(
    {
        storeId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Store",
            required: true,
            index: true,
        },

        // ── Status ────────────────────────────────────────────────────────────
        status: {
            type: String,
            enum: [
                "uploading",       // images being optimized & pushed to Cloudinary
                "processing",      // LLM cascade in progress
                "review_ready",    // confidence ≥ 90 %, awaiting user review
                "low_confidence",  // all LLMs tried, best confidence < 90 %
                "confirmed",       // user confirmed → inventory updated
                "rejected",        // user rejected / discarded
                "failed",          // unrecoverable error
            ],
            default: "uploading",
        },

        // ── Source images (Cloudinary) ────────────────────────────────────────
        images: [
            {
                original_name: { type: String, default: "" },
                cloudinary_url: { type: String, default: "" },
                cloudinary_public_id: { type: String, default: "" },
                page_number: { type: Number, default: 1 },
            },
        ],

        // ── User-supplied metadata ────────────────────────────────────────────
        supplier_name: { type: String, default: "" },
        bill_date: { type: String, default: "" },
        total_amount: { type: Number, default: 0 },

        // ── LLM-extracted invoice metadata ────────────────────────────────────
        bill_no: { type: String, default: "" },
        supplier_gstin: { type: String, default: "" },

        // ── Extracted items (best result from cascade) ────────────────────────
        extracted_items: [
            {
                medicine_name: { type: String, default: "" },
                batch_number: { type: String, default: "" },
                expiry_date: { type: String, default: "" },
                quantity: { type: Number, default: 0 },
                unit: { type: String, default: "" },
                purchase_price: { type: Number, default: 0 },
                mrp: { type: Number, default: 0 },
                discount_percentage: { type: Number, default: 0 },
                gst_percentage: { type: Number, default: 5 },
                hsn_code: { type: String, default: "" },
                total_amount: { type: Number, default: 0 },
                item_confidence: { type: Number, default: 0 }, // 0–100
            },
        ],

        // ── AI confidence & audit trail ───────────────────────────────────────
        overall_confidence: { type: Number, default: 0 }, // 0–100
        llm_used: { type: String, default: "" },           // model id that produced final result
        llm_attempts: [
            {
                model: { type: String, default: "" },
                started_at: { type: Date },
                completed_at: { type: Date },
                success: { type: Boolean, default: false },
                confidence: { type: Number, default: 0 },
                error: { type: String, default: "" },
                items_count: { type: Number, default: 0 },
            },
        ],
        processing_time_ms: { type: Number, default: 0 },

        // ── Link to Purchase (created on confirm) ─────────────────────────────
        purchaseId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Purchase",
            default: null,
        },

        // ── Error & warnings ──────────────────────────────────────────────────
        error_message: { type: String, default: "" },
        validation_warnings: { type: [String], default: [] },
    },
    { timestamps: true }
);

// Index for listing jobs by store & status
aiImportJobSchema.index({ storeId: 1, status: 1, createdAt: -1 });

const AIImportJob = mongoose.model("AIImportJob", aiImportJobSchema);

export default AIImportJob;
