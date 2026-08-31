// Shared OAuth + API client for every Zoho-family integration.
//
// Zoho Books, Zakya POS and Zoho Inventory used to be three separate files — zoho.ts (510
// lines), zakya.ts (369) and zoho-inventory.ts (331). All three declared the SAME
// `ZOHO_ACCOUNTS_URL` constant and carried verbatim copies of init(), refreshAccessToken(),
// delay(), apiCall() and exchangeGrantToken(). Roughly 465 of those 1,210 lines were
// duplicated three ways.
//
// The only genuine difference between the three is one line: the API base URL.
import { prisma } from "@/lib/db";
import { readJson } from "@/lib/http-json";
import { createLogger } from "@/lib/logger";
// Type-only: the registry describes the endpoints, it does not dispatch them. Importing the
// key type keeps a typo in a log label a compile error rather than a mystery in a log file.
import type { EndpointKey } from "./endpoints";

const log = createLogger("integrations");

/** All three use the same Zoho India accounts endpoint. */
const ACCOUNTS_URL = "https://accounts.zoho.in/oauth/v2/token";

export const PROVIDERS = ["ZOHO_BOOKS", "ZAKYA_POS", "ZOHO_INVENTORY"] as const;
export type ProviderKey = (typeof PROVIDERS)[number];

export function isProviderKey(v: unknown): v is ProviderKey {
  return typeof v === "string" && (PROVIDERS as readonly string[]).includes(v);
}

/** Human labels, for messages a person will read. */
export const PROVIDER_LABELS: Record<ProviderKey, string> = {
  ZOHO_BOOKS: "Zoho Books",
  ZAKYA_POS: "Zakya POS",
  ZOHO_INVENTORY: "Zoho Inventory",
};

// ─── Shared response shapes ──────────────────────────────────────────────────
// These were declared inline and identically in more than one client. `IntegrationItem` in
// particular was `ZohoInventoryItem` in one file and an anonymous inline type with exactly
// the same 16 fields in another.

export type IntegrationItem = {
  item_id: string;
  sku: string;
  name: string;
  status?: string;
  brand?: string;
  manufacturer?: string;
  purchase_rate?: number;
  rate?: number;
  tax_percentage?: number;
  hsn_or_sac?: string;
  stock_on_hand?: number;
  product_type?: string;
  item_type?: string;
  category_name?: string;
  category_id?: string;
  group_name?: string;
};

export interface IntegrationBill {
  bill_id: string;
  bill_number: string;
  vendor_name: string;
  vendor_id: string;
  date: string;
  due_date: string;
  total: number;
  balance: number;
  status: string;
}

export interface IntegrationInvoice {
  invoice_id: string;
  invoice_number: string;
  customer_name: string;
  customer_id?: string;
  phone?: string;
  date: string;
  due_date?: string;
  total: number;
  balance: number;
  status: string;
}

export interface IntegrationCustomerPayment {
  payment_id: string;
  date: string;
  amount: number;
  payment_mode: string;
  customer_name: string;
  reference_number: string;
  account_name: string;
}

/**
 * One invoice as `GET /invoices/{id}` returns it — richer than the list shape, which is why
 * this is separate from IntegrationInvoice.
 *
 * The index signature keeps every field Zoho sends reachable, but the named fields are the
 * ones this application actually reads, and naming them is the point: callers used to take
 * this through a variable typed `any`, and `any` hid a real defect — `inv.invoice_number`
 * was `unknown` and `.startsWith()` on it only failed once the `any` was removed.
 */
export interface IntegrationInvoiceDetail {
  invoice_id?: string;
  invoice_number?: string;
  customer_name?: string;
  date?: string;
  total?: number;
  balance?: number;
  status?: string;
  salesperson_name?: string;
  line_items?: LineItem[];
  contact_persons?: Array<{ phone?: string; mobile?: string }>;
  billing_address?: ZohoAddress;
  shipping_address?: ZohoAddress;
  [field: string]: unknown;
}

export interface ZohoAddress {
  address?: string;
  street2?: string;
  city?: string;
  state?: string;
  zip?: string;
  phone?: string;
}

export interface LineItem {
  name: string;
  sku?: string;
  item_id?: string;
  quantity: number;
  rate: number;
  item_total: number;
}

