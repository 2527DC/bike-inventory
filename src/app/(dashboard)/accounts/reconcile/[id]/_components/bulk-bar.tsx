"use client";

// The bar that appears when lines are ticked (plan 1210 bank, C2 L3, C3).
//
// "Record N payments" picks ONE vendor and no bill. Each line then pays its OWN AI-suggested bill
// when that bill is the vendor's and its balance covers the line; the rest are advances (Q9 = a).
// Every line is its own transaction, so one refusal never undoes the others — the page shows the
// answer as "12 recorded — 9 against bills, 3 as advances. 1 refused: already handled."
import { useState } from "react";
import { Building2, CreditCard, Loader2, Receipt, X, XCircle } from "lucide-react";
import { useReconcile } from "./context";
import { ExpensePanel } from "./expense-panel";
import { filterVendors, useVendors } from "./use-vendors";
import { inr, type BankTxn } from "./types";

export type BulkBody =
  | { action: "confirm_payment"; vendorId: string }
  | { action: "confirm_expense"; storeId: string; category: string }
  | { action: "ignore" };

type Mode = "menu" | "vendor" | "expense";

const BTN = "min-h-11 flex-1 flex items-center justify-center gap-1.5 rounded-lg text-xs font-medium disabled:opacity-50";

export function BulkBar({
  lines,
  busy,
  error,
  onRun,
  onClear,
}: {
  lines: BankTxn[];
  busy: boolean;
  error: string;
  onRun: (body: BulkBody) => void;
  onClear: () => void;
}) {
  const { perms, expenseStores, defaultStoreId } = useReconcile();
  const [mode, setMode] = useState<Mode>("menu");
  const total = lines.reduce((s, t) => s + t.amount, 0);
  const allDebits = lines.every((t) => t.type === "DEBIT");
  const looksRecorded = lines.filter((t) => t.alreadyRecorded).length;

  return (
    <div className="fixed above-nav left-0 right-0 bg-white border-t border-slate-200 shadow-lg p-3 z-50 max-h-[75vh] overflow-y-auto">
      <div className="max-w-lg mx-auto space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-slate-700 font-medium">
            {lines.length} selected — {inr(total)}
          </p>
          <button
            type="button"
            onClick={() => {
              setMode("menu");
              onClear();
            }}
            disabled={busy}
            aria-label="Clear selection"
            className="min-h-11 min-w-11 flex items-center justify-center text-slate-500 disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {looksRecorded > 0 && mode !== "menu" && (
          <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2">
            {looksRecorded} of these look already recorded. Untick {looksRecorded === 1 ? "it" : "them"} and link one at a
            time, or the same money is booked twice.
          </p>
        )}

        {mode === "menu" && (
          <>
            {!allDebits && (
              <p className="text-[11px] text-slate-500">Credits are ticked — those can only be skipped together. Park them one at a time.</p>
            )}
            <div className="flex gap-2">
              {allDebits && perms.payment && (
                <button type="button" onClick={() => setMode("vendor")} disabled={busy} className={`${BTN} bg-blue-100 text-blue-700`}>
                  <Building2 className="h-3.5 w-3.5" /> Vendor
                </button>
              )}
              {allDebits && perms.expense && (
                <button type="button" onClick={() => setMode("expense")} disabled={busy} className={`${BTN} bg-purple-600 text-white`}>
                  <Receipt className="h-3.5 w-3.5" /> Expense
                </button>
              )}
              <button type="button" onClick={() => onRun({ action: "ignore" })} disabled={busy} className={`${BTN} bg-slate-200 text-slate-600`}>
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <XCircle className="h-3.5 w-3.5" />} Skip all
              </button>
            </div>
          </>
        )}

        {mode === "vendor" && <BulkVendor count={lines.length} busy={busy} onBack={() => setMode("menu")} onRun={onRun} />}

        {mode === "expense" && (
          <div className="space-y-2">
            <BackRow label={`Record ${lines.length} as expenses`} busy={busy} onBack={() => setMode("menu")} />
            <ExpensePanel
              stores={expenseStores}
              defaultStoreId={defaultStoreId}
              busy={busy}
              heading={`Store for ${lines.length} lines`}
              onPick={(category, storeId) => onRun({ action: "confirm_expense", category, storeId })}
            />
          </div>
        )}

        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
    </div>
  );
}

function BackRow({ label, busy, onBack }: { label: string; busy: boolean; onBack: () => void }) {
  return (
    <div className="flex items-center justify-between">
      <p className="text-[11px] font-medium text-slate-700">{label}</p>
      <button type="button" onClick={onBack} disabled={busy} className="min-h-11 px-2 text-xs text-slate-500 underline disabled:opacity-50">
        Back
      </button>
    </div>
  );
}

/** Its own component so the vendor list loads only when somebody opens it. */
function BulkVendor({
  count,
  busy,
  onBack,
  onRun,
}: {
  count: number;
  busy: boolean;
  onBack: () => void;
  onRun: (body: BulkBody) => void;
}) {
  const { vendors, error, loading } = useVendors();
  const [search, setSearch] = useState("");
  const [vendorId, setVendorId] = useState("");
  const shown = filterVendors(vendors, search);
  const chosen = vendors.find((v) => v.id === vendorId);
  const options = chosen && !shown.includes(chosen) ? [chosen, ...shown] : shown;
  const field = "w-full min-h-11 text-sm border border-slate-200 rounded-lg px-2.5 bg-white text-slate-700";

  return (
    <div className="space-y-2">
      <BackRow label={`Pay one vendor for ${count} lines`} busy={busy} onBack={onBack} />
      {error ? (
        <p className="text-xs text-amber-700">{error}</p>
      ) : (
        <>
          <input
            type="search"
            placeholder={loading ? "Loading vendors…" : "Search vendor…"}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            disabled={loading}
            className={field}
            aria-label="Search vendor"
          />
          <select value={vendorId} onChange={(e) => setVendorId(e.target.value)} disabled={loading || busy} className={field} aria-label="Vendor">
            <option value="">{loading ? "Loading…" : "Select vendor"}</option>
            {options.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name} ({v.code})
              </option>
            ))}
          </select>
        </>
      )}
      <p className="text-[11px] text-slate-500">
        Each line pays its own suggested bill when that bill is this vendor&apos;s and its balance covers the line. The
        rest are recorded as advances.
      </p>
      <button
        type="button"
        onClick={() => vendorId && onRun({ action: "confirm_payment", vendorId })}
        disabled={!vendorId || busy}
        className="w-full min-h-11 flex items-center justify-center gap-1.5 bg-green-600 text-white rounded-lg text-sm font-medium disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
        Record {count} payments
      </button>
    </div>
  );
}
