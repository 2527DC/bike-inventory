import { after } from "next/server";
import { prisma } from "@/lib/db";
import { userCan, usersWithPermission } from "@/lib/rbac";
import { getWarehouseBreakdown } from "@/lib/stock-location";
import { warehouseById } from "@/lib/warehouses";
import { assertTransition, TransitionError } from "@/lib/transfers/transitions";
import { recordApprovalEvent } from "@/lib/approvals/events";
import { logActivity } from "@/lib/activity-log";
import { notify } from "@/lib/notify";
import { APPROVAL_NOTIFICATION_ACTIONS } from "@/lib/approvals/notify-actions";
import { createLogger } from "@/lib/logger";

const log = createLogger("approvals:transfer");

/**
 * Approve or return a transfer — the WHOLE decision, with no HTTP in it
 * (plan 1709-priority-build-and-stock-flow, R22–R25, P17).
 *
 * Two callers already, and a third coming: `POST /api/transfer-orders/[id]/approve`, the
 * Requests page's quick buttons, and Part Q's push-notification action (`api/approvals/quick`,
 * Wave 3), which runs from a service worker with no screen behind it. Each of them must apply
 * the same grant check, the same state machine, the same stock re-check and write the same
 * events — so the rule lives here once and the routes only translate the answer into a status
 * code.
 *
 * Every function re-checks `transfers.approve` itself. A route's `requireFeature` is not
 * trusted to have run: `api/approvals/quick` dispatches by activity name, and a missing check
 * there would be a hole nobody can see from this file.
 */

export interface ApprovalActor {
  id: string;
  name: string;
}

export type ApprovalActionResult =
  | { ok: true; message: string; recordRef: string; newStatus: string }
  | { ok: false; error: string; httpStatus: number };

/** Approve a PENDING transfer. Stock does NOT move here — dispatch moves it (P14, P18). */
export async function approveTransfer(
  actor: ApprovalActor,
  orderId: string
): Promise<ApprovalActionResult> {
  if (!(await userCan(actor.id, "transfers", "approve"))) {
    return { ok: false, error: "You do not have permission to approve transfers", httpStatus: 403 };
  }

  const order = await prisma.transferOrder.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      orderNo: true,
      status: true,
      fromWarehouseId: true,
      requiredDocType: true,
      items: {
        select: { productId: true, quantity: true, fromWarehouseId: true, product: { select: { name: true } } },
      },
    },
  });
  if (!order) return { ok: false, error: "Transfer order not found", httpStatus: 404 };

  try {
    assertTransition(order.status, "APPROVED");
  } catch (error) {
    if (error instanceof TransitionError) return { ok: false, error: error.message, httpStatus: error.status };
    throw error;
  }

  const sourceId = order.fromWarehouseId ?? order.items[0]?.fromWarehouseId ?? null;
  if (!sourceId) {
    return {
      ok: false,
      error:
        "This transfer has no source warehouse recorded, so it cannot be approved. Raise it again from /transfers/new.",
      httpStatus: 400,
    };
  }
  const sourceWh = await warehouseById(sourceId);
  if (!sourceWh) {
    return { ok: false, error: "This transfer's source is no longer an active warehouse.", httpStatus: 400 };
  }

  // Approving something the source cannot cover is worth refusing early. It proves nothing
  // about dispatch time — anything can sell in between — so dispatch re-checks with the row
  // locked. That one is the real gate.
  const breakdown = await getWarehouseBreakdown(order.items.map((i) => i.productId));
  for (const item of order.items) {
    const available = breakdown.get(item.productId)?.[sourceWh.code] ?? 0;
    if (available < item.quantity) {
      return {
        ok: false,
        error: `Insufficient stock for ${item.product.name} at ${sourceWh.name}. Available: ${available}, requested: ${item.quantity}`,
        httpStatus: 400,
      };
    }
  }

  if (!order.requiredDocType) {
    log.warn("approving a transfer with no requiredDocType; left null", {
      orderId: order.id,
      orderNo: order.orderNo,
    });
  }

  // Idempotent claim: the precondition lives in the WHERE, so two approvers pressing at the
  // same moment produce one write and one no-op. The event and the log commit with it —
  // an approval nobody can attribute is worse than one that never happened.
  const claimed = await prisma.$transaction(async (tx) => {
    const claim = await tx.transferOrder.updateMany({
      where: { id: orderId, status: "PENDING" },
      data: { status: "APPROVED", reviewedById: actor.id, reviewedAt: new Date(), rejectionNote: null },
    });
    if (claim.count !== 1) return false;

    await recordApprovalEvent(tx, {
      activity: "TRANSFER",
      event: "APPROVED",
      recordId: order.id,
      recordRef: order.orderNo,
      actorId: actor.id,
      // On APPROVED the approver IS the actor — this is the row a later correction, short
      // receipt or reversal is counted against (`src/lib/settings/approval-rules.ts`).
      approverId: actor.id,
    });

    await logActivity(tx, {
      module: "transfers",
      action: "approved",
      entityType: "TransferOrder",
      entityId: order.id,
      entityRef: order.orderNo,
      fromValue: "PENDING",
      toValue: "APPROVED",
      userId: actor.id,
      userName: actor.name,
    });
    return true;
  });
  if (!claimed) return { ok: false, error: "This transfer has already been reviewed.", httpStatus: 409 };

  log.info("transfer approved", {
    orderId: order.id,
    orderNo: order.orderNo,
    approverId: actor.id,
    requiredDocType: order.requiredDocType,
  });

  return { ok: true, message: "Transfer order approved", recordRef: order.orderNo, newStatus: "APPROVED" };
}

