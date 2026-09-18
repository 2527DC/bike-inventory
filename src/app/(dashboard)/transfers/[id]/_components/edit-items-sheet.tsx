"use client";

import { useEffect, useState } from "react";
import { Loader2, Search, Trash2, X, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/error-banner";
import { apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";

const log = createLogger("transfers:edit-items");

/**
 * Fix the lines of a RETURNED transfer, then close (plan 1709, R25, Q36).
 *
 * Shown only when the server put `edit` in `actions[]` — the route re-checks, and refuses
 * anything that is not RETURNED, so this sheet cannot be reached around.
 *
 * Lines are REPLACED, not patched: what is on screen when Save is pressed is what the order
 * will hold. That is why removing a line and adding a different product both work here with no
 * per-line endpoints, and why the server re-runs the same source-stock check the create form
 * applies — an approver who sent the order back because a quantity was impossible must not be
 * able to receive it back unchanged.
 */

interface Line {
  productId: string;
  name: string;
  sku: string;
  quantity: number;
}

interface ProductResult {
  id: string;
  name: string;
  sku: string;
  currentStock: number;
}

interface Props {
  orderId: string;
  orderNo: string;
  initial: Line[];
  onClose: () => void;
  onSaved: (message: string) => void;
}

export function EditItemsSheet({ orderId, orderNo, initial, onClose, onSaved }: Props) {
  const [lines, setLines] = useState<Line[]>(initial);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<ProductResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const query = search.trim();

  // Debounced, and the response for a stale query is dropped — a fast typist would otherwise
  // see the results of a word they have already finished replacing. Nothing sets state in the
  // effect BODY: an empty box simply renders no results (`visibleResults`) rather than clearing
  // them synchronously, which is the cascading-render react-hooks forbids.
  useEffect(() => {
    if (query.length < 1) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setSearching(true);
      const { data, error: err } = await apiTry<ProductResult[]>(
        `/api/products?search=${encodeURIComponent(query)}&limit=10`
      );
      if (cancelled) return;
      if (err) log.warn("product search failed", { message: err });
      setResults(data ?? []);
      setSearching(false);
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query]);

  const visibleResults = query.length >= 1 ? results : [];

  function addProduct(p: ProductResult) {
    setSearch("");
    setResults([]);
    setLines((prev) =>
      prev.some((l) => l.productId === p.id)
        ? prev
        : [...prev, { productId: p.id, name: p.name, sku: p.sku, quantity: 1 }]
    );
  }

  async function save() {
    setSaving(true);
    setError(null);
    const { data, error: err } = await apiTry<{ message: string }>(
      `/api/transfer-orders/${orderId}`,
      {
        method: "PATCH",
        json: { items: lines.map((l) => ({ productId: l.productId, quantity: l.quantity })) },
      }
    );
    setSaving(false);
    if (err || !data) {
      log.warn("transfer line edit failed", { orderId, message: err });
      setError(err ?? "Could not save these lines");
      return;
    }
    onSaved(data.message ?? "Transfer updated");
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div
        className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto p-5 space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-900">Correct {orderNo}</h2>
            <p className="text-[11px] text-slate-500">Change quantities, remove lines or add a product</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-2 -mr-2 -mt-1 text-slate-400 focus-ring">
            <X className="h-5 w-5" />
          </button>
        </div>

        {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search products to add"
            className="w-full h-11 rounded-lg border border-slate-200 pl-9 pr-9 text-sm focus-ring"
          />
          {searching && query.length > 0 && (
            <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 animate-spin" />
          )}
        </div>

        {visibleResults.length > 0 && (
          <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 max-h-48 overflow-y-auto">
            {visibleResults.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => addProduct(p)}
                className="w-full text-left p-2.5 hover:bg-slate-50 focus-ring"
              >
                <p className="text-sm text-slate-900 truncate">{p.name}</p>
                <p className="text-[11px] text-slate-500 tabular-nums">
                  {p.sku} · stock {p.currentStock}
                </p>
              </button>
            ))}
          </div>
        )}

        {lines.length === 0 ? (
          <div className="text-center py-6 border-2 border-dashed border-slate-200 rounded-lg">
            <Package className="h-7 w-7 text-slate-300 mx-auto mb-1" />
            <p className="text-xs text-slate-400">Add at least one product</p>
          </div>
        ) : (
          <div className="space-y-2">
            {lines.map((line, index) => (
              <div key={line.productId} className="rounded-lg border border-slate-200 p-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm text-slate-900 truncate">{line.name}</p>
                    <p className="text-[11px] text-slate-500 tabular-nums">{line.sku}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setLines((prev) => prev.filter((_, i) => i !== index))}
                    aria-label={`Remove ${line.name}`}
                    className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-red-400 hover:bg-red-50 hover:text-red-600 focus-ring"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <div className="mt-1.5 flex items-center gap-2">
                  <label className="text-[11px] text-slate-500" htmlFor={`qty-${line.productId}`}>Qty</label>
                  <input
                    id={`qty-${line.productId}`}
                    type="number"
                    min={1}
                    inputMode="numeric"
                    value={line.quantity}
                    onChange={(e) => {
                      const next = Math.max(1, Math.trunc(Number(e.target.value) || 1));
                      setLines((prev) => prev.map((l, i) => (i === index ? { ...l, quantity: next } : l)));
                    }}
                    className="h-10 w-24 rounded-lg border border-slate-200 px-2 text-sm tabular-nums focus-ring"
                  />
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <Button variant="outline" onClick={onClose} className="flex-1 min-h-[44px]">
            Cancel
          </Button>
          <Button onClick={save} disabled={saving || lines.length === 0} className="flex-1 min-h-[44px]">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save lines"}
          </Button>
        </div>
      </div>
    </div>
  );
}
