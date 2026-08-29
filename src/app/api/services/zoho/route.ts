import { serviceGuard } from "@/lib/services/guard";
import { NextRequest, NextResponse } from "next/server";
import { searchInvoicesByPhone, searchInvoiceByNumber } from "@/lib/services/zoho";
import { createLogger } from "@/lib/logger";

const log = createLogger("services:zoho:route");

/** Shared mapper — both branches returned the same nine fields, spelled out twice. */
function toClientInvoice(inv: {
  invoice_id: string;
  invoice_number: string;
  customer_name: string;
  phone?: string;
  billing_address?: { phone?: string };
  date: string;
  total: number;
  balance: number;
  status: string;
}) {
  return {
    id: inv.invoice_id,
    number: inv.invoice_number,
    customerName: inv.customer_name,
    phone: inv.phone || inv.billing_address?.phone,
    date: inv.date,
    total: inv.total,
    balance: inv.balance,
    status: inv.status,
    isPaid: inv.status === "paid",
  };
}

// GET — search Zoho invoices by phone or invoice number
export async function GET(req: NextRequest) {
  const { error: authError } = await serviceGuard("zoho", "fetch");
  if (authError) return authError;

  const phone = req.nextUrl.searchParams.get("phone");
  const invoiceNumber = req.nextUrl.searchParams.get("invoiceNumber");

  try {
    if (invoiceNumber) {
      const invoice = await searchInvoiceByNumber(invoiceNumber);
      if (!invoice) {
        return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
      }
      return NextResponse.json({ invoice: toClientInvoice(invoice) });
    }

    if (phone) {
      const cleanPhone = phone.replace(/\D/g, "").slice(-10);
      const invoices = await searchInvoicesByPhone(cleanPhone);
      return NextResponse.json({ invoices: invoices.map(toClientInvoice) });
    }

    return NextResponse.json({ error: "Provide phone or invoiceNumber" }, { status: 400 });
  } catch (e) {
    // A bare `catch {}` used to swallow this whole branch, so "Books was never connected"
    // and "Zoho returned a 500" were indistinguishable in the log and on screen.
    const message = e instanceof Error ? e.message : "Unknown error";
    const notConnected = message.includes("not connected");

    log.error("invoice lookup failed", {
      by: invoiceNumber ? "invoiceNumber" : "phone",
      notConnected,
      message,
    });

    return notConnected
      ? NextResponse.json({ error: message }, { status: 503 })
      : NextResponse.json({ error: "Failed to fetch from Zoho" }, { status: 500 });
  }
}
