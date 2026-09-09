import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { createLogger } from "@/lib/logger";
import { LocalProvider, tryGetStorage } from "@/lib/storage";
import { buildKey } from "@/lib/storage/upload-policy";
import type {
  ColumnRole,
  ExtractionItemView,
  ExtractionStage,
  ExtractionView,
  LegendEntry,
  SheetColumns,
} from "./types";
import { COLUMN_ROLES } from "./types";

const log = createLogger("po-extraction:store");

/**
 * Reading, shaping and discarding a `PoExtraction` — plan 0909-po-sheet-ai-extraction-and-
 * catalogue-free-lines, §3.3. Rewritten 9 Sep 2026 from the quotation-import version: there is
 * no product match any more (D2), so nothing here touches the products table. A row is what
 * the sheet said — its item name, its quantity when the sheet has one, its fill colour and
 * every column the person chose to keep — and only name and quantity travel to the PO line.
 *
 * An extraction is review-time scratch (owner, 9 Sep 2026, Q6): it is deleted the moment a PO
 * is created from it, when the person presses Discard, or when they upload another file.
 * Nothing here is provenance.
 */

/** The prefix the uploaded file is stored under. Namespaced like the sent PDFs. */
export const QUOTATION_STORAGE_PREFIX = "purchase-orders/quotations/";

const CONTENT_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  csv: "text/csv",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xlsm: "application/vnd.ms-excel.sheet.macroEnabled.12",
};

export type { ExtractionItemView, ExtractionView } from "./types";

/**
 * The columns of a `PoExtractionItem` the view needs. Structural rather than a Prisma payload
 * type so the file reads the same whether or not the client has been regenerated — the
 * `Json` column comes back as `unknown` either way and is checked below.
 */
