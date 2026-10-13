"use client";

// Payables aging cards and CD deadlines on /bills — plan 1210 credit notes and payables, Part 7.4.
//
// The four cards are the owner's cuts by days past the STORED due date (Q5 = a): Not due,
// 1–30, 31–45, Over 45. Their keys are the API's own (notDue, pastDue1to30, pastDue31to45,
// pastDueOver45), and tapping one filters the list with `?aging=<key>` — the same ranges, from
// src/lib/payables/cash-discount.ts — so a card's count and the list it opens agree (F6, X5).

import { useEffect, useState } from "react";
import Link from "next/link";
import { Clock, RefreshCw, Zap } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";
import type { AgingBucket } from "@/lib/payables/cash-discount";
import { formatCurrency, storeQueryValue, type StoreFilter } from "./shared";

const log = createLogger("bills:aging");

interface AgingSummary {
  buckets: Record<AgingBucket, { count: number; amount: number }>;
  totalOutstanding: number;
  totalCount: number;
  cdWarnings: Array<{
    billId: string;
    billNo: string;
    vendorName: string;
    cdDeadline: string;
    cdPercentage: number;
    discount: number;
    balance: number;
    daysLeft: number;
    claimable: boolean;
  }>;
}

const CARDS: Array<{ key: AgingBucket; label: string; color: string; bg: string }> = [
  { key: "notDue", label: "Not due", color: "text-green-600", bg: "bg-green-50 border-green-200" },
  { key: "pastDue1to30", label: "1–30", color: "text-yellow-600", bg: "bg-yellow-50 border-yellow-200" },
  { key: "pastDue31to45", label: "31–45", color: "text-orange-600", bg: "bg-orange-50 border-orange-200" },
  { key: "pastDueOver45", label: "Over 45", color: "text-red-600", bg: "bg-red-50 border-red-200" },
];

interface AgingCardsProps {
  storeFilter: StoreFilter;
  selected: AgingBucket | null;
  onSelect: (bucket: AgingBucket | null) => void;
  /** Bumped by the page after an import, so the cards reload. */
  refreshKey?: number;
}

export function AgingCards({ storeFilter, selected, onSelect, refreshKey = 0 }: AgingCardsProps) {
  const [retryKey, setRetryKey] = useState(0);
  // Derived loading (see payment-priority.tsx): every setState stays in the response callback.
  // The last good cards stay on screen while a new store's numbers load.
  const storeId = storeQueryValue(storeFilter);
  const requestKey = `${storeId ?? ""}|${refreshKey}|${retryKey}`;
  const [loaded, setLoaded] = useState<{ key: string; error: string | null } | null>(null);
  const [aging, setAging] = useState<AgingSummary | null>(null);
  const loading = loaded?.key !== requestKey;
  const error = loading ? null : (loaded?.error ?? null);

  useEffect(() => {
    let cancelled = false;
    void apiTry<AgingSummary>(
      `/api/bills/aging-summary${storeId ? `?storeId=${encodeURIComponent(storeId)}` : ""}`
    ).then(({ data, error: err, status }) => {
      if (cancelled) return;
      if (err) log.warn("aging failed to load", { error: err, status, storeId });
      else setAging(data);
      setLoaded({ key: requestKey, error: err });
    });
    return () => {
      cancelled = true;
    };
  }, [storeId, requestKey]);

  if (loading && !aging) {
    return (
      <div className="mb-3 grid grid-cols-4 gap-2">
        {CARDS.map((c) => (
          <Skeleton key={c.key} className="h-[62px] rounded-lg" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="mb-3 flex items-center justify-between gap-2 rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-700">
        <span>Aging: {error}</span>
        <button
          onClick={() => setRetryKey((k) => k + 1)}
          className="inline-flex min-h-[44px] shrink-0 items-center gap-1 rounded-lg border border-red-300 bg-white px-3 font-medium"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Retry
        </button>
      </div>
    );
  }

  if (!aging) return null;

  return (
    <>
      <div className="mb-3">
        <div className="flex items-center gap-2 mb-2">
          <Clock className="h-4 w-4 text-slate-500" />
          <span className="text-xs font-semibold text-slate-700">Days past due</span>
          <span className="text-xs text-slate-400 tabular-nums">Total: {formatCurrency(aging.totalOutstanding)}</span>
          {selected && (
            <button onClick={() => onSelect(null)} className="ml-auto min-h-[44px] px-2 text-[11px] text-blue-600 underline">
              Clear
            </button>
          )}
        </div>
        <div className="grid grid-cols-4 gap-2">
          {CARDS.map((card) => {
            const data = aging.buckets[card.key];
            const active = selected === card.key;
            return (
              <button
                key={card.key}
                onClick={() => onSelect(active ? null : card.key)}
                aria-pressed={active}
                className={`p-2 rounded-lg border text-left transition-all min-h-[44px] ${
                  active ? `${card.bg} ring-2 ring-offset-1 ring-slate-400` : "bg-white border-slate-200 hover:border-slate-300"
                }`}
              >
                <p className="text-[11px] font-medium text-slate-600">{card.label}</p>
                <p className={`text-xl font-bold tabular-nums leading-none mt-0.5 ${card.color}`}>{data.count}</p>
                <p className="text-[10px] text-slate-500 tabular-nums truncate mt-0.5">{formatCurrency(data.amount)}</p>
              </button>
            );
          })}
        </div>
      </div>

      {aging.cdWarnings.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-2.5 mb-3">
          <div className="flex items-center gap-1.5 mb-1.5">
            <Zap className="h-3.5 w-3.5 text-amber-600" />
            <span className="text-xs font-semibold text-amber-800">Cash Discount Deadlines</span>
            <Link href="/bills?view=priority" className="ml-auto text-[11px] text-amber-800 underline">
              Pay first
            </Link>
          </div>
          <div className="space-y-1">
            {aging.cdWarnings.slice(0, 5).map((w) => (
              <Link
                key={w.billId}
                href={`/bills/${w.billId}`}
                className="flex min-h-[44px] items-center justify-between gap-2 text-xs hover:bg-amber-100 rounded px-1 py-0.5 transition-colors"
              >
                <span className="text-slate-700 truncate">
                  {w.vendorName} <span className="text-slate-400">· {w.billNo}</span>
                </span>
                <span
                  className={`shrink-0 font-medium tabular-nums ${
                    w.daysLeft < 0 ? "text-red-600" : w.daysLeft <= 3 ? "text-orange-600" : "text-amber-600"
                  }`}
                >
                  {w.daysLeft < 0
                    ? `Missed ${Math.abs(w.daysLeft)}d ago`
                    : w.daysLeft === 0
                      ? "Last day"
                      : `${w.daysLeft}d left`}{" "}
                  · {w.cdPercentage}% · {formatCurrency(w.discount)}
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
