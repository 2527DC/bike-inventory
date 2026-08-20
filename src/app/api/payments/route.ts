export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse, paginatedResponse, parseSearchParams } from "@/lib/api-utils";
import { vendorPaymentSchema } from "@/lib/validations";
import { requireFeature, AuthError } from "@/lib/auth-helpers";

export async function GET(req: NextRequest) {
  try {
    await requireFeature("bills", "view");
    const { page, limit, skip, searchParams } = parseSearchParams(req.url);
    const vendorId = searchParams.get("vendorId") || undefined;

    const where = {
      ...(vendorId && { vendorId }),
    };

    const [payments, total] = await Promise.all([
      prisma.vendorPayment.findMany({
        where,
        include: {
          vendor: { select: { name: true, code: true } },
          bill: { select: { billNo: true, amount: true } },
          recordedBy: { select: { name: true } },
        },
        orderBy: { paymentDate: "desc" },
        skip,
        take: limit,
      }),
      prisma.vendorPayment.count({ where }),
    ]);

    return paginatedResponse(payments, total, page, limit);
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "Failed to fetch payments", 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireFeature("bills", "create");
    const body = await req.json();
    const data = vendorPaymentSchema.parse(body);

    // Determine allocations: multi-bill or single-bill
    const allocations = data.billAllocations && data.billAllocations.length > 0
      ? data.billAllocations
      : data.billId
        ? [{ billId: data.billId, amount: data.amount }]
        : [];

    if (allocations.length === 0 && !data.creditId) {
      return errorResponse("Payment must be linked to at least one bill or credit note", 400);
    }

    const result = await prisma.$transaction(async (tx) => {
      const cdDiscount = data.cdDiscountAmount || 0;

      // Validate all bill balances BEFORE creating payments
      for (const alloc of allocations) {
        const bill = await tx.vendorBill.findUnique({ where: { id: alloc.billId } });
        if (!bill) throw new Error(`Bill not found: ${alloc.billId}`);
        const remaining = bill.amount - bill.paidAmount;
        if (alloc.amount > remaining + 0.01) {
          throw new Error(`Payment ₹${alloc.amount} exceeds bill ${bill.billNo} remaining ₹${remaining}`);
        }
      }

      // Validate credit balance BEFORE creating payment
      if (data.creditId) {
        const credit = await tx.vendorCredit.findUnique({ where: { id: data.creditId } });
        if (!credit) throw new Error("Credit not found");
        const creditRemaining = credit.amount - credit.usedAmount;
        if (data.amount > creditRemaining) {
          throw new Error(`Exceeds credit balance. Available: ${creditRemaining}`);
        }
      }

      // Create payment records (one per bill allocation, or one advance payment)
      const payments = [];
      if (allocations.length > 0) {
        for (const alloc of allocations) {
          const payment = await tx.vendorPayment.create({
            data: {
              vendorId: data.vendorId,
              billId: alloc.billId,
              amount: alloc.amount,
              cdDiscountAmount: allocations.length === 1 ? cdDiscount : 0,
              paymentMode: data.paymentMode,
              paymentDate: new Date(data.paymentDate),
              referenceNo: data.referenceNo,
              creditId: data.creditId || null,
              notes: allocations.length > 1
                ? `${data.notes || ""} [Multi-bill payment: ₹${data.amount}]`.trim()
                : data.notes,
              recordedById: user.id,
            },
            include: { vendor: { select: { name: true } }, bill: { select: { billNo: true } } },
          });
          payments.push(payment);

          // Update bill status
          const bill = await tx.vendorBill.findUnique({ where: { id: alloc.billId } });
          if (bill) {
            const allocCd = allocations.length === 1 ? cdDiscount : 0;
            const newPaidAmount = bill.paidAmount + alloc.amount + allocCd;
            const newStatus = newPaidAmount >= bill.amount ? "PAID" : "PARTIALLY_PAID";
            await tx.vendorBill.update({
              where: { id: alloc.billId },
              data: { paidAmount: newPaidAmount, status: newStatus },
            });
          }
        }
      } else {
        // Advance payment (no bill)
        const payment = await tx.vendorPayment.create({
          data: {
            vendorId: data.vendorId,
            billId: null,
            amount: data.amount,
            cdDiscountAmount: cdDiscount,
            paymentMode: data.paymentMode,
            paymentDate: new Date(data.paymentDate),
            referenceNo: data.referenceNo,
            creditId: data.creditId || null,
            notes: data.notes,
            recordedById: user.id,
          },
          include: { vendor: { select: { name: true } }, bill: { select: { billNo: true } } },
        });
        payments.push(payment);
      }

      // Update credit usage
      if (data.creditId) {
        const credit = await tx.vendorCredit.findUnique({ where: { id: data.creditId } });
        if (credit) {
          await tx.vendorCredit.update({
            where: { id: data.creditId },
            data: { usedAmount: credit.usedAmount + data.amount },
          });
        }
      }

      return payments.length === 1 ? payments[0] : { payments, count: payments.length };
    });

    return successResponse(result, 201);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to record payment", 400);
  }
}
