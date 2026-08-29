// Business time for store analytics.
//
// PRD-v1 DAT-004: aggregation uses the STORE timezone, never the server's. Vercel runs UTC,
// so `new Date().toISOString().slice(0, 10)` names the wrong day for every event after
// 18:30 UTC = 00:00 IST. Stopping that bug is the whole reason this file exists.
//
// Overlap note: src/lib/services/timezone.ts also knows "today in IST", but only that. This
// module needs the business date of an ARBITRARY timestamp, plus opening hours and
// elapsed-minute arithmetic, so it is not a subset of that file. Folding the two into one
// shared IST module is a worthwhile follow-up; doing it here would mean editing the workshop
// module as a side effect of an analytics merge.

export const STORE_TZ = "Asia/Kolkata";

/** A store-local calendar day, "YYYY-MM-DD". */
export type BusinessDate = string;

// en-CA formats as YYYY-MM-DD, which is the whole reason for that locale.
const dateFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: STORE_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const clockFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: STORE_TZ,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** Store-local business date for a ms epoch or Date. */
export function businessDate(ts: number | Date = Date.now()): BusinessDate {
  return dateFmt.format(new Date(ts));
}

/** Store-local "HH:MM" for a ms epoch or Date. */
export function storeClock(ts: number | Date = Date.now()): string {
  return clockFmt.format(new Date(ts));
}

/** Store-local hour 0–23. */
export function storeHour(ts: number | Date = Date.now()): number {
  return Number(storeClock(ts).slice(0, 2));
}

/** Shape guard for anything arriving from a query string or request body. */
export function isBusinessDate(value: unknown): value is BusinessDate {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

// ─── Prisma @db.Date round-trip ──────────────────────────────────────────────
// A Postgres DATE column has no timezone. Prisma reads and writes it as a Date pinned to
// UTC midnight, so both directions must go through UTC explicitly. Building the value from
// local time instead (`new Date("2026-08-21")` is fine, `new Date(2026, 7, 21)` is not)
// shifts the day by the server's offset, which is exactly the bug this file prevents.

/** BusinessDate -> the Date to store in / query against a `@db.Date` column. */
export function toDateColumn(date: BusinessDate): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

/** A `@db.Date` value read back from Prisma -> BusinessDate. */
export function fromDateColumn(value: Date): BusinessDate {
  return value.toISOString().slice(0, 10);
}

/**
 * Half-open [gte, lt) range covering one calendar day at UTC midnight.
 *
 * For the POS models, NOT for count_events. `PosSession.sessionDate` and
 * `CustomerInvoice.invoiceDate` are plain DateTime columns that the rest of the app anchors
 * at UTC midnight — see api/pos/settlement/route.ts (`new Date(date + "T00:00:00Z")`) and
 * api/deliveries/import-zoho/route.ts (`new Date(inv.date)` on a Zoho "YYYY-MM-DD").
 *
 * A few rows carry a real timestamp instead (api/deliveries/route.ts writes `new Date()`),
 * so a full-day half-open range is used rather than an equality test: it is correct for both
 * shapes, where `equals: utcMidnight` would silently miss every timestamped row.
 */
export function calendarDayRange(date: BusinessDate): { gte: Date; lt: Date } {
  const gte = toDateColumn(date);
  const lt = new Date(gte.getTime() + 24 * 60 * 60 * 1000);
  return { gte, lt };
}

// ─── Opening hours ───────────────────────────────────────────────────────────

export interface OpeningHours {
  openHour: number;
  closeHour: number;
  expectedMinutes: number;
}

/**
 * Store opening hours, if configured. Returns null when unknown — deliberately.
 *
 * PRD-v1 Q-04 leaves opening hours open and DAT-005 coverage cannot be computed without
 * them. A guessed 10:00–21:00 would render as a real coverage percentage, which is exactly
 * the failure the specs forbid: a number nobody can audit is a number nobody should act on.
 *
 * Known limitation: this is global, not per store. Two stores with different hours will both
 * be measured against whichever pair is configured. Acceptable while one store is counted;
 * it becomes wrong the moment a second store with different hours is added, and at that
 * point the setting belongs on a store row rather than in the environment.
 */
export function openingHours(): OpeningHours | null {
  const open = process.env.STORE_OPEN_HOUR;
  const close = process.env.STORE_CLOSE_HOUR;
  if (open == null || close == null) return null;

  const openHour = Number(open);
  const closeHour = Number(close);
  if (!Number.isFinite(openHour) || !Number.isFinite(closeHour)) return null;
  if (closeHour <= openHour) return null;

  return { openHour, closeHour, expectedMinutes: (closeHour - openHour) * 60 };
}

/** Minutes of the business day elapsed so far, bounded to opening hours. */
export function elapsedOpenMinutes(
  date: BusinessDate,
  hours: OpeningHours | null,
  now: number = Date.now()
): number | null {
  if (!hours) return null;
  // A past day is complete; only today is partial.
  if (date !== businessDate(now)) return hours.expectedMinutes;

  const [h, m] = storeClock(now).split(":").map(Number);
  const elapsed = h * 60 + m - hours.openHour * 60;
  return Math.max(0, Math.min(hours.expectedMinutes, elapsed));
}
