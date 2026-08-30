"use client";

import { useEffect, useRef, useState } from "react";
import { SlidersHorizontal, X } from "lucide-react";
import { DateFilter, type DateRangeKey } from "@/components/date-filter";

export interface FilterGroup {
  /** Section heading shown in the sheet, e.g. "Status" */
  label: string;
  /** Currently selected option key */
  value: string;
  /** Key treated as "no filter" (usually "ALL"); used for active-count + reset */
  defaultValue: string;
  options: { key: string; label: string }[];
  onChange: (key: string) => void;
}

interface FilterSheetProps {
  /** Optional date-range filter. Omit on pages without dates. */
  dateValue?: DateRangeKey;
  onDateChange?: (key: DateRangeKey, from?: string, to?: string) => void;
  /** One or more chip groups (status, type, …). */
  groups?: FilterGroup[];
  className?: string;
}

const DATE_LABELS: Record<DateRangeKey, string> = {
  all: "All dates", today: "Today", "3days": "3 Days", week: "This Week", month: "This Month", custom: "Custom",
};

/**
 * Single "Filter" button that opens a right-hand DRAWER holding a date range and any number
 * of chip groups. Selections apply immediately; the drawer just houses them. Active filters
 * surface as read-only chips next to the button.
 *
 * It was a bottom sheet — `justify-end` + `rounded-t-2xl`, a phone pattern — which is what it
 * looked like on a wide screen: a panel sliding up from the bottom of a monitor. Now a drawer
 * at every width, full-width below `sm` where the viewport is narrow anyway.
 *
 * ⚠️ USED BY TWELVE SCREENS: bills, expenses, inbound, prebookings, purchase-orders,
 * receivables, reorder, second-hand, stock-audit, transfers, vendor-issues, vendors. The props
 * and call signature are unchanged, so all twelve moved together with no page edits — which is
 * the reason to fix it here rather than in any one page. Changing this component changes all
 * of them; that is the point, and worth knowing before editing it.
 */
export function FilterSheet({ dateValue, onDateChange, groups = [], className = "" }: FilterSheetProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Esc closes, focus moves into the drawer on open and RETURNS to the Filter button on
  // close. Without the return, closing leaves focus on a detached node and a keyboard user
  // is dropped back at the top of the document.
  useEffect(() => {
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);

    // Focus the panel itself rather than the first control: the drawer is a container, and
    // moving straight to a chip would skip the heading a screen reader needs to hear.
    panelRef.current?.focus();

    // The page behind must not scroll while the drawer is open.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      triggerRef.current?.focus();
    };
  }, [open]);

  const hasDate = !!onDateChange && dateValue !== undefined;
  const dateActive = hasDate && dateValue !== "all";
  const activeGroups = groups.filter((g) => g.value !== g.defaultValue);
  const activeCount = (dateActive ? 1 : 0) + activeGroups.length;

  const reset = () => {
    if (hasDate && onDateChange) onDateChange("all");
    groups.forEach((g) => g.onChange(g.defaultValue));
  };

  return (
    <div className={className}>
      <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide">
        <button
          ref={triggerRef}
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={open}
          className="shrink-0 flex items-center gap-1.5 px-3 min-h-[40px] rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-700 hover:border-slate-400 cursor-pointer transition-colors"
        >
          <SlidersHorizontal className="h-4 w-4" />
          Filter
          {activeCount > 0 && (
            <span className="inline-flex items-center justify-center h-5 min-w-[20px] px-1 rounded-full bg-blue-600 text-white text-[10px] font-semibold">
              {activeCount}
            </span>
          )}
        </button>

        {/* Read-only chips showing what's active */}
        {dateActive && (
          <span className="shrink-0 text-[11px] font-medium px-2.5 py-1 rounded-full bg-blue-600 text-white">
            {DATE_LABELS[dateValue]}
          </span>
        )}
        {activeGroups.map((g) => (
          <span key={g.label} className="shrink-0 text-[11px] font-medium px-2.5 py-1 rounded-full bg-slate-900 text-white">
            {g.options.find((o) => o.key === g.value)?.label}
          </span>
        ))}
        {activeCount > 0 && (
          <button onClick={reset} className="shrink-0 text-xs text-slate-500 underline cursor-pointer">
            Clear
          </button>
        )}
      </div>

      {open && (
        <div
          className="fixed inset-0 z-[60] flex justify-end"
          role="dialog"
          aria-modal="true"
          aria-label="Filters"
        >
          {/* Backdrop closes too — a second way out, never the only one. */}
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />

          {/* Full width below sm, a fixed panel above it. h-full + overflow-y-auto so the
              drawer scrolls internally and long filter lists never push the page. */}
          <div
            ref={panelRef}
            tabIndex={-1}
            className="relative w-full sm:w-80 h-full bg-white shadow-xl p-4 pb-safe overflow-y-auto focus:outline-none drawer-in"
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-bold text-slate-900">Filters</h2>
              <button
                onClick={() => setOpen(false)}
                className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 cursor-pointer"
                aria-label="Close filters"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {hasDate && onDateChange && (
              <>
                <p className="text-xs font-semibold text-slate-500 uppercase mb-2">Date Range</p>
                <DateFilter value={dateValue} onChange={onDateChange} className="mb-5" />
              </>
            )}

            {groups.map((g) => (
              <div key={g.label} className="mb-5">
                <p className="text-xs font-semibold text-slate-500 uppercase mb-2">{g.label}</p>
                <div className="flex flex-wrap gap-2">
                  {g.options.map((o) => (
                    <button
                      key={o.key}
                      onClick={() => g.onChange(o.key)}
                      className={`min-h-[40px] px-3.5 rounded-full text-sm font-medium cursor-pointer transition-colors ${
                        g.value === o.key ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                      }`}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}

            <div className="flex gap-2">
              <button
                onClick={reset}
                className="flex-1 min-h-[44px] rounded-lg border border-slate-300 text-sm font-medium text-slate-600 hover:bg-slate-50 cursor-pointer"
              >
                Reset
              </button>
              {/* Selections already applied on click — this only dismisses. "Done" implied
                  a commit step that does not exist. */}
              <button
                onClick={() => setOpen(false)}
                className="flex-1 min-h-[44px] rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
