export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { userCan } from "@/lib/rbac";
import { z } from "zod";

const updateSchema = z.object({
  sellingPrice: z.number().min(0).optional(),
  status: z.enum(["IN_STOCK", "SOLD"]).optional(),
  soldToName: z.string().optional(),
  soldToPhone: z.string().optional(),
  soldInvoiceNo: z.string().optional(),
  notes: z.string().optional(),
  isArchived: z.boolean().optional(),
});

// GET: Detail
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireFeature("second_hand", "view");
    const { id } = await params;

    const cycle = await prisma.secondHandCycle.findUnique({
      where: { id },
      include: {
        bin: { select: { code: true, name: true, location: true } },
        createdBy: { select: { name: true } },
      },
    });

    if (!cycle) return errorResponse("Not found", 404);

    // Hide cost/price from non-admin
    if (!(await userCan(user.id, "second_hand", "approve"))) {
      const { costPrice: _costPrice, sellingPrice: _sellingPrice, ...rest } = cycle;
      return successResponse(rest);
    }
    return successResponse(cycle);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed", 500);
  }
}

// PUT: Update (set selling price, mark sold)
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireFeature("second_hand", "edit");
    const { id } = await params;
    const body = await req.json();
    const data = updateSchema.parse(body);

    const existing = await prisma.secondHandCycle.findUnique({ where: { id } });
    if (!existing) return errorResponse("Not found", 404);

    // Only ADMIN can set selling price
    if (data.sellingPrice !== undefined && !(await userCan(user.id, "second_hand", "approve"))) {
      return errorResponse("Only admin can set selling price", 403);
    }

    // Only ADMIN can archive
    if (data.isArchived !== undefined && !(await userCan(user.id, "second_hand", "approve"))) {
      return errorResponse("Only admin can archive cycles", 403);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updateData: any = {};

    if (data.sellingPrice !== undefined) updateData.sellingPrice = data.sellingPrice;
    if (data.notes !== undefined) updateData.notes = data.notes;
    if (data.isArchived !== undefined) updateData.isArchived = data.isArchived;

    // Mark as SOLD
    if (data.status === "SOLD") {
      if (existing.status === "SOLD") return errorResponse("Already sold", 400);
      updateData.status = "SOLD";
      updateData.soldAt = new Date();
      updateData.soldToName = data.soldToName || null;
      updateData.soldToPhone = data.soldToPhone || null;
      updateData.soldInvoiceNo = data.soldInvoiceNo || null;
    }

    const updated = await prisma.secondHandCycle.update({
      where: { id },
      data: updateData,
      include: {
        bin: { select: { code: true, name: true } },
        createdBy: { select: { name: true } },
      },
    });

    return successResponse(updated);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed", 400);
  }
}
