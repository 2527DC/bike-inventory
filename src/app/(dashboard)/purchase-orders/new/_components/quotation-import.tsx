"use client";

import { useState } from "react";
import { AlertTriangle, FileUp, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";
import type { ExtractionItemView, ExtractionView } from "@/lib/po-extraction/types";
import { formatCurrency, type POLineItem } from "./vendor-section";
import { ExtractionProductPicker } from "./extraction-product-picker";

const log = createLogger("purchase-orders:import");

export const ACCEPTED_QUOTATION_TYPES = ".xlsx,.xls,.csv,.pdf,.png,.jpg,.jpeg,.webp";

/**
 * A review row → a PO line, with the defaults the owner chose (plan 0909-po-ai-upload, Q7):
 *   Qty        = the file's quantity if > 0, else the reorder shortfall if > 0, else 1
 *   Unit Price = the file's price, else the product's cost price (0 when the caller may not
 *                see cost — the line editor then shows an empty, required rate box)
 *   GST %      = the product's gstRate
 * Null when the row has no product — an unmatched row cannot become a line.
 */
export function extractionLine(item: ExtractionItemView): POLineItem | null {
  const p = item.product;
  if (!p) return null;
  const shortfall = p.reorderLevel - (p.currentStock - p.reservedStock);
  const quantity =
    item.orderQty && item.orderQty > 0
      ? item.orderQty
      : item.qty && item.qty > 0
        ? item.qty
        : shortfall > 0
          ? shortfall
          : 1;
  const unitPrice = item.price && item.price > 0 ? item.price : (p.costPrice ?? 0);
  return { productId: p.id, productName: p.name, sku: p.sku, quantity, unitPrice, gstRate: p.gstRate };
}

interface Props {
  vendorId: string;
  vendorName: string | null;
  extraction: ExtractionView | null;
  onExtractionChange: (next: ExtractionView | null) => void;
  onUseSelected: (lines: POLineItem[]) => void;
  disabled: boolean;
}

/**
 * Upload a vendor's quotation, review what was read, tick what to order.
 *
 * The extraction lives on the server the moment it is read, so a refresh — or a phone that
 * locks during the AI call — reloads the same review rather than paying for the read again.
 * Every edit here is a PATCH; nothing is held only in memory except the file before upload.
 */
export function QuotationImport({ vendorId, vendorName, extraction, onExtractionChange, onUseSelected, disabled }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);
  const [pickingRow, setPickingRow] = useState<string | null>(null);
  const [discarding, setDiscarding] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const busy = disabled || extracting || discarding;

  async function extract() {
    if (!file || !vendorId) return;
    setExtracting(true);
    setError(null);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("vendorId", vendorId);
    log.debug("uploading quotation", { vendorId, fileName: file.name, bytes: file.size });
    const { data, error: err } = await apiTry<ExtractionView>("/api/purchase-orders/extract", { method: "POST", body: fd });
    setExtracting(false);
    if (!data) {
      setError(err ?? "Could not read the file");
      log.error("quotation extract failed", { vendorId, message: err });
      return;
    }
    log.debug("quotation extracted", { extractionId: data.id, totalItems: data.totalItems, matchedItems: data.matchedItems });
    setFile(null);
    setCollapsed(false);
    onExtractionChange(data);
  }

  async function patchRow(itemId: string, body: { productId?: string | null; selected?: boolean }) {
    if (!extraction) return;
    setRowBusy(itemId);
    setRowError(null);
    const { data, error: err } = await apiTry<{ item: ExtractionItemView; matchedItems: number }>(
      `/api/purchase-orders/extract/${extraction.id}/items/${itemId}`,
      { method: "PATCH", json: body }
    );
    setRowBusy(null);
    if (!data) {
      setRowError({ id: itemId, message: err ?? "Could not update this row" });
      log.error("extraction row update failed", { extractionId: extraction.id, itemId, message: err });
      return;
    }
    log.debug("extraction row updated", { extractionId: extraction.id, itemId, matchStatus: data.item.matchStatus, selected: data.item.selected });
    onExtractionChange({
      ...extraction,
      matchedItems: data.matchedItems,
      items: extraction.items.map((it) => (it.id === itemId ? data.item : it)),
    });
  }

  async function discard() {
    if (!extraction) return;
    setDiscarding(true);
    setError(null);
    const { data, error: err } = await apiTry<{ id: string }>(`/api/purchase-orders/extract/${extraction.id}`, { method: "DELETE" });
    setDiscarding(false);
    if (!data) {
      setError(err ?? "Could not discard the review");
      log.error("extraction discard failed", { extractionId: extraction.id, message: err });
      return;
    }
    log.debug("extraction discarded", { extractionId: extraction.id });
    onExtractionChange(null);
  }

  function useSelected() {
    if (!extraction) return;
    const lines = extraction.items.filter((it) => it.selected).map(extractionLine).filter((l): l is POLineItem => l !== null);
    log.debug("using selected rows", { extractionId: extraction.id, lines: lines.length });
    onUseSelected(lines);
    setCollapsed(true);
  }

  // ─── no review yet: the upload ────────────────────────────────────────────────────────
  if (!extraction) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 p-3 space-y-2">
        <label className="block text-sm font-medium text-slate-700" htmlFor="quotation-file">
          Upload a quotation from {vendorName ?? "this vendor"}
        </label>
        <p className="text-[11px] text-slate-500">
          Excel or CSV is read instantly. A PDF or a photo is read by AI and can take 30–60 seconds.
        </p>
        <input
          id="quotation-file"
          type="file"
          accept={ACCEPTED_QUOTATION_TYPES}
          disabled={busy}
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setError(null);
          }}
          className="block w-full text-sm text-slate-700 file:mr-3 file:min-h-[44px] file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:text-sm file:font-medium file:text-slate-700"
        />
        {extracting ? (
          <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 text-sm text-blue-900 flex items-start gap-2">
            <Loader2 className="h-4 w-4 animate-spin shrink-0 mt-0.5" />
            <span>
              Reading {file?.name ?? "the file"}… An AI read of a PDF or image can take 30–60 seconds.
              Keep this screen open; the result is saved so a refresh will not lose it.
            </span>
          </div>
        ) : (
          <Button type="button" onClick={() => void extract()} disabled={busy || !file} className="min-h-[44px] w-full sm:w-auto">
            <FileUp className="h-4 w-4 mr-1.5" /> Read the file
          </Button>
        )}
        {error && (
          <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-2 flex items-start gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span className="break-words">{error}</span>
          </p>
        )}
      </div>
    );
  }

  // ─── the review belongs to another vendor ─────────────────────────────────────────────
  if (extraction.vendorId !== vendorId) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-2">
        <p className="text-sm text-amber-900">
          The quotation <span className="font-semibold">{extraction.fileName}</span> was uploaded for{" "}
          <span className="font-semibold">{extraction.vendorName}</span>. Switch the vendor back to review it, or discard it.
        </p>
        <Button type="button" variant="outline" onClick={() => void discard()} disabled={busy} className="min-h-[44px]">
          {discarding ? <Loader2 className="h-4 w-4 animate-spin" /> : "Discard that quotation"}
        </Button>
        {error && <p className="text-xs text-red-700">{error}</p>}
      </div>
    );
  }

  const selectedCount = extraction.items.filter((it) => it.selected && it.product).length;
  const sourceLabel = extraction.source === "ai" ? `Read by AI${extraction.aiModel ? ` · ${extraction.aiModel}` : ""}` : "Read from the spreadsheet";

  // ─── the review ───────────────────────────────────────────────────────────────────────
  return (
    <div className="rounded-lg border border-slate-200 p-3 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-900 truncate">{extraction.fileName}</p>
          <p className="text-[11px] text-slate-500">
            {sourceLabel} · {extraction.matchedItems} of {extraction.totalItems} rows matched · {selectedCount} selected
          </p>
        </div>
        <button
          type="button"
          onClick={() => void discard()}
          disabled={busy}
          aria-label="Discard this quotation and its review"
          className="shrink-0 inline-flex items-center gap-1 min-h-[44px] px-2 text-xs font-medium text-red-600 hover:text-red-700 disabled:opacity-40"
        >
          {discarding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Discard
        </button>
      </div>

      {error && (
        <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-2 flex items-start gap-1.5">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span className="break-words">{error}</span>
        </p>
      )}

      {collapsed ? (
        <button type="button" onClick={() => setCollapsed(false)} className="min-h-[44px] text-xs font-medium text-blue-700 underline">
          Show the {extraction.totalItems} extracted rows again
        </button>
      ) : (
        <>
          <div className="space-y-2">
            {extraction.items.map((it) => (
              <ExtractionRow
                key={it.id}
                item={it}
                vendorId={vendorId}
                busy={busy || rowBusy === it.id}
                error={rowError?.id === it.id ? rowError.message : null}
                picking={pickingRow === it.id}
                onTogglePicker={(open) => setPickingRow(open ? it.id : null)}
                onToggle={(selected) => void patchRow(it.id, { selected })}
                onMap={(productId) => {
                  setPickingRow(null);
                  void patchRow(it.id, { productId, selected: true });
                }}
                onClear={() => void patchRow(it.id, { productId: null })}
              />
            ))}
          </div>

          <Button type="button" onClick={useSelected} disabled={busy || selectedCount === 0} className="min-h-[48px] w-full bg-blue-600 hover:bg-blue-700 text-white">
            Use {selectedCount} selected row{selectedCount === 1 ? "" : "s"}
          </Button>
          {selectedCount === 0 && (
            <p className="text-[11px] text-slate-500 text-center">Tick at least one matched row, or map an unmatched one to a product.</p>
          )}
        </>
      )}
    </div>
  );
}

