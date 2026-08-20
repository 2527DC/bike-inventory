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