export interface ExtractionItemRow {
  id: string;
  rawName: string;
  qty: number | null;
  sheetName: string | null;
  rowIndex: number | null;
  rowColor: string | null;
  columns: unknown;
  selected: boolean;
  sortOrder: number;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isColumnRole(v: unknown): v is ColumnRole {
  return typeof v === "string" && (COLUMN_ROLES as string[]).includes(v);
}

/** `[{ header, value }]` from the Json column, dropping anything that is not that shape. */
function readColumns(raw: unknown): Array<{ header: string; value: string }> {
  if (!Array.isArray(raw)) return [];
  const out: Array<{ header: string; value: string }> = [];
  for (const c of raw) {
    if (!isRecord(c)) continue;
    out.push({ header: String(c.header ?? ""), value: String(c.value ?? "") });
  }
  return out;
}

/** `[{ rgb, label }]` from the Json column. Six upper-case hex digits, no hash sign. */
export function readLegend(raw: unknown): LegendEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: LegendEntry[] = [];
  for (const e of raw) {
    if (!isRecord(e)) continue;
    const rgb = String(e.rgb ?? "").replace(/^#/, "").toUpperCase();
    const label = String(e.label ?? "").trim();
    if (!/^[0-9A-F]{6}$/.test(rgb) || !label) continue;
    out.push({ rgb, label });
  }
  return out;
}

/**
 * The per-sheet column map from the Json column — the AI's proposal while the stage is
 * "columns", the person's confirmation afterwards. Anything malformed is dropped rather than
 * thrown: the column step can always be redone, a crashed review cannot.
 */
export function readSheetColumns(raw: unknown): SheetColumns[] {
  if (!Array.isArray(raw)) return [];
  const out: SheetColumns[] = [];
  for (const s of raw) {
    if (!isRecord(s) || typeof s.sheet !== "string" || typeof s.headerRow !== "number") continue;
    const columns: SheetColumns["columns"] = [];
    if (Array.isArray(s.columns)) {
      for (const c of s.columns) {
        if (!isRecord(c) || typeof c.index !== "number") continue;
        columns.push({
          index: c.index,
          header: String(c.header ?? ""),
          role: isColumnRole(c.role) ? c.role : "other",
        });
      }
    }
    const entry: SheetColumns = { sheet: s.sheet, headerRow: s.headerRow, columns };
    const legend = readLegend(s.legend);
    if (legend.length > 0) entry.legend = legend;
    if (Array.isArray(s.preview)) {
      entry.preview = s.preview
        .filter((r): r is unknown[] => Array.isArray(r))
        .slice(0, 25)
        .map((r) => r.map((cell) => String(cell ?? "")));
    }
    if (typeof s.dataRowEstimate === "number") entry.dataRowEstimate = s.dataRowEstimate;
    out.push(entry);
  }
  return out;
}

/** One row as the review sees it. `legendLabel` is the legend entry whose rgb is the row's. */
export function serializeItem(item: ExtractionItemRow, legend: LegendEntry[]): ExtractionItemView {
  const color = item.rowColor ? item.rowColor.replace(/^#/, "").toUpperCase() : null;
  const legendLabel = color ? (legend.find((l) => l.rgb.toUpperCase() === color)?.label ?? null) : null;
  return {
    id: item.id,
    sheetName: item.sheetName,
    rowIndex: item.rowIndex,
    name: item.rawName,
    quantity: item.qty,
    rowColor: color,
    legendLabel,
    columns: readColumns(item.columns),
    selected: item.selected,
    sortOrder: item.sortOrder,
  };
}

/**
 * The caller's extraction, with items in sheet order. Null when it does not exist OR belongs
 * to somebody else — the two are deliberately the same answer (404), so an id cannot be
 * probed.
 */
export async function loadExtraction(id: string, userId: string): Promise<ExtractionView | null> {
  const row = await prisma.poExtraction.findFirst({
    where: { id, createdById: userId },
    include: {
      vendor: { select: { name: true } },
      items: { orderBy: { sortOrder: "asc" } },
    },
  });
  if (!row) return null;

  const legend = readLegend(row.legend);
  const stage: ExtractionStage = row.stage === "review" ? "review" : "columns";
  return {
    id: row.id,
    vendorId: row.vendorId,
    vendorName: row.vendor.name,
    fileName: row.fileName,
    fileType: row.fileType,
    fileUrl: row.fileUrl,
    source: row.source,
    aiModel: row.aiModel,
    stage,
    sheets: readSheetColumns(row.columnRoles),
    legend,
    totalItems: row.totalItems,
    createdAt: row.createdAt.toISOString(),
    items: row.items.map((it) => serializeItem(it, legend)),
  };
}

/**
 * Store the uploaded file. Best effort for a PDF or image: null when no storage provider is
 * configured or the write fails, and the extraction is complete without it — the rows are what
 * the review needs. For a SHEET the caller treats null as a failure: the column step must read
 * the workbook back (`readQuotationFile`), so the route refuses a sheet upload up front when
 * storage is not configured and fails the request when the write does not land.
 */
export async function storeQuotationFile(
  extractionId: string,
  fileName: string,
  fileType: string,
  bytes: ArrayBuffer
): Promise<string | null> {
  try {
    const storage = await tryGetStorage();
    if (!storage) {
      log.warn("quotation not stored", { extractionId, reason: "storage not configured" });
      return null;
    }
    const key = buildKey(QUOTATION_STORAGE_PREFIX, fileName);
    const url = await storage.put(key, bytes, CONTENT_TYPES[fileType] ?? "application/octet-stream");
    log.debug("quotation stored", { extractionId, key, provider: storage.key, bytes: bytes.byteLength });
    return url;
  } catch (e) {
    log.warn("quotation not stored", {
      extractionId,
      reason: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

/**
 * Read the stored file back for the column step's deterministic extraction and for the
 * rescue read. The workbook is NOT kept in the database — the schema has no bytes column,
 * and the file store already holds it (plan 0909, §3.3) — so the confirm step re-reads the
 * object the upload wrote:
 *
 *   - LOCAL: `LocalProvider.read(key)` — the same call `/api/media` serves files with. Not on
 *     the `StorageProvider` interface, hence the instanceof;
 *   - S3: a plain `fetch` of the public URL. Objects are world-readable by design — that is how
 *     every stored image is displayed — so no signed GET is needed.
 *
 * Null when the file is gone, the URL was issued by a different provider, or storage is no
 * longer configured. The caller turns null into a sentence asking for a fresh upload.
 */
export async function readQuotationFile(extractionId: string, fileUrl: string): Promise<ArrayBuffer | null> {
  const storage = await tryGetStorage();
  if (!storage) {
    log.warn("quotation file not readable", { extractionId, reason: "storage not configured" });
    return null;
  }
  const key = storage.keyFromUrl(fileUrl);
  if (!key) {
    log.warn("quotation file not readable", { extractionId, reason: "url not issued by the live provider", provider: storage.key });
    return null;
  }
  try {
    if (storage instanceof LocalProvider) {
      const buf = await storage.read(key);
      if (!buf) {
        log.warn("quotation file not readable", { extractionId, key, provider: storage.key, reason: "not found" });
        return null;
      }
      log.debug("quotation file read", { extractionId, key, provider: storage.key, bytes: buf.byteLength });
      // A Buffer may be a view into a larger pooled ArrayBuffer; copy exactly its bytes.
      return new Uint8Array(buf).slice().buffer;
    }
    log.debug("-> GET stored quotation", { extractionId, key, provider: storage.key });
    const res = await fetch(fileUrl, { cache: "no-store" });
    if (!res.ok) {
      log.warn("quotation file not readable", { extractionId, key, provider: storage.key, status: res.status });
      return null;
    }
    const bytes = await res.arrayBuffer();
    log.debug("quotation file read", { extractionId, key, provider: storage.key, bytes: bytes.byteLength });
    return bytes;
  } catch (e) {
    log.warn("quotation file not readable", {
      extractionId,
      key,
      provider: storage.key,
      reason: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

/** Remove a stored quotation. Never throws — the rows go regardless (plan §5.1). */
async function removeQuotationFile(extractionId: string, fileUrl: string): Promise<void> {
  const storage = await tryGetStorage();
  if (!storage) {
    log.warn("quotation file not removed", { extractionId, reason: "storage not configured" });
    return;
  }
  // keyFromUrl answers null for a URL this provider did not issue — a file stored before the
  // provider was switched. Nothing to delete on the live provider.
  const key = storage.keyFromUrl(fileUrl);
  if (!key) {
    log.warn("quotation file not removed", { extractionId, reason: "url not issued by the live provider", provider: storage.key });
    return;
  }
  try {
    await storage.delete(key);
    log.debug("quotation file removed", { extractionId, key, provider: storage.key });
  } catch (e) {
    log.warn("quotation file not removed", {
      extractionId,
      key,
      provider: storage.key,
      reason: e instanceof Error ? e.message : String(e),
    });
  }
}

/**
 * Delete every extraction matching `where` — its items cascade, its file goes best-effort.
 *
 * Callers always scope `where` to a `createdById`: a person discards their own review, a
 * new upload replaces their own earlier one, and a PO consumes the extraction of the person
 * who raised it. Returns the ids that were deleted so the caller can log them.
 */
export async function discardExtractions(where: Prisma.PoExtractionWhereInput): Promise<string[]> {
  const rows = await prisma.poExtraction.findMany({ where, select: { id: true, fileUrl: true } });
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  await prisma.poExtraction.deleteMany({ where: { id: { in: ids } } });

  for (const r of rows) {
    if (r.fileUrl) await removeQuotationFile(r.id, r.fileUrl);
  }

  log.debug("extractions discarded", { ids });
  return ids;
}
