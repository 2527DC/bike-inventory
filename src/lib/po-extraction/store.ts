import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { createLogger } from "@/lib/logger";
import { tryGetStorage } from "@/lib/storage";
import { buildKey } from "@/lib/storage/upload-policy";
import type {
  ColumnRole,
  ExtractionItemView,
  ExtractionStage,
  ExtractionView,
  LegendEntry,
  PriceSource,
  SheetColumns,
} from "./types";
import { COLUMN_ROLES } from "./types";

const log = createLogger("po-extraction:store");

/**
 * Reading, shaping and discarding a `PoExtraction` — plan 0909-po-sheet-ai-extraction-and-
 * catalogue-free-lines, §3.3. Rewritten 9 Sep 2026 from the quotation-import version: there is
 * no product match any more (D2), so nothing here touches the products table. A row is what
 * the sheet said — its item name, its quantity when the sheet has one, its price and MRP, its
 * fill colour and every column the person chose to keep — and the name, the quantity and the
 * unit price (the MRP, else the Price — plan 1509-po-sheet-mrp-price) travel to the PO line.
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
  /** Prisma `Decimal | null`. Read through `unitPriceOf`, never directly. */
  price: unknown;
  mrp: unknown;
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

/** A stored Decimal (or number) → a positive number, else null. */
function positive(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * THE rule for a sheet line's unit price (plan 1509-po-sheet-mrp-price, D1 + Q1): the row's
 * MRP, else its dealer Price, else nothing — and nothing means the row cannot be ordered (R5).
 * One function, used by the review (`serializeItem`), the one-row select route and the create
 * route that re-reads the price, so the three cannot disagree. `PRICED_ROW` is the same rule
 * as a where clause, for the bulk select.
 */
export function unitPriceOf(row: { mrp: unknown; price: unknown }): { unitPrice: number | null; priceSource: PriceSource | null } {
  const mrp = positive(row.mrp);
  if (mrp !== null) return { unitPrice: mrp, priceSource: "mrp" };
  const price = positive(row.price);
  if (price !== null) return { unitPrice: price, priceSource: "price" };
  return { unitPrice: null, priceSource: null };
}

/** "This row has a price" as a Prisma filter — `unitPriceOf` in the database. */
export const PRICED_ROW: Prisma.PoExtractionItemWhereInput = { OR: [{ mrp: { gt: 0 } }, { price: { gt: 0 } }] };

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
    ...unitPriceOf(item),
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
  const sheets = readSheetColumns(row.columnRoles);

  /**
   * The AI is considered "confident" when it proposed exactly one itemName column on every
   * sheet, so the client can skip the column-confirmation dialog and fire the extract call
   * automatically. Only meaningful (and only set) while stage === "columns".
   */
  const autoConfident =
    stage === "columns" &&
    sheets.length > 0 &&
    sheets.every((s) => s.columns.filter((c) => c.role === "itemName").length === 1);

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
    autoConfident: autoConfident || undefined,
    sheets,
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
 * object the upload wrote, using the provider's authenticated GET (not the public URL, which
 * may be inaccessible for private paths like purchase-orders/quotations/).
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
    const buf = await storage.read(key);
    if (!buf) {
      log.warn("quotation file not readable", { extractionId, key, provider: storage.key, reason: "not found" });
      return null;
    }
    log.debug("quotation file read", { extractionId, key, provider: storage.key, bytes: buf.byteLength });
    return buf;
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

export type SheetPriceResult<T> =
  | { ok: true; items: T[]; priced: number }
  | { ok: false; message: string; names: string[] };

function listNames(names: string[]): string {
  const shown = names.slice(0, 3).map((n) => `"${n}"`).join(", ");
  return names.length > 3 ? `${shown} and ${names.length - 3} more` : shown;
}

/**
 * The server half of the price lock (plan 1509-po-sheet-mrp-price, Q2 a). A line that carries
 * `extractionItemId` came from the review, and its unit price is whatever that stored row says
 * — the number the browser sent is discarded. The screen shows the price as text, but a screen
 * is not a gate: the PDF goes to the vendor, so the lock has to hold against a hand-made
 * request too.
 *
 * Rows are looked up only inside the caller's own extraction for THIS vendor, so an id from
 * somebody else's review, or from a sheet uploaded against another vendor, is "not found".
 * Refuses — never guesses — when a row is gone (its sheet was replaced or discarded) or has no
 * price. Lines without an `extractionItemId` (the /reorder handoff) pass through untouched.
 */
export async function applySheetPrices<T extends { name: string; unitPrice: number; extractionItemId?: string }>(
  items: T[],
  ctx: { extractionId: string | undefined; vendorId: string; userId: string },
): Promise<SheetPriceResult<T>> {
  const ids = [...new Set(items.map((i) => i.extractionItemId).filter((id): id is string => !!id))];
  if (ids.length === 0) return { ok: true, items, priced: 0 };

  const rows = ctx.extractionId
    ? await prisma.poExtractionItem.findMany({
        where: {
          id: { in: ids },
          extractionId: ctx.extractionId,
          extraction: { createdById: ctx.userId, vendorId: ctx.vendorId },
        },
        select: { id: true, mrp: true, price: true },
      })
    : [];
  const priceById = new Map(rows.map((r) => [r.id, unitPriceOf(r).unitPrice]));
  log.debug("sheet prices read", { extractionId: ctx.extractionId ?? null, requested: ids.length, found: rows.length });

  const stale = items.filter((i) => i.extractionItemId && !priceById.has(i.extractionItemId));
  if (stale.length > 0) {
    log.warn("sheet lines refused", {
      extractionId: ctx.extractionId ?? null,
      reason: "row not found",
      itemIds: stale.map((i) => i.extractionItemId),
    });
    const names = stale.map((i) => i.name.trim());
    return {
      ok: false,
      names,
      message: `${listNames(names)} came from a sheet that is no longer open. Remove ${stale.length === 1 ? "it" : "them"} and select the rows again.`,
    };
  }

  const unpriced = items.filter((i) => i.extractionItemId && priceById.get(i.extractionItemId) == null);
  if (unpriced.length > 0) {
    log.warn("sheet lines refused", {
      extractionId: ctx.extractionId ?? null,
      reason: "no price",
      itemIds: unpriced.map((i) => i.extractionItemId),
    });
    const names = unpriced.map((i) => i.name.trim());
    return {
      ok: false,
      names,
      message: `${listNames(names)} ${unpriced.length === 1 ? "has" : "have"} no price in the sheet. Remove ${unpriced.length === 1 ? "it" : "them"} to continue.`,
    };
  }

  const out = items.map((i) => {
    const price = i.extractionItemId ? priceById.get(i.extractionItemId) : null;
    return price != null ? { ...i, unitPrice: price } : i;
  });
  return { ok: true, items: out, priced: ids.length };
}
