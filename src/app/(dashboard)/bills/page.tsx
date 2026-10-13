"use client";

// /bills — supplier bills, and the "Pay first" list (plan 1210 credit notes and payables).
//
//   ?view=priority   opens the Pay first tab (Part 7.4)
//   ?fetch=credits   opens the credit-note fetch (Part 3.5) — the vendor Credits tab links here
//
// The page composes; the parts live in _components/ (frontend-engineer: >300-line pages split).
// Store comes from /api/stores plus "Not set" — never a hard-coded store code (Part 2.4).

import { Suspense, useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { RefreshCw, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ExportButtons } from "@/components/export-buttons";
import { exportToExcel, exportToPDF, type ExportColumn } from "@/lib/export";
import { useDebounce } from "@/hooks/use-debounce";
import { type DateRangeKey } from "@/components/date-filter";
import { FilterSheet } from "@/components/filter-sheet";
import { usePermissions } from "@/lib/use-permissions";
import { SkeletonList } from "@/components/ui/skeleton";
import { apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";
import type { AgingBucket } from "@/lib/payables/cash-discount";
import { ZohoCreditFetch } from "@/components/zoho-credit-fetch";
import { ZohoLinkSheet } from "./_components/zoho-link-sheet";
import { PaymentPriority } from "./_components/payment-priority";
import { AgingCards } from "./_components/aging-cards";
import { BillList, type BillItem } from "./_components/bill-list";
import { FetchBillsPanel, FetchBillsTrigger } from "./_components/fetch-bills";
import { useFetchBills } from "./_components/use-fetch-bills";
import { formatDay, storeFilterOptions, type StoreFilter, type StoreOption } from "./_components/shared";

const log = createLogger("bills");

const BILL_COLUMNS: ExportColumn[] = [
  { header: "Bill No", key: "billNo" },
  { header: "Vendor", key: "vendor.name" },
  { header: "Store", key: "store.name", format: (v) => (v ? String(v) : "Not set") },
  { header: "Bill Date", key: "billDate", format: (v) => formatDay(String(v)) },
  { header: "Due Date", key: "dueDate", format: (v) => formatDay(String(v)) },
  { header: "Amount", key: "amount", format: (v) => `₹${Number(v || 0).toLocaleString("en-IN")}` },
  { header: "Paid", key: "paidAmount", format: (v) => `₹${Number(v || 0).toLocaleString("en-IN")}` },
  { header: "Balance", key: "amount", format: (_v, row) => `₹${(Number(row.amount || 0) - Number(row.paidAmount || 0)).toLocaleString("en-IN")}` },
  { header: "Status", key: "status", format: (v) => String(v).replace(/_/g, " ") },
];

const STATUS_FILTERS = ["ALL", "OVERDUE", "PENDING", "PARTIALLY_PAID", "PAID", "DISPUTED"];

type View = "bills" | "priority";
const TABS: Array<{ key: View; label: string }> = [
  { key: "bills", label: "Bills" },
  { key: "priority", label: "Pay first" },
];

/**
 * `useSearchParams` in a Client Component must sit under a Suspense boundary, or the production
 * build fails prerendering this page (node_modules/next/dist/docs/01-app/03-api-reference/
 * 04-functions/use-search-params.md).
 */
export default function BillsPage() {
  return (
    <Suspense fallback={<SkeletonList count={6} type="card" />}>
      <BillsScreen />
    </Suspense>
  );
}

function BillsScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const view: View = searchParams.get("view") === "priority" ? "priority" : "bills";
  const openCredits = searchParams.get("fetch") === "credits";

  const { canFetch } = usePermissions();
  const canFetchZoho = canFetch("zoho");

  // ── Stores, for the Store filter and the import panel ──
  const [stores, setStores] = useState<StoreOption[]>([]);
  useEffect(() => {
    void apiTry<StoreOption[]>("/api/stores").then(({ data, error }) => {
      if (error) log.warn("stores failed to load", { error });
      else setStores(data ?? []);
    });
  }, []);

  // Shared by both tabs, so switching keeps the store picked.
  const [storeFilter, setStoreFilter] = useState<StoreFilter>("ALL");
  // Bumped after an import or a Zoho link: the list, the cards and Pay first reload.
  const [refreshKey, setRefreshKey] = useState(0);
  const refreshAll = useCallback(() => setRefreshKey((k) => k + 1), []);

  const fetchBills = useFetchBills({ stores, onImported: refreshAll });

  const replaceQuery = useCallback(
    (edit: (p: URLSearchParams) => void) => {
      const p = new URLSearchParams(searchParams.toString());
      edit(p);
      const qs = p.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, searchParams]
  );
  const setView = (next: View) =>
    replaceQuery((p) => {
      if (next === "priority") p.set("view", "priority");
      else p.delete("view");
    });
  // `?fetch=credits` opens the credit-note fetch once: ZohoCreditFetch reads `defaultOpen` when it
  // mounts (after the grants load, since it sits under canFetchZoho), then the parameter is
  // dropped so a refresh does not open it again.
  useEffect(() => {
    if (openCredits && canFetchZoho) replaceQuery((p) => p.delete("fetch"));
  }, [openCredits, canFetchZoho, replaceQuery]);

  // ── The Bills tab's list ──
  const [bills, setBills] = useState<BillItem[]>([]);
  const [filter, setFilter] = useState("ALL");
  const [agingFilter, setAgingFilter] = useState<AgingBucket | null>(null);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search);
  const [dateFilter, setDateFilter] = useState<DateRangeKey>("all");
  const [dateFrom, setDateFrom] = useState<string | undefined>();
  const [dateTo, setDateTo] = useState<string | undefined>();
  const [retryKey, setRetryKey] = useState(0);

  const listQuery = (() => {
    const params = new URLSearchParams({ limit: "50" });
    if (agingFilter) params.set("aging", agingFilter);
    else if (filter === "OVERDUE") params.set("overdue", "true");
    else if (filter !== "ALL") params.set("status", filter);
    if (debouncedSearch.length >= 2) params.set("search", debouncedSearch);
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    if (storeFilter !== "ALL") params.set("storeId", storeFilter);
    return params.toString();
  })();
  // `loading` is derived, not set (the expenses-page pattern): the list is loading whenever the
  // filters, a refresh or a retry name a request whose answer has not landed. Every setState
  // stays in the response callback, and a late answer to an older filter is dropped.
  const requestKey = `${listQuery}|${refreshKey}|${retryKey}`;
  const [loaded, setLoaded] = useState<{ key: string; error: string | null } | null>(null);
  const loading = loaded?.key !== requestKey;
  const listError = loading ? null : (loaded?.error ?? null);

  useEffect(() => {
    if (view !== "bills") return;
    let cancelled = false;
    void apiTry<BillItem[]>(`/api/bills?${listQuery}`).then(({ data, error, status }) => {
      if (cancelled) return;
      if (error) log.warn("bill list failed", { error, status });
      else setBills(data ?? []);
      setLoaded({ key: requestKey, error });
    });
    return () => {
      cancelled = true;
    };
  }, [view, listQuery, requestKey]);

  return (
    <div>
      {/* Header */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-bold text-slate-900">Vendor Bills</h1>
        <div className="flex flex-wrap items-center gap-2">
          <ZohoLinkSheet onDone={refreshAll} />
          {view === "bills" && (
            <ExportButtons
              onExcel={() =>
                void exportToExcel(bills as unknown as Record<string, unknown>[], BILL_COLUMNS, "vendor-bills").catch((e) =>
                  log.error("bills excel export failed", { error: e instanceof Error ? e.message : String(e) })
                )
              }
              onPDF={() =>
                void exportToPDF("Vendor Bills", bills as unknown as Record<string, unknown>[], BILL_COLUMNS, "vendor-bills").catch((e) =>
                  log.error("bills pdf export failed", { error: e instanceof Error ? e.message : String(e) })
                )
              }
            />
          )}
        </div>
      </div>

      {/* Pulls from Zoho: bills, and the suppliers' credit notes (Part 3.5) */}
      {canFetchZoho && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <FetchBillsTrigger f={fetchBills} />
          <ZohoCreditFetch kind="vendorcredit" onImported={refreshAll} defaultOpen={openCredits} />
        </div>
      )}
      <FetchBillsPanel f={fetchBills} stores={stores} />

      {/* Bills | Pay first */}
      <div role="tablist" aria-label="Bills view" className="mb-3 grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={view === t.key}
            onClick={() => setView(t.key)}
            className={`min-h-[44px] rounded-md text-sm font-medium transition-colors ${
              view === t.key ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {view === "priority" ? (
        <PaymentPriority stores={stores} storeFilter={storeFilter} onStoreFilterChange={setStoreFilter} refreshKey={refreshKey} />
      ) : (
        <>
          <AgingCards storeFilter={storeFilter} selected={agingFilter} onSelect={setAgingFilter} refreshKey={refreshKey} />

          <div className="relative mb-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input placeholder="Search bill no or vendor..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
          </div>

          <FilterSheet
            className="mb-3"
            dateValue={dateFilter}
            onDateChange={(key, from, to) => {
              setDateFilter(key);
              setDateFrom(from);
              setDateTo(to);
            }}
            groups={[
              {
                label: "Status",
                value: filter,
                defaultValue: "ALL",
                options: STATUS_FILTERS.map((s) => ({ key: s, label: s === "ALL" ? "All" : s.replace(/_/g, " ") })),
                onChange: (key) => setFilter(key),
              },
              {
                label: "Store",
                value: storeFilter,
                defaultValue: "ALL",
                options: storeFilterOptions(stores),
                onChange: (key) => setStoreFilter(key),
              },
            ]}
          />

          {loading ? (
            <SkeletonList count={6} type="card" />
          ) : listError ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              <p>{listError}</p>
              <button
                onClick={() => setRetryKey((k) => k + 1)}
                className="mt-2 inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-red-300 bg-white px-3 text-xs font-medium text-red-700"
              >
                <RefreshCw className="h-3.5 w-3.5" /> Try again
              </button>
            </div>
          ) : (
            <BillList bills={bills} />
          )}
        </>
      )}
    </div>
  );
}
