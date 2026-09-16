"use client";

import type { DeliveryZoneValue } from "@/lib/deliveries/zone";

interface ZonePickerProps {
  /** The row's zone. Set → only that side, read-only; null (not chosen) → both buttons (A30). */
  fixedZone: DeliveryZoneValue | null;
  isOutstation: boolean;
  onChange: (isOutstation: boolean) => void;
}

/** Inside / Outside Bangalore for the schedule form (plan 1609 A30, R21). */
export function ZonePicker({ fixedZone, isOutstation, onChange }: ZonePickerProps) {
  if (fixedZone) {
    const outs = fixedZone === "OUTSTATION";
    return (
      <p
        className={`inline-flex rounded-md px-2.5 py-1 text-xs font-semibold ${
          outs ? "bg-amber-50 text-amber-800" : "bg-blue-50 text-blue-800"
        }`}
      >
        {outs ? "Outstation delivery" : "Bangalore delivery"}
      </p>
    );
  }

  return (
    <div className="flex rounded-lg overflow-hidden border border-slate-200">
      <button
        type="button"
        onClick={() => onChange(false)}
        aria-pressed={!isOutstation}
        className={`flex-1 py-2 min-h-[44px] text-xs font-medium transition-colors ${
          !isOutstation ? "bg-blue-600 text-white" : "bg-slate-50 text-slate-600"
        }`}
      >
        Inside Bangalore
      </button>
      <button
        type="button"
        onClick={() => onChange(true)}
        aria-pressed={isOutstation}
        className={`flex-1 py-2 min-h-[44px] text-xs font-medium transition-colors ${
          isOutstation ? "bg-amber-600 text-white" : "bg-slate-50 text-slate-600"
        }`}
      >
        Outside Bangalore
      </button>
    </div>
  );
}

/** An auto-populated, read-only value in the schedule form. */
export function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <label className="text-xs text-slate-500">{label}</label>
      <div className="text-xs font-medium text-slate-900 bg-slate-50 rounded-lg px-3 py-2 border border-slate-100 break-words">
        {value}
      </div>
    </div>
  );
}
