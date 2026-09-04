export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";

// GET: Find vendors with no purchase orders in 90+ days
export async function GET(req: NextRequest) {
  try {
    await requireFeature("vendors", "view");
    const { searchParams } = new URL(req.url);
    const days = parseInt(searchParams.get("days") || "90", 10);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    const staleVendors = await prisma.vendor.findMany({
      where: {
        isActive: true,
        purchaseOrders: {
          none: {
            createdAt: { gte: cutoff },
          },
        },
      },
      select: {
        id: true,
        name: true,
        code: true,
        city: true,
        phone: true,
        purchaseOrders: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { createdAt: true, poNumber: true },
        },
        _count: { select: { purchaseOrders: true, bills: true } },
      },
      orderBy: { name: "asc" },
    });

    const result = staleVendors.map((v) => ({
      ...v,
      lastPODate: v.purchaseOrders[0]?.createdAt || null,
      lastPONumber: v.purchaseOrders[0]?.poNumber || null,
      purchaseOrders: undefined,
    }));

    return successResponse({ vendors: result, total: result.length, cutoffDays: days });
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : "Failed to fetch stale vendors",
      500
    );
  }
}

// POST: Mark selected vendors as inactive
export async function POST(req: NextRequest) {
  try {
    // delete, NOT create: deactivation removes the vendor from every picker. A soft delete is
    // still a delete.
    await requireFeature("vendors", "delete");
    const body = await req.json();
    const { vendorIds } = body;

    if (!vendorIds || !Array.isArray(vendorIds) || vendorIds.length === 0) {
      return errorResponse("vendorIds array is required", 400);
    }

    const updated = await prisma.vendor.updateMany({
      where: { id: { in: vendorIds }, isActive: true },
      data: { isActive: false },
    });

    return successResponse({ marked: updated.count });
  } catch (error) {
    if (error instanceof AuthError) {
      return errorResponse(error.message, error.status);
    }
    return errorResponse(
      error instanceof Error ? error.message : "Failed to mark vendors inactive",
      400
    );
  }
}
