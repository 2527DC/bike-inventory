"use client";

import { useState, useCallback, useMemo, useEffect } from "react";
import {
  Cloud,
  Loader2,
  CheckCircle2,
  X,
  CheckSquare,
  Square,
  Search,
  Layers,
  Tags,
  Database,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ErrorBanner } from "@/components/ui/error-banner";
import { apiFetch, apiTry } from "@/lib/api-client";
import { getTodayIST } from "@/lib/services/timezone";
import { createLogger } from "@/lib/logger";

const log = createLogger("stock:zoho-import-sheet");

const IMPORT_BATCH_SIZE = 250;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface ZohoProductItem {
  zohoId: string;
  name: string;
  sku: string;
  sellingPrice: number;
  costPrice?: number;
  brandName?: string | null;
  brandIsNew?: boolean;
  categoryName?: string | null;
  categoryIsNew?: boolean;
  status: "new" | "update";
  modifiedAt?: string;
  raw?: Record<string, unknown>;
}

export interface ZohoPreviewCounts {
  totalActive?: number;
  total?: number;
  newProducts?: number;
  new?: number;
  existingProducts?: number;
  update?: number;
  existing?: number;
  brandsToCreate?: number;
  newBrands?: number;
  categoriesToCreate?: number;
  newCategories?: number;
}

export interface ZohoCacheMeta {
  totalItems: number;
  cachedAt: string;
  lastModifiedCursor?: string;
  source?: "cache" | "delta" | "full";
}

export interface ZohoPreviewApiResponse {
  products?: Record<string, unknown>[];
  items?: Record<string, unknown>[];
  rows?: Record<string, unknown>[];
  counts?: ZohoPreviewCounts;
  summary?: ZohoPreviewCounts;
  cache?: ZohoCacheMeta;
}

export interface ZohoImportApiResponse {
  created?: number;
  productsCreated?: number;
  createdCount?: number;
  updated?: number;
  productsUpdated?: number;
  updatedCount?: number;
  createdBrands?: number;
  brandsCreated?: number;
  newBrands?: number;
  createdCategories?: number;
  categoriesCreated?: number;
  newCategories?: number;
  errors?: string[];
  message?: string;
}

export interface ZohoStockImportSheetProps {
  isOpen: boolean;
  onClose: () => void;
  onImportComplete: () => void;
}

type ImportStep = "idle" | "previewing" | "review" | "importing" | "success";
type PresetDays = 3 | 7 | 30 | 180 | 365;
type SyncWindow = { days: PresetDays } | { all: true } | { fromDate: string; toDate: string };
type SyncMode = "cache" | "delta" | "full";

const PRESET_CHIPS: ReadonlyArray<{ days: PresetDays; label: string }> = [
  { days: 3, label: "3 days" },
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 180, label: "6 months" },
  { days: 365, label: "1 year" },
];

function subtractCalendarDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) - (days - 1) * DAY_MS).toISOString().slice(0, 10);
}

function formatCacheTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

function normalizeProductItem(item: Record<string, unknown>, idx: number): ZohoProductItem {
  const zohoId = String(
    item.zohoId || item.id || item.itemId || item.item_id || item.sku || `item-${idx}`
  );
  const name = String(item.name || item.productName || item.item_name || "Unnamed Product");
  const sku = String(item.sku || item.itemCode || item.item_code || "—");

  const sellingPrice = Number(item.sellingPrice ?? item.rate ?? item.price ?? 0);
  const costPrice =
    item.costPrice !== undefined && item.costPrice !== null
      ? Number(item.costPrice)
      : item.purchaseRate !== undefined && item.purchaseRate !== null
      ? Number(item.purchaseRate)
      : item.cost !== undefined && item.cost !== null
      ? Number(item.cost)
      : undefined;

  const brandObj =
    item.brand && typeof item.brand === "object" ? (item.brand as { name?: string }) : null;
  const brandName =
    typeof item.brandName === "string"
      ? item.brandName
      : typeof item.brand === "string"
      ? item.brand
      : brandObj?.name || null;

  const brandIsNew = Boolean(
    item.brandIsNew === true ||
      item.brandStatus === "new" ||
      item.brandStatus === "create" ||
      item.isNewBrand === true
  );

  const catObj =
    item.category && typeof item.category === "object"
      ? (item.category as { name?: string })
      : null;
  const categoryName =
    typeof item.categoryName === "string"
      ? item.categoryName
      : typeof item.category === "string"
      ? item.category
      : catObj?.name || null;

  const categoryIsNew = Boolean(
    item.categoryIsNew === true ||
      item.categoryStatus === "new" ||
      item.categoryStatus === "create" ||
      item.isNewCategory === true
  );

  const status: "new" | "update" =
    item.status === "new" || item.isNew === true || item.status === "create"
      ? "new"
      : "update";

  const modifiedAt =
    typeof item.modifiedAt === "string"
      ? item.modifiedAt
      : typeof item.last_modified_time === "string"
      ? item.last_modified_time.slice(0, 10)
      : undefined;

  return {
    zohoId,
    name,
    sku,
    sellingPrice,
    costPrice,
    brandName,
    brandIsNew,
    categoryName,
    categoryIsNew,
    status,
    modifiedAt,
    raw: item,
  };
}

