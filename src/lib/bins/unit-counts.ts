import { prisma } from "@/lib/db";
import { LIVE_UNIT_STATUSES } from "@/lib/units";
import { createLogger } from "@/lib/logger";

const log = createLogger("bins:unit-counts");

/**
 * What a bin holds, as the bins screen shows it (plan 2109, R5 / Q9).
 *
 * Counts LIVE units only (`LIVE_UNIT_STATUSES` — sold, lost, reset and in-transit units are
 * gone from the shelf) and splits them on `assembledAt`, the same test `src/lib/units/pick.ts`
 * uses. A non-assemblable bin still gets all three numbers; the screen shows Total only.
 */
export interface BinUnitCounts {
  total: number;
  assembled: number;
  unassembled: number;
}

export const EMPTY_BIN_COUNTS: BinUnitCounts = { total: 0, assembled: 0, unassembled: 0 };

/**
 * One `groupBy` for any number of bins — never one query per bin. `_count.assembledAt` counts
 * the non-null values, which is exactly "assembled".
 */
export async function getBinUnitCounts(binIds: string[]): Promise<Map<string, BinUnitCounts>> {
  const out = new Map<string, BinUnitCounts>();
  if (binIds.length === 0) return out;

  const started = Date.now();
  const rows = await prisma.inventoryUnit.groupBy({
    by: ["binId"],
    where: { binId: { in: binIds }, status: { in: LIVE_UNIT_STATUSES } },
    _count: { _all: true, assembledAt: true },
  });
  for (const r of rows) {
    if (!r.binId) continue;
    const total = r._count._all;
    const assembled = r._count.assembledAt;
    out.set(r.binId, { total, assembled, unassembled: total - assembled });
  }
  log.debug("bin unit counts", { bins: binIds.length, withUnits: rows.length, ms: Date.now() - started });
  return out;
}
