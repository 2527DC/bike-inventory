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

/**
 * What every ACTIVE bin of one warehouse holds of each of several products — plan 0310, Part C
 * (2209 Phase 1): the From-bin picker on a transfer line, and the server's check that the chosen
 * bin holds the line's quantity. Both read this one function, so the screen and the refusal agree.
 *
 * The same rule as `getBinQtyMap`, for many bins in two queries instead of one call per bin: live
 * units count where a product has units anywhere; otherwise the typed-in `BinStock` quantity.
 *
 * Returns productId → binId → qty, with only quantities above 0.
 */
export async function getWarehouseBinQty(
  warehouseId: string,
  productIds: string[],
  client: DbClient = prisma
): Promise<Map<string, Map<string, number>>> {
  const out = new Map<string, Map<string, number>>();
  if (productIds.length === 0) return out;

  const [liveUnits, binStocks, withUnits] = await Promise.all([
    client.inventoryUnit.groupBy({
      by: ["binId", "productId"],
      where: {
        warehouseId,
        productId: { in: productIds },
        status: { in: LIVE_UNIT_STATUSES },
        bin: { isActive: true },
      },
      _count: { _all: true },
    }),
    client.binStock.findMany({
      where: { productId: { in: productIds }, quantity: { gt: 0 }, bin: { warehouseId, isActive: true } },
      select: { binId: true, productId: true, quantity: true },
    }),
    client.inventoryUnit.findMany({
      where: { productId: { in: productIds } },
      select: { productId: true },
      distinct: ["productId"],
    }),
  ]);

  const put = (productId: string, binId: string, qty: number) => {
    if (qty <= 0) return;
    const bins = out.get(productId) ?? new Map<string, number>();
    bins.set(binId, (bins.get(binId) ?? 0) + qty);
    out.set(productId, bins);
  };
  for (const u of liveUnits) if (u.binId) put(u.productId, u.binId, u._count._all);
  const tracked = new Set(withUnits.map((u) => u.productId));
  for (const b of binStocks) if (!tracked.has(b.productId)) put(b.productId, b.binId, b.quantity);
  return out;
}
