import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { extractWithCascade } from '../../src/core/services/llmService.js';
import { normalizeImage } from '../../src/core/middleware/imageNormalizationMiddleware.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BILL_IMAGES_DIR = path.join(__dirname, 'bill_images');
const RESULTS_DIR = path.join(__dirname, 'results');
const GROUND_TRUTH_DIR = path.join(__dirname, 'ground_truth');

// Default interval between image processing runs: 2 minutes (120,000 ms)
const TWO_MINUTES_MS = 2 * 60 * 1000;
const intervalMs = process.env.BENCHMARK_INTERVAL_MS 
  ? parseInt(process.env.BENCHMARK_INTERVAL_MS, 10) 
  : (process.argv.includes('--fast') ? 2000 : TWO_MINUTES_MS);

// Ensure directories exist
if (!fs.existsSync(BILL_IMAGES_DIR)) fs.mkdirSync(BILL_IMAGES_DIR, { recursive: true });
if (!fs.existsSync(RESULTS_DIR)) fs.mkdirSync(RESULTS_DIR, { recursive: true });
if (!fs.existsSync(GROUND_TRUTH_DIR)) fs.mkdirSync(GROUND_TRUTH_DIR, { recursive: true });

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Calculates string similarity score between 0 and 100%
 */
function calculateStringSimilarity(str1 = '', str2 = '') {
  const s1 = String(str1).toLowerCase().trim();
  const s2 = String(str2).toLowerCase().trim();
  if (!s1 && !s2) return 100;
  if (!s1 || !s2) return 0;
  if (s1 === s2) return 100;
  if (s1.includes(s2) || s2.includes(s1)) return 80;

  const words1 = s1.split(/\s+/);
  const words2 = s2.split(/\s+/);
  const matches = words1.filter((w) => words2.includes(w)).length;
  return Math.round((matches / Math.max(words1.length, words2.length)) * 100);
}

/**
 * Parses accurate_data.txt format where image filenames precede JSON blocks
 */
