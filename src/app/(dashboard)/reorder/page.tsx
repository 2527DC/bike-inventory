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
import { useDebounce } from "@/lib/utils";

interface ReorderProduct {
  id: string;
  sku: string;
  name: string;
  type: string;
  currentStock: number;
  reorderLevel: number;
  reorderQty: number;
  costPrice: number;
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
      g.products.filter((p) => p.reorderLevel > 0 && p.currentStock <= p.reorderLevel).map((p) => p.id)
    );
    setSelectedForPO(new Set(lowStockIds));
  };

  const getSelectedProducts = () => {
    return groups.flatMap((g) => g.products.filter((p) => selectedForPO.has(p.id)));
  };

  const createPOFromSelected = () => {
    // Group selected products by brand (for brand-wise PO)
    const selected = getSelectedProducts();
    if (selected.length === 0) return;

    // Store in sessionStorage for the PO creation page to pick up
    const poItems = selected.map((p) => ({
      productId: p.id,
      name: p.name,
      sku: p.sku,
      quantity: p.reorderQty || Math.max(1, p.reorderLevel - p.currentStock),
      unitPrice: p.costPrice,
      brandName: p.brand.name,
    }));
    sessionStorage.setItem("reorder-po-items", JSON.stringify(poItems));
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
        const qty = p.reorderQty || Math.max(1, p.reorderLevel - p.currentStock);
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
    const lowItems = group.products.filter((p) => p.reorderLevel > 0 && p.currentStock <= p.reorderLevel);
    const items = lowItems.length > 0 ? lowItems : group.products;
    let message = `*Bharath Cycle Hub - Reorder*\n`;
    message += `*${group.name}*\nDate: ${new Date().toLocaleDateString("en-IN")}\n\n`;
    items.forEach((p, i) => {
      const qty = p.reorderQty || Math.max(1, p.reorderLevel - p.currentStock);
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
              <button onClick={createPOFromSelected}
                className="flex-1 flex items-center justify-center gap-1.5 bg-blue-600 text-white py-2 rounded-lg text-xs font-medium">
                <ShoppingCart className="h-3.5 w-3.5" /> Create PO
              </button>
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
              <button onClick={() => toggleGroup(group.id)}
                className="w-full flex items-center justify-between p-3">
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
                  <button onClick={(e) => { e.stopPropagation(); shareGroupOnWhatsApp(group); }}
                    className="p-1.5 bg-green-100 rounded-lg mr-1">
                    <MessageSquare className="h-3.5 w-3.5 text-green-600" />
                  </button>
                )}
                {expandedGroups.has(group.id) ? (
                  <ChevronUp className="h-4 w-4 text-slate-400" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-slate-400" />
                )}
              </button>

              {expandedGroups.has(group.id) && (
                <CardContent className="px-3 pb-3 pt-0 space-y-1.5">
                  {group.products.map((product) => {
                    const isLow = product.reorderLevel > 0 && product.currentStock <= product.reorderLevel;
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
