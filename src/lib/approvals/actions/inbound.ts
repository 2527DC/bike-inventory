import { after } from "next/server";
import { prisma } from "@/lib/db";
import { userCan, usersWithPermission } from "@/lib/rbac";
import { recordApprovalEvent } from "@/lib/approvals/events";
import { logActivity } from "@/lib/activity-log";
import { notify } from "@/lib/notify";
import { APPROVAL_NOTIFICATION_ACTIONS } from "@/lib/approvals/notify-actions";
import { createLogger } from "@/lib/logger";
import type { ApprovalActionResult, ApprovalActor } from "./transfer";

const log = createLogger("approvals:inbound");

export type { ApprovalActionResult, ApprovalActor } from "./transfer";

/**
 * Approve or return an inbound shipment, with no HTTP in it
 * (plan 1709-priority-build-and-stock-flow, R22–R25, Q17).
 *
 * The same three callers as the transfer actions: the shipment's own route, the Requests page
 * (P17) and Part Q's push action. Each re-checks its grant here rather than relying on a
 * `requireFeature` it cannot see.
 *
 * Reject is NEW for inbound — until R25 a shipment could only be approved, so a bill with the
 * wrong quantities sat unapproved with nobody told and no note saying why.
 */

/** Approve a shipment. Approval is what unlocks receiving; it moves no stock by itself. */
export async function approveInbound(
  actor: ApprovalActor,
  shipmentId: string
): Promise<ApprovalActionResult> {
  if (!(await userCan(actor.id, "inbound", "approve"))) {
    return { ok: false, error: "You do not have permission to approve inbound shipments", httpStatus: 403 };
  }

  const shipment = await prisma.inboundShipment.findUnique({
    where: { id: shipmentId },
    select: { id: true, shipmentNo: true, approvedAt: true, rejectedAt: true, status: true },
  });
  if (!shipment) return { ok: false, error: "Shipment not found", httpStatus: 404 };
  if (shipment.approvedAt) return { ok: false, error: "Already approved", httpStatus: 400 };
  // A returned shipment is the creator's to fix. Approving it over their head would leave the
  // rejection note on a shipment that is now approved — two facts that contradict each other.
  if (shipment.rejectedAt) {
    return {
      ok: false,
      error: "This shipment was sent back for correction. It can be approved once the creator resubmits it.",
      httpStatus: 409,
    };
  }

  // One transaction: the approval, its event and its log entry succeed together. Approval is
  // what unlocks receiving, so a shipment cannot become receivable without a record of who
  // allowed it.
  const claimed = await prisma.$transaction(async (tx) => {
    const claim = await tx.inboundShipment.updateMany({
      where: { id: shipmentId, approvedAt: null, rejectedAt: null },
      data: { approvedAt: new Date(), approvedById: actor.id },
    });
    if (claim.count !== 1) return false;

    await recordApprovalEvent(tx, {
      activity: "INBOUND",
      event: "APPROVED",
      recordId: shipment.id,
      recordRef: shipment.shipmentNo,
      actorId: actor.id,
      // The row a later correction is counted against — see approval-rules.ts.
      approverId: actor.id,
    });

    await logActivity(tx, {
      module: "inbound",
      action: "approved",
      entityType: "InboundShipment",
      entityId: shipment.id,
      entityRef: shipment.shipmentNo,
      toValue: "APPROVED",
      userId: actor.id,
      userName: actor.name,
    });
    return true;
  });
  if (!claimed) return { ok: false, error: "This shipment has already been reviewed.", httpStatus: 409 };

  log.info("shipment approved", {
    shipmentId: shipment.id,
    shipmentNo: shipment.shipmentNo,
    approverId: actor.id,
  });
  return { ok: true, message: "Shipment approved", recordRef: shipment.shipmentNo, newStatus: "APPROVED" };
}

