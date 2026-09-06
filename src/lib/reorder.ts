/**
 * The two reorder questions, answered in one place: is this product low, and how many should
 * we order.
 *
 * Client-safe on purpose — no Prisma import — because the same predicate decides a badge on
 * `/stock` and a filter inside an API route.
 *
 * ─── WHAT THIS FILE DELIBERATELY DOES NOT COVER ──────────────────────────────────────────
 *
 * There were FOURTEEN inline copies of these two expressions before this file, and they did
 * not all agree. The disagreements are real behaviour on real screens, so unifying every one
 * of them would have changed what the app reports. Each exception below stays as it is, and
 * carries a comment at its own site pointing here.
 *
 * 1. `api/dashboard/stats/route.ts` counts low stock as `currentStock - reservedStock <=
 *    reorderLevel` — AVAILABLE, not on hand. Everything else uses on hand. That means the
 *    dashboard's "Low Stock" tile and the `/reorder` list disagree whenever anything is
 *    reserved. That is a known defect, filed rather than fixed here (owner, 6 Sep): fixing it
 *    is a decision about what the shop means by "low", not a refactor, and it changes a
 *    number people already read.
 * 2. `lib/notify/stock.ts` detects the downward CROSSING (`previousStock > level && newStock
 *    <= level`), not the state. Replacing that with `isLowStock` would re-notify on every
 *    later sale.
 * 3. `desktop/stock/page.tsx` filters `currentStock > 0 && currentStock <= 5` — a hardcoded
 *    threshold that ignores `reorderLevel` entirely and excludes zero stock.
 * 4. `lib/brand-stock-matcher.ts` and `api/brand-stock/uploads/[id]/items` compute a shortfall
 *    that floors at 0, subtracts `available`, and ignores `reorderQty` — because a 0 there is
 *    a SIGNAL meaning "not selected". `suggestedOrderQty` floors at 1, so swapping it in would
 *    auto-select every matched row.
 * 5. `brand-stock/[id]/page.tsx` compares a nullable snapshot column with no `> 0` guard.
 * 6. Three raw-SQL copies (`api/stock/summary`, `api/stock/by-brand`, `api/stock/by-bin`)
 *    express the same rule in Postgres and cannot call a TypeScript helper. If the rule here
 *    changes, those three change by hand or they drift.
 */

/** The fields the reorder rules read. Structural, so any row carrying them qualifies. */
export interface ReorderInputs {
  currentStock: number;
  reorderLevel: number;
}

/** As above, plus the ordering quantity. */
export interface OrderQtyInputs extends ReorderInputs {
  reorderQty: number;
}

/**
 * Is this product at or below its reorder level?
 *
 * The `reorderLevel > 0` guard is load-bearing and not a tidiness check: the column is
 * `Int @default(0)`, so without it EVERY product that has never had a level set — which is
 * most of the catalogue — reads as low the moment its stock reaches zero, and the reorder
 * list becomes the product list.
 *
 * `<=` not `<`: sitting exactly ON the reorder level is the moment to reorder. That is what
 * all eleven original copies used, and changing it would move every badge by one unit.
 */
export function isLowStock(p: ReorderInputs): boolean {
  return p.reorderLevel > 0 && p.currentStock <= p.reorderLevel;
}

/**
 * How many to put on the purchase order.
 *
 * `reorderQty` when it is set, otherwise enough to reach the reorder level again.
 *
 * Two details worth keeping:
 * - `|| ` treats an explicit 0 as "unset". That is correct ONLY because 0 is the column's
 *   default (`reorderQty Int @default(0)`, schema.prisma:503) and therefore means "nobody
 *   chose one", not "order zero of these".
 * - The floor is 1, not 0. This function's answer becomes a purchase-order line, and a line
 *   for zero units is not a line. Do not reuse it where 0 needs to survive as a signal — see
 *   exception 4 in the file header.
 */
export function suggestedOrderQty(p: OrderQtyInputs): number {
  return p.reorderQty || Math.max(1, p.reorderLevel - p.currentStock);
}
