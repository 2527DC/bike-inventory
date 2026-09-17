"use client";
import { useDebounce } from "@/hooks/use-debounce";

import { useState, useEffect, useCallback, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { Search, MapPin, Loader2, SlidersHorizontal, ChevronDown, RefreshCw, CheckSquare, Square, X, Package, EyeOff, RotateCcw, Store, Wrench, Tags, Layers, BarChart3 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { fuzzySearchFields } from "@/lib/utils";
import { ExportButtons } from "@/components/export-buttons";
import { exportToExcel, exportToPDF, type ExportColumn } from "@/lib/export";
import { usePermissions } from "@/lib/use-permissions";
import { createLogger } from "@/lib/logger";
import { ActionConfirmation } from "@/components/ui/action-confirmation";
import { apiFetch, apiFetchEnvelope, apiTry } from "@/lib/api-client";
import { ErrorBanner } from "@/components/ui/error-banner";
import { SkeletonList } from "@/components/ui/skeleton";
import { useBinTracking } from "@/hooks/use-bin-tracking";
import { isPlaceholderBrand, isPlaceholderCategory } from "@/lib/import-placeholders";
import { isLowStock } from "@/lib/reorder";
import { ReorderSheet, type ReorderTarget, type ReorderSaved } from "@/components/reorder-sheet";
import { AssemblyLevelSheet, type AssemblyLevelTarget, type AssemblyLevelSaved } from "@/components/assembly-level-sheet";
import { ASSEMBLY_LEVELS, assemblyLevelLabel, type AssemblyLevelValue } from "@/lib/assembly-level";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useStores } from "@/hooks/use-sites";
import { CategoryTreeSelect } from "@/components/category-tree-select";

const STOCK_COLUMNS: ExportColumn[] = [
  { header: "SKU", key: "sku" },
  { header: "Product Name", key: "name" },
  { header: "Category", key: "category.name" },
  { header: "Brand", key: "brand.name" },
  { header: "Stock", key: "currentStock" },
  { header: "Reorder Level", key: "reorderLevel" },
  { header: "Bin", key: "bin.code" },
];

interface ProductItem {
  id: string;
  sku: string;
  name: string;
  status: string;
  currentStock: number;
  reorderLevel: number;
  sellingPrice: number;
  mrp: number;
  /** Omitted by the API for anyone without `cost_price.view` — see
   *  api/products/route.ts:100, where the select reads `costPrice: isAdmin`.
   *  Optional here because it genuinely is absent, not zero. */
  costPrice?: number;
  category: { name: string } | null;
  brand: { id: string; name: string } | null;
  bin: { code: string; location: string } | null;
  reorderQty: number;
  reorderVendorId: string | null;
  /** The product's one assembly condition level; null = the next Assign asks (plan 1509, D3). */
  assemblyLevel: AssemblyLevelValue | null;
  /**
   * Live units by condition (plan 1709, R10, P7) — counted from the units, in the scoped store
   * when there is one. All three are 0 for a product whose stock has no unit codes yet.
   */
  assembledUnits: number;
  unassembledUnits: number;
  noAssemblyUnits: number;
}

interface BrandItem { id: string; name: string; _count: { products: number }; }
interface BinItem { id: string; code: string; name: string; location: string; _count: { products: number }; }
interface CategoryItem { id: string; name: string; parentId: string | null; isActive?: boolean; _count: { products: number }; }

type QuickFilter = "ALL" | "IN_STOCK" | "NO_STOCK" | "LOW_STOCK" | "INACTIVE" | "NEEDS_DETAILS" | "NO_ASSEMBLY";

const QUICK_CHIPS: { key: QuickFilter; label: string }[] = [
  { key: "ALL", label: "All" },
  { key: "IN_STOCK", label: "In Stock" },
  { key: "NO_STOCK", label: "No Stock" },
  { key: "LOW_STOCK", label: "Low Stock" },
  // The fix-up queue: products with no real brand. Paired with Select + bulk assign below,
  // this is the whole workflow for describing an imported catalog — find the rows nobody has
  // described, describe them in one action. Category is not part of the test; see
  // api/products/route.ts, where including it would return every row.
  { key: "NEEDS_DETAILS", label: "Needs details" },
  // R42: products holding items that need no assembly (units stamped non-assemblable by their
  // bin). Server-side, like Needs details, for the same reason — the list is paginated.
  { key: "NO_ASSEMBLY", label: "No assembly" },
  { key: "INACTIVE", label: "Inactive" },
];

const QUICK_KEYS = new Set<string>(QUICK_CHIPS.map((c) => c.key));

const log = createLogger("stock");

const PAGE_SIZE = 100;

// The out-of-stock branch comes FIRST in all three, so "low" here means low AND still on the
// shelf. isLowStock alone does not say that — it is true at zero too — which is why the order
// of these branches is behaviour, not style. The LOW_STOCK filter below deliberately differs.
function getStockColor(p: ProductItem) {
  if (p.currentStock <= 0) return "text-red-600";
  if (isLowStock(p)) return "text-yellow-600";
  return "text-green-600";
}

function getStockBadge(p: ProductItem) {
  if (p.currentStock <= 0) return { variant: "danger" as const, label: "Out" };
  if (isLowStock(p)) return { variant: "warning" as const, label: "Low" };
  return { variant: "success" as const, label: "OK" };
}

function getStockAccent(p: ProductItem) {
  if (p.status === "INACTIVE") return "border-l-slate-200";
  if (p.currentStock <= 0) return "border-l-red-500";
  if (isLowStock(p)) return "border-l-amber-400";
  return "border-l-green-500";
}

/**
 * `useSearchParams` must sit under a Suspense boundary or the production build fails
 * prerendering the page (node_modules/next/dist/docs/01-app/03-api-reference/04-functions/
 * use-search-params.md) — same wrapper as purchase-orders/page.tsx.
 */
export default function StockPage() {
  return (
    <Suspense fallback={<SkeletonList count={6} type="card" />}>
      <StockScreen />
    </Suspense>
  );
}

function StockScreen() {
  const { data: session } = useSession();
  const { canEdit, canView, canApprove } = usePermissions();

  // Deep links (plan 1709, R11): /stock/condition links here with the product's SKU and store,
  // and `?condition=no-assembly` opens the No assembly chip. Read ONCE as initial state — the
  // screen's filters stay local state after that, as they always were.
  const searchParams = useSearchParams();
  const initialQuick: QuickFilter =
    searchParams.get("condition") === "no-assembly"
      ? "NO_ASSEMBLY"
      : QUICK_KEYS.has(searchParams.get("quick") ?? "")
        ? (searchParams.get("quick") as QuickFilter)
        : "ALL";
  // Bulk edit writes product fields, so it is stock.edit.
  const canBulkEdit = canEdit("stock");

  // Cost price is its own module, not an admin flag — CLAUDE.md. This only hides the label;
  // the API already withholds the field itself, which is the gate that matters.
  const showCost = canView("cost_price");

  // Deactivate / restore are edits — the row survives with all its history, and that is now
  // the ONLY way a product leaves this screen. There is no permanent delete: the button, the
  // one-dialog confirm flow and `DELETE /api/products/[id]` were all removed on 8 Sep 2026
  // (owner's instruction). Nothing in the schema cascades onto Product, so deleting one meant
  // hand-rolling a nine-table cascade that rewrote what a shipment, order, transfer and stock
  // count each said had happened — with no undo. INACTIVE hides the row and keeps all of it.
  const mayDeactivate = canEdit("stock");

  // reorder.edit, NOT stock.edit. PUT /api/products/[id]/reorder is guarded on reorder.edit
  // because api/reorder/update-levels already writes these same three columns behind it
  // (owner, 6 Sep). Gating this button on stock.edit instead would show it to people the
  // route then answers with 403 — which is exactly the bug P7 had to fix on inbound.
  // Consequence to grant: a role with stock.edit and no reorder.edit does not see Reorder.
  const mayReorder = canEdit("reorder");

  // assembly.approve, NOT stock.edit (owner, 15 Sep — plan 1509-assembly-queue…, Q5/D4). The
  // level decides how a bicycle is built, and the Assign modal that also writes it is behind
  // assembly.approve; PUT /api/products/[id]/assembly-level demands the same, so the button and
  // the route can never disagree.
  const mayAssemblyLevel = canApprove("assembly");

  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [reorderTarget, setReorderTarget] = useState<ReorderTarget | null>(null);
  const [levelTarget, setLevelTarget] = useState<AssemblyLevelTarget | null>(null);
  const [rowOutcome, setRowOutcome] = useState<{ ok: boolean; name: string; message: string } | null>(null);

  const [dataError, setDataError] = useState<string | null>(null);
  const [products, setProducts] = useState<ProductItem[]>([]);
  const { isBinTrackingEnabled: BIN_TRACKING_ENABLED } = useBinTracking();
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [search, setSearch] = useState(() => searchParams.get("search") ?? "");
  const debouncedSearch = useDebounce(search);
  const [quickFilter, setQuickFilter] = useState<QuickFilter>(initialQuick);
  const [showFilters, setShowFilters] = useState(false);
  const [selectedBrand, setSelectedBrand] = useState(() => searchParams.get("brandId") ?? "");
  const [selectedCategory, setSelectedCategory] = useState(() => searchParams.get("categoryId") ?? "");
  const [selectedBin, setSelectedBin] = useState("");
  // The store scope (plan 0909-stock-store-and-warehouse-scoping, C2). "" is no scope. When
  // set, the API answers with only what that store holds and every Stock figure on the page
  // is that store's, not the global total — the caption under the control says so.
  const [selectedStore, setSelectedStore] = useState(() => searchParams.get("storeId") ?? "");
  const { stores, loading: storesLoading, error: storesError } = useStores();
  const [brands, setBrands] = useState<BrandItem[]>([]);
  const [bins, setBins] = useState<BinItem[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const [refreshing, setRefreshing] = useState(false);

  // Bulk select mode
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState<"" | "brand" | "status" | "category" | "bin" | "vendor" | "assembly">("");
  // "" = nothing chosen yet; "NONE" = clear the level on the selected rows.
  const [bulkAssemblyLevel, setBulkAssemblyLevel] = useState<"" | "NONE" | AssemblyLevelValue>("");
  const [bulkVendorId, setBulkVendorId] = useState("");
  const [bulkVendors, setBulkVendors] = useState<Array<{ id: string; name: string; code: string }>>([]);
  const [bulkBrandId, setBulkBrandId] = useState("");
  const [bulkStatus, setBulkStatus] = useState<"ACTIVE" | "INACTIVE">("INACTIVE");
  const [bulkCategoryId, setBulkCategoryId] = useState("");
  // The shelf. Unlike brand and category this is not something an import got wrong — it is
  // something no import could ever know, so bulk assign is the ONLY way it gets filled for a
  // freshly imported batch. Behind BIN_TRACKING_ENABLED with the rest of the bin UI.
  const [bulkBinId, setBulkBinId] = useState("");
  const [categories, setCategories] = useState<CategoryItem[]>([]);

  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkMessage, setBulkMessage] = useState("");

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function selectAll() {
    setSelectedIds(new Set(filtered.map((p) => p.id)));
  }

  function deselectAll() {
    setSelectedIds(new Set());
  }

  function exitSelectMode() {
    setSelectMode(false);
    setSelectedIds(new Set());
    setBulkAction("");
    setBulkVendorId("");
    setBulkMessage("");
  }

  async function handleBulkApply() {
    if (selectedIds.size === 0) return;
    setBulkLoading(true);
    setBulkMessage("");
    try {
      const body: Record<string, unknown> = { productIds: Array.from(selectedIds) };
      if (bulkAction === "brand" && bulkBrandId) body.brandId = bulkBrandId;
      if (bulkAction === "status") body.status = bulkStatus;
      if (bulkAction === "category" && bulkCategoryId) body.categoryId = bulkCategoryId;
      if (bulkAction === "bin" && bulkBinId) body.binId = bulkBinId;
      // "" is a real choice here — "clear the reorder vendor on these rows" — so it is sent as
      // null rather than skipped the way the truthy-guarded fields above are.
      if (bulkAction === "vendor") body.reorderVendorId = bulkVendorId || null;
      // "NONE" is sent as null — "these rows go back to asking at the next Assign".
      if (bulkAction === "assembly" && bulkAssemblyLevel) {
        body.assemblyLevel = bulkAssemblyLevel === "NONE" ? null : bulkAssemblyLevel;
      }

      // apiFetch, not `.then(r => r.json())`. A bulk assign is the one action here that
      // silently rewrites 500 rows, and on an expired session the raw form turned a 307 to
      // the login page into `Unexpected token '<'` — a parse error where the real answer was
      // "you are logged out and nothing was written".
      const data = await apiFetch<{ updated: number }>("/api/products/bulk", {
        method: "POST",
        json: body,
      });

      log.info("bulk assign applied", { field: bulkAction, selected: selectedIds.size, updated: data.updated });
      setBulkMessage(`Updated ${data.updated} products`);
      exitSelectMode();
      fetchProducts(1);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed";
      log.error("bulk assign failed", { field: bulkAction, selected: selectedIds.size, message });
      setBulkMessage(message);
    } finally {
      setBulkLoading(false);
    }
  }

  function formatCurrency(amount: number) {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount);
  }

  // Fetch brands + categories + bins once. apiTry, not `fetch().json()` (CLAUDE.md): each list
  // failing on its own leaves its picker empty and says why in the log, rather than a parse
  // error from a login page swallowing all three.
  useEffect(() => {
    void Promise.all([
      apiTry<BrandItem[]>("/api/brands"),
      apiTry<BinItem[]>("/api/bins"),
      apiTry<CategoryItem[]>("/api/categories"),
    ]).then(([brandsRes, binsRes, catsRes]) => {
      if (brandsRes.data) setBrands(brandsRes.data);
      else log.warn("brand list unavailable", { message: brandsRes.error });
      if (binsRes.data) setBins(binsRes.data);
      else log.warn("bin list unavailable", { message: binsRes.error });
      if (catsRes.data) setCategories(catsRes.data);
      else log.warn("category list unavailable", { message: catsRes.error });
    });
  }, []);

  // Vendors load only when the bulk Vendor tab is first opened, not with the brands and
  // categories above: most visits to /stock never enter select mode at all, and this list is
  // the largest of the four.
  useEffect(() => {
    if (bulkAction !== "vendor" || bulkVendors.length > 0) return;
    apiTry<Array<{ id: string; name: string; code: string }>>("/api/vendors?limit=500").then(
      ({ data, error }) => {
        if (data) setBulkVendors(data);
        else {
          log.warn("bulk vendor list unavailable", { message: error });
          setBulkMessage("Could not load vendors");
        }
      }
    );
  }, [bulkAction, bulkVendors.length]);

  const activeFilterCount = [selectedBrand, selectedCategory, selectedBin, selectedStore].filter(Boolean).length;

  const buildParams = useCallback((pageNum: number) => {
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), page: String(pageNum), sortBy: "currentStock", sortOrder: "desc" });
    if (debouncedSearch) params.set("search", debouncedSearch);
    if (quickFilter === "INACTIVE") { params.set("status", "INACTIVE"); }
    else if (quickFilter === "IN_STOCK") { params.set("status", "ACTIVE"); params.set("minStock", "1"); }
    else if (quickFilter === "NO_STOCK") { params.set("status", "ACTIVE"); params.set("maxStock", "0"); }
    // Server-side, not a filter over the current page. The list is paginated at 100, and the
    // rows needing attention are spread across the whole catalog — filtering what happens to
    // be loaded would report "3 need details" out of 151 and look like good news.
    else if (quickFilter === "NEEDS_DETAILS") { params.set("status", "ACTIVE"); params.set("needsDetails", "true"); }
    else if (quickFilter === "NO_ASSEMBLY") { params.set("status", "ACTIVE"); params.set("condition", "no-assembly"); }
    else if (quickFilter === "ALL" || quickFilter === "LOW_STOCK") { params.set("status", "ACTIVE"); }
    if (selectedBrand) params.set("brandId", selectedBrand);
    if (selectedCategory) params.set("categoryId", selectedCategory);
    if (selectedBin) params.set("binId", selectedBin);
    if (selectedStore) params.set("storeId", selectedStore);
    return params;
  }, [debouncedSearch, quickFilter, selectedBrand, selectedCategory, selectedBin, selectedStore]);

  const fetchProducts = useCallback((pageNum: number, append = false, silent = false) => {
    if (!silent) { if (append) setLoadingMore(true); else setLoading(true); }
    else setRefreshing(true);

    const params = buildParams(pageNum);
    // apiFetchEnvelope, not `fetch().json()`: the page block sits beside `data`, and an expired
    // session must surface as "signed out", not `Unexpected token '<'`.
    apiFetchEnvelope<ProductItem[]>(`/api/products?${params}`)
      .then((res) => {
        if (append) setProducts((prev) => [...prev, ...res.data]);
        else setProducts(res.data);
        setTotal(res.pagination?.total || 0);
        setHasMore(res.pagination?.hasMore || false);
        setLastUpdated(new Date());
      })
      .catch((e) => {
        log.error("product list failed", { page: pageNum, message: e instanceof Error ? e.message : String(e) });
        if (typeof navigator !== "undefined" && !navigator.onLine) {
          setDataError("You're offline. Check your connection and retry.");
        } else {
          setDataError(e instanceof Error ? e.message : "Failed to load data. Tap retry.");
        }
      })
      .finally(() => {
        setLoading(false);
        setLoadingMore(false);
        setRefreshing(false);
      });
  }, [buildParams]);

  // Reset and fetch page 1 when filters/search change
  useEffect(() => {
    setPage(1);
    fetchProducts(1);
  }, [fetchProducts]);

  /**
   * Deactivate or restore. PATCH, not DELETE — the row keeps every stock level,
   * transaction and serial. This is the reversible one, and it is the default action.
   */
  async function setProductStatus(p: ProductItem, status: "ACTIVE" | "INACTIVE") {
    setRowBusy(p.id);
    try {
      const res = await apiFetch<{ message: string }>(`/api/products/${p.id}`, {
        method: "PATCH",
        json: { status },
      });
      log.info("product status changed", { productId: p.id, status });
      setRowOutcome({ ok: true, name: p.name, message: res.message });
      fetchProducts(1);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not update the product";
      log.error("product status change failed", { productId: p.id, message: msg });
      setRowOutcome({ ok: false, name: p.name, message: msg });
    } finally {
      setRowBusy(null);
    }
  }

  function loadMore() {
    const nextPage = page + 1;
    setPage(nextPage);
    fetchProducts(nextPage, true);
  }

  function clearFilters() {
    setSelectedBrand("");
    setSelectedCategory("");
    setSelectedBin("");
    setSelectedStore("");
  }

  /**
   * Patch the saved row in place rather than refetching.
   *
   * The two neighbouring row actions (deactivate, delete) both call fetchProducts(1) instead,
   * which throws away the current page, scroll position and search. That is tolerable for an
   * action that removes a row from view; it is not for a badge flipping from Low to OK, where
   * the person wants to see the change on the row they just tapped. The precedent is
   * price-correction/page.tsx:90-101, which does exactly this after a single-row PUT.
   */
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
  }

  /** Same in-place patch as the reorder sheet, for the same reason: the chip on the row just
   *  tapped should change without losing the page, the scroll or the search. */
  function applyAssemblyLevelSaved(updated: AssemblyLevelSaved) {
    setProducts((prev) =>
      prev.map((p) => (p.id === updated.id ? { ...p, assemblyLevel: updated.assemblyLevel } : p))
    );
  }

  // No out-of-stock precedence here, unlike the three badge helpers above: a product at zero
  // with a reorder level IS in this filter, because "what do I need to order" includes the
  // things that have already run out. That difference is intentional and predates P8.
  const filtered = quickFilter === "LOW_STOCK"
    ? products.filter(isLowStock)
    : debouncedSearch
      ? products.filter((p) => fuzzySearchFields(debouncedSearch, [p.name, p.sku, p.brand?.name, p.category?.name]))
      : products;

  const secondsAgo = Math.round((Date.now() - lastUpdated.getTime()) / 1000);

  // The store the list is scoped to, for the caption under the Store control. Null when the
  // filter is clear or the store set has not arrived yet.
  const scopedStore = selectedStore ? stores.find((s) => s.id === selectedStore) ?? null : null;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-lg font-bold text-slate-900">
          {selectMode ? `${selectedIds.size} selected` : "Stock"}
        </h1>
        <div className="flex items-center gap-1.5">
          {/* The two scope cross-links — By Location (per warehouse) and By Store (the sum of
              a store's warehouses; plan 0909-stock-store-and-warehouse-scoping, B4). They sit
              in the header action row so they read as destinations, not orphaned tabs, and
              hide in select mode like the other actions beside them. */}
          {!selectMode && (
            <Link
              href="/stock/by-bin"
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-purple-50 border border-purple-200 text-purple-700 hover:bg-purple-100"
            >
              <MapPin className="h-3.5 w-3.5" /> {BIN_TRACKING_ENABLED ? "By Bin" : "By Location"}
            </Link>
          )}
          {!selectMode && (
            <Link
              href="/stock/by-store"
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-purple-50 border border-purple-200 text-purple-700 hover:bg-purple-100"
            >
              <Store className="h-3.5 w-3.5" /> By Store
            </Link>
          )}
          {canBulkEdit && !selectMode && (
            <button
              onClick={() => setSelectMode(true)}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-slate-100 text-slate-600 hover:bg-slate-200"
            >
              <CheckSquare className="h-3.5 w-3.5" /> Select
            </button>
          )}
          {selectMode && (
            <button onClick={exitSelectMode}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-slate-900 text-white">
              <X className="h-3.5 w-3.5" /> Cancel
            </button>
          )}
          {!selectMode && (
            <ExportButtons
              onExcel={() => exportToExcel(filtered as unknown as Record<string, unknown>[], STOCK_COLUMNS, "stock-inventory")}
              onPDF={() => exportToPDF("Stock Inventory", filtered as unknown as Record<string, unknown>[], STOCK_COLUMNS, "stock-inventory")}
            />
          )}
        </div>
      </div>

      {/* Stock & inventory's own chips (plan 1709, R33, R11). Categories and Brands left the
          sidebar and live here; each shows only to a role holding its view grant — cosmetic, the
          screens re-check. "Assembled vs unassembled" is stock.view, which this page already is. */}
      {!selectMode && (
        <div className="flex gap-1.5 overflow-x-auto scrollbar-hide pb-0.5 mb-2">
          {canView("categories") && (
            <Link
              href="/categories"
              className="shrink-0 flex items-center gap-1 px-3 py-1.5 min-h-[36px] rounded-full text-xs font-medium bg-violet-50 border border-violet-200 text-violet-700 hover:bg-violet-100"
            >
              <Layers className="h-3.5 w-3.5" /> Categories
            </Link>
          )}
          {canView("brands") && (
            <Link
              href="/more/brands"
              className="shrink-0 flex items-center gap-1 px-3 py-1.5 min-h-[36px] rounded-full text-xs font-medium bg-blue-50 border border-blue-200 text-blue-700 hover:bg-blue-100"
            >
              <Tags className="h-3.5 w-3.5" /> Brands
            </Link>
          )}
          <Link
            href="/stock/condition"
            className="shrink-0 flex items-center gap-1 px-3 py-1.5 min-h-[36px] rounded-full text-xs font-medium bg-emerald-50 border border-emerald-200 text-emerald-700 hover:bg-emerald-100"
          >
            <BarChart3 className="h-3.5 w-3.5" /> Assembled vs unassembled
          </Link>
        </div>
      )}

      {/* Bulk success/error message */}
      {bulkMessage && (
        <div className="flex items-center justify-between bg-green-50 border border-green-200 rounded-lg p-2.5 mb-2">
          <span className="text-xs text-green-700 font-medium">{bulkMessage}</span>
          <button onClick={() => setBulkMessage("")} className="text-green-500"><X className="h-3.5 w-3.5" /></button>
        </div>
      )}

      {/* Fetch Date Picker */}
      {/* Data Load Error */}
      {dataError && (
        <ErrorBanner
          message={dataError}
          type={typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "error"}
          onRetry={() => { setDataError(null); fetchProducts(1); }}
          onDismiss={() => setDataError(null)}
        />
      )}

      {/* Search */}
      <div className="relative mb-3">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <Input
          placeholder="Search product, SKU, brand, or category..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Filter toggle + Quick chips row */}
      <div className="flex items-center gap-2 mb-2">
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

      {/* Collapsible filter panel */}
      {showFilters && (
        <Card className="mb-3 border-slate-200">
          <CardContent className="p-3 space-y-2.5">
            <div className="grid grid-cols-2 gap-2.5">
              {/* All three pickers are searchable (owner, 9 Sep 2026 — Q7 for Store, D11 pulls
                  Category and Brand along so the panel does not carry two dialects side by
                  side). The dropdown is unportalled; this grid has no overflow class and Card
                  sets none, so it is not clipped. The product count that the old <option>
                  text carried in brackets is the row's hint now, so it is still searchable. */}
              <div>
                <label htmlFor="stock-filter-category" className="text-[10px] font-medium text-slate-500 uppercase tracking-wide">Category</label>
                {/* The tree (R43, P13): parents with their children indented. Choosing a parent
                    lists its children's products too — the API expands the subtree. */}
                <CategoryTreeSelect
                  id="stock-filter-category"
                  className="mt-0.5"
                  categories={categories}
                  value={selectedCategory || null}
                  onChange={(id) => setSelectedCategory(id ?? "")}
                  placeholder={`All Categories (${categories.length})`}
                  emptyText="No matching category"
                />
              </div>

              <div>
                <label htmlFor="stock-filter-brand" className="text-[10px] font-medium text-slate-500 uppercase tracking-wide">Brand</label>
                <SearchableSelect
                  id="stock-filter-brand"
                  className="mt-0.5"
                  options={brands.map((b) => ({
                    id: b.id,
                    label: b.name,
                    hint: `${b._count.products} product${b._count.products === 1 ? "" : "s"}`,
                  }))}
                  value={selectedBrand || null}
                  onChange={(id) => setSelectedBrand(id ?? "")}
                  placeholder={`All Brands (${brands.length})`}
                  emptyText="No matching brand"
                />
              </div>

              <div>
                <label htmlFor="stock-filter-store" className="text-[10px] font-medium text-slate-500 uppercase tracking-wide">Store</label>
                <SearchableSelect
                  id="stock-filter-store"
                  className="mt-0.5"
                  options={stores.map((s) => ({
                    id: s.id,
                    label: s.name,
                    hint: `${s.warehouses.length} location${s.warehouses.length === 1 ? "" : "s"}`,
                  }))}
                  value={selectedStore || null}
                  onChange={(id) => setSelectedStore(id ?? "")}
                  placeholder={storesLoading ? "Loading stores…" : "All stores"}
                  emptyText="No matching store"
                  disabled={storesLoading || !!storesError}
                />
                {storesError && (
                  <p className="mt-1 text-[11px] text-red-500">Could not load stores</p>
                )}
                {scopedStore && (
                  <p className="mt-1 text-[11px] text-slate-500">
                    Showing what {scopedStore.name} holds. Quantities are that store&apos;s.
                  </p>
                )}
              </div>

              {BIN_TRACKING_ENABLED && (
                <div>
                  <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wide">Bin / Location</label>
                  <select
                    value={selectedBin}
                    onChange={(e) => setSelectedBin(e.target.value)}
                    className="mt-0.5 flex h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
                  >
                    <option value="">All Bins ({bins.length})</option>
                    {bins.map((b) => (
                      <option key={b.id} value={b.id}>{b.name} ({b._count.products})</option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {activeFilterCount > 0 && (
              <button onClick={clearFilters} className="text-xs text-red-500 font-medium">
                Clear all filters
              </button>
            )}
          </CardContent>
        </Card>
      )}

      {/* What the "Needs details" queue is, and what to do with it. Said here rather than in
          a banner: the filter returns rows that look ordinary, and without this the muted
          brand is the only clue that anything is wrong with them. */}
      {quickFilter === "NEEDS_DETAILS" && !loading && (
        <p className="text-[11px] text-slate-500 mb-2 flex items-start gap-1.5">
          <Package className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span>
            {total.toLocaleString("en-IN")} product{total === 1 ? "" : "s"} the Zoho import could
            not describe — the brand or category shown in grey italics was invented, not imported.
            {canBulkEdit
              ? " Use Select to pick a group, then assign the real brand or category in one action."
              : ""}
          </span>
        </p>
      )}

      {quickFilter === "NO_ASSEMBLY" && !loading && (
        <p className="text-[11px] text-slate-500 mb-2 flex items-start gap-1.5">
          <Package className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span>
            Products holding items that need no assembly — stored in a non-assemblable bin. They
            never appear on the build line.
          </span>
        </p>
      )}

      {/* Status bar */}
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs text-slate-500 tabular-nums">
          {quickFilter === "LOW_STOCK"
            ? `${filtered.length} low stock items`
            : `${filtered.length} of ${total.toLocaleString("en-IN")} products`}
        </p>
        <div className="flex items-center gap-1 text-[11px] text-slate-400 tabular-nums">
          <RefreshCw className={`h-3 w-3 ${refreshing ? "animate-spin" : ""}`} />
          {secondsAgo < 5 ? "Just now" : `${secondsAgo}s ago`}
        </div>
      </div>

      {/* Product list */}
      {loading ? (
        <SkeletonList count={6} type="card" />
      ) : (
        <div className="space-y-2">
          {/* Select all / deselect all in select mode */}
          {selectMode && filtered.length > 0 && (
            <div className="flex items-center gap-2 mb-1">
              <button onClick={selectedIds.size === filtered.length ? deselectAll : selectAll}
                className="text-xs text-blue-600 font-medium">
                {selectedIds.size === filtered.length ? "Deselect All" : `Select All (${filtered.length})`}
              </button>
            </div>
          )}

          {filtered.map((p) => {
            const badge = getStockBadge(p);
            const isSelected = selectedIds.has(p.id);
            const content = (
              <Card className={`border-l-4 ${getStockAccent(p)} transition-colors mb-1.5 ${selectMode && isSelected ? "border-blue-400 bg-blue-50/30" : "active:bg-slate-50 hover:border-slate-300"}`}>
                <CardContent className="p-3.5">
                  <div className="flex items-start justify-between">
                    {selectMode && (
                      <div className="mr-2.5 pt-0.5 shrink-0">
                        {isSelected
                          ? <CheckSquare className="h-5 w-5 text-blue-600" />
                          : <Square className="h-5 w-5 text-slate-300" />}
                      </div>
                    )}
                    <div className="flex-1 min-w-0 mr-3">
                      {/* Zoho names run long — "DODGE THUNDER BAY DD NON IBC FRONT SUS CKD"
                          is typical of the 8,175-item catalog. Unclamped they wrapped to four
                          lines and pushed the stock figure off the card on a phone.
                          `break-words` so an unbroken token cannot overflow the row either;
                          `title` so the full name is still reachable on hover. */}
                      <p
                        className="text-sm font-semibold text-slate-900 line-clamp-2 break-words"
                        title={p.name}
                      >
                        {p.name}
                      </p>
                      <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                        <span className="text-xs text-slate-400 tabular-nums">{p.sku}</span>
                        {/* Brand and category are two different KINDS of fact, so they carry
                            two different colours rather than two greys. Category used to be
                            `text-slate-400` — the same grey as the SKU sitting beside it AND
                            the same grey as a placeholder brand. Three meanings in one colour
                            is what made this row hard to read at a glance.

                            Blue for brand, violet for category. Both are tints (`-50`
                            background, `-700` text) rather than solid badges, so they read as
                            labels and do not compete with the stock Badge on the right, which
                            owns green/amber/red. */}

                        {/* A placeholder is the ABSENCE of a brand, so it must not look like
                            one — and specifically must not get a pill, because the pill is
                            what now says "a person filled this in". `Imported` rendered in the
                            same blue as `Atlas` reads as a brand name to anyone who has not
                            been told otherwise, which is how 151 undescribed products stayed
                            invisible. Muted and italic, the style this app uses for missing
                            data. */}
                        {p.brand &&
                          (isPlaceholderBrand(p.brand.name) ? (
                            <span className="text-xs italic text-slate-400">{p.brand.name}</span>
                          ) : (
                            <span className="rounded-full bg-blue-50 px-1.5 py-0.5 text-[11px] font-medium text-blue-700">
                              {p.brand.name}
                            </span>
                          ))}

                        {/* `Uncategorized` is muted AGAIN. It was un-muted back when every
                            imported product carried it — a signal that fires always is not a
                            signal. The catalog import changed that: it writes the real Zoho
                            category, and only 665 of 5,738 products still land on the
                            placeholder. It is the exception once more, so it is worth seeing. */}
                        {p.category &&
                          (isPlaceholderCategory(p.category.name) ? (
                            <span className="text-xs italic text-slate-400">{p.category.name}</span>
                          ) : (
                            <span className="rounded-full bg-violet-50 px-1.5 py-0.5 text-[11px] font-medium text-violet-700">
                              {p.category.name}
                            </span>
                          ))}
                      </div>
                      {/* Price. Selling price is safe for everyone — it is what a customer is
                          quoted. Cost price is NOT: it is gated by the `cost_price` module,
                          and `api/products/route.ts:100` already omits the field entirely for
                          anyone without that grant, so this renders nothing rather than
                          "₹0" for them. Same pattern as stock/[id]. */}
                      <div className="flex items-baseline gap-2 mt-1">
                        <span className="text-sm font-semibold text-slate-900 tabular-nums">
                          {formatCurrency(p.sellingPrice)}
                        </span>
                        {p.mrp > 0 && p.mrp !== p.sellingPrice && (
                          <span className="text-[11px] text-slate-400 line-through tabular-nums">
                            {formatCurrency(p.mrp)}
                          </span>
                        )}
                        {showCost && (p.costPrice ?? 0) > 0 && (
                          <span className="text-[11px] text-slate-500 tabular-nums">
                            cost {formatCurrency(p.costPrice ?? 0)}
                          </span>
                        )}
                      </div>
                      {p.bin && (
                        <p className="text-[11px] text-slate-400 mt-1 flex items-center gap-0.5">
                          <MapPin className="h-3 w-3" />{p.bin.code} — {p.bin.location}
                        </p>
                      )}
                      {/* Shown only when a level is set, because 0 means "no level chosen"
                          rather than "reorder at zero" — printing "Reorder @ 0" on most of the
                          catalogue would read as a setting somebody made. */}
                      {p.reorderLevel > 0 && (
                        <p className="text-[11px] text-slate-400 mt-1 tabular-nums">
                          Reorder @ {p.reorderLevel}
                          {p.reorderQty > 0 ? ` · order ${p.reorderQty}` : ""}
                        </p>
                      )}
                      {/* Assembled / Unassembled / No assembly (R10, P7), from the live units.
                          Only when the product has any — a row with no unit codes yet would
                          otherwise print three zeros that read as "none built". */}
                      {(p.assembledUnits ?? 0) + (p.unassembledUnits ?? 0) + (p.noAssemblyUnits ?? 0) > 0 && (
                        <p className="text-[11px] mt-1 flex items-center gap-2 flex-wrap tabular-nums">
                          <span className="text-emerald-700">Assembled {p.assembledUnits}</span>
                          <span className="text-amber-700">Unassembled {p.unassembledUnits}</span>
                          {p.noAssemblyUnits > 0 && (
                            <span className="text-slate-500">No assembly {p.noAssemblyUnits}</span>
                          )}
                        </p>
                      )}
                      {/* Only when set, like the reorder line above: "Not set" on every row
                          of a fresh catalogue would be noise, and the wrench button already
                          says where to set it. */}
                      {p.assemblyLevel && (
                        <p className="text-[11px] text-slate-500 mt-1 flex items-center gap-1">
                          <Wrench className="h-3 w-3" /> Assembly {assemblyLevelLabel(p.assemblyLevel)}
                        </p>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <p className={`text-xl font-bold tabular-nums ${getStockColor(p)}`}>{p.currentStock}</p>
                      <Badge variant={badge.variant} className="text-[10px]">{badge.label}</Badge>

                      {/* Hidden in select mode: the whole row is a checkbox target there, and
                          a button inside it would fight the row's click handler. */}
                      {!selectMode && (mayDeactivate || mayReorder || mayAssemblyLevel) && (
                        <div className="flex gap-1 justify-end mt-1.5">
                          {mayReorder && (
                            <RowBtn
                              label={`Reorder settings for ${p.name}`}
                              tone="text-blue-600"
                              disabled={rowBusy === p.id}
                              onClick={(e) => { e.preventDefault(); e.stopPropagation(); setReorderTarget(p); }}
                            >
                              <RefreshCw className="h-3.5 w-3.5" />
                            </RowBtn>
                          )}
                          {mayAssemblyLevel && (
                            <RowBtn
                              label={`Assembly level for ${p.name}`}
                              tone={p.assemblyLevel ? "text-slate-700" : "text-amber-600"}
                              disabled={rowBusy === p.id}
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setLevelTarget({ id: p.id, name: p.name, sku: p.sku, assemblyLevel: p.assemblyLevel ?? null });
                              }}
                            >
                              <Wrench className="h-3.5 w-3.5" />
                            </RowBtn>
                          )}
                          {mayDeactivate && p.status === "ACTIVE" && (
                            <RowBtn
                              label={`Deactivate ${p.name}`}
                              disabled={rowBusy === p.id}
                              onClick={(e) => { e.preventDefault(); e.stopPropagation(); void setProductStatus(p, "INACTIVE"); }}
                            >
                              <EyeOff className="h-3.5 w-3.5" />
                            </RowBtn>
                          )}
                          {mayDeactivate && p.status === "INACTIVE" && (
                            <RowBtn
                              label={`Restore ${p.name}`}
                              tone="text-green-600"
                              disabled={rowBusy === p.id}
                              onClick={(e) => { e.preventDefault(); e.stopPropagation(); void setProductStatus(p, "ACTIVE"); }}
                            >
                              <RotateCcw className="h-3.5 w-3.5" />
                            </RowBtn>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );

            return selectMode ? (
              <div key={p.id} onClick={() => toggleSelect(p.id)} className="cursor-pointer">
                {content}
              </div>
            ) : (
              <Link key={p.id} href={`/stock/${p.id}`}>
                {content}
              </Link>
            );
          })}

          {hasMore && quickFilter !== "LOW_STOCK" && (
            <Button variant="outline" className="w-full tabular-nums" onClick={loadMore} disabled={loadingMore}>
              {loadingMore
                ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Loading...</>
                : `Load More (${(total - products.length).toLocaleString("en-IN")} remaining)`}
            </Button>
          )}
        </div>
      )}

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

      {rowOutcome && (
        <ActionConfirmation
          open
          onClose={() => setRowOutcome(null)}
          type={rowOutcome.ok ? "success" : "warning"}
          title={rowOutcome.ok ? "Done" : "Not done"}
          referenceId={rowOutcome.name}
          details={rowOutcome.message}
        />
      )}

      {!loading && filtered.length === 0 && (
        <div className="text-center py-12">
          <p className="text-sm text-slate-400">No products found</p>
        </div>
      )}

      {/* Floating Bulk Action Bar */}
      {selectMode && selectedIds.size > 0 && (
        <div className="fixed above-nav left-0 right-0 z-50 px-3">
          <div className="max-w-lg mx-auto bg-slate-900 text-white rounded-xl shadow-lg p-3 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold">{selectedIds.size} product{selectedIds.size !== 1 ? "s" : ""} selected</p>
              <button onClick={exitSelectMode} className="text-slate-400 hover:text-white"><X className="h-4 w-4" /></button>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setBulkAction("category")}
                className={`flex-1 py-2 rounded-lg text-xs font-medium transition-colors ${
                  bulkAction === "category" ? "bg-blue-600 text-white" : "bg-slate-700 text-slate-300 hover:bg-slate-600"
                }`}
              >
                Category
              </button>
              <button
                onClick={() => setBulkAction("brand")}
                className={`flex-1 py-2 rounded-lg text-xs font-medium transition-colors ${
                  bulkAction === "brand" ? "bg-blue-600 text-white" : "bg-slate-700 text-slate-300 hover:bg-slate-600"
                }`}
              >
                Brand
              </button>
              {/* Bin is the detail no import can supply — see the plan's Part E. Hidden with
                  the rest of the bin UI while bin tracking is dormant; the server refuses a
                  binId in that state too, so this is not the only gate. */}
              {BIN_TRACKING_ENABLED && (
                <button
                  onClick={() => setBulkAction("bin")}
                  className={`flex-1 py-2 rounded-lg text-xs font-medium transition-colors ${
                    bulkAction === "bin" ? "bg-blue-600 text-white" : "bg-slate-700 text-slate-300 hover:bg-slate-600"
                  }`}
                >
                  Bin
                </button>
              )}
              <button
                onClick={() => setBulkAction("status")}
                className={`flex-1 py-2 rounded-lg text-xs font-medium transition-colors ${
                  bulkAction === "status" ? "bg-blue-600 text-white" : "bg-slate-700 text-slate-300 hover:bg-slate-600"
                }`}
              >
                Status
              </button>
              {/* Filter by brand, select all, set the vendor: one action per brand instead of
                  one per product. This is how the reorder vendor column gets populated at all
                  — and P10 derives a purchase order's vendor from it. Gated on reorder.edit
                  because that is what the server demands for this field specifically. */}
              {mayReorder && (
                <button
                  onClick={() => setBulkAction("vendor")}
                  className={`flex-1 py-2 rounded-lg text-xs font-medium transition-colors ${
                    bulkAction === "vendor" ? "bg-blue-600 text-white" : "bg-slate-700 text-slate-300 hover:bg-slate-600"
                  }`}
                >
                  Vendor
                </button>
              )}
              {/* Plan 1509-assembly-queue…, E2: set the level for a whole brand in one action.
                  Gated on assembly.approve — the server demands it for this field. */}
              {mayAssemblyLevel && (
                <button
                  onClick={() => setBulkAction("assembly")}
                  className={`flex-1 py-2 rounded-lg text-xs font-medium transition-colors ${
                    bulkAction === "assembly" ? "bg-blue-600 text-white" : "bg-slate-700 text-slate-300 hover:bg-slate-600"
                  }`}
                >
                  Assembly
                </button>
              )}
            </div>

            {bulkAction === "assembly" && (
              <div className="flex gap-2">
                <select
                  value={bulkAssemblyLevel}
                  onChange={(e) => setBulkAssemblyLevel(e.target.value as "" | "NONE" | AssemblyLevelValue)}
                  className="flex-1 h-9 rounded-lg bg-slate-700 border-0 px-2 text-xs text-white focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select assembly level...</option>
                  {ASSEMBLY_LEVELS.map((l) => (
                    <option key={l.value} value={l.value}>{l.percent} · {l.description}</option>
                  ))}
                  <option value="NONE">Not set (ask at assign)</option>
                </select>
                <button
                  onClick={handleBulkApply}
                  disabled={!bulkAssemblyLevel || bulkLoading}
                  className="px-4 py-2 bg-blue-600 rounded-lg text-xs font-medium disabled:opacity-50"
                >
                  {bulkLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Apply"}
                </button>
              </div>
            )}

            {bulkAction === "category" && (
              <div className="flex gap-2">
                <select
                  value={bulkCategoryId}
                  onChange={(e) => setBulkCategoryId(e.target.value)}
                  className="flex-1 h-9 rounded-lg bg-slate-700 border-0 px-2 text-xs text-white focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select category...</option>
                  {categories.filter(c => c.name !== "General").map((c) => (
                    <option key={c.id} value={c.id}>{c.name} ({c._count.products})</option>
                  ))}
                </select>
                <button
                  onClick={handleBulkApply}
                  disabled={!bulkCategoryId || bulkLoading}
                  className="px-4 py-2 bg-blue-600 rounded-lg text-xs font-medium disabled:opacity-50"
                >
                  {bulkLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Apply"}
                </button>
              </div>
            )}

            {bulkAction === "brand" && (
              <div className="flex gap-2">
                <select
                  value={bulkBrandId}
                  onChange={(e) => setBulkBrandId(e.target.value)}
                  className="flex-1 h-9 rounded-lg bg-slate-700 border-0 px-2 text-xs text-white focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select brand...</option>
                  {/* The placeholder is not a destination. Assigning products TO `Imported`
                      is the state we are trying to get out of. */}
                  {brands.filter((b) => !isPlaceholderBrand(b.name)).map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
                <button
                  onClick={handleBulkApply}
                  disabled={!bulkBrandId || bulkLoading}
                  className="px-4 py-2 bg-blue-600 rounded-lg text-xs font-medium disabled:opacity-50"
                >
                  {bulkLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Apply"}
                </button>
              </div>
            )}

            {BIN_TRACKING_ENABLED && bulkAction === "bin" && (
              <div className="flex gap-2">
                <select
                  value={bulkBinId}
                  onChange={(e) => setBulkBinId(e.target.value)}
                  className="flex-1 h-9 rounded-lg bg-slate-700 border-0 px-2 text-xs text-white focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select bin...</option>
                  {bins.map((b) => (
                    <option key={b.id} value={b.id}>{b.code} — {b.name} ({b._count.products})</option>
                  ))}
                </select>
                <button
                  onClick={handleBulkApply}
                  disabled={!bulkBinId || bulkLoading}
                  className="px-4 py-2 bg-blue-600 rounded-lg text-xs font-medium disabled:opacity-50"
                >
                  {bulkLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Apply"}
                </button>
              </div>
            )}

            {/* A plain <select>, not the SearchableSelect used in the reorder sheet: this bar
                is bg-slate-900 and every control in it is white-on-slate-700, while
                SearchableSelect is hard-coded light with no theming prop. Matching the four
                siblings matters more here than typeahead over a list this size. */}
            {bulkAction === "vendor" && (
              <div className="flex gap-2">
                <select
                  value={bulkVendorId}
                  onChange={(e) => setBulkVendorId(e.target.value)}
                  className="flex-1 h-9 rounded-lg bg-slate-700 border-0 px-2 text-xs text-white focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Clear reorder vendor</option>
                  {bulkVendors.map((v) => (
                    <option key={v.id} value={v.id}>{v.name} ({v.code})</option>
                  ))}
                </select>
                {/* No `disabled={!bulkVendorId}`, unlike the four above: "" is the deliberate
                    "clear it" choice here, so disabling on empty would remove the only way to
                    undo a wrong bulk assignment. */}
                <button
                  onClick={handleBulkApply}
                  disabled={bulkLoading}
                  className="px-4 py-2 bg-blue-600 rounded-lg text-xs font-medium disabled:opacity-50"
                >
                  {bulkLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Apply"}
                </button>
              </div>
            )}

            {bulkAction === "status" && (
              <div className="flex gap-2">
                <select
                  value={bulkStatus}
                  onChange={(e) => setBulkStatus(e.target.value as "ACTIVE" | "INACTIVE")}
                  className="flex-1 h-9 rounded-lg bg-slate-700 border-0 px-2 text-xs text-white focus:ring-2 focus:ring-blue-500"
                >
                  <option value="INACTIVE">Set Inactive</option>
                  <option value="ACTIVE">Set Active</option>
                </select>
                <button
                  onClick={handleBulkApply}
                  disabled={bulkLoading}
                  className="px-4 py-2 bg-red-600 rounded-lg text-xs font-medium disabled:opacity-50"
                >
                  {bulkLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Apply"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * A row action. Takes the click event so the caller can stopPropagation — every row is
 * wrapped in a <Link>, and without that a delete would also navigate to the product.
 */
function RowBtn({
  label, onClick, children, tone = "text-slate-600", disabled,
}: {
  label: string;
  onClick: (e: React.MouseEvent) => void;
  children: React.ReactNode;
  tone?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={`min-h-[32px] min-w-[32px] inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 focus-ring ${tone}`}
    >
      {children}
    </button>
  );
}
