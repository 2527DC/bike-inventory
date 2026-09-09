import { prisma } from "@/lib/db";
import { createLogger } from "@/lib/logger";

const log = createLogger("warehouses");

export interface WarehouseRef {
  id: string;
  code: string;
  name: string;
  /** FLOOR is the shop, GODOWN is storage (plan 0909-stock-store-and-warehouse-scoping, D2). */
  kind: "FLOOR" | "GODOWN";
  storeId: string;
  /**
   * The owning store's tax identity, for P14's document derivation, plus its `code`
   * ("BCH_STORE") — whose prefix is the site key `/stock/by-bin` groups warehouses under.
   */
  store: { code: string; gstin: string | null; stateCode: string | null };
}

/**
 * Warehouse lookups, request-scoped cached.
 *
 * Replaces the STOCK_LOCATIONS constant deleted from inventory-config.ts. A dropdown or an
 * import loop asks for the set repeatedly within one request; without the cache that is one
 * query per ask, which is the same defect the Zoho pull was fixed for.
 *
 * ⚠ THE COMMENT THAT USED TO BE HERE WAS WRONG, and it cost a real bug.
 *
 * It said the cache "lives for the module's lifetime in a serverless invocation, which is
 * effectively the request", and that "a stale entry cannot outlive the invocation". Neither is
 * true. `next start` is ONE long-lived Node process, so module scope lives until the next
 * deploy; on Vercel a warm lambda serves many requests over minutes. This repo's own
 * `notify/email.ts` says so explicitly about its transport.
 *
 * What that bought: add a warehouse on /stores, and the pickers show it immediately (they read
 * uncached force-dynamic routes) — but the SUBMIT is refused. `resolveWarehouse` consults this
 * stale array and answers "…is not an active warehouse", so the server denies a choice it just
 * offered. Same on inwards-verify, on transfer creation, and as a 404 on /stock/by-location.
 *
 * So it IS invalidated now: every route that creates, edits or deactivates a warehouse calls
 * `clearWarehouseCache()`. That is correct on a single process. On several instances the other
 * instances stay stale until they recycle — the honest fix for that is request-scoped
 * `cache()` from React, which four sibling modules already use (`rbac.ts`, `auth-helpers.ts`,
 * `integrations/index.ts`). Worth doing; not done here, because it changes every call site.
 */
let cache: WarehouseRef[] | null = null;

/** All active warehouses, ordered as the pickers show them. */
export async function listWarehouses(): Promise<WarehouseRef[]> {
  if (cache) return cache;
  cache = await prisma.warehouse.findMany({
    where: { isActive: true },
    // The store's GSTIN and state code ride along so P14's document derivation — TAX INVOICE
    // between two GSTINs, DELIVERY CHALLAN within one — does not need a second query per lane.
    select: {
      id: true,
      code: true,
      name: true,
      kind: true,
      storeId: true,
      // `code` ("BCH_STORE") rides along so /api/stock/by-bin can say which SITE a warehouse
      // belongs to without a second query. Its prefix is the site key the by-location screen
      // groups on.
      store: { select: { code: true, gstin: true, stateCode: true } },
    },
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

/**
 * Drop the cached set.
 *
 * Called by every route that changes the warehouse list — create, edit, deactivate. The old
 * comment claimed the seed used it too; nothing did, which is exactly why the cache was stale.
 */
export function clearWarehouseCache() {
  cache = null;
}
