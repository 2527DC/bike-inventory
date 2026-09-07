/**
 * The date window a Zoho fetch asks for (R1).
 *
 * ─── THE BUG THIS REPLACES ────────────────────────────────────────────────────────────────
 *
 * "3 days" returned the wrong three days on every fetch screen, and did it differently on the
 * client and the server:
 *
 *   * CLIENT — `new Date().toISOString().slice(0, 10)` after local (IST) arithmetic. The
 *     browser is at UTC+5:30, so before 05:30 IST `toISOString()` has already rolled back to
 *     yesterday's date. On 3 Sep at 02:00 IST, "3 days" asked for 30 Aug – 2 Sep: an extra
 *     day at the front and TODAY'S BILLS MISSING.
 *   * SERVER — `todayStr = new Date().toISOString()` is the server's UTC date, which is
 *     yesterday for the first 5.5 hours of every Indian day.
 *
 * The fix is to stop deriving "today" from a Date at all inside the arithmetic. `todayIST` is
 * passed in as a plain "YYYY-MM-DD" string (from `getTodayIST()`), and every step below is
 * `Date.UTC` arithmetic on that calendar date. No local timezone participates, so the result
 * is the same on a laptop in Bengaluru, a Vercel box in Washington, and a test at 02:00.
 *
 * PURE, and deliberately so: it takes today as an argument and returns a plain object, which
 * is what makes the four spot-checks in the plan runnable without a database or a clock.
 */

/** The Indian financial year starts on 1 April. */
const FY_START_MONTH = 4;

export interface WindowRequest {
  /** Rolling window INCLUDING today: days=3 on 4 Sep means 2, 3 and 4 Sep. */
  days?: number;
  /** Explicit start, "YYYY-MM-DD". Overrides `days`. */
  fromDate?: string;
  /** Explicit end, "YYYY-MM-DD". Defaults to today. */
  toDate?: string;
}

export interface ResolvedWindow {
  from: string;
  to: string;
  /** True when `fromDate` was earlier than the financial year and got pulled forward. */
  clampedToFy: boolean;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** "YYYY-MM-DD" -> epoch ms at UTC midnight. Throws on anything else. */
function toUtcMs(dateStr: string, label: string): number {
  if (!DATE_RE.test(dateStr)) {
    throw new Error(`${label} must be a date like 2026-09-04, got "${dateStr}"`);
  }
  const [y, m, d] = dateStr.split("-").map(Number);
  const ms = Date.UTC(y, m - 1, d);
  // Date.UTC happily rolls 2026-02-31 into March. Round-tripping catches that.
  if (new Date(ms).toISOString().slice(0, 10) !== dateStr) {
    throw new Error(`${label} is not a real date: "${dateStr}"`);
  }
  return ms;
}

function toDateStr(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The first day of the Indian financial year containing `todayIST`.
 *
 * DERIVED, not the literal "2026-04-01" that was hardcoded in trigger-pull. A literal is
 * wrong from the next 1 April onwards, silently — it would let a fetch reach back into a
 * closed year and import bills that were already accounted for.
 */
export function financialYearStart(todayIST: string): string {
  const [y, m] = todayIST.split("-").map(Number);
  const startYear = m >= FY_START_MONTH ? y : y - 1;
  return `${startYear}-04-01`;
}

/**
 * Resolve a fetch window.
 *
 * - `{ days: 3 }` on 2026-09-04 -> 2026-09-02 .. 2026-09-04 (INCLUSIVE of today)
 * - `{ fromDate }` -> that date .. today, unless `toDate` is given
 * - a `fromDate` before the financial year start is pulled forward, `clampedToFy: true`
 * - `from > to` THROWS — the caller turns it into a 400, because it is the user's range that
 *   is wrong, not the pull that failed
 *
 * Neither bound is allowed past today: Zoho cannot have tomorrow's bills, and a future `to`
 * only ever comes from a typo or a mis-set device clock.
 */
export function resolveBillWindow(req: WindowRequest, todayIST: string): ResolvedWindow {
  const todayMs = toUtcMs(todayIST, "today");
  const fyStart = financialYearStart(todayIST);
  const fyStartMs = toUtcMs(fyStart, "financial year start");

  let toMs = req.toDate ? toUtcMs(req.toDate, "To date") : todayMs;
  if (toMs > todayMs) toMs = todayMs;

  let fromMs: number;
  let clampedToFy = false;

  if (req.fromDate) {
    fromMs = toUtcMs(req.fromDate, "From date");
    if (fromMs < fyStartMs) {
      fromMs = fyStartMs;
      clampedToFy = true;
    }
  } else {
    // days=1 means today alone, so the span is (days - 1) whole days back.
    const days = Number.isFinite(req.days) && (req.days as number) > 0 ? Math.floor(req.days as number) : 1;
    fromMs = toMs - (days - 1) * DAY_MS;
    if (fromMs < fyStartMs) {
      fromMs = fyStartMs;
      clampedToFy = true;
    }
  }

  if (fromMs > toMs) {
    throw new Error(
      `From (${toDateStr(fromMs)}) is after To (${toDateStr(toMs)}). Pick a start on or before the end date.`
    );
  }

  return { from: toDateStr(fromMs), to: toDateStr(toMs), clampedToFy };
}
