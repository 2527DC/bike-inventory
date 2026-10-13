"use client";

import Link from "next/link";
import { CheckCircle2, ChevronRight, FileSpreadsheet } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SkeletonList } from "@/components/ui/skeleton";
import { ErrorBanner } from "@/components/ui/error-banner";
import { accountChipLabel, dayLabel, formatCurrency, type BankAccountRow, type StatementRow } from "./types";

interface PastUploadsProps {
  statements: StatementRow[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  /** The account picked for upload; the list follows it unless "All accounts" is chosen. */
  account: BankAccountRow | null;
  showAll: boolean;
  onShowAll: (all: boolean) => void;
}

/**
 * Statements already uploaded, with LIVE progress — "180 done · 31 to review · 3 in suspense" —
 * computed by the API from each line's state, instead of the AI's "matched" guess the old list
 * showed (plan §2.7 D5). Tapping one opens its lines.
 */
export function PastUploads({ statements, loading, error, onRetry, account, showAll, onShowAll }: PastUploadsProps) {
  const chip = (active: boolean) =>
    `min-h-[44px] px-3 rounded-full text-xs font-medium transition-colors focus-ring ${
      active ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"
    }`;

  return (
    <section aria-labelledby="past-uploads">
      <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
        <h2 id="past-uploads" className="text-sm font-semibold text-slate-900">Past uploads</h2>
        {account && (
          <div className="flex gap-1.5" role="group" aria-label="Which uploads">
            <button type="button" onClick={() => onShowAll(false)} aria-pressed={!showAll} className={chip(!showAll)}>
              {account.name}
            </button>
            <button type="button" onClick={() => onShowAll(true)} aria-pressed={showAll} className={chip(showAll)}>
              All accounts
            </button>
          </div>
        )}
      </div>

      {error && <ErrorBanner message={error} onRetry={onRetry} />}

      {loading ? (
        <SkeletonList count={3} type="card" />
      ) : statements.length === 0 && !error ? (
        <div className="text-center py-8">
          <FileSpreadsheet className="h-6 w-6 text-slate-300 mx-auto mb-1" />
          <p className="text-xs text-slate-500">
            {account && !showAll ? `No statements uploaded for ${account.name} yet` : "No statements uploaded yet"}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {statements.map((s) => (
            <StatementCard key={s.id} s={s} />
          ))}
        </div>
      )}
    </section>
  );
}

function StatementCard({ s }: { s: StatementRow }) {
  const { done, toReview, suspense, total } = s.progress;
  const allHandled = total > 0 && toReview === 0 && suspense === 0;
  const period =
    s.fromDate && s.toDate
      ? `${dayLabel(s.fromDate, { year: false })} – ${dayLabel(s.toDate)}`
      : `Uploaded ${dayLabel(s.createdAt)}`;

  return (
    <Link href={`/accounts/reconcile/${s.id}`} className="block rounded-xl focus-ring">
      <Card className="hover:border-slate-300 transition-colors">
        <CardContent className="p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 flex-wrap">
                {s.bankAccount ? (
                  <Badge className="text-[10px]">{accountChipLabel(s.bankAccount)}</Badge>
                ) : (
                  <Badge variant="warning" className="text-[10px]">{s.bank} · no account</Badge>
                )}
                {allHandled && (
                  <span className="inline-flex items-center gap-0.5 text-[10px] text-green-700">
                    <CheckCircle2 className="h-3 w-3" />All handled
                  </span>
                )}
              </div>
              <p className="text-sm font-medium text-slate-900 truncate mt-1" title={s.fileName}>{s.fileName}</p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {period} · by {s.uploadedBy.name}
              </p>
            </div>
            <ChevronRight className="h-4 w-4 text-slate-400 shrink-0 mt-1" />
          </div>

          <p className="flex flex-wrap gap-x-1.5 mt-2 text-[11px] tabular-nums">
            <span className="text-green-700">{done} done</span>
            <span className="text-slate-300" aria-hidden>·</span>
            <span className={toReview > 0 ? "text-amber-700 font-medium" : "text-slate-500"}>{toReview} to review</span>
            <span className="text-slate-300" aria-hidden>·</span>
            <span className={suspense > 0 ? "text-red-700 font-medium" : "text-slate-500"}>{suspense} in suspense</span>
          </p>
          <p className="flex gap-3 mt-1 text-[11px] tabular-nums">
            <span className="text-green-600">In: {formatCurrency(s.totalCredits)}</span>
            <span className="text-red-600">Out: {formatCurrency(s.totalDebits)}</span>
          </p>
        </CardContent>
      </Card>
    </Link>
  );
}
