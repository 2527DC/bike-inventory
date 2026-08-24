import { prisma } from "@/lib/db";
import { readJson } from "@/lib/http-json";
import { createLogger } from "@/lib/logger";

const log = createLogger("zoho-inv");

const ZOHO_ACCOUNTS_URL = "https://accounts.zoho.in/oauth/v2/token";
const ZOHO_INVENTORY_API_BASE = "https://www.zohoapis.in/inventory/v1";

interface ZohoTokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
  error?: string;
}

export interface ZohoInventoryItem {
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
}

export class ZohoInventoryClient {
  private accessToken: string | null = null;
  private organizationId: string | null = null;

  async init(): Promise<boolean> {
    const config = await prisma.zohoInventoryConfig.findUnique({ where: { id: "singleton" } });
    if (!config || !config.isConnected || !config.refreshToken) return false;

    this.organizationId = config.organizationId;

    // Check if access token is still valid (with 5 min buffer)
    if (config.accessToken && config.accessTokenExpiresAt) {
      const buffer = 5 * 60 * 1000;
      if (new Date(config.accessTokenExpiresAt).getTime() - buffer > Date.now()) {
        this.accessToken = config.accessToken;
        return true;
      }
    }

    // Refresh the token
    return this.refreshAccessToken(config.clientId!, config.clientSecret!, config.refreshToken);
  }

