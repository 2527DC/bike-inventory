import { serviceGuard } from "@/lib/services/guard";
import { NextRequest, NextResponse } from "next/server";
import {
  searchInvoicesByPhone,
  searchInvoiceByNumber,
} from "@/lib/services/zoho";

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
        return NextResponse.json(
          { error: "Invoice not found" },
          { status: 404 }
        );
      }
      return NextResponse.json({
        invoice: {
          id: invoice.invoice_id,
          number: invoice.invoice_number,
          customerName: invoice.customer_name,
          phone: invoice.phone || invoice.billing_address?.phone,
          date: invoice.date,
          total: invoice.total,
          balance: invoice.balance,
          status: invoice.status,
          isPaid: invoice.status === "paid",
        },
      });
    }

    if (phone) {
      const cleanPhone = phone.replace(/\D/g, "").slice(-10);
      const invoices = await searchInvoicesByPhone(cleanPhone);
      return NextResponse.json({
        invoices: invoices.map(
          (inv: Record<string, unknown> & { billing_address?: { phone?: string } }) => ({
            id: inv.invoice_id,
            number: inv.invoice_number,
            customerName: inv.customer_name,
            phone: inv.phone || inv.billing_address?.phone,
            date: inv.date,
            total: inv.total,
            balance: inv.balance,
            status: inv.status,
            isPaid: inv.status === "paid",
          })
        ),
      });
    }

    return NextResponse.json(
      { error: "Provide phone or invoiceNumber" },
      { status: 400 }
    );
  } catch {
    return NextResponse.json(
      { error: "Failed to fetch from Zoho" },
      { status: 500 }
    );
  }
}
