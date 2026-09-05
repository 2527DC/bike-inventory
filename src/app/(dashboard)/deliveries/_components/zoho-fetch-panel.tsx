"use client";

import { Cloud, Search, Loader2, Phone } from "lucide-react";

/**
 * The Zoho picker, INLINE (R1).
 *
 * ─── WHY THIS IS NOT A MODAL ──────────────────────────────────────────────────────────────
 *
 * It was a `BottomSheetModal` with a two-tab bar. The owner asked for the fetch and import UI
 * to sit on the page, laid out like /stock, with no popup — a sheet hides the delivery list
 * behind it, so you cannot see what you already have while deciding what to pull, and on a
 * phone it covers the whole screen for what is three chips and a button.
 *
 * Purely presentational: every value and every handler comes from the parent, which owns the
 * request state. That is what makes the two modes ("Search" and "Bulk fetch") a segmented
 * toggle over one panel instead of two tabs over two duplicated panels — the old tab bar had
 * its own copy of the error banner and the result card in each tab.
 *
 * Rendered as a `w-full` flex item inside the page header's `flex-wrap` row, so it wraps onto
 * its own line under the title and the Fetch button.
 */

export type FetchMode = "search" | "fetch";

const DAY_CHIPS = [
  { label: "3 days", value: 3 },
  { label: "7 days", value: 7 },
  { label: "14 days", value: 14 },
  { label: "30 days", value: 30 },
  { label: "Custom", value: -1 },
];

interface ZohoFetchPanelProps {
  mode: FetchMode;
  onModeChange: (m: FetchMode) => void;

  // Search mode
  searchText: string;
  onSearchTextChange: (v: string) => void;
  onSearch: () => void;
  searching: boolean;

  // Bulk-fetch mode
  days: number;
  onDaysChange: (d: number) => void;
  customFrom: string;
  onCustomFromChange: (v: string) => void;
  customTo: string;
  onCustomToChange: (v: string) => void;
  onFetch: () => void;
  fetching: boolean;

  onCancel: () => void;
}

export function ZohoFetchPanel({
  mode,
  onModeChange,
  searchText,
  onSearchTextChange,
  onSearch,
  searching,
  days,
  onDaysChange,
  customFrom,
  onCustomFromChange,
  customTo,
  onCustomToChange,
  onFetch,
  fetching,
  onCancel,
}: ZohoFetchPanelProps) {
  const isPhone = /^\d{10,}$/.test(searchText.trim());
  const busy = searching || fetching;

  return (
    <div className="w-full bg-slate-50 border border-slate-200 rounded-lg p-3 mt-2">
      {/* Mode toggle. Replaces the tab bar, and the difference is not cosmetic: tabs owned
          separate copies of the banners and result cards, so a message could be showing on
          the tab you were not looking at. */}
      <div className="flex gap-1 bg-white border border-slate-200 rounded-lg p-0.5 mb-3 max-w-xs">
        {(["search", "fetch"] as const).map((m) => (
          <button
            key={m}
            onClick={() => onModeChange(m)}
            className={`flex-1 min-h-[36px] px-3 rounded-md text-xs font-medium transition-colors ${
              mode === m ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-50"
            }`}
          >
            {m === "search" ? "Find one" : "Fetch a range"}
          </button>
        ))}
      </div>

      {mode === "search" ? (
        <div className="flex gap-1.5 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <input
              type="text"
              placeholder="Invoice number or phone…"
              value={searchText}
              onChange={(e) => onSearchTextChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && searchText.trim()) onSearch();
              }}
              className="w-full px-3 min-h-[44px] text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-400 pr-8"
            />
            {isPhone && (
              <Phone className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-green-500" />
            )}
          </div>
          <button
            onClick={onSearch}
            disabled={busy || searchText.trim().length < 3}
            className="flex items-center gap-1 bg-slate-900 text-white px-4 min-h-[44px] rounded-lg text-xs font-medium disabled:opacity-50 shrink-0"
          >
            {searching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
            Search
          </button>
          <button
            onClick={onCancel}
            className="px-4 min-h-[44px] rounded-lg text-xs font-medium bg-white text-slate-500 border border-slate-300 shrink-0"
          >
            Close
          </button>
        </div>
      ) : (
        <>
          <p className="text-xs font-medium text-slate-700 mb-2">
            Fetch invoices created in Zoho within:
          </p>
          <div className="flex flex-wrap gap-2 mb-3">
            {DAY_CHIPS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => onDaysChange(opt.value)}
                className={`px-3 min-h-[36px] rounded-lg text-xs font-medium border transition-colors ${
                  days === opt.value
                    ? "bg-slate-900 text-white border-slate-900"
                    : "bg-white text-slate-600 border-slate-300 hover:border-slate-400"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {days === -1 && (
            <div className="flex gap-2 mb-3 flex-wrap">
              <div>
                <label className="text-[10px] text-slate-500 block mb-0.5">From</label>
                <input
                  type="date"
                  value={customFrom}
                  onChange={(e) => onCustomFromChange(e.target.value)}
                  className="px-2 min-h-[44px] text-xs border border-slate-300 rounded-lg"
                />
              </div>
              {/* The To date is finally WIRED. The input existed and the value was stored, but
                  it was never put in the request body, so a custom To silently did nothing. */}
              <div>
                <label className="text-[10px] text-slate-500 block mb-0.5">To (default today)</label>
                <input
                  type="date"
                  value={customTo}
                  onChange={(e) => onCustomToChange(e.target.value)}
                  className="px-2 min-h-[44px] text-xs border border-slate-300 rounded-lg"
                />
              </div>
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={onFetch}
              disabled={busy || (days === -1 && !customFrom)}
              className="flex items-center gap-1.5 px-4 min-h-[44px] rounded-lg text-xs font-medium bg-slate-900 text-white disabled:opacity-50"
            >
              {fetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Cloud className="h-3.5 w-3.5" />}
              Fetch
            </button>
            <button
              onClick={onCancel}
              className="px-4 min-h-[44px] rounded-lg text-xs font-medium bg-white text-slate-500 border border-slate-300"
            >
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  );
}
