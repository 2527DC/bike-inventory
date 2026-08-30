export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireAuth, requireFeature, AuthError } from "@/lib/auth-helpers";
import { warehouseSchema } from "@/lib/validations";
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

// Guarded on `warehouses`, NOT `stores`. That split is the point of the two-module shape:
// a warehouse supervisor may add a warehouse to an existing site without being able to open
// a new store.
export async function POST(req: NextRequest) {
  try {
    await requireFeature("warehouses", "create");
    const data = warehouseSchema.parse(await req.json());

    const store = await prisma.store.findUnique({
      where: { id: data.storeId },
      select: { id: true, name: true, isActive: true },
    });
    if (!store) return errorResponse("Store not found", 400);
    if (!store.isActive) return errorResponse(`${store.name} is deactivated`, 400);

    const code = data.code.trim().toUpperCase();
    const clash = await prisma.warehouse.findUnique({
      where: { code },
      select: { name: true, store: { select: { name: true } } },
    });
    if (clash) {
      return errorResponse(`Code "${code}" is already used by ${clash.name} at ${clash.store.name}`, 409);
    }

    const warehouse = await prisma.warehouse.create({
      data: {
        storeId: store.id,
        code,
        name: data.name.trim(),
        sortOrder: data.sortOrder ?? 0,
      },
      select: {
        id: true, code: true, name: true, sortOrder: true, isActive: true,
        store: { select: { id: true, code: true, name: true } },
      },
    });

    log.info("warehouse created", { warehouseId: warehouse.id, code: warehouse.code, storeId: store.id });
    return successResponse(warehouse, 201);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    const message = error instanceof Error ? error.message : "Failed to create the warehouse";
    log.error("warehouse create failed", { message });
    return errorResponse(message, 400);
  }
}
