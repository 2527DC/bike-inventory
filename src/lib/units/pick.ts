import { createLogger } from "@/lib/logger";
import { AVAILABLE_UNIT_STATUSES, IN_TASK_UNIT_STATUSES, LIVE_UNIT_STATUSES, type Tx } from "./constants";

const log = createLogger("units:pickUnits");

export interface PickUnitsInput {
  productId: string;
  warehouseId: string;
  qty: number;
  /** The outward being served. Its reserved units come first; other outwards' are never taken. */
  reservedForDeliveryId?: string | null;
  /**
   * `sale` (default, Q41): reserved for this outward → built first → oldest first.
   * `shortage` (an audit found fewer): unreserved → not on a bench → unassembled → newest first.
   */
  order?: "sale" | "shortage";
  /** Units already chosen by the caller in this transaction. */
  excludeUnitIds?: string[];
}

type Candidate = {
  id: string;
  status: string;
  assembledAt: Date | null;
  nonAssemblable: boolean;
  reservedForDeliveryId: string | null;
  createdAt: Date;
};

/** Ready to hand over without a build: assembled, or an item that needs no assembly (P7). */
const isReady = (c: Candidate) => c.assembledAt !== null || c.nonAssemblable;
const inTask = (c: Candidate) => (IN_TASK_UNIT_STATUSES as string[]).includes(c.status);

async function rankedCandidates(tx: Tx, input: PickUnitsInput): Promise<Candidate[]> {
  const order = input.order ?? "sale";
  const rows = await tx.inventoryUnit.findMany({
    where: {
      productId: input.productId,
      warehouseId: input.warehouseId,
      status: { in: [...AVAILABLE_UNIT_STATUSES, ...IN_TASK_UNIT_STATUSES] },
      ...(input.excludeUnitIds?.length ? { id: { notIn: input.excludeUnitIds } } : {}),
      // A sale never takes a unit held for ANOTHER outward. A shortage is physical — the
      // missing cycle may be a held one — so it may, but only last (sorted below).
      ...(order === "sale"
        ? {
            OR: [
              { reservedForDeliveryId: null },
              ...(input.reservedForDeliveryId ? [{ reservedForDeliveryId: input.reservedForDeliveryId }] : []),
            ],
          }
        : {}),
    },
    select: {
      id: true,
      status: true,
      assembledAt: true,
      nonAssemblable: true,
      reservedForDeliveryId: true,
      createdAt: true,
    },
  });

  const bool = (b: boolean) => (b ? 0 : 1); // true sorts first
  if (order === "sale") {
    const mine = (c: Candidate) => !!input.reservedForDeliveryId && c.reservedForDeliveryId === input.reservedForDeliveryId;
    return rows.sort(
      (a, b) =>
        // The customer's own held cycle first, even if it is on a bench: it IS their cycle.
        bool(mine(a)) - bool(mine(b)) ||
        // Units on a bench only when nothing else is left.
        bool(!inTask(a)) - bool(!inTask(b)) ||
        bool(isReady(a)) - bool(isReady(b)) ||
        a.createdAt.getTime() - b.createdAt.getTime()
    );
  }
  return rows.sort(
    (a, b) =>
      bool(a.reservedForDeliveryId === null) - bool(b.reservedForDeliveryId === null) ||
      bool(!inTask(a)) - bool(!inTask(b)) ||
      bool(!isReady(a)) - bool(!isReady(b)) ||
      b.createdAt.getTime() - a.createdAt.getTime()
  );
}

/**
 * Choose `qty` units of a product in a warehouse (R7, Q41). Throws when fewer exist.
 *
 * Call it AFTER the caller's `StockLevel` write for the same product and warehouse: that
 * write row-locks the level, so a concurrent sale or dispatch waits there and never picks the
 * same units.
 */
export async function pickUnits(tx: Tx, input: PickUnitsInput): Promise<string[]> {
  if (input.qty <= 0) return [];
  const ranked = await rankedCandidates(tx, input);
  if (ranked.length < input.qty) {
    log.warn("not enough units to pick", {
      productId: input.productId,
      warehouseId: input.warehouseId,
      needed: input.qty,
      available: ranked.length,
      order: input.order ?? "sale",
    });
    throw new Error(
      `Only ${ranked.length} unit record${ranked.length === 1 ? "" : "s"} of this product can be picked in that warehouse; ${input.qty} needed.`
    );
  }
  return ranked.slice(0, input.qty).map((c) => c.id);
}

/**
 * The tolerant twin of `pickUnits`: up to `qty` units, never throws.
 *
 * For stock that predates units (P8, P11): a warehouse may hold 10 by count and 3 by unit
 * record, and a sale of 5 must still go through — it sells the 3 units that exist. Logged at
 * warn when the product IS tracked there but came up short (units and count disagree), at
 * debug when it has no unit records there at all (plain older stock).
 */
export async function pickUnitsUpTo(tx: Tx, input: PickUnitsInput): Promise<string[]> {
  if (input.qty <= 0) return [];
  const ranked = await rankedCandidates(tx, input);
  const picked = ranked.slice(0, input.qty).map((c) => c.id);
  if (picked.length < input.qty) {
    const tracked = await tx.inventoryUnit.count({
      where: { productId: input.productId, warehouseId: input.warehouseId, status: { in: LIVE_UNIT_STATUSES } },
    });
    const ctx = {
      productId: input.productId,
      warehouseId: input.warehouseId,
      needed: input.qty,
      picked: picked.length,
      liveUnits: tracked,
      order: input.order ?? "sale",
    };
    if (tracked > 0) log.warn("fewer units than quantity — units and stock count disagree", ctx);
    else log.debug("no unit records for this stock — quantity-only movement", ctx);
  }
  return picked;
}
