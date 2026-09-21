import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { LIVE_UNIT_STATUSES } from "./constants";

type DbClient = Prisma.TransactionClient | typeof prisma;

/**
 * What ONE bin holds of each product — the "system" figure of a bin-scoped stock count
 * (plan 2109, R33).
 *
 * A bin count must be shown, compared and applied against the same number. It used to be
 * shown the bin's quantity and applied against the whole warehouse's, so a perfect count of
 * bin A wrote off bin B's stock. Every stock-count path that needs a bin's quantity reads it
 * here, so the screen, the stale check and the approval cannot disagree.
 *
 * Units are the truth (P11): a product with unit records anywhere counts its LIVE units in
 * this bin. A product that has never had a unit keeps its typed-in `BinStock.quantity` — the
 * same rule `syncBinStock` follows — so stock nobody has coded yet is not read as zero.
 *
 * `productIds` omitted = every product recorded in the bin (a BinStock row or a live unit).
 */
export async function getBinQtyMap(
  binId: string,
  productIds?: string[],
  client: DbClient = prisma
): Promise<Map<string, number>> {
  if (productIds && productIds.length === 0) return new Map();
  const productFilter = productIds ? { productId: { in: productIds } } : {};

  const [binStocks, liveUnits] = await Promise.all([
    client.binStock.findMany({
      where: { binId, ...productFilter },
      select: { productId: true, quantity: true },
    }),
    client.inventoryUnit.groupBy({
      by: ["productId"],
      where: { binId, status: { in: LIVE_UNIT_STATUSES }, ...productFilter },
      _count: { _all: true },
    }),
  ]);

  const unitCount = new Map(liveUnits.map((u) => [u.productId, u._count._all]));
  const out = new Map<string, number>(unitCount);

  // Rows with no live unit in this bin: 0 when the product is tracked by units somewhere,
  // otherwise the typed-in quantity (P11).
  const untrackedCandidates = binStocks.filter((b) => !unitCount.has(b.productId)).map((b) => b.productId);
  const tracked = new Set<string>();
  if (untrackedCandidates.length > 0) {
    const withUnits = await client.inventoryUnit.findMany({
      where: { productId: { in: untrackedCandidates } },
      select: { productId: true },
      distinct: ["productId"],
    });
    for (const u of withUnits) tracked.add(u.productId);
  }
  for (const b of binStocks) {
    if (unitCount.has(b.productId)) continue;
    out.set(b.productId, tracked.has(b.productId) ? 0 : Math.max(0, b.quantity));
  }
  return out;
}
