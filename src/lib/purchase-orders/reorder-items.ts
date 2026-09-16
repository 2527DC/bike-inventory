import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { OPEN_PO_STATUSES } from "./status";
import { normalizeLineName } from "./duplicates";

/**
 * The products a New Purchase Order offers for one vendor — its "reorder items" (plan
 * 1509-reorder-inside-purchase-orders, R2–R6).
 *
 * A product is one when ALL of these hold:
 *   - it is ACTIVE;
 *   - its reorder vendor IS this vendor (Q2: `Product.reorderVendorId` — the vendor attached in
 *     the product's reorder settings. Brand ↔ vendor links are deliberately NOT used here);
 *   - it has a reorder level (> 0 — the column defaults to 0, which means "no level chosen");
 *   - its stock is AT OR BELOW that level (Q3 — the `isLowStock` rule in lib/reorder.ts, written
 *     as a column-to-column comparison so the list pages in the database instead of loading the
 *     catalogue), counted across every store (Q4 — `currentStock` is the cached sum of every
 *     StockLevel row).
 *
 * The quantity offered is `reorderQty` EXACTLY — 0 when it was never set (Q5, owner: "by
 * default let it be 0 only where at the time of po we can change the quantity"). That is why
 * this does not call `suggestedOrderQty`: its "order up to the level" fallback was declined for
 * this screen. The PO screen refuses to submit a 0 line; the person types the number there.
 *
 * No vendor-resolution cross-check is needed. `create.ts` refuses a linked line whose product
 * resolves to a different vendor, but a product whose reorderVendorId is V resolves to V at
 * tier 1 of `resolveVendors` whenever V is active — and the route refuses an inactive V — so
 * every row returned here passes that check by construction.
 */

export interface ReorderItem {
  productId: string;
  sku: string;
  name: string;
  currentStock: number;
  reorderLevel: number;
  reorderQty: number;
  /** The quantity the PO line starts at: `reorderQty` as set, 0 when unset (Q5). */
  quantity: number;
  /**
   * The newest OPEN purchase order for this same vendor that already carries this product, or
   * null. The screen shows the row greyed with this PO's number and does not let it be ticked
   * (Q7) — PO save would refuse it anyway (duplicates.ts).
   */
  openPo: { id: string; poNumber: string; status: string } | null;
}

export async function findReorderItems(opts: {
  vendorId: string;
  search?: string;
  page: number;
  limit: number;
}): Promise<{ items: ReorderItem[]; total: number }> {
  const { vendorId, search, page, limit } = opts;

  const where: Prisma.ProductWhereInput = {
    status: "ACTIVE",
    reorderVendorId: vendorId,
    reorderLevel: { gt: 0 },
    // Prisma field reference (GA since 5.0): `currentStock <= reorderLevel` in SQL. The older
    // comment in api/reorder/route.ts ("Prisma cannot compare two columns") predates it.
    currentStock: { lte: prisma.product.fields.reorderLevel },
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" } },
            { sku: { contains: search, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      select: {
        id: true,
        sku: true,
        name: true,
        currentStock: true,
        reorderLevel: true,
        reorderQty: true,
      },
      // `id` breaks ties so paging never shows a row twice or skips one.
      orderBy: [{ name: "asc" }, { id: "asc" }],
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  const ids = rows.map((r) => r.id);
  const names = [...new Set(rows.map((r) => r.name.trim()).filter(Boolean))];

  // One query for the whole page, the same two keys PO save's duplicate rule uses
  // (duplicates.ts:70-81): a line linked to the product, OR a line with the same item name —
  // a sheet-built line carries only its name (productId null), and save refuses on either. Open
  // POs for THIS vendor only, newest first, with only the overlapping lines.
  const lineMatch = {
    OR: [
      { productId: { in: ids } },
      { name: { in: names, mode: "insensitive" as const } },
    ],
  };
  const openPos = ids.length
    ? await prisma.purchaseOrder.findMany({
        where: {
          vendorId,
          status: { in: OPEN_PO_STATUSES },
          items: { some: lineMatch },
        },
        select: {
          id: true,
          poNumber: true,
          status: true,
          items: { where: lineMatch, select: { productId: true, name: true } },
        },
        orderBy: { createdAt: "desc" },
      })
    : [];

  type OpenPo = { id: string; poNumber: string; status: string };
  const openByProduct = new Map<string, OpenPo>();
  const openByName = new Map<string, OpenPo>();
  for (const po of openPos) {
    const ref = { id: po.id, poNumber: po.poNumber, status: po.status };
    for (const line of po.items) {
      // First one wins, and the list is newest first — so the newest open PO is named.
      if (line.productId && !openByProduct.has(line.productId)) openByProduct.set(line.productId, ref);
      const key = normalizeLineName(line.name);
      if (key && !openByName.has(key)) openByName.set(key, ref);
    }
  }
  const openPoFor = (r: { id: string; name: string }) =>
    openByProduct.get(r.id) ?? openByName.get(normalizeLineName(r.name)) ?? null;

  return {
    total,
    items: rows.map((r) => ({
      productId: r.id,
      sku: r.sku,
      name: r.name,
      currentStock: r.currentStock,
      reorderLevel: r.reorderLevel,
      reorderQty: r.reorderQty,
      quantity: r.reorderQty,
      openPo: openPoFor(r),
    })),
  };
}
