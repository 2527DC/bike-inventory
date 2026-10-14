/**
 * The screens that run the shared Zoho pull — `zoho/trigger-pull` → `zoho/pull-review` →
 * `zoho/pull-review/approve` — each named by its RBAC module key.
 *
 * Plan 1410-per-module-fetch-permissions, D1: the SCREEN's module decides who may pull and who
 * may import. Every call to the three routes carries one of these keys and the route checks
 * `<module>.fetch` — the same tick the screen's button checks — so a role can never hold the
 * button and not the route (the defect the 0409 plan's P4 was written to close).
 *
 * Client-safe on purpose (no Prisma import): the screens send these keys, the routes validate
 * them, and both read the one list.
 */
export const ZOHO_PULL_MODULES = ["inbound", "bills", "customers", "deliveries"] as const;
export type ZohoPullModule = (typeof ZOHO_PULL_MODULES)[number];

/**
 * What each screen pulls and imports. Inbound and Bills pull bills; Receivables (`customers`)
 * and Deliveries pull invoices. The routes use it to refuse a step that is not the screen's
 * (`bills` sent with `customers`), and the approve route always filters previews by it — so a
 * Deliveries-only role cannot import bill previews by sending their ids.
 */
export const ZOHO_PULL_ENTITY: Record<ZohoPullModule, "bill" | "invoice"> = {
  inbound: "bill",
  bills: "bill",
  customers: "invoice",
  deliveries: "invoice",
};

/**
 * The screens that may use the one-invoice lookup (`deliveries/search-zoho`): Deliveries and
 * Pre-bookings (both the `deliveries` module) and New second-hand cycle.
 */
export const ZOHO_INVOICE_LOOKUP_MODULES = ["deliveries", "second_hand"] as const;
export type ZohoInvoiceLookupModule = (typeof ZOHO_INVOICE_LOOKUP_MODULES)[number];
