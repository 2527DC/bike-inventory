export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";

export async function GET(req: NextRequest) {
  try {
    await requireFeature("reports", "view");
    const { searchParams } = new URL(req.url);

    const dateStr = searchParams.get("date") || new Date().toISOString().split("T")[0];
    const dayStart = new Date(dateStr + "T00:00:00.000Z");
    const dayEnd = new Date(dateStr + "T23:59:59.999Z");

    const [inwardTxns, outwardTxns, payments, expenses, transfers, recentTxns] = await Promise.all([
      prisma.inventoryTransaction.aggregate({
        where: { type: "INWARD", createdAt: { gte: dayStart, lte: dayEnd } },
        _count: true,
        _sum: { quantity: true },
      }),
      prisma.inventoryTransaction.aggregate({
        where: { type: "OUTWARD", createdAt: { gte: dayStart, lte: dayEnd } },
        _count: true,
        _sum: { quantity: true },
      }),
      prisma.vendorPayment.aggregate({
        where: { paymentDate: { gte: dayStart, lte: dayEnd } },
        _count: true,
        _sum: { amount: true },
      }),
      prisma.expense.aggregate({
        where: { date: { gte: dayStart, lte: dayEnd } },
        _count: true,
        _sum: { amount: true },
      }),
      // All three POST-APPROVAL statuses, not APPROVED alone.
      //
      // Before P14, APPROVED was where an agreed transfer STAYED — so counting it was the same
      // as counting the day’s transfers. Now the flow continues through IN_TRANSIT to RECEIVED,
      // usually within the same day, and an order that has been dispatched would have dropped
      // straight out of this count. The card on /reports/daily would have fallen toward zero on
      // a normal working day and then hidden itself, which reads as "no transfers happened"
      // rather than "this query is stale".
      //
      // Still keyed on reviewedAt: the question is "what was agreed today", and that timestamp
      // is the moment of agreement whatever happened to the goods afterwards.
      prisma.transferOrder.count({
        where: {
          status: { in: ["APPROVED", "IN_TRANSIT", "RECEIVED"] },
          reviewedAt: { gte: dayStart, lte: dayEnd },
        },
      }),
      prisma.inventoryTransaction.findMany({
        where: { createdAt: { gte: dayStart, lte: dayEnd } },
        include: {
          product: { select: { name: true, sku: true } },
          user: { select: { name: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 10,
      }),
    ]);

    return successResponse({
      date: dateStr,
      inwards: { count: inwardTxns._count, totalQty: inwardTxns._sum.quantity || 0 },
      outwards: { count: outwardTxns._count, totalQty: outwardTxns._sum.quantity || 0 },
      payments: { count: payments._count, totalAmount: payments._sum.amount || 0 },
      expenses: { count: expenses._count, totalAmount: expenses._sum.amount || 0 },
      transfers,
      recentTransactions: recentTxns,
    });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to fetch daily report", 500);
  }
}
