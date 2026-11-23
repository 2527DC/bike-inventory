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
    return this.apiCall<{ contact?: { contact_id: string; contact_name: string } }>("POST", "/contacts", {
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
        gst_no?: string;
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
    vendorName?: string;
    vendorId?: string;
    billNo: string;
    billDate: string;
    dueDate?: string;
    referenceNumber?: string;
    amount?: number;
    gstNo?: string;
    taxType?: "IGST" | "CGST_SGST";
    lineItems: Array<{
      name: string;
      quantity: number;
      rate: number;
      gstPercent?: number;
      hsn?: string;
      accountId?: string;
      itemId?: string;
    }>;
  }) {
    const INTRA_TAX_MAP: Record<number, string> = {
      0: "1593656000000022480", // GST0
      5: "1593656000000022486", // GST5
      18: "1593656000000022498", // GST18
    };

    const INTER_TAX_MAP: Record<number, string> = {
      0: "1593656000000022390", // IGST0
      5: "1593656000000022392", // IGST5
      18: "1593656000000022396", // IGST18
    };

    let isInterstate = false;
    if (data.taxType === "IGST") {
      isInterstate = true;
    } else if (data.gstNo) {
      const cleanGst = data.gstNo.trim().toUpperCase();
      if (/^\d{2}/.test(cleanGst) && !cleanGst.startsWith("29")) {
        isInterstate = true;
      }
    }

    const buildPayload = (interstate: boolean): Record<string, unknown> => {
      const taxMap = interstate ? INTER_TAX_MAP : INTRA_TAX_MAP;
      const defaultTax = interstate ? "1593656000000022392" : "1593656000000022486";
      const zeroTax = interstate ? "1593656000000022390" : "1593656000000022480";

      const payload: Record<string, unknown> = {
        bill_number: data.billNo,
        date: data.billDate,
        due_date: data.dueDate || data.billDate,
        is_inclusive_tax: false,
        gst_treatment: "business_gst",
        is_draft: true,
        line_items: data.lineItems.map((item) => {
          const gst = item.gstPercent ?? 0;
          const taxId = taxMap[gst] || (gst === 0 ? zeroTax : defaultTax);
          const line: Record<string, unknown> = {
            name: item.name,
            quantity: item.quantity,
            rate: item.rate,
            tax_id: taxId,
            hsn_or_sac: item.hsn || "",
            account_id: item.accountId || "1593656000000000567", // Cost of Goods Sold
          };
          if (item.itemId) line.item_id = item.itemId;
          return line;
        }),
      };

      if (data.vendorId) payload.vendor_id = data.vendorId;
      if (data.vendorName) payload.vendor_name = data.vendorName;
      if (data.referenceNumber) payload.reference_number = data.referenceNumber;
      if (data.gstNo) payload.gst_no = data.gstNo;

      return payload;
    };

    try {
      return await this.apiCall<{ bill?: { bill_id: string; bill_number: string; total: number } }>(
        "POST",
        "/bills",
        buildPayload(isInterstate),
        "bills.create"
      );
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (errMsg.includes("IGST has to be applied") && !isInterstate) {
        return this.apiCall<{ bill?: { bill_id: string; bill_number: string; total: number } }>(
          "POST",
          "/bills",
          buildPayload(true),
          "bills.create"
        );
      }
      if (errMsg.includes("IGST cannot be applied") && isInterstate) {
        return this.apiCall<{ bill?: { bill_id: string; bill_number: string; total: number } }>(
          "POST",
          "/bills",
          buildPayload(false),
          "bills.create"
        );
      }
      throw err;
    }
  }

  /**
   * Upload an invoice file attachment to an existing bill in Zoho Books.
   * Best-effort: failures log a warning rather than aborting the creation flow.
   */
  async attachFileToBill(
    billId: string,
    fileName: string,
    fileBytes: ArrayBuffer | Buffer | Uint8Array,
    mimeType = "application/pdf"
  ) {
    if (!this.accessToken || !this.organizationId) {
      throw new Error(`${this.label} client not initialized`);
    }

    const url = `${this.apiBase}/bills/${billId}/attachment?organization_id=${this.organizationId}`;
    const formData = new FormData();
    const blob = new Blob([fileBytes as unknown as BlobPart], { type: mimeType });
    formData.append("attachment", blob, fileName);

    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Zoho-oauthtoken ${this.accessToken}`,
      },
      body: formData,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Zoho attachment upload failed (${res.status}): ${errText}`);
    }

    return await res.json().catch(() => ({}));
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
