// ─── The endpoint registry ───────────────────────────────────────────────────
//
// Every Zoho endpoint this application touches, in one place, with the client method that
// owns it.
//
// It exists because that list was previously unanswerable. `src/lib/integrations/` was
// already a real client layer — OAuth, refresh, 401-retry-once, 429 backoff, pagination —
// but nothing anywhere said WHICH endpoints the app depends on, so "what breaks if Zoho
// changes X" could only be answered by grepping for backtick-quoted paths across four files.
//
// This is a DESCRIPTION, not a router. Nothing dispatches through it: the client methods
// still build their own URLs, because a query string assembled from optional arguments is
// clearer written out than expressed as a template. The registry's jobs are narrower:
//
//   1. `apiCall` takes an optional endpoint key and logs it, so a debug line reads
//      `endpoint: "bills.list"` instead of an interpolated URL with a date range in it.
//   2. `docs/integrations-endpoints.md` is generated from it, so the documentation cannot
//      drift from the code the way prose would.
//
// Adding a Zoho call means adding a client method AND an entry here. A call made from
// outside `src/lib/integrations/` is a bug — after the escape hatches were closed, `apiCall`
// is `protected`, so the compiler enforces that rather than a review convention.

import type { ProviderKey } from "./base";

/** Which providers expose an endpoint. All three are Zoho-family and share `base.ts`. */
export type EndpointProviders = readonly ProviderKey[];

const ALL: EndpointProviders = ["ZOHO_BOOKS", "ZOHO_INVENTORY", "ZAKYA_POS"];
const BOOKS_ONLY: EndpointProviders = ["ZOHO_BOOKS"];
const INVENTORY_ONLY: EndpointProviders = ["ZOHO_INVENTORY"];

export interface EndpointSpec {
  /** Stable name used in logs. Never interpolated into a URL. */
  key: string;
  method: "GET" | "POST" | "PUT";
  /** The path as the client builds it, with `{id}` where an id is substituted. */
  path: string;
  /** Which providers answer it. */
  providers: EndpointProviders;
  /** The method on the client that owns this call. */
  owner: string;
  /** Why the application calls it. */
  purpose: string;
}

