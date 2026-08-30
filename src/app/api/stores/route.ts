export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireAuth, requireFeature, AuthError } from "@/lib/auth-helpers";
import { storeSchema } from "@/lib/validations";
import { createLogger } from "@/lib/logger";

const log = createLogger("api:stores");

/**
 * List stores, with their warehouses nested.
 *
 * ⚠️ GUARDED BY requireAuth() ONLY — NOT by requireFeature("stores", "view"). This is
 * deliberate and must stay that way.
 *
 * Every location dropdown in the application reads this: assigning a user to a site on
 * /team, picking a destination on /transfers/new, choosing where an inbound shipment lands.
 * Those are things ordinary staff do. Gating this read on the `stores` module — which only
 * administrators of the hierarchy hold — empties every one of those dropdowns for everyone
 * else, and it fails as an EMPTY LIST rather than a 403, so it reads as "nobody ever created
 * a warehouse" instead of "you lack a permission". That is a very expensive thing to debug.
 *
 * Knowing that BCH Warehouse exists is not sensitive. CHANGING it is, and every mutation on
 * this resource is behind `requireFeature("stores", …)` / `requireFeature("warehouses", …)`
 * — see the plan's Phase 6.
 *
 * If a reviewer asks why this route is not permission-guarded, this comment is the answer.
 */
export async function GET() {
  try {
    await requireAuth();

    const stores = await prisma.store.findMany({
      where: { isActive: true },
      select: {
        id: true,
        code: true,
        name: true,
        address: true,
        phone: true,
        sortOrder: true,
        warehouses: {
          where: { isActive: true },
          select: { id: true, code: true, name: true, sortOrder: true },
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        },
      },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });

    log.debug("stores listed", { count: stores.length });
    return successResponse(stores);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    const message = error instanceof Error ? error.message : "Failed to fetch stores";
    log.error("stores list failed", { message });
    return errorResponse(message, 500);
  }
}

// Mutations ARE permission-guarded, unlike the read above. Knowing BCH Store exists is not
// sensitive; creating or renaming a site is.
export async function POST(req: NextRequest) {
  try {
    await requireFeature("stores", "create");
    const data = storeSchema.parse(await req.json());

    const code = data.code.trim().toUpperCase();
    const clash = await prisma.store.findUnique({ where: { code }, select: { name: true } });
    if (clash) return errorResponse(`Code "${code}" is already used by ${clash.name}`, 409);

    const store = await prisma.store.create({
      data: {
        code,
        name: data.name.trim(),
        address: data.address?.trim() || null,
        phone: data.phone?.trim() || null,
        sortOrder: data.sortOrder ?? 0,
      },
    });

    log.info("store created", { storeId: store.id, code: store.code });
    return successResponse(store, 201);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    const message = error instanceof Error ? error.message : "Failed to create the store";
    log.error("store create failed", { message });
    return errorResponse(message, 400);
  }
}
