export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";

export async function GET(req: NextRequest) {
  try {
    await requireFeature("reports", "view");
    const { searchParams } = new URL(req.url);

    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const dateFrom = searchParams.get("dateFrom") ? new Date(searchParams.get("dateFrom")!) : thirtyDaysAgo;
    const dateTo = searchParams.get("dateTo") ? new Date(searchParams.get("dateTo")!) : now;

    const transactions = await prisma.inventoryTransaction.findMany({
      where: { createdAt: { gte: dateFrom, lte: dateTo } },
      select: { productId: true, type: true, quantity: true },
    });

    const productMap = new Map<string, { inward: number; outward: number }>();
    let totalInward = 0;
    let totalOutward = 0;

    for (const t of transactions) {
      const entry = productMap.get(t.productId) || { inward: 0, outward: 0 };
      if (t.type === "INWARD") {
        entry.inward += t.quantity;
        totalInward += t.quantity;
      } else if (t.type === "OUTWARD") {
        entry.outward += t.quantity;
        totalOutward += t.quantity;
      }
      productMap.set(t.productId, entry);
    }

    // Single query — the redundant productIds query was a subset of this
    const allActiveProducts = await prisma.product.findMany({
      where: { status: "ACTIVE" },
      select: { id: true, name: true, sku: true, currentStock: true, category: { select: { name: true } } },
    });

    const daysDiff = Math.max(1, Math.ceil((dateTo.getTime() - dateFrom.getTime()) / (1000 * 60 * 60 * 24)));
    const monthFactor = daysDiff / 30;

    const productDetails = allActiveProducts.map((p) => {
      const movement = productMap.get(p.id) || { inward: 0, outward: 0 };
      const monthlyOutward = monthFactor > 0 ? movement.outward / monthFactor : 0;
      let classification: "FAST" | "SLOW" | "DEAD";
      if (monthlyOutward > 10) classification = "FAST";
      else if (monthlyOutward >= 1) classification = "SLOW";
      else classification = "DEAD";

      return {
        id: p.id, name: p.name, sku: p.sku, currentStock: p.currentStock,
        category: p.category?.name,
        inward: movement.inward, outward: movement.outward,
        monthlyOutward: Math.round(monthlyOutward * 10) / 10,
        classification,
      };
    });

    const fast = productDetails.filter((p) => p.classification === "FAST").length;
    const slow = productDetails.filter((p) => p.classification === "SLOW").length;
    const dead = productDetails.filter((p) => p.classification === "DEAD").length;

    return successResponse({
      dateFrom: dateFrom.toISOString(),
      dateTo: dateTo.toISOString(),
      days: daysDiff,
      summary: { fast, slow, dead, totalInward, totalOutward },
      products: productDetails.sort((a, b) => b.outward - a.outward),
    });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to fetch movement report", 500);
  }
}
