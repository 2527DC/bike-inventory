/**
 * Sheet extraction for a purchase order — plan 0909-po-sheet-ai-extraction-and-catalogue-
 * free-lines, §3.2. Replaces `excel-parser.ts` for this flow (that file stays; other code
 * imports it).
 *
 * Three steps, two of them here:
 *   1. `proposeColumns` — the AI reads the top of every sheet and names the header row, a
 *      role per column and the colour legend. One small call per sheet (D1, Q1 c).
 *   2. The person confirms on screen (R6) — not this module.
 *   3. `extractRows` — code reads every row below the header with its fill colour. No AI,
 *      no row cap, no "drop qty 0" (the three defects of the old parser, §2.7).
 * `extractRowsWithAi` is the rescue: the whole workbook as CSV, rows back as JSON, no
 * colours.
 *
 * The workbook is read with `cellStyles: true` — the same library as before, one option —
 * which is what makes R7 (the row's colour) possible: `cell.s.fgColor.rgb` is populated.
 * The colour that matters is the ITEM-NAME cell's (§2.6: column F of the sample is coloured
 * by scheme, not by stock).
 *
 * Logging (§3.8): sheet names, counts, header rows and colour counts — never the hint text,
 * never a row.
 */
import * as XLSX from "xlsx";
import { createLogger } from "@/lib/logger";
import { aiErrorKind, runAi } from "@/lib/ai";
import {
  buildColumnsPrompt,
  buildRowsPrompt,
  COLUMNS_SCHEMA,
  COLUMNS_SYSTEM_PROMPT,
  normaliseRgb,
  ROWS_SCHEMA,
  ROWS_SYSTEM_PROMPT,
  sanitizeHint,
  validateColumnsReply,
  validateRowsReply,
} from "./prompts";
import type { ColumnProposal, ColumnRole, LegendEntry, SheetColumns, SheetColumnsConfirm } from "./types";

const log = createLogger("po-extraction:sheet");

export { sanitizeHint };

export const SHEET_EXTENSIONS: readonly string[] = ["xlsx", "xls", "csv"];

/** Rows the column step shows the model and the person. Plan §3.2 (2). */
const PREVIEW_ROWS = 25;
/** Tail rows added to the model's view so a TOTAL row is visible. */
const TAIL_ROWS = 3;
/** A cell longer than this is cut in the model's grid — headers and names are short. */
const GRID_CELL_CHARS = 60;

export interface ExtractedRow {
  sheetName: string;
  /** 0-based row index in its sheet. For the rescue path, the row's position in the reply. */
  rowIndex: number;
  name: string;
  quantity: number | null;
  /** The item-name cell's solid fill, six upper-case hex digits, or null (none, or white). */
  rowColor: string | null;
  /** Every column whose confirmed role is not `ignore`, in sheet order. */
  columns: Array<{ header: string; value: string }>;
  sortOrder: number;
}

/**
 * `SheetColumns` plus the totals-row text the AI named. The shared type has no slot for it,
 * so it rides along as an optional extra: a confirmation that still carries it skips that
 * row too, one that does not still skips TOTAL / GRAND TOTAL.
 */
export type SheetColumnsProposal = SheetColumns & { totalsRowHint?: string | null };
export type SheetColumnsConfirmInput = SheetColumnsConfirm & { totalsRowHint?: string | null };

// ─── Reading the workbook ─────────────────────────────────────────────────────

interface ReadSheet {
  name: string;
  ws: XLSX.WorkSheet;
  /** Every cell as text, every row padded to `width`, merged ranges filled from their anchor. */
  grid: string[][];
  width: number;
  rowCount: number;
  /** Index of the last row with any non-empty cell, -1 when the sheet is blank. */
  lastRow: number;
  merges: XLSX.Range[];
}

function readWorkbook(buffer: ArrayBuffer, fileName: string): XLSX.WorkBook {
  const isCsv = fileName.toLowerCase().endsWith(".csv");
  const wb = isCsv
    ? XLSX.read(new TextDecoder("utf-8").decode(buffer), { type: "string" })
    : XLSX.read(buffer, { type: "array", cellStyles: true });
  if (wb.SheetNames.length === 0) {
    log.warn("workbook has no sheets", { ext: fileName.toLowerCase().split(".").pop() ?? "" });
    throw new Error("No sheets found in file");
  }
  return wb;
}

