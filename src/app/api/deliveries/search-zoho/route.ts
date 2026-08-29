export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { BooksClient, ZakyaClient } from "@/lib/integrations";

/*
 * Lightweight invoice search — single Zoho API call, no pull pipeline.
 * Supports: invoice number (e.g. "017616") or phone number (e.g. "9880770366")
 * Returns matching invoices directly, creates pull previews for import.
 */
export async function POST(req: NextRequest) {
  try {
    await requireFeature("deliveries", "fetch");
    const { query } = (await req.json()) as { query: string };

    if (!query || query.trim().length < 3) {
      return errorResponse("Search query must be at least 3 characters", 400);
    }

    const searchTerm = query.trim();

    // Try Zakya POS first, fallback to Books
    const zakya = new ZakyaClient();
    const posReady = await zakya.init();
    const zoho = new BooksClient();
    const booksReady = await zoho.init();

    if (!posReady && !booksReady) {
      return errorResponse("No Zoho source connected", 400);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let invoices: any[] = [];
    let source = "none";

    // Zoho Books search_text supports invoice number and customer name
    // For phone search, we use customer_phone parameter
    const isPhone = /^\d{10,}$/.test(searchTerm);

    if (booksReady) {
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
    } else if (posReady) {
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

    // Filter out void invoices and BCC (Bharath Cycle Centre) invoices
    invoices = invoices.filter((inv: { status: string; invoice_number: string }) =>
      inv.status !== "void" && !inv.invoice_number.startsWith("BCC/")
    );

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

    return successResponse({ results, source, total: results.length });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Search failed", 500);
  }
}
