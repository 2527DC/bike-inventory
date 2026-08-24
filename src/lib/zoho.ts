import { prisma } from "@/lib/db";
import { readJson } from "@/lib/http-json";
import { createLogger } from "@/lib/logger";

const log = createLogger("zoho");

const ZOHO_ACCOUNTS_URL = "https://accounts.zoho.in/oauth/v2/token";
const ZOHO_API_BASE = "https://www.zohoapis.in/books/v3";

interface ZohoTokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
  error?: string;
}

export class ZohoClient {
  private accessToken: string | null = null;
  private organizationId: string | null = null;

  async init(): Promise<boolean> {
    const config = await prisma.zohoConfig.findUnique({ where: { id: "singleton" } });
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
      service: "Zoho Books (token refresh)",
      endpoint: "/oauth/v2/token",
    });
    if (data.error || !data.access_token) {
      log.error(`token refresh rejected by Zoho Books`, { error: data.error });
      return false;
    }
    log.info(`Zoho Books access token refreshed`);

    const expiresAt = new Date(Date.now() + data.expires_in * 1000);
    this.accessToken = data.access_token;

    await prisma.zohoConfig.update({
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
      throw new Error("Zoho client not initialized");
    }

    const separator = endpoint.includes("?") ? "&" : "?";
    const url = `${ZOHO_API_BASE}${endpoint}${separator}organization_id=${this.organizationId}`;
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
    log.debug(`-> Zoho Books ${method} ${endpoint}`, body ? { body } : undefined);
    const res = await fetch(url, buildOptions());

    // Token expired mid-request — refresh and retry once
    if (res.status === 401 && _attempt === 0) {
      log.warn(`<- Zoho Books ${endpoint} 401 — access token expired, refreshing`, {
        ms: Date.now() - started,
      });
      const config = await prisma.zohoConfig.findUnique({ where: { id: "singleton" } });
      if (config?.clientId && config?.clientSecret && config?.refreshToken) {
        const refreshed = await this.refreshAccessToken(config.clientId, config.clientSecret, config.refreshToken);
        if (refreshed) {
          return this.apiCall<T>(method, endpoint, body, _attempt + 1);
        }
      }
      log.error(`<- Zoho Books ${endpoint} — token refresh failed, reconnect required`);
      throw new Error("Zoho authentication failed. Please reconnect.");
    }

    if (res.status === 429) {
      // Retry with exponential backoff (up to 3 attempts)
      if (_attempt < 3) {
        const retryAfter = parseInt(res.headers.get("Retry-After") || "0", 10);
        const delay = retryAfter > 0 ? retryAfter * 1000 : Math.min(5000 * Math.pow(2, _attempt), 60000);
        log.warn(
          `<- Zoho Books ${endpoint} 429 rate limited — retry ${_attempt + 1}/3 in ${delay}ms`
        );
        await new Promise((r) => setTimeout(r, delay));
        return this.apiCall<T>(method, endpoint, body, _attempt + 1);
      }
      log.error(`<- Zoho Books ${endpoint} — rate limit not cleared after 3 retries`);
      throw new Error("Zoho API rate limit exceeded after 3 retries. Wait 2 minutes and try again.");
    }

    const ms = Date.now() - started;
    // readJson checks content-type first: an HTML gateway/timeout page from Zoho used to
    // surface as `Unexpected token '<'` with no clue which call or status produced it.
    const data = await readJson<{ code?: number; message?: string }>(res, {
      service: "Zoho Books",
      endpoint,
      ms,
    });
    if (data.code !== 0 && data.code !== undefined) {
      log.warn(`${method} ${endpoint} -> code ${data.code}`, { message: data.message, ms });
      throw new Error(data.message || `Zoho API error: ${data.code}`);
    }

    return data as T;
  }

  // ---- Items (Products) ----

  async createItem(product: {
    sku: string; name: string; costPrice: number; sellingPrice: number;
    hsnCode?: string | null; gstRate: number;
  }) {
    return this.apiCall("POST", "/items", {
      JSONString: JSON.stringify({
        name: product.name,
        sku: product.sku,
        rate: product.sellingPrice,
        purchase_rate: product.costPrice,
        hsn_or_sac: product.hsnCode || undefined,
        item_type: "inventory",
        product_type: "goods",
      }),
    });
  }

  async getItem(itemId: string) {
    return this.apiCall<{
      item: Record<string, unknown>;
    }>("GET", `/items/${itemId}`);
  }

  async listItems(page = 1, statusFilter?: string, lastModifiedTime?: string) {
    const statusParam = statusFilter ? `&status=${statusFilter}` : "";
    // Zoho expects ISO 8601 with timezone, + must be URL-encoded as %2B
    const modifiedParam = lastModifiedTime ? `&last_modified_time=${encodeURIComponent(lastModifiedTime + "T00:00:00+0530")}` : "";
    return this.apiCall<{
      items: Array<{
        item_id: string; sku: string; name: string; status?: string;
        brand?: string; manufacturer?: string;
        purchase_rate?: number; rate?: number;
        tax_percentage?: number; hsn_or_sac?: string;
        stock_on_hand?: number; product_type?: string; item_type?: string;
        category_name?: string; category_id?: string; group_name?: string;
      }>;
      page_context?: { has_more_page: boolean };
    }>("GET", `/items?page=${page}&per_page=200${statusParam}${modifiedParam}`);
  }

  async listAllItems(statusFilter?: string, lastModifiedTime?: string) {
    const all: Array<{
      item_id: string; sku: string; name: string; status?: string;
      brand?: string; manufacturer?: string;
      purchase_rate?: number; rate?: number;
      tax_percentage?: number; hsn_or_sac?: string;
      stock_on_hand?: number; product_type?: string; item_type?: string;
      category_name?: string; category_id?: string; group_name?: string;
    }> = [];
    let page = 1;
    while (true) {
      const data = await this.listItems(page, statusFilter, lastModifiedTime);
      all.push(...(data.items || []));
      if (!data.page_context?.has_more_page) break;
      page++;
    }
    return all;
  }

  // ---- Contacts (Vendors) ----

  async createContact(vendor: {
    name: string; gstin?: string | null; email?: string | null;
    phone?: string | null; city?: string | null; state?: string | null;
  }) {
    return this.apiCall("POST", "/contacts", {
      JSONString: JSON.stringify({
        contact_name: vendor.name,
        contact_type: "vendor",
        gst_no: vendor.gstin || undefined,
        email: vendor.email || undefined,
        phone: vendor.phone || undefined,
        billing_address: {
          city: vendor.city || undefined,
          state: vendor.state || undefined,
        },
      }),
    });
  }

  // ---- Invoices (Outward Transactions) ----

  async createInvoice(data: {
    customerName: string; referenceNo?: string;
    lineItems: Array<{ name: string; sku: string; quantity: number; rate: number }>;
    date: string;
  }) {
    return this.apiCall("POST", "/invoices", {
      JSONString: JSON.stringify({
        customer_name: data.customerName || "Walk-in Customer",
        reference_number: data.referenceNo,
        date: data.date,
        line_items: data.lineItems.map((item) => ({
          name: item.name,
          sku: item.sku,
          quantity: item.quantity,
          rate: item.rate,
        })),
      }),
    });
  }

  // ---- Bills (Purchase Orders / Vendor Bills) ----

  async createBill(data: {
    vendorName: string; billNo: string; billDate: string;
    dueDate: string; amount: number;
    lineItems: Array<{ name: string; quantity: number; rate: number; gstPercent?: number; hsn?: string }>;
  }) {
    return this.apiCall("POST", "/bills", {
      JSONString: JSON.stringify({
        vendor_name: data.vendorName,
        bill_number: data.billNo,
        date: data.billDate,
        due_date: data.dueDate,
        is_inclusive_tax: false,
        gst_treatment: "business_gst",
        line_items: data.lineItems.map((item) => ({
          name: item.name,
          quantity: item.quantity,
          rate: item.rate,
          tax_percentage: item.gstPercent || 0,
          hsn_or_sac: item.hsn || "",
        })),
      }),
    });
  }

  // ---- Pull/Import from Zoho ----

  async searchContacts(searchText: string, contactType?: string) {
    const typeParam = contactType ? `&contact_type=${contactType}` : "";
    return this.apiCall<{
      contacts: Array<{
        contact_id: string;
        contact_name: string;
        contact_type: string;
        email?: string;
        phone?: string;
        mobile?: string;
        billing_address?: { city?: string; state?: string; address?: string };
      }>;
    }>("GET", `/contacts?search_text=${encodeURIComponent(searchText)}${typeParam}&per_page=10`);
  }

  async listContacts(page = 1, lastModifiedTime?: string) {
    // Zoho expects ISO 8601 with timezone, + must be URL-encoded as %2B
    const modifiedParam = lastModifiedTime ? `&last_modified_time=${encodeURIComponent(lastModifiedTime + "T00:00:00+0530")}` : "";
    return this.apiCall<{
      contacts: Array<{
        contact_id: string;
        contact_name: string;
        contact_type: string;
        gst_no?: string;
        email?: string;
        phone?: string;
        billing_address?: { city?: string; state?: string };
      }>;
      page_context?: { has_more_page: boolean };
    }>("GET", `/contacts?contact_type=vendor&page=${page}&per_page=200${modifiedParam}`);
  }

  async listAllContacts(lastModifiedTime?: string) {
    const all: Array<{ contact_id: string; contact_name: string; contact_type: string; gst_no?: string; email?: string; phone?: string; billing_address?: { city?: string; state?: string } }> = [];
    let page = 1;
    while (true) {
      const data = await this.listContacts(page, lastModifiedTime);
      all.push(...(data.contacts || []));
      if (!data.page_context?.has_more_page) break;
      page++;
    }
    return all;
  }

  async listBills(page = 1, dateFrom?: string, dateTo?: string, searchText?: string) {
    const dateParam = dateFrom ? `&date_start=${dateFrom}` : "";
    const dateEndParam = dateTo ? `&date_end=${dateTo}` : "";
    const searchParam = searchText ? `&search_text=${encodeURIComponent(searchText)}` : "";
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
    }>("GET", `/bills?page=${page}&per_page=200${dateParam}${dateEndParam}${searchParam}`);
  }

  async listAllBills(dateFrom?: string, dateTo?: string, searchText?: string) {
    const all: Array<{ bill_id: string; bill_number: string; vendor_name: string; vendor_id: string; date: string; due_date: string; total: number; balance: number; status: string }> = [];
    let page = 1;
    while (true) {
      const data = await this.listBills(page, dateFrom, dateTo, searchText);
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
        total: number;
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

  async listInvoices(page = 1, dateFrom?: string, dateTo?: string, searchText?: string) {
    const dateParam = dateFrom ? `&date_start=${dateFrom}` : "";
    const dateEndParam = dateTo ? `&date_end=${dateTo}` : "";
    const searchParam = searchText ? `&search_text=${encodeURIComponent(searchText)}` : "";
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
    }>("GET", `/invoices?page=${page}&per_page=200${dateParam}${dateEndParam}${searchParam}`);
  }

  async listAllInvoices(dateFrom?: string, dateTo?: string, searchText?: string) {
    const all: Array<{ invoice_id: string; invoice_number: string; customer_name: string; customer_id: string; phone?: string; date: string; total: number; balance: number; status: string }> = [];
    let page = 1;
    while (true) {
      const data = await this.listInvoices(page, dateFrom, dateTo, searchText);
      all.push(...(data.invoices || []));
      if (!data.page_context?.has_more_page) break;
      page++;
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

  // ---- Customer Payments (for POS payment mode breakdown) ----

  async listCustomerPayments(page = 1, dateFrom?: string, dateTo?: string) {
    const dateParam = dateFrom ? `&date_start=${dateFrom}` : "";
    const dateEndParam = dateTo ? `&date_end=${dateTo}` : "";
    return this.apiCall<{
      customerpayments: Array<{
        payment_id: string;
        payment_number: string;
        invoice_numbers: string;
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
      payment_id: string; payment_number: string; invoice_numbers: string;
      date: string; amount: number; payment_mode: string;
      reference_number: string; customer_name: string; account_name: string;
    }> = [];
    let page = 1;
    while (true) {
      const data = await this.listCustomerPayments(page, dateFrom, dateTo);
      all.push(...(data.customerpayments || []));
      if (!data.page_context?.has_more_page) break;
      page++;
      await this.delay(300);
    }
    return all;
  }

  // ---- Organizations ----

  async getOrganizations() {
    return this.apiCall<{ organizations: Array<{ organization_id: string; name: string }> }>(
      "GET", "/../organizations"
    );
  }
}

// Exchange grant token for refresh token (one-time setup)
export async function exchangeGrantToken(clientId: string, clientSecret: string, grantToken: string) {
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
    service: "Zoho Books (OAuth)",
    endpoint: "/oauth/v2/token",
  });
  if (data.error) throw new Error(String(data.error));

  return {
    accessToken: data.access_token as string,
    refreshToken: data.refresh_token as string,
    expiresIn: data.expires_in as number,
  };
}