/** A cell value as the text the person would see — numbers plain, no exponent noise. */
function cellText(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(parseFloat(v.toFixed(6)));
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? "" : v.toISOString().slice(0, 10);
  return String(v).trim();
}

function readSheet(name: string, ws: XLSX.WorkSheet): ReadSheet {
  const ref = ws["!ref"] ? XLSX.utils.decode_range(ws["!ref"]) : null;
  // Anchor the grid at A1. `sheet_to_json` otherwise starts at the used range's first cell
  // (`!ref` is "B2:K400" when column A and row 1 are empty), while every cell lookup below —
  // fills, merges, header letters — is absolute; the two would disagree by the offset and the
  // colour would be read from the wrong cell (review finding 1, 9 Sep 2026).
  const raw: unknown[][] = XLSX.utils.sheet_to_json(ws, {
    header: 1,
    defval: "",
    ...(ref ? { range: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: ref.e }) } : {}),
  });
  const width = Math.max(ref ? ref.e.c + 1 : 0, ...raw.map((r) => (Array.isArray(r) ? r.length : 0)), 0);

  const grid: string[][] = raw.map((r) => {
    const row = new Array<string>(width).fill("");
    if (Array.isArray(r)) for (let c = 0; c < Math.min(r.length, width); c++) row[c] = cellText(r[c]);
    return row;
  });

  // A merged range reads as its anchor everywhere it covers, so a header merged over two
  // columns names both, and a title band merged across the sheet is visibly one thing.
  const merges = ws["!merges"] ?? [];
  for (const m of merges) {
    const anchor = grid[m.s.r]?.[m.s.c] ?? "";
    if (!anchor) continue;
    for (let r = m.s.r; r <= m.e.r; r++) {
      if (!grid[r]) continue;
      for (let c = m.s.c; c <= m.e.c; c++) if (c < width && !grid[r][c]) grid[r][c] = anchor;
    }
  }

  let lastRow = grid.length - 1;
  while (lastRow >= 0 && grid[lastRow].every((v) => v === "")) lastRow -= 1;

  return { name, ws, grid, width, rowCount: grid.length, lastRow, merges };
}

