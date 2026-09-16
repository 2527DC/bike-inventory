"use client";

import { useEffect, useRef, useState } from "react";
import { X, Loader2, Search, AlertTriangle, ExternalLink, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiFetchEnvelope } from "@/lib/api-client";
import { useDebounce } from "@/hooks/use-debounce";
import { createLogger } from "@/lib/logger";

const log = createLogger("purchase-orders:reorder-items-modal");

/** R6: "get the first 10 data … like pagination". */
const PAGE_SIZE = 10;

/** One row of GET /api/purchase-orders/reorder-items — see lib/purchase-orders/reorder-items.ts. */
export interface ReorderItemRow {
  productId: string;
  sku: string;
  name: string;
  currentStock: number;
  reorderLevel: number;
  reorderQty: number;
  quantity: number;
  openPo: { id: string; poNumber: string; status: string } | null;
}

/** What the modal hands back: a catalogue product and the quantity to order. */
export interface PickedReorderLine {
  productId: string;
  name: string;
  quantity: number;
}

interface Props {
  vendorId: string;
  vendorName: string;
  /** Products already on this order — shown as such, never offered twice. */
  onOrder: Set<string>;
  onClose: () => void;
  onAdd: (lines: PickedReorderLine[]) => void;
}

interface PageData {
  rows: ReorderItemRow[];
  total: number;
  totalPages: number;
}

const statusLabel = (s: string) => s.replace(/_/g, " ").toLowerCase();

/**
 * "Add reorder items" on New Purchase Order (plan 1509-reorder-inside-purchase-orders, Q6).
 *
 * Lists the chosen vendor's products whose stock is at or below their reorder level, ten at a
 * time, searchable. Each row starts at the product's reorder quantity — 0 when none was set
 * (Q5) — and the quantity is editable here and again on the order. Nothing reaches the order
 * until "Add N to order" is pressed.
 *
 * Ticks and edited quantities are kept across pages and searches, keyed by product, so paging
 * to page 2 does not lose what was ticked on page 1.
 *
 * A product already on an OPEN purchase order for this vendor is listed greyed with that
 * order's number (Q7): it is low, but it has already been ordered, and PO save would refuse it.
 *
 * Same overlay shape as `components/reorder-sheet.tsx` — a bottom sheet on a phone, a centred
 * card from `sm:` — with Escape to close, the page scroll locked, and focus returned on close.
 */
