// Zoho Books. Everything shared lives in IntegrationClient; this file holds only what is
// genuinely specific to Books — contacts, and the write endpoints.
import { IntegrationClient, type ProviderKey } from "./base";

export class BooksClient extends IntegrationClient {
  protected readonly provider: ProviderKey = "ZOHO_BOOKS";
  protected readonly apiBase = "https://www.zohoapis.in/books/v3";

  // ─── Items ─────────────────────────────────────────────────────────────────
  // Books wraps the payload in JSONString; Zoho Inventory does not. That is a real API
  // difference between the two products, not an inconsistency in this codebase.

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
    }, "items.create");
  }

  async getItem(itemId: string) {
    return this.apiCall<{ item: Record<string, unknown> }>("GET", `/items/${itemId}`, undefined, "items.get");
  }

  /**
   * Update fields on an existing Zoho item.
   *
   * This was the ONLY write to Zoho with no client method — `api/stock/price-check` called
   * `apiCall("PUT", …)` raw from inside a route handler, so the one endpoint in this
   * application that OVERWRITES existing Zoho data appeared in no client and no listing.
   * Every other write creates a new record; this one changes a record that is already there,
   * which makes it the one most worth having in a single, findable place.
   *
   * `JSONString` wrapping is Books' convention for writes — see createItem. Zoho Inventory
   * posts the object directly, which is why this lives on BooksClient rather than the base.
   */
  async updateItem(itemId: string, fields: Record<string, unknown>) {
    return this.apiCall<{ item?: Record<string, unknown> }>(
      "PUT",
      `/items/${itemId}`,
      { JSONString: JSON.stringify(fields) },
      "items.update"
    );
  }

  /**
   * Search invoices by any combination of Zoho's query parameters.
   *
   * Generic in the row type because the caller owns the shape it wants back: the workshop
   * reads a handful of fields off an invoice and declares its own `ServiceInvoice`, and the
   * client has no business knowing about that type.
   *
   * The invoice-number FORMAT GUESSING that surrounds this in src/lib/services/zoho.ts —
   * "17898" -> "017898" -> "INV/25/017898" -> search_text — deliberately stays there. That
   * is workshop business logic about how the counter writes invoice numbers, not transport.
   */
  async searchInvoices<T>(params: Record<string, string>) {
    const query = new URLSearchParams(params).toString();
    return this.apiCall<{ invoices?: T[] }>(
      "GET",
      `/invoices?${query}`,
      undefined,
      "invoices.search"
    );
  }

  // ─── Contacts (vendors and customers) ──────────────────────────────────────
  // Only Books deals in contacts. This is where every Vendor imported from Zoho comes from.

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
    }, "contacts.create");
  }

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
    }>(
      "GET",
      `/contacts?search_text=${encodeURIComponent(searchText)}${typeParam}&per_page=10`,
      undefined,
      "contacts.search"
    );
  }

  async listContacts(page = 1, lastModifiedTime?: string) {
    // Zoho expects ISO 8601 with timezone, + must be URL-encoded as %2B
    const modifiedParam = lastModifiedTime
      ? `&last_modified_time=${encodeURIComponent(lastModifiedTime + "T00:00:00+0530")}`
      : "";
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
    }>(
      "GET",
      `/contacts?contact_type=vendor&page=${page}&per_page=200${modifiedParam}`,
      undefined,
      "contacts.list"
    );
  }

  async listAllContacts(lastModifiedTime?: string) {
    const all: Array<{
      contact_id: string; contact_name: string; contact_type: string; gst_no?: string;
      email?: string; phone?: string; billing_address?: { city?: string; state?: string };
    }> = [];
    let page = 1;
    for (;;) {
      const data = await this.listContacts(page, lastModifiedTime);
      all.push(...(data.contacts || []));
      if (!data.page_context?.has_more_page) break;
      page++;
    }
    return all;
  }

  // ─── Writes back to Zoho ───────────────────────────────────────────────────

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
    }, "invoices.create");
  }

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
    }, "bills.create");
  }

  /**
   * Lists the organizations this token can see, used during setup to find the org id.
   *
   * The "/../organizations" path is deliberate: organizations sits above the books/v3
   * segment, so the `..` walks the base URL up one level.
   */
  async getOrganizations() {
    return this.apiCall<{ organizations: Array<{ organization_id: string; name: string }> }>(
      "GET",
      "/../organizations",
      undefined,
      "organizations.list"
    );
  }
}
