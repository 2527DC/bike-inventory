"use client";

import { useState, useEffect, use } from "react";
import Link from "next/link";
import { ArrowLeft, AlertTriangle, Search, Package, ShoppingCart, Loader2, Share2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { apiTry } from "@/lib/api-client";
import { usePermissions } from "@/lib/use-permissions";
import { createLogger } from "@/lib/logger";

const log = createLogger("brand-stock:detail");

interface BrandStockItemData {
  id: string;
  rawSku: string | null;
  rawName: string;
  rawCategory: string | null;
  brandAvailableQty: number;
  brandPrice: number | null;
  brandMrp: number | null;
  rawSize: string | null;
  matchStatus: string;
  matchConfidence: number | null;
  productId: string | null;
  bchCurrentStock: number | null;
  bchReorderLevel: number | null;
  suggestedQty: number | null;
  orderQty: number | null;
  selected: boolean;
  product: {
    id: string; sku: string; name: string; currentStock: number; reservedStock: number;
    reorderLevel: number; costPrice: number; category: { name: string } | null;
  } | null;
}

interface UploadData {
  id: string;
  brandId: string;
  fileName: string;
  status: string;
  totalItems: number;
  matchedItems: number;
  unmatchedItems: number;
  createdAt: string;
  brand: { id: string; name: string; whatsappNumber: string | null; contactPhone: string | null };
  uploadedBy: { name: string };
  items: BrandStockItemData[];
}

const MATCH_BADGE: Record<string, { label: string; color: string }> = {
  AUTO_MATCHED: { label: "Auto", color: "bg-green-100 text-green-700" },
  FUZZY_MATCHED: { label: "Fuzzy", color: "bg-amber-100 text-amber-700" },
  MANUAL_MATCHED: { label: "Manual", color: "bg-blue-100 text-blue-700" },
  UNMATCHED: { label: "Unmatched", color: "bg-red-100 text-red-700" },
};

function fmt(val: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(val);
}

export default function BrandStockReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<UploadData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"ALL" | "MATCHED" | "UNMATCHED" | "SELECTED">("ALL");
  const [, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [actionError, setActionError] = useState("");
  const [skipped, setSkipped] = useState<Array<{ sku: string; name: string; reason: string }> | null>(null);
  const [generatedPo, setGeneratedPo] = useState<{ id: string; poNumber: string } | null>(null);
  const { canCreate } = usePermissions();
  const canCreatePo = canCreate("purchase_orders");

  // `apiTry`, not `fetch().then(r => r.json()).catch(() => {})`. This file already imported
  // apiTry for the PO call below, so the raw pair here was the odd one out — and it failed
  // the worst way: an expired session left `data` null and the page rendered its "not found"
  // state, telling the user the upload had been deleted.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: res, error: err } = await apiTry<UploadData>(`/api/brand-stock/uploads/${id}`);
      if (cancelled) return;
      if (err) {
        log.error("upload load failed", { uploadId: id, error: err });
        setLoadError(err);
      } else {
        setData(res);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [id]);

  const toggleSelect = (itemId: string) => {
    if (!data) return;
    setData({
      ...data,
      items: data.items.map((i) => i.id === itemId ? { ...i, selected: !i.selected } : i),
    });
  };

  const updateQty = (itemId: string, qty: number) => {
    if (!data) return;
    setData({
      ...data,
      items: data.items.map((i) => i.id === itemId ? { ...i, orderQty: qty, selected: qty > 0 } : i),
    });
  };

  /**
   * Returns whether the save succeeded, and that return value is load-bearing.
   *
   * `handleGeneratePO` awaits this first, and the old version could not fail visibly: the
   * bare `catch { setActionError(...) }` set a message the very next line then cleared with
   * `setActionError("")`, so a rejected save was erased and the PO was generated from
   * whatever the server still held — quantities the user believed they had changed. Now the
   * caller stops when this returns false.
   */
  const handleSave = async (): Promise<boolean> => {
    if (!data) return false;
    setSaving(true);
    const changedItems = data.items.filter((i) => i.selected || i.orderQty).map((i) => ({
      id: i.id,
      orderQty: i.orderQty || 0,
      selected: i.selected,
    }));
    const { error: err } = await apiTry(`/api/brand-stock/uploads/${id}/items`, {
      method: "PUT",
      json: { items: changedItems },
    });
    setSaving(false);
    if (err) {
      log.error("item save failed", { uploadId: id, items: changedItems.length, error: err });
      setActionError(err);
      return false;
    }
    log.debug("items saved", { uploadId: id, items: changedItems.length });
    return true;
  };

  const handleGeneratePO = async () => {
    if (!data) return;
    // Stop if the save failed. Continuing would raise the PO from the quantities the server
    // still holds while the screen shows the user's edited ones — a PO that silently
    // disagrees with what was on screen when the button was pressed.
    if (!(await handleSave())) return;
    setGenerating(true);
    setActionError("");
    setSkipped(null);

    // NOTE: this button returned HTTP 500 on every valid press until P9. The route passed an
    // `hsnCode` that PurchaseOrderItem does not have, so Prisma rejected the create before any
    // SQL ran. It is routed through the shared creator now.
    const { data: result, error, errorData, status } = await apiTry<{
      po: { id: string; poNumber: string };
      skipped: Array<{ sku: string; name: string; reason: string }>;
    }>(`/api/brand-stock/uploads/${id}/generate-po`, { method: "POST" });
    setGenerating(false);

    if (!result) {
      if (status === 409 && errorData && typeof errorData === "object" && "conflicts" in errorData) {
        // The duplicate rule fires here more than anywhere else — re-ordering a brand sheet is
        // exactly the thing it exists to catch. Name the POs rather than printing one sentence.
        const conflicts = (errorData as { conflicts: Array<{ poNumber: string; productNames: string[] }> }).conflicts;
        setActionError(
          `Already on ${conflicts.map((c) => c.poNumber).join(", ")}: ` +
            conflicts.flatMap((c) => c.productNames).slice(0, 6).join(", ") +
            (conflicts.flatMap((c) => c.productNames).length > 6 ? " and more" : "")
        );
        return;
      }
      setActionError(error ?? "PO generation failed");
      return;
    }

    // Rows with no price are left OFF the order rather than failing the whole sheet (owner,
    // 6 Sep). Saying so is the point — a silently shorter PO is worse than a refusal.
    if (result.skipped.length > 0) {
      setSkipped(result.skipped);
      setGeneratedPo(result.po);
      return;
    }

    window.location.href = `/purchase-orders/${result.po.id}`;
  };

  const handleShareWhatsApp = () => {
    if (!data) return;
    const selected = data.items.filter((i) => i.selected && (i.orderQty || 0) > 0);
    if (selected.length === 0) { setActionError("Select items first"); return; }

    const groups: Record<string, BrandStockItemData[]> = {};
    for (const item of selected) {
      const cat = item.product?.category?.name || item.rawCategory || "General";
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(item);
    }

    let msg = `*Bharath Cycle Hub — Order*\n*To: ${data.brand.name}*\nDate: ${new Date().toLocaleDateString("en-IN")}\n\n`;
    let totalItems = 0;
    let totalValue = 0;

    for (const [cat, items] of Object.entries(groups)) {
      msg += `*${cat}*\n`;
      items.forEach((item, i) => {
        const price = item.brandPrice || item.product?.costPrice || 0;
        const qty = item.orderQty || 0;
        msg += `${i + 1}. ${item.product?.name || item.rawName}`;
        if (item.product?.sku) msg += ` (${item.product.sku})`;
        msg += ` — Qty: ${qty}`;
        if (price > 0) msg += ` @ ${fmt(price)}`;
        msg += `\n`;
        totalItems += qty;
        totalValue += qty * price;
      });
      msg += `\n`;
    }
    msg += `*Total: ${totalItems} items, ${fmt(totalValue)}*\n\n— Bharath Cycle Hub`;

    const phone = data.brand.whatsappNumber || data.brand.contactPhone || "";
    const cleanPhone = phone.replace(/[^0-9]/g, "");
    window.open(`https://wa.me/${cleanPhone.startsWith("91") ? cleanPhone : "91" + cleanPhone}?text=${encodeURIComponent(msg)}`, "_blank");
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-6 w-6 border-2 border-slate-900 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // A failed REQUEST and a missing ROW are different answers and now say so. Both used to
  // land on "Upload not found", so an expired session or a 403 read as deleted data.
  if (loadError) {
    return (
      <div className="text-center py-12">
        <p className="text-sm font-medium text-red-700">Could not load this upload</p>
        <p className="text-xs text-red-600 mt-1">{loadError}</p>
        <Link href="/brand-stock" className="text-blue-600 text-sm mt-3 inline-block">Back</Link>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center py-12">
        <p className="text-slate-500">Upload not found</p>
        <Link href="/brand-stock" className="text-blue-600 text-sm mt-2 inline-block">Back</Link>
      </div>
    );
  }

  const filtered = data.items.filter((i) => {
    if (filter === "MATCHED" && i.matchStatus === "UNMATCHED") return false;
    if (filter === "UNMATCHED" && i.matchStatus !== "UNMATCHED") return false;
    if (filter === "SELECTED" && !i.selected) return false;
    if (search) {
      const q = search.toLowerCase();
      return i.rawName.toLowerCase().includes(q) || (i.rawSku || "").toLowerCase().includes(q) || (i.product?.name || "").toLowerCase().includes(q);
    }
    return true;
  });

  const selectedItems = data.items.filter((i) => i.selected && (i.orderQty || 0) > 0);
  const totalOrderQty = selectedItems.reduce((s, i) => s + (i.orderQty || 0), 0);
  const totalOrderValue = selectedItems.reduce((s, i) => s + (i.orderQty || 0) * (i.brandPrice || i.product?.costPrice || 0), 0);

  // Group by category
  const groups: Record<string, BrandStockItemData[]> = {};
  for (const item of filtered) {
    const cat = item.product?.category?.name || item.rawCategory || "Uncategorized";
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(item);
  }

  return (
    <div className="pb-36">
      <div className="flex items-center gap-3 mb-3">
        <Link href="/brand-stock" className="p-1"><ArrowLeft className="h-5 w-5 text-slate-600" /></Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-bold text-slate-900 truncate">{data.brand.name} Stock</h1>
          <p className="text-[10px] text-slate-500">{data.fileName} · {new Date(data.createdAt).toLocaleDateString("en-IN")}</p>
        </div>
      </div>

      {/* The PO was created; some rows were left off it. Shown instead of navigating away,

          because a buyer who does not learn what was skipped will assume it was all ordered. */}

      {skipped && generatedPo && (

        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-3">

          <p className="text-sm font-semibold text-amber-900">

            {generatedPo.poNumber} created — {skipped.length}{" "}

            {skipped.length === 1 ? "row was" : "rows were"} left off

          </p>

          <p className="text-xs text-amber-700 mt-1">

            No price on the sheet and no cost price on the product. Set a price and run it again

            to order these.

          </p>

          <ul className="mt-2 space-y-0.5">

            {skipped.slice(0, 8).map((r) => (

              <li key={r.sku} className="text-xs text-amber-800 break-words">

                {r.sku} — {r.name}

              </li>

            ))}

            {skipped.length > 8 && (

              <li className="text-xs text-amber-600">and {skipped.length - 8} more</li>

            )}

          </ul>

          <div className="flex flex-wrap gap-2 mt-3">

            <a href={`/purchase-orders/${generatedPo.id}`} className="min-h-[44px] px-3 flex items-center rounded-lg bg-amber-600 text-white text-xs font-medium">

              Open {generatedPo.poNumber}

            </a>

            <button type="button" onClick={() => { setSkipped(null); setGeneratedPo(null); }} className="min-h-[44px] px-3 rounded-lg border border-amber-300 text-amber-800 text-xs font-medium">

              Stay here

            </button>

          </div>

        </div>

      )}


      {actionError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-2.5 mb-3 text-xs text-red-700">
          {actionError}<button onClick={() => setActionError("")} className="ml-2 underline">dismiss</button>
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-2 mb-3">
        <Card><CardContent className="p-2 text-center">
          <p className="text-lg font-bold text-slate-900">{data.totalItems}</p>
          <p className="text-[9px] text-slate-500">Total</p>
        </CardContent></Card>
        <Card className="border-green-200"><CardContent className="p-2 text-center">
          <p className="text-lg font-bold text-green-600">{data.matchedItems}</p>
          <p className="text-[9px] text-slate-500">Matched</p>
        </CardContent></Card>
        <Card className={data.unmatchedItems > 0 ? "border-amber-200" : ""}><CardContent className="p-2 text-center">
          <p className={`text-lg font-bold ${data.unmatchedItems > 0 ? "text-amber-600" : "text-slate-400"}`}>{data.unmatchedItems}</p>
          <p className="text-[9px] text-slate-500">Unmatched</p>
        </CardContent></Card>
        <Card className="border-blue-200"><CardContent className="p-2 text-center">
          <p className="text-lg font-bold text-blue-600">{selectedItems.length}</p>
          <p className="text-[9px] text-slate-500">To Order</p>
        </CardContent></Card>
      </div>

      {/* Search */}
      <div className="relative mb-2">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <Input placeholder="Search items..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
      </div>

      {/* Filters */}
      <div className="flex gap-2 overflow-x-auto mb-3 pb-1">
        {(["ALL", "MATCHED", "UNMATCHED", "SELECTED"] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${filter === f ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"}`}>
            {f === "ALL" ? "All" : f.charAt(0) + f.slice(1).toLowerCase()}
          </button>
        ))}
      </div>

      {/* Category Groups */}
      {Object.entries(groups).sort(([a], [b]) => a.localeCompare(b)).map(([cat, items]) => (
        <div key={cat} className="mb-4">
          <div className="flex items-center gap-2 mb-1.5">
            <Package className="h-3.5 w-3.5 text-slate-400" />
            <h3 className="text-xs font-semibold text-slate-700 uppercase tracking-wide">{cat}</h3>
            <span className="text-[10px] text-slate-400">{items.length}</span>
          </div>
          <div className="space-y-1.5">
            {items.map((item) => {
              const badge = MATCH_BADGE[item.matchStatus] || MATCH_BADGE.UNMATCHED;
              const available = item.product ? item.product.currentStock - item.product.reservedStock : null;
              const needsReorder = available !== null && item.bchReorderLevel !== null && available <= item.bchReorderLevel;

              return (
                <Card key={item.id} className={`${item.selected ? "border-blue-300 bg-blue-50/30" : ""} ${needsReorder ? "border-l-4 border-l-red-400" : ""}`}>
                  <CardContent className="p-2.5">
                    <div className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        checked={item.selected}
                        onChange={() => toggleSelect(item.id)}
                        className="mt-1 rounded"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <p className="text-xs font-medium text-slate-900 truncate">{item.rawName}</p>
                          <Badge className={`text-[9px] px-1 py-0 ${badge.color}`}>{badge.label}</Badge>
                        </div>

                        {item.rawSku && <p className="text-[10px] text-slate-400">Brand SKU: {item.rawSku}</p>}

                        <div className="flex items-center gap-3 mt-1 text-[10px]">
                          <span className="text-blue-600">Brand has: <strong>{item.brandAvailableQty}</strong></span>
                          {item.brandPrice && <span className="text-slate-500">{fmt(item.brandPrice)}</span>}
                        </div>

                        {item.product && (
                          <div className="flex items-center gap-3 mt-0.5 text-[10px]">
                            <span className="text-slate-600">→ {item.product.name} ({item.product.sku})</span>
                          </div>
                        )}
                        {item.product && (
                          <div className="flex items-center gap-3 mt-0.5 text-[10px]">
                            <span className={`${needsReorder ? "text-red-600 font-medium" : "text-slate-500"}`}>
                              BCH: {available} avail
                            </span>
                            <span className="text-slate-400">Reorder: {item.bchReorderLevel || 0}</span>
                            {item.suggestedQty !== null && item.suggestedQty > 0 && (
                              <span className="text-orange-600">Need: {item.suggestedQty}</span>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Order Qty Input */}
                      <div className="shrink-0 w-16">
                        <input
                          type="number"
                          min="0"
                          value={item.orderQty || ""}
                          onChange={(e) => updateQty(item.id, parseInt(e.target.value) || 0)}
                          placeholder="Qty"
                          className="w-full text-center text-sm font-medium border border-slate-300 rounded-lg py-1.5 focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      ))}

      {filtered.length === 0 && (
        <div className="text-center py-8">
          <AlertTriangle className="h-6 w-6 text-slate-300 mx-auto mb-2" />
          <p className="text-sm text-slate-400">No items match your filter</p>
        </div>
      )}

      {/* Sticky Bottom Bar */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 p-3 z-50 max-w-screen-sm lg:max-w-none mx-auto">
        <div className="flex items-center justify-between mb-2">
          <div>
            <p className="text-xs text-slate-600"><strong>{selectedItems.length}</strong> items · <strong>{totalOrderQty}</strong> qty</p>
            <p className="text-sm font-bold text-slate-900">{fmt(totalOrderValue)}</p>
          </div>
          <div className="flex gap-2">
            <button onClick={handleShareWhatsApp} disabled={selectedItems.length === 0}
              className="p-2.5 rounded-lg bg-green-600 text-white disabled:opacity-50">
              <Share2 className="h-4 w-4" />
            </button>
            {/* Mirrors the route's TWO gates: `brand_stock.view` opened this page, and
                `purchase_orders.create` is what actually writes the order. Shown-but-DISABLED
                rather than hidden, which is the pattern P9 settled on for /purchase-orders —
                a missing button reads as a broken screen, a disabled one with a reason reads
                as a permission. */}
            <button onClick={handleGeneratePO}
              disabled={selectedItems.length === 0 || generating || !canCreatePo}
              title={canCreatePo ? undefined : "Needs Purchase Orders › Create"}
              className="flex items-center gap-1.5 bg-slate-900 text-white px-4 py-2.5 rounded-lg text-sm font-medium disabled:opacity-50">
              {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShoppingCart className="h-4 w-4" />}
              Create PO
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
