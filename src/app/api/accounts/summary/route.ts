export const dynamic = "force-dynamic";

import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import type { BillStatus, POStatus, InvoiceStatus } from "@prisma/client";

export async function GET() {
  try {
    await requireFeature("bills", "view");
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const billPendingStatuses: BillStatus[] = ["PENDING", "PARTIALLY_PAID"];
    const poPendingStatuses: POStatus[] = ["DRAFT", "PENDING_APPROVAL", "APPROVED"];
    const invoicePendingStatuses: InvoiceStatus[] = ["PENDING", "PARTIALLY_PAID", "OVERDUE"];

    const [
      totalVendors,
      activeVendors,
      pendingBills,
      overdueBills,
      totalPayable,
      totalPaid30d,
      totalExpenses30d,
      pendingPOs,
      recentPayments,
      overdueBillsList,
      pendingReceivables,
      totalReceivable,
    ] = await Promise.all([
      prisma.vendor.count(),
      prisma.vendor.count({ where: { isActive: true } }),
      prisma.vendorBill.count({ where: { status: { in: billPendingStatuses } } }),
      prisma.vendorBill.count({ where: { dueDate: { lt: now }, status: { in: billPendingStatuses } } }),
      prisma.vendorBill.aggregate({
        where: { status: { in: billPendingStatuses } },
        _sum: { amount: true, paidAmount: true },
      }),
      prisma.vendorPayment.aggregate({
        where: { paymentDate: { gte: thirtyDaysAgo } },
        _sum: { amount: true },
      }),
      prisma.expense.aggregate({
        where: { date: { gte: thirtyDaysAgo } },
        _sum: { amount: true },
      }),
      prisma.purchaseOrder.count({ where: { status: { in: poPendingStatuses } } }),
      prisma.vendorPayment.findMany({
        take: 5,
        orderBy: { paymentDate: "desc" },
        include: { vendor: { select: { name: true } }, bill: { select: { billNo: true } } },
      }),
      prisma.vendorBill.findMany({
        where: { dueDate: { lt: now }, status: { in: billPendingStatuses } },
        take: 5,
        orderBy: { dueDate: "asc" },
        include: { vendor: { select: { name: true } } },
      }),
      prisma.customerInvoice.count({ where: { status: { in: invoicePendingStatuses } } }),
      prisma.customerInvoice.aggregate({
        where: { status: { in: invoicePendingStatuses } },
        _sum: { amount: true, paidAmount: true },
      }),
    ]);

    const outstandingPayable = (totalPayable._sum.amount || 0) - (totalPayable._sum.paidAmount || 0);
    const outstandingReceivable = (totalReceivable._sum.amount || 0) - (totalReceivable._sum.paidAmount || 0);

    return successResponse({
      stats: {
        totalVendors,
        activeVendors,
        pendingBills,
        overdueBills,
        outstandingPayable,
        totalPaid30d: totalPaid30d._sum.amount || 0,
        totalExpenses30d: totalExpenses30d._sum.amount || 0,
        pendingPOs,
        outstandingReceivable,
        pendingReceivables,
      },
      recentPayments,
      overdueBillsList,
    });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to fetch accounts summary", 500);
  }
}
