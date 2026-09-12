export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";

export async function GET(req: NextRequest) {
  try {
    await requireFeature("bins", "view");
    const { searchParams } = new URL(req.url);
    const warehouseId = searchParams.get("warehouseId");
    const brandId = searchParams.get("brandId");
    const categoryId = searchParams.get("categoryId");

    const where: Record<string, unknown> = {};
    if (warehouseId) where.warehouseId = warehouseId;
    if (brandId) where.brandId = brandId;
    if (categoryId) where.categoryId = categoryId;

    const rules = await prisma.homeBinRule.findMany({
      where,
      include: {
        warehouse: { select: { id: true, name: true, code: true, kind: true } },
        brand: { select: { id: true, name: true } },
        category: { select: { id: true, name: true } },
        product: { select: { id: true, sku: true, name: true } },
        bin: { select: { id: true, code: true, name: true, directions: true, isAssemblyArea: true } },
      },
      orderBy: [{ warehouse: { name: "asc" } }, { createdAt: "desc" }],
    });

    return successResponse(rules);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to fetch home bin rules", 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireFeature("bins", "edit");
    const body = await req.json();
    const { warehouseId, brandId, categoryId, productId, binId } = body;

    if (!warehouseId || !binId) {
      return errorResponse("warehouseId and binId are required", 400);
    }

    if (!brandId && !categoryId && !productId) {
      return errorResponse("Rule must specify at least brand, category, or product", 400);
    }

    // Verify bin belongs to warehouse
    const bin = await prisma.bin.findUnique({
      where: { id: binId },
      select: { id: true, warehouseId: true },
    });

    if (!bin || bin.warehouseId !== warehouseId) {
      return errorResponse("Destination bin does not belong to the selected warehouse", 400);
    }

    // Check for existing rule with identical criteria in this warehouse
    const existing = await prisma.homeBinRule.findFirst({
      where: {
        warehouseId,
        brandId: brandId || null,
        categoryId: categoryId || null,
        productId: productId || null,
      },
    });

    let rule;
    if (existing) {
      rule = await prisma.homeBinRule.update({
        where: { id: existing.id },
        data: { binId },
        include: {
          warehouse: { select: { id: true, name: true, code: true } },
          brand: { select: { id: true, name: true } },
          category: { select: { id: true, name: true } },
          bin: { select: { id: true, code: true, name: true, directions: true } },
        },
      });
    } else {
      rule = await prisma.homeBinRule.create({
        data: {
          warehouseId,
          brandId: brandId || null,
          categoryId: categoryId || null,
          productId: productId || null,
          binId,
        },
        include: {
          warehouse: { select: { id: true, name: true, code: true } },
          brand: { select: { id: true, name: true } },
          category: { select: { id: true, name: true } },
          bin: { select: { id: true, code: true, name: true, directions: true } },
        },
      });
    }

    return successResponse(rule, 201);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to save home bin rule", 400);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    await requireFeature("bins", "edit");
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) return errorResponse("Rule id is required", 400);

    await prisma.homeBinRule.delete({ where: { id } });
    return successResponse({ deleted: true });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to delete home bin rule", 400);
  }
}
