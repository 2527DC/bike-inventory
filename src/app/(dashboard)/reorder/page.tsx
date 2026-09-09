"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Search, AlertTriangle, Package, ChevronDown, ChevronUp,
  Save, ShoppingCart, Share2, MessageSquare,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { SkeletonList } from "@/components/ui/skeleton";
import { FilterSheet } from "@/components/filter-sheet";
import { useDebounce } from "@/hooks/use-debounce";
import { isLowStock, suggestedOrderQty } from "@/lib/reorder";
import { usePermissions } from "@/lib/use-permissions";
import { ReorderSheet, type ReorderTarget } from "@/components/reorder-sheet";

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

export default function ReorderDashboardPage() {
  const router = useRouter();
  const [groups, setGroups] = useState<ProductGroup[]>([]);
  const [summary, setSummary] = useState<Summary>({ totalProducts: 0, lowStockCount: 0, zeroStockCount: 0 });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search);
  const [groupBy, setGroupBy] = useState<"brand" | "category" | "vendor">("brand");
  const [filter, setFilter] = useState("all");
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [reorderLevels, setReorderLevels] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");
  const [actionError, setActionError] = useState("");

  // This screen had no permission checks whatsoever before P10 — every action was shown to
  // anyone holding reorder.view. Both routes behind these buttons demand more than that.
  const { canCreate, canEdit } = usePermissions();
  const mayCreatePo = canCreate("purchase_orders");
  const mayEditReorder = canEdit("reorder");
  const [reorderTarget, setReorderTarget] = useState<ReorderTarget | null>(null);
  const [selectedForPO, setSelectedForPO] = useState<Set<string>>(new Set());

  const fetchData = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({ groupBy, filter });
    if (debouncedSearch) params.set("search", debouncedSearch);

    fetch(`/api/reorder?${params}`)
      .then((r) => r.json())
      .then((res) => {
        if (res.success) {
          setGroups(res.data.groups);
          setSummary(res.data.summary);
          // Brands collapsed by default — Abhi taps to expand
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [groupBy, filter, debouncedSearch]);

  useEffect(() => { fetchData(); }, [fetchData]);

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
      const res = await fetch("/api/reorder/update-levels", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      const data = await res.json();
      if (data.success) {
        setSavedMsg(`Updated ${data.data.updated} items`);
        setReorderLevels({});
        setTimeout(() => setSavedMsg(""), 2000);
        fetchData();
      }
    } catch (e) { setActionError(e instanceof Error ? e.message : "Save levels failed"); }
    finally { setSaving(false); }
  };

  const toggleSelectForPO = (productId: string) => {
    setSelectedForPO((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) next.delete(productId); else next.add(productId);
      return next;
    });
  };

  const selectAllLowStock = () => {
    const lowStockIds = groups.flatMap((g) =>
      g.products.filter(isLowStock).map((p) => p.id)
    );
    setSelectedForPO(new Set(lowStockIds));
  };

  const getSelectedProducts = () => {
    return groups.flatMap((g) => g.products.filter((p) => selectedForPO.has(p.id)));
  };

  /** Selected products with no vendor. The PO screen cannot group these, so they block it. */
  const unresolvedSelected = getSelectedProducts().filter((p) => !p.vendor);

  const createPOFromSelected = () => {
    const selected = getSelectedProducts();
    if (selected.length === 0) return;

    // Refused here rather than at the PO screen, because at that point the person has already
    // navigated away from the rows they would need to fix.
    if (unresolvedSelected.length > 0) {
      setActionError(
        `${unresolvedSelected.length} selected ${unresolvedSelected.length === 1 ? "product has" : "products have"} no vendor: ` +
          unresolvedSelected.slice(0, 4).map((p) => p.name).join(", ") +
          (unresolvedSelected.length > 4 ? ` and ${unresolvedSelected.length - 4} more` : "") +
          ". Set a reorder vendor on them, or link the brand to a vendor on the vendor's page."
      );
      return;
    }
    setActionError("");

    // Store in sessionStorage for the PO creation page to pick up
    // v2: ids and quantities, nothing else.
    //
    // v1 carried name, sku, unitPrice and brandName. Three of those were wrong or unused:
    // `brandName` was never read, `unitPrice` came from a costPrice the API withholds without
    // cost_price.view (so it arrived undefined and rendered ₹NaN), and the consumer hardcoded
    // `gstRate: 0` — which means every PO raised from this screen so far has carried 0% GST.
    // POST /api/purchase-orders/prepare now supplies price, GST and vendor server-side, under
    // the caller's own permissions.
    const payload = {
      v: 2 as const,
      items: selected.map((p) => ({ productId: p.id, quantity: suggestedOrderQty(p) })),
    };
    sessionStorage.setItem("reorder-po-items", JSON.stringify(payload));
    router.push("/purchase-orders/new");
  };

  const shareOnWhatsApp = () => {
    const selected = getSelectedProducts();
    if (selected.length === 0) return;

    // Group by brand for WhatsApp message
    const brandGroups: Record<string, ReorderProduct[]> = {};
    for (const p of selected) {
      if (!brandGroups[p.brand.name]) brandGroups[p.brand.name] = [];
      brandGroups[p.brand.name].push(p);
    }

    let message = "*Bharath Cycle Hub - Reorder List*\n";
    message += `Date: ${new Date().toLocaleDateString("en-IN")}\n\n`;

    for (const [brand, products] of Object.entries(brandGroups)) {
      message += `*${brand}*\n`;
      products.forEach((p, i) => {
        const qty = suggestedOrderQty(p);
        message += `${i + 1}. ${p.name} (${p.sku}) - Qty: ${qty}\n`;
      });
      message += "\n";
    }

    message += `Total Items: ${selected.length}\n`;
    message += `---\nGenerated from Inventory App`;

    const url = `https://wa.me/?text=${encodeURIComponent(message)}`;
    window.open(url, "_blank");
  };

  const shareGroupOnWhatsApp = (group: ProductGroup) => {
    const lowItems = group.products.filter(isLowStock);
    const items = lowItems.length > 0 ? lowItems : group.products;
    let message = `*Bharath Cycle Hub - Reorder*\n`;
    message += `*${group.name}*\nDate: ${new Date().toLocaleDateString("en-IN")}\n\n`;
    items.forEach((p, i) => {
      const qty = suggestedOrderQty(p);
      message += `${i + 1}. ${p.name} (${p.sku}) - Qty: ${qty}\n`;
    });
    message += `\nTotal: ${items.length} items\n---\nBharath Cycle Hub`;
    const phone = group.whatsappNumber || group.phone || "";
    const url = phone
      ? `https://api.whatsapp.com/send?phone=91${phone.replace(/\D/g, "").slice(-10)}&text=${encodeURIComponent(message)}`
      : `https://wa.me/?text=${encodeURIComponent(message)}`;
    window.open(url, "_blank");
  };

  const unsavedCount = Object.keys(reorderLevels).filter((k) => reorderLevels[k] !== "").length;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h1 className="text-lg font-bold text-slate-900">Reorder Dashboard</h1>
        {selectedForPO.size > 0 && (
          <Badge variant="info">{selectedForPO.size} selected</Badge>
        )}
      </div>

      <ReorderSheet
        open={reorderTarget !== null}
        product={reorderTarget}
        onClose={() => setReorderTarget(null)}
        // Refetch rather than patch: setting a vendor changes which GROUP the row belongs to
        // and what its resolution source is, and neither is derivable on the client.
        onSaved={() => { setReorderTarget(null); void fetchData(); }}
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
            defaultValue: "all",
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
      {(unsavedCount > 0 || selectedForPO.size > 0) && (
        <div className="flex gap-2 mb-3">
          {unsavedCount > 0 && (
            <button onClick={handleSaveLevels} disabled={saving}
              className="flex-1 flex items-center justify-center gap-1.5 bg-slate-900 text-white py-2 rounded-lg text-xs font-medium disabled:opacity-50">
              <Save className="h-3.5 w-3.5" />
              {saving ? "Saving..." : savedMsg || `Save Levels (${unsavedCount})`}
            </button>
          )}
          {selectedForPO.size > 0 && (
            <>
              {/* Gated on purchase_orders.create — this screen had NO permission checks at all
                  before P10, so anyone who could open it saw every action. */}
              {mayCreatePo && (
                <button onClick={createPOFromSelected}
                  className={`flex-1 flex items-center justify-center gap-1.5 text-white py-2 rounded-lg text-xs font-medium ${
                    unresolvedSelected.length > 0 ? "bg-slate-500" : "bg-blue-600"
                  }`}>
                  <ShoppingCart className="h-3.5 w-3.5" />
                  {unresolvedSelected.length > 0 ? `${unresolvedSelected.length} without a vendor` : "Create PO"}
                </button>
              )}
              <button onClick={shareOnWhatsApp}
                className="flex items-center justify-center gap-1.5 bg-green-600 text-white px-3 py-2 rounded-lg text-xs font-medium">
                <Share2 className="h-3.5 w-3.5" /> WhatsApp
              </button>
            </>
          )}
        </div>
      )}

      {/* Select All Low Stock */}
      {filter === "low" && summary.lowStockCount > 0 && (
        <button onClick={selectAllLowStock}
          className="w-full text-xs text-blue-600 font-medium py-1.5 mb-2 hover:underline">
          Select all {summary.lowStockCount} low-stock items for PO
        </button>
      )}

      {/* Product Groups */}
      {loading ? (
        <SkeletonList count={6} type="card" />
      ) : (
        <div className="space-y-2">
          {groups.map((group) => {
            const totalStock = group.products.reduce((s, p) => s + p.currentStock, 0);
            const zeroCount = group.products.filter((p) => p.currentStock === 0).length;
            return (
            <Card key={group.id}>
              {/* The header row is a DIV, not a button. The WhatsApp share inside it is its own
                  <button>, and a <button> inside a <button> is invalid HTML — React's
                  validateDOMNesting warned on every render of this list. So the expand/collapse
                  toggle is an absolutely-positioned overlay covering the row, and the share button
                  sits above it on z-10. Both stay real buttons; neither contains the other. */}
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
                {groupBy === "vendor" && group.id !== "unassigned" && (
                  <button onClick={() => shareGroupOnWhatsApp(group)}
                    className="relative z-10 p-1.5 bg-green-100 rounded-lg mr-1">
                    <MessageSquare className="h-3.5 w-3.5 text-green-600" />
                  </button>
                )}
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
                    const isSelected = selectedForPO.has(product.id);
                    const editedLevel = reorderLevels[product.id];

                    return (
                      <div key={product.id}
                        className={`p-2.5 rounded-lg border transition-colors ${
                          isSelected ? "border-blue-300 bg-blue-50" :
                          isZero ? "border-red-200 bg-red-50" :
                          isLow ? "border-amber-200 bg-amber-50" :
                          "border-slate-100"
                        }`}>
                        <div className="flex items-start justify-between mb-1.5">
                          <div className="flex-1 min-w-0 mr-2">
                            <button onClick={() => toggleSelectForPO(product.id)}
                              className="text-left">
                              <p className="text-sm font-medium text-slate-900">{product.name}</p>
                              <p className="text-[11px] text-slate-500 tabular-nums">{product.sku}</p>
                            </button>
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
                          <div className="shrink-0">
                            <label className="text-[11px] text-slate-400 block">Select</label>
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleSelectForPO(product.id)}
                              className="mt-1 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </CardContent>
              )}
            </Card>
          );
          })}

          {groups.length === 0 && !loading && (
            <div className="text-center py-12">
              <Package className="h-8 w-8 text-slate-300 mx-auto mb-2" />
              <p className="text-sm text-slate-400">
                {search ? "No products match your search" : "No products found"}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
