export const dynamic = "force-dynamic";

// GET /api/reports/cd-summary?days&storeId — cash discount per supplier, for /reports/cd-summary.
// Plan 1210 credit notes and payables, Part 7.5 (R10; X4, Q4, Q15).
//
//   days      bills dated within the last N IST days (today included), 1–400, default 90
//   storeId   a Store id, or "none" for bills with no store; omitted = every store
//
// WHY A ROUTE: the screen used to filter `/api/vendors` on `cdTermsDays && cdPercentage`, two
// fields that route never returns, so the report was always empty (X4); then it fetched bills
// once per supplier (N+1). Now one database read, computed here with cashDiscountFor() — the
// rule the bill screen, the aging cards and the pay-first list share.
//
// Each bill dated in the window, from a supplier with CD terms, lands in one group:
//
//   eligible       still open, and the CD deadline has not passed — pay it to earn the discount
//   paidInWindow   settled, and the last payment recorded here is dated on or before the CD
//                  deadline. Called "Paid inside the CD window — check the supplier's CD credit
//                  note arrived", not "CD used": with Q4 = (a) the discount arrives later as the
//                  supplier's CD credit note, and the app cannot tell whether it did.
//   missed         still open past the deadline, or settled by a payment dated after it
//
// A settled bill with no payment recorded here (paid in Zoho before import, or settled by credit
// notes) cannot be placed: it is counted as `paidDateUnknown`, never guessed. DISPUTED bills are
// skipped — they are on hold, so their discount is neither earnable nor missed yet.

import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";
import {
  cashDiscountFor,
  istDayNumber,
  istDayStart,
  istDayToDate,
  openAmountOf,
  todayIstDayNumber,
} from "@/lib/payables/cash-discount";

const log = createLogger("reports:cd-summary");

const querySchema = z.object({
  days: z.coerce
    .number()
    .int("Days must be a whole number")
    .min(1, "Days must be at least 1")
    .max(400, "Days can be at most 400")
    .default(90),
  storeId: z.string().trim().min(1).max(64).optional(),
});

type BillRef = { id: string; billNo: string; discount: number };
type Group<T extends BillRef = BillRef> = { count: number; discount: number; bills: T[] };

const emptyGroup = <T extends BillRef>(): Group<T> => ({ count: 0, discount: 0, bills: [] });
const add = <T extends BillRef>(g: Group<T>, ref: T) => {
  g.count++;
  g.discount += ref.discount;
  g.bills.push(ref);
};

export async function GET(req: NextRequest) {
  const started = Date.now();
  let storeId: string | undefined;
  try {
    await requireFeature("bills", "view");

    const sp = req.nextUrl.searchParams;
    const parsed = querySchema.safeParse({
      days: sp.get("days") || undefined,
      storeId: sp.get("storeId") || undefined,
    });
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? "Invalid report filter";
      log.warn("cd summary query refused", { message });
      return errorResponse(message, 400);
    }
    const { days } = parsed.data;
    storeId = parsed.data.storeId;

    const todayDay = todayIstDayNumber();
    const today = istDayToDate(todayDay);
    const sinceDay = todayDay - (days - 1);

    // One read: suppliers with CD terms, their bills in the window, each bill's latest payment.
    const vendors = await prisma.vendor.findMany({
      where: { cdTermsDays: { gt: 0 }, cdPercentage: { gt: 0 } },
      select: {
        id: true,
        name: true,
        code: true,
        cdTermsDays: true,
        cdPercentage: true,
        bills: {
          where: {
            billDate: { gte: istDayStart(sinceDay) },
            status: { not: "DISPUTED" },
            ...(storeId === "none" ? { storeId: null } : storeId ? { storeId } : {}),
          },
          select: {
            id: true,
            billNo: true,
            billDate: true,
            amount: true,
            paidAmount: true,
            status: true,
            payments: { select: { paymentDate: true }, orderBy: { paymentDate: "desc" }, take: 1 },
          },
          orderBy: { billDate: "desc" },
        },
      },
      orderBy: { name: "asc" },
    });

    const totals = {
      eligible: { count: 0, discount: 0 },
      paidInWindow: { count: 0, discount: 0 },
      missed: { count: 0, discount: 0 },
      paidDateUnknown: 0,
    };

    const rows = [];
    for (const v of vendors) {
      const eligible = emptyGroup<BillRef & { daysLeft: number }>();
      const paidInWindow = emptyGroup();
      const missed = emptyGroup();
      let paidDateUnknown = 0;

      for (const bill of v.bills) {
        const cd = cashDiscountFor(bill, v, today);
        if (!cd) continue; // unreachable: the where clause selected suppliers with terms
        const ref = { id: bill.id, billNo: bill.billNo, discount: cd.amount };
        const settled = bill.status === "PAID" || openAmountOf(bill) <= 0;

        if (!settled) {
          if (cd.claimable) add(eligible, { ...ref, daysLeft: cd.daysLeft });
          else add(missed, ref);
          continue;
        }
        const lastPaid = bill.payments[0]?.paymentDate;
        if (!lastPaid) {
          paidDateUnknown++;
          continue;
        }
        if (istDayNumber(lastPaid) <= istDayNumber(cd.deadline)) add(paidInWindow, ref);
        else add(missed, ref);
      }

      if (v.bills.length === 0) continue;
      eligible.bills.sort((a, b) => a.daysLeft - b.daysLeft);
      totals.eligible.count += eligible.count;
      totals.eligible.discount += eligible.discount;
      totals.paidInWindow.count += paidInWindow.count;
      totals.paidInWindow.discount += paidInWindow.discount;
      totals.missed.count += missed.count;
      totals.missed.discount += missed.discount;
      totals.paidDateUnknown += paidDateUnknown;

      rows.push({
        vendorId: v.id,
        vendorName: v.name,
        vendorCode: v.code,
        cdTermsDays: v.cdTermsDays as number,
        cdPercentage: v.cdPercentage as number,
        eligible,
        paidInWindow,
        missed,
        paidDateUnknown,
      });
    }

    // What can still be earned first; then what was missed; then by name.
    rows.sort(
      (a, b) =>
        b.eligible.discount - a.eligible.discount ||
        b.missed.discount - a.missed.discount ||
        a.vendorName.localeCompare(b.vendorName)
    );

    log.debug("cd summary built", {
      storeId,
      days,
      vendorsWithTerms: vendors.length,
      vendors: rows.length,
      ms: Date.now() - started,
    });

    return successResponse({
      since: istDayToDate(sinceDay),
      days,
      vendorsWithTerms: vendors.length,
      totals,
      vendors: rows,
    });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    log.error("cd summary failed", { storeId, error: error instanceof Error ? error.message : String(error) });
    return errorResponse("Could not build the cash discount report. Try again.", 500);
  }
}
