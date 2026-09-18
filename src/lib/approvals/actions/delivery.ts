// Outbound approval (plan 1709-priority-build-and-stock-flow, R26a, R25, Q15, Q16, Q37).
//
// ─── WHY THIS IS A LIBRARY AND NOT A ROUTE ────────────────────────────────────────────────
//
// `POST /api/deliveries/[id]/approval` is one caller. Part D's Requests page and Phase 4's
// quick-approve notification action are others, and a notification button that re-implemented
// the approval would be a second, divergent definition of what "approved" means. So these three
// functions take the caller's transaction client and the signed-in user, write the Delivery
// columns plus the `ApprovalEvent`, and return a DESCRIPTION of what to notify. They do no HTTP,
// read no session and send nothing — the caller sends, after its transaction has committed
// (notify §F.0).
//
// ─── THE RULE THE DISPATCH GATE READS ─────────────────────────────────────────────────────
//
// `OUT_FOR_DELIVERY` and `SHIPPED` need an approval that has not since been returned. That is a
// COMPARISON, not a flag: `approvalReturnedAt` is kept as history (R25 — the approver's note has
// to survive so the creator can read what to fix), so "approved" means `approvedAt` is set and is
// not older than the last return. Walk-outs need no approval at all, and a Dummy is excluded from
// the whole mechanism (Q37).

import type { ApprovalActivity } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import { recordApprovalEvent } from "@/lib/approvals/events";
import { logActivity } from "@/lib/activity-log";
import { usersWithPermission } from "@/lib/rbac";
import { notify } from "@/lib/notify";
import { createLogger } from "@/lib/logger";

const log = createLogger("approvals:delivery");

type Tx = Prisma.TransactionClient;

const ACTIVITY: ApprovalActivity = "OUTBOUND";

/** Statuses at which an approval is pointless — the outward has already gone, or never needed one. */
const PAST_APPROVAL = ["OUT_FOR_DELIVERY", "SHIPPED", "IN_TRANSIT", "DELIVERED", "WALK_OUT"];

/** The columns every function here reads. Any caller can select exactly this. */
export interface DeliveryForApproval {
  id: string;
  invoiceNo: string;
  status: string;
  warehouseId: string | null;
  approvalRequestedAt: Date | null;
  approvalRequestedById: string | null;
  approvedAt: Date | null;
  approvedById: string | null;
  approvalReturnedAt: Date | null;
}

export interface ApprovalActor {
  id: string;
  name: string;
}

/** What the caller should notify once its transaction has committed. */
export interface DeliveryApprovalNotice {
  eventKey: "approval.requested" | "approval.returned";
  /** Resolve recipients from this grant (`usersWithPermission`), minus `excludeUserId`. */
  audienceGrant?: { module: string; action: "approve" };
  /** Or notify exactly these users (the requester, on a return). */
  audienceUserIds?: string[];
  excludeUserId?: string | null;
  title: string;
  body: string;
  refId: string;
  link: string;
  data: Record<string, string>;
}

export interface DeliveryApprovalResult {
  delivery: DeliveryForApproval;
  notice: DeliveryApprovalNotice | null;
}

/** A refusal that carries its own HTTP status, so the route does not have to guess. */
export class DeliveryApprovalError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "DeliveryApprovalError";
    this.status = status;
  }
}

/**
 * Is this outward approved RIGHT NOW (R26a)?
 *
 * Not "has it ever been": a return after an approval revokes it. `approvalReturnedAt` is never
 * cleared, so the comparison is what keeps a returned-then-re-requested outward blocked until it
 * is approved again.
 */
export function isDeliveryApproved(
  d: Pick<DeliveryForApproval, "approvedAt" | "approvalReturnedAt">
): boolean {
  if (!d.approvedAt) return false;
  if (!d.approvalReturnedAt) return true;
  return d.approvalReturnedAt.getTime() <= d.approvedAt.getTime();
}

/** Statuses that may not move without an approval (R26a). Walk-out is deliberately absent. */
export const APPROVAL_GATED_STATUSES = ["OUT_FOR_DELIVERY", "SHIPPED"];

/** The message the dispatch gate shows. One sentence, and it says what to do next. */
export function approvalRefusal(d: Pick<DeliveryForApproval, "approvalRequestedAt" | "approvalReturnedAt">): string {
  if (d.approvalReturnedAt) {
    return "This outward was returned for correction. Fix it and request approval again before dispatching.";
  }
  if (d.approvalRequestedAt) {
    return "This outward is waiting for approval. Someone holding the outbound approve permission must approve it before dispatch.";
  }
  return "This outward has not been approved. Request approval before dispatching.";
}

