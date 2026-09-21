import type { Prisma } from "@prisma/client";

/**
 * The `/inbound` quick filters — plan 2109-inbound-bins-navigation-fixes, R30 (Q22a, Q23a).
 *
 * One definition, read by `GET /api/inbound` (the list and the per-chip counts) and by the
 * dashboard's "inbound approvals waiting" card, so a chip and the card that links to it cannot
 * disagree about what "not approved" means.
 *
 * "Not approved" is the test `src/lib/approvals/pending.ts` used before inbound left the
 * `/approvals` screen (R8): raised, not approved, not sent back, not already on the shelf.
 */

export const INBOUND_QUICK_FILTERS = [
  "not_approved",
  "returned",
  "approved_not_received",
  "partial",
  "completed",
  "this_week",
] as const;

export type InboundQuickFilter = (typeof INBOUND_QUICK_FILTERS)[number];

export function isInboundQuickFilter(value: string | null | undefined): value is InboundQuickFilter {
  return !!value && (INBOUND_QUICK_FILTERS as readonly string[]).includes(value);
}

/** End of this week (Sunday), the same arithmetic `api/inbound` and `api/inbound/stats` use. */
export function inboundWeekEnd(now: Date = new Date()): Date {
  const weekEnd = new Date(now);
  weekEnd.setDate(weekEnd.getDate() + (7 - weekEnd.getDay()));
  return weekEnd;
}

/** Raised, not approved, not sent back, not received in full. */
export const INBOUND_NOT_APPROVED_WHERE: Prisma.InboundShipmentWhereInput = {
  approvedAt: null,
  rejectedAt: null,
  status: { not: "DELIVERED" },
};

export function inboundQuickFilterWhere(
  filter: InboundQuickFilter,
  now: Date = new Date()
): Prisma.InboundShipmentWhereInput {
  switch (filter) {
    case "not_approved":
      return INBOUND_NOT_APPROVED_WHERE;
    case "returned":
      return { rejectedAt: { not: null }, approvedAt: null };
    case "approved_not_received":
      return { approvedAt: { not: null }, status: "IN_TRANSIT" };
    case "partial":
      return { status: "PARTIALLY_DELIVERED" };
    case "completed":
      return { status: "DELIVERED" };
    case "this_week":
      // As the old `status=arriving_this_week`.
      return { status: "IN_TRANSIT", expectedDeliveryDate: { lte: inboundWeekEnd(now) } };
  }
}