async function requestPreview(
  selectedRange: SyncWindow,
  syncMode: SyncMode
): Promise<
  | {
      ok: true;
      cache?: ZohoCacheMeta;
      normalized: ZohoProductItem[];
      summaryStats: {
        totalActive: number;
        newProducts: number;
        existingProducts: number;
        newBrands: number;
        newCategories: number;
      };
    }
  | { ok: false; error: string }
> {
  try {
    log.info("Fetching active products preview", { selectedRange, syncMode });
    const params = new URLSearchParams({ sync: syncMode });
    if ("all" in selectedRange) {
      params.set("all", "1");
    } else if ("days" in selectedRange) {
      params.set("days", String(selectedRange.days));
    } else {
      params.set("fromDate", selectedRange.fromDate);
      params.set("toDate", selectedRange.toDate);
    }

    const queryUrl = `/api/stock/zoho-preview?${params}`;
    let res = await apiTry<ZohoPreviewApiResponse>(queryUrl, { timeoutMs: 120_000 });

    if (res.error && (res.error.includes("405") || res.error.includes("Method Not Allowed"))) {
      log.warn("GET /api/stock/zoho-preview returned 405, attempting POST fallback");
      res = await apiTry<ZohoPreviewApiResponse>("/api/stock/zoho-preview", {
        method: "POST",
        json: { ...selectedRange, sync: syncMode },
        timeoutMs: 120_000,
      });
    }

    if (res.error || !res.data) {
      const errMsg = res.error || "Failed to fetch preview from Zoho.";
      const isDisconnected =
        errMsg.toLowerCase().includes("not connected") ||
        errMsg.toLowerCase().includes("disconnected") ||
        errMsg.toLowerCase().includes("integration") ||
        errMsg.toLowerCase().includes("credentials");

      const userFriendlyError = isDisconnected
        ? "Zoho Inventory is not connected. Please connect it in Settings > Integrations, then try again."
        : errMsg;

      log.error("Zoho stock preview error", { message: userFriendlyError });
      return { ok: false, error: userFriendlyError };
    }

    const data = res.data;
    const rawList =
      data.products || data.items || data.rows || (Array.isArray(data) ? data : []);
    const normalized = rawList.map((item, idx) =>
      normalizeProductItem(item as Record<string, unknown>, idx)
    );

    const counts = (data.counts || data.summary || {}) as Record<string, number | undefined>;
    const totalActive = counts.totalActive ?? counts.total ?? normalized.length;
    const newProducts =
      counts.newProducts ?? counts.new ?? normalized.filter((p) => p.status === "new").length;
    const existingProducts =
      counts.existingProducts ??
      counts.existing ??
      counts.update ??
      normalized.filter((p) => p.status === "update").length;

    const newBrandsSet = new Set(
      normalized.filter((p) => p.brandIsNew && p.brandName).map((p) => p.brandName)
    );
    const newCategoriesSet = new Set(
      normalized.filter((p) => p.categoryIsNew && p.categoryName).map((p) => p.categoryName)
    );

    const newBrands = counts.brandsToCreate ?? counts.newBrands ?? newBrandsSet.size;
    const newCategories =
      counts.categoriesToCreate ?? counts.newCategories ?? newCategoriesSet.size;

    return {
      ok: true,
      cache: data.cache,
      normalized,
      summaryStats: {
        totalActive,
        newProducts,
        existingProducts,
        newBrands,
        newCategories,
      },
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unexpected error during preview fetch";
    log.error("Zoho preview error", { message: msg });
    return { ok: false, error: msg };
  }
}

export function ZohoStockImportSheet({ isOpen, ...props }: ZohoStockImportSheetProps) {
  return isOpen ? <StockImportDialog {...props} /> : null;
}

function StockImportDialog({
  onClose,
  onImportComplete,
}: Omit<ZohoStockImportSheetProps, "isOpen">) {
  const [step, setStep] = useState<ImportStep>("previewing");
  const [range, setRange] = useState<SyncWindow>({ days: 7 });
  const [products, setProducts] = useState<ZohoProductItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [visibleLimit, setVisibleLimit] = useState(200);
  const [error, setError] = useState<string | null>(null);
  const [cacheInfo, setCacheInfo] = useState<ZohoCacheMeta | null>(null);
  const [syncModeInFlight, setSyncModeInFlight] = useState<SyncMode>("cache");
  const [importProgress, setImportProgress] = useState<{ done: number; total: number } | null>(null);

  const [summaryStats, setSummaryStats] = useState({
    totalActive: 0,
    newProducts: 0,
    existingProducts: 0,
    newBrands: 0,
    newCategories: 0,
  });

  const [importResult, setImportResult] = useState<{
    createdProducts: number;
    updatedProducts: number;
    createdBrands: number;
    createdCategories: number;
  } | null>(null);

  const today = getTodayIST();
  const custom = "fromDate" in range ? range : null;
  const rangeError = !custom
    ? null
    : !custom.fromDate || !custom.toDate
    ? "Choose both start and end dates."
    : custom.fromDate > custom.toDate
    ? "End date must be on or after start date."
    : custom.toDate > today
    ? "Choose today or an earlier end date."
    : null;

  const handleClose = useCallback(() => {
    if (step === "previewing" || step === "importing") return;
    onClose();
  }, [step, onClose]);

  const applyPreviewResult = useCallback(
    (result: Awaited<ReturnType<typeof requestPreview>>) => {
      if (!result.ok) {
        setError(result.error);
        setStep("idle");
        return;
      }
      if (result.cache) setCacheInfo(result.cache);
      setSummaryStats(result.summaryStats);
      setProducts(result.normalized);
      setSelectedIds(new Set(result.normalized.map((p) => p.zohoId)));
      setStep("review");
    },
    []
  );

  const fetchPreview = useCallback(
    async (selectedRange: SyncWindow, syncMode: SyncMode = "cache") => {
      setSyncModeInFlight(syncMode);
      setStep("previewing");
      setError(null);
      setProducts([]);
      setSelectedIds(new Set());
      setSearch("");
      setVisibleLimit(200);
      const result = await requestPreview(selectedRange, syncMode);
      applyPreviewResult(result);
    },
    [applyPreviewResult]
  );

  // Auto-load from local cache on open (0 Zoho API load when cache exists)
  useEffect(() => {
    let cancelled = false;
    requestPreview({ days: 7 }, "cache").then((result) => {
      if (!cancelled) applyPreviewResult(result);
    });
    return () => {
      cancelled = true;
    };
  }, [applyPreviewResult]);

  const selectRangeAndPreview = useCallback(
    (nextRange: SyncWindow) => {
      setRange(nextRange);
      if ("fromDate" in nextRange) {
        // Let user edit/apply dates cleanly without firing on partial range
        setProducts([]);
        setSelectedIds(new Set());
        setStep("idle");
        setError(null);
      } else {
        void fetchPreview(nextRange, "cache");
      }
    },
    [fetchPreview]
  );

  const toggleProduct = useCallback((zohoId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(zohoId)) next.delete(zohoId);
      else next.add(zohoId);
      return next;
    });
  }, []);

  const filteredProducts = useMemo(() => {
    if (!search.trim()) return products;
    const q = search.toLowerCase();
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        (p.brandName && p.brandName.toLowerCase().includes(q)) ||
        (p.categoryName && p.categoryName.toLowerCase().includes(q))
    );
  }, [products, search]);

  const displayedProducts = useMemo(
    () => filteredProducts.slice(0, visibleLimit),
    [filteredProducts, visibleLimit]
  );

  const allFilteredSelected = useMemo(() => {
    if (filteredProducts.length === 0) return false;
    return filteredProducts.every((p) => selectedIds.has(p.zohoId));
  }, [filteredProducts, selectedIds]);

  const toggleSelectAll = useCallback(() => {
    if (allFilteredSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const p of filteredProducts) next.delete(p.zohoId);
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const p of filteredProducts) next.add(p.zohoId);
        return next;
      });
    }
  }, [allFilteredSelected, filteredProducts]);

  const runImport = useCallback(async () => {
    const selectedItems = products.filter((p) => selectedIds.has(p.zohoId));
    if (selectedItems.length === 0) return;

    setStep("importing");
    setError(null);
    setImportProgress({ done: 0, total: selectedItems.length });

    try {
      log.info("Importing selected Zoho products", { count: selectedItems.length });

      const cleanItems = selectedItems.map((p) => ({
        zohoId: p.zohoId,
        sku: p.sku && p.sku !== "—" ? p.sku : undefined,
        name: p.name,
        brandName: p.brandName || undefined,
        categoryName: p.categoryName || undefined,
        costPrice: p.costPrice !== undefined ? Number(p.costPrice) : undefined,
        sellingPrice: p.sellingPrice !== undefined ? Number(p.sellingPrice) : undefined,
      }));

      let createdCount = 0;
      let updatedCount = 0;
      let brandsCount = 0;
      let categoriesCount = 0;

      for (let i = 0; i < cleanItems.length; i += IMPORT_BATCH_SIZE) {
        const chunk = cleanItems.slice(i, i + IMPORT_BATCH_SIZE);
        const res = await apiFetch<ZohoImportApiResponse>("/api/stock/zoho-import", {
          method: "POST",
          json: { items: chunk },
          timeoutMs: 180_000,
        });

        createdCount += res.created ?? res.productsCreated ?? res.createdCount ?? 0;
        updatedCount += res.updated ?? res.productsUpdated ?? res.updatedCount ?? 0;
        brandsCount += res.createdBrands ?? res.brandsCreated ?? res.newBrands ?? 0;
        categoriesCount +=
          res.createdCategories ?? res.categoriesCreated ?? res.newCategories ?? 0;

        setImportProgress({
          done: Math.min(i + chunk.length, cleanItems.length),
          total: cleanItems.length,
        });
      }

      setImportResult({
        createdProducts: createdCount,
        updatedProducts: updatedCount,
        createdBrands: brandsCount,
        createdCategories: categoriesCount,
      });

      setImportProgress(null);
      setStep("success");
      onImportComplete();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to import selected products";
      const isDisconnected =
        msg.toLowerCase().includes("not connected") ||
        msg.toLowerCase().includes("disconnected") ||
        msg.toLowerCase().includes("integration");

      const friendlyMsg = isDisconnected
        ? "Zoho Inventory is disconnected. Please re-check connection in Settings > Integrations."
        : msg;

      log.error("Zoho import error", { message: friendlyMsg });
      setImportProgress(null);
      setError(friendlyMsg);
      setStep("review");
    }
  }, [products, selectedIds, onImportComplete]);

  const busy = step === "previewing" || step === "importing";

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-xs sm:p-4 transition-opacity"
      onClick={handleClose}
      role="dialog"
      aria-modal="true"
      aria-label="Fetch Active Products from Zoho"
    >
      <div
        className="w-full sm:max-w-2xl bg-white rounded-t-2xl sm:rounded-2xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 shrink-0 bg-slate-50/70">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-blue-100 text-blue-700">
              <Cloud className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">Fetch from Zoho Inventory</h2>
              <p className="text-xs text-slate-500">
                Review and sync active products, brands, and categories
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            disabled={busy}
            aria-label="Close"
            className="rounded-lg p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 disabled:opacity-40 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
          {error && (
            <ErrorBanner
              message={error}
              type="error"
              onRetry={
                step === "idle" && !rangeError ? () => void fetchPreview(range, "cache") : undefined
              }
              onDismiss={() => setError(null)}
            />
          )}

          {/* Sync Window & Local Cache Controls */}
          {(step === "idle" || step === "review") && (
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-3">
              {/* Preset chips + All Active + Custom */}
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs font-semibold text-slate-700 mr-1">Sync window:</span>
                {PRESET_CHIPS.map(({ days, label }) => {
                  const active = "days" in range && range.days === days;
                  return (
                    <button
                      key={days}
                      type="button"
                      disabled={busy}
                      onClick={() => selectRangeAndPreview({ days })}
                      className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${
                        active
                          ? "bg-blue-600 text-white shadow-xs"
                          : "bg-white border border-slate-200 text-slate-700 hover:bg-slate-100"
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}

                <button
                  type="button"
                  disabled={busy}
                  onClick={() => selectRangeAndPreview({ all: true })}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${
                    "all" in range
                      ? "bg-blue-600 text-white shadow-xs"
                      : "bg-white border border-slate-200 text-slate-700 hover:bg-slate-100"
                  }`}
                >
                  All Active
                </button>

                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    selectRangeAndPreview({
                      fromDate: custom?.fromDate ?? subtractCalendarDays(today, 7),
                      toDate: custom?.toDate ?? today,
                    })
                  }
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${
                    custom
                      ? "bg-blue-600 text-white shadow-xs"
                      : "bg-white border border-slate-200 text-slate-700 hover:bg-slate-100"
                  }`}
                >
                  From → To
                </button>
              </div>

              {/* Custom Date Range inputs */}
              {custom && (
                <div className="space-y-2 pt-1">
                  <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2 items-end">
                    {(["fromDate", "toDate"] as const).map((field) => (
                      <label
                        key={field}
                        className="flex flex-col gap-1 text-[11px] font-medium text-slate-600"
                      >
                        {field === "fromDate" ? "From" : "To"}
                        <Input
                          type="date"
                          value={custom[field]}
                          min={field === "toDate" ? custom.fromDate || undefined : undefined}
                          max={field === "fromDate" ? custom.toDate || today : today}
                          disabled={busy}
                          onChange={(e) => {
                            const next = { ...custom, [field]: e.target.value };
                            setRange(next);
                            setProducts([]);
                            setSelectedIds(new Set());
                            setStep("idle");
                          }}
                          aria-describedby={rangeError ? "zoho-stock-date-error" : undefined}
                          className="h-11 sm:h-9 min-w-0 text-base sm:text-xs bg-white"
                        />
                      </label>
                    ))}
                    <Button
                      type="button"
                      disabled={busy || Boolean(rangeError)}
                      onClick={() => void fetchPreview(custom, "cache")}
                      className="h-11 sm:h-9 bg-blue-600 hover:bg-blue-700 text-white text-xs px-4"
                    >
                      Apply Dates
                    </Button>
                  </div>
                  {rangeError && (
                    <p id="zoho-stock-date-error" role="status" className="text-xs text-red-700">
                      {rangeError}
                    </p>
                  )}
                </div>
              )}

              {/* Local Cache status & sync actions */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200/80">
                <div className="flex items-center gap-1.5 text-[11px] text-slate-600">
                  <Database className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                  {cacheInfo ? (
                    <span>
                      <strong className="font-semibold text-slate-800">
                        Local Cache ({cacheInfo.totalItems.toLocaleString("en-IN")} items)
                      </strong>{" "}
                      · Updated {formatCacheTimestamp(cacheInfo.cachedAt)} ·{" "}
                      <span className="text-emerald-700 font-medium">
                        0 Zoho API load on filter
                      </span>
                    </span>
                  ) : (
                    <span>Local cache ready — sync from Zoho to refresh items.</span>
                  )}
                </div>

                <div className="flex items-center gap-1.5">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => void fetchPreview(range, "delta")}
                    className="h-7 px-2.5 text-[11px] bg-white gap-1 text-blue-700 border-blue-200 hover:bg-blue-50"
                  >
                    <RefreshCw className="h-3 w-3" />
                    Sync Latest (Delta)
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => void fetchPreview(range, "full")}
                    className="h-7 px-2.5 text-[11px] bg-white text-slate-700 border-slate-200 hover:bg-slate-100"
                  >
                    Full Rebuild
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Fetching Preview Loader */}
          {step === "previewing" && (
            <div className="py-14 flex flex-col items-center justify-center text-center space-y-3">
              <div className="relative flex items-center justify-center">
                <div className="h-12 w-12 rounded-full border-4 border-blue-100 border-t-blue-600 animate-spin" />
                <Cloud className="absolute h-5 w-5 text-blue-600" />
              </div>
              <p className="text-sm font-semibold text-slate-800">
                {syncModeInFlight === "full"
                  ? "Rebuilding full Zoho item cache..."
                  : syncModeInFlight === "delta"
                  ? "Syncing latest changes from Zoho..."
                  : "Loading products for selected window..."}
              </p>
              <p className="text-xs text-slate-400 max-w-sm">
                Matching active items with your local products, brands, and categories.
              </p>
            </div>
          )}

          {/* Importing Loader */}
          {step === "importing" && (
            <div className="py-14 flex flex-col items-center justify-center text-center space-y-3">
              <Loader2 className="h-10 w-10 text-blue-600 animate-spin" />
              <p className="text-sm font-semibold text-slate-800">
                {importProgress
                  ? `Importing ${importProgress.done.toLocaleString("en-IN")} of ${importProgress.total.toLocaleString("en-IN")} selected products...`
                  : `Importing ${selectedIds.size.toLocaleString("en-IN")} selected products...`}
              </p>
              <p className="text-xs text-slate-500 max-w-sm">
                Creating missing brands and categories and updating product records (including exact
                Zoho SKUs). Please wait.
              </p>
            </div>
          )}

          {/* STEP 2: Review Screen */}
          {step === "review" && (
            <div className="space-y-4">
              {/* Summary Statistics Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-center">
                  <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">
                    Active Found
                  </p>
                  <p className="text-lg font-bold text-slate-900 mt-0.5">
                    {summaryStats.totalActive.toLocaleString("en-IN")}
                  </p>
                </div>
                <div className="bg-emerald-50/70 border border-emerald-200 rounded-lg p-2.5 text-center">
                  <p className="text-[11px] font-medium text-emerald-700 uppercase tracking-wide">
                    New Products
                  </p>
                  <p className="text-lg font-bold text-emerald-800 mt-0.5">
                    {summaryStats.newProducts.toLocaleString("en-IN")}
                  </p>
                </div>
                <div className="bg-blue-50/70 border border-blue-200 rounded-lg p-2.5 text-center">
                  <p className="text-[11px] font-medium text-blue-700 uppercase tracking-wide">
                    To Update
                  </p>
                  <p className="text-lg font-bold text-blue-800 mt-0.5">
                    {summaryStats.existingProducts.toLocaleString("en-IN")}
                  </p>
                </div>
                <div className="bg-purple-50/70 border border-purple-200 rounded-lg p-2.5 text-center">
                  <p className="text-[11px] font-medium text-purple-700 uppercase tracking-wide">
                    New Brands
                  </p>
                  <p className="text-lg font-bold text-purple-800 mt-0.5">
                    {summaryStats.newBrands.toLocaleString("en-IN")}
                  </p>
                </div>
                <div className="col-span-2 sm:col-span-1 bg-amber-50/70 border border-amber-200 rounded-lg p-2.5 text-center">
                  <p className="text-[11px] font-medium text-amber-700 uppercase tracking-wide">
                    New Categories
                  </p>
                  <p className="text-lg font-bold text-amber-800 mt-0.5">
                    {summaryStats.newCategories.toLocaleString("en-IN")}
                  </p>
                </div>
              </div>

              {/* Filter & Selection Control Bar */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 pt-1">
                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                  <Input
                    placeholder="Search by name, SKU (e.g. 1387), brand, category..."
                    value={search}
                    onChange={(e) => {
                      setSearch(e.target.value);
                      setVisibleLimit(200);
                    }}
                    className="pl-8 text-xs h-9 sm:h-8"
                  />
                  {search && (
                    <button
                      type="button"
                      onClick={() => setSearch("")}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>

                <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0">
                  <span className="text-xs text-slate-500 font-medium">
                    {selectedIds.size} of {products.length} selected
                  </span>
                  <button
                    type="button"
                    onClick={toggleSelectAll}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-semibold text-blue-600 hover:bg-blue-50 transition-colors"
                  >
                    {allFilteredSelected ? (
                      <>
                        <CheckSquare className="h-3.5 w-3.5" />
                        Deselect All
                      </>
                    ) : (
                      <>
                        <Square className="h-3.5 w-3.5" />
                        Select All
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Scrollable list of product cards */}
              <div className="space-y-2 max-h-[44vh] overflow-y-auto pr-1">
                {filteredProducts.length === 0 ? (
                  <div className="py-8 text-center text-slate-400 text-xs bg-slate-50 rounded-xl border border-slate-200">
                    {products.length
                      ? "No products matched your search."
                      : "No active products were updated in this date range."}
                  </div>
                ) : (
                  <>
                    {displayedProducts.map((p) => {
                      const isSelected = selectedIds.has(p.zohoId);
                      return (
                        <div
                          key={p.zohoId}
                          onClick={() => toggleProduct(p.zohoId)}
                          className={`cursor-pointer rounded-xl border p-3 transition-all ${
                            isSelected
                              ? "border-blue-300 bg-blue-50/40 shadow-xs"
                              : "border-slate-200 bg-white hover:border-slate-300"
                          }`}
                        >
                          <div className="flex items-start gap-3">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleProduct(p.zohoId)}
                              onClick={(e) => e.stopPropagation()}
                              className="mt-1 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                            />

                            <div className="flex-1 min-w-0 space-y-1.5">
                              {/* Product Title and Badges */}
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <p className="text-xs font-bold text-slate-900 truncate">
                                    {p.name}
                                  </p>
                                  <p className="text-[11px] font-mono text-slate-500">
                                    SKU: {p.sku}
                                    {p.modifiedAt ? ` · Modified: ${p.modifiedAt}` : ""}
                                  </p>
                                </div>

                                <span
                                  className={`shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                                    p.status === "new"
                                      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                      : "bg-blue-50 text-blue-700 border-blue-200"
                                  }`}
                                >
                                  {p.status === "new" ? "New Product" : "Update"}
                                </span>
                              </div>

                              {/* Prices & Taxonomy row */}
                              <div className="flex flex-wrap items-center gap-2 pt-0.5 text-[11px]">
                                <span className="font-semibold text-slate-800 bg-slate-100 px-2 py-0.5 rounded">
                                  Selling: ₹{p.sellingPrice.toLocaleString("en-IN")}
                                </span>

                                {p.costPrice !== undefined && (
                                  <span className="text-slate-600 bg-slate-100 px-2 py-0.5 rounded">
                                    Cost: ₹{p.costPrice.toLocaleString("en-IN")}
                                  </span>
                                )}

                                {p.brandName ? (
                                  <span
                                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border ${
                                      p.brandIsNew
                                        ? "bg-purple-50 text-purple-700 border-purple-200 font-medium"
                                        : "bg-slate-100 text-slate-600 border-slate-200"
                                    }`}
                                  >
                                    <Tags className="h-3 w-3 shrink-0" />
                                    Brand: {p.brandName}
                                    {p.brandIsNew && (
                                      <span className="text-[9px] bg-purple-200/80 px-1 py-0.2 rounded font-semibold">
                                        New
                                      </span>
                                    )}
                                  </span>
                                ) : (
                                  <span className="text-slate-400 text-[10px]">No Brand</span>
                                )}

                                {p.categoryName ? (
                                  <span
                                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border ${
                                      p.categoryIsNew
                                        ? "bg-amber-50 text-amber-700 border-amber-200 font-medium"
                                        : "bg-slate-100 text-slate-600 border-slate-200"
                                    }`}
                                  >
                                    <Layers className="h-3 w-3 shrink-0" />
                                    Category: {p.categoryName}
                                    {p.categoryIsNew && (
                                      <span className="text-[9px] bg-amber-200/80 px-1 py-0.2 rounded font-semibold">
                                        New
                                      </span>
                                    )}
                                  </span>
                                ) : (
                                  <span className="text-slate-400 text-[10px]">No Category</span>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}

                    {filteredProducts.length > displayedProducts.length && (
                      <div className="pt-2 text-center">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setVisibleLimit((n) => n + 200)}
                          className="text-xs"
                        >
                          Show more ({filteredProducts.length - displayedProducts.length} remaining)
                        </Button>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}

          {/* STEP 3: Success Summary Screen */}
          {step === "success" && importResult && (
            <div className="py-6 space-y-6">
              <div className="flex flex-col items-center justify-center text-center space-y-2">
                <div className="h-12 w-12 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center">
                  <CheckCircle2 className="h-7 w-7" />
                </div>
                <h3 className="text-base font-bold text-slate-900">
                  Import Completed Successfully
                </h3>
                <p className="text-xs text-slate-500 max-w-sm">
                  The selected active products have been synced into your local stock catalog.
                </p>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50 border border-slate-200 rounded-xl p-4">
                <div className="text-center">
                  <p className="text-xs text-slate-500 font-medium">Products Created</p>
                  <p className="text-xl font-bold text-emerald-700 mt-1">
                    {importResult.createdProducts}
                  </p>
                </div>
                <div className="text-center">
                  <p className="text-xs text-slate-500 font-medium">Products Updated</p>
                  <p className="text-xl font-bold text-blue-700 mt-1">
                    {importResult.updatedProducts}
                  </p>
                </div>
                <div className="text-center">
                  <p className="text-xs text-slate-500 font-medium">Brands Created</p>
                  <p className="text-xl font-bold text-purple-700 mt-1">
                    {importResult.createdBrands}
                  </p>
                </div>
                <div className="text-center">
                  <p className="text-xs text-slate-500 font-medium">Categories Created</p>
                  <p className="text-xl font-bold text-amber-700 mt-1">
                    {importResult.createdCategories}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="border-t border-slate-200 px-4 sm:px-5 pt-3.5 pb-[max(0.875rem,env(safe-area-inset-bottom))] bg-slate-50/80 flex items-center justify-between shrink-0">
          {step === "review" && (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={handleClose}
                disabled={busy}
                className="text-xs h-11 sm:h-9"
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => void runImport()}
                disabled={busy || selectedIds.size === 0}
                className="bg-blue-600 hover:bg-blue-700 text-white text-xs h-11 sm:h-9 px-4 font-semibold shadow-xs"
              >
                Import Selected ({selectedIds.size})
              </Button>
            </>
          )}

          {step === "idle" && (
            <div className="w-full flex items-center justify-between gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={handleClose}
                className="h-11 sm:h-9 text-xs"
              >
                Close
              </Button>
              {custom && (
                <Button
                  type="button"
                  onClick={() => void fetchPreview(custom, "cache")}
                  disabled={Boolean(rangeError)}
                  className="h-11 sm:h-9 flex-1 sm:flex-none bg-blue-600 hover:bg-blue-700 text-white text-xs"
                >
                  <Cloud className="h-4 w-4 mr-1.5" /> Preview Active Products
                </Button>
              )}
            </div>
          )}

          {step === "success" && (
            <div className="w-full flex justify-end">
              <Button
                type="button"
                onClick={handleClose}
                className="bg-slate-900 hover:bg-slate-800 text-white text-xs h-11 sm:h-9 px-6 font-semibold"
              >
                Done
              </Button>
            </div>
          )}

          {busy && (
            <div className="w-full flex justify-center py-1">
              <span className="text-xs text-slate-500 flex items-center gap-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Working with Zoho Inventory...
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
