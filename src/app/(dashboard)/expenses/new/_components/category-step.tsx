"use client";

import { Truck, Bus, Wrench, Zap, Banknote, Coffee, Pencil, Package, Check, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CATEGORY_LABELS, CATEGORY_ORDER, type ExpenseCategory } from "./types";

const CATEGORY_ICONS: Record<ExpenseCategory, LucideIcon> = {
  DELIVERY: Truck,
  TRANSPORT: Bus,
  SHOP_MAINTENANCE: Wrench,
  UTILITIES: Zap,
  SALARY_ADVANCE: Banknote,
  FOOD_TEA: Coffee,
  STATIONERY: Pencil,
  MISCELLANEOUS: Package,
};

interface CategoryStepProps {
  value: ExpenseCategory | null;
  onChange: (value: ExpenseCategory) => void;
  onNext: () => void;
}

/** Step 2 — the eight `ExpenseCategory` values as tappable cards (R4), not a `<select>`. */
export function CategoryStep({ value, onChange, onNext }: CategoryStepProps) {
  return (
    <div>
      <p className="text-sm font-medium text-slate-700 mb-2">What kind of expense?</p>
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Category">
        {CATEGORY_ORDER.map((key) => {
          const Icon = CATEGORY_ICONS[key];
          const selected = value === key;
          const { label, hint } = CATEGORY_LABELS[key];
          return (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(key)}
              className={`relative text-left rounded-xl border p-3 min-h-[72px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 ${
                selected
                  ? "border-blue-600 bg-blue-50 ring-1 ring-blue-600"
                  : "border-slate-200 bg-white hover:bg-slate-50"
              }`}
            >
              <Icon className={`h-5 w-5 mb-1.5 ${selected ? "text-blue-700" : "text-slate-500"}`} />
              <p className={`text-sm font-semibold leading-tight ${selected ? "text-blue-900" : "text-slate-900"}`}>{label}</p>
              <p className="text-[11px] text-slate-500 leading-tight mt-0.5">{hint}</p>
              {selected && (
                <span className="absolute top-2 right-2 h-5 w-5 rounded-full bg-blue-600 text-white flex items-center justify-center">
                  <Check className="h-3 w-3" />
                </span>
              )}
            </button>
          );
        })}
      </div>

      <Button type="button" size="lg" disabled={!value} onClick={onNext} className="w-full min-h-[48px] mt-6">
        Next
      </Button>
    </div>
  );
}
