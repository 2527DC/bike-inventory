export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { errorResponse, paginatedResponse, parseSearchParams } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";

export async function GET(req: NextRequest) {
  try {
    const user = await requireFeature("inbound", "view");
    const { page, limit, skip, searchParams } = parseSearchParams(req.url);
    const dateFrom = searchParams.get("dateFrom");
    const dateTo = searchParams.get("dateTo");
    const mine = searchParams.get("mine") === "true";

    const excludeStockCounts = searchParams.get("excludeStockCounts") === "true";

    const where = {
      type: "INWARD" as const,
      ...((dateFrom || dateTo) && {
        createdAt: {
          ...(dateFrom && { gte: new Date(dateFrom) }),
          ...(dateTo && { lte: new Date(dateTo) }),
        },
      }),
      ...(mine && { userId: user.id }),
      ...(excludeStockCounts && { NOT: { notes: { contains: "[STOCK_COUNT]" } } }),
    };

    const [transactions, total] = await Promise.all([
      prisma.inventoryTransaction.findMany({
        where,
        include: {
          product: { select: { name: true, sku: true, size: true, brand: { select: { name: true } } } },
          user: { select: { name: true } },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.inventoryTransaction.count({ where }),
    ]);

    return paginatedResponse(transactions, total, page, limit);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to fetch inwards", 500);
  }
}
