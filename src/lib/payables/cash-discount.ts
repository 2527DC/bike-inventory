// ─── Cash discount, bill age and aging — one day rule for payables ───────────
//
// Plan 1210 credit notes and payables, Part 7.1 (R10, R12; F6, X5).
//
// WHY ONE FILE
// ------------
// Before this, the cash-discount (CD) deadline was computed twice and the two copies disagreed
// by a day: `cd-eligibility` used `Math.ceil` on local-midnight dates, the aging summary used
// `Math.floor` on raw timestamps. "Days past due" was computed four ways, two of them from the
// vendor's *current* terms instead of the bill's stored due date (Q5). Every one of those now
// calls this file, so a bill shows the same number of days on every screen.
//
// THE DAY RULE
// ------------
// A day is an IST calendar day. Every difference below is a subtraction of two whole IST day
// numbers — there is no `ceil`, `floor` or `round` on a duration anywhere, so there is nothing
// to disagree about. `billDate` and `dueDate` are stored as the UTC midnight of their calendar
// day (the Zoho import and `POST /api/bills` both parse "YYYY-MM-DD"); a value stored as IST
// midnight (the previous UTC evening) lands on the same IST day, so either convention works.
//
// PURE: no Prisma, no server-only import. The `/bills` screen imports it too, which is how the
// list's OVERDUE badge and the aging cards cannot drift apart again.

import { getTodayIST } from "@/lib/services/timezone";

export const DAY_MS = 86_400_000;
// The same fixed offset `src/lib/services/timezone.ts` uses (India observes no DST). It is not
// exported there, and that file is shared well beyond payables.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** The IST calendar day an instant falls on, as a whole number of days since 1 Jan 1970. */
export function istDayNumber(d: Date | string): number {
  return Math.floor((new Date(d).getTime() + IST_OFFSET_MS) / DAY_MS);
}

/** Today's IST day number. Pass `today` to fix the date (a report date, a test). */
export function todayIstDayNumber(today?: Date): number {
  return today ? istDayNumber(today) : istDayNumber(new Date(`${getTodayIST()}T00:00:00Z`));
}

/**
 * Whole IST days from `from` to `to`: positive when `to` is later. A bill dated 1 Sep is, on
 * 15 Oct, `istDaysBetween(billDate, today) = 44` days old.
 */
export function istDaysBetween(from: Date | string, to: Date | string): number {
  return istDayNumber(to) - istDayNumber(from);
}

/**
 * The date-only value of an IST day: the UTC midnight of that calendar day — the convention
 * `billDate` and `dueDate` are stored in, so it prints as the right date in any time zone.
 */
export function istDayToDate(dayNumber: number): Date {
  return new Date(dayNumber * DAY_MS);
}

/**
 * The instant an IST day begins (its midnight in Kolkata, i.e. 18:30 UTC the evening before).
 * The bound for a database filter on a timestamp column: `dueDate >= istDayStart(n)` selects
 * exactly the rows whose IST day is `n` or later, whichever convention they were stored in.
 */
export function istDayStart(dayNumber: number): Date {
  return new Date(dayNumber * DAY_MS - IST_OFFSET_MS);
}

/** The amount still owed on a bill. Below a paisa is "nothing" — Float columns (schema-review §4.6). */
export function openAmountOf(bill: { amount: number; paidAmount: number }): number {
  const open = bill.amount - bill.paidAmount;
  return open > 0.01 ? Math.round(open * 100) / 100 : 0;
}

// ─── Cash discount ───────────────────────────────────────────────────────────

export interface CashDiscount {
  /** The last day the discount can be taken — the date-only value of that IST day. */
  deadline: Date;
  /** IST days from today to the deadline. 0 = today is the last day; negative = passed. */
  daysLeft: number;
  /** ₹ discount on the bill: round(bill total × CD% / 100). Base is the bill total (Q15 = a). */
  amount: number;
  /** The discount can still be earned: the deadline has not passed and the bill is still open. */
  claimable: boolean;
}

/**
 * The cash discount on one bill, or `null` when the vendor has no CD terms.
 *
 * Deadline = bill date + `cdTermsDays`, in IST calendar days. "No CD terms" keeps the rule the
 * vendor screens and the old routes used: a missing or zero term or percentage means none.
 *
 * Q15 = (a): the base is the bill TOTAL, GST included — the figure the CA is asked to confirm
 * (§3 Board of agents, gst-consultant). Q4 = (a): the discount arrives later as the supplier's
 * CD credit note, so this is "what to claim", never something deducted here.
 */
export function cashDiscountFor(
  bill: { billDate: Date; amount: number; paidAmount: number },
  terms: { cdTermsDays: number | null; cdPercentage: number | null },
  today?: Date
): CashDiscount | null {
  const { cdTermsDays, cdPercentage } = terms;
  if (!cdTermsDays || cdTermsDays <= 0 || !cdPercentage || cdPercentage <= 0) return null;

  const deadlineDay = istDayNumber(bill.billDate) + cdTermsDays;
  const daysLeft = deadlineDay - todayIstDayNumber(today);

  return {
    deadline: istDayToDate(deadlineDay),
    daysLeft,
    amount: Math.round((bill.amount * cdPercentage) / 100),
    claimable: daysLeft >= 0 && openAmountOf(bill) > 0,
  };
}

// ─── Aging by days past the stored due date (Q5 = a) ─────────────────────────

/**
 * The owner's cuts, by days past the bill's STORED `dueDate` (the supplier's own due date).
 * Replaces `current / days30 / days60 / days90plus`, whose last bucket held everything over 60
 * (F6). `GET /api/bills/aging-summary`, `GET /api/bills?aging=` and the `/bills` cards all use
 * these four keys.
 */
export const AGING_BUCKETS = ["notDue", "pastDue1to30", "pastDue31to45", "pastDueOver45"] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];

export function isAgingBucket(v: unknown): v is AgingBucket {
  return typeof v === "string" && (AGING_BUCKETS as readonly string[]).includes(v);
}

/** `daysPastDue` ≤ 0 means not due yet (0 = due today). */
export function agingBucketFor(daysPastDue: number): AgingBucket {
  if (daysPastDue <= 0) return "notDue";
  if (daysPastDue <= 30) return "pastDue1to30";
  if (daysPastDue <= 45) return "pastDue31to45";
  return "pastDueOver45";
}

/**
 * The `dueDate` range of a bucket, for a database filter. Selects exactly the bills
 * `agingBucketFor(istDaysBetween(dueDate, today))` puts in that bucket, so the list filtered by
 * a card and the card's count agree.
 */
export function agingDueDateRange(bucket: AgingBucket, today?: Date): { gte?: Date; lt?: Date } {
  const t = todayIstDayNumber(today);
  switch (bucket) {
    case "notDue":
      return { gte: istDayStart(t) }; // due today or later
    case "pastDue1to30":
      return { gte: istDayStart(t - 30), lt: istDayStart(t) };
    case "pastDue31to45":
      return { gte: istDayStart(t - 45), lt: istDayStart(t - 30) };
    case "pastDueOver45":
      return { lt: istDayStart(t - 45) };
  }
}