export const ENDPOINTS = {
  // ── Shared (base.ts) — every provider inherits these ──────────────────────
  "bills.list": {
    key: "bills.list",
    method: "GET",
    path: "/bills?page&per_page&date_start&date_end&search_text",
    providers: ALL,
    owner: "listBills / listAllBills",
    purpose: "Pull vendor bills for the inbound and accounting imports",
  },
  "bills.get": {
    key: "bills.get",
    method: "GET",
    path: "/bills/{bill_id}",
    providers: ALL,
    owner: "getBill",
    purpose: "Line items for one bill — the list response does not carry them",
  },
  "invoices.list": {
    key: "invoices.list",
    method: "GET",
    path: "/invoices?page&per_page&date_start&date_end&search_text",
    providers: ALL,
    owner: "listInvoices / listAllInvoices",
    purpose: "Pull sales invoices for delivery matching and receivables",
  },
  "invoices.search": {
    key: "invoices.search",
    method: "GET",
    path: "/invoices?phone|invoice_number|search_text&per_page&sort_column&sort_order",
    providers: BOOKS_ONLY,
    owner: "BooksClient.searchInvoices",
    purpose:
      "Find a customer's invoice at the workshop counter — by phone, by invoice number, or by free text",
  },
  "invoices.get": {
    key: "invoices.get",
    method: "GET",
    path: "/invoices/{invoice_id}",
    providers: ALL,
    owner: "getInvoice",
    purpose: "One invoice in full, including line items",
  },
  "customerpayments.list": {
    key: "customerpayments.list",
    method: "GET",
    path: "/customerpayments?page&per_page&date_start&date_end",
    providers: ALL,
    owner: "listCustomerPayments / listAllCustomerPayments",
    purpose: "Payments received, for receivables reconciliation",
  },

  // ── Zoho Books only (books.ts) ────────────────────────────────────────────
  "items.create": {
    key: "items.create",
    method: "POST",
    path: "/items",
    providers: BOOKS_ONLY,
    owner: "BooksClient.createItem",
    purpose: "Push a product created here into Zoho",
  },
  "items.get": {
    key: "items.get",
    method: "GET",
    path: "/items/{item_id}",
    providers: BOOKS_ONLY,
    owner: "BooksClient.getItem",
    purpose: "Category, HSN and tax for one item — absent from the list response",
  },
  "items.update": {
    key: "items.update",
    method: "PUT",
    path: "/items/{item_id}",
    providers: BOOKS_ONLY,
    owner: "BooksClient.updateItem",
    purpose: "Push a corrected price back to Zoho (the price-check screen)",
  },
  "contacts.create": {
    key: "contacts.create",
    method: "POST",
    path: "/contacts",
    providers: BOOKS_ONLY,
    owner: "BooksClient.createContact",
    purpose: "Create a vendor or customer in Zoho",
  },
  "contacts.search": {
    key: "contacts.search",
    method: "GET",
    path: "/contacts?search_text&contact_type&per_page",
    providers: BOOKS_ONLY,
    owner: "BooksClient.searchContacts",
    purpose: "Find an existing contact before creating a duplicate",
  },
  "contacts.list": {
    key: "contacts.list",
    method: "GET",
    path: "/contacts?contact_type=vendor&page&per_page&last_modified_time",
    providers: BOOKS_ONLY,
    owner: "BooksClient.listContacts / listAllContacts",
    purpose: "The vendor pull",
  },
  "invoices.create": {
    key: "invoices.create",
    method: "POST",
    path: "/invoices",
    providers: BOOKS_ONLY,
    owner: "BooksClient.createInvoice",
    purpose: "Raise an invoice in Zoho from a sale recorded here",
  },
  "bills.create": {
    key: "bills.create",
    method: "POST",
    path: "/bills",
    providers: BOOKS_ONLY,
    owner: "BooksClient.createBill",
    purpose: "Raise a vendor bill in Zoho",
  },
  "organizations.list": {
    key: "organizations.list",
    method: "GET",
    path: "/../organizations",
    providers: BOOKS_ONLY,
    owner: "BooksClient.getOrganizations",
    purpose:
      "Find the organization id during setup. The `..` is deliberate — organizations sits above the books/v3 segment",
  },

  // ── Zoho Inventory only (inventory.ts) ────────────────────────────────────
  "items.create.inventory": {
    key: "items.create.inventory",
    method: "POST",
    path: "/items",
    providers: INVENTORY_ONLY,
    owner: "InventoryClient.createItem",
    purpose:
      "Same path as Books, DIFFERENT payload — Inventory posts the object directly where Books wraps it in JSONString. A real difference between the two Zoho products, not an inconsistency to fix",
  },
} as const satisfies Record<string, EndpointSpec>;

export type EndpointKey = keyof typeof ENDPOINTS;

/**
 * The two OAuth grants, on `accounts.zoho.in` rather than an API host.
 *
 * Kept separate from ENDPOINTS because they are not provider-scoped: all three integrations
 * authenticate against the same accounts host with the same two grant types.
 */
export const OAUTH_ENDPOINTS = {
  "oauth.refresh": {
    key: "oauth.refresh",
    method: "POST",
    path: "https://accounts.zoho.in/oauth/v2/token?grant_type=refresh_token",
    owner: "IntegrationClient.refreshAccessToken",
    purpose: "Exchange the stored refresh token for a new access token",
  },
  "oauth.exchange": {
    key: "oauth.exchange",
    method: "POST",
    path: "https://accounts.zoho.in/oauth/v2/token?grant_type=authorization_code",
    owner: "exchangeGrantToken",
    purpose: "First-time connect — turn the grant code into a refresh token",
  },
} as const;

/** Every endpoint a given provider can answer. Used to generate the documentation table. */
export function endpointsFor(provider: ProviderKey): EndpointSpec[] {
  return Object.values(ENDPOINTS).filter((e) =>
    (e.providers as readonly string[]).includes(provider)
  );
}
