/**
 * Local Offline OCR Test — PaddleOCR (via Python bridge) + Tesseract.js fallback
 */
import { execFile } from 'child_process';
import util from 'util';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const execFilePromise = util.promisify(execFile);
const BILL_1_PATH = path.join(__dirname, 'bill_images', 'bill_1.jpeg');

async function testPaddleOcr() {
  console.log("=================================================================");
  console.log("        LOCAL OFFLINE OCR TEST (PaddleOCR via Python Bridge)     ");
  console.log("=================================================================\n");
  console.log(`Target Image: ${BILL_1_PATH}`);

  if (!fs.existsSync(BILL_1_PATH)) {
    console.error(`Error: Bill image not found at ${BILL_1_PATH}`);
    return;
  }

  const startTime = Date.now();
  const scriptPath = path.join(__dirname, 'paddleOcrBridge.py');

  try {
    console.log("[PaddleOCR] Initializing models & extracting text...\n");
    const { stdout, stderr } = await execFilePromise('python3', [scriptPath, BILL_1_PATH], {
      timeout: 120000 // 2 minute timeout for first-run model download
    });

    const elapsedMs = Date.now() - startTime;
    const res = JSON.parse(stdout);

    if (!res.success) {
      throw new Error(res.error || "PaddleOCR failed");
    }

    console.log(`✓ PaddleOCR Completed in ${(elapsedMs / 1000).toFixed(2)} seconds!`);
    console.log(`  Lines Detected: ${res.lines}`);
    console.log(`  Avg Confidence: ${res.avg_confidence}%\n`);
    console.log("================== PADDLEOCR RAW OUTPUT ==================");
    console.log(res.text);
    console.log("==========================================================\n");

  } catch (err) {
    console.error(`[PaddleOCR Error]: ${err.message}`);
  }
}

testPaddleOcr();
