"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Search } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/error-banner";
import { SkeletonList } from "@/components/ui/skeleton";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";
import { useDebounce } from "@/hooks/use-debounce";
import { useStores } from "@/hooks/use-sites";

const log = createLogger("stock:condition-page");

const PAGE_SIZE = 50;

interface ConditionRow {
  productId: string;
  productName: string;
  sku: string;
  brandName: string | null;
  storeId: string;
  storeName: string;
  warehouseId: string;
  warehouseName: string;
  warehouseKind: "FLOOR" | "GODOWN";
  assembled: number;
  unassembled: number;
  noAssembly: number;
  total: number;
}

interface ConditionTotals {
  assembled: number;
  unassembled: number;
  noAssembly: number;
  total: number;
}

interface ConditionResponse {
  rows: ConditionRow[];
  totals: ConditionTotals;
  pagination: { total: number; page: number; limit: number; totalPages: number; hasMore: boolean };
}

interface BrandItem { id: string; name: string }

/**
 * Assembled vs unassembled — per model, per location (plan 1709-priority-build-and-stock-flow,
 * R11, P7). Counts come from the units (GET /api/stock/condition, `stock.view`). The Unassembled
 * number opens the build line filtered to that model and warehouse; Assembled opens /stock on
 * that product in that store.
 */
