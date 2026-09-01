"use client";
import { useDebounce } from "@/hooks/use-debounce";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { Search, MapPin, Loader2, SlidersHorizontal, ChevronDown, RefreshCw, CheckSquare, Square, X, Cloud, Download, Package, ChevronRight, EyeOff, RotateCcw, Trash2, Ruler
} from "lucide-react";
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
import { apiFetch } from "@/lib/api-client";
import { ErrorBanner } from "@/components/ui/error-banner";
import { SkeletonList } from "@/components/ui/skeleton";
import { BIN_TRACKING_ENABLED } from "@/lib/inventory-config";
import { isPlaceholderBrand, isPlaceholderCategory } from "@/lib/import-placeholders";
import { BICYCLE_SIZES } from "@/lib/product-size";

const STOCK_COLUMNS: ExportColumn[] = [
  { header: "SKU", key: "sku" },
  { header: "Product Name", key: "name" },
  { header: "Type", key: "type" },
  { header: "Category", key: "category.name" },
  { header: "Brand", key: "brand.name" },
  { header: "Size", key: "size" },
  { header: "Stock", key: "currentStock" },
  { header: "Reorder Level", key: "reorderLevel" },
  { header: "Bin", key: "bin.code" },
];

interface ProductItem {
  id: string;
  sku: string;
  name: string;
  type: string;
  size: string | null;
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
}

interface BrandItem { id: string; name: string; _count: { products: number }; }
interface BinItem { id: string; code: string; name: string; location: string; _count: { products: number }; }
interface CategoryItem { id: string; name: string; _count: { products: number }; }

interface PerItemBin {
  binId: string | null;
  binCode: string | null;
  binName: string | null;
  binLocation: string | null;
  stock: number;
  sku: string;
  productId: string;
  costPrice: number;
  sellingPrice: number;
  lastInward: string | null;
  lastOutward: string | null;
}

interface PerItemGroup {
  name: string;
  brandName: string | null;
  brandId: string | null;
  categoryName: string | null;
  totalStock: number;
  bins: PerItemBin[];
}

type StockView = "list" | "per-item";
type QuickFilter = "ALL" | "IN_STOCK" | "NO_STOCK" | "LOW_STOCK" | "INACTIVE" | "NEEDS_DETAILS";

const QUICK_CHIPS: { key: QuickFilter; label: string }[] = [
  { key: "ALL", label: "All" },
  { key: "IN_STOCK", label: "In Stock" },
  { key: "NO_STOCK", label: "No Stock" },
  { key: "LOW_STOCK", label: "Low Stock" },
  // The fix-up queue: products the import had to invent a brand or a category for. Paired
  // with Select + bulk assign below, this is the whole workflow for correcting an import —
  // find the rows nobody has described, describe them in one action.
  { key: "NEEDS_DETAILS", label: "Needs details" },
  { key: "INACTIVE", label: "Inactive" },
];

// BICYCLE_SIZES now lives in `@/lib/product-size` alongside the parse that produces them, so
// the sizes this filter offers and the sizes an import can write are the same list by
// construction. A parsed size that the filter could not select would be a badge with nothing
// behind it.

const log = createLogger("stock");

const PAGE_SIZE = 100;

function getStockColor(p: ProductItem) {
  if (p.currentStock <= 0) return "text-red-600";
  if (p.reorderLevel > 0 && p.currentStock <= p.reorderLevel) return "text-yellow-600";
  return "text-green-600";
}

function getStockBadge(p: ProductItem) {
  if (p.currentStock <= 0) return { variant: "danger" as const, label: "Out" };
  if (p.reorderLevel > 0 && p.currentStock <= p.reorderLevel) return { variant: "warning" as const, label: "Low" };
  return { variant: "success" as const, label: "OK" };
}

function getStockAccent(p: ProductItem) {
  if (p.status === "INACTIVE") return "border-l-slate-200";
  if (p.currentStock <= 0) return "border-l-red-500";
  if (p.reorderLevel > 0 && p.currentStock <= p.reorderLevel) return "border-l-amber-400";
  return "border-l-green-500";
}

