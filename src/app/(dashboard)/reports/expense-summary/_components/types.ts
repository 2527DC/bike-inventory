// Shapes shared by the expense report's API (src/app/api/reports/expense-summary/route.ts) and
// its page. Plan 1210-expense-store-department-and-payer, Part E.
//
// Every `key` is directly usable as the matching /expenses query parameter, so a tapped row
// becomes a filter and "View these expenses" opens the list without translating anything:
//   payer     user:<userId> | name:<lower-cased typed name>   → ?payer=
//   store     <storeId> | none                                → ?storeId=
//   category  <ExpenseCategory>                                → ?category=
import type { DateRangeKey } from "@/components/date-filter";

export type GroupBy = "payer" | "store" | "category";

export const GROUP_BY_ORDER: readonly GroupBy[] = ["payer", "store", "category"];

export const GROUP_BY_LABELS: Record<GroupBy, string> = {
  payer: "Who paid",
  store: "Store",
  category: "Category",
};

/** The URL parameter each dimension filters by — the same name on the report and the list. */
export const FILTER_PARAM: Record<GroupBy, "payer" | "storeId" | "category"> = {
  payer: "payer",
  store: "storeId",
  category: "category",
};

export interface SummaryGroup {
  key: string;
  label: string;
  amount: number;
  count: number;
  /** Share of `total`, one decimal. */
  percentage: number;
}

export interface ExpenseSummary {
  /** The IST days the report covered, inclusive; null on "All dates". */
  dateFrom: string | null;
  dateTo: string | null;
  total: number;
  totalCount: number;
  /** Rupees per day over the window, counted up to today at the latest. */
  dailyAvg: number;
  groupBy: GroupBy;
  groups: SummaryGroup[];
  options: {
    /** Active stores — the page adds "All" and "No store" itself. */
    stores: { id: string; name: string }[];
    /** Everyone who paid in the date window, whatever the other filters say. */
    payers: { key: string; label: string }[];
  };
}

/** The report's own state, all of it in the URL so Back from /expenses restores it. */
export interface ReportFilters {
  range: DateRangeKey;
  /** Only meaningful for "custom"; presets are worked out from `range` on every render. */
  dateFrom: string | null;
  dateTo: string | null;
  storeId: string | null;
  payer: string | null;
  category: string | null;
  groupBy: GroupBy;
}

export function formatRupees(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}
