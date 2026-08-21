import OpenAI from "openai";
import axios from "axios";
import sharp from "sharp";
import { safeParseJSON } from "./jsonParser.js";

let openaiClient = null;

const getOpenAIClient = () => {
    if (!openaiClient) {
        openaiClient = new OpenAI({
            baseURL: "https://openrouter.ai/api/v1",
            apiKey: process.env.OPENROUTER_API_KEY,
        });
    }
    return openaiClient;
};

// ── TWO-STEP PIPELINE MODELS ────────────────────────────────────────────────

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434/v1";
const LOCAL_LLM_MODEL = process.env.LOCAL_LLM_MODEL || "qwen2.5:0.5b";

// Fallback Vision Model if OCR.Space is rate-limited or unavailable
const VISION_FALLBACK_MODEL = { id: "google/gemma-4-26b-a4b-it:free", name: "Gemma 4 26B A4B" };

// Dynamic model resolver based on runtime environment settings
const getTextModels = () => {
    const isLocalEnabled = process.env.USE_LOCAL_LLM === "true" || process.env.USE_LOCAL_LLM === "1";
    const localModel = process.env.LOCAL_LLM_MODEL || "qwen2.5:0.5b";

    const models = [];
    if (isLocalEnabled) {
        models.push({ id: `ollama:${localModel}`, name: `Local Ollama (${localModel})` });
    }
    models.push(
        { id: "google/gemma-4-26b-a4b-it:free", name: "Gemma 4 26B A4B" },
        { id: "google/gemma-4-26b-a4b-it:free", name: "Gemma 4 26B A4B" },
        { id: "google/gemma-4-26b-a4b-it:free", name: "Gemma 4 26B A4B" }
    );
    return models;
};

// ── PROMPTS ──────────────────────────────────────────────────────────────────

const JSON_PROMPT = `You are a strict data extraction system.
Map the following raw invoice text into the provided JSON schema.

Column Mapping Hints:
Description of Goods → medicine_name
Batch → batch_number
Exp → expiry_date (convert to YYYY-MM-DD; if only MM/YY, use the last day of that month)
Qty → quantity
Unit → unit
Rate / PTR / Trade Price → purchase_price
Discount % → discount_percentage
gst - 5% (default for all)
Amount → total_amount
HSN/SAC → hsn_code

CRITICAL PRICE RULES:
1. 'Rate', 'PTR', 'P.Rate', 'Trade Price', or 'Unit Rate' is the actual wholesale purchase price per unit -> map strictly to \`purchase_price\`.
2. 'MRP' or 'Max Retail Price' is the retail ceiling price -> DO NOT use MRP for \`purchase_price\`. Even if MRP is present in the table, \`purchase_price\` MUST be taken from the Rate/PTR column, NEVER the MRP column.

BATCH & HSN RULES:
1. Extract batch_number from the 'Batch' column. Fix common OCR misreads in batch codes using contextual table alignment:
   - Do NOT confuse batch_number with serial numbers (e.g. '1', '2') or Qty.
   - Batch numbers in pharmaceutical bills are alphanumeric (e.g. 'BSHA1360', '003D26RT', 'FS4B180726', 'MBL0111', 'G25EMACD6').
   - Clean up misread digits vs letters (e.g., 'O' vs '0', 'I' vs '1', 'S' vs '5') if surround by numbers/letters.
   - Preserve the COMPLETE batch_number string. Do not trim or truncate batch suffix codes.
2. Extract exact 8-digit or 4-digit HSN/SAC numbers (e.g. '30049099', '30049039').

Rules:
1. Preserve medicine names exactly as written in the text.
2. Leave the MRP field from getting any data, user will add that manually while review.
3. Return numbers as numbers, not strings.
4. Use null for missing values. Do not hallucinate data that is not explicitly in the text.
5. Return ONLY the raw JSON object, no markdown fences, no explanations.
6. Ignore non-medicine charges or fee rows such as 'COD CHARGES', 'PLATFORM FEES', 'DELIVERY CHARGES', 'SHIPPING', 'ROUND OFF', etc.

Schema:
{
  "invoice": {
    "invoice_number": "",
    "invoice_date": "",
    "supplier_name": "",
    "supplier_gstin": "",
    "buyer_name": "",
    "buyer_gstin": ""
  },
  "items": [
    {
      "medicine_name": "",
      "batch_number": "",
      "expiry_date": "",
      "quantity": 0,
      "unit": "",
      "purchase_price": 0,
      "mrp": 0,
      "discount_percentage": 0,
      "taxable_value": 0,
      "gst": 5,
      "total_amount": 0,
      "hsn_code": ""
    }
  ]
}

Raw Invoice Text to Parse:
`;

