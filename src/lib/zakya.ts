import { prisma } from "@/lib/db";
import { readJson } from "@/lib/http-json";
import { createLogger } from "@/lib/logger";

const log = createLogger("zakya");

const ZOHO_ACCOUNTS_URL = "https://accounts.zoho.in/oauth/v2/token";
const ZAKYA_API_BASE = "https://api.zakya.in/inventory/v1";

interface ZakyaTokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
  error?: string;
}

export class ZakyaClient {
  private accessToken: string | null = null;
  private organizationId: string | null = null;

  async init(): Promise<boolean> {
    const config = await prisma.zakyaConfig.findUnique({ where: { id: "singleton" } });
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

    const data = await readJson<ZakyaTokenResponse>(res, {
      service: "Zakya (token refresh)",
      endpoint: "/oauth/v2/token",
    });
    if (data.error || !data.access_token) {
      log.error(`token refresh rejected by Zakya`, { error: data.error });
      return false;
    }
    log.info(`Zakya access token refreshed`);

    const expiresAt = new Date(Date.now() + data.expires_in * 1000);
    this.accessToken = data.access_token;

    await prisma.zakyaConfig.update({
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
      throw new Error("Zakya client not initialized");
    }

    const separator = endpoint.includes("?") ? "&" : "?";
    const url = `${ZAKYA_API_BASE}${endpoint}${separator}organization_id=${this.organizationId}`;
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
    log.debug(`-> Zakya ${method} ${endpoint}`, body ? { body } : undefined);
    const res = await fetch(url, buildOptions());

    // Token expired mid-request — refresh and retry once
    if (res.status === 401 && _attempt === 0) {
      log.warn(`<- Zakya ${endpoint} 401 — access token expired, refreshing`, {
        ms: Date.now() - started,
      });
      const config = await prisma.zakyaConfig.findUnique({ where: { id: "singleton" } });
      if (config?.clientId && config?.clientSecret && config?.refreshToken) {
        const refreshed = await this.refreshAccessToken(config.clientId, config.clientSecret, config.refreshToken);
        if (refreshed) {
          return this.apiCall<T>(method, endpoint, body, _attempt + 1);
        }
      }
      log.error(`<- Zakya ${endpoint} — token refresh failed, reconnect required`);
      throw new Error("Zakya authentication failed. Please reconnect.");
    }

    if (res.status === 429) {
      // Retry with exponential backoff (up to 3 attempts)
      if (_attempt < 3) {
        const retryAfter = parseInt(res.headers.get("Retry-After") || "0", 10);
        const delay = retryAfter > 0 ? retryAfter * 1000 : Math.min(5000 * Math.pow(2, _attempt), 60000);
        log.warn(
          `<- Zakya ${endpoint} 429 rate limited — retry ${_attempt + 1}/3 in ${delay}ms`
        );
        await new Promise((r) => setTimeout(r, delay));
        return this.apiCall<T>(method, endpoint, body, _attempt + 1);
      }
      log.error(`<- Zakya ${endpoint} — rate limit not cleared after 3 retries`);
      throw new Error("Zakya API rate limit exceeded after 3 retries. Wait 2 minutes and try again.");
    }

    const ms = Date.now() - started;
    // readJson checks content-type first: an HTML gateway/timeout page from Zoho used to
    // surface as `Unexpected token '<'` with no clue which call or status produced it.
    const data = await readJson<{ code?: number; message?: string }>(res, {
      service: "Zakya",
      endpoint,
      ms,
    });
    if (data.code !== 0 && data.code !== undefined) {
      log.warn(`${method} ${endpoint} -> code ${data.code}`, { message: data.message, ms });
      throw new Error(data.message || `Zakya API error: ${data.code}`);
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

  // ---- Invoices (Sales) ----

  async listInvoices(page = 1, dateFrom?: string, dateTo?: string) {
    const dateParam = dateFrom ? `&date_start=${dateFrom}` : "";
    const dateEndParam = dateTo ? `&date_end=${dateTo}` : "";
    return this.apiCall<{
      invoices: Array<{
        invoice_id: string;
        invoice_number: string;
        customer_name: string;
        customer_id: string;
        phone?: string;
        date: string;
        total: number;
        balance: number;
        status: string;
      }>;
      page_context?: { has_more_page: boolean };
    }>("GET", `/invoices?page=${page}&per_page=200${dateParam}${dateEndParam}`);
  }

  async listAllInvoices(dateFrom?: string, dateTo?: string) {
    const all: Array<{
      invoice_id: string;
      invoice_number: string;
      customer_name: string;
      customer_id: string;
      phone?: string;
      date: string;
      total: number;
      balance: number;
      status: string;
    }> = [];
    let page = 1;
    while (true) {
      const data = await this.listInvoices(page, dateFrom, dateTo);
      all.push(...(data.invoices || []));
      if (!data.page_context?.has_more_page) break;
      page++;
    }
    return all;
  }

  // ---- Customer Payments (for POS payment mode breakdown) ----

  async listCustomerPayments(page = 1, dateFrom?: string, dateTo?: string) {
    const dateParam = dateFrom ? `&date_start=${dateFrom}` : "";
    const dateEndParam = dateTo ? `&date_end=${dateTo}` : "";
    return this.apiCall<{
      customerpayments: Array<{
        payment_id: string;
        payment_number: string;
        invoice_number: string;
        invoice_id?: string;
        date: string;
        amount: number;
        payment_mode: string;
        reference_number: string;
        customer_name: string;
        account_name: string;
      }>;
      page_context?: { has_more_page: boolean };
    }>("GET", `/customerpayments?page=${page}&per_page=200${dateParam}${dateEndParam}`);
  }

  async listAllCustomerPayments(dateFrom?: string, dateTo?: string) {
    const all: Array<{
      payment_id: string;
      payment_number: string;
      invoice_number: string;
      invoice_id?: string;
      date: string;
      amount: number;
      payment_mode: string;
      reference_number: string;
      customer_name: string;
      account_name: string;
    }> = [];
    let page = 1;
    while (true) {
      const data = await this.listCustomerPayments(page, dateFrom, dateTo);
      all.push(...(data.customerpayments || []));
      if (!data.page_context?.has_more_page) break;
      page++;
      await this.delay(300); // Rate limit
    }
    return all;
  }

  async getInvoice(invoiceId: string) {
    return this.apiCall<{
      invoice: {
        invoice_id: string;
        invoice_number: string;
        customer_name: string;
        date: string;
        total: number;
        balance: number;
        status: string;
        payment_made: number;
        payments?: Array<{
          payment_id: string;
          payment_mode: string;
          amount: number;
          date: string;
          description?: string;
          reference_number?: string;
          account_name?: string;
        }>;
        line_items: Array<{
          line_item_id: string;
          item_id: string;
          name: string;
          sku: string;
          quantity: number;
          rate: number;
          item_total: number;
          serial_numbers?: string[];
        }>;
      };
    }>("GET", `/invoices/${invoiceId}`);
  }
}

// Exchange grant token for refresh token (one-time setup)
export async function exchangeGrantTokenZakya(clientId: string, clientSecret: string, grantToken: string) {
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
    service: "Zakya (OAuth)",
    endpoint: "/oauth/v2/token",
  });
  if (data.error) throw new Error(String(data.error));

  return {
    accessToken: data.access_token as string,
    refreshToken: data.refresh_token as string,
    expiresIn: data.expires_in as number,
  };
}
