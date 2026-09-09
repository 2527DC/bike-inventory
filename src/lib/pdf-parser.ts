import { createLogger } from "@/lib/logger";
import { runAi, aiErrorKind } from "@/lib/ai";
import type { ParsedItem } from "@/lib/excel-parser";

const log = createLogger("catalogue:pdf-parser");

export async function parsePdfWithAI(buffer: ArrayBuffer, fileName: string): Promise<ParsedItem[]> {
  const base64 = Buffer.from(buffer).toString("base64");
  const isPdf = fileName.toLowerCase().endsWith(".pdf");
  const mediaType = isPdf ? "application/pdf" : (
    fileName.toLowerCase().endsWith(".png") ? "image/png" :
    fileName.toLowerCase().endsWith(".jpg") || fileName.toLowerCase().endsWith(".jpeg") ? "image/jpeg" :
    fileName.toLowerCase().endsWith(".webp") ? "image/webp" : "image/jpeg"
  );

  log.debug("-> runAi catalogue.pdf_extract", {
    fileName,
    kind: isPdf ? "pdf" : "image",
    mediaType,
    bytes: buffer.byteLength,
  });

  let result;
  try {
    result = await runAi({
      purpose: "catalogue.pdf_extract",
      prompt: `Extract ALL product/inventory items from this document into a JSON array. Each item should have these fields:
- "name": product name (required)
- "sku": product code/SKU/article number (if present, else null)
- "category": category/group (if present, else null)
- "qty": available quantity/stock (if present, else 0)
- "price": dealer price/cost price (if present, else null)
- "mrp": MRP/retail price (if present, else null)
- "size": size/wheel size (if present, else null)

Rules:
- Extract EVERY row that looks like a product entry
- Skip headers, totals, subtotals, empty rows
- Numbers should be plain integers or floats (no commas, no currency symbols)
- If a field is not present in the document, use null
- Return ONLY the JSON array, no other text

Return format: [{"name":"...","sku":"...","category":"...","qty":0,"price":null,"mrp":null,"size":null}, ...]`,
      attachments: [{ kind: isPdf ? "pdf" : "image", mediaType, base64, fileName }],
      // maxTokens is a ceiling, not spend: a thinking model draws its reasoning from the same budget,
      // and runAi refuses a max_tokens stop outright rather than hand back half a catalogue.
      maxTokens: 16000,
      json: true,
    });
  } catch (error) {
    // AiError / AiNotConfiguredError propagate to the route, which maps them with
    // toAiErrorResponse. Log here so the failing document is named next to the cause.
    log.error("catalogue extract failed", { fileName, kind: aiErrorKind(error) });
    throw error;
  }

  const parsed: unknown = result.json;
  if (!Array.isArray(parsed)) {
    log.error("catalogue extract returned JSON that is not an array", {
      fileName,
      model: result.model,
      type: parsed === null ? "null" : typeof parsed,
    });
    throw new Error("Could not extract product data from this document. The AI could not find a product table.");
  }

  const rawItems = parsed as Array<{ name?: string; sku?: string; category?: string; qty?: number; price?: number; mrp?: number; size?: string }>;

  if (rawItems.length === 0) {
    log.error("catalogue extract returned an empty array", { fileName, model: result.model });
    throw new Error("No product items found in this document.");
  }

  log.info("catalogue parsed", { fileName, items: rawItems.length, model: result.model });

  return rawItems
    .filter((item) => item.name && String(item.name).trim().length > 0)
    .map((item) => ({
      rawSku: item.sku ? String(item.sku).trim() : null,
      rawName: String(item.name).trim(),
      rawCategory: item.category ? String(item.category).trim() : null,
      brandAvailableQty: typeof item.qty === "number" ? item.qty : parseInt(String(item.qty || "0")) || 0,
      brandPrice: typeof item.price === "number" ? item.price : (item.price ? parseFloat(String(item.price)) : null),
      brandMrp: typeof item.mrp === "number" ? item.mrp : (item.mrp ? parseFloat(String(item.mrp)) : null),
      rawSize: item.size ? String(item.size).trim() : null,
    }));
}