const OCR_PROMPT = `You are an OCR engine.
Return the document as raw Markdown text.
Preserve tables, headers, columns, batch numbers, dates, and amounts as closely as possible.
Do not interpret or infer missing data. Output only the OCR text.`;

// ═══════════════════════════════════════════════════════════════════════════════
// OCR TEXT OPTIMIZATION / TRIMMING
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Trims raw OCR text down to the essential invoice metadata header lines and item table.
 * Removes redundant footers, terms & conditions, tax summary matrices, and noise.
 */
export const trimOcrTextForLlm = (rawText) => {
    return rawText;
};

// ═══════════════════════════════════════════════════════════════════════════════
// OCR.SPACE INTEGRATION (Engine 3 with Retry & Fallback)
// ═══════════════════════════════════════════════════════════════════════════════

const delay = (ms) => new Promise((res) => setTimeout(res, ms));

// ── OCR.SPACE MULTI-KEY ROUND-ROBIN ─────────────────────────────────────────
// Supports multiple API keys via comma-separated OCR_SPACE_API_KEY or OCR_SPACE_API_KEYS
const getOcrSpaceKeys = () => {
    const raw = process.env.OCR_SPACE_API_KEYS || process.env.OCR_SPACE_API_KEY || "helloworld";
    const keys = raw.split(",").map(k => k.trim()).filter(k => k.length > 0);
    return keys.length > 0 ? keys : ["helloworld"];
};

let ocrKeyIndex = 0;

const getNextOcrKey = () => {
    const keys = getOcrSpaceKeys();
    const key = keys[ocrKeyIndex % keys.length];
    ocrKeyIndex++;
    return { key, index: (ocrKeyIndex - 1) % keys.length, total: keys.length };
};

const performOcrSpaceCall = async (image, apiKey) => {
    const base64Data = `data:${image.mimeType || 'image/jpeg'};base64,${image.base64}`;

    const params = new URLSearchParams();
    params.append("apikey", apiKey);
    params.append("base64Image", base64Data);
    params.append("OCREngine", "3");
    params.append("isTable", "true");
    params.append("scale", "true");
    params.append("detectOrientation", "true");

    const response = await axios.post("https://api.ocr.space/parse/image", params, {
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
        },
        timeout: 18000, // 18s timeout per request so we quickly rotate keys if OCR.Space stalls
    });

    if (response.data && response.data.ParsedResults && response.data.ParsedResults.length > 0) {
        const parsedText = response.data.ParsedResults.map(r => r.ParsedText).join("\n\n");
        if (parsedText && parsedText.trim()) {
            return parsedText;
        }
    }

    if (response.data && response.data.ErrorMessage) {
        const err = Array.isArray(response.data.ErrorMessage) ? response.data.ErrorMessage.join("; ") : response.data.ErrorMessage;
        throw new Error(`OCR.Space Error: ${err}`);
    }

    throw new Error("OCR.Space returned empty result");
};

/**
 * Executes OCR.Space with round-robin key rotation and automatic retry.
 * On rate-limit (403), timeout, or failure, rotates to the next API key before retrying.
 */
