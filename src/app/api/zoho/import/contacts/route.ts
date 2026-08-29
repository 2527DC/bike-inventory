export const dynamic = "force-dynamic";

import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError, getCurrentUser } from "@/lib/auth-helpers";
import { BooksClient } from "@/lib/integrations";

export async function POST() {
  try {
    await requireFeature("zoho", "fetch");
    const currentUser = await getCurrentUser();

    const zoho = new BooksClient();
    const ready = await zoho.init();
    if (!ready) return errorResponse("Zoho not connected", 400);

    const log = await prisma.syncLog.create({
      data: { syncType: "import-contacts", status: "running", triggeredBy: currentUser?.id },
    });

    const allContacts = await zoho.listAllContacts();
    const vendors = allContacts.filter((c) => c.contact_type === "vendor");

    let imported = 0;
    let skipped = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const contact of vendors) {
      try {
        // Check if vendor already exists by name
        const existing = await prisma.vendor.findFirst({
          where: { name: { equals: contact.contact_name, mode: "insensitive" } },
        });

        if (existing) {
          skipped++;
          continue;
        }

        // Generate a unique code from name
        const code = contact.contact_name
          .replace(/[^a-zA-Z0-9]/g, "")
          .substring(0, 6)
          .toUpperCase() + String(Date.now()).slice(-4);

        await prisma.vendor.create({
          data: {
            name: contact.contact_name,
            code,
            gstin: contact.gst_no || null,
            email: contact.email || null,
            phone: contact.phone || null,
            city: contact.billing_address?.city || null,
            state: contact.billing_address?.state || null,
          },
        });
        imported++;
      } catch (err) {
        failed++;
        errors.push(`${contact.contact_name}: ${err instanceof Error ? err.message : "Unknown error"}`);
      }
    }

    const status = failed === 0 ? "success" : imported === 0 ? "failed" : "partial";

    await prisma.syncLog.update({
      where: { id: log.id },
      data: {
        status,
        totalItems: vendors.length,
        synced: imported,
        failed,
        errors: errors.length > 0 ? JSON.stringify(errors) : null,
        completedAt: new Date(),
      },
    });

    return successResponse({
      syncType: "import-contacts",
      status,
      total: vendors.length,
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
