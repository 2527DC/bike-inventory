export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { userCan } from "@/lib/rbac";
import { getWarehouseQtyMap, getStoreQtyMap } from "@/lib/stock-location";

/**
 * The system quantity for these products WITHIN this audit's scope (R2, §5.1).
 *
 * Both callers below used to compare against `Product.currentStock`, the GLOBAL total across
 * every store. For a warehouse-scoped audit that made every line look stale the moment any
 * other warehouse moved, and "Refresh" then overwrote `systemQty` with a number the counter
 * could not possibly see — manufacturing a variance on every product.
 *
 * `currentStock` survives as the fallback for exactly one case: a legacy audit with neither
 * FK set, whose scope is genuinely unknown.
 */
async function scopedQtyMap(
  scope: { storeId: string | null; warehouseId: string | null },
  productIds: string[]
): Promise<Map<string, number> | null> {
  if (scope.warehouseId) return getWarehouseQtyMap(productIds, scope.warehouseId);
  if (scope.storeId) return getStoreQtyMap(productIds, scope.storeId);
  return null; // legacy audit — the caller falls back to currentStock
}

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
            name: true, sku: true, currentStock: true, size: true,
            category: { select: { name: true } },
            brand: { select: { name: true } },
            bin: { select: { code: true, location: true } },
          },
        },
      },
      orderBy: { product: { name: "asc" } },
      ...(searchParams.get("limit") ? { take: parseInt(searchParams.get("limit")!) } : { take: 500 }),
    });

    // Stale = systemQty differs from what is in the SCOPE now, not from the global total.
    const scope = await prisma.stockCount.findUnique({
      where: { id },
      select: { storeId: true, warehouseId: true },
    });
    const liveQty = scope ? await scopedQtyMap(scope, items.map((i) => i.productId)) : null;
    const staleCount = items.filter((i) => {
      const live = liveQty ? (liveQty.get(i.productId) ?? 0) : i.product.currentStock;
      return i.systemQty !== live;
    }).length;

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
      items,
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

    // Saving counts belongs to the ASSIGNEE, whoever they are (R2).
    //
    // The line that used to sit here — "if you hold approve, you cannot save counts" —
    // blocked an approve-holder from counting an audit assigned to them, which is how an
    // owner who assigned an audit to themselves found a screen where nothing worked. Holding
    // `approve` is not a disqualification; the only thing it must not let you do is sign off
    // your own count, and that is enforced on the status transition in [id]/route.ts.
    const sc = await prisma.stockCount.findUnique({ where: { id }, select: { assignedToId: true } });
    if (!sc) return errorResponse("Stock count not found", 404);
    if (sc.assignedToId !== user.id) {
      return errorResponse(
        "Only the person this audit is assigned to can start, count or complete it",
        403
      );
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

    const scope = await prisma.stockCount.findUnique({
      where: { id },
      select: { storeId: true, warehouseId: true },
    });
    if (!scope) return errorResponse("Stock count not found", 404);

    const items = await prisma.stockCountItem.findMany({
      where: { stockCountId: id },
      include: { product: { select: { currentStock: true } } },
    });

    // Refresh to the SCOPED quantity. This wrote the global `currentStock` before, so on a
    // warehouse audit Refresh replaced a correct systemQty with the sum across every store.
    const liveQty = await scopedQtyMap(scope, items.map((i) => i.productId));

    let refreshed = 0;
    await prisma.$transaction(async (tx) => {
      for (const item of items) {
        const live = liveQty ? (liveQty.get(item.productId) ?? 0) : item.product.currentStock;
        if (item.systemQty !== live) {
          const newVariance = item.countedQty !== null ? item.countedQty - live : null;
          await tx.stockCountItem.update({
            where: { id: item.id },
            data: {
              systemQty: live,
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