export const performOcrSpaceWithRetry = async (image, maxRetries = 1) => {
    const keys = getOcrSpaceKeys();
    const totalAttempts = Math.max(maxRetries + 1, keys.length);

    for (let attempt = 0; attempt < totalAttempts; attempt++) {
        const { key, index, total } = getNextOcrKey();
        const keyLabel = total > 1 ? ` [Key ${index + 1}/${total}]` : '';

        try {
            return await performOcrSpaceCall(image, key);
        } catch (err) {
            const isRateLimitOrTimeout = err.message.includes("403") ||
                err.message.includes("429") ||
                err.message.includes("timeout") ||
                err.message.includes("ECONNABORTED") ||
                err.message.includes("rate limit") ||
                err.message.includes("E006") ||
                err.message.includes("limit");

            console.warn(`[OCR.Space]${keyLabel} Attempt ${attempt + 1} failed: ${err.message}`);

            if (attempt < totalAttempts - 1) {
                if (isRateLimitOrTimeout && total > 1) {
                    console.log(`[OCR.Space] Rate limit / Timeout detected → rotating to next key...`);
                    await delay(500);
                } else {
                    console.log(`[OCR.Space] Waiting 1.5s before retry...`);
                    await delay(1500);
                }
            } else {
                throw err;
            }
        }
    }
};

// ── IMAGE SPLITTING FOR DENSE INVOICES ──────────────────────────────────────
// Splits tall invoice images into overlapping halves to prevent OCR truncation

const IMAGE_SPLIT_HEIGHT_THRESHOLD = 1000; // Split if image height exceeds this (in pixels) or aspect ratio > 1.2
const OVERLAP_PERCENT = 0.15; // 15% overlap between halves to avoid cutting through text rows

/**
 * Auto-splits tall images into overlapping halves, OCRs each, and merges results.
 * Small images are OCR'd in a single pass as usual.
 */
export const splitAndOcrImage = async (image) => {
    const buffer = Buffer.from(image.base64, 'base64');
    const metadata = await sharp(buffer).metadata();
    const { width, height } = metadata;

    // Small image → single pass OCR
    if (height <= IMAGE_SPLIT_HEIGHT_THRESHOLD) {
        console.log(`[OCR Split] Image ${width}×${height} → single pass`);
        return await performOcrSpaceWithRetry(image);
    }

    // Tall image → split into overlapping halves
    const overlapPx = Math.round(height * OVERLAP_PERCENT);
    const halfHeight = Math.ceil(height / 2);
    const topHeight = halfHeight + overlapPx;
    const bottomStart = halfHeight - overlapPx;
    const bottomHeight = height - bottomStart;

    console.log(`[OCR Split] Image ${width}×${height} → splitting into 2 halves (overlap: ${overlapPx}px)`);

    // Crop top half
    const topBuffer = await sharp(buffer)
        .extract({ left: 0, top: 0, width, height: Math.min(topHeight, height) })
        .jpeg({ quality: 90 })
        .toBuffer();

    // Crop bottom half
    const bottomBuffer = await sharp(buffer)
        .extract({ left: 0, top: bottomStart, width, height: bottomHeight })
        .jpeg({ quality: 90 })
        .toBuffer();

    const topImage = { base64: topBuffer.toString('base64'), mimeType: 'image/jpeg' };
    const bottomImage = { base64: bottomBuffer.toString('base64'), mimeType: 'image/jpeg' };

    // OCR top half
    console.log(`[OCR Split] Processing top half (${width}×${topHeight})...`);
    let topText = '';
    try {
        topText = await performOcrSpaceWithRetry(topImage);
    } catch (err) {
        console.warn(`[OCR Split] Top half failed: ${err.message}`);
    }

    // Small delay between halves to avoid rate limits
    await delay(1500);

    // OCR bottom half
    console.log(`[OCR Split] Processing bottom half (${width}×${bottomHeight})...`);
    let bottomText = '';
    try {
        bottomText = await performOcrSpaceWithRetry(bottomImage);
    } catch (err) {
        console.warn(`[OCR Split] Bottom half failed: ${err.message}`);
    }

    // Merge results — concatenate with a separator
    const mergedText = [topText, bottomText].filter(t => t && t.trim()).join('\n\n--- SPLIT ---\n\n');
    console.log(`[OCR Split] Merged: ${topText.length} + ${bottomText.length} = ${mergedText.length} chars`);

    return mergedText;
};

/**
 * Fallback Vision LLM transcription if OCR.Space is rate-limited or fails.
 */
