export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { logActivity } from "@/lib/activity-log";
import { createLogger } from "@/lib/logger";

const log = createLogger("inbound:approve");

// POST: Approve an inbound shipment (Supervisor or Accounts Manager)
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireFeature("inbound", "approve");
    const { id } = await params;

    const shipment = await prisma.inboundShipment.findUnique({
      where: { id },
      select: { id: true, approvedAt: true, status: true, shipmentNo: true },
    });

    if (!shipment) return errorResponse("Shipment not found", 404);
    if (shipment.approvedAt) return errorResponse("Already approved", 400);

    // One transaction: the approval and its log entry succeed together. Approval is what
    // unlocks receiving, so a shipment cannot become receivable without a record of who
    // allowed it.
    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.inboundShipment.update({
        where: { id },
        data: {
          approvedAt: new Date(),
          approvedById: user.id,
        },
        include: {
          approvedBy: { select: { name: true } },
        },
      });
      await logActivity(tx, {
        module: "inbound",
        action: "approved",
        entityType: "InboundShipment",
        entityId: id,
        entityRef: shipment.shipmentNo,
        toValue: "APPROVED",
        userId: user.id,
        userName: user.name,
      });
      return row;
    });

    log.info("shipment approved", { shipmentId: id, shipmentNo: shipment.shipmentNo });
    return successResponse(updated);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    const message = error instanceof Error ? error.message : "Approval failed";
    log.error("approval failed", { message });
    return errorResponse(message, 400);
  }
}
