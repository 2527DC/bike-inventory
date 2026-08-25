"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Trash2 } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";

interface VendorOption { id: string; name: string; code: string; }
interface ProductOption { id: string; name: string; sku: string; costPrice: number; gstRate: number; }
interface POLineItem { productId: string; productName: string; sku: string; quantity: number; unitPrice: number; gstRate: number; }

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount);
}

export default function NewPurchaseOrderPage() {
  const router = useRouter();
  const [vendors, setVendors] = useState<VendorOption[]>([]);
  const [vendorId, setVendorId] = useState("");
  const [expectedDate, setExpectedDate] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<POLineItem[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // Product search
  const [productSearch, setProductSearch] = useState("");
  const [productResults, setProductResults] = useState<ProductOption[]>([]);

  useEffect(() => {
    fetch("/api/vendors?limit=100")
      .then((r) => r.json())
      .then((res) => { if (res.success) setVendors(res.data); })
      .catch(() => {});
  }, []);

  // Pick up pre-selected items from Reorder page
  useEffect(() => {
    const stored = sessionStorage.getItem("reorder-po-items");
    if (stored) {
      try {
        const poItems = JSON.parse(stored);
        setItems(poItems.map((item: { productId: string; name: string; sku: string; quantity: number; unitPrice: number }) => ({
          productId: item.productId,
          productName: item.name,
          sku: item.sku,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          gstRate: 0,
        })));
        sessionStorage.removeItem("reorder-po-items");
      } catch { /* ignore */ }
    }
  }, []);

  useEffect(() => {
    if (productSearch.length < 2) { setProductResults([]); return; }
    fetch(`/api/products/search?q=${encodeURIComponent(productSearch)}`)
      .then((r) => r.json())
      .then((res) => { if (res.success) setProductResults(res.data); })
      .catch(() => {});
  }, [productSearch]);

  function addItem(product: ProductOption) {
    if (items.find((i) => i.productId === product.id)) return;
    setItems([...items, {
      productId: product.id, productName: product.name, sku: product.sku,
      quantity: 1, unitPrice: product.costPrice, gstRate: product.gstRate,
    }]);
    setProductSearch("");
    setProductResults([]);
  }

  function updateItem(index: number, field: string, value: number) {
    setItems(items.map((item, i) => i === index ? { ...item, [field]: value } : item));
  }

  function removeItem(index: number) {
    setItems(items.filter((_, i) => i !== index));
  }

  const subtotal = items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0);
  const gstTotal = items.reduce((sum, i) => sum + i.quantity * i.unitPrice * (i.gstRate / 100), 0);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!vendorId || items.length === 0) return;

    setSubmitting(true);
    setError("");

    try {
      const res = await fetch("/api/purchase-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vendorId, expectedDate, notes,
          items: items.map(({ productId, quantity, unitPrice, gstRate }) => ({ productId, quantity, unitPrice, gstRate })),
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Failed to create PO");
      router.push("/purchase-orders");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <Link href="/purchase-orders" className="p-2 -ml-2 rounded-lg hover:bg-slate-100 focus-ring" aria-label="Back">
          <ArrowLeft className="h-5 w-5 text-slate-600" />
        </Link>
        <h1 className="text-lg font-bold text-slate-900 truncate">New Purchase Order</h1>
      </div>

      {error && <div className="bg-red-50 text-red-700 text-sm p-3 rounded-lg mb-4">{error}</div>}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Vendor *</label>
          <select
            value={vendorId}
            onChange={(e) => setVendorId(e.target.value)}
            className="flex h-10 min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
          >
            <option value="">Select vendor...</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>{v.name} ({v.code})</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Expected Delivery</label>
          <Input type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} className="min-h-[44px]" />
        </div>

        {/* Add Products */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Add Products *</label>
          <div className="relative">
            <Input
              placeholder="Search product by name or SKU..."
              value={productSearch}
              onChange={(e) => setProductSearch(e.target.value)}
              className="min-h-[44px]"
            />
            {productResults.length > 0 && (
              <div className="absolute top-full left-0 right-0 z-10 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                {productResults.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => addItem(p)}
                    className="w-full text-left px-3 py-2.5 hover:bg-slate-50 border-b border-slate-100 last:border-0"
                  >
                    <p className="text-sm font-medium text-slate-900">{p.name}</p>
                    <p className="text-xs text-slate-500">{p.sku} | Cost: {formatCurrency(p.costPrice)}</p>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Line Items */}
        {items.length > 0 && (
          <div className="space-y-2">
            {items.map((item, index) => (
              <Card key={item.productId}>
                <CardContent className="p-3">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <p className="text-sm font-medium text-slate-900">{item.productName}</p>
                      <p className="text-xs text-slate-500">{item.sku}</p>
                    </div>
                    <button type="button" onClick={() => removeItem(index)} className="p-1 text-red-400 hover:text-red-600">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 mb-0.5">Qty</label>
                      <Input
                        type="number"
                        inputMode="numeric"
                        value={item.quantity}
                        onChange={(e) => updateItem(index, "quantity", parseInt(e.target.value) || 0)}
                        min="1"
                        className="text-sm min-h-[44px] tabular-nums"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 mb-0.5">Unit Price</label>
                      <Input
                        type="number"
                        inputMode="decimal"
                        value={item.unitPrice}
                        onChange={(e) => updateItem(index, "unitPrice", parseFloat(e.target.value) || 0)}
                        className="text-sm min-h-[44px] tabular-nums"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 mb-0.5">GST %</label>
                      <Input
                        type="number"
                        inputMode="decimal"
                        value={item.gstRate}
                        onChange={(e) => updateItem(index, "gstRate", parseFloat(e.target.value) || 0)}
                        className="text-sm min-h-[44px] tabular-nums"
                      />
                    </div>
                  </div>
                  <p className="text-xs text-right text-slate-500 mt-1 tabular-nums">
                    Line: {formatCurrency(item.quantity * item.unitPrice * (1 + item.gstRate / 100))}
                  </p>
                </CardContent>
              </Card>
            ))}

            {/* Totals */}
            <Card className="bg-slate-50">
              <CardContent className="p-3 space-y-1">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">Subtotal</span>
                  <span className="text-slate-700 tabular-nums">{formatCurrency(subtotal)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">GST</span>
                  <span className="text-slate-700 tabular-nums">{formatCurrency(gstTotal)}</span>
                </div>
                <div className="flex justify-between text-sm font-bold border-t pt-1">
                  <span className="text-slate-900">Grand Total</span>
                  <span className="text-slate-900 tabular-nums">{formatCurrency(subtotal + gstTotal)}</span>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
          <textarea
            placeholder="Any notes for this PO..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="flex w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900"
          />
        </div>

        <div>
          <Button type="submit" size="lg" disabled={!vendorId || items.length === 0 || submitting} className="w-full min-h-[48px] bg-green-600 hover:bg-green-700 text-white">
            {submitting ? "Creating..." : "Create Purchase Order"}
          </Button>
          {(!vendorId || items.length === 0) && !submitting && (
            <p className="text-xs text-slate-500 mt-1.5 text-center">
              {!vendorId ? "Select a vendor to continue" : "Add at least one product to continue"}
            </p>
          )}
        </div>
      </form>
    </div>
  );
}
