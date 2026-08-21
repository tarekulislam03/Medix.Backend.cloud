/**
 * Smart Multiline Deterministic Parser & Accuracy Benchmarking System
 * Zero-LLM, Zero-API execution: 100% Logic & Math calculations.
 */

const rawOcrText = `| S. | Description of Goods | Han / Sac | Qty | Unit | Batch | MKT | Exp | Old Mrp | Rate | Disc % | Taxable | SGST % | CGST % | SGST AMT | Amount |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | CETAPHIL GENTLE SKIN CLEANSER | 33049530 | 1 | PACK | 1280 | GAL | 11/28 | 0.00 | 311.16 | 6.00 | 292.52 | 9.00 | 2.50 | 345.16 |
|  | 118 ML |  |  |  |  |  |  | 450.00 |  |  |  |  |  |  |
| 2 | CLORITAP CV 40 TABLET (10 TAB) | 30049099 | 1 | STRIP | 00302ERT | LUP | 03/28 | 0.00 | 204.85 | 6.00 | 192.59 | 2.50 | 2.50 | 202.21 |
|  |  |  |  |  |  |  |  | 204.85 |  |  |  |  |  |  |
| 3 | GABAPIN NT TABLET (15 TAB) | 30049081 | 1 | STRIP | N2610550 | INT | 03/29 | 0.00 | 392.86 | 6.00 | 369.20 | 2.50 | 2.50 | 387.75 |
|  |  |  |  |  |  |  |  | 515.63 |  |  |  |  |  |  |
| 4 | LIPICARD 150 MG TABLET (10 TAB) | 30049089 | 1 | STRIP | 26027010 | USV | 01/28 | 0.00 | 237.67 | 6.00 | 159.72 | 2.50 | 2.50 | 167.70 |
|  |  |  |  |  |  |  |  | 223.00 |  |  |  |  |  |  |
| 5 | REVITAL CAL 500 15 TABLETS | 30045090 | 1 | PACK | FHD018 | SUN | 04/28 | 0.00 | 141.87 | 6.00 | 95.26 | 2.50 | 2.50 | 100.02 |
|  |  |  |  |  |  |  |  | 133.00 |  |  |  |  |  |  |
| 6 | COD CHARGES | 997158 |  | OTH | 1 |  |  |  |  |  |  |  | 4.89 | 18.00 | 5.77 |
| 7 | PLATFORM FEES | 997799 |  | OTH | 1 |  |  |  |  |  |  |  | 2.71 | 18.00 | 3.19 |
|  | Total | 5 |  |  |  |  |  |  |  |  |  |  |  |  |`;

// Ground Truth Data for Bill 1
const groundTruthBill1 = [
  {
    medicine_name: "CETAPHIL GENTLE SKIN CLEANSER 118 ML",
    mrp: 450.00,
    quantity: 1,
    batch_number: "1280",
    expiry_date: "2028-11",
    hsn_code: "33049530",
    rate: 311.16,
    discount: 6.00
  },
  {
    medicine_name: "CLORITAP CV 40 TABLET (10 TAB)",
    mrp: 204.85,
    quantity: 1,
    batch_number: "00302ERT",
    expiry_date: "2028-03",
    hsn_code: "30049099",
    rate: 204.85,
    discount: 6.00
  },
  {
    medicine_name: "GABAPIN NT TABLET (15 TAB)",
    mrp: 515.63,
    quantity: 1,
    batch_number: "N2610550",
    expiry_date: "2029-03",
    hsn_code: "30049081",
    rate: 392.86,
    discount: 6.00
  },
  {
    medicine_name: "LIPICARD 150 MG TABLET (10 TAB)",
    mrp: 223.00,
    quantity: 1,
    batch_number: "26027010",
    expiry_date: "2028-01",
    hsn_code: "30049089",
    rate: 237.67,
    discount: 6.00
  },
  {
    medicine_name: "REVITAL CAL 500 15 TABLETS",
    mrp: 133.00,
    quantity: 1,
    batch_number: "FHD018",
    expiry_date: "2028-04",
    hsn_code: "30045090",
    rate: 141.87,
    discount: 6.00
  }
];

