"use client";
import { useDebounce } from "@/hooks/use-debounce";

import { useState, useEffect, useCallback, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { Search, MapPin, Loader2, SlidersHorizontal, ChevronDown, ChevronLeft, ChevronRight, RefreshCw, CheckSquare, X, Package, Store, Tags, Layers, BarChart3, Cloud } from "lucide-react";
import { Input } from "@/components/ui/input";
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
import { isPlaceholderBrand } from "@/lib/import-placeholders";
import {
  DEFAULT_STOCK_SORT, type StockProduct, type StockRowContext, type StockSort, type StockSortKey,
} from "./_components/stock-row";
import { StockTable } from "./_components/stock-table";
import { ReorderSheet, type ReorderTarget, type ReorderSaved } from "@/components/reorder-sheet";
import { AssemblyLevelSheet, type AssemblyLevelTarget, type AssemblyLevelSaved } from "@/components/assembly-level-sheet";
import { ASSEMBLY_LEVELS, type AssemblyLevelValue } from "@/lib/assembly-level";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useStockLocations } from "./_components/use-stock-locations";
import { CategoryTreeSelect } from "@/components/category-tree-select";
import { ZohoStockImportSheet } from "./_components/zoho-stock-import-sheet";
import { AddStockSheet, type AddStockTarget, type AddStockDone } from "./_components/add-stock-sheet";

const STOCK_COLUMNS: ExportColumn[] = [
  { header: "SKU", key: "sku" },
  { header: "Product Name", key: "name" },
  { header: "Category", key: "category.name" },
  { header: "Brand", key: "brand.name" },
  { header: "Stock", key: "currentStock" },
  { header: "Reorder Level", key: "reorderLevel" },
  { header: "Bin", key: "bin.code" },
];

// The product row, its colours and its actions live in _components/stock-row.tsx so the PC table
// and the phone card render the same thing (plan 2109-stock-list-table-and-compact-cards).
type ProductItem = StockProduct;

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

// Export takes every product matching the filters, not just the page on screen (plan 1410,
// owner-approved). 500 is the most one request returns (parseSearchParams, api-utils.ts), and
// the whole export stops at 10,000 rows — past that, a sentence asks for narrower filters.
const EXPORT_PAGE_SIZE = 500;
const EXPORT_MAX_ROWS = 10_000;

const fmt = (v: number) => v.toLocaleString("en-IN");
/** How a warehouse's kind reads in the Warehouse picker (plan 1410-stock-location-and-bin, B1). */
const WAREHOUSE_KIND_LABEL: Record<"FLOOR" | "GODOWN", string> = { FLOOR: "Shop floor", GODOWN: "Godown" };

