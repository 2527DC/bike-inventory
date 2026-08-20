export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireFeature("brands", "create");
    const { id: sourceBrandId } = await params;
    const { targetBrandId } = await req.json();

    if (!targetBrandId || typeof targetBrandId !== "string") {
      return errorResponse("targetBrandId is required", 400);
    }

    if (sourceBrandId === targetBrandId) {
      return errorResponse("Cannot merge a brand into itself", 400);
    }

    // Verify both brands exist
    const [sourceBrand, targetBrand] = await Promise.all([
      prisma.brand.findUnique({ where: { id: sourceBrandId } }),
      prisma.brand.findUnique({ where: { id: targetBrandId } }),
    ]);

    if (!sourceBrand) return errorResponse("Source brand not found", 404);
    if (!targetBrand) return errorResponse("Target brand not found", 404);

    // Move all products and delete source brand in a transaction
    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.product.updateMany({
        where: { brandId: sourceBrandId },
        data: { brandId: targetBrandId },
      });

      await tx.brand.delete({ where: { id: sourceBrandId } });

      return { moved: updated.count, deleted: sourceBrand.name };
    });

    return successResponse(result);
  } catch (error) {
    if (error instanceof AuthError)
      return errorResponse(error.message, error.status);
    return errorResponse(
      error instanceof Error ? error.message : "Failed to merge brand",
      500
    );
  }
}
