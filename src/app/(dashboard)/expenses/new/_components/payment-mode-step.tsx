"use client";

import { Button } from "@/components/ui/button";
import { PAYMENT_MODE_LABELS, PAYMENT_MODE_ORDER, type PaymentMode } from "./types";

interface PaymentModeStepProps {
  value: PaymentMode;
  onChange: (value: PaymentMode) => void;
  onNext: () => void;
}

/** Step 3 — Payment mode selection: UPI and Cash only. */
export function PaymentModeStep({ value, onChange, onNext }: PaymentModeStepProps) {
  return (
    <div>
      <p className="text-sm font-medium text-slate-700 mb-2">How was it paid?</p>
      <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-label="Payment mode">
        {PAYMENT_MODE_ORDER.map((mode) => {
          const selected = value === mode;
          return (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(mode)}
              className={`min-h-[52px] px-3 rounded-xl text-base font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 ${
                selected ? "bg-blue-600 text-white shadow-sm" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
              }`}
            >
              {PAYMENT_MODE_LABELS[mode]}
            </button>
          );
        })}
      </div>

      <Button type="button" size="lg" onClick={onNext} className="w-full min-h-[48px] mt-6">
        Next
      </Button>
    </div>
  );
}
