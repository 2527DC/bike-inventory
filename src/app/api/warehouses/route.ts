export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireAuth, requireFeature, AuthError } from "@/lib/auth-helpers";
import { clearWarehouseCache } from "@/lib/warehouses";
import { warehouseSchema } from "@/lib/validations";
import {
  FLOOR_NEEDS_PREFIX, WarehouseRuleError, assertPrefixFree, assertStoreHasPrimary,
  clearOtherPrimaries, normalisePrefix, uniqueViolationMessage,
} from "@/lib/warehouses-rules";
import { createLogger } from "@/lib/logger";

const log = createLogger("warehouses:api");

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
        kind: true,
        sortOrder: true,
        storeId: true,
        // FLOOR-only (plan 1609, R30/R33). Printed on the invoice itself; not sensitive.
        invoicePrefix: true,
        isPrimary: true,
        // gstin/stateCode ride along for P14's transfer-document derivation. Printed on the
        // document itself, so not sensitive — which is why this route stays requireAuth.
        store: { select: { id: true, code: true, name: true, gstin: true, stateCode: true } },
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
    const parsed = warehouseSchema.safeParse(await req.json());
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      log.warn("warehouse create body invalid", { path: first?.path.join("."), issues: parsed.error.issues.length });
      return errorResponse(first?.message ?? "Invalid warehouse", 400);
    }
    const data = parsed.data;

    // GODOWN when the client says nothing — the column default, spelled out so a caller
    // that predates `kind` still creates storage, never a shop floor by accident.
    const kind = data.kind ?? "GODOWN";
    const isFloor = kind === "FLOOR";
    // A GODOWN never carries a prefix or the primary flag, whatever the body says (R30).
    const invoicePrefix = isFloor ? normalisePrefix(data.invoicePrefix) : null;
    const isPrimary = isFloor ? data.isPrimary === true : false;
    if (isFloor && !invoicePrefix) return errorResponse(FLOOR_NEEDS_PREFIX, 400);

    // One transaction: the prefix check, moving the primary flag, the insert and the
    // "store still has one primary" check succeed or fail together (plan 1609 §1.7).
    const warehouse = await prisma.$transaction(async (tx) => {
      const store = await tx.store.findUnique({
        where: { id: data.storeId },
        select: { id: true, name: true, isActive: true },
      });
      if (!store) throw new WarehouseRuleError("Store not found", 400);
      if (!store.isActive) throw new WarehouseRuleError(`${store.name} is deactivated`, 400);

      const code = data.code.trim().toUpperCase();
      const clash = await tx.warehouse.findUnique({
        where: { code },
        select: { name: true, store: { select: { name: true } } },
      });
      if (clash) {
        throw new WarehouseRuleError(`Code "${code}" is already used by ${clash.name} at ${clash.store.name}`, 409);
      }

      if (invoicePrefix) await assertPrefixFree(tx, invoicePrefix);
      // Before the insert: the partial unique index refuses a second primary per store.
      if (isPrimary) await clearOtherPrimaries(tx, store.id);

      const created = await tx.warehouse.create({
        data: {
          storeId: store.id,
          code,
          name: data.name.trim(),
          kind,
          sortOrder: data.sortOrder ?? 0,
          invoicePrefix,
          isPrimary,
        },
        select: {
          id: true, code: true, name: true, kind: true, sortOrder: true, isActive: true,
          invoicePrefix: true, isPrimary: true,
          store: { select: { id: true, code: true, name: true } },
        },
      });

      if (isFloor) await assertStoreHasPrimary(tx, store.id);
      return created;
    });

    log.info("warehouse created", {
      warehouseId: warehouse.id, code: warehouse.code, kind: warehouse.kind,
      storeId: warehouse.store.id, isPrimary: warehouse.isPrimary,
    });
    // A new warehouse is not in the cached set.
    // The cached array would otherwise outlive the change for the life of the process —
    // which is how a warehouse the picker offers gets refused by the server that offered it.
    clearWarehouseCache();
    return successResponse(warehouse, 201);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    if (error instanceof WarehouseRuleError) {
      log.warn("warehouse create refused", { status: error.status, message: error.message });
      return errorResponse(error.message, error.status);
    }
    const unique = uniqueViolationMessage(error);
    if (unique) {
      log.warn("warehouse create hit a unique constraint", { message: unique });
      return errorResponse(unique, 409);
    }
    const message = error instanceof Error ? error.message : "Failed to create the warehouse";
    log.error("warehouse create failed", { message });
    return errorResponse(message, 400);
  }
}