// ── UTILS ───────────────────────────────────────────────────────────────────

function parseNumber(val) {
  if (!val) return 0;
  const num = parseFloat(String(val).replace(/[^0-9\.]/g, ""));
  return isNaN(num) ? 0 : num;
}

function formatExpiryDate(rawExp) {
  if (!rawExp || typeof rawExp !== "string") return null;
  const match = rawExp.trim().match(/^(\d{1,2})[\/\:](\d{2,4})$/);
  if (!match) return rawExp;
  
  let month = parseInt(match[1], 10);
  let year = parseInt(match[2], 10);
  if (year < 100) year += 2000;
  return `${year}-${String(month).padStart(2, "0")}`;
}

function calculateStringSimilarity(str1 = '', str2 = '') {
  const s1 = String(str1).toLowerCase().trim();
  const s2 = String(str2).toLowerCase().trim();
  if (!s1 && !s2) return 100;
  if (!s1 || !s2) return 0;
  if (s1 === s2) return 100;
  if (s1.includes(s2) || s2.includes(s1)) return 90;

  const words1 = s1.split(/\s+/);
  const words2 = s2.split(/\s+/);
  const matches = words1.filter((w) => words2.includes(w)).length;
  return Math.round((matches / Math.max(words1.length, words2.length)) * 100);
}

// ── SMART MULTILINE DETERMINISTIC PARSER ────────────────────────────────────

function parseTableDeterminstically(tableText) {
  const lines = tableText.split("\n").map(l => l.trim()).filter(l => l.startsWith("|"));
  const items = [];
  let currentItem = null;

  lines.forEach((line) => {
    const lower = line.toLowerCase();
    if (lower.includes("description") || lower.includes(":---") || lower.includes("total") || lower.includes("cod charges") || lower.includes("platform fees")) {
      return;
    }

    const cols = line.split("|").map(c => c.trim()).slice(1, -1);
    if (cols.length < 5) return;

    const indexCol = cols[0];
    const isNewItem = /^\d+$/.test(indexCol);

    if (isNewItem) {
      if (currentItem) items.push(currentItem);

      const medicine_name = cols[1] || "";
      const hsn_code = cols[2] || "";
      const quantity = parseInt(cols[3], 10) || 1;
      const unit = cols[4] || "PACK";
      const batch_number = cols[5] || "";
      const mkt = cols[6] || "";
      const expiry_date = formatExpiryDate(cols[7]);
      const old_mrp = parseNumber(cols[8]);
      const rate = parseNumber(cols[9]);
      const discount = parseNumber(cols[10]);
      const taxable = parseNumber(cols[11]);
      const total_amount = parseNumber(cols[cols.length - 1]);

      currentItem = {
        item_index: parseInt(indexCol, 10),
        medicine_name,
        hsn_code,
        quantity,
        unit,
        batch_number,
        mkt,
        expiry_date,
        mrp: old_mrp > 0 ? old_mrp : rate,
        rate,
        discount,
        taxable,
        total_amount
      };
    } else if (currentItem) {
      // Multiline sub-row (e.g. "118 ML" or secondary MRP value)
      const subName = cols[1] || "";
      if (subName && !subName.toLowerCase().includes("total")) {
        currentItem.medicine_name += " " + subName;
      }

      // Check numeric columns in sub-row for MRP
      cols.slice(2).forEach(c => {
        const val = parseNumber(c);
        if (val > 0 && (currentItem.mrp === 0 || currentItem.mrp === currentItem.rate)) {
          currentItem.mrp = val;
        }
      });
    }
  });

  if (currentItem) items.push(currentItem);

  return items;
}

// ── ACCURACY REPORT EVALUATOR ──────────────────────────────────────────────

