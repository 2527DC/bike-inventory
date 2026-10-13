"use client";

import Link from "next/link";
import { ArrowRight, ChevronRight, Receipt } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { GROUP_BY_LABELS, GROUP_BY_ORDER, formatRupees, type ExpenseSummary, type GroupBy, type SummaryGroup } from "./types";
import { describeWindow } from "./url-state";

interface TotalProps {
  data: ExpenseSummary;
  /** /expenses with the same filters; null hides the link (no expenses.view grant). */
  listHref: string | null;
}

/** "₹12,450 · 31 expenses · ₹415 a day", and the way to the expenses behind it. */
export function TotalCard({ data, listHref }: TotalProps) {
  return (
    <Card className="mb-3 border-red-200 bg-red-50">
      <CardContent className="p-3">
        <p className="text-[11px] text-red-600">{describeWindow(data.dateFrom, data.dateTo)}</p>
        <p className="text-2xl font-bold text-red-700 tabular-nums">{formatRupees(data.total)}</p>
        <p className="text-xs text-red-600 tabular-nums">
          {data.totalCount} {data.totalCount === 1 ? "expense" : "expenses"} · {formatRupees(data.dailyAvg)} a day
        </p>
        {listHref && data.totalCount > 0 && (
          <Link
            href={listHref}
            className="mt-2 -mb-1 inline-flex min-h-[44px] items-center gap-1 text-sm font-semibold text-blue-700 hover:text-blue-800 focus-ring"
          >
            View these expenses <ArrowRight className="h-4 w-4" />
          </Link>
        )}
      </CardContent>
    </Card>
  );
}

export function GroupByPills({ value, onChange }: { value: GroupBy; onChange: (g: GroupBy) => void }) {
  return (
    <div className="mb-3">
      <p className="mb-1 text-xs font-medium text-slate-500" id="expense-group-by">Group by</p>
      <div role="group" aria-labelledby="expense-group-by" className="flex gap-1 rounded-xl bg-slate-100 p-1">
        {GROUP_BY_ORDER.map((g) => (
          <button
            key={g}
            type="button"
            aria-pressed={value === g}
            onClick={() => onChange(g)}
            className={`flex min-h-[44px] flex-1 items-center justify-center rounded-lg px-2 text-xs font-semibold transition-all focus-ring ${
              value === g ? "bg-white text-blue-700 shadow-xs" : "text-slate-600 hover:text-slate-900"
            }`}
          >
            {GROUP_BY_LABELS[g]}
          </button>
        ))}
      </div>
    </div>
  );
}

interface GroupListProps {
  groups: SummaryGroup[];
  groupBy: GroupBy;
  onPick: (group: SummaryGroup) => void;
}

/** One row per person / store / category. Tapping a row filters by it (see drillInto). */
export function GroupList({ groups, groupBy, onPick }: GroupListProps) {
  return (
    <div className="space-y-2">
      <p className="text-[11px] text-slate-400">Tap a row to see only its expenses.</p>
      {groups.map((g) => (
        <button
          key={g.key}
          type="button"
          onClick={() => onPick(g)}
          aria-label={`Filter by ${GROUP_BY_LABELS[groupBy]}: ${g.label}`}
          className="block w-full rounded-xl border border-slate-200 bg-white p-3 text-left shadow-sm transition-colors hover:border-slate-300 focus-ring"
        >
          <div className="flex items-center justify-between gap-2">
            <p className="min-w-0 truncate text-sm font-medium text-slate-900" title={g.label}>{g.label}</p>
            <div className="flex shrink-0 items-center gap-1">
              <p className="text-sm font-bold text-slate-900 tabular-nums">{formatRupees(g.amount)}</p>
              <ChevronRight className="h-4 w-4 text-slate-400" />
            </div>
          </div>
          <div className="mt-0.5 flex items-center justify-between text-xs text-slate-500 tabular-nums">
            <span>{g.count} {g.count === 1 ? "expense" : "expenses"}</span>
            <span>{g.percentage}%</span>
          </div>
          <div className="mt-1.5 h-1.5 w-full rounded-full bg-slate-200">
            <div className="h-1.5 rounded-full bg-blue-500" style={{ width: `${Math.min(100, g.percentage)}%` }} />
          </div>
        </button>
      ))}
    </div>
  );
}

export function EmptyState({ onClear }: { onClear: (() => void) | null }) {
  return (
    <div className="py-10 text-center">
      <Receipt className="mx-auto mb-2 h-8 w-8 text-slate-300" />
      <p className="text-sm text-slate-500">No expenses in this period.</p>
      {onClear && (
        <button
          type="button"
          onClick={onClear}
          className="mt-2 min-h-[44px] px-3 text-sm font-medium text-blue-700 underline focus-ring"
        >
          Clear the filters
        </button>
      )}
    </div>
  );
}
