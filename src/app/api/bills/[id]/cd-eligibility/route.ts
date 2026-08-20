export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireFeature("bills", "view");
    const { id } = await params;

    const bill = await prisma.vendorBill.findUnique({
      where: { id },
      include: {
        vendor: {
          select: {
            id: true,
            name: true,
            cdTermsDays: true,
            cdPercentage: true,
          },
        },
      },
    });

    if (!bill) return errorResponse("Bill not found", 404);

    const vendor = bill.vendor;

    // Check if vendor has CD terms configured
    if (!vendor.cdTermsDays || !vendor.cdPercentage) {
      return successResponse({
        eligible: false,
        reason: "No CD terms configured",
        billId: bill.id,
        billNo: bill.billNo,
        vendorName: vendor.name,
      });
    }

    const billDate = new Date(bill.billDate);
    const cdDeadline = new Date(billDate);
    cdDeadline.setDate(cdDeadline.getDate() + vendor.cdTermsDays);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    cdDeadline.setHours(0, 0, 0, 0);

    const daysRemaining = Math.ceil(
      (cdDeadline.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
    );
    const eligible = daysRemaining >= 0;

    const discountAmount = Math.round(bill.amount * vendor.cdPercentage / 100);
    const remaining = bill.amount - bill.paidAmount;
    const remainingAfterDiscount = Math.max(0, remaining - discountAmount);

    return successResponse({
      eligible,
      cdPercentage: vendor.cdPercentage,
      cdTermsDays: vendor.cdTermsDays,
      cdDeadline: cdDeadline.toISOString(),
      discountAmount,
      daysRemaining,
      billId: bill.id,
      billNo: bill.billNo,
      billAmount: bill.amount,
      alreadyPaid: bill.paidAmount,
      remaining,
      remainingAfterDiscount,
      vendorName: vendor.name,
    });
  } catch (error) {
    if (error instanceof AuthError)
      return errorResponse(error.message, error.status);
    return errorResponse(
      error instanceof Error ? error.message : "Failed to check CD eligibility",
      500
    );
  }
}
