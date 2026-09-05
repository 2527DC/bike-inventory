export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";

// GET: Find products with no inward transactions in 90+ days
export async function GET(req: NextRequest) {
  try {
    await requireFeature("stock", "view");
    const { searchParams } = new URL(req.url);
    const days = parseInt(searchParams.get("days") || "90", 10);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    // Products that have no INWARD transaction after the cutoff date
    const staleProducts = await prisma.product.findMany({
      where: {
        status: "ACTIVE",
        transactions: {
          none: {
            type: "INWARD",
            createdAt: { gte: cutoff },
          },
        },
      },
      select: {
        id: true,
        sku: true,
        name: true,
        currentStock: true,
        category: { select: { name: true } },
        brand: { select: { name: true } },
        bin: { select: { code: true } },
        transactions: {
          where: { type: "INWARD" },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { createdAt: true },
        },
      },
      orderBy: { name: "asc" },
    });

    const result = staleProducts.map((p) => ({
      ...p,
      lastInwardDate: p.transactions[0]?.createdAt || null,
      transactions: undefined,
    }));

    return successResponse({ products: result, total: result.length, cutoffDays: days });
  } catch (error) {
    if (error instanceof AuthError) {
      return errorResponse(error.message, error.status);
    }
    return errorResponse(
      error instanceof Error ? error.message : "Failed to fetch stale products",
      500
    );
  }
}

// POST: Mark selected products as INACTIVE
export async function POST(req: NextRequest) {
  try {
    // delete, NOT create: this sets products INACTIVE, removing them from every picker.
    // A soft delete is still a delete.
    await requireFeature("stock", "delete");
    const body = await req.json();
    const { productIds } = body;

    if (!productIds || !Array.isArray(productIds) || productIds.length === 0) {
      return errorResponse("productIds array is required", 400);
    }

    const updated = await prisma.product.updateMany({
      where: { id: { in: productIds }, status: "ACTIVE" },
      data: { status: "INACTIVE" },
    });

    return successResponse({ marked: updated.count });
  } catch (error) {
    if (error instanceof AuthError) {
      return errorResponse(error.message, error.status);
    }
    return errorResponse(
      error instanceof Error ? error.message : "Failed to mark products inactive",
      400
    );
  }
}
