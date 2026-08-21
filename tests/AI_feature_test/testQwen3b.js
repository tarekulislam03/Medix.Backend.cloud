import axios from "axios";

const MODEL_NAME = "qwen2.5:3b"; // Change to your preferred Qwen 3B model tag

const JSON_PROMPT = `You are a strict data extraction system.
Map the following raw invoice text into the provided JSON schema.

Column Mapping Hints:
Description of Goods -> medicine_name
Batch -> batch_number
Exp -> expiry_date (convert to YYYY-MM-DD; if only MM/YY, use the last day of that month)
Qty -> quantity
Unit -> unit
Rate / PTR / Trade Price -> purchase_price
Discount % -> discount_percentage
Amount -> total_amount
HSN/SAC -> hsn_code

CRITICAL PRICE RULES:
1. 'Rate', 'PTR', 'P.Rate', 'Trade Price', or 'Unit Rate' is the actual wholesale purchase price per unit -> map strictly to purchase_price.
2. 'MRP' or 'Max Retail Price' is the retail ceiling price -> DO NOT use MRP for purchase_price. Even if MRP is present in the table, purchase_price MUST be taken from the Rate/PTR column, NEVER the MRP column.

BATCH & HSN RULES:
1. Preserve the COMPLETE batch_number including all letters, digits, and suffix characters (e.g. 'B123A', 'AZ-B1', 'PAN-B1'). Do not trim or truncate batch letters or trailing characters.
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
}`;

const rawOcrText = `INVOICE HEADER METADATA:
GSTIN: 19AAHCM0651P120
Inv No: 443TB1472140
Dated: 11-08-2026 10:40 AM
Order No: 22242478837
Party Name: AHAMADULLAH MEDICURE

ITEMS TABLE:
| S. | Description of Goods | Han/Sac | Qty | Unit | Batch | MKT | Exp | Old Mrp | Rate | Disc % | Not Taxable | CGST % | SGST % | Amount |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | CETAPHIL GENTLE SKIN CLEANSER | 33049930 | 1 | PACK | 1 BENA1280 | GAL | 11/26 | 0.00 | 311.10 | 8.00 | 292.52 | 292.52 | 9.00 | 9.00 | 345.16 |
| | 118 ML | | | | | | | 450.00 | | | | | | | |
| 2 | CLOPITAB CV 40 TABLET (10 TAB) | 30040099 | 1 | STRIP | 03302691 | LUP | 03/28 | 0.00 | 204.88 | 6.00 | 152.50 | 152.50 | 2.50 | 2.50 | 202.21 |
| | | | | | | | | 268.00 | | | | | | | |
| 3 | GABAPIN NT TABLET (15 TAB) | 30040081 | 1 | STRIP | N2610980 | INT | 03/29 | 550.01 | 392.30 | 6.00 | 360.20 | 360.20 | 2.50 | 2.50 | 387.75 |
| | | | | | | | | 515.03 | | | | | | | |
| 4 | LIPICARD 180 MG TABLET (10 TAB) | 30049099 | 1 | STRIP | 28027018 | USV | 01/28 | 237.67 | 169.91 | 6.00 | 150.72 | 159.72 | 2.50 | 2.50 | 167.70 |
| | | | | | | | | 223.00 | | | | | | | |
| 5 | REVITAL CAL 500 15 TABLETS | 30045090 | 1 | PACK | 1 FHD0418 | SUN | 04/28 | 141.87 | 101.34 | 6.00 | 95.26 | 95.26 | 2.50 | 2.50 | 100.02 |
| | | | | | | | | 133.00 | | | | | | | |
| | Total: | 5 | | | | | | | | | | | | | |`;

async function testQwen3b() {
  console.log("==================================================");
  console.log(`Testing Local Ollama Model: ${MODEL_NAME}`);
  console.log("==================================================");

  const startTime = Date.now();

  try {
    console.log("Sending request to Ollama (CPU model loading may take up to 2-3 minutes on first run)...");

    const res = await axios.post("http://127.0.0.1:11434/v1/chat/completions", {
      model: MODEL_NAME,
      messages: [{ role: "user", content: JSON_PROMPT + "\n\nRaw Invoice Text to Parse:\n" + rawOcrText }],
      response_format: { type: "json_object" },
      temperature: 0.1,
      max_tokens: 3000
    }, { timeout: 300000 }); // 5 minutes timeout

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    const content = res.data.choices[0]?.message?.content;
    const usage = res.data.usage || {};

    console.log(`\n✓ Request Completed in ${elapsed}s`);
    console.log(`Tokens Used: Input=${usage.prompt_tokens || 'N/A'}, Output=${usage.completion_tokens || 'N/A'}`);
    console.log("\n================== FORMATTED JSON RESULT ==================");
    
    try {
      const parsed = JSON.parse(content);
      console.log(JSON.stringify(parsed, null, 2));
    } catch (parseErr) {
      console.log(content);
    }
    console.log("===========================================================");

  } catch (err) {
    if (err.response) {
      console.error("API Error Response:", err.response.data);
    } else {
      console.error("Execution Error:", err.message);
      if (err.message.includes("404") || err.message.includes("model")) {
        console.log(`\nNote: If model '${MODEL_NAME}' is not found, run: ollama pull ${MODEL_NAME}`);
      }
    }
  }
}

testQwen3b();