interface PageContext {
  page_context?: { has_more_page: boolean };
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  error?: string;
}

// ─── The client ──────────────────────────────────────────────────────────────

export abstract class IntegrationClient {
  /** Row key in IntegrationConfig. */
  protected abstract readonly provider: ProviderKey;
  /** The one thing that genuinely differs between these integrations. */
  protected abstract readonly apiBase: string;

  protected accessToken: string | null = null;
  protected organizationId: string | null = null;

  protected get label(): string {
    return PROVIDER_LABELS[this.provider];
  }

  /**
   * Load credentials and make sure the access token is usable.
   * Returns false when the integration is not connected — callers treat that as "skip",
   * not as an error, because an unconfigured integration is a normal state.
   */
  async init(): Promise<boolean> {
    const config = await prisma.integrationConfig.findUnique({
      where: { provider: this.provider },
    });
    if (!config || !config.isConnected || !config.refreshToken) return false;

    this.organizationId = config.organizationId;

    // Reuse the stored access token while it has more than five minutes left. The buffer
    // stops a token expiring mid-request on a slow call.
    if (config.accessToken && config.accessTokenExpiresAt) {
      const buffer = 5 * 60 * 1000;
      if (new Date(config.accessTokenExpiresAt).getTime() - buffer > Date.now()) {
        this.accessToken = config.accessToken;
        return true;
      }
    }

    return this.refreshAccessToken(config.clientId!, config.clientSecret!, config.refreshToken);
  }

