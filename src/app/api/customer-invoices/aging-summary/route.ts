export const dynamic = "force-dynamic";

import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";

export async function GET() {
  try {
    await requireFeature("customers", "view");

    const now = new Date();
    const unpaidInvoices = await prisma.customerInvoice.findMany({
      where: { status: { in: ["PENDING", "PARTIALLY_PAID"] } },
      select: { amount: true, paidAmount: true, dueDate: true, invoiceDate: true },
    });

    const buckets = { current: { count: 0, amount: 0 }, days30: { count: 0, amount: 0 }, days60: { count: 0, amount: 0 }, days90plus: { count: 0, amount: 0 } };

    for (const inv of unpaidInvoices) {
      const balance = inv.amount - inv.paidAmount;
      if (balance <= 0) continue;

      const daysOverdue = Math.floor((now.getTime() - new Date(inv.dueDate).getTime()) / (1000 * 60 * 60 * 24));

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

    const totalOutstanding = buckets.current.amount + buckets.days30.amount + buckets.days60.amount + buckets.days90plus.amount;
    const totalCount = buckets.current.count + buckets.days30.count + buckets.days60.count + buckets.days90plus.count;

    return successResponse({
      buckets,
      totalOutstanding,
      totalCount,
    });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to compute aging", 500);
  }
}
