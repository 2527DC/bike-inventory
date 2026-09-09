import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { createLogger } from "@/lib/logger";
import { tryGetStorage } from "@/lib/storage";
import { buildKey } from "@/lib/storage/upload-policy";

const log = createLogger("po-extraction:store");

/**
 * Reading, shaping and discarding a `PoExtraction` — plan 0909-po-ai-upload, P3.
 *
 * Three routes and the PO create path all need the same three things: the extraction with
 * its items and each matched product's defaults (Q7), the rule that a caller only ever sees
 * their own extraction, and the delete that takes the stored file with the rows. They live
 * here once rather than in four route files that would drift.
 *
 * An extraction is review-time scratch (owner, 9 Sep 2026): it is deleted the moment a PO is
 * created from it, when the person presses Discard, or when they upload another file. Nothing
 * here is provenance.
 */

/** The prefix the uploaded quotation is stored under. Namespaced like the sent PDFs. */
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
};

export type { ExtractionProductView, ExtractionItemView, ExtractionView } from "./types";
import type { ExtractionItemView, ExtractionView } from "./types";

const productSelect = {
  id: true,
  name: true,
  sku: true,
  costPrice: true,
  gstRate: true,
  currentStock: true,
  reorderLevel: true,
  reservedStock: true,
} as const;

type ItemRow = Prisma.PoExtractionItemGetPayload<{ include: { product: { select: typeof productSelect } } }>;

/** Prisma Decimal → number, and the cost-price gate, in one place. */
export function serializeItem(item: ItemRow, canSeeCost: boolean): ExtractionItemView {
  const p = item.product;
  return {
    id: item.id,
    rawName: item.rawName,
    rawSku: item.rawSku,
    rawCategory: item.rawCategory,
    rawSize: item.rawSize,
    qty: item.qty,
    price: item.price === null ? null : Number(item.price),
    mrp: item.mrp === null ? null : Number(item.mrp),
    productId: item.productId,
    matchStatus: item.matchStatus,
    matchConfidence: item.matchConfidence,
    selected: item.selected,
    orderQty: item.orderQty,
    sortOrder: item.sortOrder,
    product: p
      ? {
          id: p.id,
          name: p.name,
          sku: p.sku,
          ...(canSeeCost ? { costPrice: p.costPrice } : {}),
          gstRate: p.gstRate,
          currentStock: p.currentStock,
          reorderLevel: p.reorderLevel,
          reservedStock: p.reservedStock,
        }
      : null,
  };
}

/**
 * The caller's extraction, with items in file order and each match's product defaults.
 * Null when it does not exist OR belongs to somebody else — the two are deliberately the same
 * answer (404), so an id cannot be probed.
 */
export async function loadExtraction(
  id: string,
  userId: string,
  canSeeCost: boolean
): Promise<ExtractionView | null> {
  const row = await prisma.poExtraction.findFirst({
    where: { id, createdById: userId },
    include: {
      vendor: { select: { name: true } },
      items: { orderBy: { sortOrder: "asc" }, include: { product: { select: productSelect } } },
    },
  });
  if (!row) return null;
  return {
    id: row.id,
    vendorId: row.vendorId,
    vendorName: row.vendor.name,
    fileName: row.fileName,
    fileType: row.fileType,
    fileUrl: row.fileUrl,
    source: row.source,
    aiModel: row.aiModel,
    totalItems: row.totalItems,
    matchedItems: row.matchedItems,
    createdAt: row.createdAt.toISOString(),
    items: row.items.map((it) => serializeItem(it, canSeeCost)),
  };
}

/**
 * Store the uploaded quotation so the review can show it. Best effort: null when no storage
 * provider is configured or the write fails. The extraction is complete without the file —
 * the rows are what the review needs — so this never fails the request.
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
