// Zoho Books. Everything shared lives in IntegrationClient; this file holds only what is
// genuinely specific to Books — contacts, and the write endpoints.
import { IntegrationClient, type IntegrationBill, type ProviderKey } from "./base";

/** Zoho's last_modified_time filter, in the form the contacts call already sends successfully. */
function modifiedSince(date?: string) {
  return date ? `&last_modified_time=${encodeURIComponent(date + "T00:00:00+0530")}` : "";
}

/** A vendor credit as `GET /vendorcredits` lists it — the fields the pull reads. */
export interface ZohoVendorCreditRow {
  vendor_credit_id: string;
  vendor_credit_number: string;
  reference_number?: string;
  status: string; // open | closed | void | draft
  date: string;
  total: number;
  balance: number;
  vendor_id: string;
  vendor_name: string;
  last_modified_time?: string;
  location_id?: string;
}

/** One vendor credit as `GET /vendorcredits/{id}` returns it. */
export interface ZohoVendorCreditDetail extends ZohoVendorCreditRow {
  notes?: string;
  location_name?: string;
  total_credits_used?: number;
  total_refunded_amount?: number;
  bills_credited?: Array<{
    bill_id: string;
    vendor_credit_bill_id: string;
    bill_number?: string;
    date: string;
    amount: number;
  }>;
  vendor_credit_refunds?: Array<{
    vendor_credit_refund_id: string;
    date: string;
    amount_bcy?: number;
    amount?: number;
    refund_mode?: string;
    reference_number?: string;
  }>;
}

/** A customer credit note as `GET /creditnotes` lists it. */
export interface ZohoCreditNoteRow {
  creditnote_id: string;
  creditnote_number: string;
  reference_number?: string;
  status: string;
  date: string;
  total: number;
  balance: number;
  customer_id: string;
  customer_name: string;
  location_id?: string;
  last_modified_time?: string;
}

/** One customer credit note as `GET /creditnotes/{id}` returns it. */
export interface ZohoCreditNoteDetail extends ZohoCreditNoteRow {
  invoices?: Array<{ invoice_id: string; invoice_number: string; amount?: number; amount_applied?: number }>;
}

export interface ZohoLocation {
  location_id: string;
  location_name: string;
  is_primary_location?: boolean;
  is_location_active?: boolean;
  parent_location_id?: string;
}

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

  // ─── Vendor credits, customer credit notes, locations (plan 1210, all reads) ──
  // The token needs ZohoBooks.debitnotes.READ and ZohoBooks.creditnotes.READ for the first two.
  // Without them Zoho answers 401 code 57 "You are not authorized to perform this operation"
  // (Phase 0, 13 Oct 2026), which apiCall surfaces as that sentence.

  async listVendorCredits(page = 1, modifiedFrom?: string, searchText?: string) {
    const search = searchText ? `&search_text=${encodeURIComponent(searchText)}` : "";
    return this.apiCall<{ vendorcredits: ZohoVendorCreditRow[]; page_context?: { has_more_page: boolean } }>(
      "GET",
      `/vendorcredits?page=${page}&per_page=200${modifiedSince(modifiedFrom)}${search}`,
      undefined,
      "vendorcredits.list"
    );
  }

  async listAllVendorCredits(modifiedFrom?: string, searchText?: string) {
    const all: ZohoVendorCreditRow[] = [];
    for (let page = 1; ; page++) {
      const data = await this.listVendorCredits(page, modifiedFrom, searchText);
      all.push(...(data.vendorcredits || []));
      if (!data.page_context?.has_more_page) break;
    }
    return all;
  }

  async getVendorCredit(vendorCreditId: string) {
    return this.apiCall<{ vendor_credit?: ZohoVendorCreditDetail }>(
      "GET",
      `/vendorcredits/${encodeURIComponent(vendorCreditId)}`,
      undefined,
      "vendorcredits.get"
    );
  }

  async listCreditNotes(page = 1, modifiedFrom?: string, searchText?: string) {
    const search = searchText ? `&search_text=${encodeURIComponent(searchText)}` : "";
    return this.apiCall<{ creditnotes: ZohoCreditNoteRow[]; page_context?: { has_more_page: boolean } }>(
      "GET",
      `/creditnotes?page=${page}&per_page=200${modifiedSince(modifiedFrom)}${search}`,
      undefined,
      "creditnotes.list"
    );
  }

  async listAllCreditNotes(modifiedFrom?: string, searchText?: string) {
    const all: ZohoCreditNoteRow[] = [];
    for (let page = 1; ; page++) {
      const data = await this.listCreditNotes(page, modifiedFrom, searchText);
      all.push(...(data.creditnotes || []));
      if (!data.page_context?.has_more_page) break;
    }
    return all;
  }

  async getCreditNote(creditNoteId: string) {
    return this.apiCall<{ creditnote?: ZohoCreditNoteDetail }>(
      "GET",
      `/creditnotes/${encodeURIComponent(creditNoteId)}`,
      undefined,
      "creditnotes.get"
    );
  }

  /** A bill by vendor and number — the link backfill's lookup (Part 1.4). */
  async findBill(zohoVendorId: string, billNumber: string) {
    return this.apiCall<{ bills: IntegrationBill[] }>(
      "GET",
      `/bills?vendor_id=${encodeURIComponent(zohoVendorId)}&bill_number=${encodeURIComponent(billNumber)}`,
      undefined,
      "bills.find"
    );
  }

  async listLocations() {
    return this.apiCall<{ locations: ZohoLocation[] }>("GET", "/locations", undefined, "locations.list");
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