function parseAccurateDataTxt(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const content = fs.readFileSync(filePath, 'utf8');
  const result = {};

  const blockRegex = /([a-zA-Z0-9_\-\s]+\.(jpg|jpeg|png|heic|webp))\s*\n(\[\s*\{[\s\S]*?\n\])/gi;
  let match;
  while ((match = blockRegex.exec(content)) !== null) {
    const imageName = match[1].trim();
    const jsonStr = match[3].trim();
    try {
      const parsedArr = JSON.parse(jsonStr);
      const invoiceData = parsedArr[0] || {};
      result[imageName] = invoiceData;
      const baseName = path.basename(imageName, path.extname(imageName));
      result[baseName] = invoiceData;
    } catch (e) {
      console.warn(`[Ground Truth] Error parsing JSON block for ${imageName}: ${e.message}`);
    }
  }
  return result;
}

/**
 * Evaluates OCR and LLM accuracy against optional ground-truth JSON data.
 * If no ground truth exists, uses pipeline structural validation & confidence score.
 */
function evaluateAccuracy(result, groundTruth) {
  let ocrAccuracy = 0;
  let llmAccuracy = result.overallConfidence || 0;
  let fieldBreakdown = { name: 0, batch: 0, price: 0, hsn: 0, qty: 0 };

  // Evaluate OCR Quality
  const rawText = result.rawOcrText || '';
  if (rawText.length > 50) {
    ocrAccuracy += 50; // Has reasonable character length
  }
  if (rawText.includes('|') || rawText.toLowerCase().includes('qty') || rawText.toLowerCase().includes('item')) {
    ocrAccuracy += 50; // Table header structure detected
  }

  // If ground truth JSON is available, compare extracted items vs ground truth
  if (groundTruth && Array.isArray(groundTruth.items) && groundTruth.items.length > 0) {
    const truthItems = groundTruth.items;
    const extractedItems = result.items || [];
    let totalScore = 0;
    let totalName = 0, totalBatch = 0, totalPrice = 0, totalHsn = 0, totalQty = 0;

    truthItems.forEach((truth, idx) => {
      const match = extractedItems[idx] || {};
      const nameScore = calculateStringSimilarity(match.medicine_name, truth.medicine_name);
      const batchScore = calculateStringSimilarity(match.batch_number, truth.batch_number);
      const qtyMatch = Number(match.quantity) === Number(truth.quantity) ? 100 : 0;
      
      const truthRate = Number(truth.rate ?? truth.purchase_price) || 0;
      const matchPrice = Number(match.purchase_price) || 0;
      const priceMatch = (truthRate > 0 && Math.abs(matchPrice - truthRate) < 0.5) ? 100 : (matchPrice === truthRate ? 100 : 0);

      const hsnMatch = calculateStringSimilarity(match.hsn_code, truth.hsn_code);

      totalName += nameScore;
      totalBatch += batchScore;
      totalPrice += priceMatch;
      totalHsn += hsnMatch;
      totalQty += qtyMatch;

      totalScore += (nameScore * 0.35) + (batchScore * 0.20) + (qtyMatch * 0.15) + (priceMatch * 0.20) + (hsnMatch * 0.10);
    });

    const count = truthItems.length;
    llmAccuracy = Math.round(totalScore / count);
    fieldBreakdown = {
      name: Math.round(totalName / count),
      batch: Math.round(totalBatch / count),
      price: Math.round(totalPrice / count),
      hsn: Math.round(totalHsn / count),
      qty: Math.round(totalQty / count)
    };
  }

  return {
    ocrAccuracy: Math.min(100, Math.max(0, ocrAccuracy)),
    llmAccuracy: Math.min(100, Math.max(0, llmAccuracy)),
    fieldBreakdown
  };
}

export async function runAIPipelineBenchmark() {
  console.log('===============================================================');
  console.log('       MEDIX AI IMPORT PIPELINE BENCHMARK & ACCURACY TEST      ');
  console.log('===============================================================');
  console.log(`Image Folder   : ${BILL_IMAGES_DIR}`);
  console.log(`Interval Delay : ${(intervalMs / 1000 / 60).toFixed(2)} minutes (${intervalMs} ms)`);
  console.log('===============================================================\n');

  const imageFiles = fs.readdirSync(BILL_IMAGES_DIR).filter((file) =>
    /\.(png|jpe?g|heic|heif|webp)$/i.test(file)
  );

  if (imageFiles.length === 0) {
    console.warn(`[Benchmark] No images found in ${BILL_IMAGES_DIR}`);
    console.log(`[Benchmark] Please add sample bill images to tests/AI_feature_test/bill_images and run again.`);
    return;
  }

  console.log(`Found ${imageFiles.length} image(s) to benchmark.\n`);

  const metricsHistory = [];

  for (let i = 0; i < imageFiles.length; i++) {
    const fileName = imageFiles[i];
    const imagePath = path.join(BILL_IMAGES_DIR, fileName);

    console.log(`---------------------------------------------------------------`);
    console.log(`[Image ${i + 1}/${imageFiles.length}] Processing: ${fileName}`);
    console.log(`Started at: ${new Date().toISOString()}`);

    const startTime = Date.now();

    try {
      // 1. Read & Normalize Image
      const fileBuffer = fs.readFileSync(imagePath);
      let normalizedBuffer = fileBuffer;
      let mimeType = 'image/jpeg';

      try {
        const reqMock = { file: { buffer: fileBuffer, mimetype: 'image/jpeg', originalname: fileName } };
        await new Promise((resolve) => normalizeImage(reqMock, {}, () => resolve()));
        normalizedBuffer = reqMock.file.buffer;
      } catch (normErr) {
        console.warn(`[Image Normalization] Using original buffer: ${normErr.message}`);
      }

      const base64Image = normalizedBuffer.toString('base64');
      const imagePayload = [{ base64: base64Image, mimeType }];

      // 2. Send to Pipeline
      const result = await extractWithCascade(imagePayload);
      const endTime = Date.now();
      const timeTakenMs = endTime - startTime;

      // 3. Check for optional Ground Truth File (per-image JSON or master_ground_truth.json)
      const baseName = path.basename(fileName, path.extname(fileName));
      const groundTruthPath = path.join(GROUND_TRUTH_DIR, `${baseName}.json`);
      const exactGroundTruthPath = path.join(GROUND_TRUTH_DIR, `${fileName}.json`);
      const masterPath = path.join(GROUND_TRUTH_DIR, 'master_ground_truth.json');
      const accurateTxtPath = path.join(GROUND_TRUTH_DIR, 'accurate_data.txt');

      let groundTruth = null;

      if (fs.existsSync(accurateTxtPath)) {
        try {
          const txtData = parseAccurateDataTxt(accurateTxtPath);
          groundTruth = txtData[fileName] || txtData[baseName] || txtData[`${baseName}.jpg`] || txtData[`${baseName}.jpeg`] || null;
        } catch (txtErr) {
          console.warn(`[Ground Truth] Could not parse accurate_data.txt`);
        }
      }

      if (!groundTruth && fs.existsSync(exactGroundTruthPath)) {
        try {
          groundTruth = JSON.parse(fs.readFileSync(exactGroundTruthPath, 'utf8'));
        } catch (gtErr) {
          console.warn(`[Ground Truth] Could not parse ${fileName}.json`);
        }
      } else if (!groundTruth && fs.existsSync(groundTruthPath)) {
        try {
          groundTruth = JSON.parse(fs.readFileSync(groundTruthPath, 'utf8'));
        } catch (gtErr) {
          console.warn(`[Ground Truth] Could not parse ${baseName}.json`);
        }
      } else if (!groundTruth && fs.existsSync(masterPath)) {
        try {
          const masterData = JSON.parse(fs.readFileSync(masterPath, 'utf8'));
          groundTruth = masterData[fileName] || masterData[baseName] || null;
        } catch (masterErr) {
          console.warn(`[Ground Truth] Could not parse master_ground_truth.json`);
        }
      }

      // 4. Measure Accuracy & Token Usage
      const { ocrAccuracy, llmAccuracy, fieldBreakdown } = evaluateAccuracy(result, groundTruth);
      const tokenUsage = result.tokenUsage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

      const itemMetrics = {
        imageName: fileName,
        timeTakenSeconds: parseFloat((timeTakenMs / 1000).toFixed(2)),
        timeTakenMs,
        ocrAccuracyPercent: ocrAccuracy,
        llmAccuracyPercent: llmAccuracy,
        fieldBreakdown,
        overallConfidence: result.overallConfidence || 0,
        extractedItemsCount: (result.items || []).length,
        promptTokens: tokenUsage.prompt_tokens || 0,
        completionTokens: tokenUsage.completion_tokens || 0,
        totalTokens: tokenUsage.total_tokens || 0,
        modelUsed: result.modelUsed || 'OCR.Space + qwen2.5:3b',
        processedAt: new Date().toISOString(),
      };

      metricsHistory.push(itemMetrics);

      console.log(`[Result] Completed in ${(timeTakenMs / 1000).toFixed(2)}s`);
      console.log(`        - Pipeline Flow: Image -> OCR.Space -> qwen2.5:3b -> accurate_data.txt Matching`);
      console.log(`        - OCR Accuracy : ${ocrAccuracy}%`);
      console.log(`        - LLM Accuracy : ${llmAccuracy}% (Confidence: ${result.overallConfidence}%)`);
      console.log(`        - Field Analysis: Name=${fieldBreakdown.name}%, Batch=${fieldBreakdown.batch}%, Price=${fieldBreakdown.price}%, HSN=${fieldBreakdown.hsn}%, Qty=${fieldBreakdown.qty}%`);
      console.log(`        - Items Count  : ${itemMetrics.extractedItemsCount}`);
      console.log(`        - Tokens Used  : Input=${itemMetrics.promptTokens}, Output=${itemMetrics.completionTokens}, Total=${itemMetrics.totalTokens}`);

    } catch (error) {
      console.error(`[Error] Failed to process ${fileName}: ${error.message}`);
    }

    // 5. Wait interval before sending next image (unless it is the last image)
    if (i < imageFiles.length - 1) {
      console.log(`\nWaiting ${(intervalMs / 1000 / 60).toFixed(2)} minutes before processing next image...\n`);
      await delay(intervalMs);
    }
  }

  // 6. Calculate Average Benchmark Summary
  if (metricsHistory.length > 0) {
    const totalCount = metricsHistory.length;
    const avgTimeSeconds = (metricsHistory.reduce((acc, m) => acc + m.timeTakenSeconds, 0) / totalCount).toFixed(2);
    const avgOcrAccuracy = (metricsHistory.reduce((acc, m) => acc + m.ocrAccuracyPercent, 0) / totalCount).toFixed(1);
    const avgLlmAccuracy = (metricsHistory.reduce((acc, m) => acc + m.llmAccuracyPercent, 0) / totalCount).toFixed(1);
    const avgPromptTokens = Math.round(metricsHistory.reduce((acc, m) => acc + m.promptTokens, 0) / totalCount);
    const avgCompletionTokens = Math.round(metricsHistory.reduce((acc, m) => acc + m.completionTokens, 0) / totalCount);

    const summaryReport = {
      summary: {
        totalImagesProcessed: totalCount,
        averageTimeSeconds: parseFloat(avgTimeSeconds),
        averageOcrAccuracyPercent: parseFloat(avgOcrAccuracy),
        averageLlmAccuracyPercent: parseFloat(avgLlmAccuracy),
        averagePromptTokens: avgPromptTokens,
        averageCompletionTokens: avgCompletionTokens,
        averageTotalTokens: avgPromptTokens + avgCompletionTokens,
        intervalMinutes: parseFloat((intervalMs / 1000 / 60).toFixed(2)),
        benchmarkExecutedAt: new Date().toISOString(),
      },
      detailedResults: metricsHistory,
    };

    const reportPath = path.join(RESULTS_DIR, 'benchmark_report.json');
    fs.writeFileSync(reportPath, JSON.stringify(summaryReport, null, 2));

    console.log('\n===============================================================');
    console.log('                  FINAL BENCHMARK SUMMARY                      ');
    console.log('===============================================================');
    console.log(`Total Images Processed : ${totalCount}`);
    console.log(`Average Processing Time: ${avgTimeSeconds} seconds`);
    console.log(`Average OCR Accuracy   : ${avgOcrAccuracy}%`);
    console.log(`Average LLM Accuracy   : ${avgLlmAccuracy}%`);
    console.log(`Avg Input Tokens (LLM) : ${avgPromptTokens}`);
    console.log(`Avg Output Tokens(LLM) : ${avgCompletionTokens}`);
    console.log(`Report Saved To        : ${reportPath}`);
    console.log('===============================================================\n');
  }
}

// Execute directly if invoked via node
if (process.argv[1] && process.argv[1].endsWith('aiPipelineBenchmark.js')) {
  runAIPipelineBenchmark().catch((err) => console.error('Benchmark error:', err));
}
