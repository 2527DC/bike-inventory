export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";

// POST — bulk update products (brand, status)
export async function POST(req: NextRequest) {
  try {
    await requireFeature("stock", "create");
    const body = await req.json();
    const { productIds, brandId, status, categoryId } = body as {
      productIds: string[];
      brandId?: string;
      status?: "ACTIVE" | "INACTIVE";
      categoryId?: string;
    };

    if (!productIds || productIds.length === 0) {
      return errorResponse("No products selected", 400);
    }
    if (productIds.length > 500) {
      return errorResponse("Maximum 500 products per batch", 400);
    }
    if (!brandId && !status && !categoryId) {
      return errorResponse("Nothing to update — provide brandId, status, or categoryId", 400);
    }

    // Validate brand exists if provided
    if (brandId) {
      const brand = await prisma.brand.findUnique({ where: { id: brandId } });
      if (!brand) return errorResponse("Brand not found", 404);
    }

    // Validate category exists if provided
    if (categoryId) {
      const cat = await prisma.category.findUnique({ where: { id: categoryId } });
      if (!cat) return errorResponse("Category not found", 404);
    }

    const updateData: Record<string, unknown> = {};
    if (brandId) updateData.brandId = brandId;
    if (status) updateData.status = status;
    if (categoryId) updateData.categoryId = categoryId;

    const result = await prisma.product.updateMany({
      where: { id: { in: productIds } },
      data: updateData,
    });

    return successResponse({ updated: result.count });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Bulk update failed", 500);
  }
}
