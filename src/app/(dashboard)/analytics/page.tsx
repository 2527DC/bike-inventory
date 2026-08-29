"use client";

// Store analytics — entrance footfall for one store, one business day.
//
// Ported from bch-store-analytics/app/page.js and restyled to BCH OPS. One rule carried over
// intact, because it is the most important thing in the original:
//
//   A metric that cannot be computed renders as "—" with the reason underneath.
//   It NEVER renders as 0.
//
// A hardcoded zero on a BCH dashboard once passed as a real statistic for weeks
// (docs/analytics/findings-2026-08-01.md, CHETAN.md §5). Missing data is not zero traffic.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { KeyRound, RefreshCw } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ErrorBanner } from "@/components/ui/error-banner";
import { SkeletonList } from "@/components/ui/skeleton";
import { usePermissions } from "@/lib/use-permissions";
import { STOCK_LOCATIONS } from "@/lib/inventory-config";

// Only sites with a doorway can be counted. Derived from the shared location config rather
// than a second hardcoded list — the app already has three competing location vocabularies
// and this is not going to be a fourth.
const COUNTABLE_STORES = STOCK_LOCATIONS.filter((l) => l.kind === "Store");

interface Dashboard {
  store_id: string;
  date: string;
  timezone: string;
  footfall_basis: string;
  in: number;
  out: number;
  counter_bills: number | null;
  total_invoices: number | null;
  bills_store_scoped: boolean;
  bills_unavailable_reason: string | null;
  visitors_per_counter_bill: number | null;
  conversion: null;
  conversion_unavailable_reason: string;
  coverage_pct: number | null;
  coverage_unavailable_reason: string | null;
  observed_minutes: number;
  expected_minutes: number | null;
  online: boolean;
  last_beat: number | null;
  generated_at: number;
}

/**
 * One metric tile.
 *
 * `value == null` is the "cannot be computed" state and is rendered as an em dash plus the
 * reason. Passing 0 renders 0 — the two are deliberately different, and conflating them is
 * the failure this component exists to prevent.
 */
function Metric({
  label,
  value,
  suffix = "",
  reason,
  accent = false,
}: {
  label: string;
  value: number | null | undefined;
  suffix?: string;
  reason?: string | null;
  accent?: boolean;
}) {
  const missing = value == null;

  return (
    <Card className={accent && !missing ? "border-slate-900" : ""}>
      <CardContent className="p-4">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          {label}
        </div>
        <div
          className={`mt-1.5 text-3xl font-bold tracking-tight ${
            missing ? "text-slate-300" : accent ? "text-slate-900" : "text-slate-800"
          }`}
        >
          {missing ? "—" : `${value}${suffix}`}
        </div>
        {missing && reason && (
          <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">{reason}</p>
        )}
      </CardContent>
    </Card>
  );
}

