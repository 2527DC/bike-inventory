"use client";

import { useState, useEffect } from "react";
import {
  Search, AlertTriangle, Package, ChevronDown, ChevronUp,
  Save, SlidersHorizontal,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { SkeletonList } from "@/components/ui/skeleton";
import { ErrorBanner } from "@/components/ui/error-banner";
import { FilterSheet } from "@/components/filter-sheet";
import { useDebounce } from "@/hooks/use-debounce";
import { isLowStock } from "@/lib/reorder";
import { usePermissions } from "@/lib/use-permissions";
import { apiFetch, apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";
import { ReorderSheet, type ReorderTarget } from "@/components/reorder-sheet";

const log = createLogger("purchase-orders:reorder-tab");

interface ReorderProduct {
  id: string;
  sku: string;
  name: string;
  currentStock: number;
  reorderLevel: number;
  reorderQty: number;
  // OPTIONAL: api/reorder gates it on cost_price.view, so the key is genuinely absent for
  // some users. It was typed `number`, which is why the old handoff shipped `undefined` as a
  // price and the PO screen rendered ₹NaN.
  costPrice?: number;
  reorderVendorId?: string | null;
  vendor?: { id: string; name: string; source: string; sourceLabel: string } | null;
  unresolvedReason?: string | null;
  category: { id: string; name: string };
  brand: { id: string; name: string };
}

interface ProductGroup {
  id: string;
  name: string;
  whatsappNumber?: string | null;
  phone?: string | null;
  products: ReorderProduct[];
}

interface Summary {
  totalProducts: number;
  lowStockCount: number;
  zeroStockCount: number;
}

/**
 * The Reorder tab of /purchase-orders — the screen that was /reorder, moved inside Purchase
 * Orders (plan 1509-reorder-inside-purchase-orders, R7 / Q8). `/reorder` now redirects here.
 *
 * What changed in the move, and nothing else:
 * - It opens on **Low stock** (Q12): "All" loaded every active product in one request, and
 *   this tab is about what needs ordering.
 * - Every row ALSO gets the Reorder settings button `/stock` has, opening the same
 *   `ReorderSheet` (level, qty, vendor). The inline Reorder Level box and Save Levels stay as
 *   they were — the owner's answer to Q11 was "keep both".
 * - Loads through `apiTry` / `apiFetch` instead of raw `fetch().json()` with a bare catch
 *   (CLAUDE.md non-negotiables), and logs.
 *
 * Unchanged: `GET /api/reorder`, `PUT /api/reorder/update-levels`, grouping, the vendor shown on
 * each row.
 *
 * Removed 21 Sep 2026 (owner): the tick boxes, "Select all low-stock", **Create PO** and the
 * **WhatsApp** shares. This tab only SHOWS what needs reordering and lets its levels be set; a PO
 * is raised from **New PO**, whose "Add reorder items" lists the vendor's reorder products.
 */
export function ReorderTab() {
  const [groups, setGroups] = useState<ProductGroup[]>([]);
  const [summary, setSummary] = useState<Summary>({ totalProducts: 0, lowStockCount: 0, zeroStockCount: 0 });
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search);
  const [groupBy, setGroupBy] = useState<"brand" | "category" | "vendor">("brand");
  // Low by default (Q12 a).
  const [filter, setFilter] = useState("low");
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [reorderLevels, setReorderLevels] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");
  const [actionError, setActionError] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // This screen had no permission checks whatsoever before P10 — every action was shown to
  // anyone holding reorder.view. Both routes behind these buttons demand more than that.
  const { canEdit } = usePermissions();
  const mayEditReorder = canEdit("reorder");
  const [reorderTarget, setReorderTarget] = useState<ReorderTarget | null>(null);

  // `loading` is DERIVED from the request key (the purchase-orders list's pattern) rather than
  // set synchronously at the top of an effect.
  const params = new URLSearchParams({ groupBy, filter });
  if (debouncedSearch) params.set("search", debouncedSearch);
  const query = params.toString();
  const requestKey = `${query}#${reloadKey}`;
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const loading = loadedKey !== requestKey;

  useEffect(() => {
    let cancelled = false;
    apiTry<{ groups: ProductGroup[]; summary: Summary }>(`/api/reorder?${query}`).then(({ data, error }) => {
      if (cancelled) return;
      if (data) {
        setGroups(data.groups);
        setSummary(data.summary);
        setLoadError(null);
      } else {
        log.error("reorder list failed", { query, message: error });
        setLoadError(error ?? "Could not load the reorder list");
      }
      setLoadedKey(requestKey);
    });
    return () => {
      cancelled = true;
    };
  }, [query, requestKey]);

  const refetch = () => setReloadKey((k) => k + 1);

  const toggleGroup = (id: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const updateReorderLevel = (productId: string, value: string) => {
    setReorderLevels((prev) => ({ ...prev, [productId]: value }));
  };

  const handleSaveLevels = async () => {
    const items = Object.entries(reorderLevels)
      .filter(([, val]) => val !== "")
      .map(([id, val]) => ({ id, reorderLevel: parseInt(val, 10) }))
      .filter((i) => !isNaN(i.reorderLevel));

    if (items.length === 0) return;

    setSaving(true);
    try {
      const data = await apiFetch<{ updated: number }>("/api/reorder/update-levels", {
        method: "PUT",
        json: { items },
      });
      log.info("reorder levels saved from the tab", { count: data.updated });
      setSavedMsg(`Updated ${data.updated} items`);
      setReorderLevels({});
      setTimeout(() => setSavedMsg(""), 2000);
      refetch();
    } catch (e) {
      const message = e instanceof Error ? e.message : "Save levels failed";
      log.error("reorder levels save failed", { count: items.length, message });
      setActionError(message);
    } finally {
      setSaving(false);
    }
  };

  const unsavedCount = Object.keys(reorderLevels).filter((k) => reorderLevels[k] !== "").length;

  return (
    <div>
      <ReorderSheet
        open={reorderTarget !== null}
        product={reorderTarget}
        onClose={() => setReorderTarget(null)}
        // Refetch rather than patch: setting a vendor changes which GROUP the row belongs to
        // and what its resolution source is, and neither is derivable on the client. The sheet
        // and the inline box both write the level (Q11: keep both); a sheet save wins, so any
        // unsaved inline edit for that row is dropped rather than saved over it later.
        onSaved={(updated) => {
          setReorderLevels((prev) => {
            if (!(updated.id in prev)) return prev;
            const next = { ...prev };
            delete next[updated.id];
            return next;
          });
          setReorderTarget(null);
          refetch();
        }}
      />

      {actionError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-2.5 mb-3 text-xs text-red-700">
          {actionError}
          <button onClick={() => setActionError("")} className="ml-2 underline">dismiss</button>
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        <Card className={`cursor-pointer transition-colors ${filter === "all" ? "ring-1 ring-slate-300 bg-slate-50" : ""}`} onClick={() => setFilter("all")}>
          <CardContent className="p-2.5 text-center">
            <Package className="h-4 w-4 mx-auto text-slate-400 mb-1" />
            <p className="text-xl font-bold text-slate-900 tabular-nums">{summary.totalProducts}</p>
            <p className="text-[11px] text-slate-500">Total</p>
          </CardContent>
        </Card>
        <Card className={`cursor-pointer transition-colors ${filter === "low" ? "ring-1 ring-amber-300 bg-amber-50" : ""}`} onClick={() => setFilter("low")}>
          <CardContent className="p-2.5 text-center">
            <AlertTriangle className="h-4 w-4 mx-auto text-amber-500 mb-1" />
            <p className="text-xl font-bold text-amber-600 tabular-nums">{summary.lowStockCount}</p>
            <p className="text-[11px] text-slate-500">Low Stock</p>
          </CardContent>
        </Card>
        <Card className={`cursor-pointer transition-colors ${filter === "zero" ? "ring-1 ring-red-300 bg-red-50" : ""}`} onClick={() => setFilter("zero")}>
          <CardContent className="p-2.5 text-center">
            <AlertTriangle className="h-4 w-4 mx-auto text-red-500 mb-1" />
            <p className="text-xl font-bold text-red-600 tabular-nums">{summary.zeroStockCount}</p>
            <p className="text-[11px] text-slate-500">Zero Stock</p>
          </CardContent>
        </Card>
      </div>

      {/* Search */}
      <div className="relative mb-2">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <Input
          placeholder="Search product name or SKU..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Group By + Filter */}
      <div className="flex gap-2 mb-3">
        <div className="flex bg-slate-100 rounded-lg p-0.5 shrink-0">
          {(["brand", "category", "vendor"] as const).map((g) => (
            <button key={g} onClick={() => setGroupBy(g)}
              className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${groupBy === g ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}>
              {g === "brand" ? "Brand" : g === "category" ? "Category" : "Vendor"}
            </button>
          ))}
        </div>
        <FilterSheet
          className="flex-1 min-w-0"
          groups={[{
            label: "Stock Status",
            value: filter,
            defaultValue: "low",
            options: [
              { key: "all", label: "All" },
              { key: "low", label: "Low Stock" },
              { key: "zero", label: "Zero" },
            ],
            onChange: (key) => setFilter(key),
          }]}
        />
      </div>

      {/* Action Bar */}
      {unsavedCount > 0 && (
        <div className="flex gap-2 mb-3">
          {unsavedCount > 0 && (
            <button onClick={handleSaveLevels} disabled={saving}
              className="flex-1 flex items-center justify-center gap-1.5 bg-slate-900 text-white py-2 rounded-lg text-xs font-medium disabled:opacity-50">
              <Save className="h-3.5 w-3.5" />
              {saving ? "Saving..." : savedMsg || `Save Levels (${unsavedCount})`}
            </button>
          )}
        </div>
      )}

      {!loading && loadError && (
        <ErrorBanner message={loadError} onRetry={refetch} />
      )}

      {/* Product Groups */}
      {loading ? (
        <SkeletonList count={6} type="card" />
      ) : loadError ? null : (
        <div className="space-y-2">
          {groups.map((group) => {
            const totalStock = group.products.reduce((s, p) => s + p.currentStock, 0);
            const zeroCount = group.products.filter((p) => p.currentStock === 0).length;
            return (
            <Card key={group.id}>
              {/* The header row is a DIV with the expand/collapse toggle as an absolutely-positioned
                  overlay. It once held a WhatsApp share button (removed 21 Sep 2026), and a
                  <button> inside a <button> is invalid HTML; the overlay keeps it safe for anything
                  added to the row later. */}
              <div className="relative w-full flex items-center justify-between p-3 rounded-xl focus-within:ring-2 focus-within:ring-slate-900">
                <button onClick={() => toggleGroup(group.id)}
                  aria-label={group.name}
                  aria-expanded={expandedGroups.has(group.id)}
                  className="absolute inset-0 z-0 rounded-xl focus:outline-none" />
                <div className="flex-1 min-w-0 text-left">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-slate-900">{group.name}</span>
                    <Badge variant="default" className="text-[11px] tabular-nums">{group.products.length} items</Badge>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-0.5 tabular-nums">
                    Stock: {totalStock}
                    {zeroCount > 0 && <span className="text-red-500 ml-1">({zeroCount} at zero)</span>}
                  </p>
                </div>
                {expandedGroups.has(group.id) ? (
                  <ChevronUp className="h-4 w-4 text-slate-400" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-slate-400" />
                )}
              </div>

              {expandedGroups.has(group.id) && (
                <CardContent className="px-3 pb-3 pt-0 space-y-1.5">
                  {group.products.map((product) => {
                    const isLow = isLowStock(product);
                    const isZero = product.currentStock === 0;
                    const editedLevel = reorderLevels[product.id];

                    return (
                      <div key={product.id}
                        className={`p-2.5 rounded-lg border transition-colors ${
                          isZero ? "border-red-200 bg-red-50" :
                          isLow ? "border-amber-200 bg-amber-50" :
                          "border-slate-100"
                        }`}>
                        <div className="flex items-start justify-between mb-1.5">
                          <div className="flex-1 min-w-0 mr-2">
                            <p className="text-sm font-medium text-slate-900">{product.name}</p>
                            <p className="text-[11px] text-slate-500 tabular-nums">{product.sku}</p>
                            {/* The resolved vendor, on every row and in every grouping mode.
                                Before P10 the vendor was fetched on every request and rendered
                                only as a group header under groupBy=vendor — invisible the rest
                                of the time, which is why "why is this on the wrong PO?" had no
                                answer on screen. */}
                            {product.vendor ? (
                              <p className="text-[11px] text-slate-400 mt-0.5 truncate">
                                {product.vendor.name}
                                <span className="text-slate-300"> · {product.vendor.sourceLabel}</span>
                              </p>
                            ) : (
                              <button
                                type="button"
                                onClick={() => mayEditReorder && setReorderTarget(product)}
                                disabled={!mayEditReorder}
                                className="mt-0.5 text-[11px] text-amber-700 bg-amber-100 rounded px-1.5 py-0.5 min-h-[24px] disabled:opacity-60"
                                title={mayEditReorder ? "Set a reorder vendor" : "You do not have permission to set a reorder vendor"}
                              >
                                No vendor{mayEditReorder ? " · Set" : ""}
                              </button>
                            )}
                          </div>
                          <div className="text-right shrink-0">
                            <p className={`text-base font-bold tabular-nums ${isZero ? "text-red-600" : isLow ? "text-amber-600" : "text-slate-900"}`}>
                              {product.currentStock}
                            </p>
                            <p className="text-[11px] text-slate-400">in stock</p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <div className="flex-1">
                            <label className="text-[11px] text-slate-400">Reorder Level</label>
                            <input
                              type="number"
                              inputMode="numeric"
                              value={editedLevel ?? String(product.reorderLevel)}
                              onChange={(e) => updateReorderLevel(product.id, e.target.value)}
                              className="w-full rounded-md border border-slate-200 px-2 py-1 text-xs tabular-nums focus:outline-none focus:ring-1 focus:ring-slate-900"
                            />
                          </div>
                          <div className="shrink-0 text-right">
                            <label className="text-[11px] text-slate-400">Order Qty</label>
                            <p className="text-xs font-medium text-slate-700 py-1 tabular-nums">{product.reorderQty || "—"}</p>
                          </div>
                          {/* The same Reorder settings sheet as the /stock row button — level,
                              qty and vendor together (plan 1509-reorder-inside-purchase-orders,
                              Q11: kept beside the inline box, not instead of it). */}
                          {mayEditReorder && (
                            <div className="shrink-0">
                              <span className="text-[11px] text-slate-400 block">Edit</span>
                              <button
                                type="button"
                                onClick={() => setReorderTarget(product)}
                                aria-label={`Reorder settings for ${product.name}`}
                                title="Reorder level, quantity and vendor"
                                className="min-h-[44px] min-w-[44px] -my-2 flex items-center justify-center rounded-lg text-blue-600 hover:bg-blue-50 focus-ring"
                              >
                                <SlidersHorizontal className="h-4 w-4" />
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </CardContent>
              )}
            </Card>
          );
          })}

          {groups.length === 0 && (
            <div className="text-center py-12">
              <Package className="h-8 w-8 text-slate-300 mx-auto mb-2" />
              <p className="text-sm text-slate-400">
                {search
                  ? "No products match your search"
                  : filter === "low"
                  ? "Nothing is at or below its reorder level"
                  : "No products found"}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default ReorderTab;
