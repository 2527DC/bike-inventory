export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { recordApprovalEvent } from "@/lib/approvals/events";
import { notifyInboundApprovalRequested } from "@/lib/approvals/actions/inbound";
import { logActivity } from "@/lib/activity-log";
import { createLogger } from "@/lib/logger";

const log = createLogger("inbound:resubmit");

/**
 * POST: ask for approval again after a shipment was sent back (R25, Q17).
 *
 * The SAME shipment, corrected in place through the ordinary edit routes. `rejectedAt` and
 * `rejectedById` are cleared — they describe a state the shipment is no longer in, and leaving
 * them would make the approval gate think it is still returned — while `rejectionNote` is KEPT
 * so what was wrong stays readable next to `resubmittedAt`, which is what says it was answered.
 *
 * Guarded on `inbound.edit`, not `create`: fixing a returned shipment is editing it, and the
 * grant that lets somebody change its lines is the one that should let them send it back for
 * approval.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const user = await requireFeature("inbound", "edit");

    const shipment = await prisma.inboundShipment.findUnique({
      where: { id },
      select: {
        id: true,
        shipmentNo: true,
        billNo: true,
        totalItems: true,
        approvedAt: true,
        rejectedAt: true,
        brand: { select: { name: true } },
      },
    });
    if (!shipment) return errorResponse("Shipment not found", 404);
    if (shipment.approvedAt) return errorResponse("This shipment is already approved.", 409);
    if (!shipment.rejectedAt) {
      return errorResponse("This shipment was not sent back, so there is nothing to resubmit.", 409);
    }

    // The precondition is in the WHERE: two presses produce one write and one 409, not two
    // requests at the approvers.
    const claimed = await prisma.$transaction(async (tx) => {
      const claim = await tx.inboundShipment.updateMany({
        where: { id, approvedAt: null, rejectedAt: { not: null } },
        data: { rejectedAt: null, rejectedById: null, resubmittedAt: new Date() },
      });
      if (claim.count !== 1) return false;

      await recordApprovalEvent(tx, {
        activity: "INBOUND",
        event: "RESUBMITTED",
        recordId: shipment.id,
        recordRef: shipment.shipmentNo,
        actorId: user.id,
        approverId: null,
      });

      await logActivity(tx, {
        module: "inbound",
        action: "resubmitted",
        entityType: "InboundShipment",
        entityId: shipment.id,
        entityRef: shipment.shipmentNo,
        fromValue: "RETURNED",
        toValue: "PENDING",
        userId: user.id,
        userName: user.name,
      });
      return true;
    });

    if (!claimed) {
      return errorResponse("This shipment has already been resubmitted or reviewed.", 409);
    }

    log.info("shipment resubmitted", {
      shipmentId: shipment.id,
      shipmentNo: shipment.shipmentNo,
      userId: user.id,
    });

    notifyInboundApprovalRequested({
      shipmentId: shipment.id,
      shipmentNo: shipment.shipmentNo,
      actorId: user.id,
      actorName: user.name,
      summary: `${shipment.brand.name} — bill ${shipment.billNo}, ${shipment.totalItems} item(s)`,
      resubmitted: true,
    });

    return successResponse({ message: "Shipment resubmitted for approval", shipmentNo: shipment.shipmentNo });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    const message = error instanceof Error ? error.message : "Failed to resubmit this shipment";
    log.error("shipment resubmit failed", { shipmentId: id, message });
    return errorResponse(message, 400);
  }
}
