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
  Sparkles,
  Package,
  Layers,
  Tags,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ErrorBanner } from "@/components/ui/error-banner";
import { apiFetch, apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";

const log = createLogger("stock:zoho-import-sheet");

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
  newBrands?: number;
  newCategories?: number;
}

export interface ZohoPreviewApiResponse {
  products?: Record<string, unknown>[];
  items?: Record<string, unknown>[];
  rows?: Record<string, unknown>[];
  counts?: ZohoPreviewCounts;
  summary?: ZohoPreviewCounts;
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
type RangeDays = 3 | 7 | 30;

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
    raw: item,
  };
}

export function ZohoStockImportSheet({
  isOpen,
  onClose,
  onImportComplete,
}: ZohoStockImportSheetProps) {
  const [step, setStep] = useState<ImportStep>("idle");
  const [days, setDays] = useState<RangeDays>(7);
  const [products, setProducts] = useState<ZohoProductItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);

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

  // Reset internal state when sheet opens
  useEffect(() => {
    if (isOpen) {
      setStep("idle");
      setDays(7);
      setProducts([]);
      setSelectedIds(new Set());
      setSearch("");
      setError(null);
      setImportResult(null);
    }
  }, [isOpen]);

  const handleClose = useCallback(() => {
    if (step === "previewing" || step === "importing") return;
    onClose();
  }, [step, onClose]);

  const fetchPreview = useCallback(
    async (selectedRange: RangeDays) => {
      setStep("previewing");
      setError(null);
      setProducts([]);
      setSelectedIds(new Set());
      setSearch("");

      try {
        log.info("Fetching active products from Zoho", { days: selectedRange });
        const queryUrl = `/api/stock/zoho-preview?days=${selectedRange}`;

        // Attempt GET first
        let res = await apiTry<ZohoPreviewApiResponse>(queryUrl, { timeoutMs: 90_000 });

        // If GET returned 405 Method Not Allowed, fallback to POST with json payload
        if (res.error && (res.error.includes("405") || res.error.includes("Method Not Allowed"))) {
          log.warn("GET /api/stock/zoho-preview returned 405, attempting POST fallback", {
            days: selectedRange,
          });
          res = await apiTry<ZohoPreviewApiResponse>("/api/stock/zoho-preview", {
            method: "POST",
            json: { days: selectedRange },
            timeoutMs: 90_000,
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
          setError(userFriendlyError);
          setStep("idle");
          return;
        }

        const data = res.data;
        const rawList =
          data.products || data.items || data.rows || (Array.isArray(data) ? data : []);

        const normalized = rawList.map((item, idx) =>
          normalizeProductItem(item as Record<string, unknown>, idx)
        );

        // Derive summary counts
        const counts = (data.counts || data.summary || {}) as Record<string, number | undefined>;
        const totalActive =
          counts.totalActive ?? counts.total ?? normalized.length;
        const newProducts =
          counts.newProducts ??
          counts.new ??
          normalized.filter((p) => p.status === "new").length;
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
        const newCategories = counts.categoriesToCreate ?? counts.newCategories ?? newCategoriesSet.size;

        setSummaryStats({
          totalActive,
          newProducts,
          existingProducts,
          newBrands,
          newCategories,
        });

        setProducts(normalized);
        // By default select all active products
        setSelectedIds(new Set(normalized.map((p) => p.zohoId)));
        setStep("review");
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Unexpected error during preview fetch";
        log.error("Zoho preview error", { message: msg });
        setError(msg);
        setStep("idle");
      }
    },
    []
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

  const allFilteredSelected = useMemo(() => {
    if (filteredProducts.length === 0) return false;
    return filteredProducts.every((p) => selectedIds.has(p.zohoId));
  }, [filteredProducts, selectedIds]);

  const toggleSelectAll = useCallback(() => {
    if (allFilteredSelected) {
      // Deselect all currently filtered products
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const p of filteredProducts) {
          next.delete(p.zohoId);
        }
        return next;
      });
    } else {
      // Select all currently filtered products
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const p of filteredProducts) {
          next.add(p.zohoId);
        }
        return next;
      });
    }
  }, [allFilteredSelected, filteredProducts]);

  const runImport = useCallback(async () => {
    const selectedItems = products.filter((p) => selectedIds.has(p.zohoId));
    if (selectedItems.length === 0) return;

    setStep("importing");
    setError(null);

    try {
      log.info("Importing selected Zoho products", { count: selectedItems.length, days });

      const cleanItems = selectedItems.map((p) => ({
        zohoId: p.zohoId,
        sku: p.sku && p.sku !== "—" ? p.sku : undefined,
        name: p.name,
        brandName: p.brandName || undefined,
        categoryName: p.categoryName || undefined,
        costPrice: p.costPrice !== undefined ? Number(p.costPrice) : undefined,
        sellingPrice: p.sellingPrice !== undefined ? Number(p.sellingPrice) : undefined,
      }));

      const payload = {
        days,
        items: cleanItems,
        products: cleanItems,
        ids: selectedItems.map((p) => p.zohoId),
        itemIds: selectedItems.map((p) => p.zohoId),
      };

      const res = await apiFetch<ZohoImportApiResponse>("/api/stock/zoho-import", {
        method: "POST",
        json: payload,
        timeoutMs: 180_000,
      });

      const createdCount =
        res.created ??
        res.productsCreated ??
        res.createdCount ??
        selectedItems.filter((p) => p.status === "new").length;

      const updatedCount =
        res.updated ??
        res.productsUpdated ??
        res.updatedCount ??
        selectedItems.filter((p) => p.status === "update").length;

      const brandsCount =
        res.createdBrands ??
        res.brandsCreated ??
        res.newBrands ??
        new Set(selectedItems.filter((p) => p.brandIsNew && p.brandName).map((p) => p.brandName))
          .size;

      const categoriesCount =
        res.createdCategories ??
        res.categoriesCreated ??
        res.newCategories ??
        new Set(
          selectedItems.filter((p) => p.categoryIsNew && p.categoryName).map((p) => p.categoryName)
        ).size;

      setImportResult({
        createdProducts: createdCount,
        updatedProducts: updatedCount,
        createdBrands: brandsCount,
        createdCategories: categoriesCount,
      });

      setStep("success");
      // Notify parent to refresh products on /stock
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
      setError(friendlyMsg);
      setStep("review");
    }
  }, [products, selectedIds, days, onImportComplete]);

  if (!isOpen) return null;

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
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && (
            <ErrorBanner
              message={error}
              type="error"
              onRetry={step === "idle" ? () => void fetchPreview(days) : undefined}
              onDismiss={() => setError(null)}
            />
          )}

          {/* STEP 1: Range selector chips and preview button */}
          {(step === "idle" || step === "review") && (
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-slate-700">Sync window:</span>
                  <div className="flex items-center gap-1.5">
                    {([3, 7, 30] as const).map((d) => (
                      <button
                        key={d}
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          setDays(d);
                          if (step === "review") {
                            void fetchPreview(d);
                          }
                        }}
                        className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${
                          days === d
                            ? "bg-blue-600 text-white shadow-xs"
                            : "bg-white border border-slate-200 text-slate-700 hover:bg-slate-100"
                        }`}
                      >
                        {d} days
                      </button>
                    ))}
                  </div>
                </div>

                {step === "idle" && (
                  <Button
                    type="button"
                    onClick={() => void fetchPreview(days)}
                    disabled={busy}
                    className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs h-8 px-3.5"
                  >
                    <Cloud className="h-3.5 w-3.5" />
                    Preview Active Products
                  </Button>
                )}
              </div>

              {step === "idle" && (
                <p className="text-[11px] text-slate-500">
                  Retrieves active products modified within the selected window. Missing brands
                  and categories will be automatically identified.
                </p>
              )}
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
                Fetching active products from Zoho...
              </p>
              <p className="text-xs text-slate-400 max-w-sm">
                Scanning items updated in the last {days} days and matching local brands &
                categories.
              </p>
            </div>
          )}

          {/* Importing Loader */}
          {step === "importing" && (
            <div className="py-14 flex flex-col items-center justify-center text-center space-y-3">
              <Loader2 className="h-10 w-10 text-blue-600 animate-spin" />
              <p className="text-sm font-semibold text-slate-800">
                Importing {selectedIds.size} selected products...
              </p>
              <p className="text-xs text-slate-500 max-w-sm">
                Creating missing brands and categories, updating inventory levels, and saving
                product records. Please wait.
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
                    placeholder="Search by name, SKU, brand, category..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-8 text-xs h-8"
                  />
                  {search && (
                    <button
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
              <div className="space-y-2 max-h-[46vh] overflow-y-auto pr-1">
                {filteredProducts.length === 0 ? (
                  <div className="py-8 text-center text-slate-400 text-xs bg-slate-50 rounded-xl border border-slate-200">
                    No products matched your search.
                  </div>
                ) : (
                  filteredProducts.map((p) => {
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
                              {/* Price tags */}
                              <span className="font-semibold text-slate-800 bg-slate-100 px-2 py-0.5 rounded">
                                Selling: ₹{p.sellingPrice.toLocaleString("en-IN")}
                              </span>

                              {p.costPrice !== undefined && (
                                <span className="text-slate-600 bg-slate-100 px-2 py-0.5 rounded">
                                  Cost: ₹{p.costPrice.toLocaleString("en-IN")}
                                </span>
                              )}

                              {/* Brand badge */}
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

                              {/* Category badge */}
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
                  })
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

              {/* Counts Grid */}
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
        <div className="border-t border-slate-200 px-5 py-3.5 bg-slate-50/80 flex items-center justify-between shrink-0">
          {step === "review" && (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={handleClose}
                disabled={busy}
                className="text-xs h-9"
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => void runImport()}
                disabled={busy || selectedIds.size === 0}
                className="bg-blue-600 hover:bg-blue-700 text-white text-xs h-9 px-4 font-semibold shadow-xs"
              >
                Import Selected ({selectedIds.size})
              </Button>
            </>
          )}

          {step === "idle" && (
            <div className="w-full flex justify-end">
              <Button
                type="button"
                variant="outline"
                onClick={handleClose}
                className="text-xs h-9"
              >
                Close
              </Button>
            </div>
          )}

          {step === "success" && (
            <div className="w-full flex justify-end">
              <Button
                type="button"
                onClick={handleClose}
                className="bg-slate-900 hover:bg-slate-800 text-white text-xs h-9 px-6 font-semibold"
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
