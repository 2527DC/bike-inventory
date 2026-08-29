// Workshop-specific Zoho Books queries.
//
// TRANSPORT LIVES IN `@/lib/integrations` — this file owns only the queries that are
// peculiar to the workshop (invoice-number format guessing).
//
// It used to carry its own OAuth client: a module-scoped token cache, a hardcoded
// `https://accounts.zoho.in/oauth/v2/token`, and credentials read from ZOHO_REFRESH_TOKEN /
// ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET / ZOHO_ORG_ID. That made it a FOURTH Zoho client
// alongside the three the integration refactor consolidated, and — worse — a second source
// of truth: disconnecting Zoho Books in Settings did not disconnect it here, because this
// file never read `IntegrationConfig`.
//
// Everything now goes through `getBooks()`, so one connection serves the whole app and
// `res.json()` on a third-party response is gone (apiCall uses readJson, which names the
// service and status instead of failing with `Unexpected token '<'`).

import { getBooks, type BooksClient, type IntegrationInvoice } from "@/lib/integrations";
import { createLogger } from "@/lib/logger";

const log = createLogger("services:zoho");

/** A Books invoice plus the billing address the workshop screens read a phone number from. */
export type ServiceInvoice = IntegrationInvoice & {
  billing_address?: { phone?: string };
};

/**
 * A ready Books client, or a thrown error naming the fix.
 *
 * `getBooks()` returns null when the integration is simply not connected — a normal state
 * for the rest of the app, but not for a caller that was asked to look up an invoice, so it
 * becomes an error here with the remedy in the message.
 */
async function books(): Promise<BooksClient> {
  const client = await getBooks();
  if (!client) {
    log.warn("Zoho Books is not connected — invoice lookup unavailable");
    throw new Error("Zoho Books is not connected. Connect it in Settings → Integrations.");
  }
  return client;
}

/** `/invoices?a=1&b=2` — apiCall appends organization_id itself. */
function invoicesUrl(params: Record<string, string>): string {
  return `/invoices?${new URLSearchParams(params).toString()}`;
}

// Search invoices by customer phone
export async function searchInvoicesByPhone(phone: string): Promise<ServiceInvoice[]> {
  const client = await books();
  const data = await client.apiCall<{ invoices?: ServiceInvoice[] }>(
    "GET",
    invoicesUrl({ phone, sort_column: "created_time", sort_order: "D", per_page: "5" })
  );
  const invoices = data.invoices || [];
  log.info("invoice search by phone", { matches: invoices.length });
  return invoices;
}

// Search invoices by invoice number
// Accepts: "17898", "017898", "INV/25/017898", "INV-017898" etc.
export async function searchInvoiceByNumber(input: string): Promise<ServiceInvoice | null> {
  const client = await books();
  const trimmed = input.trim();

  const byNumber = async (invoice_number: string) =>
    client.apiCall<{ invoices?: ServiceInvoice[] }>(
      "GET",
      invoicesUrl({ invoice_number, per_page: "1" })
    );

  // Try exact match first (for full invoice numbers like "INV/25/017898")
  const exact = await byNumber(trimmed);
  if (exact.invoices?.length) return exact.invoices[0];

  // If user entered just digits, try common Zoho invoice formats
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length > 0) {
    // Pad to 6 digits (e.g. "17898" → "017898")
    const padded = digits.padStart(6, "0");

    // Try common formats: INV/YY/NNNNNN, INV-NNNNNN
    const year = new Date().getFullYear().toString().slice(-2);
    const prevYear = (new Date().getFullYear() - 1).toString().slice(-2);
    const formats = [`INV/${year}/${padded}`, `INV/${prevYear}/${padded}`, `INV-${padded}`, padded];

    for (const fmt of formats) {
      const res = await byNumber(fmt);
      if (res.invoices?.length) return res.invoices[0];
    }
  }

  // Final fallback: search_text for partial matching
  const search = await client.apiCall<{ invoices?: ServiceInvoice[] }>(
    "GET",
    invoicesUrl({ search_text: trimmed, per_page: "5" })
  );
  if (search.invoices?.length) {
    const match = search.invoices.find(
      (inv) => inv.invoice_number.includes(trimmed) || inv.invoice_number.includes(digits)
    );
    return match || search.invoices[0];
  }

  log.info("invoice number not found", { input: trimmed });
  return null;
}

// Get single invoice details
export async function getInvoice(invoiceId: string) {
  const client = await books();
  const data = await client.getInvoice(invoiceId);
  return data.invoice || null;
}
