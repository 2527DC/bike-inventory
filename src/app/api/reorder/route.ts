export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";

export async function GET(req: NextRequest) {
  try {
    await requireFeature("reorder", "view");
    const { searchParams } = new URL(req.url);
    const groupBy = searchParams.get("groupBy") || "brand"; // brand | category | vendor
    const filter = searchParams.get("filter") || "all"; // all | low | zero
    const brandId = searchParams.get("brandId") || undefined;
    const categoryId = searchParams.get("categoryId") || undefined;
    const search = searchParams.get("search") || "";

    const where = {
      status: "ACTIVE" as const,
      ...(brandId && { brandId }),
      ...(categoryId && { categoryId }),
      ...(filter === "zero" && { currentStock: 0 }),
      ...(search && {
        OR: [
          { name: { contains: search, mode: "insensitive" as const } },
          { sku: { contains: search, mode: "insensitive" as const } },
        ],
      }),
    };

    let products = await prisma.product.findMany({
      where,
      select: {
        id: true, sku: true, name: true,
        currentStock: true, reorderLevel: true, reorderQty: true,
        costPrice: true,
        category: { select: { id: true, name: true } },
        brand: { select: { id: true, name: true } },
        reorderVendor: { select: { id: true, name: true, whatsappNumber: true, phone: true } },
      },
      orderBy: groupBy === "vendor"
        ? [{ reorderVendor: { name: "asc" } }, { name: "asc" }]
        : groupBy === "brand"
        ? [{ brand: { name: "asc" } }, { name: "asc" }]
        : [{ category: { name: "asc" } }, { name: "asc" }],
    });

    // For "low" filter: currentStock <= reorderLevel (can't compare two fields in Prisma)
    if (filter === "low") {
      products = products.filter((p) => p.reorderLevel > 0 && p.currentStock <= p.reorderLevel);
    }

    // The flat `type` name, added after filtering and before grouping so every product in
    // every group carries it — /reorder declares its own `interface { type: string }` and
    // would otherwise render undefined with a green build.

    // Group products (handle null brand/category/vendor)
    const groups: Record<string, { id: string; name: string; whatsappNumber?: string | null; phone?: string | null; products: typeof products }> = {};
    for (const p of products) {
      let key: string, name: string, whatsappNumber: string | null | undefined, phone: string | null | undefined;
      if (groupBy === "vendor") {
        key = p.reorderVendor?.id || "unassigned";
        name = p.reorderVendor?.name || "No Vendor Assigned";
        whatsappNumber = p.reorderVendor?.whatsappNumber;
        phone = p.reorderVendor?.phone;
      } else if (groupBy === "brand") {
        key = p.brand?.id || "unbranded";
        name = p.brand?.name || "Unbranded";
      } else {
        key = p.category?.id || "uncategorized";
        name = p.category?.name || "Uncategorized";
      }
      if (!groups[key]) groups[key] = { id: key, name, whatsappNumber, phone, products: [] };
      groups[key].products.push(p);
    }

    const data = Object.values(groups).sort((a, b) => a.name.localeCompare(b.name));

    // Summary counts
    const totalProducts = products.length;
    const lowStockCount = products.filter((p) => p.reorderLevel > 0 && p.currentStock <= p.reorderLevel).length;
    const zeroStockCount = products.filter((p) => p.currentStock === 0).length;

    return successResponse({
      groups: data,
      summary: { totalProducts, lowStockCount, zeroStockCount },
    });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to fetch reorder data", 500);
  }
}
