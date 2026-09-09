"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Loader2, Search, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";
import type { ExtractionItemView, ExtractionView } from "@/lib/po-extraction/types";

const log = createLogger("purchase-orders:import");

/** How many rows are in the DOM at once. The sample sheet has 389; a phone handles 100. */
const PAGE = 100;

/** `#RRGGBB59` — the sheet's colour at 35 % so black text stays readable on red. */
export const rowTint = (rgb: string) => `#${rgb}59`;

/**
 * A human word for a fill colour, for a sheet with no legend block. Hue-based, so the
 * ten shades of red a spreadsheet can hold all read as "Red" in the filter.
 */
export function colourName(rgb: string): string {
  const n = parseInt(rgb.slice(0, 6), 16);
  if (Number.isNaN(n)) return `#${rgb}`;
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max - min < 24) return max > 230 ? "White" : max < 60 ? "Black" : "Grey";
  const d = max - min;
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  if (h < 15 || h >= 345) return "Red";
  if (h < 45) return "Orange";
  if (h < 70) return "Yellow";
  if (h < 170) return "Green";
  if (h < 200) return "Cyan";
  if (h < 260) return "Blue";
  if (h < 300) return "Purple";
  return "Pink";
}

const NO_COLOUR = "__none__";

interface Props {
  extraction: ExtractionView;
  /** Every request disabled while the parent has one in flight. */
  busy: boolean;
  onClose: () => void;
  /** The dialog PATCHes rows itself; the parent owns the view, so every change is handed back. */
  onChange: (next: ExtractionView) => void;
  onUseSelected: () => void;
  /** Hidden when the extraction has no sheets (a PDF or image was read directly). */
  onReopenColumns: (() => void) | null;
  onDiscard: () => void;
}

/**
 * The review — R7: searchable, checkable, dynamic, in the sheet's own colours.
 *
 * ─── SHAPE ───────────────────────────────────────────────────────────────────────────────
 * Full-height overlay, same construction as send-to-vendor-sheet (there is no shared dialog
 * primitive in this repo — see the note there). Header: search, sheet and colour filters,
 * the count and the bulk buttons. Body: one table per sheet, a checkbox then one cell per
 * column the person did not ignore, headers straight from the sheet. Footer pinned.
 *
 * ─── WHY PAGES, NOT A VIRTUALISER ────────────────────────────────────────────────────────
 * The plan asked for a virtualised list; that means a dependency, and this screen would be
 * the only user of it. 100 table rows render fine on a phone and "Show 100 more" is one tap
 * — a person scanning 389 rows is filtering by search or colour long before page four.
 *
 * ─── WHY THE CHECKBOX IS OPTIMISTIC ─────────────────────────────────────────────────────
 * Ticking a row is a PATCH. Waiting for it before the box changes makes every tick feel
 * broken on a slow connection, so the box flips at once and flips back — with a message —
 * only if the server refused.
 */
