"use client";

// Part F — link a debit line to a payment or expense ALREADY recorded (plan 1210 bank, Q11, D12).
//
// A payment entered on /payments/new and later seen on the statement is linked, not recorded a
// second time. Nothing is created and no bill moves: the payment moved its bill when it was
// recorded. The list is GET …/candidates — same amount (±₹0.01), within 30 days, not linked to
// another line yet, UTR matches first. The server re-checks the amount and refuses a record that
// another line already explains (409).
import { useEffect, useState } from "react";
import { Link2, Loader2 } from "lucide-react";
import { apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";
import { useReconcile } from "./context";
import { inr, shortDate, type AlreadyRecorded, type BankTxn } from "./types";

const log = createLogger("accounts:reconcile");

interface Candidate {
  kind: "payment" | "expense";
  id: string;
  amount: number;
  date: string;
  label: string;
  detail: string | null;
  reference: string | null;
  referenceMatch: boolean;
  dayGap: number;
}

type LoadState = { loading: boolean; error: string; candidates: Candidate[] };

/** "UTR matches" / "same day" / "3 days apart" — why a record is offered. */
export function evidence(r: { confidence?: AlreadyRecorded["confidence"]; referenceMatch?: boolean; dayGap: number }): string {
  if (r.confidence === "exact" || r.referenceMatch) return "UTR matches";
  return r.dayGap === 0 ? "same amount, same day" : `same amount, ${r.dayGap} day${r.dayGap === 1 ? "" : "s"} apart`;
}

export function LinkPanel({
  txn,
  busy,
  onLink,
}: {
  txn: BankTxn;
  busy: boolean;
  onLink: (kind: Candidate["kind"], recordId: string) => void;
}) {
  const { statementId } = useReconcile();
  const [load, setLoad] = useState<LoadState>({ loading: true, error: "", candidates: [] });

  useEffect(() => {
    let alive = true;
    void apiTry<{ candidates: Candidate[] }>(
      `/api/bank-statements/${statementId}/candidates?txnId=${encodeURIComponent(txn.id)}`
    ).then(({ data, error, status }) => {
      if (!alive) return;
      if (error) {
        log.error("link candidates load failed", { statementId, txnId: txn.id, status, message: error });
        setLoad({ loading: false, error, candidates: [] });
        return;
      }
      setLoad({ loading: false, error: "", candidates: data?.candidates ?? [] });
    });
    return () => {
      alive = false;
    };
  }, [statementId, txn.id]);

  return (
    <div className="bg-sky-50 border border-sky-200 rounded-lg p-2.5 space-y-2">
      <p className="text-[11px] font-medium text-sky-800">
        Link to a payment or expense already recorded — nothing new is created
      </p>
      {load.loading && (
        <p className="text-xs text-slate-500 flex items-center gap-1">
          <Loader2 className="h-3 w-3 animate-spin" /> Looking for {inr(txn.amount, 2)} recorded within 30 days…
        </p>
      )}
      {load.error && <p className="text-xs text-red-600">{load.error}</p>}
      {!load.loading && !load.error && load.candidates.length === 0 && (
        <p className="text-xs text-slate-600">
          Nothing recorded for {inr(txn.amount, 2)} within 30 days of this line, or it is already linked to another
          line. Record it as new instead.
        </p>
      )}
      <ul className="space-y-1.5">
        {load.candidates.map((c) => (
          <li key={`${c.kind}-${c.id}`} className="bg-white border border-sky-100 rounded-lg p-2 flex items-center gap-2">
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-slate-800 truncate">{c.label}</p>
              <p className="text-[11px] text-slate-500 truncate">
                {inr(c.amount, 2)} · {shortDate(c.date)}
                {c.reference ? ` · ${c.reference}` : ""}
              </p>
              {c.detail && <p className="text-[11px] text-slate-500 truncate">{c.detail}</p>}
              <p className={`text-[10px] ${c.referenceMatch ? "text-green-700 font-medium" : "text-slate-500"}`}>{evidence(c)}</p>
            </div>
            <button
              type="button"
              onClick={() => onLink(c.kind, c.id)}
              disabled={busy}
              className="shrink-0 min-h-11 px-3 flex items-center gap-1 bg-sky-600 text-white rounded-lg text-xs font-medium disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />} Link
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
