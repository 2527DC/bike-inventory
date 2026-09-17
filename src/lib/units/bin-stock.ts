import { createLogger } from "@/lib/logger";
import { LIVE_UNIT_STATUSES, type Tx } from "./constants";

const log = createLogger("units:syncBinStock");

/**
 * Recount `BinStock` from the units in each bin (R38, P11 — units are the truth).
 *
 * For every bin given: `BinStock.quantity` per product = the number of LIVE units of that
 * product sitting in the bin. A product that has no unit record ANYWHERE keeps today's
 * `BinStock` row untouched — its bin quantity was typed in before units existed, and zeroing
 * it would erase stock nobody has generated codes for yet (P8, P11).
 *
 * Called by every unit helper that changes a unit's `binId` or status, for the bins it
 * touched, inside the caller's transaction.
 */
export async function syncBinStock(tx: Tx, binIds: Array<string | null | undefined>): Promise<void> {
  const ids = [...new Set(binIds.filter((b): b is string => typeof b === "string" && b.length > 0))];
  if (ids.length === 0) return;

  const counts = await tx.inventoryUnit.groupBy({
    by: ["binId", "productId"],
    where: { binId: { in: ids }, status: { in: LIVE_UNIT_STATUSES } },
    _count: { _all: true },
  });
  const existing = await tx.binStock.findMany({
    where: { binId: { in: ids } },
    select: { id: true, binId: true, productId: true, quantity: true },
  });

  const key = (binId: string, productId: string) => `${binId}|${productId}`;
  const counted = new Map<string, number>();
  for (const c of counts) {
    if (c.binId) counted.set(key(c.binId, c.productId), c._count._all);
  }
  const rows = new Map(existing.map((r) => [key(r.binId, r.productId), r]));

  // Rows holding a quantity but no live unit: zero them only for products that are tracked
  // by units somewhere (P11). Untracked products keep their typed-in bin quantity.
  const orphanProducts = [
    ...new Set(
      existing
        .filter((r) => r.quantity !== 0 && !counted.has(key(r.binId, r.productId)))
        .map((r) => r.productId)
    ),
  ];
  const tracked = new Set<string>();
  if (orphanProducts.length > 0) {
    const withUnits = await tx.inventoryUnit.findMany({
      where: { productId: { in: orphanProducts } },
      select: { productId: true },
      distinct: ["productId"],
    });
    for (const u of withUnits) tracked.add(u.productId);
  }

  let zeroed = 0;
  let set = 0;
  for (const r of existing) {
    if (r.quantity === 0 || counted.has(key(r.binId, r.productId)) || !tracked.has(r.productId)) continue;
    await tx.binStock.update({ where: { id: r.id }, data: { quantity: 0 } });
    zeroed += 1;
  }
  for (const [k, n] of counted) {
    const row = rows.get(k);
    if (row && row.quantity === n) continue;
    const [binId, productId] = k.split("|");
    await tx.binStock.upsert({
      where: { binId_productId: { binId, productId } },
      update: { quantity: n },
      create: { binId, productId, quantity: n },
    });
    set += 1;
  }

  log.debug("bin stock recounted from units", { bins: ids.length, rowsSet: set, rowsZeroed: zeroed });
}
