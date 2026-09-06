import type { POStatus } from "@prisma/client";

/**
 * The purchase-order state machine.
 *
 * ─── WHAT THIS REPLACES ──────────────────────────────────────────────────────────────────
 *
 * Three ad-hoc guards, none of which agreed with the others:
 *
 *   1. `api/purchase-orders/[id]/route.ts` — a hardcoded copy of the enum plus ONE rule
 *      ("SENT_TO_VENDOR requires APPROVED"). Every other move was free, so `RECEIVED → DRAFT`,
 *      `CANCELLED → APPROVED` and `DRAFT → RECEIVED` all succeeded. Worse, that route accepted
 *      `status: "APPROVED"` directly — routing around the approve route entirely and leaving
 *      `approvedById` and `approvedAt` null, so a PO could be approved with no authoriser on
 *      record and without holding `purchase_orders.approve`.
 *   2. `api/purchase-orders/[id]/approve/route.ts` — accepted DRAFT *or* PENDING_APPROVAL, so
 *      nothing was ever approved FROM the pending state and the review step did not exist.
 *   3. The detail screen's button conditions, which were a third opinion again.
 *
 * All three now defer to this table. Leaving any of them in place would mean two answers to
 * "can this PO move?", which is how the first three came to disagree.
 *
 * Shape copied from `api/stock-counts/[id]/route.ts`'s VALID_TRANSITIONS — the only real state
 * machine that existed in this codebase before P9.
 */
export const PO_TRANSITIONS: Record<POStatus, POStatus[]> = {
  DRAFT: ["PENDING_APPROVAL", "CANCELLED"],
  // APPROVED is deliberately ABSENT here. It is reachable only through
  // POST /api/purchase-orders/[id]/approve, which holds the `purchase_orders.approve` grant
  // and writes approvedById/approvedAt. If APPROVED were listed, the PUT route would become a
  // second, ungated way in — which is the bug this table exists to close.
  PENDING_APPROVAL: ["DRAFT", "CANCELLED"],
  // SENT_TO_VENDOR likewise: it belongs to the mark-sent route (and to P12's email send),
  // because leaving APPROVED must also stamp sentAt/sentVia/sendCount. A bare status write
  // would say the PO was sent while every column recording the send stayed null.
  APPROVED: ["DRAFT", "CANCELLED"],
  SENT_TO_VENDOR: ["PARTIALLY_RECEIVED", "RECEIVED", "CANCELLED"],
  PARTIALLY_RECEIVED: ["RECEIVED", "CANCELLED"],
  RECEIVED: [],
  CANCELLED: [],
};

/**
 * The statuses in which a PO is still "open" — it may yet be received, so ordering the same
 * product again is probably a mistake.
 *
 * RECEIVED and CANCELLED are excluded on purpose: the goods arrived, or the order was called
 * off, and in both cases re-ordering is a legitimate thing to do.
 */
export const OPEN_PO_STATUSES: POStatus[] = [
  "DRAFT",
  "PENDING_APPROVAL",
  "APPROVED",
  "SENT_TO_VENDOR",
  "PARTIALLY_RECEIVED",
];

/** Statuses a PO can still be cancelled from. Derived, so it cannot drift from the table. */
export const CANCELLABLE_STATUSES = (Object.keys(PO_TRANSITIONS) as POStatus[]).filter((s) =>
  PO_TRANSITIONS[s].includes("CANCELLED")
);

export function canTransition(from: POStatus, to: POStatus): boolean {
  return PO_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * The sentence to answer an illegal move with.
 *
 * Written to say what the person can do next rather than only what they cannot, because the
 * three states with no way out (RECEIVED, CANCELLED, and an already-approved PO someone is
 * trying to edit) are exactly where a bare "invalid transition" leaves someone stuck.
 */
export function transitionError(from: POStatus, to: POStatus): string {
  const allowed = PO_TRANSITIONS[from] ?? [];

  if (to === "APPROVED") {
    return "Use the Approve action";
  }
  if (to === "SENT_TO_VENDOR") {
    return "Use Send to vendor or Mark sent";
  }
  if (allowed.length === 0) {
    return `This purchase order is ${from.toLowerCase().replace(/_/g, " ")} and cannot change further.`;
  }
  return `Cannot change a ${from.replace(/_/g, " ").toLowerCase()} purchase order to ${to
    .replace(/_/g, " ")
    .toLowerCase()}. It can go to ${allowed.map((s) => s.replace(/_/g, " ").toLowerCase()).join(" or ")}.`;
}

/**
 * The states in which the header fields (notes, expected date) may still be edited.
 *
 * Once a PO is approved, its content is what somebody authorised; once it is sent, it is a
 * document in the vendor's inbox. Editing either silently would make the record disagree with
 * what was approved or with what the vendor is holding — so the answer is "re-open it to
 * draft first", which clears the approval and makes the change visible.
 */
export const EDITABLE_STATUSES: POStatus[] = ["DRAFT", "PENDING_APPROVAL"];

export function isEditable(status: POStatus): boolean {
  return EDITABLE_STATUSES.includes(status);
}