  private async refreshAccessToken(clientId: string, clientSecret: string, refreshToken: string): Promise<boolean> {
    const params = new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
    });

    const res = await fetch(ZOHO_ACCOUNTS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });

    const data = await readJson<ZohoTokenResponse>(res, {
      service: "Zoho Inventory (token refresh)",
      endpoint: "/oauth/v2/token",
    });
    if (data.error || !data.access_token) {
      log.error(`token refresh rejected by Zoho Inventory`, { error: data.error });
      return false;
    }
    log.info(`Zoho Inventory access token refreshed`);

    const expiresAt = new Date(Date.now() + data.expires_in * 1000);
    this.accessToken = data.access_token;

    await prisma.zohoInventoryConfig.update({
      where: { id: "singleton" },
      data: { accessToken: data.access_token, accessTokenExpiresAt: expiresAt },
    });

    return true;
  }

  /** Delay helper for rate limiting */
  async delay(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
  }

  async apiCall<T>(method: string, endpoint: string, body?: Record<string, unknown>, _attempt = 0): Promise<T> {
    if (!this.accessToken || !this.organizationId) {
      throw new Error("Zoho Inventory client not initialized");
    }

    const separator = endpoint.includes("?") ? "&" : "?";
    const url = `${ZOHO_INVENTORY_API_BASE}${endpoint}${separator}organization_id=${this.organizationId}`;
    const buildOptions = (): RequestInit => {
      const opts: RequestInit = {
        method,
        headers: {
          Authorization: `Zoho-oauthtoken ${this.accessToken}`,
          "Content-Type": "application/json",
        },
      };
      if (body && (method === "POST" || method === "PUT")) {
        opts.body = JSON.stringify(body);
      }
      return opts;
    };

    const started = Date.now();
    log.debug(`-> Zoho Inventory ${method} ${endpoint}`, body ? { body } : undefined);
    const res = await fetch(url, buildOptions());

    // Token expired mid-request — refresh and retry once
    if (res.status === 401 && _attempt === 0) {
      log.warn(`<- Zoho Inventory ${endpoint} 401 — access token expired, refreshing`, {
        ms: Date.now() - started,
      });
      const config = await prisma.zohoInventoryConfig.findUnique({ where: { id: "singleton" } });
      if (config?.clientId && config?.clientSecret && config?.refreshToken) {
        const refreshed = await this.refreshAccessToken(config.clientId, config.clientSecret, config.refreshToken);
        if (refreshed) {
          return this.apiCall<T>(method, endpoint, body, _attempt + 1);
        }
      }
      log.error(`<- Zoho Inventory ${endpoint} — token refresh failed, reconnect required`);
      throw new Error("Zoho Inventory authentication failed. Please reconnect.");
    }

    if (res.status === 429) {
      // Retry with exponential backoff (up to 3 attempts)
      if (_attempt < 3) {
        const retryAfter = parseInt(res.headers.get("Retry-After") || "0", 10);
        const delay = retryAfter > 0 ? retryAfter * 1000 : Math.min(5000 * Math.pow(2, _attempt), 60000);
        log.warn(
          `<- Zoho Inventory ${endpoint} 429 rate limited — retry ${_attempt + 1}/3 in ${delay}ms`
        );
        await new Promise((r) => setTimeout(r, delay));
        return this.apiCall<T>(method, endpoint, body, _attempt + 1);
      }
      log.error(`<- Zoho Inventory ${endpoint} — rate limit not cleared after 3 retries`);
      throw new Error("Zoho Inventory API rate limit exceeded after 3 retries. Wait 2 minutes and try again.");
    }

    const ms = Date.now() - started;
    // readJson checks content-type first: an HTML gateway/timeout page from Zoho used to
    // surface as `Unexpected token '<'` with no clue which call or status produced it.
    const data = await readJson<{ code?: number; message?: string }>(res, {
      service: "Zoho Inventory",
      endpoint,
      ms,
    });
    if (data.code !== 0 && data.code !== undefined) {
      log.warn(`${method} ${endpoint} -> code ${data.code}`, { message: data.message, ms });
      throw new Error(data.message || `Zoho Inventory API error: ${data.code}`);
    }

    return data as T;
  }

  // ---- Bills (Purchases) ----

  async listBills(page = 1, dateFrom?: string, dateTo?: string) {
    const dateParam = dateFrom ? `&date_start=${dateFrom}` : "";
    const dateEndParam = dateTo ? `&date_end=${dateTo}` : "";
    return this.apiCall<{
      bills: Array<{
        bill_id: string;
        bill_number: string;
        vendor_name: string;
        vendor_id: string;
        date: string;
        due_date: string;
        total: number;
        balance: number;
        status: string;
      }>;
      page_context?: { has_more_page: boolean };
    }>("GET", `/bills?page=${page}&per_page=200${dateParam}${dateEndParam}`);
  }

  async listAllBills(dateFrom?: string, dateTo?: string) {
    const all: Array<{
      bill_id: string;
      bill_number: string;
      vendor_name: string;
      vendor_id: string;
      date: string;
      due_date: string;
      total: number;
      balance: number;
      status: string;
    }> = [];
    let page = 1;
    while (true) {
      const data = await this.listBills(page, dateFrom, dateTo);
      all.push(...(data.bills || []));
      if (!data.page_context?.has_more_page) break;
      page++;
    }
    return all;
  }

  async getBill(billId: string) {
    return this.apiCall<{
      bill: {
        bill_id: string;
        bill_number: string;
        vendor_name: string;
        date: string;
        due_date: string;
        total: number;
        balance: number;
        status: string;
        line_items: Array<{
          line_item_id: string;
          item_id: string;
          name: string;
          sku: string;
          quantity: number;
          rate: number;
          item_total: number;
        }>;
      };
    }>("GET", `/bills/${billId}`);
  }

  /** Fetch detail for multiple bills (respects 5-concurrent limit) */
  async getBillDetails(billIds: string[]) {
    const results: Array<{
      bill_id: string;
      line_items: Array<{ line_item_id: string; item_id: string; name: string; sku: string; quantity: number; rate: number; item_total: number }>;
    }> = [];

    // Process in batches of 5 (Zoho concurrent limit)
    for (let i = 0; i < billIds.length; i += 5) {
      const batch = billIds.slice(i, i + 5);
      const batchResults = await Promise.all(
        batch.map(async (id) => {
          try {
            const data = await this.getBill(id);
            return { bill_id: id, line_items: data.bill.line_items || [] };
          } catch {
            return { bill_id: id, line_items: [] };
          }
        })
      );
      results.push(...batchResults);
      // Small delay between batches to stay within rate limits
      if (i + 5 < billIds.length) await this.delay(200);
    }
    return results;
  }

  // ---- Items (Products) ----

  async listItems(page = 1, statusFilter?: string, lastModifiedTime?: string) {
    const statusParam = statusFilter ? `&status=${statusFilter}` : "";
    // Zoho expects ISO 8601 with timezone, + must be URL-encoded as %2B
    const modifiedParam = lastModifiedTime ? `&last_modified_time=${encodeURIComponent(lastModifiedTime + "T00:00:00+0530")}` : "";
    return this.apiCall<{
      items: ZohoInventoryItem[];
      page_context?: { has_more_page: boolean };
    }>("GET", `/items?page=${page}&per_page=200${statusParam}${modifiedParam}`);
  }

  async listAllItems(statusFilter?: string, lastModifiedTime?: string) {
    const all: ZohoInventoryItem[] = [];
    let page = 1;
    while (true) {
      const data = await this.listItems(page, statusFilter, lastModifiedTime);
      all.push(...(data.items || []));
      if (!data.page_context?.has_more_page) break;
      page++;
    }
    return all;
  }

  async createItem(itemData: {
    name: string;
    sku: string;
    purchase_rate: number;
    rate?: number;
    item_type?: string;
    product_type?: string;
  }) {
    return this.apiCall<{ item: { item_id: string; name: string; sku: string } }>(
      "POST",
      "/items",
      itemData
    );
  }
}

// Exchange grant token for refresh token (one-time setup)
export async function exchangeGrantTokenInventory(clientId: string, clientSecret: string, grantToken: string) {
  const params = new URLSearchParams({
    code: grantToken,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "authorization_code",
  });

  const res = await fetch(ZOHO_ACCOUNTS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  const data = await readJson<Record<string, unknown>>(res, {
    service: "Zoho Inventory (OAuth)",
    endpoint: "/oauth/v2/token",
  });
  if (data.error) throw new Error(String(data.error));

  return {
    accessToken: data.access_token as string,
    refreshToken: data.refresh_token as string,
    expiresIn: data.expires_in as number,
  };
}
