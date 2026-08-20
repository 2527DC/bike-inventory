// Zoho Books API helper — token refresh + invoice queries

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  // Return cached token if still valid (with 5min buffer)
  if (cachedToken && Date.now() < cachedToken.expiresAt - 300000) {
    return cachedToken.token;
  }

  const res = await fetch("https://accounts.zoho.in/oauth/v2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: process.env.ZOHO_REFRESH_TOKEN!,
      client_id: process.env.ZOHO_CLIENT_ID!,
      client_secret: process.env.ZOHO_CLIENT_SECRET!,
      grant_type: "refresh_token",
    }),
  });

  const data = await res.json();
  if (!data.access_token) {
    throw new Error("Failed to refresh Zoho token");
  }

  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };

  return cachedToken.token;
}

const ORG_ID = process.env.ZOHO_ORG_ID!;
const BASE = "https://www.zohoapis.in/books/v3";

async function zohoGet(path: string, params: Record<string, string> = {}) {
  const token = await getAccessToken();
  const query = new URLSearchParams({ organization_id: ORG_ID, ...params });
  const res = await fetch(`${BASE}${path}?${query}`, {
    headers: { Authorization: `Zoho-oauthtoken ${token}` },
  });
  return res.json();
}

// Search invoices by customer phone
export async function searchInvoicesByPhone(phone: string) {
  const data = await zohoGet("/invoices", {
    phone: phone,
    sort_column: "created_time",
    sort_order: "D",
    per_page: "5",
  });
  return data.invoices || [];
}

// Search invoices by invoice number
// Accepts: "17898", "017898", "INV/25/017898", "INV-017898" etc.
export async function searchInvoiceByNumber(input: string) {
  const trimmed = input.trim();

  // Try exact match first (for full invoice numbers like "INV/25/017898")
  const exact = await zohoGet("/invoices", {
    invoice_number: trimmed,
    per_page: "1",
  });
  if (exact.invoices?.length) return exact.invoices[0];

  // If user entered just digits, try common Zoho invoice formats
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length > 0) {
    // Pad to 6 digits (e.g. "17898" → "017898")
    const padded = digits.padStart(6, "0");

    // Try common formats: INV/YY/NNNNNN, INV-NNNNNN
    const year = new Date().getFullYear().toString().slice(-2);
    const prevYear = (new Date().getFullYear() - 1).toString().slice(-2);
    const formats = [
      `INV/${year}/${padded}`,
      `INV/${prevYear}/${padded}`,
      `INV-${padded}`,
      padded,
    ];

    for (const fmt of formats) {
      const res = await zohoGet("/invoices", {
        invoice_number: fmt,
        per_page: "1",
      });
      if (res.invoices?.length) return res.invoices[0];
    }
  }

  // Final fallback: search_text for partial matching
  const search = await zohoGet("/invoices", {
    search_text: trimmed,
    per_page: "5",
  });
  if (search.invoices?.length) {
    const match = search.invoices.find(
      (inv: { invoice_number: string }) => inv.invoice_number.includes(trimmed) || inv.invoice_number.includes(digits)
    );
    return match || search.invoices[0];
  }

  return null;
}

// Get single invoice details
export async function getInvoice(invoiceId: string) {
  const data = await zohoGet(`/invoices/${invoiceId}`);
  return data.invoice || null;
}

// Extract ALL BCH token numbers embedded in a Zoho customer_name.
// Handles single bills ("AADYA GOWDA BCH0617", "ROOPA BCH 0497", "SAGAR BCH-0552",
// "K MALAYADRIb bch 0337") AND combined bills where one invoice covers several
// bikes ("GOVIND BCH0534/0535", "BCH 0534, 0535"). Returns the numeric values
// (e.g. [534, 535]); empty array when no BCH-digits are present ("WALKIN", "BCH").
export function extractTokenNumbers(customerName: string): number[] {
  if (!customerName) return [];
  const found = new Set<number>();
  const groups = customerName.match(/BCH[\s\-:#/]*0*\d+(?:[\s,/&]+0*\d+)*/gi) || [];
  for (const g of groups) {
    for (const d of g.match(/\d+/g) || []) {
      const n = parseInt(d, 10);
      if (!Number.isNaN(n)) found.add(n);
    }
  }
  return [...found];
}

// Page through paid invoices (sorted by date, descending) since the given
// ISO date (YYYY-MM-DD). Stops when there are no more pages, when an invoice
// older than sinceDateISO is reached, or after a 25-page safety cap.
export async function listPaidInvoices(
  sinceDateISO: string
): Promise<
  Array<{
    invoice_number: string;
    customer_name: string;
    status: string;
    total: number;
    balance: number;
    date: string;
  }>
> {
  const results: Array<{
    invoice_number: string;
    customer_name: string;
    status: string;
    total: number;
    balance: number;
    date: string;
  }> = [];

  for (let page = 1; page <= 25; page++) {
    const data = await zohoGet("/invoices", {
      status: "paid",
      sort_column: "date",
      sort_order: "D",
      per_page: "200",
      page: String(page),
    });

    const invoices: Array<Record<string, unknown>> = Array.isArray(data?.invoices)
      ? data.invoices
      : [];

    let reachedOld = false;
    for (const inv of invoices) {
      const date = typeof inv?.date === "string" ? inv.date : "";
      if (date && date < sinceDateISO) {
        reachedOld = true;
        break;
      }
      results.push({
        invoice_number: typeof inv?.invoice_number === "string" ? inv.invoice_number : "",
        customer_name: typeof inv?.customer_name === "string" ? inv.customer_name : "",
        status: typeof inv?.status === "string" ? inv.status : "",
        total: typeof inv?.total === "number" ? inv.total : 0,
        balance: typeof inv?.balance === "number" ? inv.balance : 0,
        date,
      });
    }

    if (reachedOld) break;

    const hasMore = data?.page_context?.has_more_page === true;
    if (!hasMore) break;
  }

  return results;
}
