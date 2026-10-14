export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { getBooks, getZakya } from "@/lib/integrations";
import { zohoInvoiceLookupSchema } from "@/lib/validations";
import { createLogger } from "@/lib/logger";

const log = createLogger("deliveries:search-zoho");

/*
 * Lightweight invoice search — single Zoho API call, no pull pipeline.
 * Supports: invoice number (e.g. "017616") or phone number (e.g. "9880770366")
 * Returns matching invoices directly, creates pull previews for import.
 */
export async function POST(req: NextRequest) {
  try {
    const parsed = zohoInvoiceLookupSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return errorResponse(parsed.error.issues[0]?.message ?? "Invalid search", 400);
    }
    const { module: moduleKey, query: searchTerm } = parsed.data;

    // The ASKING SCREEN's Fetch tick (plan 1410-per-module-fetch-permissions, D1):
    // `deliveries` for /deliveries and /prebookings, `second_hand` for /second-hand/new — the
    // same tick each screen's lookup button checks. This was `zoho.fetch` for all three
    // (Option B); the button-vs-route mismatch that motivated that is avoided by checking the
    // one key both sides share, not by sharing one key across screens.
    await requireFeature(moduleKey, "fetch");

    // Try Zakya POS first, fallback to Books. Fetched in parallel: independent answers,
    // and both are request-scoped so nothing is initialised twice.
    //
    // The branches below test the CLIENTS, not a pair of `ready` booleans. A boolean cannot
    // narrow a nullable object for TypeScript, so `if (booksReady) zoho.listInvoices(...)`
    // would need a non-null assertion at every call — testing the object itself makes the
    // compiler do that work instead.
    const [zakya, zoho] = await Promise.all([getZakya(), getBooks()]);

    if (!zakya && !zoho) {
      log.warn("invoice lookup refused — no Zoho source connected", { module: moduleKey });
      return errorResponse("No Zoho source connected", 400);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let invoices: any[] = [];
    let source = "none";

    // Zoho Books search_text supports invoice number and customer name
    // For phone search, we use customer_phone parameter
    const isPhone = /^\d{10,}$/.test(searchTerm);

    if (zoho) {
      source = "books";
      if (isPhone) {
        // Search by phone — use contact search first, then get invoices
        const data = await zoho.listInvoices(1, undefined, undefined, searchTerm);
        invoices = data.invoices || [];
        // If no results with search_text, try as customer phone
        if (invoices.length === 0) {
          const contactData = await zoho.listInvoices(1);
          // Filter client-side by phone
          invoices = (contactData.invoices || []).filter(
            (inv: { phone?: string }) => inv.phone && inv.phone.includes(searchTerm)
          );
        }
      } else {
        // Search by invoice number — Zoho's search_text matches invoice_number
        // Zoho Books format: INV/25/017616 — search with the number part works
        const data = await zoho.listInvoices(1, undefined, undefined, searchTerm);
        invoices = data.invoices || [];
      }
    } else if (zakya) {
      source = "pos";
      // Zakya doesn't support search_text, so fetch recent and filter
      const today = new Date().toISOString().slice(0, 10);
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const data = await zakya.listInvoices(1, thirtyDaysAgo, today);
      invoices = (data.invoices || []).filter(
        (inv: { invoice_number: string; customer_name: string; phone?: string }) =>
          inv.invoice_number.includes(searchTerm) ||
          inv.customer_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
          (isPhone && inv.phone && inv.phone.includes(searchTerm))
      );
    }

    // Void only. The `!inv.invoice_number.startsWith("BCC/")` that used to sit here is GONE
    // (O8, owner 4 Sep) — the last of three routes hardcoding a store NAME to decide what to
    // hide. Searching for a Bharath Cycle Centre invoice returned "not found", which is how a
    // whole store with its own GSTIN stayed invisible. Its invoices are searchable and
    // importable now; import tags each with the FLOOR warehouse whose Warehouse.invoicePrefix
    // it matches, or leaves it a Dummy when none does (plan 1609-deliveries, T1, A41b).
    invoices = invoices.filter((inv: { status: string }) => inv.status !== "void");

    // Check which are already imported
    const invoiceNumbers = invoices.map((inv: { invoice_number: string }) => inv.invoice_number);
    const existing = await prisma.delivery.findMany({
      where: { invoiceNo: { in: invoiceNumbers } },
      select: { invoiceNo: true, status: true },
    });
    const existingMap = new Map(existing.map((d) => [d.invoiceNo, d.status]));

    // Build results with import status
    const results = invoices.map((inv: {
      invoice_id: string; invoice_number: string; customer_name: string;
      phone?: string; date: string; total: number; balance: number; status: string;
    }) => ({
      invoiceId: inv.invoice_id,
      invoiceNumber: inv.invoice_number,
      customerName: inv.customer_name,
      phone: inv.phone || "",
      date: inv.date,
      total: inv.total,
      balance: inv.balance,
      status: inv.status,
      alreadyImported: existingMap.has(inv.invoice_number),
      appStatus: existingMap.get(inv.invoice_number) || null,
    }));

    log.debug("invoice lookup", { module: moduleKey, source, found: results.length, isPhone });
    return successResponse({ results, source, total: results.length });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    log.error("invoice lookup failed", { message: error instanceof Error ? error.message : String(error) });
    return errorResponse(error instanceof Error ? error.message : "Search failed", 500);
  }
}
