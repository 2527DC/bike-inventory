"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Loader2, Search, QrCode, Printer, Minus, Plus, Trash2, X,
} from "lucide-react";
import { DataTable, type Column } from "@/components/desktop/data-table";
import { Badge } from "@/components/ui/badge";
import {
  type LabelTemplate, loadTemplate,
} from "@/lib/label-template";

interface Product {
  id: string;
  name: string;
  sku: string | null;
  mrp: number;
  sellingPrice: number;
  currentStock: number;
  brand: { name: string } | null;
  category: { name: string } | null;
}

interface QueueItem {
  product: Product;
  qty: number;
  editMrp: number;
  editPrice: number;
  barcodeImg: string;
}

function formatINR(n: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
}

export default function DesktopBarcodePage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [generating, setGenerating] = useState(false);
  const [template, setTemplate] = useState<LabelTemplate | null>(null);
  const searchTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    setTemplate(loadTemplate());
  }, []);

  const fetchProducts = useCallback((q: string) => {
    if (q.length < 2) { setProducts([]); return; }
    setLoading(true);
    fetch(`/api/products?search=${encodeURIComponent(q)}&limit=20&status=ACTIVE`)
      .then((r) => r.json())
      .then((res) => { if (res.success) setProducts(res.data || []); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleSearchChange = (val: string) => {
    setSearch(val);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => fetchProducts(val), 400);
  };

  const addToQueue = async (product: Product) => {
    // Check if already in queue
    if (queue.some((q) => q.product.id === product.id)) return;

    setGenerating(true);
    try {
      const res = await fetch("/api/barcode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: product.sku || product.id, type: "code128" }),
      });
      const data = await res.json();
      setQueue((prev) => [...prev, {
        product,
        qty: 1,
        editMrp: product.mrp,
        editPrice: product.sellingPrice,
        barcodeImg: data.image || "",
      }]);
    } catch {
      // Still add without barcode image
      setQueue((prev) => [...prev, {
        product,
        qty: 1,
        editMrp: product.mrp,
        editPrice: product.sellingPrice,
        barcodeImg: "",
      }]);
    }
    setGenerating(false);
  };

  const updateQueueItem = (idx: number, updates: Partial<QueueItem>) => {
    setQueue((prev) => prev.map((item, i) => i === idx ? { ...item, ...updates } : item));
  };

  const regenerateBarcode = async (idx: number) => {
    const item = queue[idx];
    try {
      const res = await fetch("/api/barcode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: item.product.sku || item.product.id, type: "code128" }),
      });
      const data = await res.json();
      updateQueueItem(idx, { barcodeImg: data.image || "" });
    } catch { /* */ }
  };

  const removeFromQueue = (idx: number) => {
    setQueue((prev) => prev.filter((_, i) => i !== idx));
  };

  const totalLabels = queue.reduce((sum, q) => sum + q.qty, 0);

  // ──── Print (uses hidden iframe to avoid popup blockers) ────
  const printFrameRef = useRef<HTMLIFrameElement | null>(null);

  const handlePrint = () => {
    if (queue.length === 0 || !template) return;

    // Create or reuse hidden iframe
    let iframe = printFrameRef.current;
    if (!iframe) {
      iframe = document.createElement("iframe");
      iframe.style.position = "fixed";
      iframe.style.top = "-10000px";
      iframe.style.left = "-10000px";
      iframe.style.width = "0";
      iframe.style.height = "0";
      iframe.style.border = "none";
      document.body.appendChild(iframe);
      printFrameRef.current = iframe;
    }

    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc) return;

    const w = template.width;
    const h = template.height;

    doc.open();
    doc.write(`<!DOCTYPE html><html><head><title>Print Labels</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Arial, sans-serif; margin: 0; }
  @page {
    size: ${w}mm ${h}mm;
    margin: 0;
  }
  .label { page-break-after: always; }
  .label:last-child { page-break-after: auto; }
  .row {
    width: ${w}mm;
    height: ${h}mm;
    display: flex;
    flex-direction: row;
    page-break-after: always;
  }
  .row:last-child { page-break-after: auto; }
  .label {
    width: 50mm;
    height: ${h}mm;
    padding: 1mm 2mm;
    background: white;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    text-align: center;
    gap: 0;
  }
  .label img {
    height: 8mm;
    object-fit: contain;
    display: block;
    margin: 0 auto;
  }
  .label p {
    line-height: 1.1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    margin: 0;
  }
  .sku { font-size: 2.2mm; font-weight: bold; font-family: monospace; }
  .mrp { font-size: 2mm; }
  .price { font-size: 2.6mm; font-weight: bold; }
</style></head><body></body></html>`);
    doc.close();

    const body = doc.body;

    // Build all individual labels first
    const allLabels: HTMLDivElement[] = [];
    for (const item of queue) {
      for (let c = 0; c < item.qty; c++) {
        const label = doc.createElement("div");
        label.className = "label";

        const skuP = doc.createElement("p");
        skuP.className = "sku";
        skuP.textContent = item.product.sku || "";
        label.appendChild(skuP);

        if (item.barcodeImg) {
          const img = doc.createElement("img");
          img.src = item.barcodeImg;
          img.alt = item.product.sku || "";
          label.appendChild(img);
        }

        const mrpP = doc.createElement("p");
        mrpP.className = "mrp";
        mrpP.textContent = `MRP: ₹${item.editMrp.toLocaleString("en-IN")}`;
        label.appendChild(mrpP);

        const priceP = doc.createElement("p");
        priceP.className = "price";
        priceP.textContent = `₹${item.editPrice.toLocaleString("en-IN")}`;
        label.appendChild(priceP);

        allLabels.push(label);
      }
    }

    // Pair labels into rows of 2 (two 50x25 labels per 100x25 sheet)
    for (let i = 0; i < allLabels.length; i += 2) {
      const row = doc.createElement("div");
      row.className = "row";
      row.appendChild(allLabels[i]);
      if (i + 1 < allLabels.length) {
        row.appendChild(allLabels[i + 1]);
      }
      body.appendChild(row);
    }

    // Print via iframe (no popup blocker issues)
    setTimeout(() => {
      iframe?.contentWindow?.focus();
      iframe?.contentWindow?.print();
    }, 400);
  };

  // ──── Search results columns ────
  const searchColumns: Column<Product>[] = [
    {
      key: "name",
      label: "Product",
      sortable: true,
      sortValue: (r) => r.name,
      render: (r) => (
        <div>
          <p className="font-medium text-slate-900 max-w-[300px] truncate">{r.name}</p>
          {r.sku && <p className="text-[11px] text-slate-400 font-mono">{r.sku}</p>}
        </div>
      ),
    },
    {
      key: "brand",
      label: "Brand",
      render: (r) => r.brand ? <span className="text-slate-600">{r.brand.name}</span> : <span className="text-slate-300">-</span>,
    },
    {
      key: "mrp",
      label: "MRP",
      className: "text-right",
      render: (r) => <span className="text-slate-700">{formatINR(r.mrp)}</span>,
    },
    {
      key: "price",
      label: "Offer Price",
      className: "text-right",
      render: (r) => <span className="font-medium text-green-700">{formatINR(r.sellingPrice)}</span>,
    },
    {
      key: "stock",
      label: "Stock",
      className: "text-center",
      render: (r) => (
        <span className={`font-semibold ${r.currentStock < 0 ? "text-red-600" : r.currentStock === 0 ? "text-slate-400" : "text-slate-900"}`}>
          {r.currentStock}
        </span>
      ),
    },
    {
      key: "action",
      label: "",
      className: "w-[80px]",
      render: (r) => {
        const inQueue = queue.some((q) => q.product.id === r.id);
        return inQueue ? (
          <Badge variant="success" className="text-[10px]">Added</Badge>
        ) : (
          <button
            onClick={(e) => { e.stopPropagation(); addToQueue(r); }}
            className="px-2.5 py-1 bg-slate-900 text-white text-xs font-medium rounded-md hover:bg-slate-800"
          >
            + Add
          </button>
        );
      },
    },
  ];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <QrCode className="h-5 w-5 text-slate-700" />
          <h1 className="text-xl font-bold text-slate-900">Barcode Labels</h1>
        </div>
        <div className="flex items-center gap-3">
          {queue.length > 0 && (
            <span className="text-sm text-slate-500">
              {queue.length} product{queue.length !== 1 ? "s" : ""}, {totalLabels} label{totalLabels !== 1 ? "s" : ""}
            </span>
          )}
          <button
            onClick={handlePrint}
            disabled={queue.length === 0}
            className="flex items-center gap-1.5 bg-slate-900 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-40 hover:bg-slate-800"
          >
            <Printer className="h-4 w-4" /> Print Labels
          </button>
        </div>
      </div>

      <div className="grid grid-cols-5 gap-6">
        {/* Left: Search & select products (3 cols) */}
        <div className="col-span-3 space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search by product name, SKU, or brand..."
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-300"
            />
            {search && (
              <button onClick={() => { setSearch(""); setProducts([]); }} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
            </div>
          ) : generating ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-slate-400 mr-2" />
              <span className="text-sm text-slate-500">Generating barcode...</span>
            </div>
          ) : products.length > 0 ? (
            <DataTable
              data={products}
              columns={searchColumns}
              keyExtractor={(r) => r.id}
              onRowClick={(r) => addToQueue(r)}
              emptyMessage="No products found"
              pageSize={10}
            />
          ) : search.length >= 2 ? (
            <div className="text-center py-12 bg-white rounded-xl border border-slate-200">
              <QrCode className="h-8 w-8 text-slate-300 mx-auto mb-2" />
              <p className="text-sm text-slate-400">No products found for &quot;{search}&quot;</p>
            </div>
          ) : (
            <div className="text-center py-12 bg-white rounded-xl border border-slate-200">
              <Search className="h-8 w-8 text-slate-300 mx-auto mb-2" />
              <p className="text-sm text-slate-500">Search for a product to generate barcode labels</p>
              <p className="text-xs text-slate-400 mt-1">Type at least 2 characters to search</p>
            </div>
          )}
        </div>

        {/* Right: Print queue (2 cols) */}
        <div className="col-span-2">
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden sticky top-6">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900">Print Queue</h2>
              {queue.length > 0 && (
                <button onClick={() => setQueue([])} className="text-xs text-red-500 hover:text-red-700">Clear all</button>
              )}
            </div>

            {queue.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <Printer className="h-6 w-6 text-slate-300 mx-auto mb-2" />
                <p className="text-xs text-slate-400">Add products from search to print barcode labels</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100 max-h-[calc(100vh-200px)] overflow-y-auto">
                {queue.map((item, idx) => (
                  <div key={item.product.id} className="px-4 py-3">
                    {/* Product info + remove */}
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1 min-w-0 mr-2">
                        <p className="text-sm font-medium text-slate-900 truncate">{item.product.name}</p>
                        <p className="text-[11px] text-slate-400 font-mono">{item.product.sku}</p>
                      </div>
                      <button onClick={() => removeFromQueue(idx)} className="text-slate-300 hover:text-red-500 p-0.5">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    {/* Label preview (matches print: SKU → barcode → MRP → offer price) */}
                    <div className="bg-white border border-slate-200 rounded-lg p-2 mb-2 text-center">
                      <p className="text-[10px] font-bold text-slate-700 font-mono">{item.product.sku}</p>
                      {item.barcodeImg && (
                        <div className="flex justify-center my-1">
                          <img src={item.barcodeImg} alt={item.product.sku || ""} className="max-h-[36px]" />
                        </div>
                      )}
                      <p className="text-[10px] text-slate-500">MRP: ₹{item.editMrp.toLocaleString("en-IN")}</p>
                      <p className="text-[11px] font-bold text-slate-900">₹{item.editPrice.toLocaleString("en-IN")}</p>
                    </div>

                    {/* Editable MRP & Offer Price */}
                    <div className="grid grid-cols-2 gap-2 mb-2">
                      <div>
                        <label className="text-[10px] text-slate-500 uppercase font-semibold">MRP</label>
                        <div className="flex items-center gap-1 mt-0.5">
                          <span className="text-xs text-slate-400">₹</span>
                          <input
                            type="number"
                            value={item.editMrp}
                            onChange={(e) => updateQueueItem(idx, { editMrp: Number(e.target.value) || 0 })}
                            className="w-full text-sm border border-slate-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-slate-300"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="text-[10px] text-slate-500 uppercase font-semibold">Offer Price</label>
                        <div className="flex items-center gap-1 mt-0.5">
                          <span className="text-xs text-slate-400">₹</span>
                          <input
                            type="number"
                            value={item.editPrice}
                            onChange={(e) => updateQueueItem(idx, { editPrice: Number(e.target.value) || 0 })}
                            className="w-full text-sm border border-slate-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-slate-300"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Quantity */}
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-slate-500 uppercase font-semibold">Labels</span>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => updateQueueItem(idx, { qty: Math.max(1, item.qty - 1) })}
                          className="p-1 rounded bg-slate-100 hover:bg-slate-200"
                        >
                          <Minus className="h-3 w-3" />
                        </button>
                        <input
                          type="number"
                          value={item.qty}
                          onChange={(e) => updateQueueItem(idx, { qty: Math.max(1, Number(e.target.value) || 1) })}
                          className="w-12 text-center text-sm border border-slate-200 rounded px-1 py-0.5 focus:outline-none"
                          min={1}
                        />
                        <button
                          onClick={() => updateQueueItem(idx, { qty: item.qty + 1 })}
                          className="p-1 rounded bg-slate-100 hover:bg-slate-200"
                        >
                          <Plus className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Print footer */}
            {queue.length > 0 && (
              <div className="px-4 py-3 border-t border-slate-200 bg-slate-50">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-slate-500">Total labels:</span>
                  <span className="text-sm font-bold text-slate-900">{totalLabels}</span>
                </div>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs text-slate-500">Label size:</span>
                  <span className="text-xs font-medium text-slate-700">
                    {template ? `${template.width} x ${template.height}mm` : "50 x 25mm"}
                  </span>
                </div>
                <button
                  onClick={handlePrint}
                  className="w-full flex items-center justify-center gap-2 bg-slate-900 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-slate-800"
                >
                  <Printer className="h-4 w-4" /> Print {totalLabels} Label{totalLabels !== 1 ? "s" : ""}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
