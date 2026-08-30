import { prisma } from "@/lib/db";
import { createLogger } from "@/lib/logger";

const log = createLogger("warehouses");

export interface WarehouseRef {
  id: string;
  code: string;
  name: string;
  storeId: string;
}

/**
 * Warehouse lookups, request-scoped cached.
 *
 * Replaces the STOCK_LOCATIONS constant deleted from inventory-config.ts. A dropdown or an
 * import loop asks for the set repeatedly within one request; without the cache that is one
 * query per ask, which is the same defect the Zoho pull was fixed for.
 *
 * The cache lives for the module's lifetime in a serverless invocation, which is effectively
 * the request. It is deliberately NOT invalidated: a warehouse created mid-request is not a
 * case worth designing for, and a stale entry cannot outlive the invocation.
 */
let cache: WarehouseRef[] | null = null;

/** All active warehouses, ordered as the pickers show them. */
export async function listWarehouses(): Promise<WarehouseRef[]> {
  if (cache) return cache;
  cache = await prisma.warehouse.findMany({
    where: { isActive: true },
    select: { id: true, code: true, name: true, storeId: true },
    orderBy: [{ store: { sortOrder: "asc" } }, { sortOrder: "asc" }, { name: "asc" }],
  });
  log.debug("warehouse set loaded", { count: cache.length });
  return cache;
}

/** One warehouse by its stable code ("BCH_WAREHOUSE"), or null. */
export async function warehouseByCode(code: string): Promise<WarehouseRef | null> {
  const all = await listWarehouses();
  return all.find((w) => w.code === code) ?? null;
}

/** One warehouse by id, or null. */
export async function warehouseById(id: string): Promise<WarehouseRef | null> {
  const all = await listWarehouses();
  return all.find((w) => w.id === id) ?? null;
}

/**
 * Resolve a warehouse id from an incoming request, or return the message to reject with.
 *
 * There is NO fallback and no default. `DEFAULT_STOCK_LOCATION` used to silently absorb a
 * missing or malformed value; with warehouses as data that would put stock in the wrong
 * building and report nothing. A 400 is strictly better than a confident wrong answer.
 *
 * Accepts either an id or a code, because the old enum values are now codes and a caller
 * carrying "BCH_WAREHOUSE" through from an older payload should still resolve rather than
 * fail confusingly.
 */
export async function resolveWarehouse(
  value: string | null | undefined
): Promise<{ warehouse: WarehouseRef } | { error: string }> {
  const raw = (value ?? "").trim();
  if (!raw) return { error: "A warehouse is required to receive this shipment" };

  const all = await listWarehouses();
  const hit = all.find((w) => w.id === raw) ?? all.find((w) => w.code === raw.toUpperCase());
  if (!hit) {
    log.warn("unresolvable warehouse", { value: raw, known: all.length });
    return { error: `"${raw}" is not an active warehouse` };
  }
  return { warehouse: hit };
}

/** Test-only escape hatch; also used by the seed when it creates warehouses mid-process. */
export function clearWarehouseCache() {
  cache = null;
}
