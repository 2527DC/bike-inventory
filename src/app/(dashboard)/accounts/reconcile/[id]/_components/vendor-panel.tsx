"use client";

// Vendor panel of one debit line: pick the vendor, then — optionally — the bill it pays.
//
// The bill picker loads that vendor's bills when the vendor is chosen
// (`/api/bills?vendorId=…&limit=100`) and keeps PENDING, PARTIALLY_PAID and OVERDUE — a part-paid
// or overdue bill used to be missing, so its next instalment became an "advance" (D13). A 403 from
// /api/vendors or /api/bills says which grant is missing instead of showing an empty list.
import { useEffect, useState } from "react";
import { CreditCard, Loader2 } from "lucide-react";
import { apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";
import { NO_BILLS, filterVendors, useVendors } from "./use-vendors";
import { inr, type BankTxn, type OpenBill } from "./types";

const log = createLogger("accounts:reconcile");

const OPEN_STATUSES = new Set(["PENDING", "PARTIALLY_PAID", "OVERDUE"]);
const EPS = 0.01;

type BillsState = { state: "idle" | "loading" | "ready" | "error"; bills: OpenBill[]; error: string };

export function VendorPanel({
  txn,
  busy,
  onRecord,
}: {
  txn: BankTxn;
  busy: boolean;
  onRecord: (vendorId: string, billId: string | undefined) => void;
}) {
  const { vendors, error: vendorError, loading: vendorsLoading } = useVendors();
  const [search, setSearch] = useState("");
  // Start from the AI's vendor and bill, when it named them — a person still has to press Record.
  const [vendorId, setVendorId] = useState(txn.suggestedVendor?.id ?? "");
  const [billId, setBillId] = useState(
    txn.suggestedBill && txn.suggestedBill.vendorId === txn.suggestedVendor?.id ? txn.suggestedBill.id : ""
  );
  const [bills, setBills] = useState<BillsState>({
    state: txn.suggestedVendor ? "loading" : "idle",
    bills: [],
    error: "",
  });

  useEffect(() => {
    if (!vendorId) return;
    let alive = true;
    void apiTry<OpenBill[]>(`/api/bills?vendorId=${encodeURIComponent(vendorId)}&limit=100`).then(({ data, error, status }) => {
      if (!alive) return;
      if (error) {
        log.error("vendor bills load failed", { vendorId, status, message: error });
        setBills({ state: "error", bills: [], error: status === 403 ? NO_BILLS : error });
        return;
      }
      const open = (data ?? []).filter((b) => OPEN_STATUSES.has(b.status) && b.amount - b.paidAmount > EPS);
      setBills({ state: "ready", bills: open, error: "" });
    });
    return () => {
      alive = false;
    };
  }, [vendorId]);

  const chooseVendor = (next: string) => {
    setVendorId(next);
    setBillId("");
    setBills({ state: next ? "loading" : "idle", bills: [], error: "" });
  };

  const shown = filterVendors(vendors, search);
  // A chosen vendor stays in the list even when the search no longer matches it.
  const chosen = vendors.find((v) => v.id === vendorId);
  const options = chosen && !shown.includes(chosen) ? [chosen, ...shown] : shown;
  const pickedBill = bills.bills.find((b) => b.id === billId);
  const field = "w-full min-h-11 text-sm border border-slate-200 rounded-lg px-2.5 bg-white text-slate-700";

  return (
    <div className="bg-slate-50 border border-slate-200 rounded-lg p-2.5 space-y-2">
      <p className="text-[11px] font-medium text-slate-600">Record as a payment to</p>
      {vendorError ? (
        <p className="text-xs text-amber-700">{vendorError}</p>
      ) : (
        <>
          <input
            type="search"
            placeholder={vendorsLoading ? "Loading vendors…" : "Search vendor…"}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            disabled={vendorsLoading}
            className={field}
            aria-label="Search vendor"
          />
          <select
            value={vendorId}
            onChange={(e) => chooseVendor(e.target.value)}
            disabled={vendorsLoading || busy}
            className={field}
            aria-label="Vendor"
          >
            <option value="">{vendorsLoading ? "Loading…" : "Select vendor"}</option>
            {options.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name} ({v.code})
              </option>
            ))}
          </select>
        </>
      )}

      {vendorId && bills.state === "loading" && (
        <p className="text-[11px] text-slate-500 flex items-center gap-1">
          <Loader2 className="h-3 w-3 animate-spin" /> Loading this vendor&apos;s open bills…
        </p>
      )}
      {vendorId && bills.state === "error" && <p className="text-xs text-amber-700">{bills.error}</p>}
      {vendorId && bills.state === "ready" && bills.bills.length === 0 && (
        <p className="text-[11px] text-slate-500">No open bills for this vendor — it will be recorded as an advance.</p>
      )}
      {vendorId && bills.state === "ready" && bills.bills.length > 0 && (
        <select
          value={pickedBill ? billId : ""}
          onChange={(e) => setBillId(e.target.value)}
          disabled={busy}
          className={field}
          aria-label="Bill"
        >
          <option value="">No bill (advance)</option>
          {bills.bills.map((b) => {
            const left = b.amount - b.paidAmount;
            const tooSmall = txn.amount > left + EPS;
            return (
              <option key={b.id} value={b.id} disabled={tooSmall}>
                {b.billNo} — {inr(left)} left{b.status === "OVERDUE" ? " · overdue" : ""}
                {tooSmall ? " · less than this payment" : ""}
              </option>
            );
          })}
        </select>
      )}

      <button
        type="button"
        onClick={() => onRecord(vendorId, pickedBill?.id)}
        disabled={!vendorId || busy || bills.state === "loading"}
        className="w-full min-h-11 flex items-center justify-center gap-1.5 bg-green-600 text-white rounded-lg text-sm font-medium disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
        Record payment {inr(txn.amount, 2)}
        {vendorId && !pickedBill && bills.state !== "loading" ? " as advance" : ""}
      </button>
    </div>
  );
}
