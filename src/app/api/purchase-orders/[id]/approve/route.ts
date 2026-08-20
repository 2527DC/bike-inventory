export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireFeature("purchase_orders", "approve");
    const { id } = await params;

    const po = await prisma.purchaseOrder.findUnique({ where: { id } });
    if (!po) return errorResponse("Purchase order not found", 404);
    if (po.status !== "DRAFT" && po.status !== "PENDING_APPROVAL") {
      return errorResponse("PO is not in a state that can be approved", 400);
    }

    const updated = await prisma.purchaseOrder.update({
      where: { id },
      data: {
        status: "APPROVED",
        approvedById: user.id,
        approvedAt: new Date(),
      },
      include: { vendor: { select: { name: true, whatsappNumber: true } }, items: { include: { product: { select: { name: true, sku: true } } } } },
    });

    return successResponse(updated);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to approve purchase order", 400);
  }
}
