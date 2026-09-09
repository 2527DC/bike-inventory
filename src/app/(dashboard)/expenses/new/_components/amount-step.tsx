"use client";

import { Button } from "@/components/ui/button";
import { parseAmount, sanitizeAmount, formatCurrency } from "./types";

interface AmountStepProps {
  value: string;
  onChange: (value: string) => void;
  onNext: () => void;
}

/** Step 1 — the amount. One big field, a phone's decimal keypad, nothing else on the screen. */
export function AmountStep({ value, onChange, onNext }: AmountStepProps) {
  const amount = parseAmount(value);
  const valid = amount !== null;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onNext();
      }}
    >
      <label htmlFor="expense-amount" className="block text-sm font-medium text-slate-700 mb-2">
        How much was spent?
      </label>
      <div className="relative">
        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-2xl font-semibold text-slate-400 pointer-events-none">₹</span>
        <input
          id="expense-amount"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          autoFocus
          placeholder="0"
          value={value}
          onChange={(e) => onChange(sanitizeAmount(e.target.value))}
          className="w-full h-16 pl-11 pr-4 rounded-xl border border-slate-300 bg-white text-3xl font-bold tabular-nums text-slate-900 placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent"
        />
      </div>
      <p className="mt-2 text-xs text-slate-500 min-h-[1rem]">
        {valid ? formatCurrency(amount) : value ? "Enter an amount above zero." : "Rupees, with paise if needed."}
      </p>

      <Button type="submit" size="lg" disabled={!valid} className="w-full min-h-[48px] mt-6">
        Next
      </Button>
    </form>
  );
}
