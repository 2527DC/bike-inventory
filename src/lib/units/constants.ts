import type { AssemblyTaskStatus, Prisma, UnitStatus } from "@prisma/client";

/**
 * Unit lifecycle vocabulary (plan 1709-priority-build-and-stock-flow, Part B, R7).
 *
 * `InventoryUnit` rows are the physical items; `StockLevel` is the count. Every stock write
 * path now moves units with it, and these constants are the one definition of what each
 * state means, so the Awaiting list, the condition page, the dashboard and the stock routes
 * cannot drift apart.
 */

export type Tx = Prisma.TransactionClient;

/**
 * A unit that is physically in its warehouse — what a bin count and a stock count see.
 * Not SOLD / LOST / RESET (gone) and not TRANSFERRED (in a van, belonging to no warehouse).
 */
export const LIVE_UNIT_STATUSES: UnitStatus[] = [
  "RECEIVED",
  "PUT_AWAY",
  "ASSIGNED",
  "IN_ASSEMBLY",
  "ASSEMBLED",
  "RESERVED",
  "RETURNED",
  "DAMAGED",
];

/** Free to be picked for a sale, a transfer or a shortage. */
export const AVAILABLE_UNIT_STATUSES: UnitStatus[] = ["RECEIVED", "PUT_AWAY", "ASSEMBLED"];

/** On a mechanic's bench: picked only when nothing else is left. */
export const IN_TASK_UNIT_STATUSES: UnitStatus[] = ["ASSIGNED", "IN_ASSEMBLY"];

/** Final states. A unit in one of these is never moved, sold or retired again. */
export const FINAL_UNIT_STATUSES: UnitStatus[] = ["SOLD", "LOST", "RESET"];

/** An assembly task a mechanic could still be working on. */
export const OPEN_TASK_STATUSES: AssemblyTaskStatus[] = ["PENDING", "IN_PROGRESS", "ON_HOLD"];

/**
 * R42, P6: a unit is non-assemblable when its own stamp says so — stamped when it enters a
 * non-assemblable bin and kept through transfers. The Awaiting query, the condition page and
 * the dashboard all spread this into their `where`.
 */
export const assemblableUnitWhere = { nonAssemblable: false } satisfies Prisma.InventoryUnitWhereInput;
