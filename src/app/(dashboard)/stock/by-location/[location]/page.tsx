"use client";

import { useState, useEffect, use, useMemo, useCallback, Suspense } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, Search, Package, Loader2, ChevronDown, ChevronLeft, ChevronRight,
  Warehouse, Store, SlidersHorizontal, X, MapPin
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { SkeletonList } from "@/components/ui/skeleton";
import { ErrorBanner } from "@/components/ui/error-banner";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { CategoryTreeSelect } from "@/components/category-tree-select";
import { ExportButtons } from "@/components/export-buttons";
import { exportToExcel, exportToPDF, type ExportColumn } from "@/lib/export";
import { usePermissions } from "@/lib/use-permissions";
import { useDebounce } from "@/hooks/use-debounce";
import { apiTry, apiFetch, apiFetchEnvelope } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";
import {
  DEFAULT_STOCK_SORT, type StockProduct, type StockRowContext, type StockSort, type StockSortKey,
} from "../../_components/stock-row";
import { StockTable } from "../../_components/stock-table";
import { ReorderSheet, type ReorderTarget, type ReorderSaved } from "@/components/reorder-sheet";
import { AssemblyLevelSheet, type AssemblyLevelTarget, type AssemblyLevelSaved } from "@/components/assembly-level-sheet";
import { AddStockSheet, type AddStockTarget, type AddStockDone } from "../../_components/add-stock-sheet";

const log = createLogger("stock:by-location");

const PAGE_SIZE = 100;
const EXPORT_PAGE_SIZE = 500;
const EXPORT_MAX_ROWS = 10_000;

const STOCK_COLUMNS: ExportColumn[] = [
  { header: "SKU", key: "sku" },
  { header: "Product Name", key: "name" },
  { header: "Category", key: "category.name" },
  { header: "Brand", key: "brand.name" },
  { header: "Stock", key: "currentStock" },
  { header: "Reorder Level", key: "reorderLevel" },
  { header: "Bin", key: "bin.code" },
];

type QuickFilter = "ALL" | "IN_STOCK" | "NO_STOCK" | "LOW_STOCK" | "INACTIVE" | "NEEDS_DETAILS" | "NO_ASSEMBLY";

const QUICK_CHIPS: { key: QuickFilter; label: string }[] = [
  { key: "ALL", label: "All" },
  { key: "IN_STOCK", label: "In Stock" },
  { key: "NO_STOCK", label: "No Stock" },
  { key: "LOW_STOCK", label: "Low Stock" },
  { key: "NEEDS_DETAILS", label: "Needs details" },
  { key: "NO_ASSEMBLY", label: "No assembly" },
  { key: "INACTIVE", label: "Inactive" },
];

interface LocMeta {
  code: string;
  level: "warehouse" | "store";
  storeId: string | null;
  warehouseId: string | null;
  label: string;
  warehouses: Array<{ code: string; name: string; units: number }> | null;
  warehouseList: Array<{ id: string; code: string; name: string }> | null;
  totalUnits: number;
  totalValue: number;
  productCount: number;
  brands: Array<{ id: string; name: string }> | null;
  bins: Array<{ id: string; code: string; name: string; warehouseId: string; warehouse?: { id: string; code: string; name: string } }> | null;
}

interface CategoryItem {
  id: string;
  name: string;
  parentId: string | null;
  isActive?: boolean;
  _count: { products: number };
}

type Notice = { tone: "success" | "info" | "error"; text: string };

function formatINR(n: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
}

function fmt(n: number) {
  return n.toLocaleString("en-IN");
}

export default function StockByLocationDetailPage({ params }: { params: Promise<{ location: string }> }) {
  const { location } = use(params);

  return (
    <Suspense fallback={<SkeletonList count={6} type="card" />}>
      <StockByLocationScreen location={location} />
    </Suspense>
  );
}