interface RowProps {
  item: ExtractionItemView;
  vendorId: string;
  busy: boolean;
  error: string | null;
  picking: boolean;
  onTogglePicker: (open: boolean) => void;
  onToggle: (selected: boolean) => void;
  onMap: (productId: string) => void;
  onClear: () => void;
}

function matchLabel(item: ExtractionItemView): { text: string; tone: string } {
  switch (item.matchStatus) {
    case "AUTO":
      return { text: "Exact SKU", tone: "bg-green-100 text-green-800" };
    case "FUZZY":
      return { text: `Likely · ${Math.round((item.matchConfidence ?? 0) * 100)}%`, tone: "bg-amber-100 text-amber-800" };
    case "MANUAL":
      return { text: "Mapped by hand", tone: "bg-blue-100 text-blue-800" };
    default:
      return { text: "No match", tone: "bg-slate-100 text-slate-600" };
  }
}

function ExtractionRow({ item, vendorId, busy, error, picking, onTogglePicker, onToggle, onMap, onClear }: RowProps) {
  const label = matchLabel(item);
  const p = item.product;
  const raw = [item.rawSku, item.rawSize, item.qty ? `qty ${item.qty}` : null, item.price ? formatCurrency(item.price) : null]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className={`rounded-lg border p-2.5 ${item.selected && p ? "border-blue-300 bg-blue-50/30" : "border-slate-200"}`}>
      <div className="flex items-start gap-2">
        <label className="flex items-center justify-center min-h-[44px] min-w-[44px] -m-2 shrink-0">
          <input
            type="checkbox"
            checked={item.selected && !!p}
            disabled={busy || !p}
            onChange={(e) => onToggle(e.target.checked)}
            aria-label={`Select ${item.rawName}`}
            className="h-5 w-5"
          />
        </label>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-slate-900 break-words">{item.rawName}</p>
          {raw && <p className="text-[11px] text-slate-500 break-words">{raw}</p>}

          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${label.tone}`}>{label.text}</span>
            {p ? (
              <span className="text-xs text-slate-700 break-words">
                {p.name} <span className="text-slate-400">· {p.sku}</span>
              </span>
            ) : (
              <span className="text-xs text-slate-500">Pick a product to order this row</span>
            )}
          </div>

          {!picking && (
            <div className="mt-1 flex flex-wrap gap-2">
              <button type="button" onClick={() => onTogglePicker(true)} disabled={busy} className="min-h-[36px] text-[11px] font-medium text-blue-700 underline disabled:opacity-40">
                {p ? "Change product" : "Map to a product"}
              </button>
              {p && (
                <button type="button" onClick={onClear} disabled={busy} className="min-h-[36px] text-[11px] font-medium text-slate-500 underline disabled:opacity-40">
                  Clear match
                </button>
              )}
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400 self-center" />}
            </div>
          )}
          {picking && (
            <div className="mt-2">
              <ExtractionProductPicker vendorId={vendorId} disabled={busy} onPick={(prod) => onMap(prod.id)} onCancel={() => onTogglePicker(false)} />
            </div>
          )}
          {error && <p className="mt-1 text-[11px] text-red-700">{error}</p>}
        </div>
      </div>
    </div>
  );
}
