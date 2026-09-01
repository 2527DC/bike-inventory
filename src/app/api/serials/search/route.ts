export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { PRODUCT_TYPE_SELECT, withTypeName } from "@/lib/product-type";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";

export async function GET(req: NextRequest) {
  try {
    await requireFeature("stock", "view");
    const { searchParams } = new URL(req.url);
    const code = searchParams.get("code");

    if (!code || code.length < 2) {
      return errorResponse("Search code must be at least 2 characters", 400);
    }

    // Search serial items by serial code or barcode
    const serials = await prisma.serialItem.findMany({
      where: {
        OR: [
          { serialCode: { contains: code, mode: "insensitive" } },
          { barcodeData: { contains: code, mode: "insensitive" } },
        ],
      },
      include: {
        product: { select: { name: true, sku: true, productType: PRODUCT_TYPE_SELECT, sellingPrice: true, mrp: true } },
        bin: { select: { code: true, location: true } },
      },
      take: 20,
      orderBy: { serialCode: "asc" },
    });

    // Also search products by SKU or name (for items without serials)
    const products = await prisma.product.findMany({
      where: {
        OR: [
          { sku: { contains: code, mode: "insensitive" } },
          { name: { contains: code, mode: "insensitive" } },
        ],
      },
      select: {
        id: true,
        sku: true,
        name: true,
        productType: PRODUCT_TYPE_SELECT,
        currentStock: true,
        sellingPrice: true,
        mrp: true,
        bin: { select: { code: true, location: true } },
      },
      take: 10,
      orderBy: { name: "asc" },
    });

    return successResponse({ serials, products: products.map(withTypeName) });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to search", 500);
  }
}
