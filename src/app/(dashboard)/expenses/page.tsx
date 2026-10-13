"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { Plus, Search, X } from "lucide-react";
import { FilterSheet } from "@/components/filter-sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ErrorBanner } from "@/components/ui/error-banner";
import { SkeletonList } from "@/components/ui/skeleton";
import { usePermissions } from "@/lib/use-permissions";
import { apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";
import { ExpenseList } from "./_components/expense-list";
import { TotalsCard } from "./_components/totals-card";
import { DeleteExpenseSheet, type BankLineReleasedTo } from "./_components/delete-expense-sheet";
import { payerFilterLabel, storeFilterOptions, useExpenseFilters } from "./_components/use-expense-filters";
import { CATEGORY_LABELS, CATEGORY_ORDER, categoryLabel, dayLabel, payerName, type ExpenseRow, type StoreOption } from "./_components/types";

const log = createLogger("expenses:list");

/** The list shows the latest this-many; the total card counts every match (L9). */
const PAGE_SIZE = 50;

/**
 * Expenses, filtered by store, category and date — and by payer when the report sends one
 * (plan 1210-expense-store-department-and-payer, Part D). Filters arrive in the URL.
 *
 * `useSearchParams` in a Client Component must sit under a Suspense boundary, or the production
 * build fails prerendering this page ("Missing Suspense boundary with useSearchParams" —
 * node_modules/next/dist/docs/01-app/03-api-reference/04-functions/use-search-params.md).
 */
export default function ExpensesPage() {
  return (
    <Suspense fallback={<SkeletonList count={6} type="card" />}>
      <ExpensesScreen />
    </Suspense>
  );
}

function ExpensesScreen() {
  const { canView, canDelete, loading: permsLoading } = usePermissions();
  const canAccess = canView("expenses");
  const mayDelete = canDelete("expenses");
  // Nothing is fetched until the grants are known: a request sent before then is refused for a
  // user who may well hold the permission.
  const enabled = !permsLoading && canAccess;

  const { filters, query, update } = useExpenseFilters();
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [searchText, setSearchText] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [totalsKey, setTotalsKey] = useState(0);
  const [deleting, setDeleting] = useState<ExpenseRow | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  // `loading` is derived, not set: the list is loading whenever the filters (or a retry) name
  // a request whose answer has not landed yet. Keeps every setState inside the response
  // callback, where the react-hooks lint wants it, instead of at the top of the effect.
  const requestKey = `${query}|${reloadKey}`;
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const loading = loadedFor !== requestKey;

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const params = new URLSearchParams(query);
    params.set("limit", String(PAGE_SIZE));

    // apiTry, not fetch().json(): an expired session answers with the login page as HTML and
    // status 200, which res.json() turns into "Unexpected token '<'" (CLAUDE.md).
    apiTry<ExpenseRow[]>(`/api/expenses?${params}`).then(({ data, error, status }) => {
      if (cancelled) return;
      if (error || !data) {
        log.error("load failed", { status, message: error });
        setLoadError(error || "Failed to load expenses");
        setExpenses([]);
      } else {
        setLoadError(null);
        setExpenses(data);
      }
      setLoadedFor(requestKey);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, query, requestKey]);

  // The Store filter's chips. GET /api/stores is readable by anyone signed in — it feeds every
  // location dropdown — so this works whether or not the viewer may create expenses. If it
  // fails, the chips fall back to the stores on the loaded rows.
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    apiTry<StoreOption[]>("/api/stores").then(({ data, error, status }) => {
      if (cancelled) return;
      if (error || !data) {
        log.warn("store list unavailable; store filter uses the loaded rows", { status, message: error });
        return;
      }
      setStores(data.map(({ id, code, name }) => ({ id, code, name })));
    });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  if (permsLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-6 w-6 border-2 border-slate-900 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!canAccess) {
    return (
      <div className="text-center py-12">
        <p className="text-sm font-medium text-red-600">Access Denied</p>
        <p className="text-xs text-slate-500 mt-1">You do not have permission to view expenses.</p>
      </div>
    );
  }

  const q = searchText.trim().toLowerCase();
  const visibleExpenses = q
    ? expenses.filter((exp) =>
        [exp.description, categoryLabel(exp.category), payerName(exp), exp.store?.name ?? ""].some((s) =>
          s.toLowerCase().includes(q)
        )
      )
    : expenses;

  const filtered = query !== "";
  const emptyText = expenses.length > 0
    ? "No expenses match your search"
    : filtered ? "No expenses match these filters" : "No expenses found";

  const windowLabel =
    filters.dateFrom && filters.dateTo ? `${dayLabel(filters.dateFrom)} – ${dayLabel(filters.dateTo)}`
    : filters.dateFrom ? `From ${dayLabel(filters.dateFrom)}`
    : filters.dateTo ? `Up to ${dayLabel(filters.dateTo)}`
    : undefined;

  const onDeleted = (id: string, releasedTo: BankLineReleasedTo) => {
    setDeleting(null);
    setExpenses((rows) => rows.filter((r) => r.id !== id));
    setTotalsKey((k) => k + 1);
    setFlash(
      releasedTo === "suspense" ? "Expense deleted. Its bank statement line is back in suspense."
      : releasedTo === "review" ? "Expense deleted. Its bank statement line is back in 'to review'."
      : "Expense deleted."
    );
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h1 className="text-lg font-bold text-slate-900">Expenses</h1>
        <Link href="/expenses/new">
          <Button size="sm" className="bg-blue-600 hover:bg-blue-700">
            <Plus className="h-4 w-4 mr-1" /> Add
          </Button>
        </Link>
      </div>

      {/* Search — narrows the rows on screen only; the total below counts every match. */}
      <div className="relative mb-3">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <Input
          placeholder="Search description, paid by, store..."
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          className="pl-9"
        />
      </div>

      {flash && (
        <div className="mb-3 rounded-xl border border-green-200 bg-green-50 px-3 py-1 flex items-center justify-between gap-3">
          <p role="status" className="text-xs text-green-800">{flash}</p>
          <button
            onClick={() => setFlash(null)}
            className="shrink-0 min-h-[44px] px-1 text-[11px] font-medium text-green-700 hover:text-green-900 focus-ring rounded"
          >
            Dismiss
          </button>
        </div>
      )}

      <TotalsCard query={query} reloadKey={totalsKey} shown={expenses.length} windowLabel={windowLabel} />

      <FilterSheet
        className={filters.payer ? "mb-2" : "mb-4"}
        dateValue={filters.dateKey}
        onDateChange={(key, from, to) => update({ dateKey: key, dateFrom: from, dateTo: to })}
        groups={[
          {
            label: "Category",
            value: filters.category,
            defaultValue: "ALL",
            options: [{ key: "ALL", label: "All" }, ...CATEGORY_ORDER.map((c) => ({ key: c, label: CATEGORY_LABELS[c] }))],
            onChange: (key) => update({ category: key }),
          },
          {
            label: "Store",
            value: filters.storeId,
            defaultValue: "ALL",
            options: storeFilterOptions(stores, expenses, filters.storeId),
            onChange: (key) => update({ storeId: key }),
          },
        ]}
      />

      {/* The payer filter only arrives from the report's links; here it can only be removed. */}
      {filters.payer && (
        <div className="mb-3 flex items-center gap-2">
          <span className="text-xs text-slate-500">Paid by</span>
          <button
            type="button"
            onClick={() => update({ payer: null })}
            aria-label={`Remove the filter: paid by ${payerFilterLabel(filters.payer, expenses)}`}
            className="inline-flex min-h-[44px] max-w-full items-center gap-1.5 rounded-full bg-slate-900 px-3.5 text-sm font-medium text-white hover:bg-slate-800 focus-ring"
          >
            <span className="truncate">{payerFilterLabel(filters.payer, expenses)}</span>
            <X className="h-4 w-4 shrink-0" aria-hidden />
          </button>
        </div>
      )}

      {loadError && !loading && (
        <ErrorBanner message={loadError} onRetry={() => setReloadKey((k) => k + 1)} />
      )}

      {loading ? (
        <SkeletonList count={6} type="card" />
      ) : loadError ? null : (
        <ExpenseList rows={visibleExpenses} mayDelete={mayDelete} onDelete={setDeleting} emptyText={emptyText} />
      )}

      {deleting && (
        <DeleteExpenseSheet row={deleting} onClose={() => setDeleting(null)} onDeleted={onDeleted} />
      )}
    </div>
  );
}
