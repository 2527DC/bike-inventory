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
    });
  }

  async getItem(itemId: string) {
    return this.apiCall<{ item: Record<string, unknown> }>("GET", `/items/${itemId}`);
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
    });
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
    }>("GET", `/contacts?search_text=${encodeURIComponent(searchText)}${typeParam}&per_page=10`);
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
    }>("GET", `/contacts?contact_type=vendor&page=${page}&per_page=200${modifiedParam}`);
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
    });
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
    });
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
      "/../organizations"
    );
  }
}
