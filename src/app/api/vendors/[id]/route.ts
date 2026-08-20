export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { vendorUpdateSchema } from "@/lib/validations";
import { requireFeature, AuthError } from "@/lib/auth-helpers";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireFeature("vendors", "view");
    const { id } = await params;
    const vendor = await prisma.vendor.findUnique({
      where: { id },
      include: {
        contacts: true,
        purchaseOrders: { orderBy: { createdAt: "desc" }, take: 10, include: { items: true } },
        bills: { orderBy: { dueDate: "asc" }, take: 10, include: { payments: true } },
        credits: { orderBy: { creditDate: "desc" }, take: 10 },
        _count: { select: { issues: true } },
      },
    });

    if (!vendor) return errorResponse("Vendor not found", 404);
    return successResponse(vendor);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to fetch vendor", 500);
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireFeature("vendors", "edit");
    const { id } = await params;
    const body = await req.json();
    const data = vendorUpdateSchema.parse(body);

    const vendor = await prisma.vendor.update({
      where: { id },
      data,
      include: { contacts: true },
    });

    return successResponse(vendor);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to update vendor", 400);
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireFeature("vendors", "delete");
    const { id } = await params;

    await prisma.vendor.update({ where: { id }, data: { isActive: false } });
    return successResponse({ deleted: true });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to delete vendor", 400);
  }
}