function assertApprovable(d: DeliveryForApproval) {
  if (!d.warehouseId && !["DELIVERED", "WALK_OUT"].includes(d.status)) {
    throw new DeliveryApprovalError(
      "Dummy delivery: no warehouse matched this invoice number. No actions are allowed.",
      409
    );
  }
  if (PAST_APPROVAL.includes(d.status)) {
    throw new DeliveryApprovalError(`An outward in ${d.status} status is past the approval step.`, 409);
  }
}

/**
 * Ask for approval (R26a). `deliveries.edit` — the person preparing the outward.
 *
 * Re-requesting after a return is the SAME call: `approvalRequestedAt` moves forward and
 * `approvalReturnedAt` stays where it is, which is exactly what `isDeliveryApproved` compares.
 */
export async function requestDeliveryApproval(
  tx: Tx,
  delivery: DeliveryForApproval,
  user: ApprovalActor
): Promise<DeliveryApprovalResult> {
  assertApprovable(delivery);
  if (isDeliveryApproved(delivery)) {
    throw new DeliveryApprovalError("This outward is already approved.", 409);
  }

  const now = new Date();
  const updated = await tx.delivery.update({
    where: { id: delivery.id },
    data: { approvalRequestedAt: now, approvalRequestedById: user.id },
    select: APPROVAL_SELECT,
  });

  await recordApprovalEvent(tx, {
    activity: ACTIVITY,
    event: delivery.approvalReturnedAt ? "RESUBMITTED" : "REQUESTED",
    recordId: delivery.id,
    recordRef: delivery.invoiceNo,
    actorId: user.id,
    warehouseId: delivery.warehouseId,
  });

  await logActivity(tx, {
    module: "deliveries",
    action: delivery.approvalReturnedAt ? "approval_resubmitted" : "approval_requested",
    entityType: "Delivery",
    entityId: delivery.id,
    entityRef: delivery.invoiceNo,
    toValue: "AWAITING_APPROVAL",
    userId: user.id,
    userName: user.name,
  });

  log.info("outbound approval requested", {
    deliveryId: delivery.id,
    invoiceNo: delivery.invoiceNo,
    resubmit: !!delivery.approvalReturnedAt,
  });

  return {
    delivery: updated,
    notice: {
      eventKey: "approval.requested",
      audienceGrant: { module: "deliveries", action: "approve" },
      excludeUserId: user.id,
      title: `Outward ${delivery.invoiceNo} needs approval`,
      body: `${user.name} asked for approval to dispatch invoice ${delivery.invoiceNo}.`,
      refId: delivery.id,
      link: `/deliveries/${delivery.id}`,
      data: { deliveryId: delivery.id, invoiceNo: delivery.invoiceNo, activity: ACTIVITY },
    },
  };
}

/**
 * Approve (R26a). `deliveries.approve`.
 *
 * Self-approval is ALLOWED for a holder of the grant (Q15): the grant is the authority, and a
 * second person is a staffing rule, not an access rule. The event records who approved, so the
 * error-rate report can still count it against them.
 */
export async function approveDelivery(
  tx: Tx,
  delivery: DeliveryForApproval,
  user: ApprovalActor,
  note?: string | null
): Promise<DeliveryApprovalResult> {
  assertApprovable(delivery);
  if (isDeliveryApproved(delivery)) {
    throw new DeliveryApprovalError("This outward is already approved.", 409);
  }

  const now = new Date();
  const updated = await tx.delivery.update({
    where: { id: delivery.id },
    data: {
      approvedAt: now,
      approvedById: user.id,
      approvalNote: note?.trim() || null,
      // Not requested first (approved straight from the Requests page): record the ask too, so
      // the record never reads "approved, never requested".
      ...(delivery.approvalRequestedAt ? {} : { approvalRequestedAt: now, approvalRequestedById: user.id }),
    },
    select: APPROVAL_SELECT,
  });

  await recordApprovalEvent(tx, {
    activity: ACTIVITY,
    event: "APPROVED",
    recordId: delivery.id,
    recordRef: delivery.invoiceNo,
    actorId: user.id,
    approverId: user.id,
    warehouseId: delivery.warehouseId,
    note: note?.trim() || null,
  });

  await logActivity(tx, {
    module: "deliveries",
    action: "approved",
    entityType: "Delivery",
    entityId: delivery.id,
    entityRef: delivery.invoiceNo,
    toValue: "APPROVED",
    userId: user.id,
    userName: user.name,
  });

  log.info("outbound approved", { deliveryId: delivery.id, invoiceNo: delivery.invoiceNo, approverId: user.id });

  // Nothing to notify: the person waiting is the one who opens the screen to dispatch, and an
  // "approved" push to every approver is noise. A return DOES notify — that one needs action.
  return { delivery: updated, notice: null };
}

