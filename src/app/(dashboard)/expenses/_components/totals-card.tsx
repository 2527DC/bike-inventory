"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";
import { formatCurrency } from "./types";

const log = createLogger("expenses:list");

interface Totals {
  count: number;
  amount: number;
}

interface TotalsCardProps {
  /** The list's filter query — the same string GET /api/expenses receives. */
  query: string;
  /** Bumped after a delete so the total follows the list. */
  reloadKey: number;
  /** Rows on screen, for "showing the latest 50". */
  shown: number;
  /** "1 Oct 2026 – 12 Oct 2026" when a date window is set. */
  windowLabel?: string;
}

/**
 * The total of EVERY expense matching the filters, from GET /api/expenses/totals — not the
 * sum of the 50 rows fetched, which is what "Total shown" used to be (plan 1210, L9). Same
 * filter as the list and the report, so the number here is the number the report showed.
 */
export function TotalsCard({ query, reloadKey, shown, windowLabel }: TotalsCardProps) {
  const [retryKey, setRetryKey] = useState(0);
  const requestKey = `${query}|${reloadKey}|${retryKey}`;
  // As on the page: `loading` is derived from which request the last answer belongs to, so
  // every setState stays in the response callback. The previous answer stays on screen,
  // dimmed, while the next one loads — the total does not blink after a delete.
  const [result, setResult] = useState<{ key: string; totals: Totals | null; error: string | null } | null>(null);
  const loading = result?.key !== requestKey;

  useEffect(() => {
    let cancelled = false;
    apiTry<Totals>(`/api/expenses/totals${query ? `?${query}` : ""}`).then(({ data, error, status }) => {
      if (cancelled) return;
      if (error || !data) log.error("totals load failed", { status, message: error });
      setResult({ key: requestKey, totals: data, error: data ? null : error || "Could not total these expenses." });
    });
    return () => {
      cancelled = true;
    };
  }, [query, requestKey]);

  if (!result) {
    return <div className="h-[68px] mb-3 rounded-xl bg-slate-100 animate-pulse" aria-label="Loading the total" />;
  }

  if (result.error) {
    return (
      <Card className="bg-slate-50 mb-3">
        <CardContent className="p-3 flex items-center justify-between gap-3">
          <p className="text-sm text-red-700">{result.error}</p>
          <button
            type="button"
            onClick={() => setRetryKey((k) => k + 1)}
            disabled={loading}
            className="shrink-0 inline-flex items-center gap-1 min-h-[44px] px-3 rounded-lg text-xs font-medium text-slate-700 hover:bg-slate-200 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Retry
          </button>
        </CardContent>
      </Card>
    );
  }

  const totals = result.totals;
  if (!totals || (totals.count === 0 && !loading)) return null;

  return (
    <Card className={`bg-slate-50 mb-3 transition-opacity ${loading ? "opacity-60" : ""}`}>
      <CardContent className="p-3">
        <p className="leading-snug">
          <span className="text-xl font-bold text-slate-900 tabular-nums">{formatCurrency(totals.amount)}</span>{" "}
          <span className="text-sm text-slate-600">
            across {totals.count.toLocaleString("en-IN")} expense{totals.count === 1 ? "" : "s"}
          </span>
          {totals.count > shown && (
            <span className="text-xs text-slate-500"> · showing the latest {shown.toLocaleString("en-IN")}</span>
          )}
        </p>
        {windowLabel && <p className="text-[11px] text-slate-500 mt-0.5 tabular-nums">{windowLabel}</p>}
      </CardContent>
    </Card>
  );
}