export default function StockConditionPage() {
  const { stores, loading: storesLoading, error: storesError } = useStores();
  const [brands, setBrands] = useState<BrandItem[]>([]);

  const [storeId, setStoreId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [brandId, setBrandId] = useState("");
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search);

  const [rows, setRows] = useState<ConditionRow[]>([]);
  const [totals, setTotals] = useState<ConditionTotals | null>(null);
  const [page, setPage] = useState(1);
  const [groupCount, setGroupCount] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void apiTry<BrandItem[]>("/api/brands").then(({ data, error: err }) => {
      if (data) setBrands(data);
      else log.warn("brand list unavailable", { message: err });
    });
  }, []);

  // A warehouse belongs to one store: changing the store clears a warehouse from another.
  const warehouseOptions = (storeId ? stores.filter((s) => s.id === storeId) : stores).flatMap((s) =>
    s.warehouses.map((w) => ({
      id: w.id,
      label: w.name,
      hint: `${s.name} · ${w.kind === "FLOOR" ? "Floor" : "Godown"}`,
    }))
  );

  // The filter set as a query string. Loading is DERIVED — "the rows on screen were fetched for a
  // different query" — rather than flipped on inside the effect, which would be a synchronous
  // setState in an effect body.
  const baseQuery = (() => {
    const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
    if (storeId) params.set("storeId", storeId);
    if (warehouseId) params.set("warehouseId", warehouseId);
    if (brandId) params.set("brandId", brandId);
    if (debouncedSearch.trim()) params.set("search", debouncedSearch.trim());
    return params.toString();
  })();
  const [loadedQuery, setLoadedQuery] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const loading = loadedQuery !== baseQuery;

  const fetchPage = useCallback(async (query: string, pageNum: number) => {
    const res = await apiTry<ConditionResponse>(`/api/stock/condition?${query}&page=${pageNum}`);
    if (!res.data) log.error("condition list failed", { page: pageNum, query, message: res.error });
    return res;
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data, error: err } = await fetchPage(baseQuery, 1);
      if (cancelled) return;
      if (data) {
        setRows(data.rows);
        setTotals(data.totals);
        setGroupCount(data.pagination.total);
        setHasMore(data.pagination.hasMore);
        setPage(1);
        setError(null);
      } else {
        setRows([]);
        setError(err ?? "Could not load stock condition");
      }
      setLoadedQuery(baseQuery);
    })();
    return () => {
      cancelled = true;
    };
  }, [baseQuery, reloadKey, fetchPage]);

  async function loadMore() {
    setLoadingMore(true);
    const next = page + 1;
    const { data, error: err } = await fetchPage(baseQuery, next);
    if (data) {
      setRows((prev) => [...prev, ...data.rows]);
      setHasMore(data.pagination.hasMore);
      setPage(next);
    } else {
      setError(err ?? "Could not load more rows");
    }
    setLoadingMore(false);
  }

  function retry() {
    setError(null);
    setLoadedQuery(null);
    setReloadKey((k) => k + 1);
  }

  const assemblyHref = (r: ConditionRow) =>
    `/assembly?tab=awaiting&productId=${encodeURIComponent(r.productId)}&warehouseId=${encodeURIComponent(r.warehouseId)}`;
  // /stock has no per-warehouse filter; the closest honest view is that product in that store.
  const stockHref = (r: ConditionRow) =>
    `/stock?search=${encodeURIComponent(r.sku)}&storeId=${encodeURIComponent(r.storeId)}`;

  const activeFilters = [storeId, warehouseId, brandId].filter(Boolean).length;

  return (
    <div>
      <div className="flex items-center gap-3 mb-3">
        <Link href="/stock" className="p-2 -ml-2 rounded-lg hover:bg-slate-100" aria-label="Back to stock">
          <ArrowLeft className="h-5 w-5 text-slate-600" />
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-bold text-slate-900">Assembled vs unassembled</h1>
          <p className="text-xs text-slate-500">Per model, per location — counted from unit codes</p>
        </div>
      </div>

      {/* Totals for the current filter */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        <SummaryTile label="Assembled" value={totals?.assembled} tone="text-emerald-700" loading={loading && !totals} />
        <SummaryTile label="Unassembled" value={totals?.unassembled} tone="text-amber-700" loading={loading && !totals} />
        <SummaryTile label="No assembly" value={totals?.noAssembly} tone="text-slate-600" loading={loading && !totals} />
      </div>

      {/* Filters */}
      <Card className="mb-3">
        <CardContent className="p-3 space-y-2.5">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input
              placeholder="Search model or SKU..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <div>
              <label htmlFor="cond-store" className="text-[10px] font-medium text-slate-500 uppercase tracking-wide">Store</label>
              <SearchableSelect
                id="cond-store"
                className="mt-0.5"
                options={stores.map((s) => ({ id: s.id, label: s.name }))}
                value={storeId || null}
                onChange={(id) => {
                  setStoreId(id ?? "");
                  setWarehouseId("");
                }}
                placeholder={storesLoading ? "Loading stores…" : "All stores"}
                emptyText="No matching store"
                disabled={storesLoading || !!storesError}
              />
            </div>
            <div>
              <label htmlFor="cond-warehouse" className="text-[10px] font-medium text-slate-500 uppercase tracking-wide">Warehouse</label>
              <SearchableSelect
                id="cond-warehouse"
                className="mt-0.5"
                options={warehouseOptions}
                value={warehouseId || null}
                onChange={(id) => setWarehouseId(id ?? "")}
                placeholder={storesLoading ? "Loading…" : "All warehouses"}
                emptyText="No matching warehouse"
                disabled={storesLoading || !!storesError}
              />
            </div>
            <div>
              <label htmlFor="cond-brand" className="text-[10px] font-medium text-slate-500 uppercase tracking-wide">Brand</label>
              <SearchableSelect
                id="cond-brand"
                className="mt-0.5"
                options={brands.map((b) => ({ id: b.id, label: b.name }))}
                value={brandId || null}
                onChange={(id) => setBrandId(id ?? "")}
                placeholder="All brands"
                emptyText="No matching brand"
              />
            </div>
          </div>
          {storesError && <p className="text-[11px] text-red-500">Could not load stores</p>}
          {activeFilters > 0 && (
            <button
              type="button"
              onClick={() => {
                setStoreId("");
                setWarehouseId("");
                setBrandId("");
              }}
              className="text-xs text-red-500 font-medium min-h-[32px]"
            >
              Clear filters
            </button>
          )}
        </CardContent>
      </Card>

      {error && (
        <ErrorBanner message={error} onRetry={retry} onDismiss={() => setError(null)} />
      )}

      <p className="text-xs text-slate-500 mb-2 tabular-nums">
        {loading ? "Loading…" : `${rows.length} of ${groupCount.toLocaleString("en-IN")} model · location rows`}
      </p>

      {loading ? (
        <SkeletonList count={6} type="card" />
      ) : rows.length === 0 && !error ? (
        <Card>
          <CardContent className="p-6 text-center text-sm text-slate-500">
            No unit codes match these filters. Stock without unit codes is not counted here — generate
            codes or run a unit-level audit for that warehouse.
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Phone: one card per row */}
          <div className="space-y-2 md:hidden">
            {rows.map((r) => (
              <Card key={`${r.productId}:${r.warehouseId}`}>
                <CardContent className="p-3">
                  <p className="text-sm font-semibold text-slate-900 line-clamp-2 break-words" title={r.productName}>
                    {r.productName}
                  </p>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    {r.sku}
                    {r.brandName ? ` · ${r.brandName}` : ""}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    {r.storeName} · {r.warehouseName} ({r.warehouseKind === "FLOOR" ? "Floor" : "Godown"})
                  </p>
                  <div className="grid grid-cols-4 gap-1 mt-2 text-center tabular-nums">
                    <CountCell label="Assembled" value={r.assembled} href={r.assembled > 0 ? stockHref(r) : null} tone="text-emerald-700" />
                    <CountCell label="Unassembled" value={r.unassembled} href={r.unassembled > 0 ? assemblyHref(r) : null} tone="text-amber-700" />
                    <CountCell label="No assembly" value={r.noAssembly} href={null} tone="text-slate-600" />
                    <CountCell label="Total" value={r.total} href={null} tone="text-slate-900" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Wider screens: a table */}
          <Card className="hidden md:block overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="text-left font-semibold px-3 py-2">Model</th>
                    <th className="text-left font-semibold px-3 py-2">Store</th>
                    <th className="text-left font-semibold px-3 py-2">Warehouse</th>
                    <th className="text-right font-semibold px-3 py-2">Assembled</th>
                    <th className="text-right font-semibold px-3 py-2">Unassembled</th>
                    <th className="text-right font-semibold px-3 py-2">No assembly</th>
                    <th className="text-right font-semibold px-3 py-2">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((r) => (
                    <tr key={`${r.productId}:${r.warehouseId}`} className="hover:bg-slate-50">
                      <td className="px-3 py-2">
                        <p className="font-medium text-slate-900 line-clamp-1" title={r.productName}>{r.productName}</p>
                        <p className="text-[11px] text-slate-500">
                          {r.sku}
                          {r.brandName ? ` · ${r.brandName}` : ""}
                        </p>
                      </td>
                      <td className="px-3 py-2 text-slate-700">{r.storeName}</td>
                      <td className="px-3 py-2 text-slate-700">
                        {r.warehouseName}
                        <span className="ml-1 text-[11px] text-slate-400">{r.warehouseKind === "FLOOR" ? "Floor" : "Godown"}</span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        <NumberLink value={r.assembled} href={r.assembled > 0 ? stockHref(r) : null} tone="text-emerald-700" />
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        <NumberLink value={r.unassembled} href={r.unassembled > 0 ? assemblyHref(r) : null} tone="text-amber-700" />
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-600">{r.noAssembly}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold text-slate-900">{r.total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {hasMore && (
            <Button
              variant="outline"
              className="w-full mt-3"
              onClick={() => void loadMore()}
              disabled={loadingMore}
            >
              {loadingMore ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Loading...
                </>
              ) : (
                `Load more (${(groupCount - rows.length).toLocaleString("en-IN")} remaining)`
              )}
            </Button>
          )}
        </>
      )}
    </div>
  );
}

function SummaryTile({ label, value, tone, loading }: { label: string; value?: number; tone: string; loading: boolean }) {
  return (
    <Card>
      <CardContent className="p-2.5 text-center">
        <p className={`text-lg font-bold tabular-nums ${tone}`}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin mx-auto text-slate-300" /> : (value ?? 0).toLocaleString("en-IN")}
        </p>
        <p className="text-[10px] uppercase tracking-wide text-slate-500">{label}</p>
      </CardContent>
    </Card>
  );
}

function CountCell({ label, value, href, tone }: { label: string; value: number; href: string | null; tone: string }) {
  const body = (
    <>
      <p className={`text-base font-bold ${tone}`}>{value}</p>
      <p className="text-[9px] uppercase tracking-wide text-slate-500 leading-tight">{label}</p>
    </>
  );
  return href ? (
    <Link href={href} className="block rounded-lg bg-slate-50 py-1.5 min-h-[44px] hover:bg-slate-100 underline-offset-2">
      {body}
    </Link>
  ) : (
    <div className="rounded-lg py-1.5 min-h-[44px]">{body}</div>
  );
}

function NumberLink({ value, href, tone }: { value: number; href: string | null; tone: string }) {
  return href ? (
    <Link href={href} className={`font-semibold underline underline-offset-2 ${tone}`}>
      {value}
    </Link>
  ) : (
    <span className={value > 0 ? tone : "text-slate-400"}>{value}</span>
  );
}
