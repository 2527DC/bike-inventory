import { createLogger } from "@/lib/logger";
import { AVAILABLE_UNIT_STATUSES, IN_TASK_UNIT_STATUSES, LIVE_UNIT_STATUSES, type Tx } from "./constants";
import { createUnits } from "./create";
import { retireUnits } from "./lifecycle";
import { pickUnitsUpTo } from "./pick";
import { cancelOpenTasks } from "./tasks";

const log = createLogger("units:syncWarehouseUnits");
const logDelta = createLogger("units:adjustWarehouseUnits");

export interface WarehouseUnitsSyncResult {
  createdAssembled: number;
  createdUnassembled: number;
  /** The units this sync created, in code order — the receipt prints labels for exactly these (R31). */
  createdUnitIds: string[];
  /** Retired as LOST — listed with their codes, because those labels are on real items (P9). */
  retired: Array<{ id: string; unitCode: string }>;
  markedAssembled: number;
  markedUnassembled: number;
}

/**
 * What the count says the place holds:
 *   - `assembled` + `unassembled` — the condition split the counter entered;
 *   - `total` — a count with no split (a non-split line in an assemblable bin). Existing
 *     conditions are kept: built units stay built up to the total, the rest are unassembled.
 */
export type WarehouseUnitsSyncInput = {
  productId: string;
  warehouseId: string;
  /**
   * The bin that was counted. When set, ONLY that bin's units are loaded, retired, created and
   * re-marked (plan 2109, R33) — a count of bin A never touches bin B. Null / omitted keeps
   * the older whole-warehouse behaviour, which no new audit reaches (R36).
   */
  binId?: string | null;
} & ({ assembled: number; unassembled: number } | { total: number });

type Unit = {
  id: string;
  unitCode: string;
  status: string;
  binId: string | null;
  assembledAt: Date | null;
  reservedForDeliveryId: string | null;
  createdAt: Date;
};

const bool = (b: boolean) => (b ? 0 : 1);
const onBench = (u: Unit) => (IN_TASK_UNIT_STATUSES as string[]).includes(u.status);
const remarkable = (u: Unit) =>
  (AVAILABLE_UNIT_STATUSES as string[]).includes(u.status) || onBench(u);

/** Which units give way first: unreserved, not on a bench, newest. */
const yieldOrder = (a: Unit, b: Unit) =>
  bool(a.reservedForDeliveryId === null) - bool(b.reservedForDeliveryId === null) ||
  bool(!onBench(a)) - bool(!onBench(b)) ||
  b.createdAt.getTime() - a.createdAt.getTime();

/**
 * Make one product in one bin (or, for an old audit, one warehouse) hold exactly the counted
 * live units — the unit-level audit (R11, Q42) — while KEEPING existing codes, whose labels are
 * already pasted on the items (R46, P9).
 *
 *   1. total too high → retire the surplus as LOST, from whichever condition is over its
 *      count, unreserved / not on a bench / newest first; their codes are returned;
 *   2. total too low  → create the missing units in the condition that is short, in the bin —
 *      this is where items that predate the app get their `U-` codes (R31);
 *   3. re-mark condition on existing units until both counts match (set or clear assembledAt).
 *
 * Doing the count first and the re-mark last means a unit is never re-marked and then retired.
 */