export default function AnalyticsPage() {
  const { canView, canEdit, ready: permsReady } = usePermissions();
  const allowed = canView("analytics");
  const editable = canEdit("analytics");

  const [storeId, setStoreId] = useState<string>(COUNTABLE_STORES[0]?.value ?? "BCH_STORE");
  const [date, setDate] = useState<string>("");
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState("");
  const [needsDevice, setNeedsDevice] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ store: storeId });
      if (date) params.set("date", date);

      const res = await fetch(`/api/analytics/dashboard?${params}`);
      const json = await res.json();

      if (!json.success) throw new Error(json.error || "Dashboard unavailable");

      setData(json.data);
      // The server owns "what today is" — it computes the business date in Asia/Kolkata,
      // which is not necessarily the browser's date. Seed the picker from the response
      // rather than from the client clock.
      if (!date) setDate(json.data.date);
      setError("");
      setNeedsDevice(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Dashboard unavailable");
    } finally {
      setLoading(false);
    }
  }, [storeId, date]);

  // Loads once on mount. The auto-refresh interval was removed along with the
  // scheduled jobs — use the refresh control instead.
  useEffect(() => {
    if (!allowed) return;
    void load();
  }, [allowed, load]);

  // A fresh install has no devices, so nothing can ever report footfall. Say so, and say
  // what to do about it, rather than showing a page of zeros that looks like a dead store.
  useEffect(() => {
    if (!allowed) return;
    fetch("/api/analytics/devices")
      .then((r) => r.json())
      .then((j) => {
        if (j.success) setNeedsDevice(j.data.length === 0);
      })
      .catch(() => {});
  }, [allowed]);

  if (!permsReady) return <SkeletonList />;

  if (!allowed) {
    return (
      <div className="py-12 text-center">
        <p className="text-sm text-slate-500">You do not have access to Store Analytics.</p>
      </div>
    );
  }

  const storeLabel =
    COUNTABLE_STORES.find((s) => s.value === storeId)?.label ?? storeId;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Store Analytics</h1>
          <p className="mt-1 text-sm text-slate-500">
            Entrance footfall from the door camera, alongside the day&apos;s bills.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {data && (
            <Badge variant={data.online ? "success" : "danger"}>
              {data.online ? "Counter online" : "Counter offline"}
            </Badge>
          )}
          {editable && (
            <Link
              href="/analytics/devices"
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              <KeyRound className="h-3.5 w-3.5" />
              Devices
            </Link>
          )}
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap gap-2">
        <select
          value={storeId}
          onChange={(e) => {
            setStoreId(e.target.value);
            setLoading(true);
          }}
          className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm"
        >
          {COUNTABLE_STORES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>

        <input
          type="date"
          value={date}
          onChange={(e) => {
            setDate(e.target.value);
            setLoading(true);
          }}
          className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm"
        />

        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </button>
      </div>

      {error && <ErrorBanner message={error} onRetry={() => void load()} />}

      {needsDevice && (
        <Card className="border-amber-300 bg-amber-50">
          <CardContent className="p-4">
            <p className="text-sm font-semibold text-amber-900">No counting device registered</p>
            <p className="mt-1 text-xs leading-relaxed text-amber-800">
              Nothing can report footfall until a camera agent has an API key, so these figures
              will stay empty. {editable ? (
                <>
                  Register one under{" "}
                  <Link href="/analytics/devices" className="font-semibold underline">
                    Devices
                  </Link>
                  .
                </>
              ) : (
                "Ask an admin to register one."
              )}
            </p>
          </CardContent>
        </Card>
      )}

      {loading && !data ? (
        <SkeletonList />
      ) : data ? (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <Metric label="Entered (IN)" value={data.in} />
            <Metric label="Exited (OUT)" value={data.out} />

            <Metric
              label="Visitors per bill"
              value={data.visitors_per_counter_bill}
              accent
              reason={
                data.bills_unavailable_reason ??
                "needs both footfall and at least one counter bill for the day"
              }
            />

            <Metric
              label="Counter bills"
              value={data.counter_bills}
              reason={data.bills_unavailable_reason}
            />
            <Metric
              label="Total invoices"
              value={data.total_invoices}
              reason={data.bills_unavailable_reason}
            />

            <Metric
              label="Data coverage"
              value={data.coverage_pct}
              suffix="%"
              reason={data.coverage_unavailable_reason}
            />
          </div>

          {/* Conversion gets its own row with its full explanation, because the reason it is
              absent is a business decision rather than a missing feature. */}
          <Card>
            <CardContent className="p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Conversion
                </div>
                <div className="text-2xl font-bold text-slate-300">—</div>
              </div>
              <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">
                {data.conversion_unavailable_reason} A family of four entering is one buying
                decision, not four, so bills ÷ people understates conversion at every weekend
                family visit. &ldquo;Visitors per bill&rdquo; above is the honest version of
                this number until a party estimate exists.
              </p>
            </CardContent>
          </Card>

          <p className="px-1 text-xs leading-relaxed text-slate-400">
            {storeLabel} · business date <strong>{data.date}</strong> ({data.timezone}) ·
            footfall basis <strong>{data.footfall_basis}</strong> · last heartbeat{" "}
            {data.last_beat
              ? new Date(data.last_beat).toLocaleTimeString("en-IN", {
                  timeZone: "Asia/Kolkata",
                })
              : "never"}{" "}
            · refreshes every 15s.
            <br />
            Coverage is observed heartbeat-minutes ÷ expected open minutes
            {data.expected_minutes != null && (
              <> ({data.observed_minutes} of {data.expected_minutes})</>
            )}
            . Missing data is not zero traffic — a gap shows as &ldquo;—&rdquo;, never as 0.
            {!data.bills_store_scoped && (
              <>
                <br />
                Bill counts are not store-scoped: the POS tables carry no store column, so they
                cover the whole business.
              </>
            )}
          </p>
        </>
      ) : null}
    </div>
  );
}
