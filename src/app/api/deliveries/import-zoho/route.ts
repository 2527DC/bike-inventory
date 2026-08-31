export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { getBooks, getZakya, type IntegrationClient } from "@/lib/integrations";

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

    // Both sources in parallel — each is a config read and a possible token refresh, and
    // the answers are independent. Request-scoped, so any later step reuses these.
    const [zoho, zakya] = await Promise.all([getBooks(), getZakya()]);

    if (!zoho && !zakya) {
      return errorResponse("No Zoho source connected", 400);
    }

    // Books preferred, Zakya as the fallback. Typed `IntegrationClient` rather than `any`:
    // getInvoice lives on the base class, so both providers satisfy it.
    const client: IntegrationClient = (zoho ?? zakya)!;

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

        // Delivery.invoiceNo is required and is what every later lookup matches on, so an
        // invoice without a number cannot be imported. Previously the client was typed
        // `any`, so `undefined` reached prisma.delivery.create() and failed there with a
        // Prisma error naming a column rather than a sentence naming the invoice.
        const invoiceNo = inv.invoice_number;
        if (!invoiceNo) {
          errors.push(`Invoice ${invoiceId}: Zoho returned no invoice number`);
          continue;
        }

        // Skip BCC (Bharath Cycle Centre) invoices
        if (invoiceNo.startsWith("BCC/")) {
          errors.push(`${invoiceNo}: skipped (Centre invoice)`);
          continue;
        }

        // Check duplicate
        const exists = await prisma.delivery.findFirst({
          where: { invoiceNo },
        });
        if (exists) {
          errors.push(`${invoiceNo}: already imported`);
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
            invoiceNo,
            zohoInvoiceId: inv.invoice_id ?? null,
            // Zoho always sends a date on an invoice, so the fallback is unreachable in
            // practice — it exists because the field is optional on the type, not because
            // a dateless invoice is expected. If one ever appears it files under today,
            // which is visibly wrong rather than silently absent.
            invoiceDate: new Date(inv.date ?? Date.now()),
            invoiceAmount: Number(inv.total || 0),
            customerName: inv.customer_name ?? "Unknown",
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
