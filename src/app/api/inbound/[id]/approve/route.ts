export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";

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
      select: { id: true, approvedAt: true, status: true },
    });

    if (!shipment) return errorResponse("Shipment not found", 404);
    if (shipment.approvedAt) return errorResponse("Already approved", 400);

    const updated = await prisma.inboundShipment.update({
      where: { id },
      data: {
        approvedAt: new Date(),
        approvedById: user.id,
      },
      include: {
        approvedBy: { select: { name: true } },
      },
    });

    return successResponse(updated);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Approval failed", 400);
  }
}
