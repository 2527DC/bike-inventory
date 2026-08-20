export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";

export async function PUT(req: NextRequest) {
  try {
    await requireFeature("reorder", "edit");
    const body = await req.json();

    if (!body.items || !Array.isArray(body.items)) {
      return errorResponse("Items array is required", 400);
    }

    const results = await prisma.$transaction(async (tx) => {
      const updated = [];
      for (const item of body.items) {
        if (!item.id || item.reorderLevel === undefined) continue;
        const result = await tx.product.update({
          where: { id: item.id },
          data: {
            reorderLevel: Math.max(0, Number(item.reorderLevel) || 0),
            ...(item.reorderQty !== undefined && { reorderQty: Math.max(0, Number(item.reorderQty) || 0) }),
            ...(item.reorderVendorId !== undefined && { reorderVendorId: item.reorderVendorId || null }),
          },
          select: { id: true, name: true, reorderLevel: true, reorderQty: true },
        });
        updated.push(result);
      }
      return updated;
    });

    return successResponse({ updated: results.length });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to update reorder levels", 400);
  }
}
