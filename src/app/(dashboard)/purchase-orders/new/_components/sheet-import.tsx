"use client";

import { useState } from "react";
import { AlertTriangle, FileUp, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";
import type { ExtractionView, SheetColumnsConfirm, SheetLine } from "@/lib/po-extraction/types";
import { ColumnsStep } from "./columns-step";
import { SheetReview } from "./sheet-review";

const log = createLogger("purchase-orders:import");

export const ACCEPTED_SHEET_TYPES = ".xlsx,.xls,.csv,.pdf,.png,.jpg,.jpeg,.webp";

/** The hint is data, never an instruction (R11); the server strips and refuses. Cap it here too. */
const HINT_MAX = 200;

const AI_READ_TYPES = new Set(["pdf", "png", "jpg", "jpeg", "webp"]);
const needsAiRead = (file: File) => AI_READ_TYPES.has((file.name.split(".").pop() ?? "").toLowerCase());

/**
 * A selected review row → a PO line (D2): the item name, Qty from the sheet's quantity
 * column when there is one else 1, Unit Price blank (0 — the editor shows it empty and
 * required), GST 18. Nothing else from the sheet reaches the line.
 */
export function sheetLine(item: ExtractionView["items"][number]): SheetLine {
  return {
    key: item.id,
    name: item.name,
    quantity: item.quantity && item.quantity > 0 ? item.quantity : 1,
    unitPrice: 0,
    gstRate: 18,
  };
}

interface Props {
  vendorId: string;
  vendorName: string | null;
  extraction: ExtractionView | null;
  onExtractionChange: (next: ExtractionView | null) => void;
  onUseSelected: (lines: SheetLine[]) => void;
  disabled: boolean;
}

/**
 * The one way items get onto a purchase order (R3): the vendor's sheet.
 *
 *   upload  →  columns (the AI's proposal, confirmed by the person)  →  review  →  lines
 *
 * The extraction lives on the server from the moment the headers are read, so a refresh —
 * or a phone that locks during a 40-second AI read — reloads the same step instead of paying
 * for the read again. This component holds only what has not been sent yet: the file, the
 * hint, and which step is on screen.
 */
export function SheetImport({ vendorId, vendorName, extraction, onExtractionChange, onUseSelected, disabled }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [hint, setHint] = useState("");
  const [uploading, setUploading] = useState(false);
  const [confirming, setConfirming] = useState<false | "extract" | "rescue">(false);
  const [discarding, setDiscarding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // After Extract the review is open by default; "Reopen columns" brings the step back.
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);

  const busy = disabled || uploading || confirming !== false || discarding;

  async function upload() {
    if (!file || !vendorId) return;
    setUploading(true);
    setError(null);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("vendorId", vendorId);
    const trimmed = hint.trim().slice(0, HINT_MAX);
    if (trimmed) fd.append("hint", trimmed);
    log.debug("uploading sheet", { vendorId, fileName: file.name, bytes: file.size, hintLength: trimmed.length });
    const { data, error: err } = await apiTry<ExtractionView>("/api/purchase-orders/extract", {
      method: "POST",
      body: fd,
      // An AI read of a PDF is 30–60 s; the default client timeout would give up first.
      timeoutMs: 120_000,
    });
    setUploading(false);
    if (!data) {
      // A refused hint is a 400 with a sentence — shown as-is (R11).
      setError(err ?? "Could not read the file");
      log.error("sheet upload failed", { vendorId, message: err });
      return;
    }
    log.debug("sheet uploaded", { extractionId: data.id, stage: data.stage, sheets: data.sheets.length, items: data.items.length });
    setFile(null);
    setHint("");
    setColumnsOpen(false);
    setReviewOpen(data.stage === "review");
    onExtractionChange(data);
  }

  async function confirmColumns(sheets: SheetColumnsConfirm[], rescue: boolean) {
    if (!extraction) return;
    setConfirming(rescue ? "rescue" : "extract");
    setError(null);
    log.debug("confirming columns", { extractionId: extraction.id, sheets: sheets.length, rescue });
    const { data, error: err } = await apiTry<ExtractionView>(
      `/api/purchase-orders/extract/${encodeURIComponent(extraction.id)}/columns`,
      { method: "POST", json: { sheets, ...(rescue ? { rescue: true } : {}) }, timeoutMs: 120_000 }
    );
    setConfirming(false);
    if (!data) {
      setError(err ?? "Could not extract the rows");
      log.error("column confirm failed", { extractionId: extraction.id, rescue, message: err });
      return;
    }
    log.debug("columns confirmed", { extractionId: data.id, items: data.items.length, source: data.source, rescue });
    setColumnsOpen(false);
    setReviewOpen(true);
    onExtractionChange(data);
  }

  async function discard() {
    if (!extraction) return;
    setDiscarding(true);
    setError(null);
    const { data, error: err } = await apiTry<{ id: string }>(`/api/purchase-orders/extract/${encodeURIComponent(extraction.id)}`, {
      method: "DELETE",
    });
    setDiscarding(false);
    if (!data) {
      setError(err ?? "Could not discard the upload");
      log.error("extraction discard failed", { extractionId: extraction.id, message: err });
      return;
    }
    log.debug("extraction discarded", { extractionId: extraction.id });
    setReviewOpen(false);
    setColumnsOpen(false);
    onExtractionChange(null);
  }

  function useSelected() {
    if (!extraction) return;
    const lines = extraction.items.filter((it) => it.selected).map(sheetLine);
    log.debug("using selected rows", { extractionId: extraction.id, lines: lines.length });
    onUseSelected(lines);
    setReviewOpen(false);
  }

  // ─── no upload yet ────────────────────────────────────────────────────────────────────
  if (!extraction) {
    const aiRead = file ? needsAiRead(file) : false;
    return (
      <div className="rounded-lg border border-dashed border-slate-300 p-3 space-y-2">
        <label className="block text-sm font-medium text-slate-700" htmlFor="sheet-file">
          Upload a sheet from {vendorName ?? "this vendor"} <span className="text-red-500">*</span>
        </label>
        <p className="text-[11px] text-slate-500">
          Excel or CSV: the headers are read first and you confirm which columns hold the items.
          A PDF or photo is read by AI and can take 30–60 seconds.
        </p>
        <input
          id="sheet-file"
          type="file"
          accept={ACCEPTED_SHEET_TYPES}
          disabled={busy}
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setError(null);
          }}
          className="block w-full text-sm text-slate-700 file:mr-3 file:min-h-[44px] file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:text-sm file:font-medium file:text-slate-700"
        />
        <div>
          <label className="block text-[11px] font-medium text-slate-600 mb-0.5" htmlFor="sheet-hint">
            Which column holds the items? (optional)
          </label>
          <Input
            id="sheet-hint"
            value={hint}
            maxLength={HINT_MAX}
            onChange={(e) => setHint(e.target.value)}
            placeholder="e.g. items are in column C"
            disabled={busy}
            className="min-h-[44px]"
          />
        </div>
        {uploading ? (
          <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 text-sm text-blue-900 flex items-start gap-2">
            <Loader2 className="h-4 w-4 animate-spin shrink-0 mt-0.5" />
            <span>
              {aiRead
                ? `Reading ${file?.name ?? "the file"} with AI… this can take 30–60 seconds.`
                : `Reading the sheet's headers from ${file?.name ?? "the file"}…`}{" "}
              Keep this screen open; the result is saved so a refresh will not lose it.
            </span>
          </div>
        ) : (
          <Button type="button" onClick={() => void upload()} disabled={busy || !file} className="min-h-[44px] w-full sm:w-auto">
            <FileUp className="h-4 w-4 mr-1.5" /> Read the sheet
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

  // ─── the upload belongs to another vendor ─────────────────────────────────────────────
  if (extraction.vendorId !== vendorId) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-2">
        <p className="text-sm text-amber-900">
          The sheet <span className="font-semibold">{extraction.fileName}</span> was uploaded for{" "}
          <span className="font-semibold">{extraction.vendorName}</span>. Switch the vendor back to continue with it, or discard it.
        </p>
        <Button type="button" variant="outline" onClick={() => void discard()} disabled={busy} className="min-h-[44px]">
          {discarding ? <Loader2 className="h-4 w-4 animate-spin" /> : "Discard that sheet"}
        </Button>
        {error && <p className="text-xs text-red-700">{error}</p>}
      </div>
    );
  }

  // ─── the column step ──────────────────────────────────────────────────────────────────
  if (extraction.stage === "columns" || columnsOpen) {
    return (
      <ColumnsStep
        // Keyed on the extraction so a fresh upload starts from its own proposal.
        key={extraction.id}
        sheets={extraction.sheets}
        legend={extraction.legend}
        busy={busy}
        rescuing={confirming === "rescue"}
        error={error}
        onExtract={(sheets, rescue) => void confirmColumns(sheets, rescue)}
        onDiscard={() => void discard()}
      />
    );
  }

  // ─── extracted: the summary card, with the review dialog on top ───────────────────────
  const selectedCount = extraction.items.filter((it) => it.selected).length;
  const canReopenColumns = extraction.sheets.length > 0;
  const sourceLabel = extraction.source === "ai" ? `Read by AI${extraction.aiModel ? ` · ${extraction.aiModel}` : ""}` : "Read from the sheet";

  return (
    <div className="rounded-lg border border-slate-200 p-3 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-900 truncate">{extraction.fileName}</p>
          <p className="text-[11px] text-slate-500 tabular-nums">
            {sourceLabel} · {extraction.items.length} row{extraction.items.length === 1 ? "" : "s"} · {selectedCount} selected
          </p>
        </div>
        <button
          type="button"
          onClick={() => void discard()}
          disabled={busy}
          aria-label="Discard this sheet and its rows"
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

      {extraction.items.length === 0 ? (
        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2">
          No rows were extracted. {canReopenColumns ? "Reopen the columns and check the header row, or read it with AI." : "Try another file."}
        </p>
      ) : (
        <Button type="button" variant="outline" onClick={() => setReviewOpen(true)} disabled={busy} className="min-h-[44px] w-full tabular-nums">
          Review {extraction.items.length} row{extraction.items.length === 1 ? "" : "s"}
        </Button>
      )}

      <Button
        type="button"
        onClick={useSelected}
        disabled={busy || selectedCount === 0}
        className="min-h-[48px] w-full bg-blue-600 hover:bg-blue-700 text-white tabular-nums"
      >
        Use {selectedCount} selected row{selectedCount === 1 ? "" : "s"}
      </Button>
      {selectedCount === 0 && extraction.items.length > 0 && (
        <p className="text-[11px] text-slate-500 text-center">Open the review and tick the rows to order.</p>
      )}
      {canReopenColumns && (
        <button
          type="button"
          onClick={() => setColumnsOpen(true)}
          disabled={busy}
          className="min-h-[44px] text-xs font-medium text-blue-700 underline disabled:opacity-40"
        >
          Reopen columns
        </button>
      )}

      {reviewOpen && (
        <SheetReview
          extraction={extraction}
          busy={busy}
          onClose={() => setReviewOpen(false)}
          onChange={onExtractionChange}
          onUseSelected={useSelected}
          onReopenColumns={
            canReopenColumns
              ? () => {
                  setReviewOpen(false);
                  setColumnsOpen(true);
                }
              : null
          }
          onDiscard={() => void discard()}
        />
      )}
    </div>
  );
}