function generateAccuracyReport(extracted, groundTruth) {
  console.log("=================================================================");
  console.log("   DETERMINISTIC EXTRACTION ACCURACY REPORT (100% LOGIC & MATH)  ");
  console.log("=================================================================\n");

  let totalNameScore = 0;
  let totalBatchScore = 0;
  let totalPriceScore = 0;
  let totalHsnScore = 0;
  let totalQtyScore = 0;
  let totalMrpScore = 0;

  console.log("ITEM-BY-ITEM COMPARISON:");
  console.log("-----------------------------------------------------------------");

  groundTruth.forEach((truth, idx) => {
    const ext = extracted[idx] || {};

    const nameScore = calculateStringSimilarity(ext.medicine_name, truth.medicine_name);
    const batchScore = calculateStringSimilarity(ext.batch_number, truth.batch_number);
    const hsnScore = calculateStringSimilarity(ext.hsn_code, truth.hsn_code);
    const qtyScore = Number(ext.quantity) === Number(truth.quantity) ? 100 : 0;
    const priceScore = Math.abs(Number(ext.rate) - Number(truth.rate)) < 0.5 ? 100 : 0;
    const mrpScore = Math.abs(Number(ext.mrp) - Number(truth.mrp)) < 0.5 ? 100 : 0;

    totalNameScore += nameScore;
    totalBatchScore += batchScore;
    totalHsnScore += hsnScore;
    totalQtyScore += qtyScore;
    totalPriceScore += priceScore;
    totalMrpScore += mrpScore;

    const itemAvg = Math.round((nameScore * 0.3) + (batchScore * 0.2) + (priceScore * 0.2) + (hsnScore * 0.15) + (qtyScore * 0.15));

    console.log(`[Item ${idx + 1}] ${truth.medicine_name}`);
    console.log(`  - Extracted Name : "${ext.medicine_name || 'N/A'}" (${nameScore}%)`);
    console.log(`  - Batch Number   : Extracted="${ext.batch_number}" vs Truth="${truth.batch_number}" (${batchScore}%)`);
    console.log(`  - HSN Code       : Extracted="${ext.hsn_code}" vs Truth="${truth.hsn_code}" (${hsnScore}%)`);
    console.log(`  - Rate (Price)   : Extracted=${ext.rate} vs Truth=${truth.rate} (${priceScore}%)`);
    console.log(`  - MRP Value      : Extracted=${ext.mrp} vs Truth=${truth.mrp} (${mrpScore}%)`);
    console.log(`  - Quantity       : Extracted=${ext.quantity} vs Truth=${truth.quantity} (${qtyScore}%)`);
    console.log(`  -> Item Score    : ${itemAvg}%\n`);
  });

  const count = groundTruth.length;
  const avgName = Math.round(totalNameScore / count);
  const avgBatch = Math.round(totalBatchScore / count);
  const avgHsn = Math.round(totalHsnScore / count);
  const avgQty = Math.round(totalQtyScore / count);
  const avgPrice = Math.round(totalPriceScore / count);
  const avgMrp = Math.round(totalMrpScore / count);

  const overallAccuracy = Math.round((avgName * 0.3) + (avgBatch * 0.2) + (avgPrice * 0.2) + (avgHsn * 0.15) + (avgQty * 0.15));

  console.log("=================================================================");
  console.log("                FINAL FIELD ACCURACY SUMMARY                     ");
  console.log("=================================================================");
  console.log(`Medicine Name Accuracy : ${avgName}%`);
  console.log(`Batch Number Accuracy  : ${avgBatch}%`);
  console.log(`Purchase Rate Accuracy : ${avgPrice}%`);
  console.log(`MRP Value Accuracy     : ${avgMrp}%`);
  console.log(`HSN Code Accuracy      : ${avgHsn}%`);
  console.log(`Quantity Accuracy      : ${avgQty}%`);
  console.log("-----------------------------------------------------------------");
  console.log(`OVERALL PIPELINE ACCURACY : ${overallAccuracy}%`);
  console.log("=================================================================\n");
}

// ── EXECUTE ────────────────────────────────────────────────────────────────

console.log("================== OCR.SPACE RAW RESPONSE ==================");
console.log(rawOcrText);
console.log("============================================================\n");

const startTime = Date.now();
const extractedItems = parseTableDeterminstically(rawOcrText);
const elapsedMs = Date.now() - startTime;

console.log(`Parsed ${extractedItems.length} multiline items in ${elapsedMs} ms (0.00 seconds).\n`);
generateAccuracyReport(extractedItems, groundTruthBill1);
