"use client";

// Expense panel — one line or many (the bulk bar uses it too). Every expense names its store
// (plan 1210-expense-store-department-and-payer, R2/R6). The store is pre-selected from the
// statement's bank account when that account has one (plan 1210 bank, C2 "Overlap with plan A");
// with one active store it is that store; otherwise nothing is chosen until somebody taps one.
import { useState } from "react";
import { EXPENSE_CATEGORIES, type ExpenseStore } from "./types";

export function ExpenseStoreChips({
  stores,
  value,
  onChange,
  disabled,
}: {
  stores: ExpenseStore[];
  value: string;
  onChange: (storeId: string) => void;
  disabled?: boolean;
}) {
  if (stores.length === 0) {
    return (
      <p className="text-[11px] text-amber-700">
        No active store. Add one under Settings › Store management before recording an expense.
      </p>
    );
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {stores.map((s) => {
        const active = s.id === value;
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => onChange(s.id)}
            aria-pressed={active}
            disabled={disabled}
            className={`min-h-11 px-3 rounded-lg text-xs font-medium border disabled:opacity-50 ${
              active ? "bg-purple-600 border-purple-600 text-white" : "bg-white border-purple-200 text-purple-700 hover:bg-purple-100"
            }`}
          >
            {s.name}
          </button>
        );
      })}
    </div>
  );
}

export function ExpensePanel({
  stores,
  defaultStoreId,
  suggestedCategory,
  busy,
  heading,
  onPick,
}: {
  stores: ExpenseStore[];
  defaultStoreId: string;
  /** The AI's category key, outlined so it is easy to find. A hint, never pre-chosen. */
  suggestedCategory?: string | null;
  busy: boolean;
  heading?: string;
  onPick: (category: string, storeId: string) => void;
}) {
  const [tapped, setTapped] = useState(defaultStoreId);
  const storeId = stores.some((s) => s.id === tapped) ? tapped : stores.length === 1 ? stores[0].id : "";

  return (
    <div className="bg-purple-50 border border-purple-200 rounded-lg p-2.5 space-y-2">
      <p className="text-[11px] font-medium text-purple-700">{heading ?? "Store"}</p>
      <ExpenseStoreChips stores={stores} value={storeId} onChange={setTapped} disabled={busy} />
      <p className="text-[11px] font-medium text-purple-700">
        Expense type
        {!storeId && stores.length > 1 && <span className="text-amber-700 font-normal"> — pick the store first</span>}
      </p>
      <div className="grid grid-cols-2 gap-1.5">
        {EXPENSE_CATEGORIES.map((cat) => (
          <button
            key={cat.key}
            type="button"
            onClick={() => onPick(cat.key, storeId)}
            disabled={busy || !storeId}
            className={`min-h-11 px-2 rounded-lg text-xs font-medium bg-white border text-purple-700 hover:bg-purple-100 disabled:opacity-50 ${
              cat.key === suggestedCategory ? "border-purple-500 ring-1 ring-purple-400" : "border-purple-200"
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>
    </div>
  );
}
