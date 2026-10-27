"use client";

// Expense report — "how much did <person> spend at <store> in <period>" (plan
// 1210-expense-store-department-and-payer, R4, Part E2). Group by who paid, store or category;
// tapping a row filters by it and moves on to the next grouping, so the owner's question
// (Iqbal Bhai, at BCH, this month) is two taps. "View these expenses" opens /expenses with the
// same filters, and the two totals agree because both are built by src/lib/expenses/filters.ts.
//
// Loads when the filters change and when someone taps Retry. No polling.

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { DateFilter, type DateRangeKey } from "@/components/date-filter";
import { ErrorBanner } from "@/components/ui/error-banner";
import { SkeletonList } from "@/components/ui/skeleton";
import { apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";
import { usePermissions } from "@/lib/use-permissions";
import { FilterBar, categoryLabel } from "./_components/report-filters";
import { EmptyState, GroupByPills, GroupList, TotalCard } from "./_components/summary-results";
import type { ExpenseSummary, GroupBy, ReportFilters, SummaryGroup } from "./_components/types";
import { apiQuery, drillInto, listHref, readFilters, reportSearch, windowOf } from "./_components/url-state";

const log = createLogger("reports:expense-summary");

/**
 * `useSearchParams` in a Client Component must sit under a Suspense boundary, or the
 * production build fails prerendering the page (node_modules/next/dist/docs/01-app/
 * 03-api-reference/04-functions/use-search-params.md → Prerendering).
 */
export default function ExpenseSummaryPage() {
  return (
    <Suspense fallback={<SkeletonList count={5} type="card" />}>
      <ExpenseSummaryScreen />
    </Suspense>
  );
}

function ExpenseSummaryScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { canView } = usePermissions();

  // The URL is the state (see _components/url-state.ts).
  const filters = readFilters(new URLSearchParams(searchParams.toString()));
  const query = apiQuery(filters);

  const [reloadKey, setReloadKey] = useState(0);
  const requestKey = `${query}|${reloadKey}`;
  // The last successful answer is kept while the next one loads, so the pickers keep their
  // options; `loading` is derived from which request the latest outcome belongs to.
  const [data, setData] = useState<ExpenseSummary | null>(null);
  const [outcome, setOutcome] = useState<{ key: string; error: string | null } | null>(null);
  const loading = outcome?.key !== requestKey;
  const error = loading ? null : outcome?.error ?? null;

  // Names for store/payer keys picked from a group row, for the chip once that grouping is gone.
  const [picked, setPicked] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    // apiTry, never fetch().json(): an expired session answers with the login page as HTML and
    // status 200, which used to surface here as "No expense data" (L3).
    apiTry<ExpenseSummary>(`/api/reports/expense-summary?${query}`).then((res) => {
      if (cancelled) return;
      if (res.isAuth) {
        log.warn("session expired, sending to login", { status: res.status });
        const back = `${window.location.pathname}${window.location.search}`;
        router.push(`/login?callbackUrl=${encodeURIComponent(back)}`);
        return;
      }
      if (res.error || !res.data) {
        log.error("summary load failed", { status: res.status, message: res.error, isTimeout: res.isTimeout });
        setOutcome({ key: requestKey, error: res.error || "Could not load the expense summary." });
        return;
      }
      setData(res.data);
      setOutcome({ key: requestKey, error: null });
    });
    return () => {
      cancelled = true;
    };
  }, [query, requestKey, router]);

  const update = (patch: Partial<ReportFilters>) =>
    router.replace(`${pathname}${reportSearch({ ...filters, ...patch })}`, { scroll: false });

  const onDateChange = (key: DateRangeKey, from?: string, to?: string) => {
    if (key === "custom" && !(from && to)) {
      // The Custom chip only opens the date inputs; keep showing the current window until Apply.
      const w = windowOf(filters);
      update({ range: "custom", dateFrom: w?.from ?? null, dateTo: w?.to ?? null });
      return;
    }
    update({ range: key, dateFrom: key === "custom" ? from! : null, dateTo: key === "custom" ? to! : null });
  };

  const onPick = (g: SummaryGroup) => {
    setPicked((p) => ({ ...p, [`${filters.groupBy}|${g.key}`]: g.label }));
    update(drillInto(filters, g.key));
  };

  const labelFor = (dim: GroupBy, key: string): string => {
    if (dim === "category") return categoryLabel(key);
    if (dim === "store" && key === "none") return "No store";
    const fromOptions =
      dim === "store"
        ? data?.options.stores.find((s) => s.id === key)?.name
        : data?.options.payers.find((p) => p.key === key)?.label;
    const fromGroups = data?.groupBy === dim ? data.groups.find((g) => g.key === key)?.label : undefined;
    return (
      fromOptions ??
      fromGroups ??
      picked[`${dim}|${key}`] ??
      (dim === "store" ? "Selected store" : key.startsWith("name:") ? key.slice(5) : "Selected person")
    );
  };

  const anyFilter = Boolean(filters.storeId || filters.payer || filters.category);
  const shown = !loading && !error ? data : null;

  return (
    <div>
      <div className="mb-3 flex items-center gap-3">
        <Link href="/reports" aria-label="Back to reports" className="-ml-2 rounded-lg p-2 hover:bg-slate-100 focus-ring">
          <ArrowLeft className="h-5 w-5 text-slate-600" />
        </Link>
        <h1 className="text-lg font-bold text-slate-900">Expense Summary</h1>
      </div>

      <DateFilter value={filters.range} onChange={onDateChange} className="mb-3" />

      <FilterBar filters={filters} options={data?.options ?? null} labelFor={labelFor} onChange={update} />

      {error && <ErrorBanner message={error} onRetry={() => setReloadKey((k) => k + 1)} />}

      {loading ? (
        <SkeletonList count={5} type="card" />
      ) : shown ? (
        <>
          <TotalCard data={shown} listHref={canView("expenses") ? listHref(filters, shown) : null} />
          {shown.totalCount === 0 ? (
            <EmptyState onClear={anyFilter ? () => update({ storeId: null, payer: null, category: null }) : null} />
          ) : (
            <>
              <GroupByPills value={filters.groupBy} onChange={(groupBy) => update({ groupBy })} />
              <GroupList groups={shown.groups} groupBy={shown.groupBy} onPick={onPick} />
            </>
          )}
        </>
      ) : null}
    </div>
  );
}
