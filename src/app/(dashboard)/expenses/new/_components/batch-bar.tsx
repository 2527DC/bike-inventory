"use client";

import { AlertTriangle, CalendarDays, Check, Store } from "lucide-react";
import type { StoreOption } from "./types";

interface BatchBarProps {
  date: string;
  onDateChange: (date: string) => void;
  /** Active stores, from GET /api/expenses/options. */
  stores: StoreOption[];
  /** The store this expense is charged to, or null while none is picked. */
  storeId: string | null;
  onStoreChange: (storeId: string) => void;
  /** True while the expense is being saved. */
  disabled?: boolean;
}

/**
 * The two values set once, above the steps (the name is left from the removed batch flow): the
 * date, defaulted to today, and the store the expense is charged to (plan 1210, R2 / E5).
 *
 * One active store — production today — is shown as a fixed chip, already selected. Several are
 * one button each; the page pre-selects the person's own store when it is one of them, and
 * otherwise nothing is selected and the bar says so in amber. A store added under
 * Settings › Store management appears here with no code change.
 */
export function BatchBar({ date, onDateChange, stores, storeId, onStoreChange, disabled }: BatchBarProps) {
  const only = stores.length === 1 ? stores[0] : null;

  return (
    <div className="max-w-lg mx-auto mb-4 rounded-xl border border-slate-200 bg-slate-50 p-3 grid grid-cols-2 gap-3">
      {/* Full width when the store buttons need a row of their own. */}
      <label className={`block min-w-0 ${only ? "" : "col-span-2"}`}>
        <span className="flex items-center gap-1 text-[11px] font-medium text-slate-500 uppercase tracking-wide mb-1">
          <CalendarDays className="h-3 w-3" /> Date
        </span>
        <input
          type="date"
          value={date}
          onChange={(e) => onDateChange(e.target.value)}
          disabled={disabled}
          className="w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-slate-900 disabled:opacity-50"
        />
      </label>

      {only ? (
        <div className="min-w-0">
          <span className="flex items-center gap-1 text-[11px] font-medium text-slate-500 uppercase tracking-wide mb-1">
            <Store className="h-3 w-3" /> Store
          </span>
          <div
            className="min-h-[44px] flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-2 text-sm font-medium text-blue-800"
            aria-readonly="true"
            title={`${only.name} (${only.code}) is the only active store`}
          >
            <Check className="h-4 w-4 shrink-0" />
            <span className="truncate">{only.name}</span>
          </div>
        </div>
      ) : (
        <div className="col-span-2 min-w-0">
          <span className="flex items-center gap-1 text-[11px] font-medium text-slate-500 uppercase tracking-wide mb-1">
            <Store className="h-3 w-3" /> Store
            {!storeId && stores.length > 0 && (
              <span className="ml-auto flex items-center gap-1 normal-case tracking-normal text-xs font-semibold text-amber-700">
                <AlertTriangle className="h-3 w-3" /> Pick the store
              </span>
            )}
          </span>

          {stores.length === 0 ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
              No store is active. Add one under Settings › Store management.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Store">
              {stores.map((s) => {
                const selected = storeId === s.id;
                return (
                  <button
                    key={s.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => onStoreChange(s.id)}
                    disabled={disabled}
                    title={s.code}
                    className={`min-h-[44px] min-w-0 px-2 rounded-lg border text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 disabled:opacity-50 ${
                      selected
                        ? "border-blue-600 bg-blue-600 text-white shadow-sm"
                        : !storeId
                          ? "border-amber-300 bg-white text-slate-700 hover:bg-amber-50"
                          : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
                    }`}
                  >
                    <span className="block truncate">{s.name}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
