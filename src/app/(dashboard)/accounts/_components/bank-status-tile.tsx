"use client";

// The weekly bank reconciliation tile on /accounts (plan 1210-bank-accounts-and-suspense, R5,
// D17, §3 E3): one card per active account — "reconciled up to <date>", lines still to review,
// lines in suspense, a missing statement — red when more than 7 days behind.
//
// Its own request, skeleton and error line, so a failing tile never blanks the hub. It loads
// with the page and when a person presses Retry — no timer, no polling (no scheduler in this app).
import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Upload, ListChecks, RefreshCw } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";
import { daysAgo } from "./bank-labels";
import { accountChipLabel, dayLabel } from "../bank-accounts/_components/types";

const log = createLogger("accounts:hub");

/** One row of GET /api/bank-accounts/status. */
interface AccountStatus {
  id: string;
  name: string;
  bank: string;
  accountLast4: string | null;
  store: { id: string; code: string; name: string } | null;
  reconcileFrom: string | null;
  start: string | null;
  reconciledUpTo: string | null;
  daysBehind: number | null;
  stale: boolean;
  coveredTo: string | null;
  missing: { from: string; to: string } | null;
  unmatched: number;
  suspense: number;
  statementCount: number;
  lastUpload: { statementId: string; at: string; by: string; from: string | null; to: string | null } | null;
  firstOpen: { txnId: string; statementId: string; date: string } | null;
}

interface StatusResponse {
  today: string;
  accounts: AccountStatus[];
}

export function BankStatusTile() {
  const [reloadKey, setReloadKey] = useState(0);
  const [result, setResult] = useState<{ key: number; data: StatusResponse | null; error: string | null } | null>(null);
  const loading = result?.key !== reloadKey;

  useEffect(() => {
    let cancelled = false;
    const key = reloadKey;
    apiTry<StatusResponse>("/api/bank-accounts/status").then(({ data, error, status }) => {
      if (cancelled) return;
      if (error || !data) {
        log.error("bank status failed", { status, message: error });
        setResult({ key, data: null, error: error ?? "Could not load the bank reconciliation status" });
        return;
      }
      log.debug("bank status loaded", { accounts: data.accounts.length, stale: data.accounts.filter((a) => a.stale).length });
      setResult({ key, data, error: null });
    });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  return (
    <section aria-labelledby="bank-recon-heading" className="mb-4">
      <h2 id="bank-recon-heading" className="text-sm font-semibold text-slate-900 mb-2">
        Bank reconciliation
      </h2>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" aria-busy="true">
          {[0, 1].map((i) => (
            <div key={i} className="h-36 rounded-xl border border-slate-100 bg-slate-50 animate-pulse" />
          ))}
        </div>
      ) : result?.error || !result?.data ? (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-1">
          <p className="flex-1 text-xs text-red-700">{result?.error ?? "Could not load the bank reconciliation status"}</p>
          <button type="button" onClick={() => setReloadKey((k) => k + 1)}
            className="shrink-0 min-h-[44px] px-2 inline-flex items-center gap-1 text-xs font-medium text-red-700 focus-ring rounded">
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Retry
          </button>
        </div>
      ) : result.data.accounts.length === 0 ? (
        <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-600">
          No bank accounts yet.{" "}
          <Link href="/accounts/bank-accounts" className="font-medium text-blue-600 underline">
            Add them on Bank accounts
          </Link>{" "}
          to see how far each is reconciled.
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {result.data.accounts.map((a) => (
            <AccountCard key={a.id} a={a} />
          ))}
        </div>
      )}
    </section>
  );
}

function reconciledSentence(a: AccountStatus): string {
  if (a.reconciledUpTo) {
    return `Reconciled up to ${dayLabel(a.reconciledUpTo, { weekday: true, year: false })} (${daysAgo(a.daysBehind ?? 0)})`;
  }
  if (a.statementCount === 0) return "No statement uploaded";
  if (a.missing) return "Not reconciled — a statement is missing";
  return a.start ? `No statement from ${dayLabel(a.start, { year: false })} yet` : "Not reconciled yet";
}

function AccountCard({ a }: { a: AccountStatus }) {
  const review = a.firstOpen
    ? `/accounts/reconcile/${a.firstOpen.statementId}?txn=${a.firstOpen.txnId}`
    : a.lastUpload
      ? `/accounts/reconcile/${a.lastUpload.statementId}`
      : null;
  const btn = "flex-1 min-h-[44px] inline-flex items-center justify-center gap-1.5 rounded-lg text-xs font-semibold focus-ring";

  return (
    <Card className={a.stale ? "border-red-200" : "border-green-200"}>
      <CardContent className="p-3 space-y-1.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-900 truncate tabular-nums">{accountChipLabel(a)}</p>
            <p className={`text-[11px] ${a.store ? "text-slate-500" : "text-amber-700"}`}>{a.store?.name ?? "Store not set"}</p>
          </div>
          <span className="shrink-0 inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide">
            <span className={`h-2.5 w-2.5 rounded-full ${a.stale ? "bg-red-500" : "bg-green-500"}`} aria-hidden="true" />
            <span className={a.stale ? "text-red-700" : "text-green-700"}>{a.stale ? "Behind" : "Up to date"}</span>
          </span>
        </div>

        <p className={`text-xs font-medium tabular-nums ${a.stale ? "text-red-700" : "text-slate-800"}`}>{reconciledSentence(a)}</p>

        <p className="text-xs text-slate-600 tabular-nums">
          {a.unmatched} unmatched ·{" "}
          <Link href={`/accounts/suspense?account=${a.id}`}
            className={`underline-offset-2 hover:underline focus-ring rounded ${a.suspense > 0 ? "font-semibold text-amber-700" : "text-slate-600"}`}>
            {a.suspense} in suspense
          </Link>
        </p>

        {a.missing && (
          <p className="flex items-center gap-1 text-xs font-medium text-red-700">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            Missing statement {dayLabel(a.missing.from, { year: false })} – {dayLabel(a.missing.to, { year: false })}
          </p>
        )}

        {a.lastUpload && (
          <p className="text-[11px] text-slate-400 truncate">
            Last upload {new Date(a.lastUpload.at).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" })}{" "}
            by {a.lastUpload.by}
          </p>
        )}

        <div className="flex gap-2 pt-1">
          <Link href={`/accounts/bank-upload?account=${a.id}`} className={`${btn} bg-blue-600 text-white hover:bg-blue-700`}>
            <Upload className="h-3.5 w-3.5" aria-hidden="true" /> Upload
          </Link>
          {review ? (
            <Link href={review} className={`${btn} border border-slate-300 bg-white text-slate-700 hover:bg-slate-50`}>
              <ListChecks className="h-3.5 w-3.5" aria-hidden="true" /> Review
            </Link>
          ) : (
            <span className={`${btn} border border-slate-200 bg-white text-slate-300`} aria-disabled="true" title="Nothing uploaded to review yet">
              <ListChecks className="h-3.5 w-3.5" aria-hidden="true" /> Review
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
