import { prisma } from "@/lib/db";
import { createLogger } from "@/lib/logger";

const log = createLogger("stores-lib");

export interface StoreRef {
  id: string;
  code: string;
  name: string;
}

/**
 * Store lookups, request-scoped cached. The Store half of what the StockLocation enum used
 * to answer for free; src/lib/warehouses.ts is the other half.
 *
 * Stores matter to ANALYTICS, not to stock: footfall is counted at the shop door, so
 * CountEvent, AgentHeartbeat and AnalyticsDevice point here while StockLevel points at a
 * warehouse. Getting that backwards is the single easiest mistake to make in this area.
 */
let cache: StoreRef[] | null = null;

export async function listStores(): Promise<StoreRef[]> {
  if (cache) return cache;
  cache = await prisma.store.findMany({
    where: { isActive: true },
    select: { id: true, code: true, name: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  log.debug("store set loaded", { count: cache.length });
  return cache;
}

export async function storeByCode(code: string): Promise<StoreRef | null> {
  const all = await listStores();
  return all.find((s) => s.code === code) ?? null;
}

export async function storeById(id: string): Promise<StoreRef | null> {
  const all = await listStores();
  return all.find((s) => s.id === id) ?? null;
}

/**
 * Resolve a `?store=` query parameter to a store.
 *
 * Accepts a code OR an id. Codes are what the old enum values were, so a bookmarked
 * `?store=BCH_STORE` keeps working — and a code is what the dashboard payload emits, so
 * round-tripping its own output must resolve.
 */
export async function resolveStoreParam(value: string): Promise<StoreRef | null> {
  const raw = value.trim();
  if (!raw) return null;
  const all = await listStores();
  return all.find((s) => s.id === raw) ?? all.find((s) => s.code === raw.toUpperCase()) ?? null;
}

export function clearStoreCache() {
  cache = null;
}
