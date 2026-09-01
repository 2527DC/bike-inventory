export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { PRODUCT_TYPE_SELECT, withNestedTypeName } from "@/lib/product-type";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireFeature("stock", "view");
    const { id } = await params;

    const serial = await prisma.serialItem.findUnique({
      where: { id },
      include: {
        product: { select: { name: true, sku: true, productType: PRODUCT_TYPE_SELECT } },
        bin: { select: { code: true, location: true } },
        transactionItems: {
          include: {
            transaction: {
              select: { type: true, quantity: true, referenceNo: true, createdAt: true, user: { select: { name: true } } },
            },
          },
          orderBy: { createdAt: "desc" },
          take: 10,
        },
      },
    });

    if (!serial) return errorResponse("Serial item not found", 404);
    return successResponse(withNestedTypeName(serial));
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to fetch serial", 500);
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireFeature("stock", "edit");
    const { id } = await params;
    const body = await req.json();

    const existing = await prisma.serialItem.findUnique({ where: { id } });
    if (!existing) return errorResponse("Serial item not found", 404);

    const VALID_STATUS = ["IN_STOCK", "SOLD", "RETURNED", "DAMAGED", "RGP_OUT", "TRANSFERRED"];
    const VALID_CONDITION = ["NEW", "GOOD", "FAIR", "DAMAGED"];
    if (body.status && !VALID_STATUS.includes(body.status)) return errorResponse("Invalid status", 400);
    if (body.condition && !VALID_CONDITION.includes(body.condition)) return errorResponse("Invalid condition", 400);

    const updateData: Record<string, unknown> = {};
    if (body.status) updateData.status = body.status;
    if (body.condition) updateData.condition = body.condition;
    if (body.binId !== undefined) updateData.binId = body.binId || null;
    if (body.notes !== undefined) updateData.notes = body.notes;
    if (body.customerName !== undefined) updateData.customerName = body.customerName;
    if (body.saleInvoiceNo !== undefined) updateData.saleInvoiceNo = body.saleInvoiceNo;
    if (body.status === "SOLD") updateData.soldAt = new Date();

    const serial = await prisma.serialItem.update({
      where: { id },
      data: updateData,
      include: {
        product: { select: { name: true, sku: true } },
        bin: { select: { code: true, location: true } },
      },
    });

    return successResponse(serial);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to update serial", 400);
  }
}
