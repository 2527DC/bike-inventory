export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";
import { LIVE_UNIT_STATUSES } from "@/lib/units/constants";

const log = createLogger("stock:condition");

const LIVE = LIVE_UNIT_STATUSES as string[];

/**
 * Assembled vs unassembled, per model per location (plan 1709-priority-build-and-stock-flow,
 * R11, P7). One row per product per warehouse that holds at least one LIVE unit.
 *
 * Read from the units, never from StockLevel — there is deliberately no "not tracked" column
 * (Q13, Q43): stock is re-audited at unit level. The three conditions are defined exactly as in
 * src/lib/stock-condition.ts (no assembly wins; then assembledAt set / null).
 *
 * GET ?storeId=&warehouseId=&brandId=&search=&page=&limit=
 * Response: { rows, totals, pagination }
 */
export async function GET(req: NextRequest) {
  try {
    await requireFeature("stock", "view");

    const sp = new URL(req.url).searchParams;
    const storeId = sp.get("storeId") || null;
    const warehouseId = sp.get("warehouseId") || null;
    const brandId = sp.get("brandId") || null;
    const search = (sp.get("search") || "").trim();
    const page = Math.max(1, parseInt(sp.get("page") || "1", 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(sp.get("limit") || "50", 10) || 50));
    const offset = (page - 1) * limit;

    const filters: Prisma.Sql[] = [Prisma.sql`u.status::text = ANY(${LIVE})`];
    if (storeId) filters.push(Prisma.sql`w."storeId" = ${storeId}`);
    if (warehouseId) filters.push(Prisma.sql`u.warehouse_id = ${warehouseId}`);
    if (brandId) filters.push(Prisma.sql`p."brandId" = ${brandId}`);
    if (search) {
      // Every word must match the name or the SKU — the /stock search rule.
      for (const word of search.split(/\s+/).filter(Boolean)) {
        const like = `%${word}%`;
        filters.push(Prisma.sql`(p.name ILIKE ${like} OR p.sku ILIKE ${like})`);
      }
    }
    const where = Prisma.join(filters, " AND ");

    const started = Date.now();
    const [rows, summary] = await Promise.all([
      prisma.$queryRaw<
        Array<{
          product_id: string;
          product_name: string;
          sku: string;
          brand_name: string | null;
          warehouse_id: string;
          warehouse_name: string;
          warehouse_kind: "FLOOR" | "GODOWN";
          store_id: string;
          store_name: string;
          assembled: number;
          unassembled: number;
          no_assembly: number;
          total: number;
        }>
      >`
        SELECT u.product_id,
               p.name            AS product_name,
               p.sku,
               b.name            AS brand_name,
               u.warehouse_id,
               w.name            AS warehouse_name,
               w.kind::text      AS warehouse_kind,
               w."storeId"       AS store_id,
               s.name            AS store_name,
               COUNT(*) FILTER (WHERE NOT u.non_assemblable AND u.assembled_at IS NOT NULL)::int AS assembled,
               COUNT(*) FILTER (WHERE NOT u.non_assemblable AND u.assembled_at IS NULL)::int     AS unassembled,
               COUNT(*) FILTER (WHERE u.non_assemblable)::int                                    AS no_assembly,
               COUNT(*)::int                                                                     AS total
        FROM inventory_units u
        JOIN "Product"   p ON p.id = u.product_id
        LEFT JOIN "Brand" b ON b.id = p."brandId"
        JOIN "Warehouse" w ON w.id = u.warehouse_id
        JOIN "Store"     s ON s.id = w."storeId"
        WHERE ${where}
        GROUP BY u.product_id, p.name, p.sku, b.name, u.warehouse_id, w.name, w.kind, w."storeId", s.name
        ORDER BY p.name ASC, s.name ASC, w.kind ASC, w.name ASC
        LIMIT ${limit} OFFSET ${offset}
      `,
      prisma.$queryRaw<
        Array<{ groups: number; assembled: number; unassembled: number; no_assembly: number; total: number }>
      >`
        SELECT COUNT(DISTINCT (u.product_id, u.warehouse_id))::int                                 AS groups,
               COUNT(*) FILTER (WHERE NOT u.non_assemblable AND u.assembled_at IS NOT NULL)::int AS assembled,
               COUNT(*) FILTER (WHERE NOT u.non_assemblable AND u.assembled_at IS NULL)::int     AS unassembled,
               COUNT(*) FILTER (WHERE u.non_assemblable)::int                                    AS no_assembly,
               COUNT(*)::int                                                                     AS total
        FROM inventory_units u
        JOIN "Product"   p ON p.id = u.product_id
        JOIN "Warehouse" w ON w.id = u.warehouse_id
        WHERE ${where}
      `,
    ]);

    const s = summary[0] ?? { groups: 0, assembled: 0, unassembled: 0, no_assembly: 0, total: 0 };
    log.debug("condition rows", {
      storeId,
      warehouseId,
      brandId,
      page,
      returned: rows.length,
      groups: s.groups,
      ms: Date.now() - started,
    });

    return successResponse({
      rows: rows.map((r) => ({
        productId: r.product_id,
        productName: r.product_name,
        sku: r.sku,
        brandName: r.brand_name,
        storeId: r.store_id,
        storeName: r.store_name,
        warehouseId: r.warehouse_id,
        warehouseName: r.warehouse_name,
        warehouseKind: r.warehouse_kind,
        assembled: r.assembled,
        unassembled: r.unassembled,
        noAssembly: r.no_assembly,
        total: r.total,
      })),
      totals: {
        assembled: s.assembled,
        unassembled: s.unassembled,
        noAssembly: s.no_assembly,
        total: s.total,
      },
      pagination: {
        total: s.groups,
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(s.groups / limit)),
        hasMore: page * limit < s.groups,
      },
    });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    log.error("condition list failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return errorResponse(error instanceof Error ? error.message : "Failed to load stock condition", 500);
  }
}
