export const dynamic = "force-dynamic";

// GET /api/bills/aging-summary?storeId — the aging cards and CD deadlines on /bills.
// Plan 1210 credit notes and payables, Part 7.4 (F6, X10, Q5).
//
// Buckets are the owner's cuts by days past the bill's STORED due date (Q5 = a), the same four
// keys `GET /api/bills?aging=` filters by — src/lib/payables/cash-discount.ts defines both, so a
// card's count and the list it opens agree:
//
//   notDue · pastDue1to30 · pastDue31to45 · pastDueOver45
//
// Unpaid includes OVERDUE: a bill set to OVERDUE by hand used to drop out of the payables total
// (X10). DISPUTED stays out, as on the priority list, where it is listed apart as "on hold".
//
//   storeId   a Store id, or "none" for bills with no store; omitted = every store

import { NextRequest } from "next/server";
import { z } from "zod";
import type { BillStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";
import {
  AGING_BUCKETS,
  agingBucketFor,
  cashDiscountFor,
  istDayNumber,
  istDayToDate,
  openAmountOf,
  todayIstDayNumber,
  type AgingBucket,
} from "@/lib/payables/cash-discount";

const log = createLogger("payables:aging");

const UNPAID: BillStatus[] = ["PENDING", "PARTIALLY_PAID", "OVERDUE"];
/** CD deadlines shown: the coming week, and the last three days of a missed one. */
const CD_WARN_FROM = -3;
const CD_WARN_TO = 7;

const querySchema = z.object({
  storeId: z.string().trim().min(1).max(64).optional(),
});

export async function GET(req: NextRequest) {
  let storeId: string | undefined;
  try {
    await requireFeature("bills", "view");

    const parsed = querySchema.safeParse({ storeId: req.nextUrl.searchParams.get("storeId") || undefined });
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? "Invalid filter";
      log.warn("aging query refused", { message });
      return errorResponse(message, 400);
    }
    storeId = parsed.data.storeId;

    const unpaidBills = await prisma.vendorBill.findMany({
      where: {
        status: { in: UNPAID },
        paidAmount: { lt: prisma.vendorBill.fields.amount },
        ...(storeId === "none" ? { storeId: null } : storeId ? { storeId } : {}),
      },
      select: {
        id: true,
        billNo: true,
        amount: true,
        paidAmount: true,
        dueDate: true,
        billDate: true,
        vendor: { select: { name: true, cdTermsDays: true, cdPercentage: true } },
      },
    });

    const todayDay = todayIstDayNumber();
    const today = istDayToDate(todayDay);

    const buckets = Object.fromEntries(AGING_BUCKETS.map((k) => [k, { count: 0, amount: 0 }])) as Record<
      AgingBucket,
      { count: number; amount: number }
    >;
    const cdWarnings: Array<{
      billId: string;
      billNo: string;
      vendorName: string;
      cdDeadline: Date;
      cdPercentage: number;
      /** ₹ the discount is worth (bill total × CD%, Q15 = a). */
      discount: number;
      /** What is still owed on the bill. */
      balance: number;
      daysLeft: number;
      claimable: boolean;
    }> = [];

    for (const bill of unpaidBills) {
      const balance = openAmountOf(bill);
      if (balance <= 0) continue;

      const bucket = buckets[agingBucketFor(todayDay - istDayNumber(bill.dueDate))];
      bucket.count++;
      bucket.amount += balance;

      const cd = cashDiscountFor(bill, bill.vendor, today);
      if (cd && cd.daysLeft >= CD_WARN_FROM && cd.daysLeft <= CD_WARN_TO) {
        cdWarnings.push({
          billId: bill.id,
          billNo: bill.billNo,
          vendorName: bill.vendor.name,
          cdDeadline: cd.deadline,
          cdPercentage: bill.vendor.cdPercentage as number,
          discount: cd.amount,
          balance,
          daysLeft: cd.daysLeft,
          claimable: cd.claimable,
        });
      }
    }

    for (const k of AGING_BUCKETS) buckets[k].amount = Math.round(buckets[k].amount * 100) / 100;
    cdWarnings.sort((a, b) => a.daysLeft - b.daysLeft || b.discount - a.discount);

    const totalOutstanding = Math.round(AGING_BUCKETS.reduce((s, k) => s + buckets[k].amount, 0) * 100) / 100;
    const totalCount = AGING_BUCKETS.reduce((s, k) => s + buckets[k].count, 0);

    log.debug("aging computed", { storeId, bills: totalCount, cdWarnings: cdWarnings.length });

    return successResponse({ buckets, totalOutstanding, totalCount, cdWarnings });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    log.error("aging failed", { storeId, error: error instanceof Error ? error.message : String(error) });
    return errorResponse("Could not compute payables aging. Try again.", 500);
  }
}
