"use client";

// Cash discount per supplier — plan 1210 credit notes and payables, Part 7.5 (X4).
//
// One call to GET /api/reports/cd-summary, which computes everything with the shared CD rule.
// This screen used to filter /api/vendors on two fields that route never returns (always empty)
// and then fetch bills once per supplier.

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SkeletonList } from "@/components/ui/skeleton";
import { apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";

const log = createLogger("reports:cd-summary");

interface BillRef {
  id: string;
  billNo: string;
  discount: number;
}

interface Group<T extends BillRef = BillRef> {
  count: number;
  discount: number;
  bills: T[];
}

interface VendorCdRow {
  vendorId: string;
  vendorName: string;
  vendorCode: string;
  cdTermsDays: number;
  cdPercentage: number;
  eligible: Group<BillRef & { daysLeft: number }>;
  paidInWindow: Group;
  missed: Group;
  paidDateUnknown: number;
}

interface CdSummary {
  since: string;
  days: number;
  vendorsWithTerms: number;
  totals: {
    eligible: { count: number; discount: number };
    paidInWindow: { count: number; discount: number };
    missed: { count: number; discount: number };
    paidDateUnknown: number;
  };
  vendors: VendorCdRow[];
}

const PAID_IN_WINDOW_HINT = "Paid inside the CD window — check the supplier's CD credit note arrived";

function fmt(amount: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount);
}

function BillLinks({ label, bills, tone }: { label: string; bills: Array<BillRef & { daysLeft?: number }>; tone: string }) {
  if (bills.length === 0) return null;
  return (
    <p className={`text-[11px] mt-1.5 tabular-nums leading-relaxed ${tone}`}>
      {label}:{" "}
      {bills.map((b, i) => (
        <span key={b.id}>
          {i > 0 && ", "}
          <Link href={`/bills/${b.id}`} className="underline underline-offset-2">
            {b.billNo}
          </Link>
          {b.daysLeft !== undefined && ` (${b.daysLeft === 0 ? "last day" : `${b.daysLeft}d left`})`}
        </span>
      ))}
    </p>
  );
}