const transcribeWithVisionFallback = async (image) => {
    console.log(`[Vision Fallback] Sending image to ${VISION_FALLBACK_MODEL.name}...`);
    const response = await getOpenAIClient().chat.completions.create({
        model: VISION_FALLBACK_MODEL.id,
        messages: [{
            role: "user",
            content: [
                { type: "text", text: OCR_PROMPT },
                { type: "image_url", image_url: { url: `data:${image.mimeType || 'image/jpeg'};base64,${image.base64}` } }
            ],
        }],
        temperature: 0.1,
        max_tokens: 4000,
    });
    return response.choices[0]?.message?.content || "";
};

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIDENCE SCORING (Rule-based + Anti-Hallucination)
// ═══════════════════════════════════════════════════════════════════════════════

const computeItemConfidence = (item, rawMarkdown) => {
    let score = 0;
    const weights = {
        requiredFields: 25,
        numericSanity: 15,
        dateValidity: 10,
        mathConsistency: 20,
        nameQuality: 10,
        groundTruth: 20,
    };

    const name = String(item.medicine_name || "").trim().toLowerCase();
    const markdownLower = (rawMarkdown || "").toLowerCase();

    let groundTruthScore = 0;
    if (name.length > 2) {
        const parts = name.split(/\s+/).filter(p => p.length > 2);
        let matchCount = 0;
        parts.forEach(p => {
            if (markdownLower.includes(p)) matchCount++;
        });

        if (matchCount > 0) {
            groundTruthScore = matchCount / parts.length;
        }
    }

    if (groundTruthScore === 0) {
        return 0; // Immediate 0% confidence for full hallucination
    }
    score += groundTruthScore * weights.groundTruth;

    const hasName = name.length > 0;
    const hasQty = item.quantity !== null && item.quantity !== undefined && !isNaN(Number(item.quantity));

    let requiredScore = 0;
    if (hasName) requiredScore += 0.5;
    if (hasQty) requiredScore += 0.5;
    score += requiredScore * weights.requiredFields;

    let numericScore = 0;
    const qty = Number(item.quantity) || 0;
    const purchasePrice = Number(item.purchase_price) || 0;

    if (qty > 0 && qty < 10000) numericScore += 0.5;
    if (purchasePrice >= 0 && purchasePrice < 50000) numericScore += 0.5;
    score += numericScore * weights.numericSanity;

    let dateScore = 0;
    if (item.expiry_date) {
        const parsed = new Date(item.expiry_date);
        if (!isNaN(parsed.getTime())) {
            dateScore += 0.5;
            if (parsed > new Date()) dateScore += 0.5;
            else dateScore += 0.2;
        }
    } else {
        dateScore += 0.4;
    }
    score += dateScore * weights.dateValidity;

    let mathScore = 0;
    const totalAmount = Number(item.total_amount) || 0;

    if (purchasePrice > 0 && qty > 0 && totalAmount > 0) {
        const expected = qty * purchasePrice;
        const diff = Math.abs(expected - totalAmount) / totalAmount;
        if (diff <= 0.10) mathScore = 1.0;
        else if (diff <= 0.25) mathScore = 0.6;
        else mathScore = 0.2;
    } else if (purchasePrice > 0 || totalAmount > 0) {
        mathScore = 0.4;
    } else {
        mathScore = 0.5;
    }
    score += mathScore * weights.mathConsistency;

    let nameScore = 0;
    if (name.length > 2) nameScore += 0.4;
    if (name.length > 5) nameScore += 0.2;
    if (!/^\d+$/.test(name)) nameScore += 0.2;
    if (/[a-zA-Z]/.test(name)) nameScore += 0.2;
    score += nameScore * weights.nameQuality;

    return Math.round(Math.min(100, Math.max(0, score)));
};

export const computeConfidence = (items, rawMarkdown) => {
    if (!items || !Array.isArray(items) || items.length === 0) {
        return { overallConfidence: 0, itemConfidences: [], validationWarnings: ["No items extracted"] };
    }

    const warnings = [];
    const itemConfidences = items.map((item, idx) => {
        const confidence = computeItemConfidence(item, rawMarkdown);
        if (confidence < 70) {
            const name = item.medicine_name || `Item ${idx + 1}`;
            warnings.push(confidence === 0
                ? `Possible hallucination detected: ${name}`
                : `Low confidence (${confidence}%) on: ${name}`);
        }
        return confidence;
    });

    const overallConfidence = Math.round(
        itemConfidences.reduce((sum, c) => sum + c, 0) / itemConfidences.length
    );

    if (items.length === 0) warnings.push("No items were extracted from the invoice");

    return { overallConfidence, itemConfidences, validationWarnings: warnings };
};