/**
 * Return for correction (R25, R26a). `deliveries.approve`. The note is required — a return with
 * no reason is the defect the whole returned-record rule exists to fix.
 */
export async function rejectDelivery(
  tx: Tx,
  delivery: DeliveryForApproval,
  user: ApprovalActor,
  note: string
): Promise<DeliveryApprovalResult> {
  assertApprovable(delivery);
  const reason = note.trim();
  if (!reason) throw new DeliveryApprovalError("Say what needs correcting before returning it.", 400);

  const now = new Date();
  const updated = await tx.delivery.update({
    where: { id: delivery.id },
    data: { approvalReturnedAt: now, approvalNote: reason },
    select: APPROVAL_SELECT,
  });

  await recordApprovalEvent(tx, {
    activity: ACTIVITY,
    event: "REJECTED",
    recordId: delivery.id,
    recordRef: delivery.invoiceNo,
    actorId: user.id,
    // The approval this judges: null before a first approval, otherwise the approver whose
    // decision is being reversed (events.ts).
    approverId: delivery.approvedById,
    warehouseId: delivery.warehouseId,
    note: reason,
  });

  await logActivity(tx, {
    module: "deliveries",
    action: "returned",
    entityType: "Delivery",
    entityId: delivery.id,
    entityRef: delivery.invoiceNo,
    toValue: "RETURNED",
    details: reason,
    userId: user.id,
    userName: user.name,
  });

  log.info("outbound returned for correction", { deliveryId: delivery.id, invoiceNo: delivery.invoiceNo });

  const requester = delivery.approvalRequestedById;
  return {
    delivery: updated,
    notice: requester
      ? {
          eventKey: "approval.returned",
          audienceUserIds: [requester],
          excludeUserId: null,
          title: `Outward ${delivery.invoiceNo} returned`,
          body: `${user.name} returned it for correction: ${reason}`,
          refId: delivery.id,
          link: `/deliveries/${delivery.id}`,
          data: { deliveryId: delivery.id, invoiceNo: delivery.invoiceNo, activity: ACTIVITY },
        }
      : null,
  };
}

/**
 * Send what one of the three functions above asked for. **AFTER the transaction has committed**
 * (notify §F.0) — ideally inside `after()` so the response is not held up.
 *
 * Never throws: the approval is already recorded and a missed push must not turn it into an error.
 */
export async function sendDeliveryApprovalNotice(notice: DeliveryApprovalNotice | null): Promise<void> {
  if (!notice) return;
  try {
    const audience = notice.audienceUserIds
      ? notice.audienceUserIds
      : notice.audienceGrant
        ? await usersWithPermission(notice.audienceGrant.module, notice.audienceGrant.action)
        : [];
    const recipients = audience.filter((id) => id && id !== notice.excludeUserId);
    if (recipients.length === 0) {
      log.info("approval notice has no recipients", { eventKey: notice.eventKey, refId: notice.refId });
      return;
    }
    await notify(notice.eventKey, {
      recipients,
      title: notice.title,
      body: notice.body,
      refId: notice.refId,
      link: notice.link,
      data: notice.data,
    });
    log.debug("approval notice sent", {
      eventKey: notice.eventKey,
      refId: notice.refId,
      recipients: recipients.length,
    });
  } catch (error) {
    log.error("approval notice failed", {
      eventKey: notice.eventKey,
      refId: notice.refId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

/** The exact selection `DeliveryForApproval` needs. Exported so every caller selects the same set. */
export const APPROVAL_SELECT = {
  id: true,
  invoiceNo: true,
  status: true,
  warehouseId: true,
  approvalRequestedAt: true,
  approvalRequestedById: true,
  approvedAt: true,
  approvedById: true,
  approvalReturnedAt: true,
} as const;
