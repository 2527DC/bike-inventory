export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireFeature("bills", "view");
    const { id } = await params;
    const bill = await prisma.vendorBill.findUnique({
      where: { id },
      include: {
        vendor: true,
        purchaseOrder: { include: { items: { include: { product: { select: { name: true, sku: true } } } } } },
        payments: { orderBy: { paymentDate: "desc" } },
      },
    });

    if (!bill) return errorResponse("Bill not found", 404);

    // Calculate vendor outstanding balance
    const [vendorBills, vendorPayments] = await Promise.all([
      prisma.vendorBill.aggregate({ where: { vendorId: bill.vendorId }, _sum: { amount: true } }),
      prisma.vendorPayment.aggregate({ where: { vendorId: bill.vendorId }, _sum: { amount: true, cdDiscountAmount: true } }),
    ]);
    const vendorBalance = (bill.vendor.openingBalance || 0)
      + (vendorBills._sum.amount || 0)
      - (vendorPayments._sum.amount || 0)
      - (vendorPayments._sum.cdDiscountAmount || 0);

    return successResponse({ ...bill, vendorBalance });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to fetch bill", 500);
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireFeature("bills", "edit");
    const { id } = await params;
    const body = await req.json();

    const VALID_BILL_STATUS = ["PENDING", "PARTIALLY_PAID", "PAID", "OVERDUE", "DISPUTED"];
    if (body.status && !VALID_BILL_STATUS.includes(body.status)) {
      return errorResponse("Invalid bill status", 400);
    }

    const bill = await prisma.vendorBill.update({
      where: { id },
      data: {
        ...(body.status && { status: body.status }),
        ...(body.notes !== undefined && { notes: body.notes }),
      },
      include: { vendor: { select: { name: true } } },
    });

    return successResponse(bill);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to update bill", 400);
  }
}
