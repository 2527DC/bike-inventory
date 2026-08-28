// The only entry point callers should import.
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

/**
 * A client that is ready to use, or null when the integration is not connected.
 *
 * Prefer this over `getClient` + `init()`: an unconnected integration is a normal state,
 * not an error, and every caller was already writing the same two-line dance.
 */
export async function getReadyClient(provider: ProviderKey): Promise<IntegrationClient | null> {
  const client = getClient(provider);
  return (await client.init()) ? client : null;
}

/** Books, ready to use, or null. The most common case by far. */
export async function getBooks(): Promise<BooksClient | null> {
  const client = new BooksClient();
  return (await client.init()) ? client : null;
}

/** Zoho Inventory, ready to use, or null. */
export async function getInventory(): Promise<InventoryClient | null> {
  const client = new InventoryClient();
  return (await client.init()) ? client : null;
}

/** Zakya POS, ready to use, or null. */
export async function getZakya(): Promise<ZakyaClient | null> {
  const client = new ZakyaClient();
  return (await client.init()) ? client : null;
}
