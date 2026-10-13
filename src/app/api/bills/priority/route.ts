export const dynamic = "force-dynamic";

// GET /api/bills/priority?storeId&vendorId — the "Pay first" list on /bills.
// Plan 1210 credit notes and payables, Part 7.2–7.3 (R10, R11, R12; D8, Q5–Q7).
//
//   storeId   a Store id, or "none" for bills whose store is not set; omitted = every store
//   vendorId  one supplier; omitted = every supplier
//
// Every open supplier bill, each with its age, days past the STORED due date (Q5 = a), its cash
// discount from the one shared rule (src/lib/payables/cash-discount.ts), the supplier's open
// credit, and the tier that decides the order (Q7):
//
//   1. cd             CD still claimable — soonest deadline first. Paying these earns money.
//   2. pastDueOver45  more than 45 days past due — most days past due first
//   3. pastDue31to45
//   4. pastDue1to30
//   5. dueSoon        due within the next 7 days (today included)
//   6. later          everything else, by due date
//
// DISPUTED bills are not in the order: they come back apart as `onHold`.
//
// Computed in memory: 70-odd suppliers' open bills are hundreds of rows. Capped at 1,000 with
// a sentence, so a runaway table degrades into "narrow it down" rather than a slow page.

import { NextRequest } from "next/server";
import { z } from "zod";
import { Prisma, type BillStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";
import {
  cashDiscountFor,
  istDayNumber,
  istDayToDate,
  openAmountOf,
  todayIstDayNumber,
} from "@/lib/payables/cash-discount";

const log = createLogger("payables:priority");

const CAP = 1000;
/** GST: ITC on a bill not paid within 180 days of its date must be reversed (CGST s.16(2)). */
const ITC_RISK_DAYS = 150;
const DUE_SOON_DAYS = 7;

const OPEN_STATUSES: BillStatus[] = ["PENDING", "PARTIALLY_PAID", "OVERDUE"];
const TIERS = ["cd", "pastDueOver45", "pastDue31to45", "pastDue1to30", "dueSoon", "later"] as const;
type Tier = (typeof TIERS)[number];

const querySchema = z.object({
  storeId: z.string().trim().min(1).max(64).optional(),
  vendorId: z.string().trim().min(1).max(64).optional(),
});

function tierOf(cdClaimable: boolean, daysPastDue: number): Tier {
  if (cdClaimable) return "cd";
  if (daysPastDue > 45) return "pastDueOver45";
  if (daysPastDue > 30) return "pastDue31to45";
  if (daysPastDue >= 1) return "pastDue1to30";
  if (daysPastDue >= -DUE_SOON_DAYS) return "dueSoon";
  return "later";
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** One row of the response. Dates serialise as ISO strings. */
interface PriorityRow {
  id: string;
  billNo: string;
  status: BillStatus;
  billDate: Date;
  dueDate: Date;
  vendor: { id: string; name: string; code: string };
  store: { id: string; name: string; code: string } | null;
  amount: number;
  paidAmount: number;
  openAmount: number;
  daysSinceBill: number;
  /** ≤ 0 means not due yet; 0 is the due date itself. */
  daysPastDue: number;
  cd: {
    percentage: number;
    termsDays: number;
    deadline: Date;
    daysLeft: number;
    amount: number;
    claimable: boolean;
  } | null;
  /** Open credit of this supplier that Apply credit would accept on this bill. */
  openCredit: number;
  coveredByCredit: boolean;
  itcAtRisk: boolean;
  tier: Tier | "onHold";
}

export async function GET(req: NextRequest) {
  const started = Date.now();
  let storeId: string | undefined;
  let vendorId: string | undefined;
  try {
    await requireFeature("bills", "view");

    const sp = req.nextUrl.searchParams;
    const parsed = querySchema.safeParse({
      storeId: sp.get("storeId") || undefined,
      vendorId: sp.get("vendorId") || undefined,
    });
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? "Invalid filter";
      log.warn("priority query refused", { message });
      return errorResponse(message, 400);
    }
    ({ storeId, vendorId } = parsed.data);

    // ── One read of the open bills (and the disputed ones, listed apart) ──
    const rows = await prisma.vendorBill.findMany({
      where: {
        status: { in: [...OPEN_STATUSES, "DISPUTED"] },
        // Coarse: fully settled rows never leave the database. The paisa tolerance is applied
        // below by openAmountOf(), which a column comparison cannot express.
        paidAmount: { lt: prisma.vendorBill.fields.amount },
        ...(storeId === "none" ? { storeId: null } : storeId ? { storeId } : {}),
        ...(vendorId ? { vendorId } : {}),
      },
      select: {
        id: true,
        billNo: true,
        status: true,
        billDate: true,
        dueDate: true,
        amount: true,
        paidAmount: true,
        vendorId: true,
        storeId: true,
        vendor: { select: { name: true, code: true, cdTermsDays: true, cdPercentage: true } },
        store: { select: { id: true, name: true, code: true } },
      },
      // Due earliest first, so if the cap bites it keeps the bills that have waited longest.
      orderBy: [{ dueDate: "asc" }, { id: "asc" }],
      take: CAP + 1,
    });

    const truncated = rows.length > CAP;
    if (truncated) {
      rows.length = CAP;
      log.warn("priority list cap reached", { storeId, vendorId, cap: CAP });
    }

    // ── One grouped read of open credit (R11) ──
    // Clamped per credit, not per vendor: a credit applied for more than its total (D17) must
    // not hide another credit's open amount. Grouped by store as well, because Apply credit
    // refuses a credit of one store on a bill of another (D18) — so only the bill's own store's
    // credit, plus credit with no store yet, can cover it.
    const vendorIds = [...new Set(rows.map((r) => r.vendorId))];
    const creditGroups =
      vendorIds.length === 0
        ? []
        : await prisma.$queryRaw<Array<{ vendorId: string; storeId: string | null; open: number }>>(Prisma.sql`
            SELECT "vendorId", "storeId", SUM(GREATEST(amount - "usedAmount", 0))::float8 AS open
              FROM "VendorCredit"
             WHERE status = 'OPEN' AND "vendorId" IN (${Prisma.join(vendorIds)})
             GROUP BY "vendorId", "storeId"`);

    const creditByVendor = new Map<string, Map<string | null, number>>();
    for (const g of creditGroups) {
      const open = Number(g.open) || 0;
      if (open <= 0.01) continue;
      const byStore = creditByVendor.get(g.vendorId) ?? new Map<string | null, number>();
      byStore.set(g.storeId, (byStore.get(g.storeId) ?? 0) + open);
      creditByVendor.set(g.vendorId, byStore);
    }
    /** Credit that Apply credit would accept on a bill of this vendor and store. */
    const usableCredit = (vId: string, sId: string | null): number => {
      const byStore = creditByVendor.get(vId);
      if (!byStore) return 0;
      let sum = 0;
      for (const [creditStore, open] of byStore) {
        if (sId === null || creditStore === null || creditStore === sId) sum += open;
      }
      return round2(sum);
    };

    // ── Per bill ──
    // One "today" for the whole request, so a call that straddles midnight cannot put two
    // bills of the same date on different days.
    const todayDay = todayIstDayNumber();
    const today = istDayToDate(todayDay);

    const bills: Array<PriorityRow & { tier: Tier }> = [];
    const onHold: PriorityRow[] = [];
    for (const r of rows) {
      const openAmount = openAmountOf(r);
      if (openAmount <= 0) continue;

      const daysSinceBill = todayDay - istDayNumber(r.billDate);
      const daysPastDue = todayDay - istDayNumber(r.dueDate);
      const cd = cashDiscountFor(r, r.vendor, today);
      const openCredit = usableCredit(r.vendorId, r.storeId);

      const row: Omit<PriorityRow, "tier"> = {
        id: r.id,
        billNo: r.billNo,
        status: r.status,
        billDate: r.billDate,
        dueDate: r.dueDate,
        vendor: { id: r.vendorId, name: r.vendor.name, code: r.vendor.code },
        store: r.store,
        amount: r.amount,
        paidAmount: r.paidAmount,
        openAmount,
        daysSinceBill,
        daysPastDue,
        cd: cd && {
          percentage: r.vendor.cdPercentage as number,
          termsDays: r.vendor.cdTermsDays as number,
          deadline: cd.deadline,
          daysLeft: cd.daysLeft,
          amount: cd.amount,
          claimable: cd.claimable,
        },
        openCredit,
        coveredByCredit: openCredit > 0 && openCredit >= openAmount - 0.01,
        itcAtRisk: daysSinceBill >= ITC_RISK_DAYS,
      };

      if (r.status === "DISPUTED") onHold.push({ ...row, tier: "onHold" });
      else bills.push({ ...row, tier: tierOf(cd?.claimable ?? false, daysPastDue) });
    }

    // ── The order (Q7) ──
    const tierIndex = (t: Tier) => TIERS.indexOf(t);
    bills.sort((a, b) => {
      const byTier = tierIndex(a.tier) - tierIndex(b.tier);
      if (byTier !== 0) return byTier;
      if (a.tier === "cd" && a.cd && b.cd) {
        if (a.cd.daysLeft !== b.cd.daysLeft) return a.cd.daysLeft - b.cd.daysLeft;
        if (a.cd.amount !== b.cd.amount) return b.cd.amount - a.cd.amount;
      }
      // Most days past due first, which within "dueSoon" and "later" is due date ascending.
      if (a.daysPastDue !== b.daysPastDue) return b.daysPastDue - a.daysPastDue;
      if (a.openAmount !== b.openAmount) return b.openAmount - a.openAmount;
      return a.billNo.localeCompare(b.billNo);
    });
    onHold.sort((a, b) => b.daysPastDue - a.daysPastDue || b.openAmount - a.openAmount);

    // ── Totals ──
    const sum = (list: Array<{ openAmount: number }>) => ({
      count: list.length,
      amount: round2(list.reduce((s, b) => s + b.openAmount, 0)),
    });
    const tiers = Object.fromEntries(TIERS.map((t) => [t, sum(bills.filter((b) => b.tier === t))])) as Record<
      Tier,
      { count: number; amount: number }
    >;
    // Open credit across the suppliers on the list, once per supplier (not once per bill).
    const filterStore = storeId && storeId !== "none" ? storeId : null;
    const openCredit = round2(
      [...new Set(bills.map((b) => b.vendor.id))].reduce((s, vId) => s + usableCredit(vId, filterStore), 0)
    );

    const totals = {
      all: sum(bills),
      tiers,
      onHold: sum(onHold),
      // Q6 = (a): the owner's >30 / >45 cuts are on days since the bill date.
      over30: sum(bills.filter((b) => b.daysSinceBill > 30)),
      over45: sum(bills.filter((b) => b.daysSinceBill > 45)),
      cdClaimable: round2(bills.reduce((s, b) => s + (b.cd?.claimable ? b.cd.amount : 0), 0)),
      itcAtRisk: sum(bills.filter((b) => b.itcAtRisk)),
      openCredit,
    };

    log.debug("priority list built", {
      storeId,
      vendorId,
      bills: bills.length,
      onHold: onHold.length,
      ms: Date.now() - started,
    });

    return successResponse({
      asOf: today,
      bills,
      onHold,
      totals,
      truncated,
      notice: truncated
        ? `Showing the ${CAP.toLocaleString("en-IN")} open bills due earliest. Pick a store or a supplier to see the rest.`
        : null,
    });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    log.error("priority list failed", {
      storeId,
      vendorId,
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse("Could not build the pay-first list. Try again.", 500);
  }
}
