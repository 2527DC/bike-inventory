// "Reconciled up to <date>" — the number on the weekly bank tile (plan
// 1210-bank-accounts-and-suspense, §3 E1; owner's D17 and Q4, 13 Oct 2026).
//
// PURE: no I/O, no clock, no Prisma. GET /api/bank-accounts/status gathers the inputs and calls
// this, so the rule lives in exactly one place and can be checked by hand.
//
// Every date here is a calendar day, "YYYY-MM-DD". Statement periods (the typed period; toDate is
// the last day, included) and bank-line dates are stored at UTC midnight — the caller turns them
// into days with fromDateColumn (src/lib/analytics/time.ts). "Today" is the IST day
// (getTodayIST / businessDate), never a local-time Date.
//
// THE RULE, for one account:
//   start           = the account's reconcileFrom, or — blank — the earliest period start.
//   covered to      = walk the statement periods in order from `start`. A period that starts
//                     more than one day after the run so far ends leaves a MISSING STATEMENT;
//                     the run stops there. Covered to = the end of the unbroken run.
//   first open line = the earliest line on or after `start` still to review (processedAt null)
//                     or in suspense (FLAGGED). The caller finds it; this only uses its date.
//   reconciled up to = the earlier of covered to and the day before the first open line.
//                     No statement at all, or nothing covered from `start` → none.
//   stale (red)     = no date, or today − reconciled up to > 7 days (8 days or more).

/** A statement's period as typed by the uploader (or, for old rows, its first/last line date). */
export interface StatementPeriod {
  from: string;
  to: string;
}

export interface ReconStatus {
  /** The day counting starts from; null when there is neither a reconcileFrom nor a statement. */
  start: string | null;
  /** End of the unbroken run of statements from `start`; null when nothing is covered. */
  coveredTo: string | null;
  /** The first hole in the run — a statement nobody uploaded. */
  missing: { from: string; to: string } | null;
  reconciledUpTo: string | null;
  /** Whole days from reconciledUpTo to today, never negative; null with no date. */
  daysBehind: number | null;
  /** Red on the tile. */
  stale: boolean;
}

/** More than this many days behind is red: 7 is green, 8 is red (D17). */
export const STALE_AFTER_DAYS = 7;

const DAY_MS = 86_400_000;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function toMs(day: string): number {
  if (!ISO_DAY.test(day)) throw new Error(`Not a calendar day: ${day}`);
  return Date.parse(`${day}T00:00:00.000Z`);
}

/** `day` plus `n` calendar days (n may be negative). */
export function addDays(day: string, n: number): string {
  return new Date(toMs(day) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Calendar days from `from` to `to` (positive when `to` is later). */
export function diffDays(from: string, to: string): number {
  return Math.round((toMs(to) - toMs(from)) / DAY_MS);
}

/**
 * @param periods   every statement period of the account (any order, overlaps allowed)
 * @param firstOpen the date of the earliest open line on or after `start`, or null
 * @param start     the account's reconcileFrom, or null to start at the earliest period
 * @param today     the IST calendar day
 */
export function computeStatus(
  periods: StatementPeriod[],
  firstOpen: string | null,
  start: string | null,
  today: string
): ReconStatus {
  const sorted = [...periods]
    .filter((p) => p.from <= p.to)
    .sort((a, b) => (a.from === b.from ? (a.to < b.to ? 1 : -1) : a.from < b.from ? -1 : 1));

  const from = start ?? sorted[0]?.from ?? null;
  if (sorted.length === 0 || from === null) {
    return { start: from, coveredTo: null, missing: null, reconciledUpTo: null, daysBehind: null, stale: true };
  }

  // The run "so far" ends the day before `start`, so a first period starting after `start`
  // leaves a hole at the very beginning — the weeks between reconcileFrom and the first upload.
  let runEnd = addDays(from, -1);
  let missing: ReconStatus["missing"] = null;
  for (const p of sorted) {
    if (p.to <= runEnd) continue; // wholly inside the run already, or wholly before `start`
    if (p.from > addDays(runEnd, 1)) {
      missing = { from: addDays(runEnd, 1), to: addDays(p.from, -1) };
      break;
    }
    runEnd = p.to;
  }
  const coveredTo = runEnd >= from ? runEnd : null;

  let reconciledUpTo = coveredTo;
  if (coveredTo !== null && firstOpen !== null) {
    const dayBeforeOpen = addDays(firstOpen, -1);
    if (dayBeforeOpen < coveredTo) reconciledUpTo = dayBeforeOpen;
  }

  const daysBehind = reconciledUpTo === null ? null : Math.max(0, diffDays(reconciledUpTo, today));
  const stale = daysBehind === null || daysBehind > STALE_AFTER_DAYS;
  return { start: from, coveredTo, missing, reconciledUpTo, daysBehind, stale };
}
