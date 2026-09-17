"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";
import type { AssemblyData, FilterOptions, PendingUnit, SortKey, UnitIdsData } from "./types";

const log = createLogger("assembly:unit-list");

export interface UnitFilters {
  q: string;
  productId: string;
  brandId: string;
  warehouseId: string;
  binId: string;
  sort: SortKey;
}

export const EMPTY_FILTERS: UnitFilters = { q: "", productId: "", brandId: "", warehouseId: "", binId: "", sort: "delivery" };

/** `only=pending` (Awaiting) or `only=no-assembly` (R42). */
export type UnitListMode = "pending" | "no-assembly";

function query(mode: UnitListMode, f: UnitFilters, extra: Record<string, string>): string {
  const p = new URLSearchParams({ only: mode });
  if (f.q.trim()) p.set("q", f.q.trim());
  if (f.productId) p.set("productId", f.productId);
  if (f.brandId) p.set("brandId", f.brandId);
  if (f.warehouseId) p.set("warehouseId", f.warehouseId);
  if (f.binId) p.set("binId", f.binId);
  if (f.sort !== "delivery") p.set("sort", f.sort);
  for (const [k, v] of Object.entries(extra)) p.set(k, v);
  return `/api/assembly/tasks?${p.toString()}`;
}

/**
 * The filtered, paged unit list behind Awaiting and No assembly. Filters are state; the search
 * box is debounced, every other filter reloads at once. Page size is the server's (100).
 */
export function useUnitList(mode: UnitListMode, initial: Partial<UnitFilters>) {
  const [filters, setFilters] = useState<UnitFilters>({ ...EMPTY_FILTERS, ...initial });
  const [units, setUnits] = useState<PendingUnit[]>([]);
  const [total, setTotal] = useState(0);
  const [starredTotal, setStarredTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [options, setOptions] = useState<FilterOptions | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<AssemblyData["selectedProduct"]>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const optionsLoaded = useRef(false);
  const filtersRef = useRef(filters);
  useEffect(() => {
    filtersRef.current = filters;
  }, [filters]);

  const load = useCallback(
    async (f: UnitFilters, nextPage: number, append: boolean) => {
      setLoading(true);
      setError("");
      const extra: Record<string, string> = { pendingPage: String(nextPage) };
      if (!optionsLoaded.current) extra.filters = "1";
      const { data, error: failed, status } = await apiTry<AssemblyData>(query(mode, f, extra));
      // A slower, older request must not overwrite a newer filter's answer.
      if (filtersRef.current !== f) return;
      setLoading(false);
      if (failed || !data) {
        log.error("unit list load failed", { mode, status, page: nextPage });
        setError(failed || "Could not load the list");
        return;
      }
      setUnits((prev) => (append ? [...prev, ...(data.pendingUnits ?? [])] : data.pendingUnits ?? []));
      setTotal(data.pendingTotal ?? 0);
      setStarredTotal(data.starredTotal ?? 0);
      setPage(data.pendingPage ?? nextPage);
      setHasMore(!!data.pendingHasMore);
      if (data.filterOptions) {
        optionsLoaded.current = true;
        setOptions(data.filterOptions);
      }
      setSelectedProduct(data.selectedProduct ?? null);
    },
    [mode]
  );

  // Debounce the search box (~300 ms); other filters feel instant at the same delay. The fetch
  // runs from the timer, not the effect body (react-hooks/set-state-in-effect).
  useEffect(() => {
    const timer = setTimeout(() => void load(filters, 1, false), 300);
    return () => clearTimeout(timer);
  }, [filters, load, reloadKey]);

  const loadMore = useCallback(() => void load(filters, page + 1, true), [filters, load, page]);
  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  /** Every matching id — "Select all N matching" (R8). */
  const fetchAllIds = useCallback(async (): Promise<UnitIdsData | null> => {
    const { data, error: failed, status } = await apiTry<UnitIdsData>(query(mode, filtersRef.current, { pendingIds: "1" }));
    if (failed || !data) {
      log.error("unit ids load failed", { mode, status });
      setError(failed || "Could not select every matching bicycle");
      return null;
    }
    return data;
  }, [mode]);

  return {
    filters,
    setFilters,
    units,
    total,
    starredTotal,
    hasMore,
    loading,
    error,
    options,
    selectedProduct,
    loadMore,
    reload,
    fetchAllIds,
  };
}
