export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { userCan } from "@/lib/rbac";

/**
 * Product typeahead, used by /purchase-orders/new and /stock-audit/brand-count.
 *
 * P8 widened the select, and that was a BUG FIX, not a convenience. `/purchase-orders/new`
 * declares its rows as `{ id, name, sku, costPrice: number, gstRate: number }` — both
 * non-optional, so TypeScript never complained — while this route returned neither. The two
 * fields arrived `undefined` and rendered as **₹NaN in five places**: the dropdown row before
 * the item is even added, the line total, and all three of subtotal, GST and grand total.
 * They also flowed into the line item as `unitPrice`/`gstRate`, so the PO was built on them.
 *
 * `costPrice` is gated behind the `cost_price` module, the same way `api/products/route.ts`
 * does it: a boolean in the Prisma select, so an ungranted caller never has the number in the
 * response at all rather than having it stripped afterwards. Callers must therefore treat it
 * as possibly absent — see the ₹0 handling on the PO screen.
 */
export async function GET(req: NextRequest) {
  try {
    const user = await requireFeature("stock", "view");
    // The route used to discard requireFeature's return, so there was no user to check with.
    const canSeeCost = await userCan(user.id, "cost_price", "view");
    const params = new URL(req.url).searchParams;
    const q = params.get("q") || "";
    // "" means no filter, NOT "products with no vendor" — the search box on
    // /purchase-orders/new is usable before a vendor has been chosen.
    const vendorId = params.get("vendorId") || undefined;
    if (q.length < 2) {
      return successResponse([]);
    }

    const products = await prisma.product.findMany({
      where: {
        status: "ACTIVE",
        // AND of two ORs, NOT two OR keys. A second `OR` in the same object literal silently
        // REPLACES the first in JavaScript — it still compiles and still returns rows, just
        // the wrong ones, with the text search quietly gone. This is the shape that keeps both.
        AND: [
          {
            OR: [
              { name: { contains: q, mode: "insensitive" as const } },
              { sku: { contains: q, mode: "insensitive" as const } },
              { brand: { name: { contains: q, mode: "insensitive" as const } } },
              { category: { name: { contains: q, mode: "insensitive" as const } } },
              { bin: { code: { contains: q, mode: "insensitive" as const } } },
            ],
          },
          // Scope to what this vendor supplies: the product's own reorder vendor, or any
          // product of a brand the vendor is linked to. The brand half reads `brand_vendors`,
          // which is empty until somebody fills it in on a vendor's page — so before that,
          // this narrows to reorderVendorId alone. That is the honest behaviour, not a bug.
          ...(vendorId
            ? [
                {
                  OR: [
                    { reorderVendorId: vendorId },
                    { brand: { vendors: { some: { vendorId } } } },
                  ],
                },
              ]
            : []),
        ],
      },
      select: {
        id: true,
        sku: true,
        name: true,
        currentStock: true,
        reorderLevel: true,
        // Added in P8. costPrice and gstRate are the ₹NaN; brandId, reorderQty and
        // reorderVendorId are what P9/P10 need to group a PO by vendor without a second round
        // trip per product.
        costPrice: canSeeCost,
        gstRate: true,
        brandId: true,
        reorderQty: true,
        reorderVendorId: true,
        bin: { select: { code: true, location: true } },
        category: { select: { name: true } },
        brand: { select: { name: true } },
      },
      take: 20,
      orderBy: { name: "asc" },
    });

    return successResponse(products);
  } catch (error) {
    if (error instanceof AuthError) {
      return errorResponse(error.message, error.status);
    }
    return errorResponse(
      error instanceof Error ? error.message : "Search failed",
      500
    );
  }
}
