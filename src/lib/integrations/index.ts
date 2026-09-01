// The only entry point callers should import.
import { cache } from "react";
import { BooksClient } from "./books";
import { ZakyaClient } from "./zakya";
import { InventoryClient } from "./inventory";
import { IntegrationClient, type ProviderKey } from "./base";

export * from "./base";
export { BooksClient } from "./books";
export { ZakyaClient } from "./zakya";
export { InventoryClient } from "./inventory";

/** A client for `provider`. Not yet initialised — call `init()` and check the result. */
export function getClient(provider: ProviderKey): IntegrationClient {
  switch (provider) {
    case "ZOHO_BOOKS":
      return new BooksClient();
    case "ZAKYA_POS":
      return new ZakyaClient();
    case "ZOHO_INVENTORY":
      return new InventoryClient();
  }
}

// ─── ONE ready client per request ────────────────────────────────────────────
//
// All four helpers below are wrapped in React cache(), which dedupes by argument within a
// SINGLE server request. Ask for the same provider twice in one request and you get the
// same initialised client, not a second one.
//
// This is not a micro-optimisation. `init()` is a database read of IntegrationConfig AND,
// whenever the stored access token is within five minutes of expiry, an HTTP round trip to
// accounts.zoho.in plus a write back. api/zoho/pull-review/approve constructed a client
// INSIDE its per-record loop, so a 50-bill approve paid that toll 50+ times on a route
// whose entire budget is maxDuration = 60. Caching here fixes the whole class, not just the
// two sites that happened to be noticed.
//
// A `null` result is cached too, and deliberately: an unconnected integration must not be
// re-probed once per record just to be told "still not connected".
//
// Request-scoped, never longer. A cross-request cache would keep a revoked token or a
// disconnected integration alive after an admin changed it — the same reasoning that keeps
// getAccess() request-scoped in src/lib/rbac.ts.

/**
 * A client that is ready to use, or null when the integration is not connected.
 *
 * Prefer this over `getClient` + `init()`: an unconnected integration is a normal state,
 * not an error, and every caller was already writing the same two-line dance.
 */
export const getReadyClient = cache(
  async (provider: ProviderKey): Promise<IntegrationClient | null> => {
    const client = getClient(provider);
    return (await client.init()) ? client : null;
  }
);

/** Books, ready to use, or null. The most common case by far. */
export const getBooks = cache(async (): Promise<BooksClient | null> => {
  const client = new BooksClient();
  return (await client.init()) ? client : null;
});

/** Zoho Inventory, ready to use, or null. */
export const getInventory = cache(async (): Promise<InventoryClient | null> => {
  const client = new InventoryClient();
  return (await client.init()) ? client : null;
});

/** Zakya POS, ready to use, or null. */
export const getZakya = cache(async (): Promise<ZakyaClient | null> => {
  const client = new ZakyaClient();
  return (await client.init()) ? client : null;
});