function StockByLocationScreen({ location }: { location: string }) {
  const router = useRouter();
  const { canEdit, canView, canApprove, canCreate } = usePermissions();

  const showCost = canView("cost_price");
  const mayDeactivate = canEdit("stock");
  const mayReorder = canEdit("reorder");
  const mayAssemblyLevel = canApprove("assembly");
  const mayAddStock = canCreate("inventory_adjustments");

  const [locMeta, setLocMeta] = useState<LocMeta | null>(null);
  const [categories, setCategories] = useState<CategoryItem[]>([]);
  const [metaLoading, setMetaLoading] = useState(true);
  const [metaError, setMetaError] = useState<string | null>(null);

  const [products, setProducts] = useState<StockProduct[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search);
  const [quickFilter, setQuickFilter] = useState<QuickFilter>("ALL");
  const [showFilters, setShowFilters] = useState(false);
  const [selectedBrand, setSelectedBrand] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("");
  const [selectedBin, setSelectedBin] = useState("");
  const [selectedWarehouse, setSelectedWarehouse] = useState("");

  const [sort, setSort] = useState<StockSort>(DEFAULT_STOCK_SORT);

  const [notice, setNotice] = useState<Notice | null>(null);
  const [exporting, setExporting] = useState(false);
  const [rowBusy, setRowBusy] = useState<string | null>(null);

  const [addTarget, setAddTarget] = useState<AddStockTarget | null>(null);
  const [reorderTarget, setReorderTarget] = useState<ReorderTarget | null>(null);
  const [levelTarget, setLevelTarget] = useState<AssemblyLevelTarget | null>(null);

  // Fetch location metadata + categories
  const loadMetadata = useCallback(async () => {
    setMetaLoading(true);
    setMetaError(null);
    try {
      const [locRes, catRes] = await Promise.all([
        apiTry<LocMeta>(`/api/stock/by-location/${location}`),
        apiTry<CategoryItem[]>("/api/categories"),
      ]);

      if (locRes.data) {
        setLocMeta(locRes.data);
      } else {
        const msg = locRes.error || "Location stock failed to load";
        log.error("location stock failed to load", { location, reason: locRes.error, status: locRes.status });
        setMetaError(msg);
      }

      if (catRes.data) {
        setCategories(catRes.data);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error loading location";
      setMetaError(msg);
    } finally {
      setMetaLoading(false);
    }
  }, [location]);

  useEffect(() => {
    void loadMetadata();
  }, [loadMetadata]);

  // Back button navigation
  const goBack = () => {
    if (typeof window !== "undefined" && window.history.length > 1) router.back();
    else router.push(locMeta?.level === "store" ? "/stock/by-store" : "/stock/by-bin");
  };

  // Build query params for /api/products
  const buildParams = useCallback((pageNum: number) => {
    const params = new URLSearchParams({
      limit: String(PAGE_SIZE),
      page: String(pageNum),
      sortBy: sort.sortBy,
      sortOrder: sort.sortOrder,
    });

    if (debouncedSearch) params.set("search", debouncedSearch);

    if (quickFilter === "INACTIVE") {
      params.set("status", "INACTIVE");
    } else if (quickFilter === "IN_STOCK") {
      params.set("status", "ACTIVE");
      params.set("minStock", "1");
    } else if (quickFilter === "NO_STOCK") {
      params.set("status", "ACTIVE");
      params.set("maxStock", "0");
    } else if (quickFilter === "LOW_STOCK") {
      params.set("status", "ACTIVE");
      params.set("lowStock", "1");
    } else if (quickFilter === "NEEDS_DETAILS") {
      params.set("status", "ACTIVE");
      params.set("needsDetails", "true");
    } else if (quickFilter === "NO_ASSEMBLY") {
      params.set("status", "ACTIVE");
      params.set("condition", "no-assembly");
    } else if (quickFilter === "ALL") {
      params.set("status", "ACTIVE");
    }

    if (selectedBrand) params.set("brandId", selectedBrand);
    if (selectedCategory) params.set("categoryId", selectedCategory);
    if (selectedBin) params.set("binId", selectedBin);

    // Location scope
    if (selectedWarehouse) {
      params.set("warehouseId", selectedWarehouse);
    } else if (locMeta?.warehouseId) {
      params.set("warehouseId", locMeta.warehouseId);
    } else if (locMeta?.storeId) {
      params.set("storeId", locMeta.storeId);
    }

    return params;
  }, [debouncedSearch, quickFilter, selectedBrand, selectedCategory, selectedBin, selectedWarehouse, locMeta, sort]);

  // Fetch paginated products from /api/products
  const fetchProducts = useCallback(async (pageNum: number, silent = false) => {
    if (!locMeta?.storeId && !locMeta?.warehouseId) return;

    if (!silent) setLoading(true);
    else setRefreshing(true);
    setDataError(null);

    try {
      const params = buildParams(pageNum);
      const res = await apiFetchEnvelope<StockProduct[]>(`/api/products?${params}`);
      setProducts(res.data);
      setTotal(res.pagination?.total ?? res.data.length);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load products";
      log.error("by-location product fetch failed", { location, message: msg });
      setDataError(msg);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [buildParams, locMeta, location]);

  useEffect(() => {
    if (locMeta) {
      setPage(1);
      void fetchProducts(1);
    }
  }, [locMeta, debouncedSearch, quickFilter, selectedBrand, selectedCategory, selectedBin, selectedWarehouse, sort]);

  function changeSort(key: StockSortKey) {
    setSort((prev) =>
      prev.sortBy === key
        ? { sortBy: key, sortOrder: prev.sortOrder === "asc" ? "desc" : "asc" }
        : { sortBy: key, sortOrder: key === "name" ? "asc" : "desc" }
    );
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function goToPage(next: number) {
    if (next < 1 || next > totalPages || next === page) return;
    setPage(next);
    void fetchProducts(next);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function pageWindow(): number[] {
    const from = Math.max(1, Math.min(page - 2, totalPages - 4));
    const to = Math.min(totalPages, from + 4);
    return Array.from({ length: to - from + 1 }, (_, i) => from + i);
  }

  async function setProductStatus(p: StockProduct, status: "ACTIVE" | "INACTIVE") {
    setRowBusy(p.id);
    try {
      const res = await apiFetch<{ message: string }>(`/api/products/${p.id}`, {
        method: "PATCH",
        json: { status },
      });
      setNotice({ tone: "success", text: res.message || `Product marked ${status.toLowerCase()}` });
      void fetchProducts(page);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not update the product";
      setNotice({ tone: "error", text: msg });
    } finally {
      setRowBusy(null);
    }
  }

  function applyStockAdded(done: AddStockDone) {
    setNotice({
      tone: "success",
      text: done.duplicate
        ? `Already added — ${done.productName} is now ${fmt(done.newStock)}`
        : `Added ${fmt(done.added)} to ${done.productName} — now ${fmt(done.newStock)} · bin ${done.binCode}`,
    });
    setAddTarget(null);
    void fetchProducts(page, true);
  }

  function applyReorderSaved(updated: ReorderSaved) {
    setProducts((prev) =>
      prev.map((p) =>
        p.id === updated.id
          ? {
              ...p,
              reorderLevel: updated.reorderLevel,
              reorderQty: updated.reorderQty,
              reorderVendorId: updated.reorderVendorId,
            }
          : p
      )
    );
    setReorderTarget(null);
  }

  function applyAssemblyLevelSaved(updated: AssemblyLevelSaved) {
    setProducts((prev) =>
      prev.map((p) => (p.id === updated.id ? { ...p, assemblyLevel: updated.assemblyLevel } : p))
    );
    setLevelTarget(null);
  }

  // Export
  async function exportAll(format: "excel" | "pdf") {
    if (exporting) return;
    setExporting(true);
    setNotice({ tone: "info", text: "Preparing the export…" });
    try {
      const rows: StockProduct[] = [];
      let matched = 0;
      for (let pageNum = 1; rows.length < EXPORT_MAX_ROWS; pageNum++) {
        const params = buildParams(pageNum);
        params.set("limit", String(EXPORT_PAGE_SIZE));
        const res = await apiFetchEnvelope<StockProduct[]>(`/api/products?${params}`);
        matched = res.pagination?.total ?? rows.length + res.data.length;
        rows.push(...res.data);
        if (res.data.length < EXPORT_PAGE_SIZE || rows.length >= matched) break;
        setNotice({
          tone: "info",
          text: `Preparing export — ${fmt(rows.length)} of ${fmt(Math.min(matched, EXPORT_MAX_ROWS))} products…`,
        });
      }
      if (rows.length === 0) {
        setNotice({ tone: "info", text: "Nothing to export — no products match these filters." });
        return;
      }
      const records = rows.slice(0, EXPORT_MAX_ROWS) as unknown as Record<string, unknown>[];
      const title = `Stock — ${locMeta?.label || location}`;
      const fileName = `stock-${(locMeta?.label || location).toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
      if (format === "excel") await exportToExcel(records, STOCK_COLUMNS, fileName);
      else await exportToPDF(title, records, STOCK_COLUMNS, fileName);
      setNotice({ tone: "success", text: `Exported ${fmt(records.length)} product${records.length === 1 ? "" : "s"}.` });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Export failed";
      setNotice({ tone: "error", text: `Export failed — ${msg}` });
    } finally {
      setExporting(false);
    }
  }

  const rowCtx: StockRowContext = {
    showCost,
    selectMode: false,
    selectedIds: new Set(),
    onToggleSelect: () => {},
    hrefFor: (p) => `/stock/${p.id}`,
    busyId: rowBusy,
    mayReorder,
    mayAssemblyLevel,
    mayDeactivate,
    mayAddStock,
    onAddStock: (p) => setAddTarget({ id: p.id, name: p.name, sku: p.sku }),
    onReorder: (p) => setReorderTarget(p),
    onAssemblyLevel: (p) =>
      setLevelTarget({ id: p.id, name: p.name, sku: p.sku, assemblyLevel: p.assemblyLevel ?? null }),
    onSetStatus: (p, status) => { void setProductStatus(p, status); },
  };

  const activeFilterCount = [selectedBrand, selectedCategory, selectedBin, selectedWarehouse].filter(Boolean).length;

  const availableBins = useMemo(() => {
    if (!locMeta?.bins) return [];
    if (selectedWarehouse) {
      return locMeta.bins.filter((b) => b.warehouseId === selectedWarehouse);
    }
    return locMeta.bins;
  }, [locMeta?.bins, selectedWarehouse]);

  function clearFilters() {
    setSelectedBrand("");
    setSelectedCategory("");
    setSelectedBin("");
    setSelectedWarehouse("");
  }

  if (metaLoading) {
    return (
      <div className="pb-10 space-y-4">
        <div className="flex items-center gap-3 mb-3">
          <div className="h-8 w-8 rounded-lg bg-slate-200 animate-pulse" />
          <div className="space-y-1.5 flex-1">
            <div className="h-5 w-40 bg-slate-200 rounded animate-pulse" />
            <div className="h-3.5 w-28 bg-slate-200 rounded animate-pulse" />
          </div>
        </div>
        <SkeletonList count={6} type="card" />
      </div>
    );
  }

  if (metaError || !locMeta) {
    return (
      <div className="pb-10">
        <div className="flex items-center gap-3 mb-3">
          <button onClick={goBack} className="p-1" aria-label="Back">
            <ArrowLeft className="h-5 w-5 text-slate-600" />
          </button>
          <h1 className="text-lg font-bold text-slate-900">{location}</h1>
        </div>
        <ErrorBanner
          message={metaError || "Could not load location details"}
          onRetry={loadMetadata}
          onDismiss={() => setMetaError(null)}
        />
      </div>
    );
  }

  const kind = locMeta.level;
  const label = locMeta.label || location;

  return (
    <div className="pb-10">
      {/* Top Header */}
      <div className="flex items-center justify-between mb-3 gap-2">
        <div className="flex items-center gap-3 min-w-0">
          <button onClick={goBack} className="p-1 shrink-0" aria-label="Back">
            <ArrowLeft className="h-5 w-5 text-slate-600" />
          </button>
          <div
            className={`h-9 w-9 rounded-xl flex items-center justify-center shrink-0 ${
              kind === "warehouse" ? "bg-amber-100 text-amber-700" : "bg-blue-100 text-blue-700"
            }`}
          >
            {kind === "warehouse" ? <Warehouse className="h-5 w-5" /> : <Store className="h-5 w-5" />}
          </div>
          <div className="min-w-0">
            <h1 className="text-lg font-bold text-slate-900 truncate">{label}</h1>
            <p className="text-xs text-slate-500 tabular-nums">
              {fmt(locMeta.totalUnits)} units · {formatINR(locMeta.totalValue)}
            </p>
          </div>
        </div>

        {/* Header Actions (Export) */}
        <div
          aria-busy={exporting}
          title={exporting ? "Preparing export…" : undefined}
          className={`shrink-0 ${exporting ? "pointer-events-none opacity-50" : ""}`}
        >
          <ExportButtons onExcel={() => void exportAll("excel")} onPDF={() => void exportAll("pdf")} />
        </div>
      </div>

      {/* Notice / Toast */}
      {notice && (
        <div
          role={notice.tone === "error" ? "alert" : "status"}
          className={`flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 mb-2.5 ${
            notice.tone === "success"
              ? "bg-green-50 border-green-200 text-green-800"
              : notice.tone === "error"
                ? "bg-red-50 border-red-200 text-red-700"
                : "bg-blue-50 border-blue-200 text-blue-800"
          }`}
        >
          <span className="text-xs font-medium break-words min-w-0 flex items-center gap-1.5">
            {exporting && notice.tone === "info" && <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" aria-hidden />}
            {notice.text}
          </span>
          {!(exporting && notice.tone === "info") && (
            <button
              type="button"
              onClick={() => setNotice(null)}
              aria-label="Dismiss"
              className="shrink-0 p-1 opacity-70 hover:opacity-100 focus-ring rounded"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}

      {/* Search Bar */}
      <div className="relative mb-3">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <Input
          placeholder="Search product name, SKU, brand, or category..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Filter Toggle + Quick Chips Row */}
      <div className="flex items-center gap-2 mb-3">
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={`shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium transition-colors border ${
            showFilters || activeFilterCount > 0
              ? "bg-slate-900 text-white border-slate-900"
              : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
          }`}
        >
          <SlidersHorizontal className="h-3 w-3" />
          Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
          <ChevronDown className={`h-3 w-3 transition-transform ${showFilters ? "rotate-180" : ""}`} />
        </button>

        <div className="flex gap-1.5 overflow-x-auto scrollbar-hide pb-0.5">
          {QUICK_CHIPS.map((chip) => (
            <button
              key={chip.key}
              onClick={() => setQuickFilter(chip.key)}
              className={`shrink-0 px-2.5 py-1.5 rounded-full text-xs font-medium transition-colors ${
                quickFilter === chip.key
                  ? "bg-slate-900 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {chip.label}
            </button>
          ))}
        </div>
      </div>

      {/* Collapsible Filter Panel */}
      {showFilters && (
        <Card className="mb-3 border-slate-200 shadow-sm">
          <CardContent className="p-3 space-y-2.5">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
              {/* Brand Filter */}
              <div>
                <label htmlFor="loc-filter-brand" className="text-[10px] font-medium text-slate-500 uppercase tracking-wide">
                  Brand
                </label>
                <SearchableSelect
                  id="loc-filter-brand"
                  className="mt-0.5"
                  options={(locMeta.brands || []).map((b) => ({
                    id: b.id,
                    label: b.name,
                  }))}
                  value={selectedBrand || null}
                  onChange={(id) => setSelectedBrand(id ?? "")}
                  placeholder={`All Brands (${(locMeta.brands || []).length})`}
                  emptyText="No matching brand"
                />
              </div>

              {/* Category Filter */}
              <div>
                <label htmlFor="loc-filter-category" className="text-[10px] font-medium text-slate-500 uppercase tracking-wide">
                  Category
                </label>
                <CategoryTreeSelect
                  id="loc-filter-category"
                  className="mt-0.5"
                  categories={categories}
                  value={selectedCategory || null}
                  onChange={(id) => setSelectedCategory(id ?? "")}
                  placeholder={`All Categories (${categories.length})`}
                  emptyText="No matching category"
                />
              </div>

              {/* Bin Filter */}
              <div>
                <label htmlFor="loc-filter-bin" className="text-[10px] font-medium text-slate-500 uppercase tracking-wide">
                  Bin
                </label>
                <SearchableSelect
                  id="loc-filter-bin"
                  className="mt-0.5"
                  options={availableBins.map((b) => ({
                    id: b.id,
                    label: b.code,
                    hint: b.name ? b.name : (b.warehouse?.name || undefined),
                  }))}
                  value={selectedBin || null}
                  onChange={(id) => setSelectedBin(id ?? "")}
                  placeholder={availableBins.length > 0 ? `All Bins (${availableBins.length})` : "No bins in this location"}
                  emptyText="No matching bin"
                  disabled={availableBins.length === 0}
                />
              </div>

              {/* Warehouse selector (if Store level with multiple warehouses) */}
              {kind === "store" && locMeta.warehouseList && locMeta.warehouseList.length > 1 && (
                <div>
                  <label htmlFor="loc-filter-warehouse" className="text-[10px] font-medium text-slate-500 uppercase tracking-wide">
                    Warehouse
                  </label>
                  <SearchableSelect
                    id="loc-filter-warehouse"
                    className="mt-0.5"
                    options={locMeta.warehouseList.map((w) => ({
                      id: w.id,
                      label: w.name,
                      hint: w.code,
                    }))}
                    value={selectedWarehouse || null}
                    onChange={(id) => {
                      setSelectedWarehouse(id ?? "");
                      setSelectedBin("");
                    }}
                    placeholder={`All Warehouses (${locMeta.warehouseList.length})`}
                    emptyText="No matching warehouse"
                  />
                </div>
              )}
            </div>

            {activeFilterCount > 0 && (
              <div className="flex justify-end pt-1 border-t border-slate-100">
                <Button variant="ghost" size="sm" onClick={clearFilters} className="text-xs text-slate-500 h-7 px-2">
                  Clear filters
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Products Counter / Status line */}
      <div className="flex items-center justify-between mb-2 text-xs">
        <span className="text-slate-500">
          {loading ? (
            "Loading products…"
          ) : (
            `Showing ${total > 0 ? (page - 1) * PAGE_SIZE + 1 : 0}–${Math.min(page * PAGE_SIZE, total)} of ${fmt(total)} products`
          )}
          {refreshing && " · Updating…"}
        </span>
      </div>

      {/* Error state */}
      {dataError && (
        <ErrorBanner
          message={dataError}
          onRetry={() => void fetchProducts(page)}
          onDismiss={() => setDataError(null)}
        />
      )}

      {/* Product List / Table */}
      {loading ? (
        <SkeletonList count={6} type="card" />
      ) : products.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-xl border border-slate-200">
          <Package className="h-10 w-10 text-slate-300 mx-auto mb-2" />
          <p className="text-sm font-medium text-slate-600">No products found</p>
          <p className="text-xs text-slate-400 mt-0.5">
            {activeFilterCount > 0 || search || quickFilter !== "ALL"
              ? "Try adjusting your search or filters."
              : "No stock recorded at this location."}
          </p>
          {(activeFilterCount > 0 || search || quickFilter !== "ALL") && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setSearch("");
                setQuickFilter("ALL");
                clearFilters();
              }}
              className="mt-3 text-xs"
            >
              Reset filters
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {/* Main Table */}
          <StockTable
            key={page}
            products={products}
            ctx={rowCtx}
            sort={sort}
            onSort={changeSort}
          />

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <nav aria-label="Product pages" className="flex flex-wrap items-center justify-between gap-2 pt-2">
              <p className="text-xs text-slate-500 tabular-nums">
                Page {page.toLocaleString("en-IN")} of {totalPages.toLocaleString("en-IN")}
              </p>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  className="min-h-[36px] px-2.5 text-xs"
                  onClick={() => goToPage(1)}
                  disabled={page === 1 || loading}
                  aria-label="First page"
                >
                  First
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="min-h-[36px] px-2"
                  onClick={() => goToPage(page - 1)}
                  disabled={page === 1 || loading}
                  aria-label="Previous page"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                {pageWindow().map((n) => (
                  <Button
                    key={n}
                    variant={n === page ? "default" : "outline"}
                    size="sm"
                    className="min-h-[36px] min-w-[36px] px-2 text-xs tabular-nums"
                    onClick={() => goToPage(n)}
                    disabled={loading}
                    aria-current={n === page ? "page" : undefined}
                  >
                    {n}
                  </Button>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  className="min-h-[36px] px-2"
                  onClick={() => goToPage(page + 1)}
                  disabled={page === totalPages || loading}
                  aria-label="Next page"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="min-h-[36px] px-2.5 text-xs"
                  onClick={() => goToPage(totalPages)}
                  disabled={page === totalPages || loading}
                  aria-label="Last page"
                >
                  Last
                </Button>
              </div>
            </nav>
          )}
        </div>
      )}

      {/* Row Action Sheets */}
      <ReorderSheet
        open={reorderTarget !== null}
        product={reorderTarget}
        onClose={() => setReorderTarget(null)}
        onSaved={applyReorderSaved}
      />

      <AssemblyLevelSheet
        open={levelTarget !== null}
        product={levelTarget}
        onClose={() => setLevelTarget(null)}
        onSaved={applyAssemblyLevelSaved}
      />

      <AddStockSheet
        open={addTarget !== null}
        product={addTarget}
        onClose={() => setAddTarget(null)}
        onAdded={applyStockAdded}
      />
    </div>
  );
}