/** Send a shipment back to its creator with a note (R25, Q17). */
export async function rejectInbound(
  actor: ApprovalActor,
  shipmentId: string,
  note: string | null | undefined
): Promise<ApprovalActionResult> {
  if (!(await userCan(actor.id, "inbound", "approve"))) {
    return { ok: false, error: "You do not have permission to approve inbound shipments", httpStatus: 403 };
  }

  const shipment = await prisma.inboundShipment.findUnique({
    where: { id: shipmentId },
    select: {
      id: true,
      shipmentNo: true,
      approvedAt: true,
      rejectedAt: true,
      status: true,
      createdById: true,
      brand: { select: { name: true } },
    },
  });
  if (!shipment) return { ok: false, error: "Shipment not found", httpStatus: 404 };
  // Once it is approved the stock is receivable and may already be in the building. Returning
  // it then would say "fix this" about goods on a shelf; the way back is DELETE, which reverses
  // the stock and writes a REVERSED event.
  if (shipment.approvedAt) {
    return {
      ok: false,
      error: "This shipment is already approved, so it cannot be sent back. Delete it instead if it was wrong.",
      httpStatus: 409,
    };
  }
  if (shipment.status === "DELIVERED") {
    return { ok: false, error: "This shipment has already been received.", httpStatus: 409 };
  }
  if (shipment.rejectedAt) {
    return { ok: false, error: "This shipment has already been sent back.", httpStatus: 409 };
  }

  const rejectionNote = note?.trim() || null;

  const claimed = await prisma.$transaction(async (tx) => {
    const claim = await tx.inboundShipment.updateMany({
      where: { id: shipmentId, approvedAt: null, rejectedAt: null },
      data: { rejectedAt: new Date(), rejectedById: actor.id, rejectionNote },
    });
    if (claim.count !== 1) return false;

    await recordApprovalEvent(tx, {
      activity: "INBOUND",
      event: "REJECTED",
      recordId: shipment.id,
      recordRef: shipment.shipmentNo,
      actorId: actor.id,
      // Nothing was approved, so this outcome judges no approval (events.ts).
      approverId: null,
      note: rejectionNote,
    });

    await logActivity(tx, {
      module: "inbound",
      action: "returned",
      entityType: "InboundShipment",
      entityId: shipment.id,
      entityRef: shipment.shipmentNo,
      toValue: "RETURNED",
      details: rejectionNote,
      userId: actor.id,
      userName: actor.name,
    });
    return true;
  });
  if (!claimed) return { ok: false, error: "This shipment has already been reviewed.", httpStatus: 409 };

  log.info("shipment returned", {
    shipmentId: shipment.id,
    shipmentNo: shipment.shipmentNo,
    actorId: actor.id,
  });

  // After the commit — notify() does network I/O and must never sit inside a transaction.
  after(async () => {
    try {
      await notify("approval.returned", {
        recipients: [shipment.createdById],
        title: `Shipment ${shipment.shipmentNo} returned`,
        body: rejectionNote
          ? `${actor.name} sent it back: ${rejectionNote}`
          : `${actor.name} sent it back for correction`,
        refId: shipment.id,
        link: `/inbound/${shipment.id}`,
        data: { activity: "INBOUND", recordId: shipment.id },
      });
    } catch (error) {
      log.error("approval.returned notification failed", {
        shipmentId: shipment.id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  return { ok: true, message: "Shipment sent back for correction", recordRef: shipment.shipmentNo, newStatus: "RETURNED" };
}

/**
 * Tell every holder of `inbound.approve` — except the person who asked — that a shipment is
 * waiting. Used by create (R22) and by resubmit (R25).
 */
export function notifyInboundApprovalRequested(input: {
  shipmentId: string;
  shipmentNo: string;
  actorId: string;
  actorName: string;
  summary: string;
  resubmitted: boolean;
}) {
  after(async () => {
    try {
      const recipients = (await usersWithPermission("inbound", "approve")).filter(
        (uid) => uid !== input.actorId
      );
      if (recipients.length === 0) {
        log.debug("shipment waiting for approval but nobody holds the grant", {
          shipmentId: input.shipmentId,
        });
        return;
      }
      await notify("approval.requested", {
        recipients,
        title: input.resubmitted
          ? `Shipment ${input.shipmentNo} resubmitted`
          : `Shipment ${input.shipmentNo} needs approval`,
        body: `${input.summary} — raised by ${input.actorName}`,
        refId: input.shipmentId,
        link: `/inbound/${input.shipmentId}`,
        data: { activity: "INBOUND", recordId: input.shipmentId },
        // One-tap Approve / Open on the notification itself (plan 1709 §3.8, R24). The action
        // ids are what `POST /api/approvals/quick` dispatches on; a browser with no button
        // support ignores this and the body tap still opens `link`. Only `approval.requested`
        // gets them — a RETURNED notification goes to the creator, who has to fix it.
        actions: APPROVAL_NOTIFICATION_ACTIONS,
      });
    } catch (error) {
      log.error("approval.requested notification failed", {
        shipmentId: input.shipmentId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });
}