export function SheetReview({ extraction, busy, onClose, onChange, onUseSelected, onReopenColumns, onDiscard }: Props) {
  const [query, setQuery] = useState("");
  const [sheetFilter, setSheetFilter] = useState<string>("");
  const [colourFilter, setColourFilter] = useState<string>("");
  const [shown, setShown] = useState(PAGE);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [rowBusy, setRowBusy] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);

  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<Element | null>(null);

  // The latest view, for the async handlers: an optimistic revert after a slow PATCH must
  // build on what the parent holds NOW, not on the render that started the request. Set in
  // an effect (after commit) rather than during render, which is what the hooks rule asks.
  const latest = useRef(extraction);
  useEffect(() => {
    latest.current = extraction;
  }, [extraction]);

  useEffect(() => {
    triggerRef.current = document.activeElement;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    searchRef.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      (triggerRef.current as HTMLElement | null)?.focus?.();
    };
  }, [onClose]);

  const { items, legend } = extraction;
  const anyBusy = busy || bulkBusy;

  const sheets = useMemo(() => {
    const seen: string[] = [];
    for (const it of items) if (it.sheetName && !seen.includes(it.sheetName)) seen.push(it.sheetName);
    return seen;
  }, [items]);

  /**
   * The colour filter's options. From the legend when the sheet has one (its words are the
   * ones the vendor meant); otherwise from the distinct fills found, named by hue. A "No
   * colour" option appears whenever some rows are plain — 31 of the sample's 389 are.
   */
  const colours = useMemo(() => {
    const out: Array<{ value: string; label: string; rgb: string | null }> = [];
    if (legend.length > 0) {
      for (const l of legend) out.push({ value: l.rgb, label: l.label, rgb: l.rgb });
      const known = new Set(legend.map((l) => l.rgb));
      for (const it of items) {
        if (it.rowColor && !known.has(it.rowColor)) {
          known.add(it.rowColor);
          out.push({ value: it.rowColor, label: colourName(it.rowColor), rgb: it.rowColor });
        }
      }
    } else {
      const seen = new Set<string>();
      for (const it of items) {
        if (it.rowColor && !seen.has(it.rowColor)) {
          seen.add(it.rowColor);
          out.push({ value: it.rowColor, label: colourName(it.rowColor), rgb: it.rowColor });
        }
      }
    }
    if (items.some((it) => !it.rowColor) && out.length > 0) out.push({ value: NO_COLOUR, label: "No colour", rgb: null });
    return out;
  }, [items, legend]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((it) => {
      if (sheetFilter && it.sheetName !== sheetFilter) return false;
      if (colourFilter === NO_COLOUR && it.rowColor) return false;
      if (colourFilter && colourFilter !== NO_COLOUR && it.rowColor !== colourFilter) return false;
      if (!q) return true;
      if (it.name.toLowerCase().includes(q)) return true;
      return it.columns.some((c) => c.value.toLowerCase().includes(q));
    });
  }, [items, query, sheetFilter, colourFilter]);

  const selectedCount = items.filter((it) => it.selected).length;
  const rendered = visible.slice(0, shown);

  /** Grouped by sheet, in first-seen order, so each group carries its own headers. */
  const groups = useMemo(() => {
    const map = new Map<string, ExtractionItemView[]>();
    for (const it of rendered) {
      const k = it.sheetName ?? "";
      const list = map.get(k);
      if (list) list.push(it);
      else map.set(k, [it]);
    }
    return [...map.entries()];
  }, [rendered]);

  // A new filter resets the page: "Show 100 more" counts from the top of the new list.
  const setFilter = (fn: () => void) => {
    fn();
    setShown(PAGE);
  };

  async function toggle(item: ExtractionItemView, selected: boolean) {
    if (anyBusy || rowBusy.has(item.id)) return;
    setError(null);
    setRowBusy((prev) => new Set(prev).add(item.id));
    // Optimistic: flip now, revert on refusal.
    onChange({ ...latest.current, items: latest.current.items.map((it) => (it.id === item.id ? { ...it, selected } : it)) });

    const { data, error: err } = await apiTry<{ item: ExtractionItemView; selectedCount: number }>(
      `/api/purchase-orders/extract/${encodeURIComponent(extraction.id)}/items/${encodeURIComponent(item.id)}`,
      { method: "PATCH", json: { selected } }
    );
    setRowBusy((prev) => {
      const next = new Set(prev);
      next.delete(item.id);
      return next;
    });
    if (!data) {
      log.error("extraction row select failed", { extractionId: extraction.id, itemId: item.id, selected, message: err });
      setError(err ?? "Could not update that row");
      onChange({ ...latest.current, items: latest.current.items.map((it) => (it.id === item.id ? { ...it, selected: !selected } : it)) });
      return;
    }
    log.debug("extraction row selected", { extractionId: extraction.id, itemId: item.id, selected, selectedCount: data.selectedCount });
    onChange({ ...latest.current, items: latest.current.items.map((it) => (it.id === item.id ? data.item : it)) });
  }

  async function bulk(ids: string[], selected: boolean) {
    if (anyBusy || ids.length === 0) return;
    setError(null);
    setBulkBusy(true);
    // The select route caps one request at 2000 ids; a sheet larger than that is sent in
    // chunks, in order, stopping at the first failure (review finding 7, 9 Sep 2026).
    const CHUNK = 2000;
    let data: { selectedCount: number } | null = null;
    let err: string | null = null;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const res = await apiTry<{ selectedCount: number }>(
        `/api/purchase-orders/extract/${encodeURIComponent(extraction.id)}/select`,
        { method: "POST", json: { itemIds: ids.slice(i, i + CHUNK), selected } }
      );
      if (!res.data) { err = res.error; data = null; break; }
      data = res.data;
    }
    setBulkBusy(false);
    if (!data) {
      log.error("extraction bulk select failed", { extractionId: extraction.id, count: ids.length, selected, message: err });
      setError(err ?? "Could not update those rows");
      return;
    }
    log.debug("extraction bulk selected", { extractionId: extraction.id, count: ids.length, selected, selectedCount: data.selectedCount });
    const set = new Set(ids);
    onChange({ ...latest.current, items: latest.current.items.map((it) => (set.has(it.id) ? { ...it, selected } : it)) });
  }

  const legendFor = (item: ExtractionItemView) => item.legendLabel ?? null;
  const withoutColours = extraction.source === "ai" && items.every((it) => !it.rowColor);

  return (
    <div className="fixed inset-0 z-[60] flex items-stretch sm:items-center justify-center bg-black/40 sm:p-4" onClick={onClose}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Review the rows read from ${extraction.fileName}`}
        className="bg-white w-full sm:max-w-4xl h-[100dvh] sm:h-[92dvh] sm:rounded-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ─── header: title, search, filters, bulk ─────────────────────────────────────── */}
        <div className="p-3 border-b border-slate-100 shrink-0 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h2 className="text-base font-bold text-slate-900 truncate">{extraction.fileName}</h2>
              <p className="text-[11px] text-slate-500 tabular-nums">
                {items.length} row{items.length === 1 ? "" : "s"}
                {sheets.length > 1 ? ` across ${sheets.length} sheets` : ""} · {selectedCount} selected
                {extraction.source === "ai" ? ` · read by AI${extraction.aiModel ? ` (${extraction.aiModel})` : ""}` : ""}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close the review"
              className="min-h-[44px] min-w-[44px] flex items-center justify-center -mr-2 -mt-2 text-slate-400 hover:text-slate-600"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="relative">
            <Search className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <Input
              ref={searchRef}
              value={query}
              onChange={(e) => setFilter(() => setQuery(e.target.value))}
              placeholder="Search any column…"
              aria-label="Search the rows"
              className="min-h-[44px] pl-9"
            />
          </div>

          {(sheets.length > 1 || colours.length > 0) && (
            <div className="flex gap-2 overflow-x-auto -mx-3 px-3 pb-0.5">
              {sheets.length > 1 && (
                <select
                  value={sheetFilter}
                  onChange={(e) => setFilter(() => setSheetFilter(e.target.value))}
                  aria-label="Filter by sheet"
                  className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-2 text-xs font-medium text-slate-700 shrink-0 focus:outline-none focus:ring-2 focus:ring-slate-900"
                >
                  <option value="">All sheets</option>
                  {sheets.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              )}
              {colours.length > 0 && (
                <div className="flex gap-1.5 shrink-0" role="group" aria-label="Filter by colour">
                  <button
                    type="button"
                    onClick={() => setFilter(() => setColourFilter(""))}
                    className={`min-h-[44px] px-3 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                      colourFilter === "" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    All colours
                  </button>
                  {colours.map((c) => (
                    <button
                      key={c.value}
                      type="button"
                      onClick={() => setFilter(() => setColourFilter(colourFilter === c.value ? "" : c.value))}
                      aria-pressed={colourFilter === c.value}
                      className={`inline-flex items-center gap-1.5 min-h-[44px] px-3 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                        colourFilter === c.value ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {c.rgb ? (
                        <span className="h-3 w-3 rounded-sm border border-black/10 shrink-0" style={{ background: `#${c.rgb}` }} aria-hidden />
                      ) : (
                        <span className="h-3 w-3 rounded-sm border border-slate-300 bg-white shrink-0" aria-hidden />
                      )}
                      {c.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void bulk(visible.filter((it) => !it.selected).map((it) => it.id), true)}
              disabled={anyBusy || visible.every((it) => it.selected)}
              className="min-h-[44px] px-3 rounded-lg border border-slate-300 bg-white text-xs font-medium text-slate-700 disabled:opacity-40 tabular-nums"
            >
              Select all {visible.length} shown
            </button>
            <button
              type="button"
              onClick={() => void bulk(items.filter((it) => it.selected).map((it) => it.id), false)}
              disabled={anyBusy || selectedCount === 0}
              className="min-h-[44px] px-3 rounded-lg border border-slate-300 bg-white text-xs font-medium text-slate-700 disabled:opacity-40"
            >
              Clear
            </button>
            {bulkBusy && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
          </div>

          {error && (
            <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-2 flex items-start gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span className="break-words">{error}</span>
            </p>
          )}
          {withoutColours && (
            <p className="text-[11px] text-slate-500">
              Read by AI, so the rows do not carry the sheet&apos;s colours.
            </p>
          )}
        </div>

        {/* ─── body: the rows ───────────────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-auto">
          {items.length === 0 ? (
            <p className="p-6 text-center text-sm text-slate-500">No rows were extracted. Reopen the columns and check the header row.</p>
          ) : visible.length === 0 ? (
            <p className="p-6 text-center text-sm text-slate-500">No rows match. Clear the search or the filters.</p>
          ) : (
            groups.map(([sheetName, rows]) => {
              const headers = rows[0]?.columns.map((c) => c.header) ?? [];
              return (
                <div key={sheetName || "sheet"} className="min-w-full">
                  {sheets.length > 1 && (
                    <p className="sticky top-0 z-20 bg-slate-50 border-y border-slate-200 px-3 py-1.5 text-[11px] font-semibold text-slate-600">
                      {sheetName || "Sheet"}
                    </p>
                  )}
                  <table className="text-xs border-collapse w-full">
                    <thead>
                      <tr className="bg-white border-b border-slate-200">
                        <th className="sticky left-0 z-10 bg-white w-11 px-1 py-2" aria-label="Select" />
                        {headers.map((h, i) => (
                          <th key={i} className="px-2 py-2 text-left font-semibold text-slate-600 whitespace-nowrap">
                            {h || `Column ${i + 1}`}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((it) => {
                        const label = legendFor(it);
                        const isBusy = rowBusy.has(it.id);
                        return (
                          <tr
                            key={it.id}
                            style={it.rowColor ? { background: rowTint(it.rowColor) } : undefined}
                            className={`border-b border-slate-100 ${it.selected ? "outline outline-1 -outline-offset-1 outline-blue-400" : ""}`}
                          >
                            <td className="sticky left-0 z-10 px-1 py-0" style={it.rowColor ? { background: rowTint(it.rowColor) } : { background: "#fff" }}>
                              <label className="flex items-center justify-center min-h-[44px] min-w-[44px]">
                                {isBusy ? (
                                  <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
                                ) : (
                                  <input
                                    type="checkbox"
                                    checked={it.selected}
                                    disabled={anyBusy}
                                    onChange={(e) => void toggle(it, e.target.checked)}
                                    aria-label={`Select ${it.name}`}
                                    className="h-5 w-5"
                                  />
                                )}
                              </label>
                            </td>
                            {it.columns.map((c, i) => (
                              <td key={i} className="px-2 py-1.5 text-slate-800 whitespace-nowrap max-w-[16rem] overflow-hidden text-ellipsis align-middle">
                                {i === 0 && label ? (
                                  <span className="inline-flex items-center gap-1.5">
                                    <span>{c.value}</span>
                                    <span
                                      className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full border border-black/10 text-slate-700"
                                      style={it.rowColor ? { background: rowTint(it.rowColor) } : undefined}
                                    >
                                      {label}
                                    </span>
                                  </span>
                                ) : (
                                  c.value
                                )}
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              );
            })
          )}

          {visible.length > shown && (
            <div className="p-3">
              <Button type="button" variant="outline" onClick={() => setShown((n) => n + PAGE)} className="min-h-[44px] w-full tabular-nums">
                Show {Math.min(PAGE, visible.length - shown)} more ({visible.length - shown} left)
              </Button>
            </div>
          )}
        </div>

        {/* ─── footer ───────────────────────────────────────────────────────────────────── */}
        <div className="p-3 border-t border-slate-100 shrink-0 pb-safe space-y-2">
          <Button
            type="button"
            onClick={onUseSelected}
            disabled={anyBusy || selectedCount === 0}
            className="min-h-[48px] w-full bg-blue-600 hover:bg-blue-700 text-white tabular-nums"
          >
            Use {selectedCount} selected row{selectedCount === 1 ? "" : "s"}
          </Button>
          <div className="flex items-center justify-between gap-2">
            {onReopenColumns ? (
              <button
                type="button"
                onClick={onReopenColumns}
                disabled={anyBusy}
                className="min-h-[44px] px-2 text-xs font-medium text-blue-700 underline disabled:opacity-40"
              >
                Reopen columns
              </button>
            ) : (
              <span />
            )}
            <button
              type="button"
              onClick={onDiscard}
              disabled={anyBusy}
              className="inline-flex items-center gap-1 min-h-[44px] px-2 text-xs font-medium text-red-600 hover:text-red-700 disabled:opacity-40"
            >
              <Trash2 className="h-4 w-4" /> Discard
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
