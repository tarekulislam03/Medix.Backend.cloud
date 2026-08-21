import axios from "axios";

const inputText = `ITEMS TABLE:
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

const JSON_PROMPT = `You are a strict data extraction system.
Map the provided invoice markdown table into the JSON schema below.

Column Mapping Hints:
Description of Goods -> medicine_name
Batch -> batch_number
Exp -> expiry_date (convert to YYYY-MM-DD)
Qty -> quantity
Unit -> unit
Rate -> purchase_price
Disc % -> discount_percentage
Han/Sac -> hsn_code

Return ONLY a valid JSON object matching this schema:
{
  "items": [
    {
      "medicine_name": "",
      "batch_number": "",
      "expiry_date": "",
      "quantity": 0,
      "unit": "",
      "purchase_price": 0,
      "discount_percentage": 0,
      "hsn_code": ""
    }
  ]
}`;

async function runTest() {
  console.log("==================================================");
  console.log("Testing Local Ollama Model (qwen2.5:3b)...");
  console.log("==================================================");

  const startTime = Date.now();

  try {
    const res = await axios.post("http://127.0.0.1:11434/v1/chat/completions", {
      model: "qwen2.5:3b",
      messages: [{ role: "user", content: JSON_PROMPT + "\n\n" + inputText }],
      response_format: { type: "json_object" },
      temperature: 0.1,
      max_tokens: 3000
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    const content = res.data.choices[0]?.message?.content;
    const usage = res.data.usage;

    console.log(`\nSuccess! Completed in ${elapsed}s`);
    console.log(`Token Usage: Input=${usage?.prompt_tokens}, Output=${usage?.completion_tokens}`);
    console.log("\n================== FORMATTED JSON OUTPUT ==================");

    try {
      const parsed = JSON.parse(content);
      console.log(JSON.stringify(parsed, null, 2));
    } catch (parseErr) {
      console.log(content);
    }
    console.log("===========================================================");

  } catch (err) {
    console.error("Test Failed:", err.message);
  }
}

runTest();