/**
 * Send a PENDING transfer BACK to its creator with a note (R25).
 *
 * This is what Reject does now. It writes RETURNED, not REJECTED: the creator fixes the same
 * order and resubmits it, so the approver sees one record with its history instead of a dead
 * rejected row and a new one that looks unrelated.
 */
export async function returnTransfer(
  actor: ApprovalActor,
  orderId: string,
  note: string | null | undefined
): Promise<ApprovalActionResult> {
  if (!(await userCan(actor.id, "transfers", "approve"))) {
    return { ok: false, error: "You do not have permission to approve transfers", httpStatus: 403 };
  }

  const order = await prisma.transferOrder.findUnique({
    where: { id: orderId },
    select: { id: true, orderNo: true, status: true, createdById: true },
  });
  if (!order) return { ok: false, error: "Transfer order not found", httpStatus: 404 };

  try {
    assertTransition(order.status, "RETURNED");
  } catch (error) {
    if (error instanceof TransitionError) return { ok: false, error: error.message, httpStatus: error.status };
    throw error;
  }

  const rejectionNote = note?.trim() || null;

  const claimed = await prisma.$transaction(async (tx) => {
    const claim = await tx.transferOrder.updateMany({
      where: { id: orderId, status: "PENDING" },
      data: { status: "RETURNED", reviewedById: actor.id, reviewedAt: new Date(), rejectionNote },
    });
    if (claim.count !== 1) return false;

    await recordApprovalEvent(tx, {
      activity: "TRANSFER",
      event: "REJECTED",
      recordId: order.id,
      recordRef: order.orderNo,
      actorId: actor.id,
      // Null on purpose: nothing has been approved yet, so this outcome judges no approval.
      // `src/lib/approvals/events.ts` spells the rule out — a pre-approval REJECTED has no
      // approver, and blaming the person who caught the mistake would invert the error rate.
      approverId: null,
      note: rejectionNote,
    });

    await logActivity(tx, {
      module: "transfers",
      action: "returned",
      entityType: "TransferOrder",
      entityId: order.id,
      entityRef: order.orderNo,
      fromValue: "PENDING",
      toValue: "RETURNED",
      details: rejectionNote,
      userId: actor.id,
      userName: actor.name,
    });
    return true;
  });
  if (!claimed) return { ok: false, error: "This transfer has already been reviewed.", httpStatus: 409 };

  log.info("transfer returned", { orderId: order.id, orderNo: order.orderNo, actorId: actor.id });

  // AFTER the commit, never inside it (notify/index.ts §F.0): this does FCM network I/O and
  // would time the transaction out — and a push already delivered cannot be rolled back.
  notifyTransferReturned({
    orderId: order.id,
    orderNo: order.orderNo,
    creatorId: order.createdById,
    actorName: actor.name,
    note: rejectionNote,
  });

  return { ok: true, message: "Transfer sent back for correction", recordRef: order.orderNo, newStatus: "RETURNED" };
}

/** Tell the creator their transfer came back. Never throws into the caller. */
export function notifyTransferReturned(input: {
  orderId: string;
  orderNo: string;
  creatorId: string;
  actorName: string;
  note: string | null;
}) {
  after(async () => {
    try {
      await notify("approval.returned", {
        recipients: [input.creatorId],
        title: `Transfer ${input.orderNo} returned`,
        body: input.note
          ? `${input.actorName} sent it back: ${input.note}`
          : `${input.actorName} sent it back for correction`,
        refId: input.orderId,
        link: `/transfers/${input.orderId}`,
        data: { activity: "TRANSFER", recordId: input.orderId },
      });
    } catch (error) {
      log.error("approval.returned notification failed", {
        orderId: input.orderId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });
}

/**
 * Tell every holder of `transfers.approve` — except the person who asked — that a transfer is
 * waiting. Used by create (R22) and by resubmit (R25).
 */
export function notifyTransferApprovalRequested(input: {
  orderId: string;
  orderNo: string;
  actorId: string;
  actorName: string;
  routeLabel: string;
  resubmitted: boolean;
}) {
  after(async () => {
    try {
      const recipients = (await usersWithPermission("transfers", "approve")).filter(
        (uid) => uid !== input.actorId
      );
      if (recipients.length === 0) {
        log.debug("transfer waiting for approval but nobody holds the grant", { orderId: input.orderId });
        return;
      }
      await notify("approval.requested", {
        recipients,
        title: input.resubmitted
          ? `Transfer ${input.orderNo} resubmitted`
          : `Transfer ${input.orderNo} needs approval`,
        body: `${input.routeLabel} — raised by ${input.actorName}`,
        refId: input.orderId,
        link: `/transfers/${input.orderId}`,
        data: { activity: "TRANSFER", recordId: input.orderId },
        // One-tap Approve / Open on the notification itself (plan 1709 §3.8, R24). The action
        // ids are what `POST /api/approvals/quick` dispatches on; a browser with no button
        // support ignores this and the body tap still opens `link`. Only `approval.requested`
        // gets them — a RETURNED notification goes to the creator, who has to fix it, not
        // approve it.
        actions: APPROVAL_NOTIFICATION_ACTIONS,
      });
    } catch (error) {
      log.error("approval.requested notification failed", {
        orderId: input.orderId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });
}
