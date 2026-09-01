export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { PRODUCT_TYPE_SELECT, withNestedTypeName } from "@/lib/product-type";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { userCan } from "@/lib/rbac";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireFeature("stock_audit", "view");
    const { id } = await params;

    // Clerks/Mechanic can only access their assigned stock counts
    if (!(await userCan(user.id, "stock_audit", "approve"))) {
      const sc = await prisma.stockCount.findUnique({ where: { id }, select: { assignedToId: true } });
      if (!sc) return errorResponse("Stock count not found", 404);
      if (sc.assignedToId !== user.id) return errorResponse("You can only access stock counts assigned to you", 403);
    }
    const { searchParams } = new URL(req.url);
    const filter = searchParams.get("filter") || "all";
    const search = searchParams.get("search") || "";

    // Build search condition — split words for fuzzy matching
    let searchCondition = {};
    if (search) {
      const words = search.trim().split(/\s+/).filter(Boolean);
      if (words.length > 1) {
        // Multi-word: all words must match somewhere in name/sku/brand/category
        searchCondition = {
          AND: words.map((word) => ({
            product: {
              OR: [
                { name: { contains: word, mode: "insensitive" as const } },
                { sku: { contains: word, mode: "insensitive" as const } },
                { category: { name: { contains: word, mode: "insensitive" as const } } },
                { brand: { name: { contains: word, mode: "insensitive" as const } } },
              ],
            },
          })),
        };
      } else {
        searchCondition = {
          product: {
            OR: [
              { name: { contains: search, mode: "insensitive" as const } },
              { sku: { contains: search, mode: "insensitive" as const } },
              { category: { name: { contains: search, mode: "insensitive" as const } } },
              { brand: { name: { contains: search, mode: "insensitive" as const } } },
            ],
          },
        };
      }
    }

    const items = await prisma.stockCountItem.findMany({
      where: {
        stockCountId: id,
        ...(filter === "counted" && { countedQty: { not: null } }),
        ...(filter === "uncounted" && { countedQty: null }),
        ...(filter === "variance" && { variance: { not: null }, AND: { variance: { not: 0 } } }),
        ...searchCondition,
      },
      include: {
        product: {
          select: {
            name: true, sku: true, currentStock: true, productType: PRODUCT_TYPE_SELECT, size: true,
            category: { select: { name: true } },
            brand: { select: { name: true } },
            bin: { select: { code: true, location: true } },
          },
        },
      },
      orderBy: { product: { name: "asc" } },
      ...(searchParams.get("limit") ? { take: parseInt(searchParams.get("limit")!) } : { take: 500 }),
    });

    // Calculate stale count — items where systemQty differs from current product stock
    const staleCount = items.filter((i) => i.systemQty !== i.product.currentStock).length;

    // Count totals for tabs
    const allCounts = await prisma.stockCountItem.groupBy({
      by: ["stockCountId"],
      where: { stockCountId: id },
      _count: true,
    });
    const countedCount = await prisma.stockCountItem.count({
      where: { stockCountId: id, countedQty: { not: null } },
    });
    const totalCount = allCounts[0]?._count || 0;

    return successResponse({
      items: items.map(withNestedTypeName),
      staleCount,
      totalCount,
      countedCount,
      uncountedCount: totalCount - countedCount,
    });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to fetch items", 500);
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireFeature("stock_audit", "edit");
    const { id } = await params;

    // ADMIN cannot save counts — only approve/reject
    if (await userCan(user.id, "stock_audit", "approve")) return errorResponse("Admin can only approve or reject stock counts", 403);

    // Clerks/Mechanic can only edit their assigned stock counts
    if (!(await userCan(user.id, "stock_audit", "approve"))) {
      const sc = await prisma.stockCount.findUnique({ where: { id }, select: { assignedToId: true } });
      if (!sc) return errorResponse("Stock count not found", 404);
      if (sc.assignedToId !== user.id) return errorResponse("You can only edit stock counts assigned to you", 403);
    }
    const body = await req.json();

    if (!body.items || !Array.isArray(body.items)) {
      return errorResponse("Items array is required", 400);
    }

    const results = await prisma.$transaction(async (tx) => {
      const updated = [];
      for (const item of body.items) {
        if (!item.id || item.countedQty === undefined) continue;

        const existing = await tx.stockCountItem.findUnique({
          where: { id: item.id },
        });
        if (!existing || existing.stockCountId !== id) continue;

        const result = await tx.stockCountItem.update({
          where: { id: item.id },
          data: {
            countedQty: item.countedQty,
            variance: item.countedQty - existing.systemQty,
            suggestedBrand: item.suggestedBrand ?? existing.suggestedBrand,
            notes: item.notes ?? existing.notes,
            countedAt: new Date(),
          },
        });
        updated.push(result);
      }
      return updated;
    });

    return successResponse({ updated: results.length });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to update items", 400);
  }
}

// PATCH — Refresh systemQty from current product stock
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireFeature("stock_audit", "edit");
    const { id } = await params;

    // Clerks/Mechanic can only refresh their assigned stock counts
    if (!(await userCan(user.id, "stock_audit", "approve"))) {
      const sc = await prisma.stockCount.findUnique({ where: { id }, select: { assignedToId: true } });
      if (!sc) return errorResponse("Stock count not found", 404);
      if (sc.assignedToId !== user.id) return errorResponse("You can only access stock counts assigned to you", 403);
    }

    const items = await prisma.stockCountItem.findMany({
      where: { stockCountId: id },
      include: { product: { select: { currentStock: true } } },
    });

    let refreshed = 0;
    await prisma.$transaction(async (tx) => {
      for (const item of items) {
        if (item.systemQty !== item.product.currentStock) {
          const newVariance = item.countedQty !== null
            ? item.countedQty - item.product.currentStock
            : null;
          await tx.stockCountItem.update({
            where: { id: item.id },
            data: {
              systemQty: item.product.currentStock,
              variance: newVariance,
            },
          });
          refreshed++;
        }
      }
    });

    return successResponse({ refreshed });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to refresh", 400);
  }
}
