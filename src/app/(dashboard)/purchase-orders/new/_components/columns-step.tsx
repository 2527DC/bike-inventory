"use client";

import { useState } from "react";
import { AlertTriangle, Loader2, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  COLUMN_ROLES,
  COLUMN_ROLE_LABELS,
  type ColumnRole,
  type LegendEntry,
  type SheetColumns,
  type SheetColumnsConfirm,
} from "@/lib/po-extraction/types";

/** One sheet's editable state: the header row and a role per column index. */
interface SheetDraft {
  sheet: string;
  headerRow: number;
  roles: Record<number, ColumnRole>;
}

function draftFrom(sheets: SheetColumns[]): SheetDraft[] {
  return sheets.map((s) => ({
    sheet: s.sheet,
    headerRow: s.headerRow,
    roles: Object.fromEntries(s.columns.map((c) => [c.index, c.role])) as Record<number, ColumnRole>,
  }));
}

/** Spreadsheet column letter for a 0-based index: 0 → A, 26 → AA. */
export function columnLetter(index: number): string {
  let n = index;
  let out = "";
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

interface Props {
  sheets: SheetColumns[];
  legend: LegendEntry[];
  /** Everything disabled while the parent has a request in flight. */
  busy: boolean;
  /** True while the rescue (whole-sheet AI) read runs — changes the waiting words. */
  rescuing: boolean;
  error: string | null;
  onExtract: (sheets: SheetColumnsConfirm[], rescue: boolean) => void;
  onDiscard: () => void;
}

/**
 * The column step — R6: "after upload it must ask the column name where the items are".
 *
 * The AI has already proposed a header row and a role per column for every sheet
 * (plan 0909-po-sheet-ai-extraction, §3.2 step 2). This screen shows that proposal on top
 * of the sheet's own first rows so the person can see whether it is right, change any role
 * or the header row, and press Extract. Nothing is extracted until they do.
 *
 * A sheet with no "Item name" column cannot be extracted (§3.2 step 3): without it there is
 * nothing to put on a PO line, so Extract stays disabled and the sheet says why.
 *
 * ─── THE RESCUE LINK ─────────────────────────────────────────────────────────────────────
 * "This is wrong — read it with AI" is always shown, as a secondary link under Extract,
 * rather than only after a second failed attempt. The person who can see the proposal is
 * wrong does not want to press Extract twice to earn the alternative; and the link says
 * what it costs (30–60 s, no row colours) so nobody reaches for it by reflex.
 */
export function ColumnsStep({ sheets, legend, busy, rescuing, error, onExtract, onDiscard }: Props) {
  const [drafts, setDrafts] = useState<SheetDraft[]>(() => draftFrom(sheets));

  const missingItem = drafts.filter((d) => !Object.values(d.roles).includes("itemName")).map((d) => d.sheet);
  const canExtract = !busy && drafts.length > 0 && missingItem.length === 0;

  const confirm = (): SheetColumnsConfirm[] =>
    drafts.map((d) => ({
      sheet: d.sheet,
      headerRow: d.headerRow,
      columns: Object.entries(d.roles).map(([index, role]) => ({ index: Number(index), role })),
    }));

  const setRole = (sheetIdx: number, colIndex: number, role: ColumnRole) =>
    setDrafts((prev) =>
      prev.map((d, i) => {
        if (i !== sheetIdx) return d;
        const roles = { ...d.roles, [colIndex]: role };
        // One item-name column per sheet: choosing it on column C takes it off column A,
        // which is what a person changing their mind means. The old column becomes "Other".
        if (role === "itemName") {
          for (const k of Object.keys(roles)) {
            const key = Number(k);
            if (key !== colIndex && roles[key] === "itemName") roles[key] = "other";
          }
        }
        return { ...d, roles };
      })
    );

  const setHeaderRow = (sheetIdx: number, oneBased: number) =>
    setDrafts((prev) => prev.map((d, i) => (i === sheetIdx ? { ...d, headerRow: Math.max(0, oneBased - 1) } : d)));

  return (
    <div className="rounded-lg border border-slate-200 p-3 space-y-4">
      <div>
        <p className="text-sm font-semibold text-slate-900">Which columns hold the items?</p>
        <p className="text-[11px] text-slate-500 mt-0.5">
          This is what was read from the sheet&apos;s headers. Change anything that is wrong, then press Extract.
          Only the item name and a quantity reach the purchase order; the other columns are shown for choosing.
        </p>
      </div>

      {legend.length > 0 && (
        <div className="rounded-lg bg-slate-50 border border-slate-200 p-2.5">
          <p className="text-[11px] font-medium text-slate-600 mb-1.5">Colour legend found in the sheet</p>
          <div className="flex flex-wrap gap-2">
            {legend.map((l) => (
              <span key={l.rgb} className="inline-flex items-center gap-1.5 text-xs text-slate-700">
                <span className="h-3.5 w-3.5 rounded-sm border border-black/10 shrink-0" style={{ background: `#${l.rgb}` }} aria-hidden />
                {l.label}
              </span>
            ))}
          </div>
        </div>
      )}

      {sheets.map((sheet, sheetIdx) => {
        const draft = drafts[sheetIdx];
        if (!draft) return null;
        const preview = sheet.preview ?? [];
        const columns = [...sheet.columns].sort((a, b) => a.index - b.index);
        const headerCells = preview[draft.headerRow] ?? [];
        const noItem = missingItem.includes(sheet.sheet);
        const previewLimit = Math.min(preview.length, draft.headerRow + 6);

        return (
          <div key={sheet.sheet} className="space-y-2">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-900 break-words">
                  {sheets.length > 1 ? `Sheet: ${sheet.sheet}` : sheet.sheet}
                </p>
                {typeof sheet.dataRowEstimate === "number" && (
                  <p className="text-[11px] text-slate-500 tabular-nums">About {sheet.dataRowEstimate} rows below the header</p>
                )}
              </div>
              <label className="flex items-center gap-2 text-xs text-slate-700">
                Header is row
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={Math.max(1, preview.length)}
                  value={draft.headerRow + 1}
                  onChange={(e) => setHeaderRow(sheetIdx, parseInt(e.target.value, 10) || 1)}
                  disabled={busy}
                  aria-label={`Header row of ${sheet.sheet}, counted from 1`}
                  className="w-16 min-h-[44px] rounded-lg border border-slate-300 px-2 text-sm text-center tabular-nums focus:outline-none focus:ring-2 focus:ring-slate-900 disabled:opacity-60"
                />
              </label>
            </div>

            {noItem && (
              <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2 flex items-start gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span>No column is marked <span className="font-semibold">Item name</span>. Choose one before extracting this sheet.</span>
              </p>
            )}

            {/* The preview scrolls sideways inside its own box — a 11-column sheet on a 375 px
                phone must never widen the page. */}
            <div className="overflow-x-auto rounded-lg border border-slate-200 -mx-1 sm:mx-0">
              <table className="text-xs border-collapse min-w-full">
                <thead>
                  <tr className="bg-white">
                    <th className="sticky left-0 z-10 bg-white px-2 py-1.5 text-left text-[10px] font-medium text-slate-400 w-10">#</th>
                    {columns.map((col) => (
                      <th key={col.index} className="px-1.5 py-1.5 text-left align-bottom min-w-[8rem]">
                        <p className="text-[10px] text-slate-400 font-normal mb-0.5">
                          {columnLetter(col.index)}
                          {headerCells[col.index] ? ` · ${headerCells[col.index]}` : col.header ? ` · ${col.header}` : ""}
                        </p>
                        <select
                          value={draft.roles[col.index] ?? "other"}
                          onChange={(e) => setRole(sheetIdx, col.index, e.target.value as ColumnRole)}
                          disabled={busy}
                          aria-label={`Role of column ${columnLetter(col.index)} in ${sheet.sheet}`}
                          className={`w-full min-h-[44px] rounded-lg border px-2 text-xs font-medium bg-white focus:outline-none focus:ring-2 focus:ring-slate-900 disabled:opacity-60 ${
                            draft.roles[col.index] === "itemName"
                              ? "border-blue-400 text-blue-900"
                              : draft.roles[col.index] === "ignore"
                                ? "border-slate-200 text-slate-400"
                                : "border-slate-300 text-slate-700"
                          }`}
                        >
                          {COLUMN_ROLES.map((r) => (
                            <option key={r} value={r}>{COLUMN_ROLE_LABELS[r]}</option>
                          ))}
                        </select>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.length === 0 && (
                    <tr>
                      <td colSpan={columns.length + 1} className="px-2 py-3 text-center text-slate-400">
                        No preview rows were returned for this sheet.
                      </td>
                    </tr>
                  )}
                  {preview.slice(0, previewLimit).map((row, r) => {
                    const isHeader = r === draft.headerRow;
                    return (
                      <tr key={r} className={isHeader ? "bg-blue-50 font-semibold text-blue-900" : r < draft.headerRow ? "text-slate-400" : "text-slate-700"}>
                        <td className={`sticky left-0 z-10 px-2 py-1 tabular-nums text-[10px] ${isHeader ? "bg-blue-50" : "bg-white"}`}>{r + 1}</td>
                        {columns.map((col) => (
                          <td key={col.index} className="px-1.5 py-1 whitespace-nowrap max-w-[14rem] overflow-hidden text-ellipsis">
                            {row[col.index] ?? ""}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {preview.length > previewLimit && (
              <p className="text-[10px] text-slate-400">Showing the first {previewLimit} of {preview.length} preview rows.</p>
            )}
          </div>
        );
      })}

      {error && (
        <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-2 flex items-start gap-1.5">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span className="break-words">{error}</span>
        </p>
      )}

      {busy && (
        <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 text-sm text-blue-900 flex items-start gap-2">
          <Loader2 className="h-4 w-4 animate-spin shrink-0 mt-0.5" />
          <span>
            {rescuing
              ? "Reading the whole sheet with AI… this can take 30–60 seconds. Keep this screen open; the result is saved so a refresh will not lose it."
              : "Extracting the rows from the sheet…"}
          </span>
        </div>
      )}

      <div className="space-y-2">
        <Button
          type="button"
          onClick={() => onExtract(confirm(), false)}
          disabled={!canExtract}
          className="min-h-[48px] w-full bg-blue-600 hover:bg-blue-700 text-white"
        >
          {busy && !rescuing ? <Loader2 className="h-4 w-4 animate-spin" /> : "Extract"}
        </Button>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => onExtract(confirm(), true)}
            disabled={busy || drafts.length === 0}
            className="inline-flex items-center gap-1.5 min-h-[44px] text-xs font-medium text-blue-700 underline disabled:opacity-40"
          >
            <Sparkles className="h-3.5 w-3.5" /> This is wrong — read it with AI
          </button>
          <button
            type="button"
            onClick={onDiscard}
            disabled={busy}
            className="inline-flex items-center gap-1 min-h-[44px] px-2 text-xs font-medium text-red-600 hover:text-red-700 disabled:opacity-40"
          >
            <Trash2 className="h-4 w-4" /> Discard
          </button>
        </div>
        <p className="text-[10px] text-slate-400">
          The AI read takes 30–60 seconds and the rows come back without their sheet colours.
        </p>
      </div>
    </div>
  );
}
