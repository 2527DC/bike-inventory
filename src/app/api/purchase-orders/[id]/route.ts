export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireFeature("purchase_orders", "view");
    const { id } = await params;
    const po = await prisma.purchaseOrder.findUnique({
      where: { id },
      include: {
        vendor: true,
        items: { include: { product: { select: { name: true, sku: true, currentStock: true } } } },
        createdBy: { select: { name: true } },
        approvedBy: { select: { name: true } },
        bills: { include: { payments: true } },
      },
    });

    if (!po) return errorResponse("Purchase order not found", 404);
    return successResponse(po);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to fetch purchase order", 500);
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireFeature("purchase_orders", "edit");
    const { id } = await params;
    const body = await req.json();

    const po = await prisma.purchaseOrder.findUnique({ where: { id } });
    if (!po) return errorResponse("Purchase order not found", 404);

    const VALID_PO_STATUS = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "SENT_TO_VENDOR", "PARTIALLY_RECEIVED", "RECEIVED", "CANCELLED"];
    if (body.status && !VALID_PO_STATUS.includes(body.status)) {
      return errorResponse("Invalid PO status", 400);
    }

    if (body.status === "SENT_TO_VENDOR" && po.status !== "APPROVED") {
      return errorResponse("PO must be approved before sending", 400);
    }

    const updated = await prisma.purchaseOrder.update({
      where: { id },
      data: {
        status: body.status,
        notes: body.notes ?? po.notes,
      },
      include: { vendor: { select: { name: true } }, items: true },
    });

    return successResponse(updated);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to update purchase order", 400);
  }
}
