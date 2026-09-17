import { createLogger } from "@/lib/logger";
import { FINAL_UNIT_STATUSES, type Tx } from "./constants";
import { syncBinStock } from "./bin-stock";

const log = createLogger("units:placeUnitsInBin");

/** A move the bin rules forbid (P6). Routes turn it into a 400 with this message. */
export class BinMoveRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BinMoveRefused";
  }
}

/**
 * P6: a non-assemblable item may NOT go into an assemblable bin — otherwise a spare would
 * start showing on the build line. The reverse (assemblable into a non-assemblable bin) is
 * allowed and stamps the unit (P6b), which `placeUnitsInBin` does.
 */
export function assertBinMoveAllowed(
  unit: { unitCode?: string | null; nonAssemblable: boolean },
  destBin: { code: string; nonAssemblable: boolean }
): void {
  if (unit.nonAssemblable && !destBin.nonAssemblable) {
    throw new BinMoveRefused(
      `${unit.unitCode ?? "This item"} needs no assembly and cannot go into bin ${destBin.code}, which holds items that need assembly. Pick a no-assembly bin.`
    );
  }
}

/**
 * Put units into a bin: checks P6, sets `binId`, moves RECEIVED units to PUT_AWAY (other
 * statuses — ASSEMBLED, on a bench — keep theirs), stamps `nonAssemblable` when the bin is
 * non-assemblable (P6b), and recounts both the old and the new bins (P11).
 *
 * Refuses units that are gone (sold / lost / reset), in transit, or in another warehouse.
 * Writes no `BinMovementLog` — the caller knows who moved them and why.
 */
export async function placeUnitsInBin(
  tx: Tx,
  unitIds: string[],
  binId: string
): Promise<{ placed: number; fromBinIds: string[] }> {
  const ids = [...new Set(unitIds)];
  if (ids.length === 0) return { placed: 0, fromBinIds: [] };

  const bin = await tx.bin.findUnique({
    where: { id: binId },
    select: { id: true, code: true, warehouseId: true, nonAssemblable: true, isActive: true },
  });
  if (!bin || !bin.isActive) throw new BinMoveRefused("That bin does not exist or is not active.");

  const units = await tx.inventoryUnit.findMany({
    where: { id: { in: ids } },
    select: { id: true, unitCode: true, binId: true, warehouseId: true, nonAssemblable: true, status: true },
  });
  if (units.length !== ids.length) throw new BinMoveRefused("Some of those units no longer exist.");

  for (const u of units) {
    if (FINAL_UNIT_STATUSES.includes(u.status) || u.status === "TRANSFERRED") {
      throw new BinMoveRefused(`${u.unitCode} is ${u.status.toLowerCase()} and cannot be put in a bin.`);
    }
    if (u.warehouseId !== bin.warehouseId) {
      throw new BinMoveRefused(`${u.unitCode} is in another warehouse, not the one bin ${bin.code} is in.`);
    }
    assertBinMoveAllowed(u, bin);
  }

  const stamp = bin.nonAssemblable ? { nonAssemblable: true } : {};
  const received = units.filter((u) => u.status === "RECEIVED").map((u) => u.id);
  const others = units.filter((u) => u.status !== "RECEIVED").map((u) => u.id);
  if (received.length) {
    await tx.inventoryUnit.updateMany({
      where: { id: { in: received } },
      data: { binId: bin.id, status: "PUT_AWAY", ...stamp },
    });
  }
  if (others.length) {
    await tx.inventoryUnit.updateMany({ where: { id: { in: others } }, data: { binId: bin.id, ...stamp } });
  }

  const fromBinIds = [...new Set(units.map((u) => u.binId).filter((b): b is string => !!b && b !== bin.id))];
  await syncBinStock(tx, [...fromBinIds, bin.id]);

  const stamped = bin.nonAssemblable ? units.filter((u) => !u.nonAssemblable).length : 0;
  log.info("units placed in bin", { binId: bin.id, units: units.length, fromBins: fromBinIds.length, stamped });
  return { placed: units.length, fromBinIds };
}
