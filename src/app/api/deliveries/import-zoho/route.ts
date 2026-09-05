export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { getBooks, getZakya, type IntegrationClient } from "@/lib/integrations";
import {
  storeIdForInvoice,
  deliveryFieldsFromInvoiceDetail,
} from "@/lib/deliveries/zoho-invoice";

/*
 * Direct invoice import — fetches invoice details from Zoho and creates Delivery.
 * Skips the full pull pipeline (no preview/approve flow).
 * Used for quick single-invoice search & import.
 */
export async function POST(req: NextRequest) {
  try {
    // zoho.APPROVE, not deliveries.fetch. This route WRITES Delivery rows — importing is not
    // fetching, and gating a write on a read-shaped grant meant anyone who could look could
    // also import. Flipped in the same commit as the button, so relabelling the UI never
    // leaves the old grant working by URL.
    await requireFeature("zoho", "approve");
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

    // Loaded once for prefix attribution (O8), not per invoice.
    const stores = await prisma.store.findMany({ select: { id: true, invoicePrefix: true } });

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

        // THE `BCC/` SKIP IS GONE (O8, owner 4 Sep).
        //
        // This was the third of three routes hardcoding a store NAME to decide what not to
        // import. Bharath Cycle Centre has its own GSTIN and its own stock; hiding its
        // invoices meant its deliveries never existed and its stock never moved. The store is
        // now resolved from Store.invoicePrefix and recorded on the row instead.

        // Check duplicate
        const exists = await prisma.delivery.findFirst({
          where: { invoiceNo },
        });
        if (exists) {
          errors.push(`${invoiceNo}: already imported`);
          continue;
        }

        // One shared mapper with the review-flow import (pull-review/approve), so the two
        // paths cannot drift. They HAD drifted — only this one read the address, area,
        // pincode and salesperson.
        const fields = deliveryFieldsFromInvoiceDetail(inv);

        await prisma.delivery.create({
          data: {
            ...fields,
            invoiceNo,
            storeId: storeIdForInvoice(invoiceNo, stores),
            status: "PENDING",
            lineItems: fields.lineItems.length > 0 ? fields.lineItems : undefined,
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
