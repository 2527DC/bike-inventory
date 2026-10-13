export const dynamic = "force-dynamic";

// GET /api/bills/[id]/cd-eligibility — the cash-discount strip on /bills/[id].
// Plan 1210 credit notes and payables, Part 7.1: the deadline, days left and amount come from
// cashDiscountFor() (src/lib/payables/cash-discount.ts), the one rule the aging cards, the
// priority list and the CD report also use. This route used `Math.ceil` on local-midnight dates
// and the aging summary `Math.floor`, so the two disagreed by a day.
//
// Response shape unchanged for the screen: `eligible` + `daysRemaining` + `discountAmount`, or
// `eligible: false` with a `reason` when there is nothing to show (no CD terms, bill settled).

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";
import { cashDiscountFor, openAmountOf } from "@/lib/payables/cash-discount";

const log = createLogger("payables:cd");

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let billId: string | undefined;
  try {
    await requireFeature("bills", "view");
    billId = (await params).id;

    const bill = await prisma.vendorBill.findUnique({
      where: { id: billId },
      select: {
        id: true,
        billNo: true,
        billDate: true,
        amount: true,
        paidAmount: true,
        vendor: { select: { name: true, cdTermsDays: true, cdPercentage: true } },
      },
    });
    if (!bill) return errorResponse("Bill not found", 404);

    const { vendor } = bill;
    const base = { billId: bill.id, billNo: bill.billNo, vendorName: vendor.name };

    const cd = cashDiscountFor(bill, vendor);
    if (!cd) return successResponse({ ...base, eligible: false, reason: "No CD terms configured" });

    const remaining = openAmountOf(bill);
    return successResponse({
      ...base,
      eligible: cd.claimable,
      // A settled bill has nothing left to discount; the reason keeps the screen from calling it
      // "CD expired" when it was simply paid.
      ...(remaining <= 0 && { reason: "Bill already settled" }),
      cdPercentage: vendor.cdPercentage,
      cdTermsDays: vendor.cdTermsDays,
      cdDeadline: cd.deadline.toISOString(),
      discountAmount: cd.amount,
      daysRemaining: cd.daysLeft,
      billAmount: bill.amount,
      alreadyPaid: bill.paidAmount,
      remaining,
      remainingAfterDiscount: Math.max(0, remaining - cd.amount),
    });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    log.error("cd eligibility failed", { billId, error: error instanceof Error ? error.message : String(error) });
    return errorResponse("Could not check the cash discount. Try again.", 500);
  }
}