export async function syncWarehouseUnits(tx: Tx, input: WarehouseUnitsSyncInput): Promise<WarehouseUnitsSyncResult> {
  const result: WarehouseUnitsSyncResult = {
    createdAssembled: 0,
    createdUnassembled: 0,
    createdUnitIds: [],
    retired: [],
    markedAssembled: 0,
    markedUnassembled: 0,
  };
  const binId = input.binId ?? null;

  // R33: a bin count sees that bin's units only. Before plan 2109 this `where` had no bin
  // filter, so counting bin A retired bin B's units as LOST.
  const load = () =>
    tx.inventoryUnit.findMany({
      where: {
        productId: input.productId,
        warehouseId: input.warehouseId,
        status: { in: LIVE_UNIT_STATUSES },
        ...(binId ? { binId } : {}),
      },
      select: {
        id: true,
        unitCode: true,
        status: true,
        binId: true,
        assembledAt: true,
        reservedForDeliveryId: true,
        createdAt: true,
      },
    });

  let units: Unit[] = await load();
  const built = units.filter((u) => u.assembledAt !== null);
  const unbuilt = units.filter((u) => u.assembledAt === null);

  // A count with no split keeps what is built, up to the total.
  const targetA =
    "total" in input ? Math.min(built.length, Math.max(0, input.total)) : Math.max(0, input.assembled);
  const targetU =
    "total" in input ? Math.max(0, input.total) - targetA : Math.max(0, input.unassembled);
  const diff = targetA + targetU - units.length;

  if (diff < 0) {
    const surplus = -diff;
    const fromA = Math.min(Math.max(0, built.length - targetA), surplus);
    const fromU = Math.min(Math.max(0, unbuilt.length - targetU), surplus - fromA);
    const chosen = [...built].sort(yieldOrder).slice(0, fromA).concat([...unbuilt].sort(yieldOrder).slice(0, fromU));
    await retireUnits(tx, chosen.map((u) => u.id), "LOST");
    result.retired = chosen.map((u) => ({ id: u.id, unitCode: u.unitCode }));
  } else if (diff > 0) {
    const createA = Math.min(Math.max(0, targetA - built.length), diff);
    const createU = diff - createA;
    const common = { productId: input.productId, warehouseId: input.warehouseId, binId };
    if (createA > 0) result.createdUnitIds.push(...(await createUnits(tx, { ...common, qty: createA, assembled: true })));
    if (createU > 0) result.createdUnitIds.push(...(await createUnits(tx, { ...common, qty: createU, assembled: false })));
    result.createdAssembled = createA;
    result.createdUnassembled = createU;
  }

  if (diff !== 0) units = await load();
  const nowBuilt = units.filter((u) => u.assembledAt !== null);
  const nowUnbuilt = units.filter((u) => u.assembledAt === null);

  if (nowBuilt.length > targetA) {
    // Counted as boxed: clear the build. Units on a bench cannot be "assembled" yet, so none here.
    const chosen = nowBuilt.filter(remarkable).sort(yieldOrder).slice(0, nowBuilt.length - targetA);
    for (const u of chosen) {
      await tx.inventoryUnit.update({
        where: { id: u.id },
        data: { assembledAt: null, assembledById: null, status: u.binId ? "PUT_AWAY" : "RECEIVED" },
      });
    }
    result.markedUnassembled = chosen.length;
  } else if (nowUnbuilt.length > 0 && nowBuilt.length < targetA) {
    // Counted as built: prefer units nobody is working on; a bench unit only if needed, and
    // then its task is closed — the audit found the cycle already built.
    const need = targetA - nowBuilt.length;
    const chosen = nowUnbuilt.filter(remarkable).sort(yieldOrder).slice(0, need);
    const now = new Date();
    await tx.inventoryUnit.updateMany({
      where: { id: { in: chosen.map((u) => u.id) } },
      data: { assembledAt: now, status: "ASSEMBLED" },
    });
    const benched = chosen.filter(onBench).map((u) => u.id);
    if (benched.length) await cancelOpenTasks(tx, benched, "audit counted the unit as assembled");
    result.markedAssembled = chosen.length;
  }

  const wantedRemark = Math.abs(nowBuilt.length - targetA);
  if (result.markedAssembled + result.markedUnassembled < wantedRemark) {
    log.warn("condition could not be fully re-marked (units reserved, damaged or returned)", {
      productId: input.productId,
      warehouseId: input.warehouseId,
      binId,
      wanted: wantedRemark,
      marked: result.markedAssembled + result.markedUnassembled,
    });
  }

  log.info("units synced to audit", {
    productId: input.productId,
    warehouseId: input.warehouseId,
    binId,
    assembled: targetA,
    unassembled: targetU,
    createdAssembled: result.createdAssembled,
    createdUnassembled: result.createdUnassembled,
    retired: result.retired.length,
    markedAssembled: result.markedAssembled,
    markedUnassembled: result.markedUnassembled,
  });
  return result;
}

/**
 * A count change with no condition split (older clients, whole-store audits): a surplus
 * becomes new unassembled units; a shortage retires units as LOST — unassembled and newest
 * first. Tolerant: a shortage on stock with fewer unit records retires only what exists.
 *
 * Not bin-aware on a shortage: it may retire units from any bin of the warehouse. Since plan
 * 2109 (R33, R36) the stock count applies only bin audits and uses `syncWarehouseUnits` with a
 * `binId` for every line, so nothing calls this today; kept for a caller that genuinely means
 * "anywhere in the warehouse".
 */
export async function adjustWarehouseUnits(
  tx: Tx,
  input: { productId: string; warehouseId: string; delta: number; binId?: string | null }
): Promise<{ created: number; retired: Array<{ id: string; unitCode: string }> }> {
  if (input.delta > 0) {
    const ids = await createUnits(tx, {
      productId: input.productId,
      warehouseId: input.warehouseId,
      qty: input.delta,
      binId: input.binId ?? null,
    });
    return { created: ids.length, retired: [] };
  }
  if (input.delta < 0) {
    const ids = await pickUnitsUpTo(tx, {
      productId: input.productId,
      warehouseId: input.warehouseId,
      qty: -input.delta,
      order: "shortage",
    });
    const rows = ids.length
      ? await tx.inventoryUnit.findMany({ where: { id: { in: ids } }, select: { id: true, unitCode: true } })
      : [];
    await retireUnits(tx, ids, "LOST");
    logDelta.info("shortage retired units", {
      productId: input.productId,
      warehouseId: input.warehouseId,
      shortage: -input.delta,
      retired: rows.length,
    });
    return { created: 0, retired: rows };
  }
  return { created: 0, retired: [] };
}
