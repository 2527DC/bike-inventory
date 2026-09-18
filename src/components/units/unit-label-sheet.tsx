"use client";

import { useEffect, useState } from "react";
import { Printer, QrCode, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";

const log = createLogger("units:label-sheet");

/**
 * Printable labels for physical items (R46, plan 1709 Part H).
 *
 * Every item carries its own code — `U-000086` — and the label is stuck on the product, so the
 * sheet shows the code twice: as a Code 128 barcode a scanner reads, and in large type a person
 * reads. Product name and SKU sit under it so a label found on the floor still means something.
 *
 * The barcodes arrive already rendered from `/api/units/labels`; this component never calls
 * `/api/barcode` per label.
 *
 * Printing goes through a hidden iframe rather than `window.open`, which is blocked in the
 * installed PWA — the same approach as `stock/[id]/barcode`.
 */

export interface UnitLabel {
  id: string;
  unitCode: string;
  productName: string;
  sku: string;
  brand: string | null;
  binCode: string | null;
  nonAssemblable: boolean;
  status: string;
  barcode: string | null;
}

interface UnitLabelSheetProps {
  /** Exactly one of these three. `unitIds` is what "Generate unit codes" hands over. */
  unitIds?: string[];
  binId?: string;
  inboundShipmentId?: string;
  /** Shown above the sheet, e.g. "48 new codes · Godown". */
  heading?: string;
  /** Rendered as a modal with a close button when given; inline otherwise. */
  onClose?: () => void;
}

function escapeHtml(str: string) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildQuery(props: UnitLabelSheetProps): string | null {
  if (props.unitIds && props.unitIds.length > 0) {
    return `unitIds=${encodeURIComponent(props.unitIds.join(","))}`;
  }
  if (props.binId) return `binId=${encodeURIComponent(props.binId)}`;
  if (props.inboundShipmentId) return `inboundShipmentId=${encodeURIComponent(props.inboundShipmentId)}`;
  return null;
}

export function UnitLabelSheet(props: UnitLabelSheetProps) {
  const { heading, onClose } = props;
  const [labels, setLabels] = useState<UnitLabel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  const query = buildQuery(props);
  // Bumped by the Reload button. The effect must not set state synchronously (cascading
  // renders), so the spinner is turned on in the click handler and off after the await.
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!query) return;
    let cancelled = false;
    (async () => {
      const { data, error: err } = await apiTry<{ labels: UnitLabel[]; total: number }>(
        `/api/units/labels?${query}`
      );
      if (cancelled) return;
      if (err) {
        log.error("label sheet load failed", { query, message: err });
        setError(err);
        setLabels([]);
      } else if (data) {
        setError(null);
        setLabels(data.labels);
        log.info("label sheet loaded", { count: data.labels.length });
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [query, reloadKey]);

  function reload() {
    setLoading(true);
    setError(null);
    setReloadKey((k) => k + 1);
  }

  function handlePrint() {
    if (labels.length === 0) return;

    const itemsHtml = labels
      .map((label) => {
        const img = label.barcode
          ? `<img src="${label.barcode}" alt="${escapeHtml(label.unitCode)}" />`
          : `<div class="nobarcode">no barcode</div>`;
        return (
          `<div class="label">${img}` +
          `<div class="code">${escapeHtml(label.unitCode)}</div>` +
          `<div class="name">${escapeHtml(label.productName)}</div>` +
          `<div class="sku">${escapeHtml(label.sku)}</div>` +
          `</div>`
        );
      })
      .join("");

    const htmlContent =
      `<html><head><title>Unit labels</title><style>` +
      `body { font-family: Arial, Helvetica, sans-serif; margin: 8mm; }` +
      `.sheet { display: flex; flex-wrap: wrap; gap: 4mm; }` +
      `.label { width: 52mm; padding: 2mm; border: 1px dashed #bbb; text-align: center; box-sizing: border-box; }` +
      `.label img { max-width: 100%; height: 12mm; object-fit: contain; }` +
      `.nobarcode { height: 12mm; line-height: 12mm; font-size: 7pt; color: #999; }` +
      `.code { font-family: "Courier New", monospace; font-size: 14pt; font-weight: bold; letter-spacing: 0.5px; }` +
      `.name { font-size: 7pt; margin-top: 1mm; overflow: hidden; }` +
      `.sku { font-size: 6.5pt; color: #666; font-family: "Courier New", monospace; }` +
      `@media print { .label { page-break-inside: avoid; } }` +
      `</style></head><body><div class="sheet">${itemsHtml}</div></body></html>`;

    const iframe = document.createElement("iframe");
    iframe.style.position = "fixed";
    iframe.style.top = "-10000px";
    iframe.style.left = "-10000px";
    iframe.style.width = "0";
    iframe.style.height = "0";
    document.body.appendChild(iframe);

    const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!iframeDoc) {
      document.body.removeChild(iframe);
      const win = window.open("", "_blank");
      if (win) {
        win.document.open();
        win.document.write(htmlContent);
        win.document.close();
        setTimeout(() => win.print(), 300);
      } else {
        log.warn("print blocked — no iframe document and popup refused");
        setWarning("The print window was blocked. Allow popups for this site and try again.");
      }
      return;
    }

    iframeDoc.open();
    iframeDoc.write(htmlContent);
    iframeDoc.close();
    log.info("printing unit labels", { count: labels.length });

    setTimeout(() => {
      iframe.contentWindow?.print();
      setTimeout(() => document.body.removeChild(iframe), 500);
    }, 300);
  }

  const body = (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
            <QrCode className="h-4 w-4 text-indigo-600" />
            <span>Item labels</span>
          </div>
          <p className="text-xs text-slate-500">
            {heading || "One label per item — stick it on the product."}
            {labels.length > 0 && ` · ${labels.length} label${labels.length === 1 ? "" : "s"}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={reload} disabled={loading} className="h-9 gap-1.5 text-xs">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Reload
          </Button>
          <Button
            size="sm"
            onClick={handlePrint}
            disabled={loading || labels.length === 0}
            className="h-9 gap-1.5 bg-indigo-600 text-xs text-white hover:bg-indigo-700"
          >
            <Printer className="h-4 w-4" /> Print
          </Button>
          {onClose && (
            <button
              onClick={onClose}
              aria-label="Close"
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <X className="h-5 w-5" />
            </button>
          )}
        </div>
      </div>

      {warning && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          {warning}
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </div>
      )}

      {loading && query ? (
        <div className="py-10 text-center text-xs text-slate-400">Preparing labels…</div>
      ) : labels.length === 0 && !error ? (
        <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-xs text-slate-400 dark:border-slate-800">
          Nothing to print here yet.
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {labels.map((label) => (
            <div
              key={label.id}
              className="rounded-xl border border-slate-200 bg-white p-3 text-center dark:border-slate-800 dark:bg-slate-900"
            >
              {label.barcode ? (
                // eslint-disable-next-line @next/next/no-img-element -- a data: URI, not a file to optimise
                <img src={label.barcode} alt={label.unitCode} className="mx-auto h-12 w-full object-contain" />
              ) : (
                <div className="flex h-12 items-center justify-center rounded bg-slate-50 text-[10px] text-slate-400 dark:bg-slate-800">
                  no barcode
                </div>
              )}
              <div className="mt-1 font-mono text-base font-bold tracking-tight text-slate-900 tabular-nums dark:text-white">
                {label.unitCode}
              </div>
              <div className="truncate text-[11px] text-slate-600 dark:text-slate-300" title={label.productName}>
                {label.productName}
              </div>
              <div className="font-mono text-[10px] text-slate-400">{label.sku}</div>
              {(label.binCode || label.nonAssemblable) && (
                <div className="mt-1 flex items-center justify-center gap-1 text-[10px] text-slate-400">
                  {label.binCode && <span className="font-mono">{label.binCode}</span>}
                  {label.nonAssemblable && <span className="text-amber-600">No assembly</span>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );

  if (!onClose) return body;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center sm:p-4">
      <div className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl duration-200 animate-in slide-in-from-bottom-5 sm:rounded-2xl sm:zoom-in-95 dark:bg-slate-900">
        {body}
      </div>
    </div>
  );
}