export default function CdSummaryPage() {
  // `loading` is derived from a retry key (the expenses-page pattern), so every setState stays
  // in the response callback.
  const [retryKey, setRetryKey] = useState(0);
  const [loaded, setLoaded] = useState<{ key: number; data: CdSummary | null; error: string | null } | null>(null);
  const loading = loaded?.key !== retryKey;
  const data = loaded?.data ?? null;
  const error = loaded?.error ?? null;

  useEffect(() => {
    let cancelled = false;
    void apiTry<CdSummary>("/api/reports/cd-summary").then(({ data: body, error: err, status }) => {
      if (cancelled) return;
      if (err) log.warn("cd summary failed to load", { error: err, status });
      setLoaded({ key: retryKey, data: err ? null : body, error: err });
    });
    return () => {
      cancelled = true;
    };
  }, [retryKey]);

  const totals = data?.totals;

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <Link href="/reports" aria-label="Back" className="p-2 -ml-2 rounded-lg hover:bg-slate-100 focus-ring">
          <ArrowLeft className="h-5 w-5 text-slate-600" />
        </Link>
        <h1 className="text-lg font-bold text-slate-900">CD Discount Summary</h1>
      </div>

      {loading ? (
        <SkeletonList count={5} type="card" />
      ) : error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <p>{error}</p>
          <button
            onClick={() => setRetryKey((k) => k + 1)}
            className="mt-2 inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-red-300 bg-white px-3 text-xs font-medium text-red-700"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Try again
          </button>
        </div>
      ) : data && totals ? (
        <>
          <div className="grid grid-cols-3 gap-2 mb-2">
            <Card className="bg-blue-50 border-blue-200">
              <CardContent className="p-3">
                <p className="text-[11px] text-blue-600 uppercase font-medium">Can still earn</p>
                <p className="text-lg font-bold text-blue-700 tabular-nums">{fmt(totals.eligible.discount)}</p>
                <p className="text-[11px] text-blue-500 tabular-nums">{totals.eligible.count} bills</p>
              </CardContent>
            </Card>
            <Card className="bg-green-50 border-green-200">
              <CardContent className="p-3">
                <p className="text-[11px] text-green-600 uppercase font-medium">Paid in window</p>
                <p className="text-lg font-bold text-green-700 tabular-nums">{fmt(totals.paidInWindow.discount)}</p>
                <p className="text-[11px] text-green-500 tabular-nums">{totals.paidInWindow.count} bills</p>
              </CardContent>
            </Card>
            <Card className="bg-red-50 border-red-200">
              <CardContent className="p-3">
                <p className="text-[11px] text-red-600 uppercase font-medium">Missed</p>
                <p className="text-lg font-bold text-red-700 tabular-nums">{fmt(totals.missed.discount)}</p>
                <p className="text-[11px] text-red-500 tabular-nums">{totals.missed.count} bills</p>
              </CardContent>
            </Card>
          </div>

          <p className="text-xs text-slate-500 mb-1">{PAID_IN_WINDOW_HINT}.</p>
          <p className="text-xs text-slate-400 mb-3">
            Bills dated in the last {data.days} days · CD on the bill total
            {totals.paidDateUnknown > 0 &&
              ` · ${totals.paidDateUnknown} settled bill${totals.paidDateUnknown !== 1 ? "s have" : " has"} no payment recorded here, so ${totals.paidDateUnknown !== 1 ? "they are" : "it is"} not counted`}
          </p>

          {data.vendors.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-8">
              {data.vendorsWithTerms === 0
                ? "No supplier has cash discount terms. Set them on the supplier's page."
                : `No bills in the last ${data.days} days from the ${data.vendorsWithTerms} supplier${data.vendorsWithTerms !== 1 ? "s" : ""} with CD terms.`}
            </p>
          ) : (
            <div className="space-y-3">
              {data.vendors.map((v) => (
                <Card key={v.vendorId}>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div className="min-w-0">
                        <Link href={`/vendors/${v.vendorId}`} className="text-sm font-semibold text-slate-900 truncate block">
                          {v.vendorName}
                        </Link>
                        <p className="text-xs text-slate-500 tabular-nums">
                          {v.cdPercentage}% if paid within {v.cdTermsDays} days
                        </p>
                      </div>
                      <Badge variant="info" className="text-[11px] shrink-0">
                        {v.vendorCode}
                      </Badge>
                    </div>

                    <div className="grid grid-cols-3 gap-2 mt-2">
                      <div className="bg-blue-50 rounded-lg p-2">
                        <p className="text-[11px] text-blue-600 font-medium">Can still earn</p>
                        <p className="text-xl font-bold text-blue-700 tabular-nums">{v.eligible.count}</p>
                        <p className="text-[11px] text-blue-500 tabular-nums">{fmt(v.eligible.discount)}</p>
                      </div>
                      <div className="bg-green-50 rounded-lg p-2">
                        <p className="text-[11px] text-green-600 font-medium">Paid in window</p>
                        <p className="text-xl font-bold text-green-700 tabular-nums">{v.paidInWindow.count}</p>
                        <p className="text-[11px] text-green-500 tabular-nums">{fmt(v.paidInWindow.discount)}</p>
                      </div>
                      <div className="bg-red-50 rounded-lg p-2">
                        <p className="text-[11px] text-red-600 font-medium">Missed</p>
                        <p className="text-xl font-bold text-red-700 tabular-nums">{v.missed.count}</p>
                        <p className="text-[11px] text-red-500 tabular-nums">{fmt(v.missed.discount)}</p>
                      </div>
                    </div>

                    <BillLinks label="Pay to earn" bills={v.eligible.bills} tone="text-blue-600" />
                    <BillLinks label="Check the CD credit note for" bills={v.paidInWindow.bills} tone="text-green-700" />
                    <BillLinks label="Missed" bills={v.missed.bills} tone="text-red-500" />
                    {v.paidDateUnknown > 0 && (
                      <p className="text-[11px] text-slate-400 mt-1.5">
                        {v.paidDateUnknown} settled bill{v.paidDateUnknown !== 1 ? "s" : ""} with no payment recorded here
                      </p>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