  protected async refreshAccessToken(
    clientId: string,
    clientSecret: string,
    refreshToken: string
  ): Promise<boolean> {
    const params = new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
    });

    const res = await fetch(ACCOUNTS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });

    const data = await readJson<TokenResponse>(res, {
      service: `${this.label} (token refresh)`,
      endpoint: "/oauth/v2/token",
    });
    if (data.error || !data.access_token) {
      log.error("token refresh rejected", { provider: this.provider, error: data.error });
      return false;
    }
    log.info("access token refreshed", { provider: this.provider });

    const expiresAt = new Date(Date.now() + data.expires_in * 1000);
    this.accessToken = data.access_token;

    await prisma.integrationConfig.update({
      where: { provider: this.provider },
      data: { accessToken: data.access_token, accessTokenExpiresAt: expiresAt },
    });

    return true;
  }

  async delay(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
  }

  /**
   * One HTTP call to the provider, with auth, a single 401 retry and 429 backoff.
   *
   * **`protected` on purpose — this is the boundary, enforced by the compiler.**
   *
   * Four call sites used to reach it from outside `src/lib/integrations/`: a `PUT /items/{id}`
   * in a route handler and three invoice searches in the workshop layer. Each was a Zoho
   * endpoint that existed in no client and appeared in no listing, which is precisely the
   * problem the registry was written to solve — a registry anyone can bypass documents
   * nothing. Every one of them now has a client method (`updateItem`, `searchInvoices`), so
   * the door can be shut behind them.
   *
   * Adding a Zoho call therefore means adding a method here plus an entry in endpoints.ts.
   * That is a rule a review can forget; `protected` cannot.
   *
   * `key` names the call from endpoints.ts. It is a LOG LABEL and nothing else — no dispatch
   * reads it, and the URL is still built by the caller. It exists so a debug line says
   * `bills.list` instead of an interpolated path carrying a date range and a search term,
   * which makes one request impossible to correlate with the next.
   */
  protected async apiCall<T>(
    method: string,
    endpoint: string,
    body?: Record<string, unknown>,
    key?: EndpointKey,
    _attempt = 0
  ): Promise<T> {
    if (!this.accessToken || !this.organizationId) {
      throw new Error(`${this.label} client not initialized`);
    }

    const separator = endpoint.includes("?") ? "&" : "?";
    const url = `${this.apiBase}${endpoint}${separator}organization_id=${this.organizationId}`;
    const options: RequestInit = {
      method,
      headers: {
        Authorization: `Zoho-oauthtoken ${this.accessToken}`,
        "Content-Type": "application/json",
      },
    };
    if (body && (method === "POST" || method === "PUT")) {
      options.body = JSON.stringify(body);
    }

    const started = Date.now();
    // The endpoint KEY and the payload SIZE, never the payload. A body here can carry a
    // customer's name, phone and address; CLAUDE.md's rule is to log the identifiers needed
    // to find the record again, not the record.
    log.debug(`-> ${this.label} ${method} ${key ?? endpoint}`, {
      ...(key ? { endpoint } : {}),
      ...(options.body ? { bytes: (options.body as string).length } : {}),
    });
    const res = await fetch(url, options);

    // Token expired mid-request — refresh once and retry.
    if (res.status === 401 && _attempt === 0) {
      log.warn(`<- ${this.label} ${endpoint} 401 — access token expired, refreshing`, {
        ms: Date.now() - started,
      });
      const config = await prisma.integrationConfig.findUnique({
        where: { provider: this.provider },
      });
      if (config?.clientId && config?.clientSecret && config?.refreshToken) {
        const refreshed = await this.refreshAccessToken(
          config.clientId,
          config.clientSecret,
          config.refreshToken
        );
        if (refreshed) return this.apiCall<T>(method, endpoint, body, key, _attempt + 1);
      }
      log.error(`<- ${this.label} ${endpoint} — token refresh failed, reconnect required`);
      throw new Error(`${this.label} authentication failed. Please reconnect.`);
    }

    if (res.status === 429) {
      if (_attempt < 3) {
        const retryAfter = parseInt(res.headers.get("Retry-After") || "0", 10);
        const wait =
          retryAfter > 0 ? retryAfter * 1000 : Math.min(5000 * Math.pow(2, _attempt), 60000);
        log.warn(`<- ${this.label} ${endpoint} 429 rate limited — retry ${_attempt + 1}/3 in ${wait}ms`);
        await this.delay(wait);
        return this.apiCall<T>(method, endpoint, body, key, _attempt + 1);
      }
      log.error(`<- ${this.label} ${endpoint} — rate limit not cleared after 3 retries`);
      throw new Error(
        `${this.label} API rate limit exceeded after 3 retries. Wait 2 minutes and try again.`
      );
    }

    const ms = Date.now() - started;
    // readJson checks content-type first: an HTML gateway/timeout page used to surface as
    // `Unexpected token '<'` with no clue which call or status produced it.
    const data = await readJson<{ code?: number; message?: string }>(res, {
      service: this.label,
      endpoint,
      ms,
    });
    if (data.code !== 0 && data.code !== undefined) {
      log.warn(`${method} ${endpoint} -> code ${data.code}`, { message: data.message, ms });
      throw new Error(data.message || `${this.label} API error: ${data.code}`);
    }

    return data as T;
  }

  // ─── Shared reads ──────────────────────────────────────────────────────────
  // Present in more than one of the three original clients with identical bodies. Where a
  // signature differed it was only by an extra optional argument (Zakya's listBills had no
  // searchText), so the superset is used and the narrower callers simply omit it — the URL
  // they produce is byte-identical to before.

  async listBills(page = 1, dateFrom?: string, dateTo?: string, searchText?: string) {
    const from = dateFrom ? `&date_start=${dateFrom}` : "";
    const to = dateTo ? `&date_end=${dateTo}` : "";
    const search = searchText ? `&search_text=${encodeURIComponent(searchText)}` : "";
    return this.apiCall<{ bills: IntegrationBill[] } & PageContext>(
      "GET",
      `/bills?page=${page}&per_page=200${from}${to}${search}`,
      undefined,
      "bills.list"
    );
  }

  async listAllBills(dateFrom?: string, dateTo?: string, searchText?: string) {
    const all: IntegrationBill[] = [];
    let page = 1;
    for (;;) {
      const data = await this.listBills(page, dateFrom, dateTo, searchText);
      all.push(...(data.bills || []));
      if (!data.page_context?.has_more_page) break;
      page++;
    }
    return all;
  }

  async getBill(billId: string) {
    return this.apiCall<{ bill?: { line_items?: LineItem[] } & Record<string, unknown> }>(
      "GET",
      `/bills/${billId}`,
      undefined,
      "bills.get"
    );
  }

  async listInvoices(page = 1, dateFrom?: string, dateTo?: string, searchText?: string) {
    const from = dateFrom ? `&date_start=${dateFrom}` : "";
    const to = dateTo ? `&date_end=${dateTo}` : "";
    const search = searchText ? `&search_text=${encodeURIComponent(searchText)}` : "";
    return this.apiCall<{ invoices: IntegrationInvoice[] } & PageContext>(
      "GET",
      `/invoices?page=${page}&per_page=200${from}${to}${search}`,
      undefined,
      "invoices.list"
    );
  }

  async listAllInvoices(dateFrom?: string, dateTo?: string, searchText?: string) {
    const all: IntegrationInvoice[] = [];
    let page = 1;
    for (;;) {
      const data = await this.listInvoices(page, dateFrom, dateTo, searchText);
      all.push(...(data.invoices || []));
      if (!data.page_context?.has_more_page) break;
      page++;
    }
    return all;
  }

  async getInvoice(invoiceId: string) {
    return this.apiCall<{ invoice?: IntegrationInvoiceDetail }>(
      "GET",
      `/invoices/${invoiceId}`,
      undefined,
      "invoices.get"
    );
  }

  async listCustomerPayments(page = 1, dateFrom?: string, dateTo?: string) {
    const from = dateFrom ? `&date_start=${dateFrom}` : "";
    const to = dateTo ? `&date_end=${dateTo}` : "";
    return this.apiCall<{ customerpayments: IntegrationCustomerPayment[] } & PageContext>(
      "GET",
      `/customerpayments?page=${page}&per_page=200${from}${to}`,
      undefined,
      "customerpayments.list"
    );
  }

  async listAllCustomerPayments(dateFrom?: string, dateTo?: string) {
    const all: IntegrationCustomerPayment[] = [];
    let page = 1;
    for (;;) {
      const data = await this.listCustomerPayments(page, dateFrom, dateTo);
      all.push(...(data.customerpayments || []));
      if (!data.page_context?.has_more_page) break;
      page++;
    }
    return all;
  }

  async listItems(page = 1, statusFilter?: string, lastModifiedTime?: string) {
    const status = statusFilter ? `&status=${statusFilter}` : "";
    // Zoho expects ISO 8601 with timezone, and + must be URL-encoded as %2B.
    const modified = lastModifiedTime
      ? `&last_modified_time=${encodeURIComponent(lastModifiedTime + "T00:00:00+0530")}`
      : "";
    return this.apiCall<{ items: IntegrationItem[] } & PageContext>(
      "GET",
      `/items?page=${page}&per_page=200${status}${modified}`,
      undefined,
      "items.list"
    );
  }

  async listAllItems(statusFilter?: string, lastModifiedTime?: string) {
    const all: IntegrationItem[] = [];
    let page = 1;
    for (;;) {
      const data = await this.listItems(page, statusFilter, lastModifiedTime);
      all.push(...(data.items || []));
      if (!data.page_context?.has_more_page) break;
      page++;
    }
    return all;
  }
}

/**
 * Exchange a self-client grant token for access + refresh tokens.
 *
 * Was declared three times as exchangeGrantToken / exchangeGrantTokenZakya /
 * exchangeGrantTokenInventory, identically apart from the log label.
 */
export async function exchangeGrantToken(
  provider: ProviderKey,
  clientId: string,
  clientSecret: string,
  grantToken: string
): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
  const label = PROVIDER_LABELS[provider];
  const params = new URLSearchParams({
    code: grantToken,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "authorization_code",
  });

  const res = await fetch(ACCOUNTS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  const data = await readJson<TokenResponse>(res, {
    service: `${label} (grant exchange)`,
    endpoint: "/oauth/v2/token",
  });

  if (data.error || !data.access_token || !data.refresh_token) {
    log.error("grant token exchange rejected", { provider, error: data.error });
    // A grant token is single-use and expires in minutes, so this is nearly always
    // "you took too long" or "you pasted it twice" rather than a wrong client id.
    throw new Error(
      data.error === "invalid_code"
        ? "That grant token is invalid or already used. Generate a fresh one and paste it within a minute."
        : data.error || `${label} did not return a refresh token.`
    );
  }

  log.info("grant token exchanged", { provider });
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
  };
}
