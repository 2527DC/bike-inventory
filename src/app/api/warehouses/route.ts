export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireAuth, AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";

const log = createLogger("api:warehouses");

/**
 * List warehouses, flat, each carrying its store. Optional `?storeId=` filter.
 *
 * ⚠️ GUARDED BY requireAuth() ONLY — NOT by requireFeature("warehouses", "view"). Same
 * reasoning as GET /api/stores, and the same warning: tightening this empties every location
 * dropdown in the application for every user who is not a warehouse administrator, and it
 * does so silently — an empty list, not a 403. It would read as "no warehouses exist".
 *
 * Stock lives in warehouses, so this is the list `/transfers/new`, `/inbound/[id]` and
 * `/stock-audit/new` populate their selects from. Mutations are guarded; reads are not.
 */
export async function GET(req: NextRequest) {
  try {
    await requireAuth();

    const storeId = new URL(req.url).searchParams.get("storeId") || undefined;

    const warehouses = await prisma.warehouse.findMany({
      where: { isActive: true, ...(storeId ? { storeId } : {}) },
      select: {
        id: true,
        code: true,
        name: true,
        sortOrder: true,
        storeId: true,
        store: { select: { id: true, code: true, name: true } },
      },
      orderBy: [{ store: { sortOrder: "asc" } }, { sortOrder: "asc" }, { name: "asc" }],
    });

    log.debug("warehouses listed", { count: warehouses.length, filtered: Boolean(storeId) });
    return successResponse(warehouses);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    const message = error instanceof Error ? error.message : "Failed to fetch warehouses";
    log.error("warehouses list failed", { message });
    return errorResponse(message, 500);
  }
}
