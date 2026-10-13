"use client";

// The Fetch Bills controls on /bills — the trigger in the header and the panels under it.
// State lives in useFetchBills(); these only draw it. Moved out of page.tsx (plan 1210).

import { Cloud, Download, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { formatCurrency, formatDay, type StoreOption } from "./shared";
import type { FetchBillsState } from "./use-fetch-bills";

const RANGE_CHIPS = [
  { label: "3 days", value: 3 },
  { label: "7 days", value: 7 },
  { label: "14 days", value: 14 },
  { label: "30 days", value: 30 },
  { label: "Custom", value: -1 },
];

export function FetchBillsTrigger({ f }: { f: FetchBillsState }) {
  const busy = f.step === "fetching" || f.step === "importing";
  return (
    <div className="flex items-center gap-1">
      <input
        type="text"
        placeholder="Bill no..."
        aria-label="Search Zoho for a bill number"
        value={f.search}
        onChange={(e) => f.setSearch(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && !busy && void f.run()}
        className="w-24 min-h-[44px] px-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-400"
      />
      {f.search.trim() ? (
        <button
          onClick={() => void f.run()}
          disabled={busy}
          className="flex min-h-[44px] items-center gap-1.5 bg-slate-900 text-white px-3 rounded-lg text-xs font-medium disabled:opacity-50"
        >
          {f.step === "fetching" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Cloud className="h-3.5 w-3.5" />}
          Search
        </button>
      ) : (
        <button
          onClick={() => f.setStep("pickDate")}
          disabled={busy}
          className="flex min-h-[44px] items-center gap-1.5 bg-slate-900 text-white px-3 rounded-lg text-xs font-medium disabled:opacity-50"
        >
          {f.step === "fetching" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Cloud className="h-3.5 w-3.5" />}
          {f.step === "fetching" ? "Fetching..." : "Fetch Bills"}
        </button>
      )}
    </div>
  );
}

export function FetchBillsPanel({ f, stores }: { f: FetchBillsState; stores: StoreOption[] }) {
  const newCount = f.previews.filter((p) => !f.isExisting(p)).length;
  const existingCount = f.previews.length - newCount;

  return (
    <>
      {/* Date picker */}
      {f.step === "pickDate" && (
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 mb-2">
          <p className="text-xs font-medium text-slate-700 mb-2">Fetch bills created in Zoho within:</p>
          <div className="flex flex-wrap gap-2 mb-3">
            {RANGE_CHIPS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => f.setDays(opt.value)}
                className={`min-h-[44px] px-3 rounded-lg text-xs font-medium border transition-colors ${
                  f.days === opt.value
                    ? "bg-slate-900 text-white border-slate-900"
                    : "bg-white text-slate-600 border-slate-300 hover:border-slate-400"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {f.days === -1 && (
            <div className="flex gap-2 mb-3">
              <div>
                <label className="text-[10px] text-slate-500 block mb-0.5">From</label>
                <input
                  type="date"
                  value={f.customFrom}
                  onChange={(e) => f.setCustomFrom(e.target.value)}
                  className="px-2 py-1.5 text-xs border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="text-[10px] text-slate-500 block mb-0.5">To (default today)</label>
                <input
                  type="date"
                  value={f.customTo}
                  onChange={(e) => f.setCustomTo(e.target.value)}
                  className="px-2 py-1.5 text-xs border border-slate-300 rounded-lg"
                />
              </div>
            </div>
          )}
          <div className="flex gap-2">
            <button
              onClick={() => void f.run()}
              disabled={f.days === -1 && !f.customFrom}
              className="flex min-h-[44px] items-center gap-1.5 px-4 rounded-lg text-xs font-medium bg-slate-900 text-white disabled:opacity-50"
            >
              <Cloud className="h-3.5 w-3.5" /> Fetch
            </button>
            <button
              onClick={() => f.setStep("idle")}
              className="min-h-[44px] px-4 rounded-lg text-xs font-medium bg-white text-slate-500 border border-slate-300"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Progress */}
      {f.step === "fetching" && f.progress && (
        <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-lg p-2.5 mb-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-600 shrink-0" />
          <span className="text-xs text-blue-700 font-medium">{f.progress}</span>
        </div>
      )}

      {f.error && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-2.5 mb-2 text-xs text-amber-700">
          {f.error}
          <button onClick={f.clearError} className="ml-2 underline">
            dismiss
          </button>
        </div>
      )}
      {f.notice && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-2.5 mb-2 text-xs text-green-700">
          {f.notice}
          <button onClick={f.clearNotice} className="ml-2 underline">
            dismiss
          </button>
        </div>
      )}

      {/* Selection */}
      {f.step === "selecting" && f.previews.length > 0 && (
        <Card className="mb-3 border-blue-200 bg-blue-50/50">
          <CardContent className="p-3">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <p className="text-xs font-semibold text-blue-800">
                {newCount} new bill{newCount !== 1 ? "s" : ""} from Zoho (Apr 1 onwards)
                {existingCount > 0 && <span className="font-normal text-blue-700"> · {existingCount} already in Bills</span>}
              </p>
              <div className="flex gap-2">
                <button onClick={f.cancel} className="min-h-[44px] px-2 text-xs text-slate-500 underline">
                  Cancel
                </button>
                <button
                  onClick={() => void f.importSelected()}
                  disabled={f.selected.size === 0 || f.importStore === ""}
                  className="flex min-h-[44px] items-center gap-1 bg-blue-600 text-white px-4 rounded-md text-xs font-medium disabled:opacity-50"
                >
                  <Download className="h-3 w-3" /> Import {f.selected.size}
                </button>
              </div>
            </div>

            {/* Part 2.2: the importer's store, for bills whose Zoho location is not linked to one. */}
            <label className="mb-2 flex flex-wrap items-center gap-2 text-xs text-slate-700">
              <span className="font-medium">These bills are for:</span>
              <select
                value={f.importStore}
                onChange={(e) => f.setImportStore(e.target.value)}
                className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-2 text-xs"
              >
                {f.importStore === "" && <option value="">Choose a store…</option>}
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name || s.code}
                  </option>
                ))}
                <option value="none">Not set — decide later on the bill</option>
              </select>
            </label>
            <p className="mb-2 text-[11px] text-slate-500">
              A bill whose Zoho location is linked to a store on /stores takes that store instead.
            </p>

            <div className="space-y-1.5 max-h-64 overflow-y-auto">
              {f.previews.map((bill) => {
                const existing = f.isExisting(bill);
                const items = bill.data.lineItems ?? [];
                return (
                  <label
                    key={bill.id}
                    className={`flex items-start gap-2 p-2 rounded-lg cursor-pointer transition-colors ${
                      f.selected.has(bill.id) ? "bg-blue-100 border border-blue-300" : "bg-white border border-slate-200"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={f.selected.has(bill.id)}
                      onChange={() => f.toggle(bill.id)}
                      className="mt-0.5 h-4 w-4 rounded"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-slate-900">{bill.data.billNumber}</span>
                        <span className="text-xs font-semibold text-slate-700 tabular-nums">{formatCurrency(bill.data.total)}</span>
                      </div>
                      <p className="text-[10px] text-slate-600">{bill.data.vendorName}</p>
                      <p className="text-[10px] text-slate-400">
                        {formatDay(bill.data.date)} | Due: {formatDay(bill.data.dueDate)}
                        {bill.data.locationName && ` | Zoho location: ${bill.data.locationName}`}
                      </p>
                      {existing && (
                        <p className="text-[10px] font-medium text-blue-700 mt-0.5">Already in Bills — importing links it to Zoho</p>
                      )}
                      {items.length > 0 && (
                        <p className="text-[10px] text-slate-400 mt-0.5">
                          {items.slice(0, 2).map((li) => `${li.name} x${li.quantity}`).join(" | ")}
                          {items.length > 2 && ` +${items.length - 2}`}
                        </p>
                      )}
                    </div>
                  </label>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {f.step === "importing" && (
        <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-lg p-3 mb-3">
          <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
          <span className="text-xs text-blue-700">Importing {f.selected.size} bills...</span>
        </div>
      )}
    </>
  );
}
