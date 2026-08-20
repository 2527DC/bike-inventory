export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireFeature("vendors", "view");
    const { id } = await params;

    const vendor = await prisma.vendor.findUnique({
      where: { id },
      select: { id: true, name: true, code: true, openingBalance: true },
    });
    if (!vendor) return errorResponse("Vendor not found", 404);

    // Fetch bills and payments, sorted by date
    const [bills, payments] = await Promise.all([
      prisma.vendorBill.findMany({
        where: { vendorId: id },
        orderBy: { billDate: "desc" },
        take: 50,
        select: {
          id: true, billNo: true, billDate: true, amount: true,
          paidAmount: true, status: true, dueDate: true,
        },
      }),
      prisma.vendorPayment.findMany({
        where: { vendorId: id },
        orderBy: { paymentDate: "desc" },
        take: 50,
        select: {
          id: true, amount: true, paymentDate: true, paymentMode: true,
          referenceNo: true, notes: true, cdDiscountAmount: true,
          bill: { select: { billNo: true } },
        },
      }),
    ]);

    // Merge into a single timeline sorted by date desc
    type LedgerEntry = {
      id: string;
      date: string;
      type: "BILL" | "PAYMENT";
      description: string;
      debit: number;  // bill amount (what we owe)
      credit: number; // payment amount (what we paid)
      reference: string;
      status?: string;
    };

    const entries: LedgerEntry[] = [];

    for (const bill of bills) {
      entries.push({
        id: bill.id,
        date: bill.billDate.toISOString(),
        type: "BILL",
        description: `Bill ${bill.billNo}`,
        debit: bill.amount,
        credit: 0,
        reference: bill.billNo,
        status: bill.status,
      });
    }

    for (const payment of payments) {
      entries.push({
        id: payment.id,
        date: payment.paymentDate.toISOString(),
        type: "PAYMENT",
        description: `Payment${payment.bill ? ` for ${payment.bill.billNo}` : ""} via ${payment.paymentMode}`,
        debit: 0,
        credit: payment.amount + payment.cdDiscountAmount,
        reference: payment.referenceNo || payment.paymentMode,
      });
    }

    // Sort by date ascending (chronological from opening balance)
    entries.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    // Calculate running balance (from opening balance forward)
    let runningBalance = vendor.openingBalance;
    const withBalance = entries.map((entry) => {
      runningBalance += entry.debit - entry.credit;
      return { ...entry, balance: runningBalance };
    });

    // Summary
    const totalBills = bills.reduce((s, b) => s + b.amount, 0);
    const totalPayments = payments.reduce((s, p) => s + p.amount + p.cdDiscountAmount, 0);
    const currentBalance = vendor.openingBalance + totalBills - totalPayments;

    return successResponse({
      vendor: { id: vendor.id, name: vendor.name, code: vendor.code },
      openingBalance: vendor.openingBalance,
      totalBills,
      totalPayments,
      currentBalance,
      entries: withBalance.slice(0, 20),
      totalEntries: withBalance.length,
    });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to fetch ledger", 500);
  }
}