/** The solid fill of one cell as six upper-case hex digits; null for none, white, or a theme colour. */
function fillOf(ws: XLSX.WorkSheet, r: number, c: number): string | null {
  const cell = ws[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined;
  const s = cell?.s as { patternType?: string; fgColor?: { rgb?: unknown } } | undefined;
  if (!s || s.patternType !== "solid") return null;
  const rgb = normaliseRgb(s.fgColor?.rgb);
  return rgb && rgb !== "FFFFFF" ? rgb : null;
}

/** True when (r, c) sits inside a merge that spans more than one column — a band, not a value. */
function inMultiColumnMerge(merges: XLSX.Range[], r: number, c: number): boolean {
  return merges.some((m) => m.e.c > m.s.c && r >= m.s.r && r <= m.e.r && c >= m.s.c && c <= m.e.c);
}

// ─── The model's view of a sheet ─────────────────────────────────────────────

function gridCell(text: string): string {
  const flat = text.replace(/[\r\n\t|]+/g, " ").trim();
  return flat.length > GRID_CELL_CHARS ? `${flat.slice(0, GRID_CELL_CHARS - 1)}…` : flat;
}

function renderRow(sheet: ReadSheet, r: number): string {
  const cells: string[] = [];
  for (let c = 0; c < sheet.width; c++) {
    const text = gridCell(sheet.grid[r][c]);
    const fill = fillOf(sheet.ws, r, c);
    if (!text && !fill) continue;
    cells.push(`${c}:${text}${fill ? `{fill:${fill}}` : ""}`);
  }
  return `r${r} | ${cells.join(" | ")}`;
}

/** The first 25 rows plus the last 3, indexed, one line each. */
function renderGrid(sheet: ReadSheet): string {
  const total = sheet.lastRow + 1;
  const head = Math.min(PREVIEW_ROWS, total);
  const lines = [
    `sheet "${sheet.name}": ${total} rows x ${sheet.width} columns (0-based row and column indexes; blank cells omitted)`,
    sheet.merges.length
      ? `merged ranges: ${sheet.merges.map((m) => XLSX.utils.encode_range(m)).join(", ")}`
      : "merged ranges: none",
  ];
  for (let r = 0; r < head; r++) lines.push(renderRow(sheet, r));
  if (total > head) {
    const tailStart = Math.max(head, total - TAIL_ROWS);
    if (tailStart > head) lines.push(`… rows ${head}-${tailStart - 1} omitted …`);
    for (let r = tailStart; r < total; r++) lines.push(renderRow(sheet, r));
  }
  return lines.join("\n");
}

function previewOf(sheet: ReadSheet): string[][] {
  return sheet.grid.slice(0, Math.min(PREVIEW_ROWS, sheet.rowCount));
}

function headerOf(sheet: ReadSheet, headerRow: number, index: number): string {
  return sheet.grid[headerRow]?.[index] ?? "";
}

/** Every solid fill that appears in the first 25 rows — the set a claimed legend must be in. */
function fillsInPreview(sheet: ReadSheet): Set<string> {
  const fills = new Set<string>();
  for (let r = 0; r < Math.min(PREVIEW_ROWS, sheet.rowCount); r++) {
    for (let c = 0; c < sheet.width; c++) {
      const f = fillOf(sheet.ws, r, c);
      if (f) fills.add(f);
    }
  }
  return fills;
}

function mergeLegend(into: LegendEntry[], entries: LegendEntry[]): void {
  for (const e of entries) if (!into.some((x) => x.rgb === e.rgb)) into.push(e);
}

// ─── Step 1: the column step ─────────────────────────────────────────────────

/**
 * One AI call per sheet, sequential: header row, a role per column, the legend when the
 * sheet has one. The legend is kept only where a cell in the first 25 rows really carries
 * that fill. A sheet with no rows is skipped. AiError / AiNotConfiguredError propagate so
 * the route can answer with the right status.
 */
export async function proposeColumns(
  buffer: ArrayBuffer,
  fileName: string,
  hint: string | null,
): Promise<{ sheets: SheetColumnsProposal[]; legend: LegendEntry[]; aiModel: string | null }> {
  const wb = readWorkbook(buffer, fileName);
  const sheets: SheetColumnsProposal[] = [];
  const legend: LegendEntry[] = [];
  let aiModel: string | null = null;

  for (const name of wb.SheetNames) {
    const sheet = readSheet(name, wb.Sheets[name]);
    if (sheet.lastRow < 0 || sheet.width === 0) {
      log.debug("sheet is empty, skipped", { sheet: name });
      continue;
    }

    const grid = renderGrid(sheet);
    const prompt = buildColumnsPrompt(grid, hint);
    log.debug("-> runAi po.sheet_columns", {
      sheet: name,
      rows: sheet.lastRow + 1,
      width: sheet.width,
      gridChars: grid.length,
      hintLength: hint?.length ?? 0,
    });

    let result;
    try {
      result = await runAi({
        purpose: "po.sheet_columns",
        system: COLUMNS_SYSTEM_PROMPT,
        prompt,
        jsonSchema: COLUMNS_SCHEMA,
        effort: "low",
        maxTokens: 2000,
      });
    } catch (error) {
      log.error("column proposal failed", { sheet: name, kind: aiErrorKind(error) });
      throw error;
    }
    aiModel = result.model;

    const reply = validateColumnsReply(result.json, { width: sheet.width, rowCount: sheet.rowCount });
    const fills = fillsInPreview(sheet);
    const verified = reply.legend.filter((e) => fills.has(e.rgb));
    if (verified.length !== reply.legend.length) {
      log.debug("legend entries without a matching fill dropped", {
        sheet: name,
        claimed: reply.legend.length,
        kept: verified.length,
      });
    }

    const roleAt = new Map(reply.columns.map((c) => [c.index, c.role]));
    const columns: ColumnProposal[] = [];
    for (let index = 0; index < sheet.width; index++) {
      columns.push({ index, header: headerOf(sheet, reply.headerRow, index), role: roleAt.get(index) ?? "ignore" });
    }
    if (!roleAt.size || !reply.columns.some((c) => c.role === "itemName")) {
      log.warn("no item-name column proposed — the person must choose one", { sheet: name, headerRow: reply.headerRow });
    }

    sheets.push({
      sheet: name,
      headerRow: reply.headerRow,
      columns,
      legend: verified,
      preview: previewOf(sheet),
      dataRowEstimate: Math.max(0, sheet.lastRow - reply.headerRow),
      totalsRowHint: reply.totalsRowHint,
    });
    mergeLegend(legend, verified);

    log.debug("columns proposed", {
      sheet: name,
      rows: sheet.lastRow + 1,
      headerRow: reply.headerRow,
      colours: fills.size,
      roles: reply.columns.length,
      legend: verified.length,
      model: result.model,
    });
  }

  log.info("column step finished", { sheets: sheets.length, legend: legend.length, model: aiModel });
  return { sheets, legend, aiModel };
}

// ─── Step 3: the deterministic read ──────────────────────────────────────────

function parseQuantity(text: string): number | null {
  if (!text) return null;
  const n = Number(text.replace(/[,\s]/g, ""));
  if (!Number.isFinite(n)) return null;
  const q = Math.trunc(n);
  return q > 0 ? q : null;
}

function isTotalsRow(firstCell: string, itemCell: string, hint: string | null): boolean {
  const first = firstCell.toUpperCase();
  const item = itemCell.toUpperCase();
  if (first === "TOTAL" || first === "GRAND TOTAL" || item === "TOTAL" || item === "GRAND TOTAL") return true;
  if (hint) {
    const h = hint.toUpperCase();
    return first === h || item === h;
  }
  return false;
}

/**
 * Every row below the confirmed header, with the item-name cell's colour. No AI. A sheet
 * named in the confirmation but missing from the file is an error (the file changed under
 * the review); a sheet confirmed without an item-name column is skipped with a warning (the
 * screen refuses that case — §3.2 (3) — so reaching it means a bypassed client).
 */
export function extractRows(
  buffer: ArrayBuffer,
  fileName: string,
  confirmed: SheetColumnsConfirmInput[],
  legend: LegendEntry[],
): { rows: ExtractedRow[]; sheets: SheetColumns[] } {
  const wb = readWorkbook(buffer, fileName);
  const rows: ExtractedRow[] = [];
  const sheets: SheetColumns[] = [];
  let sortOrder = 0;

  for (const conf of confirmed) {
    const ws = wb.Sheets[conf.sheet];
    if (!ws) {
      log.error("confirmed sheet is not in the workbook", { sheet: conf.sheet, sheets: wb.SheetNames.length });
      throw new Error(`Sheet "${conf.sheet}" is not in the uploaded file.`);
    }
    const sheet = readSheet(conf.sheet, ws);

    const roleAt = new Map<number, ColumnRole>();
    for (const c of conf.columns) if (Number.isInteger(c.index) && c.index >= 0 && c.index < sheet.width) roleAt.set(c.index, c.role);
    const nameCol = [...roleAt.entries()].find(([, role]) => role === "itemName")?.[0];
    const qtyCol = [...roleAt.entries()].find(([, role]) => role === "quantity")?.[0];
    const shown = [...roleAt.entries()].filter(([, role]) => role !== "ignore").map(([index]) => index).sort((a, b) => a - b);

    const headerRow = conf.headerRow;
    const columns: ColumnProposal[] = [];
    for (let index = 0; index < sheet.width; index++) {
      columns.push({ index, header: headerOf(sheet, headerRow, index), role: roleAt.get(index) ?? "ignore" });
    }
    const fills = fillsInPreview(sheet);
    const echoed: SheetColumns = {
      sheet: conf.sheet,
      headerRow,
      columns,
      legend: legend.filter((e) => fills.has(e.rgb)),
      preview: previewOf(sheet),
      dataRowEstimate: Math.max(0, sheet.lastRow - headerRow),
    };
    sheets.push(echoed);

    if (nameCol === undefined) {
      log.warn("sheet confirmed without an item-name column — skipped", { sheet: conf.sheet, headerRow });
      continue;
    }
    if (!Number.isInteger(headerRow) || headerRow < 0 || headerRow > sheet.lastRow) {
      log.warn("confirmed header row is outside the sheet — skipped", { sheet: conf.sheet, headerRow, rows: sheet.lastRow + 1 });
      continue;
    }

    const headers = shown.map((index) => headerOf(sheet, headerRow, index) || XLSX.utils.encode_col(index));
    const hint = conf.totalsRowHint ?? null;
    let colours = 0;
    let skippedTotals = 0;
    let skippedBands = 0;
    let added = 0;

    for (let r = headerRow + 1; r <= sheet.lastRow; r++) {
      const row = sheet.grid[r];
      const name = row[nameCol];
      if (!name) continue;
      const firstCell = row.find((v) => v !== "") ?? "";
      if (isTotalsRow(firstCell, name, hint)) {
        skippedTotals += 1;
        continue;
      }
      if (inMultiColumnMerge(sheet.merges, r, nameCol)) {
        skippedBands += 1;
        continue;
      }
      const rowColor = fillOf(ws, r, nameCol);
      if (rowColor) colours += 1;
      rows.push({
        sheetName: conf.sheet,
        rowIndex: r,
        name,
        quantity: qtyCol === undefined ? null : parseQuantity(row[qtyCol]),
        rowColor,
        columns: shown.map((index, i) => ({ header: headers[i], value: row[index] })),
        sortOrder: sortOrder++,
      });
      added += 1;
    }

    log.debug("sheet extracted", {
      sheet: conf.sheet,
      rows: added,
      headerRow,
      colours,
      skippedTotals,
      skippedBands,
      shownColumns: shown.length,
      hasQuantity: qtyCol !== undefined,
    });
  }

  log.info("rows extracted", { sheets: sheets.length, rows: rows.length });
  return { rows, sheets };
}

// ─── The rescue path ─────────────────────────────────────────────────────────

/**
 * The whole workbook as CSV, one block per sheet, rows back as JSON. No cap on the input —
 * its size is logged instead — and no colours (`rowColor` is null on every row; the review
 * says so). AiError propagates.
 */
export async function extractRowsWithAi(
  buffer: ArrayBuffer,
  fileName: string,
): Promise<{ rows: ExtractedRow[]; aiModel: string | null }> {
  const wb = readWorkbook(buffer, fileName);
  const csvSheets: Array<{ name: string; csv: string }> = [];
  for (const name of wb.SheetNames) {
    const csv = XLSX.utils.sheet_to_csv(wb.Sheets[name], { blankrows: false });
    if (!csv.trim()) {
      log.debug("sheet is empty, skipped", { sheet: name });
      continue;
    }
    csvSheets.push({ name, csv });
  }
  if (csvSheets.length === 0) throw new Error("The file has no rows to read.");

  const prompt = buildRowsPrompt(csvSheets);
  log.info("-> runAi po.sheet_rows", {
    sheets: csvSheets.length,
    csvChars: csvSheets.reduce((n, s) => n + s.csv.length, 0),
    promptChars: prompt.length,
  });

  let result;
  try {
    result = await runAi({
      purpose: "po.sheet_rows",
      system: ROWS_SYSTEM_PROMPT,
      prompt,
      jsonSchema: ROWS_SCHEMA,
      maxTokens: 16000,
    });
  } catch (error) {
    log.error("row extraction failed", { sheets: csvSheets.length, kind: aiErrorKind(error) });
    throw error;
  }

  const replyRows = validateRowsReply(result.json, csvSheets.map((s) => s.name));
  const rows: ExtractedRow[] = replyRows.map((r, i) => ({
    sheetName: r.sheet,
    rowIndex: i,
    name: r.name,
    quantity: r.quantity,
    rowColor: null,
    columns: r.columns,
    sortOrder: i,
  }));

  log.info("rows extracted by ai", { sheets: csvSheets.length, rows: rows.length, model: result.model });
  return { rows, aiModel: result.model };
}
