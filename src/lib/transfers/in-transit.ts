import { prisma } from "@/lib/db";

/**
 * How much of each product is currently in a van, and where it is headed.
 *
 * ─── WHY THIS IS A SEPARATE NUMBER AND NOT A STOCK ROW ────────────────────────────────────
 *
 * The tempting shortcut is a synthetic "IN_TRANSIT" warehouse holding the dispatched units.
 * It would be a real bug, and a quiet one:
 *
 *   `recomputeCurrentStock` sums EVERY `StockLevel` row for a product, with no filter of any
 *   kind. A transit row would therefore be added straight into `Product.currentStock` — so
 *   stock that has left one building and not arrived at another would count as sellable, which
 *   is the double-count this whole in-transit design exists to avoid. It would also appear as
 *   its own column on the per-warehouse stock screens, which read the same rows.
 *
 * So in-transit is DERIVED, on demand, from the orders themselves. Nothing persists it and
 * nothing sums it into a total. "Never a fake warehouse row" is load-bearing, not stylistic.
 *
 * Keyed by destination warehouse CODE to match `getWarehouseBreakdown`, whose output this sits
 * beside on every screen that shows both.
 */
export async function getInTransitMap(
  productIds: string[]
): Promise<Map<string, Record<string, number>>> {
  const out = new Map<string, Record<string, number>>();
  if (productIds.length === 0) return out;

  const items = await prisma.transferOrderItem.findMany({
    where: {
      productId: { in: productIds },
      transferOrder: { status: "IN_TRANSIT" },
    },
    select: {
      productId: true,
      quantity: true,
      // The destination is on the HEADER from P14 onward. The item lane is the fallback for
      // an order raised before the header carried it — MIG-2 backfills the agreeing ones, but
      // an order with genuinely mixed item lanes is left with a null header on purpose.
      transferOrder: { select: { toWarehouse: { select: { code: true } } } },
      toWarehouse: { select: { code: true } },
    },
  });

  for (const item of items) {
    const code = item.transferOrder.toWarehouse?.code ?? item.toWarehouse?.code;
    if (!code) continue; // no resolvable destination: not attributable to a warehouse column
    const row = out.get(item.productId) ?? {};
    row[code] = (row[code] ?? 0) + item.quantity;
    out.set(item.productId, row);
  }

  return out;
}

/** Total in transit per product, ignoring destination. */
export async function getInTransitTotals(productIds: string[]): Promise<Map<string, number>> {
  const byWarehouse = await getInTransitMap(productIds);
  const out = new Map<string, number>();
  for (const [productId, row] of byWarehouse) {
    out.set(
      productId,
      Object.values(row).reduce((a, b) => a + b, 0)
    );
  }
  return out;
}
