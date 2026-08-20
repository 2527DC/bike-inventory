export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";

const reclassifySchema = z
  .object({
    brandId: z.string().optional(),
    categoryId: z.string().optional(),
  })
  .refine((d) => d.brandId || d.categoryId, {
    message: "Either brandId or categoryId must be provided",
  });

// Separate endpoint so warehouse roles can correct brand/category
// without getting full product-edit access (prices, stock, etc.)
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Must match who can run a brand stock count (create on stock_audit):
    // CEO, ADMIN, SUPERVISOR, STORE_MANAGER, INWARDS_EXECUTIVE.
    // PURCHASE_MANAGER included since they own the product catalog.
    await requireFeature("stock", "edit");
    const { id } = await params;
    const body = await req.json();
    const data = reclassifySchema.parse(body);

    const update: Record<string, string> = {};
    if (data.brandId) update.brandId = data.brandId;
    if (data.categoryId) update.categoryId = data.categoryId;

    // Validate the target brand/category actually exist before updating,
    // so we return a clean message instead of leaking a raw Prisma FK error.
    if (data.brandId) {
      const brand = await prisma.brand.findUnique({ where: { id: data.brandId }, select: { id: true } });
      if (!brand) return errorResponse("Selected brand no longer exists", 400);
    }
    if (data.categoryId) {
      const category = await prisma.category.findUnique({ where: { id: data.categoryId }, select: { id: true } });
      if (!category) return errorResponse("Selected category no longer exists", 400);
    }

    const existing = await prisma.product.findUnique({ where: { id }, select: { id: true } });
    if (!existing) return errorResponse("Product not found", 404);

    const product = await prisma.product.update({
      where: { id },
      data: update,
      include: { category: true, brand: true },
    });

    return successResponse(product);
  } catch (error) {
    if (error instanceof AuthError) {
      return errorResponse(error.message, error.status);
    }
    return errorResponse(
      error instanceof Error ? error.message : "Failed to reclassify product",
      400
    );
  }
}
