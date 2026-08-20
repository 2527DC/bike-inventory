export const dynamic = "force-dynamic";

import { prisma } from "@/lib/db";
import { ZohoClient } from "@/lib/zoho";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError, getCurrentUser } from "@/lib/auth-helpers";

export async function POST() {
  try {
    await requireFeature("zoho", "fetch");
    const currentUser = await getCurrentUser();

    const zoho = new ZohoClient();
    const ready = await zoho.init();
    if (!ready) return errorResponse("Zoho not connected", 400);

    const log = await prisma.syncLog.create({
      data: { syncType: "import-bills", status: "running", triggeredBy: currentUser?.id },
    });

    const bills = await zoho.listAllBills();

    let imported = 0;
    let skipped = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const bill of bills) {
      try {
        // Check if bill already exists by bill number
        const existing = await prisma.vendorBill.findFirst({
          where: { billNo: bill.bill_number },
        });
        if (existing) {
          skipped++;
          continue;
        }

        // Find or skip vendor
        const vendor = await prisma.vendor.findFirst({
          where: { name: { equals: bill.vendor_name, mode: "insensitive" } },
        });

        if (!vendor) {
          skipped++;
          errors.push(`${bill.bill_number}: Vendor "${bill.vendor_name}" not found in app — import vendors first`);
          continue;
        }

        const paidAmount = bill.total - bill.balance;
        let billStatus: "PENDING" | "PARTIALLY_PAID" | "PAID" = "PENDING";
        if (bill.balance <= 0) billStatus = "PAID";
        else if (paidAmount > 0) billStatus = "PARTIALLY_PAID";

        await prisma.vendorBill.create({
          data: {
            vendorId: vendor.id,
            billNo: bill.bill_number,
            billDate: new Date(bill.date),
            dueDate: new Date(bill.due_date),
            amount: bill.total,
            paidAmount,
            status: billStatus,
          },
        });
        imported++;
      } catch (err) {
        failed++;
        errors.push(`${bill.bill_number}: ${err instanceof Error ? err.message : "Unknown error"}`);
      }
    }

    const status = failed === 0 && errors.length === 0 ? "success" : imported === 0 ? "failed" : "partial";

    await prisma.syncLog.update({
      where: { id: log.id },
      data: {
        status,
        totalItems: bills.length,
        synced: imported,
        failed,
        errors: errors.length > 0 ? JSON.stringify(errors) : null,
        completedAt: new Date(),
      },
    });

    return successResponse({
      syncType: "import-bills",
      status,
      total: bills.length,
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
