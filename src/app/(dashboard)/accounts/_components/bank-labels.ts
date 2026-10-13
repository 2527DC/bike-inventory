// Display helpers for the weekly bank tile on /accounts and the suspense register (plan
// 1210-bank-accounts-and-suspense, D3 / E3). Account labels and calendar days come from
// bank-accounts/_components/types.ts (accountChipLabel, dayLabel), shared with the upload screen,
// so an account reads the same everywhere. Only what that file does not cover lives here.

export function inr(n: number): string {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(n);
}

/** An instant → "13 Oct, 3:05 pm" in IST. */
export function whenLabel(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  });
}

/** 0 → "today", 1 → "yesterday", n → "n days ago". */
export function daysAgo(n: number): string {
  if (n <= 0) return "today";
  if (n === 1) return "yesterday";
  return `${n} days ago`;
}
