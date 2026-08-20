export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse, paginatedResponse, parseSearchParams } from "@/lib/api-utils";
import { customerPaymentSchema } from "@/lib/validations";
import { requireFeature, AuthError } from "@/lib/auth-helpers";

export async function GET(req: NextRequest) {
  try {
    await requireFeature("customers", "view");
    const { page, limit, skip, searchParams } = parseSearchParams(req.url);
    const customerId = searchParams.get("customerId") || undefined;

    const where = {
      ...(customerId && { customerId }),
    };

    const [payments, total] = await Promise.all([
      prisma.customerPayment.findMany({
        where,
        include: {
          customer: { select: { name: true, phone: true } },
          invoice: { select: { invoiceNo: true, amount: true } },
          recordedBy: { select: { name: true } },
        },
        orderBy: { paymentDate: "desc" },
        skip,
        take: limit,
      }),
      prisma.customerPayment.count({ where }),
    ]);

    return paginatedResponse(payments, total, page, limit);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to fetch payments", 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireFeature("customers", "create");
    const body = await req.json();
    const data = customerPaymentSchema.parse(body);

    const result = await prisma.$transaction(async (tx) => {
      // Validate invoice balance if invoiceId provided
      if (data.invoiceId) {
        const invoice = await tx.customerInvoice.findUnique({ where: { id: data.invoiceId } });
        if (!invoice) throw new Error("Invoice not found");
        const remaining = invoice.amount - invoice.paidAmount;
        if (data.amount > remaining) {
          throw new Error(`Payment exceeds invoice balance. Remaining: ${remaining}`);
        }
      }

      // Create payment
      const payment = await tx.customerPayment.create({
        data: {
          customerId: data.customerId,
          invoiceId: data.invoiceId || null,
          amount: data.amount,
          paymentMode: data.paymentMode,
          paymentDate: new Date(data.paymentDate),
          referenceNo: data.referenceNo,
          notes: data.notes,
          recordedById: user.id,
        },
        include: {
          customer: { select: { name: true } },
          invoice: { select: { invoiceNo: true } },
        },
      });

      // Update invoice paidAmount and status
      if (data.invoiceId) {
        const invoice = await tx.customerInvoice.findUnique({ where: { id: data.invoiceId } });
        if (invoice) {
          const newPaidAmount = invoice.paidAmount + data.amount;
          const newStatus = newPaidAmount >= invoice.amount ? "PAID" : "PARTIALLY_PAID";
          await tx.customerInvoice.update({
            where: { id: data.invoiceId },
            data: { paidAmount: newPaidAmount, status: newStatus },
          });
        }
      }

      return payment;
    });

    return successResponse(result, 201);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to record payment", 400);
  }
}
