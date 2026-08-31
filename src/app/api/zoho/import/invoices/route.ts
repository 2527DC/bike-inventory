export const dynamic = "force-dynamic";

import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError, getCurrentUser } from "@/lib/auth-helpers";
import { getBooks } from "@/lib/integrations";

// Import invoices from Zoho as outward transactions for verification
export async function POST() {
  try {
    await requireFeature("zoho", "fetch");
    const currentUser = await getCurrentUser();

    const zoho = await getBooks();
    if (!zoho) return errorResponse("Zoho not connected", 400);

    const log = await prisma.syncLog.create({
      data: { syncType: "import-invoices", status: "running", triggeredBy: currentUser?.id },
    });

    // Pull invoices from April 1, 2026 (new FY)
    const invoices = await zoho.listAllInvoices("2026-04-01");

    let imported = 0;
    let skipped = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const inv of invoices) {
      try {
        // Check if already imported by reference number
        const existing = await prisma.inventoryTransaction.findFirst({
          where: { referenceNo: inv.invoice_number, type: "OUTWARD" },
        });
        if (existing) {
          skipped++;
          continue;
        }

        // Get invoice details with line items
        const detail = await zoho.getInvoice(inv.invoice_id);
        // `invoice` is optional on the shared type: Zoho answers 200 with no invoice body
        // when the id is unknown. Reading through it unguarded threw a TypeError that read
        // as a code bug rather than a missing record.
        const lineItems = detail.invoice?.line_items || [];

        for (const line of lineItems) {
          // Find product by SKU
          const product = line.sku
            ? await prisma.product.findFirst({ where: { sku: line.sku } })
            : await prisma.product.findFirst({ where: { name: { contains: line.name, mode: "insensitive" } } });

          if (!product) {
            errors.push(`${inv.invoice_number}: Product "${line.name}" (SKU: ${line.sku || "N/A"}) not found`);
            continue;
          }

          // Create outward transaction (unverified — Ranjitha will verify)
          await prisma.inventoryTransaction.create({
            data: {
              type: "OUTWARD",
              productId: product.id,
              quantity: line.quantity,
              previousStock: product.currentStock,
              newStock: product.currentStock, // Stock NOT deducted until verified
              referenceNo: inv.invoice_number,
              notes: `[ZOHO] [UNVERIFIED] Customer: ${inv.customer_name} | Invoice: ${inv.invoice_number} | Date: ${inv.date}`,
              userId: currentUser!.id,
            },
          });
          imported++;
        }
      } catch (err) {
        failed++;
        errors.push(`${inv.invoice_number}: ${err instanceof Error ? err.message : "Unknown error"}`);
      }
    }

    const status = failed === 0 && errors.length === 0 ? "success" : imported === 0 ? "failed" : "partial";

    await prisma.syncLog.update({
      where: { id: log.id },
      data: {
        status,
        totalItems: invoices.length,
        synced: imported,
        failed,
        errors: errors.length > 0 ? JSON.stringify(errors) : null,
        completedAt: new Date(),
      },
    });

    return successResponse({
      syncType: "import-invoices",
      status,
      total: invoices.length,
      imported,
      skipped,
      failed,
      errors,
    });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Import failed", 500);
  }
}
