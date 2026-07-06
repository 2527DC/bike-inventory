export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireAuth, AuthError } from "@/lib/auth-helpers";
import { isStockLocation, stockLocationLabel, type StockLocation } from "@/lib/inventory-config";

// GET — every active product that has stock in one location, with its qty + value there.
// The client derives the brand list + per-brand totals for the dropdown filter.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ location: string }> }) {
  try {
    await requireAuth();
    const { location } = await params;
    if (!isStockLocation(location)) return errorResponse("Unknown location", 404);

    const rows = await prisma.stockLevel.findMany({
      where: { location: location as StockLocation, quantity: { not: 0 }, product: { status: "ACTIVE" } },
      select: {
        quantity: true,
        product: {
          select: {
            id: true, name: true, sku: true, sellingPrice: true, reorderLevel: true,
            brand: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { product: { name: "asc" } },
    });

    const products = rows.map((r) => ({
      id: r.product.id,
      name: r.product.name,
      sku: r.product.sku,
      brandId: r.product.brand?.id ?? null,
      brandName: r.product.brand?.name ?? "Unbranded",
      qty: r.quantity,
      value: r.quantity * (r.product.sellingPrice ?? 0),
      reorderLevel: r.product.reorderLevel ?? 0,
    }));

    return successResponse({
      location,
      label: stockLocationLabel(location),
      totalUnits: products.reduce((s, p) => s + p.qty, 0),
      totalValue: products.reduce((s, p) => s + p.value, 0),
      productCount: products.length,
      products,
    });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to fetch location stock", 500);
  }
}
