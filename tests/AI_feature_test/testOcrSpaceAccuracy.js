import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import { splitAndOcrImage } from '../../src/core/services/llmService.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BILL_IMAGES_DIR = path.join(__dirname, 'bill_images');
const GROUND_TRUTH_PATH = path.join(__dirname, 'ground_truth', 'ocr_ground_truth.json');
const RESULTS_DIR = path.join(__dirname, 'results');

// ── UTILITY FUNCTIONS ───────────────────────────────────────────────────────

/**
 * Normalize a string for comparison: lowercase, collapse whitespace, strip special chars
 */
function normalize(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s.\/\-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Check if a value appears anywhere in the OCR text (fuzzy substring match)
 */
function valueFoundInText(value, ocrText) {
  if (!value || !ocrText) return false;
  const normVal = normalize(value);
  const normText = normalize(ocrText);
  if (!normVal) return false;

  // For short numeric values (qty like "1", "2"), use word-boundary matching
  if (normVal.length < 2 && /^\d+$/.test(normVal)) {
    const regex = new RegExp(`(?:^|\\s|\\|)${normVal}(?:\\s|\\||$)`);
    return regex.test(normText);
  }
  if (!normVal || normVal.length < 2) return false;

  // Exact substring match
  if (normText.includes(normVal)) return true;

  // Try word-by-word match for multi-word values (e.g. medicine names)
  const words = normVal.split(/\s+/).filter(w => w.length > 2);
  if (words.length > 1) {
    const matchedWords = words.filter(w => normText.includes(w));
    return matchedWords.length / words.length >= 0.7; // 70% word match threshold
  }

  return false;
}

/**
 * Calculate Levenshtein distance between two strings
 */
function levenshteinDistance(a, b) {
  const matrix = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b[i - 1] === a[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

/**
 * String similarity as percentage (0-100) using Levenshtein
 */
function stringSimilarity(str1, str2) {
  const s1 = normalize(str1);
  const s2 = normalize(str2);
  if (!s1 && !s2) return 100;
  if (!s1 || !s2) return 0;
  if (s1 === s2) return 100;

  const maxLen = Math.max(s1.length, s2.length);
  if (maxLen === 0) return 100;

  const dist = levenshteinDistance(s1, s2);
  return Math.round((1 - dist / maxLen) * 100);
}

// ── FIELD-LEVEL ACCURACY CHECKERS ───────────────────────────────────────────

/**
 * Check individual fields of each item against ground truth
 */
function checkItemFieldAccuracy(ocrText, groundTruthItems) {
  const results = [];

  for (const item of groundTruthItems) {
    const itemResult = {
      description: item.description,
      fields: {}
    };

    // Fields to check presence in OCR raw text (ignoring header, mrp, taxable_value, disc_pct, rate, hsn_code, mkt)
    const fieldsToCheck = {
      medicine_name: item.description,
      batch_number: item.batch,
      qty: String(item.qty),
      amount: item.amount,
      exp_dt: item.exp_dt,
      unit: item.unit
    };

    for (const [fieldName, expectedValue] of Object.entries(fieldsToCheck)) {
      const found = valueFoundInText(expectedValue, ocrText);
      itemResult.fields[fieldName] = {
        expected: expectedValue,
        found
      };
    }

    results.push(itemResult);
  }

  return results;
}

/**
 * Check invoice-level header fields
 */
function checkHeaderFieldAccuracy(ocrText, groundTruth) {
  const headerFields = {
    supplier_name: groundTruth.supplier_name,
    invoice_number: groundTruth.invoice_number,
    party_name: groundTruth.party_name,
    supplier_gstin: groundTruth.supplier_gstin,
    subtotal: groundTruth.subtotal,
    inv_total: groundTruth.inv_total,
    amount_payable: groundTruth.amount_payable,
    cgst_amount: groundTruth.cgst_amount,
    sgst_amount: groundTruth.sgst_amount
  };

  // Only include party_gstin if it exists (some bills don't have it)
  if (groundTruth.party_gstin) {
    headerFields.party_gstin = groundTruth.party_gstin;
  }

  const results = {};
  for (const [fieldName, expectedValue] of Object.entries(headerFields)) {
    if (!expectedValue) continue;
    results[fieldName] = {
      expected: expectedValue,
      found: valueFoundInText(expectedValue, ocrText)
    };
  }

  return results;
}

// ── SCORING ─────────────────────────────────────────────────────────────────

function calculateScores(headerResults, itemResults) {
  // Header accuracy
  const headerEntries = Object.values(headerResults);
  const headerHits = headerEntries.filter(f => f.found).length;
  const headerTotal = headerEntries.length;
  const headerAccuracy = headerTotal > 0 ? Math.round((headerHits / headerTotal) * 100) : 0;

  // Item-level accuracy by field type
  const fieldTotals = {};
  const fieldHits = {};
  let totalItemFieldHits = 0;
  let totalItemFieldChecks = 0;

  for (const item of itemResults) {
    for (const [fieldName, result] of Object.entries(item.fields)) {
      if (!fieldTotals[fieldName]) {
        fieldTotals[fieldName] = 0;
        fieldHits[fieldName] = 0;
      }
      fieldTotals[fieldName]++;
      totalItemFieldChecks++;
      if (result.found) {
        fieldHits[fieldName]++;
        totalItemFieldHits++;
      }
    }
  }

  const fieldAccuracies = {};
  for (const field of Object.keys(fieldTotals)) {
    fieldAccuracies[field] = Math.round((fieldHits[field] / fieldTotals[field]) * 100);
  }

  const itemAccuracy = totalItemFieldChecks > 0
    ? Math.round((totalItemFieldHits / totalItemFieldChecks) * 100)
    : 0;

  // Overall accuracy based purely on Item fields (header ignored as requested)
  const overallAccuracy = itemAccuracy;

  return {
    headerAccuracy,
    headerHits,
    headerTotal,
    itemAccuracy,
    totalItemFieldHits,
    totalItemFieldChecks,
    fieldAccuracies,
    overallAccuracy
  };
}

// ── MAIN TEST ───────────────────────────────────────────────────────────────

async function testOcrSpaceAccuracy() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('       OCR.SPACE RAW TEXT ACCURACY BENCHMARK');
  console.log('       Comparing OCR.Space Engine 3 output vs Ground Truth');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Load ground truth
  if (!fs.existsSync(GROUND_TRUTH_PATH)) {
    console.error(`[ERROR] Ground truth file not found: ${GROUND_TRUTH_PATH}`);
    process.exit(1);
  }
  const groundTruth = JSON.parse(fs.readFileSync(GROUND_TRUTH_PATH, 'utf8'));

  // Ensure results dir exists
  if (!fs.existsSync(RESULTS_DIR)) fs.mkdirSync(RESULTS_DIR, { recursive: true });

  // Get image files
  const imageFiles = fs.readdirSync(BILL_IMAGES_DIR).filter(f =>
    /\.(png|jpe?g|heic|heif|webp)$/i.test(f)
  );

  if (imageFiles.length === 0) {
    console.error(`[ERROR] No images found in ${BILL_IMAGES_DIR}`);
    process.exit(1);
  }

  const allResults = [];

  for (let i = 0; i < imageFiles.length; i++) {
    const fileName = imageFiles[i];
    const imagePath = path.join(BILL_IMAGES_DIR, fileName);

    console.log(`───────────────────────────────────────────────────────────────`);
    console.log(`[${i + 1}/${imageFiles.length}] Processing: ${fileName}`);
    console.log(`───────────────────────────────────────────────────────────────`);

    // Get ground truth for this image
    const gt = groundTruth[fileName];
    if (!gt) {
      console.warn(`  ⚠ No ground truth found for ${fileName}, skipping.\n`);
      continue;
    }

    try {
      // Read image and preprocess with Sharp (same as production pipeline)
      const fileBuffer = fs.readFileSync(imagePath);
      let processedBuffer = await sharp(fileBuffer)
        .rotate()
        .grayscale()
        .normalize()
        .sharpen({ sigma: 1.2 })
        .resize({ width: 3000, withoutEnlargement: true })
        .jpeg({ quality: 85, mozjpeg: true })
        .toBuffer();

      console.log(`  → Preprocessed: ${(fileBuffer.length / 1024).toFixed(0)}KB → ${(processedBuffer.length / 1024).toFixed(0)}KB`);

      const base64Image = processedBuffer.toString('base64');
      const imagePayload = { base64: base64Image, mimeType: 'image/jpeg' };

      console.log(`  → Sending to OCR.Space Engine 3 (with auto-split)...`);
      const startTime = Date.now();
      const rawOcrText = await splitAndOcrImage(imagePayload);
      const elapsedMs = Date.now() - startTime;

      console.log(`  → OCR completed in ${(elapsedMs / 1000).toFixed(2)}s (${rawOcrText.length} chars)\n`);

      // Save raw OCR output for inspection
      fs.writeFileSync(
        path.join(RESULTS_DIR, `ocr_raw_${path.basename(fileName, path.extname(fileName))}.txt`),
        rawOcrText, 'utf8'
      );

      // Run accuracy checks
      const headerResults = checkHeaderFieldAccuracy(rawOcrText, gt);
      const itemResults = checkItemFieldAccuracy(rawOcrText, gt.items);
      const scores = calculateScores(headerResults, itemResults);

      // ── Print Header Results ──
      console.log(`  📋 HEADER FIELDS (${scores.headerHits}/${scores.headerTotal} = ${scores.headerAccuracy}%)`);
      for (const [field, result] of Object.entries(headerResults)) {
        const icon = result.found ? '✅' : '❌';
        console.log(`     ${icon} ${field}: "${result.expected}"`);
      }

      // ── Print Item Results ──
      console.log(`\n  📦 ITEM FIELDS (${scores.totalItemFieldHits}/${scores.totalItemFieldChecks} = ${scores.itemAccuracy}%)`);
      for (const item of itemResults) {
        const itemFields = Object.entries(item.fields);
        const itemHits = itemFields.filter(([_, r]) => r.found).length;
        const itemTotal = itemFields.length;
        const itemPct = Math.round((itemHits / itemTotal) * 100);

        console.log(`\n     🔹 ${item.description} (${itemHits}/${itemTotal} = ${itemPct}%)`);
        for (const [field, result] of itemFields) {
          const icon = result.found ? '✅' : '❌';
          console.log(`        ${icon} ${field}: "${result.expected}"`);
        }
      }

      // ── Print Field-Type Accuracy ──
      console.log(`\n  📊 ACCURACY BY FIELD TYPE:`);
      for (const [field, pct] of Object.entries(scores.fieldAccuracies)) {
        const bar = '█'.repeat(Math.round(pct / 5)) + '░'.repeat(20 - Math.round(pct / 5));
        console.log(`     ${field.padEnd(18)} ${bar} ${pct}%`);
      }

      console.log(`\n  🎯 OVERALL ACCURACY: ${scores.overallAccuracy}% (Header ${scores.headerAccuracy}% × 0.3 + Items ${scores.itemAccuracy}% × 0.7)`);

      allResults.push({
        fileName,
        elapsedMs,
        ocrTextLength: rawOcrText.length,
        ...scores
      });

    } catch (err) {
      console.error(`  ❌ ERROR processing ${fileName}: ${err.message}`);
      allResults.push({ fileName, error: err.message });
    }

    // Rate limit delay between images
    if (i < imageFiles.length - 1) {
      console.log(`\n  ⏳ Waiting 6s before next image (rate limit)...\n`);
      await new Promise(r => setTimeout(r, 6000));
    }
  }

  // ── FINAL SUMMARY ──────────────────────────────────────────────────────────

  const successResults = allResults.filter(r => !r.error);

  console.log(`\n\n═══════════════════════════════════════════════════════════════`);
  console.log(`                   FINAL SUMMARY`);
  console.log(`═══════════════════════════════════════════════════════════════`);

  if (successResults.length === 0) {
    console.log(`  All images failed. No accuracy data.\n`);
    return;
  }

  // Per-image summary table
  console.log(`\n  Image              Header%  Items%  Overall%  Time(s)  Chars`);
  console.log(`  ─────              ───────  ──────  ────────  ───────  ─────`);
  for (const r of successResults) {
    console.log(
      `  ${r.fileName.padEnd(20)} ${String(r.headerAccuracy + '%').padEnd(9)}${String(r.itemAccuracy + '%').padEnd(8)}${String(r.overallAccuracy + '%').padEnd(10)}${(r.elapsedMs / 1000).toFixed(2).padEnd(9)}${r.ocrTextLength}`
    );
  }

  // Averages
  const avgHeader = Math.round(successResults.reduce((a, r) => a + r.headerAccuracy, 0) / successResults.length);
  const avgItems = Math.round(successResults.reduce((a, r) => a + r.itemAccuracy, 0) / successResults.length);
  const avgOverall = Math.round(successResults.reduce((a, r) => a + r.overallAccuracy, 0) / successResults.length);
  const avgTime = (successResults.reduce((a, r) => a + r.elapsedMs, 0) / successResults.length / 1000).toFixed(2);

  console.log(`  ─────              ───────  ──────  ────────  ───────  ─────`);
  console.log(`  ${'AVERAGE'.padEnd(20)} ${String(avgHeader + '%').padEnd(9)}${String(avgItems + '%').padEnd(8)}${String(avgOverall + '%').padEnd(10)}${avgTime}`);

  // Aggregate field accuracy across all images
  const aggFieldTotals = {};
  const aggFieldHits = {};
  for (const r of successResults) {
    if (!r.fieldAccuracies) continue;
    for (const [field, pct] of Object.entries(r.fieldAccuracies)) {
      if (!aggFieldTotals[field]) { aggFieldTotals[field] = 0; aggFieldHits[field] = 0; }
      aggFieldTotals[field]++;
      aggFieldHits[field] += pct;
    }
  }

  console.log(`\n  📊 AGGREGATE FIELD ACCURACY (avg across all images):`);
  for (const field of Object.keys(aggFieldTotals)) {
    const avgPct = Math.round(aggFieldHits[field] / aggFieldTotals[field]);
    const bar = '█'.repeat(Math.round(avgPct / 5)) + '░'.repeat(20 - Math.round(avgPct / 5));
    console.log(`     ${field.padEnd(18)} ${bar} ${avgPct}%`);
  }

  console.log(`\n═══════════════════════════════════════════════════════════════\n`);

  // Save full results JSON
  const resultPath = path.join(RESULTS_DIR, 'ocr_accuracy_results.json');
  fs.writeFileSync(resultPath, JSON.stringify(allResults, null, 2), 'utf8');
  console.log(`  📁 Full results saved to: ${resultPath}\n`);
}

testOcrSpaceAccuracy();