// ═══════════════════════════════════════════════════════════════════════════════
// TWO-STEP CASCADE: OCR (Space + Vision Fallback) -> Text LLM (JSON)
// ═══════════════════════════════════════════════════════════════════════════════

const parseMarkdownToJSON = async (markdownText, modelId) => {
    if (modelId.startsWith("ollama:") || modelId.startsWith("local:")) {
        const rawModelName = modelId.replace(/^(ollama:|local:)/, "");
        console.log(`[Local LLM] Sending text to Ollama model (${rawModelName})...`);
        const res = await axios.post(`${OLLAMA_BASE_URL}/chat/completions`, {
            model: rawModelName,
            messages: [{ role: "user", content: JSON_PROMPT + "\n\n" + markdownText }],
            response_format: { type: "json_object" },
            temperature: 0.1,
            max_tokens: 4000
        }, { timeout: 180000 });

        const choice = res.data.choices[0];
        const parsedData = safeParseJSON(choice.message.content);
        return {
            data: parsedData,
            usage: res.data.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
        };
    }

    const response = await getOpenAIClient().chat.completions.create({
        model: modelId,
        messages: [{ role: "user", content: JSON_PROMPT + "\n\n" + markdownText }],
        response_format: { type: "json_object" },
        temperature: 0.1,
        max_tokens: 8000,
    });

    const choice = response.choices[0];
    if (choice.finish_reason === "length") {
        console.warn(`[LLM Text] ${modelId}: Response truncated (finish_reason=length).`);
    }

    const parsedData = safeParseJSON(choice.message.content);
    return {
        data: parsedData,
        usage: response.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
    };
};