export default function StockPage() {
  const { data: session } = useSession();
  const { canFetch, canEdit, canDelete, canView } = usePermissions();
  // Bulk edit writes product fields, so it is stock.edit.
  const canBulkEdit = canEdit("stock");

  // Cost price is its own module, not an admin flag — CLAUDE.md. This only hides the label;
  // the API already withholds the field itself, which is the gate that matters.
  const showCost = canView("cost_price");

  // Deactivate / restore are edits — the row survives with all its history.
  // Delete permanently removes it, and only when nothing references it.
  const mayDeactivate = canEdit("stock");
  const mayDelete = canDelete("stock");

  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [rowOutcome, setRowOutcome] = useState<{ ok: boolean; name: string; message: string } | null>(null);

  const canFetchItems = canFetch("stock");

  // Fetch Items from Zoho
  const [fetchStep, setFetchStep] = useState<"idle" | "pickDate" | "fetching" | "selecting" | "importing">("idle");
  const [itemPreviews, setItemPreviews] = useState<Array<{ id: string; zohoId: string; data: { name: string; sku: string; costPrice: number; sellingPrice: number } }>>([]);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [fetchError, setFetchError] = useState("");
  const [fetchPullId, setFetchPullId] = useState("");
  const [fetchProgress, setFetchProgress] = useState("");
  const [fetchDays, setFetchDays] = useState<number>(7);
  const [fetchCustomFrom, setFetchCustomFrom] = useState("");
  const [fetchCustomTo, setFetchCustomTo] = useState("");

  const [dataError, setDataError] = useState<string | null>(null);
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search);
  const [quickFilter, setQuickFilter] = useState<QuickFilter>("ALL");
  const [typeFilter, setTypeFilter] = useState<"BICYCLE" | "SPARE_PART" | "ACCESSORY" | "ALL">("BICYCLE");
  const [showFilters, setShowFilters] = useState(false);
  const [selectedBrand, setSelectedBrand] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("");
  const [selectedSize, setSelectedSize] = useState("");
  const [selectedBin, setSelectedBin] = useState("");
  const [brands, setBrands] = useState<BrandItem[]>([]);
  const [bins, setBins] = useState<BinItem[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const [refreshing, setRefreshing] = useState(false);

  // View toggle: list vs per-item
  const [stockView, setStockView] = useState<StockView>("list");
  const [perItemData, setPerItemData] = useState<PerItemGroup[]>([]);
  const [perItemLoading, setPerItemLoading] = useState(false);
  const [perItemSearch, setPerItemSearch] = useState("");
  const debouncedPerItemSearch = useDebounce(perItemSearch);
  const [perItemBrandFilter, setPerItemBrandFilter] = useState("");
  const [expandedItem, setExpandedItem] = useState<string | null>(null);

  const fetchPerItemData = useCallback(() => {
    setPerItemLoading(true);
    const params = new URLSearchParams();
    if (debouncedPerItemSearch) params.set("search", debouncedPerItemSearch);
    if (perItemBrandFilter) params.set("brandId", perItemBrandFilter);
    fetch(`/api/stock/per-item?${params}`)
      .then((r) => r.json())
      .then((res) => {
        if (res.success) setPerItemData(res.data);
      })
      .catch(() => {})
      .finally(() => setPerItemLoading(false));
  }, [debouncedPerItemSearch, perItemBrandFilter]);

  useEffect(() => {
    if (stockView === "per-item") fetchPerItemData();
  }, [stockView, fetchPerItemData]);

  // Bulk select mode
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState<"" | "brand" | "status" | "category" | "bin">("");
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

  // The one-off wheel-size backfill (Part C). Separate from bulk assign because it takes no
  // selection and asks for no value: it reads names and fills blanks across the catalog.
  const [sizeFillBusy, setSizeFillBusy] = useState(false);

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

  /**
   * Part C's backfill: read every sizeless bicycle's name and recover the wheel size from it.
   *
   * Person-triggered and confirmed, never automatic. It only ever fills a blank — the server
   * repeats the "size is empty" test on the write — so pressing it twice is safe and a size
   * somebody typed is never touched.
   */
  async function handleSizeBackfill() {
    if (!confirm(
      "Fill in missing wheel sizes?\n\n" +
      "Reads the size from the start of each bicycle's name (26''BICYCLE… → 26\") and fills it " +
      "in where the size is blank. Sizes already entered by hand are left alone."
    )) return;

    setSizeFillBusy(true);
    setBulkMessage("");
    try {
      const data = await apiFetch<{ scanned: number; updated: number; unmatched: number; hasMore: boolean }>(
        "/api/products/backfill-size",
        { method: "POST" }
      );
      log.info("size backfill finished", data);
      setBulkMessage(
        `Filled ${data.updated} size${data.updated === 1 ? "" : "s"} from ${data.scanned} bicycle${data.scanned === 1 ? "" : "s"}` +
        (data.unmatched > 0 ? ` — ${data.unmatched} had no recognisable size in the name` : "") +
        (data.hasMore ? ". More remain, press again." : "")
      );
      fetchProducts(1);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Could not fill sizes";
      log.error("size backfill failed", { message });
      setDataError(message);
    } finally {
      setSizeFillBusy(false);
    }
  }

  const handleFetchItems = async () => {
    setFetchStep("fetching");
    setFetchError("");
    setFetchProgress("Connecting to Zoho...");
    try {
      // Calculate fromDate based on selected days or custom date
      let fromDate: string;
      if (fetchDays === -1 && fetchCustomFrom) {
        fromDate = fetchCustomFrom;
      } else {
        const fromDateObj = new Date();
        fromDateObj.setDate(fromDateObj.getDate() - fetchDays);
        fromDate = fromDateObj.toISOString().slice(0, 10);
      }

      // All four steps go through apiFetch: it logs request + response at LOG_LEVEL=0 and,
      // crucially, refuses to parse an HTML body as JSON. The old `.then(r => r.json())`
      // turned an expired session (307 -> /login -> 200 text/html) and a Zoho gateway
      // timeout into the same useless `Unexpected token '<'`.
      const initData = await apiFetch<{ pullId: string }>("/api/zoho/trigger-pull", {
        method: "POST",
        json: { step: "init" },
      });
      const pullId = initData.pullId;
      setFetchPullId(pullId);

      const label = fetchDays === -1 ? "custom range" : `last ${fetchDays} days`;
      setFetchProgress(`Pulling items from ${label}...`);
      const itemData = await apiFetch<{ itemsNew: number; apiCalls: number; errors?: string[] }>(
        "/api/zoho/trigger-pull",
        { method: "POST", json: { step: "items", pullId, fromDate } }
      );

      const found = itemData.itemsNew || 0;
      setFetchProgress(`Found ${found} new item${found !== 1 ? "s" : ""}. Finalizing...`);
      // Finalize is best-effort — the items are already staged, so a failure here must not
      // lose them. It is caught, but no longer silently: apiFetch logs why it failed.
      await apiFetch("/api/zoho/trigger-pull", {
        method: "POST",
        json: {
          step: "finalize",
          pullId,
          itemsNew: itemData.itemsNew,
          apiCalls: itemData.apiCalls,
          allErrors: itemData.errors || [],
        },
      }).catch(() => {});

      setFetchProgress("Loading preview...");
      const previewData = await apiFetch<{
        previews?: {
          id: string;
          zohoId: string;
          entityType: string;
          status: string;
          data: { name: string; sku: string; costPrice: number; sellingPrice: number };
        }[];
      }>(`/api/zoho/pull-review?pullId=${pullId}`);
      const items = (previewData.previews || []).filter((p: { entityType: string; status: string }) => p.entityType === "item" && p.status === "PENDING");
      setItemPreviews(items);
      setSelectedItems(new Set(items.map((i: { id: string }) => i.id)));
      setFetchStep(items.length > 0 ? "selecting" : "idle");
      if (items.length === 0) setFetchError(`No new items found (${found} from Zoho, all already in catalog)`);
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : "Fetch failed");
      setFetchStep("idle");
    } finally {
      setFetchProgress("");
    }
  };

  const toggleItem = (id: string) => {
    setSelectedItems(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleImportItems = async () => {
    if (selectedItems.size === 0) return;
    setFetchStep("importing");
    try {
      const res = await fetch("/api/zoho/pull-review/approve", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pullId: fetchPullId, action: "approve",
          entityType: "item", previewIds: Array.from(selectedItems),
        }),
      }).then(r => r.json());
      if (!res.success) throw new Error(res.error || "Import failed");
      const imported = res.data?.items || 0;
      const errors = res.data?.errors || [];
      setFetchStep("idle");
      setItemPreviews([]);
      setSelectedItems(new Set());
      fetchProducts(1);
      if (errors.length > 0) {
        setFetchError(`Imported ${imported} item(s). Warnings: ${errors.join("; ")}`);
      }
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : "Import failed");
      setFetchStep("selecting");
    }
  };

  function formatCurrency(amount: number) {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount);
  }

  // Fetch brands + categories + bins once
  useEffect(() => {
    Promise.all([
      fetch("/api/brands").then((r) => r.json()),
      fetch("/api/bins").then((r) => r.json()),
      fetch("/api/categories").then((r) => r.json()),
    ]).then(([brandsRes, binsRes, catsRes]) => {
      if (brandsRes.success) setBrands(brandsRes.data);
      if (binsRes.success) setBins(binsRes.data);
      if (catsRes.success) setCategories(catsRes.data);
    }).catch(() => {});
  }, []);

  const activeFilterCount = [selectedBrand, selectedCategory, selectedSize, selectedBin].filter(Boolean).length;

  const buildParams = useCallback((pageNum: number) => {
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), page: String(pageNum), sortBy: "currentStock", sortOrder: "desc" });
    if (debouncedSearch) params.set("search", debouncedSearch);
    if (typeFilter !== "ALL") params.set("type", typeFilter);
    if (quickFilter === "INACTIVE") { params.set("status", "INACTIVE"); }
    else if (quickFilter === "IN_STOCK") { params.set("status", "ACTIVE"); params.set("minStock", "1"); }
    else if (quickFilter === "NO_STOCK") { params.set("status", "ACTIVE"); params.set("maxStock", "0"); }
    // Server-side, not a filter over the current page. The list is paginated at 100, and the
    // rows needing attention are spread across the whole catalog — filtering what happens to
    // be loaded would report "3 need details" out of 151 and look like good news.
    else if (quickFilter === "NEEDS_DETAILS") { params.set("status", "ACTIVE"); params.set("needsDetails", "true"); }
    else if (quickFilter === "ALL" || quickFilter === "LOW_STOCK") { params.set("status", "ACTIVE"); }
    if (selectedBrand) params.set("brandId", selectedBrand);
    if (selectedCategory) params.set("categoryId", selectedCategory);
    if (selectedSize) params.set("size", selectedSize);
    if (selectedBin) params.set("binId", selectedBin);
    return params;
  }, [debouncedSearch, quickFilter, typeFilter, selectedBrand, selectedCategory, selectedSize, selectedBin]);

  const fetchProducts = useCallback((pageNum: number, append = false, silent = false) => {
    if (!silent) { if (append) setLoadingMore(true); else setLoading(true); }
    else setRefreshing(true);

    const params = buildParams(pageNum);
    fetch(`/api/products?${params}`)
      .then((r) => r.json())
      .then((res) => {
        if (res.success) {
          if (append) setProducts((prev) => [...prev, ...res.data]);
          else setProducts(res.data);
          setTotal(res.pagination?.total || 0);
          setHasMore(res.pagination?.hasMore || false);
          setLastUpdated(new Date());
        }
      })
      .catch((e) => {
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

  /**
   * Permanent delete, in one dialog: ask the API what is attached, show that, then delete.
   *
   * The confirmation names the actual records before anything is destroyed, so the
   * destructive answer is never a surprise — and because only one dialog is ever raised, a
   * browser cannot suppress the one that matters. The server still refuses a delete that
   * did not ask for force, so this screen is not the only gate.
   */
  async function deleteProduct(p: ProductItem) {
    setRowBusy(p.id);
    try {
      // Ask what is attached FIRST. ?check=true counts and returns; it deletes nothing.
      //
      // This exists so there is exactly ONE dialog. There used to be two chained confirm()
      // calls — one before the request, a second after the API refused and named the
      // blockers. Chrome puts a "Prevent this page from creating additional dialogs"
      // checkbox on the SECOND dialog of a chain, and once that is ticked every later
      // confirm() returns false with nothing shown. The force path was therefore
      // unreachable: you saw the refusal message and never got the prompt. A single dialog
      // cannot be suppressed that way.
      const check = await apiFetch<{ name: string; blockers?: string[] }>(
        `/api/products/${p.id}?check=true`,
        { method: "DELETE" }
      );
      const blockers = check.blockers ?? [];
      const what = blockers.join(", ");
      log.debug("product delete check", { productId: p.id, blockers });

      const ok = confirm(
        what
          ? `${check.name} has ${what}.\n\nDelete the product AND all of that data permanently?\n\nThis removes its stock history and cannot be undone.`
          : `Permanently delete ${check.name}? This cannot be undone.`
      );
      if (!ok) return;

      // force only when something is actually attached, so a clean product still takes the
      // safe path and the server keeps its own guard either way.
      const res = await apiFetch<{ deleted: boolean; name: string; message: string }>(
        `/api/products/${p.id}${what ? "?force=true" : ""}`,
        { method: "DELETE" }
      );
      if (what) log.warn("product force deleted", { productId: p.id, blockers });
      else log.info("product deleted", { productId: p.id });

      setRowOutcome({ ok: res.deleted, name: res.name, message: res.message });
      fetchProducts(1);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not delete the product";
      log.error("product delete failed", { productId: p.id, message: msg });
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
    setSelectedSize("");
    setSelectedBin("");
  }

  const filtered = quickFilter === "LOW_STOCK"
    ? products.filter((p) => p.reorderLevel > 0 && p.currentStock <= p.reorderLevel)
    : debouncedSearch
      ? products.filter((p) => fuzzySearchFields(debouncedSearch, [p.name, p.sku, p.brand?.name, p.size, p.category?.name]))
      : products;

  const secondsAgo = Math.round((Date.now() - lastUpdated.getTime()) / 1000);

  // Show size filter always
  const showSizeFilter = true;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-lg font-bold text-slate-900">
          {selectMode ? `${selectedIds.size} selected` : "Stock"}
        </h1>
        <div className="flex items-center gap-1.5">
          {canFetchItems && !selectMode && fetchStep !== "pickDate" && (
            <button
              onClick={() => setFetchStep("pickDate")}
              disabled={fetchStep === "fetching" || fetchStep === "importing"}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-slate-900 text-white disabled:opacity-50"
            >
              {fetchStep === "fetching" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Cloud className="h-3.5 w-3.5" />}
              {fetchStep === "fetching" ? "Fetching..." : "Fetch Stock"}
            </button>
          )}
          {/* Offered only while the "Needs details" queue is on screen. It is a one-off
              correction, not a routine action, and a button that rewrites sizes across the
              catalog does not belong next to Export on every visit. */}
          {canBulkEdit && !selectMode && quickFilter === "NEEDS_DETAILS" && (
            <button
              onClick={handleSizeBackfill}
              disabled={sizeFillBusy}
              title="Fill blank bicycle sizes from the product name"
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-slate-100 text-slate-600 hover:bg-slate-200 disabled:opacity-50"
            >
              {sizeFillBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Ruler className="h-3.5 w-3.5" />}
              {sizeFillBusy ? "Filling..." : "Fill Sizes"}
            </button>
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

      {/* Bulk success/error message */}
      {bulkMessage && (
        <div className="flex items-center justify-between bg-green-50 border border-green-200 rounded-lg p-2.5 mb-2">
          <span className="text-xs text-green-700 font-medium">{bulkMessage}</span>
          <button onClick={() => setBulkMessage("")} className="text-green-500"><X className="h-3.5 w-3.5" /></button>
        </div>
      )}

      {/* Fetch Date Picker */}
      {fetchStep === "pickDate" && (
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 mb-2">
          <p className="text-xs font-medium text-slate-700 mb-2">Fetch stock items from Zoho within:</p>
          <div className="flex flex-wrap gap-2 mb-3">
            {[
              { label: "3 days", value: 3 },
              { label: "7 days", value: 7 },
              { label: "14 days", value: 14 },
              { label: "30 days", value: 30 },
              { label: "Custom", value: -1 },
            ].map((opt) => (
              <button
                key={opt.value}
                onClick={() => setFetchDays(opt.value)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                  fetchDays === opt.value
                    ? "bg-slate-900 text-white border-slate-900"
                    : "bg-white text-slate-600 border-slate-300 hover:border-slate-400"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {fetchDays === -1 && (
            <div className="flex gap-2 mb-3">
              <div>
                <label className="text-[10px] text-slate-500 block mb-0.5">From</label>
                <input type="date" value={fetchCustomFrom} onChange={(e) => setFetchCustomFrom(e.target.value)}
                  className="px-2 py-1.5 text-xs border border-slate-300 rounded-lg" />
              </div>
              <div>
                <label className="text-[10px] text-slate-500 block mb-0.5">To (optional)</label>
                <input type="date" value={fetchCustomTo} onChange={(e) => setFetchCustomTo(e.target.value)}
                  className="px-2 py-1.5 text-xs border border-slate-300 rounded-lg" />
              </div>
            </div>
          )}
          <div className="flex gap-2">
            <button
              onClick={handleFetchItems}
              disabled={fetchDays === -1 && !fetchCustomFrom}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-900 text-white disabled:opacity-50"
            >
              <Cloud className="h-3.5 w-3.5" /> Fetch
            </button>
            <button
              onClick={() => setFetchStep("idle")}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-white text-slate-500 border border-slate-300"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Fetch Error */}
      {fetchError && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-2.5 mb-2 text-xs text-amber-700">
          {fetchError}
          <button onClick={() => setFetchError("")} className="ml-2 underline">dismiss</button>
        </div>
      )}

      {/* Fetch Progress */}
      {fetchStep === "fetching" && fetchProgress && (
        <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-lg p-2.5 mb-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-600 shrink-0" />
          <span className="text-xs text-blue-700 font-medium">{fetchProgress}</span>
        </div>
      )}

      {/* Item Selection Panel */}
      {fetchStep === "selecting" && itemPreviews.length > 0 && (
        <Card className="mb-3 border-blue-200 bg-blue-50/50">
          <CardContent className="p-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-blue-800">
                {itemPreviews.length} new item{itemPreviews.length !== 1 ? "s" : ""} from Zoho
              </p>
              <div className="flex gap-2">
                <button onClick={() => { setFetchStep("idle"); setItemPreviews([]); }}
                  className="text-xs text-slate-500 underline">Cancel</button>
                <button onClick={handleImportItems} disabled={selectedItems.size === 0}
                  className="flex items-center gap-1 bg-blue-600 text-white px-3 py-1.5 rounded-md text-xs font-medium disabled:opacity-50">
                  <Download className="h-3 w-3" /> Import {selectedItems.size}
                </button>
              </div>
            </div>
            <div className="space-y-1.5 max-h-64 overflow-y-auto">
              {itemPreviews.map((item) => (
                <label key={item.id}
                  className={`flex items-start gap-2 p-2 rounded-lg cursor-pointer transition-colors ${
                    selectedItems.has(item.id) ? "bg-blue-100 border border-blue-300" : "bg-white border border-slate-200"
                  }`}>
                  <input type="checkbox" checked={selectedItems.has(item.id)}
                    onChange={() => toggleItem(item.id)} className="mt-0.5 rounded" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-slate-900">{item.data.name}</span>
                    </div>
                    <p className="text-[10px] text-slate-600">{item.data.sku || "No SKU"}</p>
                    <div className="flex gap-3 mt-0.5">
                      <span className="text-[10px] text-slate-500">Cost: {formatCurrency(item.data.costPrice)}</span>
                      <span className="text-[10px] text-slate-500">Sell: {formatCurrency(item.data.sellingPrice)}</span>
                    </div>
                  </div>
                </label>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Importing indicator */}
      {fetchStep === "importing" && (
        <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-lg p-3 mb-3">
          <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
          <span className="text-xs text-blue-700 font-medium">Importing items into catalog...</span>
        </div>
      )}

      {/* Data Load Error */}
      {dataError && (
        <ErrorBanner
          message={dataError}
          type={typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "error"}
          onRetry={() => { setDataError(null); fetchProducts(1); }}
          onDismiss={() => setDataError(null)}
        />
      )}

      {/* Type Tabs */}
      <div className="grid grid-cols-4 gap-1 mb-3 bg-slate-100 rounded-xl p-1">
        {([
          { key: "BICYCLE" as const, label: "Cycles" },
          { key: "SPARE_PART" as const, label: "Spares" },
          { key: "ACCESSORY" as const, label: "Access." },
          { key: "ALL" as const, label: "All" },
        ]).map((t) => (
          <button
            key={t.key}
            onClick={() => { setTypeFilter(t.key); setPage(1); }}
            className={`py-2 rounded-lg text-xs font-semibold transition-colors ${
              typeFilter === t.key
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* View Tabs */}
      <div className="flex gap-2 mb-3">
        <button
          onClick={() => setStockView("list")}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium border transition-colors ${
            stockView === "list"
              ? "bg-slate-900 text-white border-slate-900"
              : "bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100"
          }`}
        >
          List View
        </button>
        <button
          onClick={() => setStockView("per-item")}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium border transition-colors ${
            stockView === "per-item"
              ? "bg-slate-900 text-white border-slate-900"
              : "bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100"
          }`}
        >
          <Package className="h-3 w-3" /> Per Item
        </button>
        <Link href="/stock/by-brand"
          className="flex-1 flex items-center justify-center gap-1.5 bg-blue-50 border border-blue-200 text-blue-700 py-2 rounded-lg text-xs font-medium">
          By Brand
        </Link>
        <Link href="/stock/by-bin"
          className="flex-1 flex items-center justify-center gap-1.5 bg-purple-50 border border-purple-200 text-purple-700 py-2 rounded-lg text-xs font-medium">
          <MapPin className="h-3 w-3" /> {BIN_TRACKING_ENABLED ? "By Bin" : "By Location"}
        </Link>
      </div>

      {/* ═══════════ PER-ITEM VIEW ═══════════ */}
      {stockView === "per-item" && (
        <PerItemView
          data={perItemData}
          loading={perItemLoading}
          search={perItemSearch}
          onSearchChange={setPerItemSearch}
          brandFilter={perItemBrandFilter}
          onBrandFilterChange={setPerItemBrandFilter}
          brands={brands}
          expandedItem={expandedItem}
          onToggleExpand={(name) => setExpandedItem(expandedItem === name ? null : name)}
        />
      )}

      {/* ═══════════ LIST VIEW ═══════════ */}
      {stockView === "list" && <>
      {/* Search */}
      <div className="relative mb-3">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <Input
          placeholder="Search product, SKU, brand, or size..."
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
              onClick={() => {
                setQuickFilter(chip.key);
                // "Needs details" is a question about the whole catalog, and the type filter
                // defaults to BICYCLE — leaving it set would answer "which BICYCLES need
                // details", quietly hiding most of the spare parts and accessories that need
                // them just as much. Widening to All is visible in the control above and the
                // person can narrow it again.
                if (chip.key === "NEEDS_DETAILS") setTypeFilter("ALL");
              }}
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
              <div>
                <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wide">Category</label>
                <select
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value)}
                  className="mt-0.5 flex h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
                >
                  <option value="">All Categories ({categories.length})</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name} ({c._count.products})</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wide">Brand</label>
                <select
                  value={selectedBrand}
                  onChange={(e) => setSelectedBrand(e.target.value)}
                  className="mt-0.5 flex h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
                >
                  <option value="">All Brands ({brands.length})</option>
                  {brands.map((b) => (
                    <option key={b.id} value={b.id}>{b.name} ({b._count.products})</option>
                  ))}
                </select>
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

            {showSizeFilter && (
              <div>
                <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wide">Size (Bicycles)</label>
                <select
                  value={selectedSize}
                  onChange={(e) => setSelectedSize(e.target.value)}
                  className="mt-0.5 flex h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
                >
                  <option value="">All Sizes</option>
                  {BICYCLE_SIZES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
            )}

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
                        {/* A placeholder is the ABSENCE of a brand, so it must not look like
                            one. `Imported` rendered in the same blue as `Atlas` reads as a
                            brand name to anyone who has not been told otherwise — which is
                            how 151 undescribed products stayed invisible. Muted and italic,
                            the style this app already uses for missing data. */}
                        {p.brand && (
                          <span className={isPlaceholderBrand(p.brand.name)
                            ? "text-xs italic text-slate-400"
                            : "text-xs font-medium text-blue-600"}>
                            {p.brand.name}
                          </span>
                        )}
                        {p.category && (
                          <span className={isPlaceholderCategory(p.category.name)
                            ? "text-xs italic text-slate-400"
                            : "text-xs text-slate-400"}>
                            {p.category.name}
                          </span>
                        )}
                        {p.size && (
                          <Badge variant="default" className="text-[10px] py-0 tabular-nums">{p.size}</Badge>
                        )}
                      </div>
                      {/* Price. Selling price is safe for everyone — it is what a customer is
                          quoted. Cost price is NOT: it is gated by the `cost_price` module,
                          and `api/products/route.ts:100` already omits the field entirely for
                          anyone without that grant, so this renders nothing rather than
                          "₹0" for them. Same pattern as stock/by-brand and stock/[id]. */}
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
                    </div>
                    <div className="text-right shrink-0">
                      <p className={`text-xl font-bold tabular-nums ${getStockColor(p)}`}>{p.currentStock}</p>
                      <Badge variant={badge.variant} className="text-[10px]">{badge.label}</Badge>

                      {/* Hidden in select mode: the whole row is a checkbox target there, and
                          a button inside it would fight the row's click handler. */}
                      {!selectMode && (mayDeactivate || mayDelete) && (
                        <div className="flex gap-1 justify-end mt-1.5">
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
                          {/* Permanent delete is offered only on an already-deactivated
                              product. Deactivate first is the safe default, and it means the
                              destructive button is never a mis-tap away on the main list. */}
                          {mayDelete && p.status === "INACTIVE" && (
                            <RowBtn
                              label={`Permanently delete ${p.name}`}
                              tone="text-red-600"
                              disabled={rowBusy === p.id}
                              onClick={(e) => { e.preventDefault(); e.stopPropagation(); void deleteProduct(p); }}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
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
            </div>

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
      </>}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Per-Item View Component
   ═══════════════════════════════════════════════════════════════ */

function formatRelativeDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 30) return `${diffDays}d ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`;
  return `${Math.floor(diffDays / 365)}y ago`;
}

function PerItemView({
  data,
  loading,
  search,
  onSearchChange,
  brandFilter,
  onBrandFilterChange,
  brands,
  expandedItem,
  onToggleExpand,
}: {
  data: PerItemGroup[];
  loading: boolean;
  search: string;
  onSearchChange: (v: string) => void;
  brandFilter: string;
  onBrandFilterChange: (v: string) => void;
  brands: BrandItem[];
  expandedItem: string | null;
  onToggleExpand: (name: string) => void;
}) {
  return (
    <div>
      {/* Search */}
      <div className="relative mb-3">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <Input
          placeholder="Search product name, SKU, or brand..."
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Brand filter */}
      <div className="mb-3">
        <select
          value={brandFilter}
          onChange={(e) => onBrandFilterChange(e.target.value)}
          className="flex h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
        >
          <option value="">All Brands</option>
          {brands.map((b) => (
            <option key={b.id} value={b.id}>{b.name} ({b._count.products})</option>
          ))}
        </select>
      </div>

      {/* Count */}
      <p className="text-xs text-slate-500 mb-2">
        {data.length} item{data.length !== 1 ? "s" : ""} grouped by name
      </p>

      {/* Loading skeleton */}
      {loading ? (
        <SkeletonList count={6} type="card" />
      ) : data.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-sm text-slate-400">No products found</p>
        </div>
      ) : (
        <div className="space-y-2">
          {data.map((group) => {
            const isExpanded = expandedItem === group.name;
            // Build per-location summary: e.g. "Hub: 1 | Godown: 2"
            const locationSummary: Record<string, number> = {};
            for (const bin of group.bins) {
              const loc = bin.binName || bin.binLocation || "Unassigned";
              locationSummary[loc] = (locationSummary[loc] || 0) + bin.stock;
            }
            const locationLine = Object.entries(locationSummary)
              .map(([loc, qty]) => `${loc}: ${qty}`)
              .join(" | ");

            return (
              <div key={group.name}>
                <Card
                  className={`cursor-pointer border-l-4 ${group.totalStock <= 0 ? "border-l-red-500" : "border-l-green-500"} transition-colors active:bg-slate-50 ${isExpanded ? "border-slate-400" : "hover:border-slate-300"}`}
                  onClick={() => onToggleExpand(group.name)}
                >
                  <CardContent className="p-3">
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0 mr-3">
                        <p className="text-sm font-semibold text-slate-900">{group.name}</p>
                        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                          {group.brandName && (
                            <span className="text-xs font-medium text-blue-600">{group.brandName}</span>
                          )}
                          {group.categoryName && (
                            <span className="text-xs text-slate-400">{group.categoryName}</span>
                          )}
                        </div>
                        {BIN_TRACKING_ENABLED && <p className="text-[11px] text-slate-500 mt-1 tabular-nums">{locationLine}</p>}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <div className="text-right">
                          <p className={`text-xl font-bold tabular-nums ${group.totalStock <= 0 ? "text-red-600" : "text-green-600"}`}>
                            {group.totalStock}
                          </p>
                          <span className="text-[11px] text-slate-400">total</span>
                        </div>
                        <ChevronRight className={`h-4 w-4 text-slate-400 transition-transform ${isExpanded ? "rotate-90" : ""}`} />
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Expanded detail: per-bin breakdown */}
                {isExpanded && (
                  <div className="ml-3 mt-1 mb-2 space-y-1.5 border-l-2 border-slate-200 pl-3">
                    {group.bins.map((bin) => (
                      <div
                        key={bin.productId}
                        className="bg-slate-50 rounded-lg p-2.5 border border-slate-100"
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1 min-w-0">
                            {BIN_TRACKING_ENABLED ? (
                              <div className="flex items-center gap-1.5">
                                <MapPin className="h-3 w-3 text-slate-400 shrink-0" />
                                <span className="text-xs font-medium text-slate-700">
                                  {bin.binName || bin.binCode || "No Bin"}
                                </span>
                                {bin.binLocation && (
                                  <span className="text-[10px] text-slate-400">({bin.binLocation})</span>
                                )}
                              </div>
                            ) : (
                              <span className="text-xs font-medium text-slate-700 tabular-nums">{bin.sku}</span>
                            )}
                            {BIN_TRACKING_ENABLED && (
                              <p className="text-[11px] text-slate-400 mt-0.5 ml-[18px] tabular-nums">
                                SKU: {bin.sku}
                              </p>
                            )}
                            <div className="flex items-center gap-3 mt-1 ml-[18px]">
                              <span className="text-[11px] text-slate-500">
                                In: <span className="font-medium text-green-700 tabular-nums">{formatRelativeDate(bin.lastInward)}</span>
                              </span>
                              <span className="text-[11px] text-slate-500">
                                Out: <span className="font-medium text-orange-700 tabular-nums">{formatRelativeDate(bin.lastOutward)}</span>
                              </span>
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <p className={`text-lg font-bold tabular-nums ${bin.stock <= 0 ? "text-red-600" : "text-slate-900"}`}>
                              {bin.stock}
                            </p>
                            <Badge variant={bin.stock <= 0 ? "danger" : "success"} className="text-[10px]">
                              {bin.stock <= 0 ? "Out" : "In Stock"}
                            </Badge>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
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
