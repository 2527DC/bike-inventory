import type { Prisma } from "@prisma/client";
import { adjustWarehouseQty } from "@/lib/stock-location";
import { syncWarehouseUnits, type WarehouseUnitsSyncResult } from "@/lib/units";

type Tx = Prisma.TransactionClient;

export interface BinCountLine {
  productId: string;
  warehouseId: string;
  binId: string;
  /** R32: a non-assemblable bin's count has no condition — all of it is unassembled. */
  nonAssemblable: boolean;
  counted: number;
  /** What the bin held when the approval read it (`getBinQtyMap`) — the counter's "system". */
  live: number;
  /** The counter's split, when an assemblable bin was counted with it. */
  assembledQty: number | null;
  unassembledQty: number | null;
}

export interface BinCountLineResult {
  delta: number;
  synced: WarehouseUnitsSyncResult;
  warehouseBefore: number;
  warehouseAfter: number;
}

/**
 * Apply ONE counted line of a bin audit to stock (plan 2109, R31–R33). The stock half of the
 * approval, kept apart from its evidence (events, movement log, ledger) so the rule can be
 * checked on its own — `scripts/verify-bin-count-r33.ts` runs it against a rolled-back
 * transaction.
 *
 *   1. The bin's units are made to match the count, in THAT bin only, keeping existing codes
 *      and creating codes for items that have none (R31, R33).
 *   2. The warehouse total moves by the bin's difference — never set to the bin's count,
 *      which is what used to erase every other bin of the warehouse (R33).
 *   3. The typed-in `BinStock` row follows the count.
 */
export async function applyBinCountLine(tx: Tx, line: BinCountLine): Promise<BinCountLineResult> {
  const delta = line.counted - line.live;
  const hasSplit = line.assembledQty !== null && line.unassembledQty !== null;

  const synced = await syncWarehouseUnits(tx, {
    productId: line.productId,
    warehouseId: line.warehouseId,
    binId: line.binId,
    ...(line.nonAssemblable
      ? { assembled: 0, unassembled: line.counted }
      : hasSplit
        ? { assembled: line.assembledQty!, unassembled: line.unassembledQty! }
        : { total: line.counted }),
  });

  const level = await tx.stockLevel.findUnique({
    where: { productId_warehouseId: { productId: line.productId, warehouseId: line.warehouseId } },
    select: { quantity: true },
  });
  const warehouseBefore = level?.quantity ?? 0;
  if (delta === 0) return { delta, synced, warehouseBefore, warehouseAfter: warehouseBefore };

  await adjustWarehouseQty(tx, line.productId, line.warehouseId, delta);
  const warehouseAfter = Math.max(0, warehouseBefore + delta);

  // For a product tracked by units this is already what `syncBinStock` wrote; for one that
  // never had a unit and was counted 0 it is the only thing that clears the old figure.
  await tx.binStock.upsert({
    where: { binId_productId: { binId: line.binId, productId: line.productId } },
    create: { binId: line.binId, productId: line.productId, quantity: line.counted },
    update: { quantity: line.counted },
  });

  return { delta, synced, warehouseBefore, warehouseAfter };
}
