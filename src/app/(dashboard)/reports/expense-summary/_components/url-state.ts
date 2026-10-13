// The report keeps every filter in its own URL. Two reasons: Back from "View these expenses"
// lands on the same report instead of a reset one, and a filtered report can be shared as a link.
//
// Pure functions only — the page reads `useSearchParams` and writes with `router.replace`.
import { getDateRange, type DateRangeKey } from "@/components/date-filter";
import { FILTER_PARAM, GROUP_BY_ORDER, type GroupBy, type ReportFilters } from "./types";

const RANGE_KEYS: readonly DateRangeKey[] = ["all", "today", "3days", "week", "month", "custom"];
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export const DEFAULT_RANGE: DateRangeKey = "month";

export function readFilters(sp: URLSearchParams): ReportFilters {
  const range = sp.get("range");
  const groupBy = sp.get("groupBy");
  const day = (k: string) => {
    const v = sp.get(k);
    return v && DAY.test(v) ? v : null;
  };
  return {
    range: RANGE_KEYS.includes(range as DateRangeKey) ? (range as DateRangeKey) : DEFAULT_RANGE,
    dateFrom: day("dateFrom"),
    dateTo: day("dateTo"),
    storeId: sp.get("storeId") || null,
    payer: sp.get("payer") || null,
    category: sp.get("category") || null,
    groupBy: GROUP_BY_ORDER.includes(groupBy as GroupBy) ? (groupBy as GroupBy) : "payer",
  };
}

/** The report's own query string — defaults left out so a plain visit keeps a clean URL. */
export function reportSearch(f: ReportFilters): string {
  const p = new URLSearchParams();
  if (f.range !== DEFAULT_RANGE) p.set("range", f.range);
  if (f.range === "custom" && f.dateFrom && f.dateTo) {
    p.set("dateFrom", f.dateFrom);
    p.set("dateTo", f.dateTo);
  }
  if (f.storeId) p.set("storeId", f.storeId);
  if (f.payer) p.set("payer", f.payer);
  if (f.category) p.set("category", f.category);
  if (f.groupBy !== "payer") p.set("groupBy", f.groupBy);
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** The IST days a preset or custom range covers; null for "All dates". */
export function windowOf(f: ReportFilters): { from: string; to: string } | null {
  if (f.range === "all") return null;
  if (f.range === "custom") return f.dateFrom && f.dateTo ? { from: f.dateFrom, to: f.dateTo } : null;
  return getDateRange(f.range);
}

/** Query for GET /api/reports/expense-summary. */
export function apiQuery(f: ReportFilters): string {
  const p = new URLSearchParams();
  const w = windowOf(f);
  if (w) {
    p.set("dateFrom", w.from);
    p.set("dateTo", w.to);
  } else if (f.range === "all") {
    p.set("range", "all");
  }
  // A custom range with no dates yet sends neither: the API answers with this month.
  if (f.storeId) p.set("storeId", f.storeId);
  if (f.payer) p.set("payer", f.payer);
  if (f.category) p.set("category", f.category);
  p.set("groupBy", f.groupBy);
  return p.toString();
}

/**
 * The /expenses link for exactly what the report totalled. Dates come from the API's answer
 * (`dateFrom`/`dateTo` it echoes), so the list gets the window the server actually used; no
 * dates means "All dates", which is also what the list does with none.
 */
export function listHref(f: ReportFilters, window: { dateFrom: string | null; dateTo: string | null }): string {
  const p = new URLSearchParams();
  if (window.dateFrom) p.set("dateFrom", window.dateFrom);
  if (window.dateTo) p.set("dateTo", window.dateTo);
  if (f.storeId) p.set("storeId", f.storeId);
  if (f.payer) p.set("payer", f.payer);
  if (f.category) p.set("category", f.category);
  const s = p.toString();
  return s ? `/expenses?${s}` : "/expenses";
}

export function filterValue(f: ReportFilters, dim: GroupBy): string | null {
  return f[FILTER_PARAM[dim]];
}

/**
 * Tapping a group row filters by it, then groups by the next dimension not yet filtered —
 * Who paid → Store → Category, wrapping. So "Iqbal Bhai's spend at BCH" is two taps.
 * When all three are filtered the grouping stays where it is.
 */
export function drillInto(f: ReportFilters, key: string): ReportFilters {
  const next: ReportFilters = { ...f, [FILTER_PARAM[f.groupBy]]: key };
  const at = GROUP_BY_ORDER.indexOf(f.groupBy);
  const after = [1, 2].map((i) => GROUP_BY_ORDER[(at + i) % GROUP_BY_ORDER.length]);
  return { ...next, groupBy: after.find((d) => !filterValue(next, d)) ?? f.groupBy };
}

/** "1 Oct – 12 Oct 2026", or "All dates". */
export function describeWindow(dateFrom: string | null, dateTo: string | null): string {
  if (!dateFrom && !dateTo) return "All dates";
  const fmt = (d: string, withYear: boolean) =>
    new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      ...(withYear && { year: "numeric" }),
    });
  if (dateFrom && dateTo) {
    return dateFrom === dateTo
      ? fmt(dateTo, true)
      : `${fmt(dateFrom, dateFrom.slice(0, 4) !== dateTo.slice(0, 4))} – ${fmt(dateTo, true)}`;
  }
  return dateFrom ? `From ${fmt(dateFrom, true)}` : `Up to ${fmt(dateTo as string, true)}`;
}
