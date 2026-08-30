"use client";

import { useState, useEffect, useCallback } from "react";
import { usePermissions } from "@/lib/use-permissions";
import { useRouter } from "next/navigation";
import { Loader2, AlertTriangle, Check, Search, IndianRupee } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface PriceCheckItem {
  productId: string;
  productName: string;
  sku: string;
  binName: string | null;
  currentStock: number;
  appCostPrice: number;
  lastBillPrice: number | null;
  lastBillNo: string | null;
  lastBillDate: string | null;
  difference: number | null;
  totalImpact: number | null;
  isMismatch: boolean;
}

interface Summary {
  totalChecked: number;
  mismatchCount: number;
  totalImpact: number;
}

export default function PriceCorrectionPage() {
  const router = useRouter();
  const { canView, canEdit, loading: permsLoading } = usePermissions();

  const [items, setItems] = useState<PriceCheckItem[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [mismatchOnly, setMismatchOnly] = useState(true);
  const [search, setSearch] = useState("");

  // Inline editing state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (mismatchOnly) params.set("mismatchOnly", "true");
      const res = await fetch(`/api/stock/price-check?${params}`);
      const json = await res.json();
      if (json.success) {
        setItems(json.data.items);
        setSummary(json.data.summary);
      }
    } catch {
      // Silently handle fetch errors
    } finally {
      setLoading(false);
    }
  }, [mismatchOnly]);

  useEffect(() => {
    // Wait for the grants before deciding. Redirecting while permsLoading is true bounces
    // every user off the page on first paint, including those who may open it.
    if (permsLoading) return;
    if (!canView("stock")) {
      router.replace("/more");
      return;
    }
    fetchData();
  }, [permsLoading, canView, router, fetchData]);

  const handleSave = async (productId: string) => {
    const newPrice = parseFloat(editValue);
    if (isNaN(newPrice) || newPrice < 0) return;

    setSaving(productId);
    try {
      const res = await fetch(`/api/stock/price-check/${productId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newCostPrice: newPrice }),
      });
      const json = await res.json();
      if (json.success) {
        // Update local state
        setItems((prev) =>
          prev.map((item) =>
            item.productId === productId
              ? {
                  ...item,
                  appCostPrice: newPrice,
                  difference:
                    item.lastBillPrice !== null
                      ? Math.round((newPrice - item.lastBillPrice) * 100) / 100
                      : null,
                  totalImpact:
                    item.lastBillPrice !== null
                      ? Math.round(
                          (newPrice - item.lastBillPrice) *
                            item.currentStock *
                            100
                        ) / 100
                      : null,
                  isMismatch:
                    item.lastBillPrice !== null &&
                    Math.abs(newPrice - item.lastBillPrice) >= 0.01,
                }
              : item
          )
        );
        setEditingId(null);
        setEditValue("");
        // Refresh summary
        fetchData();
      }
    } catch {
      // Silently handle save errors
    } finally {
      setSaving(null);
    }
  };

  const filteredItems = search
    ? items.filter(
        (item) =>
          item.productName.toLowerCase().includes(search.toLowerCase()) ||
          item.sku.toLowerCase().includes(search.toLowerCase())
      )
    : items;

  if (permsLoading) return null;
  if (!canView("stock")) return null;

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold text-slate-900">Price Correction</h1>

      {/* Summary Card */}
      {summary && (
        <Card className={summary.mismatchCount > 0 ? "border-orange-300 bg-orange-50" : "border-green-300 bg-green-50"}>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              {summary.mismatchCount > 0 ? (
                <AlertTriangle className="h-5 w-5 text-orange-600" />
              ) : (
                <Check className="h-5 w-5 text-green-600" />
              )}
              <span className="font-semibold text-sm">
                {summary.mismatchCount > 0
                  ? `${summary.mismatchCount} items with price mismatch`
                  : "All prices match"}
              </span>
            </div>
            {summary.mismatchCount > 0 && (
              <p className="text-xs text-slate-600 ml-7">
                Total impact: <span className="font-bold text-orange-700">₹{summary.totalImpact.toLocaleString("en-IN")}</span>
              </p>
            )}
            <p className="text-xs text-slate-500 ml-7 mt-1">
              {summary.totalChecked} active items checked
            </p>
          </CardContent>
        </Card>
      )}

      {/* Controls */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input
            placeholder="Search by name or SKU..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9 text-sm"
          />
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
        <input
          type="checkbox"
          checked={mismatchOnly}
          onChange={(e) => setMismatchOnly(e.target.checked)}
          className="rounded border-slate-300"
        />
        Show mismatches only
      </label>

      {/* Loading */}
      {loading && (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
        </div>
      )}

      {/* Empty state */}
      {!loading && filteredItems.length === 0 && (
        <div className="text-center py-12">
          <IndianRupee className="h-10 w-10 text-slate-300 mx-auto mb-2" />
          <p className="text-sm text-slate-500">
            {mismatchOnly
              ? "No price mismatches found"
              : "No products with stock"}
          </p>
        </div>
      )}

      {/* Product List */}
      {!loading && (
        <div className="space-y-2">
          {filteredItems.map((item) => {
            const isEditing = editingId === item.productId;
            const isSaving = saving === item.productId;

            return (
              <Card
                key={item.productId}
                className={
                  item.isMismatch
                    ? "border-orange-300 border-l-4 border-l-orange-500"
                    : "border-slate-200"
                }
              >
                <CardContent className="p-3 space-y-2">
                  {/* Row 1: Name + SKU */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900 truncate">
                        {item.productName}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-slate-500">{item.sku}</span>
                        {item.binName && (
                          <Badge variant="default" className="text-[10px] px-1.5 py-0">
                            {item.binName}
                          </Badge>
                        )}
                      </div>
                    </div>
                    <Badge
                      variant="default"
                      className="shrink-0 text-xs"
                    >
                      Qty: {item.currentStock}
                    </Badge>
                  </div>

                  {/* Row 2: Prices */}
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <p className="text-slate-500">App Price</p>
                      <button
                        onClick={() => {
                          if (!isEditing) {
                            setEditingId(item.productId);
                            setEditValue(item.appCostPrice.toString());
                          }
                        }}
                        className="font-semibold text-slate-900 hover:text-blue-600 hover:underline transition-colors"
                      >
                        ₹{item.appCostPrice.toLocaleString("en-IN")}
                      </button>
                    </div>
                    <div>
                      <p className="text-slate-500">Bill Price</p>
                      <p className="font-semibold text-slate-900">
                        {item.lastBillPrice !== null
                          ? `₹${item.lastBillPrice.toLocaleString("en-IN")}`
                          : "—"}
                      </p>
                    </div>
                    <div>
                      <p className="text-slate-500">Difference</p>
                      <p
                        className={`font-semibold ${
                          item.isMismatch
                            ? item.difference! > 0
                              ? "text-red-600"
                              : "text-orange-600"
                            : "text-green-600"
                        }`}
                      >
                        {item.difference !== null
                          ? `${item.difference > 0 ? "+" : ""}₹${item.difference.toLocaleString("en-IN")}`
                          : "—"}
                      </p>
                    </div>
                  </div>

                  {/* Row 3: Impact + Bill ref */}
                  {item.isMismatch && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-500">
                        Impact: <span className="font-semibold text-orange-700">₹{Math.abs(item.totalImpact || 0).toLocaleString("en-IN")}</span>
                      </span>
                      {item.lastBillNo && (
                        <span className="text-slate-400 truncate ml-2">
                          Bill: {item.lastBillNo}
                          {item.lastBillDate && ` (${item.lastBillDate})`}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Inline Edit */}
                  {isEditing && (
                    <div className="flex items-center gap-2 pt-1 border-t border-slate-100">
                      <span className="text-xs text-slate-500 shrink-0">New price:</span>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        className="h-8 text-sm w-28"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleSave(item.productId);
                          if (e.key === "Escape") {
                            setEditingId(null);
                            setEditValue("");
                          }
                        }}
                      />
                      {/* Save is gated on stock.edit, matching
                          api/stock/price-check/[productId] which guards on
                          requireFeature("stock", "edit"). Seeing the mismatch list and
                          correcting a price are separate permissions. */}
                      <Button
                        size="sm"
                        className="h-8 px-3 text-xs"
                        onClick={() => handleSave(item.productId)}
                        disabled={isSaving || !editValue || !canEdit("stock")}
                      >
                        {isSaving ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          "Save"
                        )}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 px-2 text-xs"
                        onClick={() => {
                          setEditingId(null);
                          setEditValue("");
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
