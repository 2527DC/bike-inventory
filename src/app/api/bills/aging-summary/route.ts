export const dynamic = "force-dynamic";

import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";

export async function GET() {
  try {
    await requireFeature("bills", "view");

    const now = new Date();

    // Aging buckets for unpaid bills
    const unpaidBills = await prisma.vendorBill.findMany({
      where: { status: { in: ["PENDING", "PARTIALLY_PAID"] } },
      select: { id: true, amount: true, paidAmount: true, dueDate: true, billDate: true, vendorId: true },
    });

    const buckets = { current: { count: 0, amount: 0 }, days30: { count: 0, amount: 0 }, days60: { count: 0, amount: 0 }, days90plus: { count: 0, amount: 0 } };

    for (const bill of unpaidBills) {
      const balance = bill.amount - bill.paidAmount;
      if (balance <= 0) continue;

      const daysOverdue = Math.floor((now.getTime() - new Date(bill.dueDate).getTime()) / (1000 * 60 * 60 * 24));

      if (daysOverdue <= 0) {
        buckets.current.count++;
        buckets.current.amount += balance;
      } else if (daysOverdue <= 30) {
        buckets.days30.count++;
        buckets.days30.amount += balance;
      } else if (daysOverdue <= 60) {
        buckets.days60.count++;
        buckets.days60.amount += balance;
      } else {
        buckets.days90plus.count++;
        buckets.days90plus.amount += balance;
      }
    }

    // CD (Cash Discount) deadline warnings — bills where CD is still claimable
    const vendorsWithCD = await prisma.vendor.findMany({
      where: { cdTermsDays: { not: null }, cdPercentage: { gt: 0 } },
      select: { id: true, name: true, cdTermsDays: true, cdPercentage: true },
    });

    const cdVendorMap = new Map(vendorsWithCD.map((v) => [v.id, v]));
    const cdWarnings: Array<{ billId: string; vendorName: string; cdDeadline: string; cdPercentage: number; balance: number; daysLeft: number }> = [];

    for (const bill of unpaidBills) {
      const vendor = cdVendorMap.get(bill.vendorId);
      if (!vendor || !vendor.cdTermsDays) continue;

      const balance = bill.amount - bill.paidAmount;
      if (balance <= 0) continue;

      const cdDeadline = new Date(bill.billDate);
      cdDeadline.setDate(cdDeadline.getDate() + vendor.cdTermsDays);
      const daysLeft = Math.floor((cdDeadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

      // Show warning if CD is still claimable (within next 7 days or already passed within 3 days)
      if (daysLeft >= -3 && daysLeft <= 7) {
        cdWarnings.push({
          billId: bill.id,
          vendorName: vendor.name,
          cdDeadline: cdDeadline.toISOString(),
          cdPercentage: vendor.cdPercentage!,
          balance,
          daysLeft,
        });
      }
    }

    cdWarnings.sort((a, b) => a.daysLeft - b.daysLeft);

    const totalOutstanding = buckets.current.amount + buckets.days30.amount + buckets.days60.amount + buckets.days90plus.amount;
    const totalCount = buckets.current.count + buckets.days30.count + buckets.days60.count + buckets.days90plus.count;

    return successResponse({
      buckets,
      totalOutstanding,
      totalCount,
      cdWarnings,
    });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to compute aging", 500);
  }
}