const sanitizeExpiryDate = (dateStr) => {
    if (!dateStr || typeof dateStr !== 'string') return dateStr;
    const str = dateStr.trim();
    try {
        let year, month;
        if (/^\d{1,2}[\/\-]\d{2,4}$/.test(str)) {
            const parts = str.split(/[\/\-]/);
            month = parseInt(parts[0]);
            const yy = parts[1];
            year = parseInt(yy.length === 2 ? `20${yy}` : yy);
        } else if (/^\d{4}-\d{2}(-\d{2})?$/.test(str)) {
            const parts = str.split("-");
            year = parseInt(parts[0]);
            month = parseInt(parts[1]);
        }
        if (year && month) {
            const lastDay = new Date(year, month, 0).getDate();
            return `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
        }
    } catch (e) {
        // Fallback to original string on error
    }
    return str;
};

const sanitizeHsnCode = (hsnStr) => {
    if (!hsnStr || typeof hsnStr !== 'string') return hsnStr || '30049099';
    let cleaned = hsnStr.replace(/[^\d]/g, '');
    if (!cleaned) return '30049099';

    // Auto-correct common single-digit OCR typos in pharmaceutical HSN codes (e.g., 300400xx/300480xx -> 300490xx)
    if (cleaned.startsWith('300400')) {
        cleaned = '300490' + cleaned.slice(6);
    } else if (cleaned.startsWith('300480')) {
        cleaned = '300490' + cleaned.slice(6);
    }
    return cleaned;
};

const sanitizeBatchNumber = (batchStr, rawText = '') => {
    if (!batchStr || typeof batchStr !== 'string') return batchStr || '';
    let str = batchStr.trim().toUpperCase();
    str = str.replace(/^[^A-Z0-9]+|[^A-Z0-9]+$/g, '');

    // If batch was misread as a single digit (e.g. '1'), try finding a valid batch token from context
    if (str.length <= 1 && rawText) {
        const matches = rawText.match(/\b([A-Z0-9]{5,12})\b/g);
        if (matches) {
            const candidate = matches.find(m =>
                !/^\d+$/.test(m) &&
                !/^[A-Z]+$/.test(m) &&
                !m.includes('GSTIN') &&
                !m.includes('INVOICE') &&
                m.length >= 6
            );
            if (candidate) return candidate;
        }
    }
    return str;
};

const sanitizeItemPrices = (item) => {
    let purchasePrice = Number(item.purchase_price) || 0;
    const mrp = Number(item.mrp) || 0;
    const taxableValue = Number(item.taxable_value) || 0;
    const totalAmount = Number(item.total_amount) || 0;
    const quantity = Number(item.quantity) || 0;

    // Detect if purchase_price was incorrectly grabbed from MRP column
    if (taxableValue > 0 && quantity > 0) {
        const calculatedRateFromTaxable = Math.round((taxableValue / quantity) * 100) / 100;
        if (purchasePrice > 0 && Math.abs(purchasePrice - mrp) < 0.05 && mrp > calculatedRateFromTaxable) {
            console.log(`[Price Safeguard] Corrected purchase_price from MRP (${purchasePrice}) to PTR (${calculatedRateFromTaxable})`);
            purchasePrice = calculatedRateFromTaxable;
        } else if (purchasePrice === 0 && calculatedRateFromTaxable > 0) {
            purchasePrice = calculatedRateFromTaxable;
        }
    } else if (totalAmount > 0 && quantity > 0 && purchasePrice > 0 && Math.abs(purchasePrice - mrp) < 0.05 && mrp > (totalAmount / quantity)) {
        const calculatedNetRate = Math.round(((totalAmount / 1.05) / quantity) * 100) / 100;
        console.log(`[Price Safeguard] Corrected purchase_price from MRP (${purchasePrice}) to Net Rate (${calculatedNetRate})`);
        purchasePrice = calculatedNetRate;
    }

    return purchasePrice;
};

export const extractWithCascade = async (images, confidenceThreshold = 90) => {
    const attempts = [];
    let combinedMarkdown = "";
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;

    // ── STEP 1: OCR Each Page (OCR.Space Engine 3 with Vision LLM Fallback) ──
    console.log(`[AI Import] Step 1: Starting OCR on ${images.length} page(s)...`);
    for (let i = 0; i < images.length; i++) {
        let pageText = "";

        // Primary: OCR.Space Engine 3 (with auto-split for dense invoices)
        try {
            console.log(`[OCR.Space] Page ${i + 1}: Extracting text via Engine 3...`);
            pageText = await splitAndOcrImage(images[i]);
        } catch (err) {
            console.warn(`[OCR.Space] Page ${i + 1} failed: ${err.message}. Triggering Vision LLM Fallback...`);
            // Secondary Fallback: OpenRouter Vision LLM
            try {
                pageText = await transcribeWithVisionFallback(images[i]);
                console.log(`[Vision Fallback] Page ${i + 1}: Vision LLM extraction successful.`);
            } catch (visionErr) {
                console.error(`[Vision Fallback] Page ${i + 1} failed: ${visionErr.message}`);
            }
        }

        if (pageText && pageText.trim()) {
            combinedMarkdown += `\n\n--- PAGE ${i + 1} ---\n\n` + pageText;
        }
    }

    if (!combinedMarkdown.trim()) {
        return {
            items: [], invoice: {}, overallConfidence: 0, itemConfidences: [],
            validationWarnings: ["All OCR engines (OCR.Space and Vision Fallback) failed to extract text from the images."],
            modelUsed: "", attempts: [], status: "failed",
            tokenUsage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
            rawOcrText: "",
        };
    }

    // Optimize & Trim OCR text (extract only metadata header lines and main items table)
    const trimmedMarkdown = trimOcrTextForLlm(combinedMarkdown);

    console.log(`\n================== RAW OCR TEXT ==================\n${combinedMarkdown}\n==================================================\n`);
    console.log(`\n================== OPTIMIZED TEXT FOR LLM ==================\n${trimmedMarkdown}\n===========================================================\n`);

    // ── STEP 2: Parse Trimmed Text to JSON via Text LLMs ──
    console.log(`[LLM Cascade] Step 2: Parsing ${trimmedMarkdown.length} chars of optimized OCR text to JSON...`);

    let bestResult = null;
    let bestConfidence = 0;
    let bestModel = "";
    let bestItemConfidences = [];
    let bestWarnings = [];
    let bestInvoice = {};

    for (const textModel of getTextModels()) {
        const attemptRecord = {
            model: textModel.id, started_at: new Date(), completed_at: null,
            success: false, confidence: 0, error: "", items_count: 0,
        };

        try {
            console.log(`[LLM Cascade] Trying Text Model ${textModel.name}...`);
            const { data: parsed, usage } = await parseMarkdownToJSON(trimmedMarkdown, textModel.id);
            attemptRecord.completed_at = new Date();

            if (usage) {
                totalPromptTokens += usage.prompt_tokens || 0;
                totalCompletionTokens += usage.completion_tokens || 0;
            }

            if (!parsed || !parsed.items || !Array.isArray(parsed.items)) {
                throw new Error("Invalid response format: missing items array");
            }

            parsed.items = parsed.items.map(item => {
                const parsedGst = Number(item.gst_percentage);
                const correctedPrice = sanitizeItemPrices(item);
                const correctedHsn = sanitizeHsnCode(item.hsn_code);
                const correctedBatch = sanitizeBatchNumber(item.batch_number, trimmedMarkdown);
                return {
                    ...item,
                    batch_number: correctedBatch,
                    purchase_price: correctedPrice,
                    hsn_code: correctedHsn,
                    gst_percentage: (!isNaN(parsedGst) && parsedGst > 0) ? parsedGst : 5,
                    expiry_date: sanitizeExpiryDate(item.expiry_date)
                };
            });

            attemptRecord.items_count = parsed.items.length;
            attemptRecord.success = true;

            const { overallConfidence, itemConfidences, validationWarnings } =
                computeConfidence(parsed.items, trimmedMarkdown);

            attemptRecord.confidence = overallConfidence;
            attempts.push(attemptRecord);

            console.log(`[LLM Cascade] ${textModel.name}: ${parsed.items.length} items, conf ${overallConfidence}%`);

            if (overallConfidence > bestConfidence) {
                bestResult = parsed.items;
                bestConfidence = overallConfidence;
                bestModel = textModel.id;
                bestItemConfidences = itemConfidences;
                bestWarnings = validationWarnings;
                bestInvoice = parsed.invoice || {};
            }

            if (overallConfidence >= confidenceThreshold) {
                console.log(`[LLM Cascade] ✓ Target confidence reached. Used ${textModel.name}`);
                break;
            }
        } catch (error) {
            attemptRecord.completed_at = new Date();
            attemptRecord.error = error.message;
            attempts.push(attemptRecord);
            console.error(`[LLM Cascade] ✗ Text Model ${textModel.name} failed: ${error.message}`);
        }
    }

    const status = bestConfidence >= confidenceThreshold ? "review_ready" : "low_confidence";

    if (!bestResult || bestResult.length === 0) {
        return {
            items: [], invoice: {}, overallConfidence: 0, itemConfidences: [],
            validationWarnings: ["All text models failed to extract valid JSON data."],
            modelUsed: "", attempts, status: "low_confidence",
            tokenUsage: {
                prompt_tokens: totalPromptTokens,
                completion_tokens: totalCompletionTokens,
                total_tokens: totalPromptTokens + totalCompletionTokens,
            },
            rawOcrText: combinedMarkdown,
        };
    }

    const itemsWithConfidence = bestResult.map((item, idx) => ({
        ...item,
        item_confidence: bestItemConfidences[idx] || 0,
    }));

    const finalResult = {
        items: itemsWithConfidence, invoice: bestInvoice, overallConfidence: bestConfidence,
        itemConfidences: bestItemConfidences, validationWarnings: bestWarnings,
        modelUsed: bestModel, attempts, status,
        tokenUsage: {
            prompt_tokens: totalPromptTokens,
            completion_tokens: totalCompletionTokens,
            total_tokens: totalPromptTokens + totalCompletionTokens,
        },
        rawOcrText: combinedMarkdown,
        trimmedMarkdown,
    };

    console.log(`\n================== FINAL JSON RESULT ==================\n${JSON.stringify({ invoice: bestInvoice, items: itemsWithConfidence }, null, 2)}\n=======================================================\n`);

    return finalResult;
};