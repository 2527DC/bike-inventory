export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { warehouseByCode } from "@/lib/warehouses";
import { storeByCode } from "@/lib/stores";
import { createLogger } from "@/lib/logger";

const log = createLogger("api:stock:by-location");

/**
 * Every active product holding stock at one place, with its quantity and value there.
 *
 * The segment is a CODE that may name EITHER level, resolved against the database on each
 * request. This is the one route where the old enum leaked into a URL, and it is fixed by
 * making it read the database rather than by picking a redirect target:
 *
 *   /stock/by-location/BCH_WAREHOUSE   one warehouse   that warehouse's StockLevel rows
 *   /stock/by-location/BCH_STORE       one store       the SUM across all its warehouses
 *   anything else                      nothing         404
 *
 * Resolving both levels is deliberate. Rejecting the store codes, or redirecting them to the
 * site's single warehouse, would bake in today's one-warehouse-per-store shape and need
 * rewriting the first time a second warehouse is added — which is the entire point of the
 * migration that made these rows. Warehouse is tried FIRST because it is the common case and
 * because codes are unique per table, not across them.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ location: string }> }) {
  try {
    await requireFeature("stock", "view");
    const { location } = await params;
    const code = decodeURIComponent(location).toUpperCase();

    const warehouse = await warehouseByCode(code);
    const store = warehouse ? null : await storeByCode(code);

    if (!warehouse && !store) {
      log.warn("unknown location code", { code });
      return errorResponse("Unknown location", 404);
    }

    // A store aggregates its warehouses; a warehouse is itself. One query either way.
    const where = warehouse
      ? { warehouseId: warehouse.id }
      : { warehouse: { storeId: store!.id } };

    const rows = await prisma.stockLevel.findMany({
      where: { ...where, quantity: { not: 0 }, product: { status: "ACTIVE" } },
      select: {
        quantity: true,
        warehouse: { select: { id: true, code: true, name: true } },
        product: {
          select: {
            id: true, name: true, sku: true, sellingPrice: true, reorderLevel: true,
            brand: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { product: { name: "asc" } },
    });

    // At store level a product may hold stock in more than one warehouse, and the screen
    // shows one row per product. Summing here rather than in the query keeps the per-warehouse
    // detail available for the breakdown below.
    const byProduct = new Map<string, {
      id: string; name: string; sku: string;
      brandId: string | null; brandName: string;
      qty: number; value: number; reorderLevel: number;
    }>();

    for (const r of rows) {
      const p = r.product;
      const existing = byProduct.get(p.id);
      if (existing) {
        existing.qty += r.quantity;
        existing.value += r.quantity * (p.sellingPrice ?? 0);
      } else {
        byProduct.set(p.id, {
          id: p.id,
          name: p.name,
          sku: p.sku,
          brandId: p.brand?.id ?? null,
          brandName: p.brand?.name ?? "Unbranded",
          qty: r.quantity,
          value: r.quantity * (p.sellingPrice ?? 0),
          reorderLevel: p.reorderLevel ?? 0,
        });
      }
    }

    const products = [...byProduct.values()];

    // Only meaningful at store level, and only interesting once a store has more than one
    // warehouse — which is exactly the shape this migration exists to allow.
    const warehouseTotals = store
      ? [...rows.reduce((m, r) => {
          const cur = m.get(r.warehouse.code) ?? { code: r.warehouse.code, name: r.warehouse.name, units: 0 };
          cur.units += r.quantity;
          m.set(r.warehouse.code, cur);
          return m;
        }, new Map<string, { code: string; name: string; units: number }>()).values()]
      : null;

    return successResponse({
      code,
      // "warehouse" or "store", so the page can say which it is showing without guessing
      // from the code's spelling.
      level: warehouse ? "warehouse" : "store",
      // The heading comes from the resolved row, so BCH_STORE renders "BCH Store" with no
      // lookup table in the component.
      label: warehouse?.name ?? store!.name,
      warehouses: warehouseTotals,
      totalUnits: products.reduce((s, p) => s + p.qty, 0),
      totalValue: products.reduce((s, p) => s + p.value, 0),
      productCount: products.length,
      products,
    });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    const message = error instanceof Error ? error.message : "Failed to fetch location stock";
    log.error("by-location failed", { message });
    return errorResponse(message, 500);
  }
}
