// IST timezone helpers — all "today" logic should use these

const IST_OFFSET = 5.5 * 60 * 60 * 1000; // +5:30

/** Get current date in IST as YYYY-MM-DD */
export function getTodayIST(): string {
  const now = new Date(Date.now() + IST_OFFSET);
  return now.toISOString().slice(0, 10);
}

/** Get start of today in IST as a UTC Date */
export function getStartOfTodayIST(): Date {
  const todayStr = getTodayIST();
  // IST midnight = UTC previous day 18:30
  return new Date(`${todayStr}T00:00:00+05:30`);
}

/** Get end of today in IST as a UTC Date */
export function getEndOfTodayIST(): Date {
  const todayStr = getTodayIST();
  return new Date(`${todayStr}T23:59:59.999+05:30`);
}

/**
 * The UTC instants bounding one IST calendar day, plus the day's own name.
 *
 * WHY THIS EXISTS: `api/activity/route.ts` built its window with `setHours(0,0,0,0)`, which
 * is midnight in the SERVER's zone. Vercel runs UTC, so the boundary landed at 05:30 IST and
 * everything done between midnight and 05:30 filed under the previous day — then the response
 * printed that previous day's date back, so the screen agreed with itself and looked right.
 *
 * DO NOT reach for `calendarDayRange` in `src/lib/analytics/time.ts` instead. It looks like
 * this function and is not: it anchors at UTC midnight for Postgres `@db.Date` columns, so
 * against a real timestamp column it is wrong by 5h30m in a way that reads as correct.
 *
 * The fixed `+05:30` literal is exact — India observes no DST — and is the same construction
 * `getStartOfTodayIST` already uses.
 *
 * @param dateStr "YYYY-MM-DD" naming an IST day; anything malformed falls back to today, so a
 *                hand-typed `?date=` cannot reach Prisma as an Invalid Date.
 */
export function istDayBounds(dateStr?: string): { dayStr: string; start: Date; end: Date } {
  const requested = dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? dateStr : undefined;
  // A well-formed string can still name no real day, and Date does not reject it: "2026-02-31"
  // parses happily and rolls over to 3 March. So the parse is round-tripped back to an IST day
  // name and must come back unchanged; only then is the caller's string used.
  const parsed = requested ? new Date(`${requested}T00:00:00.000+05:30`) : null;
  const roundTrip =
    parsed && !Number.isNaN(parsed.getTime())
      ? new Date(parsed.getTime() + IST_OFFSET).toISOString().slice(0, 10)
      : null;
  const dayStr = roundTrip === requested && requested ? requested : getTodayIST();

  return {
    dayStr,
    start: new Date(`${dayStr}T00:00:00.000+05:30`),
    end: new Date(`${dayStr}T23:59:59.999+05:30`),
  };
}

/** Check if a date falls on "today" in IST */
export function isToday(date: string | Date): boolean {
  const d = new Date(date);
  const start = getStartOfTodayIST();
  const end = getEndOfTodayIST();
  return d >= start && d <= end;
}

/** Format a date for display in IST */
export function formatIST(date: string | Date, options?: Intl.DateTimeFormatOptions): string {
  return new Date(date).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    ...options,
  });
}