/** A one-line message above the list: an add that landed, an export's progress or outcome. */
type Notice = { tone: "success" | "info" | "error"; text: string };

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
  const { canEdit, canView, canApprove, canFetch, canCreate } = usePermissions();

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

  // inventory_adjustments.create, NOT stock.edit (plan 1410, Q1): adding stock without a count
  // is its own grant. POST /api/products/[id]/add-stock demands the same one, so the button and
  // the route cannot disagree. Cosmetic here — the route is the gate.
  const mayAddStock = canCreate("inventory_adjustments");
  const [addTarget, setAddTarget] = useState<AddStockTarget | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [exporting, setExporting] = useState(false);

  // Stock & inventory › Fetch — the one tick both stock/zoho-preview and stock/zoho-import check
  // (plan 1410-per-module-fetch-permissions). This used to also show for zoho.fetch and
  // stock.edit, and the preview route refused stock.edit: a button that did nothing.
  const mayFetchZoho = canFetch("stock");
  const [isZohoSheetOpen, setIsZohoSheetOpen] = useState(false);

  const [rowBusy, setRowBusy] = useState<string | null>(null);

  // Table sort (plan 2109-stock-list-table-and-compact-cards, R4, Q2, Q5). Server-side — the
  // list is paginated — and kept in the URL (`?sort=&dir=`) so a reload keeps it. Only the four
  // keys the table offers are accepted; anything else falls back to stock, high to low.
  const [sort, setSort] = useState<StockSort>(() => {
    const by = searchParams.get("sort");
    const dir = searchParams.get("dir");
    const keys: StockSortKey[] = ["name", "sellingPrice", "costPrice", "currentStock"];
    return keys.includes(by as StockSortKey)
      ? { sortBy: by as StockSortKey, sortOrder: dir === "asc" ? "asc" : "desc" }
      : DEFAULT_STOCK_SORT;
  });

  function changeSort(key: StockSortKey) {
    setSort((prev) => {
      // Same column flips; a new column starts where people expect: names A→Z, numbers high→low.
      const next: StockSort =
        prev.sortBy === key
          ? { sortBy: key, sortOrder: prev.sortOrder === "asc" ? "desc" : "asc" }
          : { sortBy: key, sortOrder: key === "name" ? "asc" : "desc" };
      const url = new URL(window.location.href);
      url.searchParams.set("sort", next.sortBy);
      url.searchParams.set("dir", next.sortOrder);
      // replaceState, not push: a sort is not a new page in the back-button history.
      window.history.replaceState(null, "", url);
      log.debug("stock sort changed", next);
      return next;
    });
  }
  const [reorderTarget, setReorderTarget] = useState<ReorderTarget | null>(null);
  const [levelTarget, setLevelTarget] = useState<AssemblyLevelTarget | null>(null);
  const [rowOutcome, setRowOutcome] = useState<{ ok: boolean; name: string; message: string } | null>(null);

  const [dataError, setDataError] = useState<string | null>(null);
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState(() => searchParams.get("search") ?? "");
  const debouncedSearch = useDebounce(search);
  const [quickFilter, setQuickFilter] = useState<QuickFilter>(initialQuick);
  const [showFilters, setShowFilters] = useState(false);
  const [selectedBrand, setSelectedBrand] = useState(() => searchParams.get("brandId") ?? "");
  const [selectedCategory, setSelectedCategory] = useState(() => searchParams.get("categoryId") ?? "");
  // The scope (plan 1410-stock-location-and-bin, B1, B2; §7, owner 14 Oct 2026): Store, then one
  // of THAT store's warehouses, then one of THAT warehouse's bins — three pickers, each offering
  // only what sits inside the one before it, and each clearing the ones after it when it changes.
  // "" at any level means all of the level above. Bin: "" the warehouse's whole stock, `none` its
  // stock in no bin, or a bin id. Whatever is chosen, the API answers with only what it holds and
  // every Stock figure on the page is that scope's, not the global total — the caption above the
  // list says so. Read once from the URL, written back on change, so a refresh or a shared link
  // reopens the same view.
  const [selectedStore, setSelectedStore] = useState(() => searchParams.get("storeId") ?? "");
  const [selectedWarehouse, setSelectedWarehouse] = useState(() => searchParams.get("warehouseId") ?? "");
  const [selectedBin, setSelectedBin] = useState(() =>
    searchParams.get("warehouseId") ? searchParams.get("binId") ?? "" : ""
  );
  const { stores: locationStores, loading: locationsLoading, error: locationsError, reload: reloadLocations } =
    useStockLocations();
  const [brands, setBrands] = useState<BrandItem[]>([]);
  const [bins, setBins] = useState<BinItem[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
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
  // freshly imported batch. Bins are always on (plan 2109, Q27).
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
      reloadLocations();
      setBulkMessage(`Updated ${data.updated} products`);
      exitSelectMode();
      setPage(1);
      fetchProducts(1);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed";
      log.error("bulk assign failed", { field: bulkAction, selected: selectedIds.size, message });
      setBulkMessage(message);
    } finally {
      setBulkLoading(false);
    }
  }

  // Fetch brands + categories + bins. apiTry, not `fetch().json()` (CLAUDE.md): each list
  // failing on its own leaves its picker empty and says why in the log, rather than a parse
  // error from a login page swallowing all three.
  const reloadMasterData = useCallback(() => {
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

  useEffect(() => {
    reloadMasterData();
  }, [reloadMasterData]);

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

  // The store, warehouse and bin the pickers point at, resolved against the loaded set. Null while
  // the set is loading, or when the URL names one that no longer exists (the API refuses it with
  // 400, shown in the list's error banner). A link that names only a warehouse still shows its
  // store in the Store picker.
  const scopedLocation = selectedWarehouse
    ? locationStores.flatMap((s) => s.warehouses).find((w) => w.id === selectedWarehouse) ?? null
    : null;
  const warehouseStoreId = selectedWarehouse
    ? locationStores.find((s) => s.warehouses.some((w) => w.id === selectedWarehouse))?.id ?? ""
    : "";
  const effectiveStoreId = selectedStore || warehouseStoreId;
  const scopedStore = effectiveStoreId ? locationStores.find((s) => s.id === effectiveStoreId) ?? null : null;
  const scopedBin = scopedLocation && selectedBin && selectedBin !== "none"
    ? scopedLocation.bins.find((b) => b.id === selectedBin) ?? null
    : null;

  const activeFilterCount = [selectedBrand, selectedCategory, effectiveStoreId, selectedWarehouse, selectedBin].filter(Boolean).length;

  // What the Stock figures are under the chosen scope (B3), shown ABOVE the list rather than in
  // the Filters panel: the panel opens closed, so a refreshed or shared link would otherwise show
  // a bin's quantities with nothing saying so. A scope the URL names that no longer exists is said
  // plainly (the list's banner carries the server's 400); it is derived here, not reset in an
  // effect, so the person decides what to choose instead.
  const scopeStale =
    !locationsLoading &&
    !locationsError &&
    ((selectedStore !== "" && !scopedStore) ||
      (selectedWarehouse !== "" && !scopedLocation) ||
      // A link naming a store and a warehouse of a different store.
      (scopedLocation !== null && scopedStore !== null && !scopedStore.warehouses.some((w) => w.id === scopedLocation.id)) ||
      (scopedLocation !== null && selectedBin !== "" && selectedBin !== "none" && !scopedBin));
  const scopeLabel = scopedBin
    ? `${scopedLocation?.name} › ${scopedBin.code}`
    : scopedLocation && selectedBin === "none"
      ? `${scopedLocation.name} › No bin`
      : scopedLocation
        ? scopedLocation.name
        : scopedStore
          ? `${scopedStore.name} · all warehouses`
          : null;
  const scopeCaption = scopeStale
    ? "The chosen store, warehouse or bin no longer exists. Choose another under Filters."
    : scopedBin
      ? `Showing what ${scopeLabel} holds. Quantities are that bin's.`
      : scopedLocation && selectedBin === "none"
        ? `Showing what ${scopedLocation.name} holds in no bin. Quantities are the stock not in any bin.`
        : scopedLocation
          ? `Showing what ${scopedLocation.name} holds. Quantities are that warehouse's.`
          : scopedStore
            ? `Showing what ${scopedStore.name} holds across its warehouses. Quantities are the store's.`
            : null;

  /** Set the store, warehouse and bin together (a level clears the ones after it), and mirror them into the URL. */
  function changeScope(store: string, warehouse: string, bin: string) {
    setSelectedStore(store);
    setSelectedWarehouse(warehouse);
    setSelectedBin(bin);
    const url = new URL(window.location.href);
    url.searchParams.delete("storeId");
    url.searchParams.delete("warehouseId");
    url.searchParams.delete("binId");
    if (store) url.searchParams.set("storeId", store);
    if (warehouse) url.searchParams.set("warehouseId", warehouse);
    if (warehouse && bin) url.searchParams.set("binId", bin);
    // replaceState, as the sort does: a filter is not a new page in the back-button history.
    window.history.replaceState(null, "", url);
    log.debug("stock scope changed", { store: store || null, warehouse: warehouse || null, bin: bin || null });
  }

  const buildParams = useCallback((pageNum: number) => {
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), page: String(pageNum), sortBy: sort.sortBy, sortOrder: sort.sortOrder });
    if (debouncedSearch) params.set("search", debouncedSearch);
    if (quickFilter === "INACTIVE") { params.set("status", "INACTIVE"); }
    else if (quickFilter === "IN_STOCK") { params.set("status", "ACTIVE"); params.set("minStock", "1"); }
    else if (quickFilter === "NO_STOCK") { params.set("status", "ACTIVE"); params.set("maxStock", "0"); }
    // Server-side, not a filter over the current page. The list is paginated at 100, and the
    // rows needing attention are spread across the whole catalog — filtering what happens to
    // be loaded would report "3 need details" out of 151 and look like good news.
    else if (quickFilter === "NEEDS_DETAILS") { params.set("status", "ACTIVE"); params.set("needsDetails", "true"); }
    else if (quickFilter === "NO_ASSEMBLY") { params.set("status", "ACTIVE"); params.set("condition", "no-assembly"); }
    // Server-side too (plan 1410) — it used to filter only the 100 rows already loaded. Same rule
    // as the badge, isLowStock: a level is set and stock is at or below it. No out-of-stock
    // precedence, unlike the badge helpers: "what do I need to order" includes what has run out.
    else if (quickFilter === "LOW_STOCK") { params.set("status", "ACTIVE"); params.set("lowStock", "1"); }
    else if (quickFilter === "ALL") { params.set("status", "ACTIVE"); }
    if (selectedBrand) params.set("brandId", selectedBrand);
    if (selectedCategory) params.set("categoryId", selectedCategory);
    // The narrowest level chosen: a warehouse (and its bin) is already inside one store.
    if (selectedWarehouse) {
      params.set("warehouseId", selectedWarehouse);
      if (selectedBin) params.set("binId", selectedBin);
    } else if (selectedStore) {
      params.set("storeId", selectedStore);
    }
    return params;
  }, [debouncedSearch, quickFilter, selectedBrand, selectedCategory, selectedStore, selectedWarehouse, selectedBin, sort]);

  // One page at a time (14 Oct 2026, owner: pages, not a "Load more" list that keeps growing).
  const fetchProducts = useCallback((pageNum: number, silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);

    // apiFetchEnvelope, not `fetch().json()`: the page block sits beside `data`, and an expired
    // session must surface as "signed out", not `Unexpected token '<'`.
    const load = (n: number, steppedBack: boolean): Promise<void> =>
      apiFetchEnvelope<ProductItem[]>(`/api/products?${buildParams(n)}`).then((res) => {
        const count = res.pagination?.total || 0;
        const lastPage = Math.max(1, Math.ceil(count / PAGE_SIZE));
        // Refreshing in place can find the page gone: the last row on the last page of Low
        // Stock leaves the filter once stock is added to it, and a deactivate does the same.
        // Step back to the new last page once, rather than show "No products" beside a total.
        if (!steppedBack && res.data.length === 0 && n > lastPage) {
          log.debug("page no longer exists, stepping back", { page: n, lastPage, total: count });
          setPage(lastPage);
          return load(lastPage, true);
        }
        setProducts(res.data);
        setTotal(count);
        setLastUpdated(new Date());
        setDataError(null);
      });
    load(pageNum, false)
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
      fetchProducts(page);
      // The pickers count active products only, so a deactivate or restore moves them.
      reloadLocations();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not update the product";
      log.error("product status change failed", { productId: p.id, message: msg });
      setRowOutcome({ ok: false, name: p.name, message: msg });
    } finally {
      setRowBusy(null);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function goToPage(next: number) {
    if (next < 1 || next > totalPages || next === page) return;
    log.debug("page changed", { from: page, to: next, totalPages });
    setPage(next);
    fetchProducts(next);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /** Up to five page numbers around the current one, with the first and last always reachable. */
  function pageWindow(): number[] {
    const from = Math.max(1, Math.min(page - 2, totalPages - 4));
    const to = Math.min(totalPages, from + 4);
    return Array.from({ length: to - from + 1 }, (_, i) => from + i);
  }

  function clearFilters() {
    setSelectedBrand("");
    setSelectedCategory("");
    changeScope("", "", "");
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

  /**
   * After an add (plan 1410): say what happened in one line, then reload THIS page in place —
   * silently, so the table, its scroll and the page number stay. A refetch rather than a patch:
   * the Stock figure under a store scope is that store's, the route answers with the global
   * total, and the A / U and "without codes" figures move too.
   */
  function applyStockAdded(done: AddStockDone) {
    setNotice({
      tone: "success",
      text: done.duplicate
        ? `Already added — ${done.productName} is now ${fmt(done.newStock)}`
        : `Added ${fmt(done.added)} to ${done.productName} — now ${fmt(done.newStock)} · bin ${done.binCode}`,
    });
    log.info("stock added from row", { productId: done.productId, added: done.added, duplicate: done.duplicate, page });
    fetchProducts(page, true);
    // The bin's and the location's counts in the pickers moved too.
    reloadLocations();
  }

  /** The rows the table shows from a set the server returned — its search, narrowed fuzzily. */
  function visibleRows(rows: ProductItem[]) {
    return debouncedSearch
      ? rows.filter((p) => fuzzySearchFields(debouncedSearch, [p.name, p.sku, p.brand?.name, p.category?.name]))
      : rows;
  }

  const filtered = visibleRows(products);

  /**
   * Export EVERY product matching the filters (plan 1410, owner-approved) — it used to take
   * only the page on screen. Pages through /api/products with the list's own params, 500 at a
   * time, stopping at EXPORT_MAX_ROWS and saying so.
   */
  async function exportAll(format: "excel" | "pdf") {
    if (exporting) return;
    setExporting(true);
    setNotice({ tone: "info", text: "Preparing the export…" });
    const started = Date.now();
    try {
      const rows: ProductItem[] = [];
      let matched = 0;
      for (let pageNum = 1; rows.length < EXPORT_MAX_ROWS; pageNum++) {
        const params = buildParams(pageNum);
        params.set("limit", String(EXPORT_PAGE_SIZE));
        const res = await apiFetchEnvelope<ProductItem[]>(`/api/products?${params}`);
        matched = res.pagination?.total ?? rows.length + res.data.length;
        rows.push(...res.data);
        if (res.data.length < EXPORT_PAGE_SIZE || rows.length >= matched) break;
        setNotice({
          tone: "info",
          text: `Preparing the export — ${fmt(rows.length)} of ${fmt(Math.min(matched, EXPORT_MAX_ROWS))} products…`,
        });
      }
      const data = visibleRows(rows.slice(0, EXPORT_MAX_ROWS));
      if (data.length === 0) {
        log.info("stock export skipped: nothing matches", { format, matched });
        setNotice({ tone: "info", text: "Nothing to export — no products match these filters." });
        return;
      }
      const records = data as unknown as Record<string, unknown>[];
      // A scoped export says so in its name and title, so a bin's quantities are not read as totals.
      const fileName = scopeLabel
        ? `stock-${scopeLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}`
        : "stock-inventory";
      const title = scopeLabel ? `Stock — ${scopeLabel}` : "Stock Inventory";
      if (format === "excel") await exportToExcel(records, STOCK_COLUMNS, fileName);
      else await exportToPDF(title, records, STOCK_COLUMNS, fileName);
      const truncated = matched > EXPORT_MAX_ROWS;
      log.info("stock export finished", { format, rows: data.length, matched, truncated, ms: Date.now() - started });
      setNotice(
        truncated
          ? { tone: "info", text: `Exported the first ${fmt(EXPORT_MAX_ROWS)} of ${fmt(matched)} products — narrow the filters to export the rest.` }
          : { tone: "success", text: `Exported ${fmt(data.length)} product${data.length === 1 ? "" : "s"}.` }
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      log.error("stock export failed", { format, message });
      setNotice({ tone: "error", text: `Export failed — ${message}` });
    } finally {
      setExporting(false);
    }
  }

  const secondsAgo = Math.round((Date.now() - lastUpdated.getTime()) / 1000);

  // What the table rows and the cards need from the page. The page owns the state and the sheets;
  // the layouts only render and call back.
  const rowCtx: StockRowContext = {
    showCost,
    selectMode,
    selectedIds,
    onToggleSelect: toggleSelect,
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

  // Header actions, built once and placed by breakpoint below (desktop header row vs. the phone
  // scrolling toolbar). The two scope cross-links — By Location (per warehouse) and By Store (the
  // sum of a store's warehouses; plan 0909-stock-store-and-warehouse-scoping, B4) — read as
  // destinations, and all of these hide in select mode.
  const toolbarBtn = "flex items-center gap-1 px-3 py-1.5 min-h-[36px] text-xs font-medium whitespace-nowrap";
  const scopeLinks = (
    <>
      <Link href="/stock/by-bin" className={`${toolbarBtn} rounded-lg bg-purple-50 border border-purple-200 text-purple-700 hover:bg-purple-100`}>
        <MapPin className="h-3.5 w-3.5" /> By Location
      </Link>
      <Link href="/stock/by-store" className={`${toolbarBtn} rounded-lg bg-purple-50 border border-purple-200 text-purple-700 hover:bg-purple-100`}>
        <Store className="h-3.5 w-3.5" /> By Store
      </Link>
    </>
  );
  const zohoFetchButton = mayFetchZoho ? (
    <button
      onClick={() => setIsZohoSheetOpen(true)}
      className={`${toolbarBtn} rounded-lg bg-blue-50 border border-blue-200 text-blue-700 hover:bg-blue-100`}
    >
      <Cloud className="h-3.5 w-3.5" /> Fetch from Zoho
    </button>
  ) : null;
  const selectButton = canBulkEdit ? (
    <button onClick={() => setSelectMode(true)} className={`${toolbarBtn} rounded-lg bg-slate-100 border border-slate-200 text-slate-600 hover:bg-slate-200`}>
      <CheckSquare className="h-3.5 w-3.5" /> Select
    </button>
  ) : null;
  // ExportButtons has no busy state of its own, so the wrapper blocks a second tap while an
  // export is being gathered; exportAll also returns early if one is already running.
  const exportButtons = (
    <div
      aria-busy={exporting}
      title={exporting ? "Preparing the export…" : undefined}
      className={exporting ? "pointer-events-none opacity-50" : undefined}
    >
      <ExportButtons onExcel={() => void exportAll("excel")} onPDF={() => void exportAll("pdf")} />
    </div>
  );
  // Categories and Brands left the sidebar and live here; each shows only to a role holding its
  // view grant — cosmetic, the screens re-check. "Assembled vs unassembled" is stock.view, which
  // this page already is.
  const relatedLinks = (
    <>
      {canView("categories") && (
        <Link href="/categories" className={`${toolbarBtn} rounded-full bg-violet-50 border border-violet-200 text-violet-700 hover:bg-violet-100`}>
          <Layers className="h-3.5 w-3.5" /> Categories
        </Link>
      )}
      {canView("brands") && (
        <Link href="/more/brands" className={`${toolbarBtn} rounded-full bg-blue-50 border border-blue-200 text-blue-700 hover:bg-blue-100`}>
          <Tags className="h-3.5 w-3.5" /> Brands
        </Link>
      )}
      <Link href="/stock/condition" className={`${toolbarBtn} rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 hover:bg-emerald-100`}>
        <BarChart3 className="h-3.5 w-3.5" /> Assembled vs unassembled
      </Link>
    </>
  );

  return (
    <div>
      {/* Header. Desktop keeps title-left / actions-right with the chips row below. On a phone
          that row cannot hold eight buttons, so below lg the title stands alone and every action
          and chip moves into one toolbar that scrolls sideways instead of squeezing. */}
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-lg font-bold text-slate-900">
          {selectMode ? `${selectedIds.size} selected` : "Stock"}
        </h1>
        <div className="flex items-center gap-1.5">
          {!selectMode && <div className="hidden lg:flex items-center gap-1.5">{scopeLinks}{zohoFetchButton}{selectButton}{exportButtons}</div>}
          {selectMode && (
            <button onClick={exitSelectMode}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-slate-900 text-white">
              <X className="h-3.5 w-3.5" /> Cancel
            </button>
          )}
        </div>
      </div>

      {/* Phone toolbar: views | select | export | related pages, one swipeable row. The right-edge
          fade tells the user there is more to scroll to. */}
      {!selectMode && (
        <div className="relative lg:hidden mb-2">
          <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide pb-0.5 pr-6 [&>*]:shrink-0 [&_button]:min-h-[36px]">
            {scopeLinks}
            {zohoFetchButton && <span className="h-5 w-px bg-slate-200" aria-hidden />}
            {zohoFetchButton}
            {selectButton && <span className="h-5 w-px bg-slate-200" aria-hidden />}
            {selectButton}
            <span className="h-5 w-px bg-slate-200" aria-hidden />
            {exportButtons}
            <span className="h-5 w-px bg-slate-200" aria-hidden />
            {relatedLinks}
          </div>
          <div className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-slate-50 to-transparent" aria-hidden />
        </div>
      )}

      {/* Stock & inventory's own chips (plan 1709, R33, R11) — desktop row. On a phone they live
          in the toolbar above. */}
      {!selectMode && (
        <div className="hidden lg:flex gap-1.5 overflow-x-auto scrollbar-hide pb-0.5 mb-2 [&>*]:shrink-0">
          {relatedLinks}
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
          onRetry={() => { setDataError(null); fetchProducts(page); }}
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
              {/* Every picker is searchable (owner, 9 Sep 2026 — Q7 for Store, D11 pulls
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
            </div>

            {/* Store, then that store's warehouses, then that warehouse's bins (plan 1410-stock-
                location-and-bin, B1, §7). All three read GET /api/stock/locations (stock.view), so
                they load for every role that can open this page — the old Bin list read the
                admin-only GET /api/bins. One column on a phone, three from sm up. */}
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
              <div>
                <label htmlFor="stock-filter-store" className="text-[10px] font-medium text-slate-500 uppercase tracking-wide">Store</label>
                <SearchableSelect
                  id="stock-filter-store"
                  className="mt-0.5"
                  options={locationStores.map((st) => ({
                    id: st.id,
                    label: st.name,
                    hint: `${st.warehouses.length} warehouse${st.warehouses.length === 1 ? "" : "s"}`,
                  }))}
                  value={effectiveStoreId || null}
                  onChange={(id) => changeScope(id ?? "", "", "")}
                  placeholder={locationsLoading ? "Loading stores…" : `All stores (${locationStores.length})`}
                  emptyText="No matching store"
                  disabled={locationsLoading || !!locationsError}
                />
                {locationsError && (
                  <p className="mt-1 text-[11px] text-red-500">
                    Could not load stores, warehouses and bins.{" "}
                    <button type="button" onClick={reloadLocations} className="font-medium underline">
                      Retry
                    </button>
                  </p>
                )}
              </div>

              <div>
                <label htmlFor="stock-filter-warehouse" className="text-[10px] font-medium text-slate-500 uppercase tracking-wide">Warehouse</label>
                <SearchableSelect
                  id="stock-filter-warehouse"
                  className="mt-0.5"
                  options={
                    scopedStore
                      ? scopedStore.warehouses.map((w) => ({
                          id: w.id,
                          label: w.name,
                          hint: `${WAREHOUSE_KIND_LABEL[w.kind]} · ${fmt(w.items)} item${w.items === 1 ? "" : "s"} · ${w.bins.length} bin${w.bins.length === 1 ? "" : "s"}`,
                        }))
                      : []
                  }
                  value={selectedWarehouse || null}
                  onChange={(id) => changeScope(effectiveStoreId, id ?? "", "")}
                  placeholder={
                    locationsLoading
                      ? "Loading warehouses…"
                      : scopedStore
                        ? `All warehouses (${scopedStore.warehouses.length})`
                        : "Choose a store first"
                  }
                  emptyText="No matching warehouse"
                  disabled={!scopedStore}
                />
              </div>

              <div>
                <label htmlFor="stock-filter-bin" className="text-[10px] font-medium text-slate-500 uppercase tracking-wide">Bin</label>
                <SearchableSelect
                  id="stock-filter-bin"
                  className="mt-0.5"
                  options={
                    scopedLocation
                      ? [
                          ...(scopedLocation.noBin.items > 0
                            ? [{
                                id: "none",
                                label: "No bin",
                                hint: `${fmt(scopedLocation.noBin.products)} product${scopedLocation.noBin.products === 1 ? "" : "s"} · ${fmt(scopedLocation.noBin.items)} item${scopedLocation.noBin.items === 1 ? "" : "s"}`,
                              }]
                            : []),
                          ...scopedLocation.bins.map((b) => ({
                            id: b.id,
                            label: b.name && b.name !== b.code ? `${b.code} · ${b.name}` : b.code,
                            hint: b.items > 0
                              ? `${fmt(b.products)} product${b.products === 1 ? "" : "s"} · ${fmt(b.items)} item${b.items === 1 ? "" : "s"}`
                              : "empty",
                          })),
                        ]
                      : []
                  }
                  value={selectedBin || null}
                  onChange={(id) => changeScope(effectiveStoreId, selectedWarehouse, id ?? "")}
                  placeholder={
                    locationsLoading
                      ? "Loading bins…"
                      : scopedLocation
                        ? `All bins (${scopedLocation.bins.length})`
                        : "Choose a warehouse first"
                  }
                  emptyText="No matching bin"
                  disabled={!scopedLocation}
                />
              </div>
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

      {scopeCaption && (
        <p className={`mb-1.5 text-[11px] ${scopeStale ? "text-red-600" : "text-slate-500"}`}>{scopeCaption}</p>
      )}

      {/* Status bar */}
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs text-slate-500 tabular-nums">
          {total === 0
            ? quickFilter === "LOW_STOCK" ? "No low stock products" : "No products"
            : `Showing ${((page - 1) * PAGE_SIZE + 1).toLocaleString("en-IN")}–${((page - 1) * PAGE_SIZE + products.length).toLocaleString("en-IN")} of ${total.toLocaleString("en-IN")} ${quickFilter === "LOW_STOCK" ? "low stock products" : "products"}`}
        </p>
        <div className="flex items-center gap-1 text-[11px] text-slate-400 tabular-nums">
          <RefreshCw className={`h-3 w-3 ${refreshing ? "animate-spin" : ""}`} />
          {secondsAgo < 5 ? "Just now" : `${secondsAgo}s ago`}
        </div>
      </div>

      {/* One line, right above the table: an add that landed ("Added 5 to GT lock — now 604"),
          or an export's progress and outcome. */}
      {notice && (
        <div
          role={notice.tone === "error" ? "alert" : "status"}
          className={`flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 mb-2 ${
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
              className="shrink-0 min-h-[44px] min-w-[44px] -my-2.5 -mr-2.5 flex items-center justify-center rounded-lg opacity-70 hover:opacity-100 focus-ring"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}

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

          {/* One sortable table at every width (owner, 14 Oct 2026: no cards). It scrolls inside
              its own box, so the page never scrolls sideways. key={page} starts each page at the
              top of that box. */}
          {filtered.length > 0 && (
            <StockTable key={page} products={filtered} ctx={rowCtx} sort={sort} onSort={changeSort} />
          )}

          {/* Pages, not "Load more" — for every chip, Low Stock included now that the server
              filters it (plan 1410). */}
          {totalPages > 1 && (
            <nav aria-label="Product pages" className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <p className="text-xs text-slate-500 tabular-nums">
                Page {page.toLocaleString("en-IN")} of {totalPages.toLocaleString("en-IN")}
              </p>
              <div className="flex items-center gap-1">
                <Button variant="outline" size="sm" className="min-h-[40px] px-2" onClick={() => goToPage(1)} disabled={page === 1 || loading} aria-label="First page">
                  First
                </Button>
                <Button variant="outline" size="sm" className="min-h-[40px] px-2" onClick={() => goToPage(page - 1)} disabled={page === 1 || loading} aria-label="Previous page">
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                {pageWindow().map((n) => (
                  <Button
                    key={n}
                    variant={n === page ? "default" : "outline"}
                    size="sm"
                    className="min-h-[40px] min-w-[40px] px-2 tabular-nums"
                    onClick={() => goToPage(n)}
                    disabled={loading}
                    aria-current={n === page ? "page" : undefined}
                  >
                    {n}
                  </Button>
                ))}
                <Button variant="outline" size="sm" className="min-h-[40px] px-2" onClick={() => goToPage(page + 1)} disabled={page === totalPages || loading} aria-label="Next page">
                  <ChevronRight className="h-4 w-4" />
                </Button>
                <Button variant="outline" size="sm" className="min-h-[40px] px-2" onClick={() => goToPage(totalPages)} disabled={page === totalPages || loading} aria-label="Last page">
                  Last
                </Button>
              </div>
            </nav>
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

      <AddStockSheet
        open={addTarget !== null}
        product={addTarget}
        onClose={() => setAddTarget(null)}
        onAdded={applyStockAdded}
      />

      <ZohoStockImportSheet
        isOpen={isZohoSheetOpen}
        onClose={() => setIsZohoSheetOpen(false)}
        onImportComplete={() => {
          setPage(1);
          fetchProducts(1);
          reloadMasterData();
          reloadLocations();
        }}
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
              {/* Bin is the detail no import can supply — see the plan's Part E. */}
              <button
                onClick={() => setBulkAction("bin")}
                className={`flex-1 py-2 rounded-lg text-xs font-medium transition-colors ${
                  bulkAction === "bin" ? "bg-blue-600 text-white" : "bg-slate-700 text-slate-300 hover:bg-slate-600"
                }`}
              >
                Bin
              </button>
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

            {bulkAction === "bin" && (
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