export function ReorderItemsModal({ vendorId, vendorName, onOrder, onClose, onAdd }: Props) {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search.trim());
  const [reloadKey, setReloadKey] = useState(0);
  const [result, setResult] = useState<PageData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Record<string, PickedReorderLine>>({});
  const [draftQty, setDraftQty] = useState<Record<string, number>>({});

  // `loading` is DERIVED — "what is on screen was loaded for a different request" — rather than
  // set at the top of the effect, the same pattern as purchase-orders/page.tsx.
  const params = new URLSearchParams({ vendorId, page: String(page), limit: String(PAGE_SIZE) });
  if (debouncedSearch) params.set("search", debouncedSearch);
  const query = params.toString();
  const requestKey = `${query}#${reloadKey}`;
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const loading = loadedKey !== requestKey;

  useEffect(() => {
    let cancelled = false;
    apiFetchEnvelope<ReorderItemRow[]>(`/api/purchase-orders/reorder-items?${query}`)
      .then((env) => {
        if (cancelled) return;
        setResult({
          rows: env.data,
          total: env.pagination?.total ?? env.data.length,
          totalPages: Math.max(1, env.pagination?.totalPages ?? 1),
        });
        setError(null);
        log.debug("reorder items page loaded", { vendorId, page, rows: env.data.length, total: env.pagination?.total });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const message = e instanceof Error ? e.message : "Could not load the reorder items";
        log.error("reorder items load failed", { vendorId, page, message });
        setError(message);
      })
      .finally(() => {
        if (!cancelled) setLoadedKey(requestKey);
      });
    return () => {
      cancelled = true;
    };
  }, [query, requestKey, vendorId, page]);

  // Escape, scroll lock and focus return. `onClose` is read through a ref so a parent that
  // passes a fresh arrow each render does not re-run this and bounce focus around.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    searchRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      trigger?.focus?.();
    };
  }, []);

  const rows = result?.rows ?? [];
  const totalPages = result?.totalPages ?? 1;
  const isSelectable = (r: ReorderItemRow) => !r.openPo && !onOrder.has(r.productId);
  const qtyOf = (r: ReorderItemRow) => picked[r.productId]?.quantity ?? draftQty[r.productId] ?? r.quantity;

  function toggle(r: ReorderItemRow) {
    if (!isSelectable(r)) return;
    setPicked((prev) => {
      const next = { ...prev };
      if (next[r.productId]) delete next[r.productId];
      else next[r.productId] = { productId: r.productId, name: r.name, quantity: qtyOf(r) };
      return next;
    });
  }

  function setQty(r: ReorderItemRow, raw: string) {
    const n = Math.max(0, parseInt(raw, 10) || 0);
    setDraftQty((prev) => ({ ...prev, [r.productId]: n }));
    setPicked((prev) => (prev[r.productId] ? { ...prev, [r.productId]: { ...prev[r.productId], quantity: n } } : prev));
  }

  const selectableOnPage = rows.filter(isSelectable);
  const pageAllPicked = selectableOnPage.length > 0 && selectableOnPage.every((r) => picked[r.productId]);

  function togglePage() {
    setPicked((prev) => {
      const next = { ...prev };
      if (pageAllPicked) {
        for (const r of selectableOnPage) delete next[r.productId];
      } else {
        for (const r of selectableOnPage) {
          if (!next[r.productId]) next[r.productId] = { productId: r.productId, name: r.name, quantity: qtyOf(r) };
        }
      }
      return next;
    });
  }

  const pickedList = Object.values(picked);
  const pickedZero = pickedList.filter((p) => p.quantity < 1).length;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/40 sm:p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Reorder items for ${vendorName}`}
        className="bg-white w-full sm:max-w-2xl rounded-t-2xl sm:rounded-2xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ─── header ─────────────────────────────────────────────────────────────────── */}
        <div className="flex items-start justify-between gap-3 p-4 border-b border-slate-100 shrink-0">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-slate-900">Reorder items</h2>
            <p className="text-xs text-slate-500 mt-0.5 break-words">
              {vendorName} · stock at or below the reorder level
              {result ? ` · ${result.total} item${result.total === 1 ? "" : "s"}` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="min-h-[44px] min-w-[44px] -mr-2 -mt-2 flex items-center justify-center text-slate-400 hover:text-slate-600 focus-ring rounded-lg"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-4 pb-2 shrink-0">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input
              ref={searchRef}
              placeholder="Search product name or SKU..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="pl-9 min-h-[44px]"
              aria-label="Search reorder items"
            />
          </div>
        </div>

        {/* ─── the list ───────────────────────────────────────────────────────────────── */}
        <div className="px-4 pb-2 overflow-y-auto flex-1 min-h-[160px]">
          {error && !loading ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-xs text-red-700 break-words">{error}</p>
                <button
                  type="button"
                  onClick={() => setReloadKey((k) => k + 1)}
                  className="mt-1 min-h-[44px] text-xs font-semibold text-red-700 underline"
                >
                  Try again
                </button>
              </div>
            </div>
          ) : !result ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading reorder items…
            </div>
          ) : rows.length === 0 && result.total > 0 ? (
            // Past the last page: the list shrank since this page was asked for (an item was
            // ordered or restocked meanwhile). Not "nothing is low" — offer the last real page.
            <div className="py-8 text-center">
              <p className="text-sm text-slate-500">This page is empty.</p>
              <button
                type="button"
                onClick={() => setPage(Math.max(1, result.totalPages))}
                className="mt-1 min-h-[44px] px-3 text-xs font-semibold text-blue-700 underline"
              >
                Go to page {Math.max(1, result.totalPages)}
              </button>
            </div>
          ) : rows.length === 0 ? (
            <div className="py-8 text-center">
              {debouncedSearch ? (
                <p className="text-sm text-slate-500">No reorder items match &ldquo;{debouncedSearch}&rdquo;.</p>
              ) : (
                <>
                  <p className="text-sm font-medium text-slate-700">
                    No products for {vendorName} are at or below their reorder level.
                  </p>
                  <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                    A product shows here when its reorder vendor is {vendorName} and its stock is at or
                    below its reorder level. Set both from the Reorder button on{" "}
                    <a href="/stock" target="_blank" rel="noreferrer" className="underline font-medium">
                      Stock
                    </a>
                    .
                  </p>
                </>
              )}
            </div>
          ) : (
            <ul className={`space-y-2 transition-opacity ${loading ? "opacity-50" : ""}`} aria-busy={loading}>
              {rows.map((r) => {
                const already = onOrder.has(r.productId);
                const disabled = !isSelectable(r);
                const isPicked = !!picked[r.productId];
                const checkboxId = `reorder-pick-${r.productId}`;
                return (
                  <li
                    key={r.productId}
                    className={`rounded-lg border p-2.5 ${
                      disabled
                        ? "border-slate-100 bg-slate-50"
                        : isPicked
                        ? "border-blue-300 bg-blue-50"
                        : "border-slate-200"
                    }`}
                  >
                    <div className="flex items-start gap-2.5">
                      <label htmlFor={checkboxId} className={`flex flex-1 min-w-0 items-start gap-2.5 ${disabled ? "" : "cursor-pointer"}`}>
                        <input
                          id={checkboxId}
                          type="checkbox"
                          checked={isPicked || already}
                          disabled={disabled}
                          onChange={() => toggle(r)}
                          className="mt-0.5 h-5 w-5 shrink-0 rounded border-slate-300 text-blue-600 focus:ring-blue-500 disabled:opacity-50"
                        />
                        <span className="min-w-0">
                          <span className={`block text-sm font-medium break-words ${disabled ? "text-slate-500" : "text-slate-900"}`}>
                            {r.name}
                          </span>
                          <span className="block text-[11px] text-slate-500 tabular-nums">
                            {r.sku} · stock {r.currentStock} · level {r.reorderLevel}
                          </span>
                        </span>
                      </label>
                      <div className="w-20 shrink-0">
                        <label htmlFor={`reorder-qty-${r.productId}`} className="block text-[10px] font-medium text-slate-500 uppercase tracking-wide">
                          Qty
                        </label>
                        <Input
                          id={`reorder-qty-${r.productId}`}
                          type="number"
                          inputMode="numeric"
                          min={0}
                          value={qtyOf(r)}
                          onChange={(e) => setQty(r, e.target.value)}
                          disabled={disabled}
                          className="min-h-[44px] text-sm tabular-nums"
                        />
                      </div>
                    </div>
                    {already ? (
                      <p className="mt-1 text-[11px] font-medium text-green-700">Already on this order</p>
                    ) : r.openPo ? (
                      <a
                        href={`/purchase-orders/${r.openPo.id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 inline-flex min-h-[32px] items-center gap-1 text-[11px] font-medium text-amber-800 underline"
                      >
                        Already ordered on {r.openPo.poNumber} · {statusLabel(r.openPo.status)}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    ) : qtyOf(r) < 1 ? (
                      <p className="mt-1 text-[11px] text-amber-700">
                        {r.reorderQty === 0 ? "Reorder qty not set — " : ""}enter the quantity here or on the order
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* ─── paging + add ───────────────────────────────────────────────────────────── */}
        <div className="border-t border-slate-100 p-4 space-y-3 shrink-0 pb-safe">
          {result && result.total > 0 && (
            <div className="flex items-center justify-between gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1 || loading}
                className="min-h-[44px]"
                aria-label="Previous page"
              >
                <ChevronLeft className="h-4 w-4" /> Prev
              </Button>
              <span className="text-xs text-slate-500 tabular-nums">
                Page {page} of {totalPages}
              </span>
              <Button
                type="button"
                variant="outline"
                onClick={() => setPage((p) => p + 1)}
                disabled={page >= totalPages || loading}
                className="min-h-[44px]"
                aria-label="Next page"
              >
                Next <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-2">
            {selectableOnPage.length > 0 && (
              <Button type="button" variant="outline" onClick={togglePage} className="min-h-[44px] sm:flex-1">
                {pageAllPicked ? "Clear this page" : "Select all on this page"}
              </Button>
            )}
            <Button
              type="button"
              onClick={() => onAdd(pickedList)}
              disabled={pickedList.length === 0}
              className="min-h-[48px] sm:flex-1 bg-blue-600 hover:bg-blue-700 text-white"
            >
              {pickedList.length === 0 ? "Tick items to add" : `Add ${pickedList.length} to order`}
            </Button>
          </div>
          {pickedZero > 0 && (
            <p className="text-[11px] text-amber-700 text-center">
              {pickedZero} ticked item{pickedZero === 1 ? " has" : "s have"} quantity 0 — set it on the order before
              submitting.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export default ReorderItemsModal;
