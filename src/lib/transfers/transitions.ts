import type { TransferOrderStatus } from "@prisma/client";

/**
 * The transfer-order state machine.
 *
 * ─── WHAT CHANGED, AND WHY IT MATTERS MORE THAN IT LOOKS ──────────────────────────────────
 *
 * Before P14 a transfer had three real states and approval MOVED THE STOCK. Approving was the
 * whole movement: source decremented, destination incremented, one ledger row, done. That is
 * why the old approve route wrote `adjustWarehouseQty` twice.
 *
 * Now the movement is two events — stock LEAVES at dispatch and ARRIVES at receipt — because
 * between a godown in one store and a godown in another there is a van, and the units are
 * genuinely in neither building for an hour. Approval agrees to the move; it does not perform
 * it.
 *
 * The consequence to keep in mind when reading this table: **APPROVED now means "nothing has
 * moved yet"**, where before it meant "everything has moved". MIG-2 rewrites the legacy
 * APPROVED rows to RECEIVED for exactly that reason — left alone they would be dispatchable a
 * second time, and the stock would leave twice.
 *
 * Shape copied from `src/lib/purchase-orders/status.ts` (P9), which copied
 * `api/stock-counts/[id]/route.ts`. Same lesson learned there applies here: THIS TABLE IS THE
 * ONLY OPINION. A route that also decides for itself is how the purchase-order guards came to
 * disagree three ways.
 */
export const TRANSFER_TRANSITIONS: Record<TransferOrderStatus, TransferOrderStatus[]> = {
  PENDING: ["APPROVED", "REJECTED", "CANCELLED"],
  // IN_TRANSIT is reachable only through POST /[id]/dispatch, and it IS listed here — P9's
  // hard-won lesson. Leaving SENT_TO_VENDOR out of the PO table on the reasoning that "the
  // transition belongs to the route" made every press of that button return 409, because the
  // route asked the table for permission. The route is what holds the grant and stamps the
  // dispatch fields; the table only says the move is legal.
  APPROVED: ["IN_TRANSIT", "CANCELLED"],
  // Cancel from IN_TRANSIT is deliberately absent (v1). The stock has already left the source
  // and is sitting in a van; "cancelled" would leave those units in no warehouse at all. The
  // way to undo a dispatch that went wrong is to receive it — at the destination, or with a
  // shortfall — so the units land somewhere real and the ledger says what happened.
  IN_TRANSIT: ["RECEIVED"],
  RECEIVED: [],
  REJECTED: [],
  CANCELLED: [],
};

/** The statuses a transfer can still be cancelled from. Derived, so it cannot drift. */
export const CANCELLABLE_STATUSES = (
  Object.keys(TRANSFER_TRANSITIONS) as TransferOrderStatus[]
).filter((s) => TRANSFER_TRANSITIONS[s].includes("CANCELLED"));

/** Statuses in which the goods have physically left the source warehouse. */
export const MOVED_STATUSES: TransferOrderStatus[] = ["IN_TRANSIT", "RECEIVED"];

export function canTransition(from: TransferOrderStatus, to: TransferOrderStatus): boolean {
  return TRANSFER_TRANSITIONS[from]?.includes(to) ?? false;
}

const HUMAN = (s: TransferOrderStatus) => s.replace(/_/g, " ").toLowerCase();

/**
 * The sentence to refuse an illegal move with.
 *
 * Says what CAN happen next rather than only what cannot, because the states with no way out
 * — received, rejected, cancelled — are exactly where a bare "invalid transition" leaves
 * somebody stuck with no idea what to press.
 */
export function transitionError(from: TransferOrderStatus, to: TransferOrderStatus): string {
  const allowed = TRANSFER_TRANSITIONS[from] ?? [];

  if (from === "IN_TRANSIT" && to === "CANCELLED") {
    return "This transfer has already been dispatched and cannot be cancelled. Receive it instead — record a shortfall if some or all of it did not arrive.";
  }
  if (allowed.length === 0) {
    return `This transfer is ${HUMAN(from)} and cannot change further.`;
  }
  return `Cannot change a ${HUMAN(from)} transfer to ${HUMAN(to)}. It can go to ${allowed
    .map(HUMAN)
    .join(" or ")}.`;
}

/**
 * Thrown by `assertTransition`. Carries the 409 the routes answer with, so a caller does not
 * have to decide the status code for a state-machine refusal.
 */
export class TransitionError extends Error {
  readonly status = 409;
  constructor(message: string) {
    super(message);
    this.name = "TransitionError";
  }
}

/** Throw unless the move is legal. Every route that changes `status` calls this first. */
export function assertTransition(from: TransferOrderStatus, to: TransferOrderStatus): void {
  if (!canTransition(from, to)) throw new TransitionError(transitionError(from, to));
}
