export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";

// POST — backfill salesPerson + lineItems for existing deliveries (paginated)
// Body: { page?: number, batchSize?: number, dryRun?: boolean }
export async function POST(req: NextRequest) {
  try {
    await requireFeature("deliveries", "create");
    const body = await req.json().catch(() => ({}));
    const batchSize = Math.min(Number(body.batchSize) || 10, 20); // max 20 per call
    const skip = (Math.max(Number(body.page) || 1, 1) - 1) * batchSize;
    const dryRun = body.dryRun === true;

    // Find deliveries missing salesPerson that have a zohoInvoiceId
    const deliveries = await prisma.delivery.findMany({
      where: {
        zohoInvoiceId: { not: null },
        salesPerson: null,
      },
      select: { id: true, invoiceNo: true, zohoInvoiceId: true },
      orderBy: { createdAt: "desc" },
      skip,
      take: batchSize,
    });

    const totalRemaining = await prisma.delivery.count({
      where: { zohoInvoiceId: { not: null }, salesPerson: null },
    });

    if (deliveries.length === 0) {
      return successResponse({ message: "No deliveries to backfill", remaining: 0 });
    }

    if (dryRun) {
      return successResponse({
        dryRun: true,
        batch: deliveries.length,
        remaining: totalRemaining,
        ids: deliveries.map((d) => d.invoiceNo),
      });
    }

    // Init Zoho
    let zohoClient;
    try {
      const { ZohoClient } = await import("@/lib/zoho");
      zohoClient = new ZohoClient();
      if (!(await zohoClient.init())) {
        return errorResponse("Zoho not connected", 400);
      }
    } catch {
      return errorResponse("Zoho not configured", 400);
    }

    let updated = 0;
    const errors: string[] = [];

    for (const del of deliveries) {
      try {
        const detail = await zohoClient.getInvoice(del.zohoInvoiceId!);
        const inv = detail.invoice;
        if (!inv) {
          errors.push(`${del.invoiceNo}: no invoice data`);
          continue;
        }

        const lineItems = (inv.line_items || []).map(
          (li: { name?: string; sku?: string; item_id?: string; quantity?: number; rate?: number; item_total?: number }) => ({
            name: li.name || "",
            sku: li.sku || li.item_id || "",
            quantity: li.quantity || 1,
            rate: li.rate || 0,
            itemTotal: li.item_total || 0,
          }),
        );
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const salesPerson = (inv as any).salesperson_name || null;

        await prisma.delivery.update({
          where: { id: del.id },
          data: {
            ...(lineItems.length > 0 ? { lineItems } : {}),
            ...(salesPerson ? { salesPerson } : {}),
          },
        });
        updated++;
      } catch (e) {
        errors.push(`${del.invoiceNo}: ${e instanceof Error ? e.message : "Failed"}`);
      }
    }

    return successResponse({
      batch: deliveries.length,
      updated,
      errors: errors.length > 0 ? errors : undefined,
      remaining: totalRemaining - updated,
    });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Backfill failed", 500);
  }
}
