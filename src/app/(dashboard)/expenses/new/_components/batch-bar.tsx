"use client";

import { CalendarDays, Lock } from "lucide-react";

interface BatchBarProps {
  date: string;
  onDateChange: (date: string) => void;
  /** The signed-in user's name. Shown, never typed (decision D2). */
  payer: string;
}

/**
 * The two values shared by every expense in the batch (D6): the date, defaulted to today and
 * editable in one place, and the payer, locked to the signed-in user.
 */
export function BatchBar({ date, onDateChange, payer }: BatchBarProps) {
  return (
    <div className="max-w-lg mx-auto mb-4 rounded-xl border border-slate-200 bg-slate-50 p-3 grid grid-cols-2 gap-3">
      <label className="block min-w-0">
        <span className="flex items-center gap-1 text-[11px] font-medium text-slate-500 uppercase tracking-wide mb-1">
          <CalendarDays className="h-3 w-3" /> Date
        </span>
        <input
          type="date"
          value={date}
          onChange={(e) => onDateChange(e.target.value)}
          className="w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-slate-900"
        />
      </label>
      <div className="min-w-0">
        <span className="flex items-center gap-1 text-[11px] font-medium text-slate-500 uppercase tracking-wide mb-1">
          <Lock className="h-3 w-3" /> Paid by
        </span>
        <div
          className="min-h-[44px] flex items-center rounded-lg border border-slate-200 bg-slate-100 px-2 text-sm font-medium text-slate-700 truncate"
          aria-readonly="true"
          title="Expenses are recorded under your own name"
        >
          {payer || "—"}
        </div>
      </div>
    </div>
  );
}
