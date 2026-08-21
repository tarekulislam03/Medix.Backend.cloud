/**
 * Robust JSON parser for LLM responses.
 *
 * Free / rate-limited models frequently return:
 *   - Truncated JSON (hit max_tokens mid-string)
 *   - JSON wrapped in ```json ... ``` markdown fences
 *   - Leading/trailing junk text around the JSON
 *   - Trailing commas before ] or }
 *
 * This parser attempts multiple recovery strategies before giving up.
 */
export const safeParseJSON = (text) => {
  if (!text || typeof text !== "string") {
    throw new Error("Invalid AI response format");
  }

  // ── Step 1: Strip markdown fences & surrounding whitespace ────────────
  let cleaned = text
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  // ── Step 2: Try direct parse (fast path) ─────────────────────────────
  try {
    return JSON.parse(cleaned);
  } catch (_directErr) {
    // fall through to recovery
  }

  // ── Step 3: Extract JSON object from surrounding junk ────────────────
  // Some models prefix with "Here is the JSON:" or append explanations
  const jsonStart = cleaned.indexOf("{");
  const jsonEnd = cleaned.lastIndexOf("}");
  if (jsonStart !== -1 && jsonEnd > jsonStart) {
    const extracted = cleaned.slice(jsonStart, jsonEnd + 1);
    try {
      return JSON.parse(extracted);
    } catch (_extractErr) {
      // fall through
      cleaned = extracted;
    }
  }

  // ── Step 4: Fix trailing commas  ( ,] or ,} ) ───────────────────────
  let fixed = cleaned.replace(/,\s*([\]}])/g, "$1");
  try {
    return JSON.parse(fixed);
  } catch (_trailingErr) {
    // fall through
  }

  // ── Step 5: Repair truncated JSON ────────────────────────────────────
  // LLM hit max_tokens and the JSON got cut off mid-way.
  // Strategy: close any open strings, arrays, and objects.
  try {
    const repaired = repairTruncatedJSON(fixed);
    return JSON.parse(repaired);
  } catch (_repairErr) {
    // fall through
  }

  // ── Step 6: Last resort — extract items array with regex ─────────────
  // Even if the full JSON is broken, try to salvage the items array
  try {
    const itemsMatch = cleaned.match(/"items"\s*:\s*\[/);
    if (itemsMatch) {
      const arrStart = cleaned.indexOf("[", itemsMatch.index);
      // Find the last complete object in the array
      let lastObjEnd = -1;
      let depth = 0;
      for (let i = arrStart; i < cleaned.length; i++) {
        if (cleaned[i] === "{") depth++;
        if (cleaned[i] === "}") {
          depth--;
          if (depth === 0) lastObjEnd = i;
        }
      }
      if (lastObjEnd > arrStart) {
        const salvaged = cleaned.slice(arrStart, lastObjEnd + 1) + "]";
        const items = JSON.parse(salvaged);
        console.warn(`[JSON Parser] Salvaged ${items.length} items from truncated response`);
        return { items, invoice: {} };
      }
    }
  } catch (_salvageErr) {
    // fall through
  }

  // ── All strategies failed ────────────────────────────────────────────
  console.error("JSON Parse Error: All recovery strategies failed");
  console.error("Raw text (first 500 chars):", text.substring(0, 500));
  throw new Error("Invalid AI response format");
};

/**
 * Attempt to close a truncated JSON string so it becomes parseable.
 * Handles cases where the LLM output was cut off mid-token.
 */
function repairTruncatedJSON(text) {
  let repaired = text;

  // Check if we're inside an unclosed string literal
  let inString = false;
  let escaped = false;
  for (let i = 0; i < repaired.length; i++) {
    const ch = repaired[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
    }
  }

  // If we ended inside a string, close it
  if (inString) {
    repaired += '"';
  }

  // Remove any trailing comma after closing the string
  repaired = repaired.replace(/,\s*$/, "");

  // Count open vs close brackets/braces
  let openBraces = 0;
  let openBrackets = 0;
  inString = false;
  escaped = false;

  for (let i = 0; i < repaired.length; i++) {
    const ch = repaired[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === "{") openBraces++;
    if (ch === "}") openBraces--;
    if (ch === "[") openBrackets++;
    if (ch === "]") openBrackets--;
  }

  // Close any unclosed arrays then objects
  // Remove trailing comma before closing
  repaired = repaired.replace(/,\s*$/, "");

  while (openBrackets > 0) {
    repaired += "]";
    openBrackets--;
  }
  while (openBraces > 0) {
    repaired += "}";
    openBraces--;
  }

  return repaired;
}