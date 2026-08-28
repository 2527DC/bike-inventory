export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { BooksClient, ZakyaClient } from "@/lib/integrations";

/*
 * Direct invoice import — fetches invoice details from Zoho and creates Delivery.
 * Skips the full pull pipeline (no preview/approve flow).
 * Used for quick single-invoice search & import.
 */
export async function POST(req: NextRequest) {
  try {
    await requireFeature("deliveries", "fetch");
    const { invoiceIds } = (await req.json()) as { invoiceIds: string[] };

    if (!invoiceIds || invoiceIds.length === 0) {
      return errorResponse("No invoice IDs provided", 400);
    }

    // Init clients
    const zoho = new BooksClient();
    const booksReady = await zoho.init();
    const zakya = new ZakyaClient();
    const posReady = await zakya.init();

    if (!booksReady && !posReady) {
      return errorResponse("No Zoho source connected", 400);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client: any = booksReady ? zoho : zakya;

    let imported = 0;
    const errors: string[] = [];

    for (const invoiceId of invoiceIds) {
      try {
        // Get invoice detail with line items
        const detail = await client.getInvoice(invoiceId);
        const inv = detail.invoice;

        if (!inv) {
          errors.push(`Invoice ${invoiceId}: not found`);
          continue;
        }

        // Skip BCC (Bharath Cycle Centre) invoices
        if (inv.invoice_number?.startsWith("BCC/")) {
          errors.push(`${inv.invoice_number}: skipped (Centre invoice)`);
          continue;
        }

        // Check duplicate
        const exists = await prisma.delivery.findFirst({
          where: { invoiceNo: inv.invoice_number },
        });
        if (exists) {
          errors.push(`${inv.invoice_number}: already imported`);
          continue;
        }

        // Map line items
        const lineItems = (inv.line_items || []).map(
          (li: { name: string; sku?: string; quantity: number; rate: number; item_total: number }) => ({
            name: li.name,
            sku: li.sku || "",
            quantity: li.quantity,
            rate: li.rate,
            itemTotal: li.item_total,
          })
        );

        // Extract phone from billing/shipping address or customer
        const phone =
          inv.contact_persons?.[0]?.phone ||
          inv.billing_address?.phone ||
          inv.shipping_address?.phone ||
          "";

        const customerAddress = [
          inv.shipping_address?.address,
          inv.shipping_address?.street2,
          inv.shipping_address?.city,
          inv.shipping_address?.state,
        ]
          .filter(Boolean)
          .join(", ");

        await prisma.delivery.create({
          data: {
            invoiceNo: inv.invoice_number,
            zohoInvoiceId: inv.invoice_id,
            invoiceDate: new Date(inv.date),
            invoiceAmount: Number(inv.total || 0),
            customerName: inv.customer_name,
            customerPhone: phone || null,
            customerAddress: customerAddress || null,
            customerArea: inv.shipping_address?.city || null,
            customerPincode: inv.shipping_address?.zip || null,
            salesPerson: inv.salesperson_name || "",
            status: "PENDING",
            lineItems: lineItems.length > 0 ? lineItems : undefined,
          },
        });
        imported++;
      } catch (e) {
        errors.push(`${invoiceId}: ${e instanceof Error ? e.message : "Failed"}`);
      }
    }

    return successResponse({ imported, errors, total: invoiceIds.length });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Import failed", 500);
  }
}
