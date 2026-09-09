import { createLogger } from "@/lib/logger";
import { parseExcelBuffer, type ParsedItem } from "@/lib/excel-parser";
import { parsePdfWithAIDetailed } from "@/lib/pdf-parser";

const log = createLogger("po-extraction:parse");

/**
 * One entry point for "turn a vendor's file into rows" — plan 0909-po-ai-upload, P1.
 *
 * XLSX / CSV go through the deterministic column-sniffing parser: free, instant, no AI
 * (Q8). PDF and images go through the AI extraction. The caller does not need to know
 * which, but the result says which, because the two have different failure modes and
 * different costs and the extraction row records it (`PoExtraction.source`).
 */
export const EXCEL_EXTENSIONS = ["xlsx", "xls", "csv"] as const;
export const AI_EXTENSIONS = ["pdf", "png", "jpg", "jpeg", "webp"] as const;

export type ExtractionSource = "excel" | "ai";

export interface ParsedQuotation {
  items: ParsedItem[];
  source: ExtractionSource;
  /** Provider + model that read the document. Null for the Excel path — nothing "read" it. */
  aiModel: string | null;
  fileType: string;
}

export function fileExtension(fileName: string): string {
  return fileName.toLowerCase().split(".").pop() ?? "";
}

export function isSupportedQuotation(fileName: string): boolean {
  const ext = fileExtension(fileName);
  return (EXCEL_EXTENSIONS as readonly string[]).includes(ext) || (AI_EXTENSIONS as readonly string[]).includes(ext);
}

/**
 * Parses the file. Throws on an unsupported extension, on an empty result, and — for the AI
 * path — lets `AiError` / `AiNotConfiguredError` propagate so the route can map them to their
 * own status (501 "Settings → AI", 502/503 by kind) with `toAiErrorResponse`.
 */
export async function parseQuotation(buffer: ArrayBuffer, fileName: string): Promise<ParsedQuotation> {
  const ext = fileExtension(fileName);
  log.debug("parse quotation", { ext, bytes: buffer.byteLength });

  if ((EXCEL_EXTENSIONS as readonly string[]).includes(ext)) {
    const items = parseExcelBuffer(buffer, fileName);
    log.info("quotation parsed", { source: "excel", ext, items: items.length });
    return { items, source: "excel", aiModel: null, fileType: ext };
  }

  if ((AI_EXTENSIONS as readonly string[]).includes(ext)) {
    // parsePdfWithAIDetailed logs its own failure with the AI error kind before rethrowing.
    const { items, model } = await parsePdfWithAIDetailed(buffer, fileName);
    log.info("quotation parsed", { source: "ai", ext, items: items.length, model });
    return { items, source: "ai", aiModel: model || null, fileType: ext };
  }

  log.warn("unsupported quotation file", { ext });
  throw new Error("Unsupported file type. Upload Excel (.xlsx/.csv), PDF, or an image (.png/.jpg/.webp)");
}
