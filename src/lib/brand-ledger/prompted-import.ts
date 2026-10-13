// ─── Prompted import: the shapes and the pure code shared by browser and server ─────────
// Plan 1310-ledger-prompted-import-without-file-storage (R1–R7).
//
// PURE: no Prisma, no network, no Node APIs — the review page imports this to re-apply a
// corrected column mapping instantly, and the server imports it to apply the AI's plan. The
// only runtime dependencies are zod and the type-only reconcile helpers.
//
// The rule that shapes it: for a SHEET the AI writes a PLAN (which sheet, which header row,
// what each column means) and THIS code applies it to every row, so every amount comes from a
// cell, never re-typed by a model. Text, images and PDFs have no cells; there the AI types the
// rows and every one is flagged `aiTyped` for the review page.
import { z } from "zod";
import type { LedgerEntryType } from "@prisma/client";
import { checkBalance, classifyEntry, parseAmount, sideForType } from "./reconcile";

// ─── Limits ───────────────────────────────────────────────────────────────────

/** Text typed, pasted, or read out of a .txt / .zip chat / .docx in the browser. */
export const IMPORT_TEXT_MAX_CHARS = 200_000;
/** Rows read per sheet in the browser; more is refused with a sentence, never cut silently. */
export const IMPORT_SHEET_MAX_ROWS = 5_000;
export const IMPORT_SHEET_MAX_SHEETS = 10;
/**
 * An image (already downscaled in the browser) or a PDF, sent as base64 in a JSON body. A
 * Vercel function takes ~4.5 MB of body; 3 MB raw is ~4 MB of base64 (plan Q3).
 */
export const IMPORT_ATTACHMENT_MAX_BYTES = 3 * 1024 * 1024;
/** Rows of each sheet the planning call sees. The plan is applied to all of them in code. */
export const IMPORT_PREVIEW_ROWS = 40;
export const IMPORT_PROMPT_MAX_CHARS = 2000;

export const IMPORT_ATTACHMENT_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"] as const;
export type ImportAttachmentType = (typeof IMPORT_ATTACHMENT_TYPES)[number];

// ─── Input — what crosses the wire (never stored as a file, R6) ──────────────

export interface ImportSheet {
  name: string;
  /** Cell text, row by row. Dates already rendered YYYY-MM-DD by `cellText`. */
  rows: string[][];
}

export type ImportInput =
  | { kind: "sheet"; fileName: string; sheets: ImportSheet[] }
  | { kind: "text"; fileName: string | null; text: string }
  | { kind: "attachment"; fileName: string; mediaType: ImportAttachmentType; base64: string };

/** What a run keeps for "re-run with a new prompt": cells or text, never an attachment (R6). */
export type ImportSource = Extract<ImportInput, { kind: "sheet" | "text" }>;

const cell = z.string().max(2000);
export const importInputSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("sheet"),
    fileName: z.string().trim().min(1).max(200),
    sheets: z
      .array(
        z.object({
          name: z.string().max(100),
          rows: z.array(z.array(cell).max(200)).max(IMPORT_SHEET_MAX_ROWS, `A sheet can have at most ${IMPORT_SHEET_MAX_ROWS} rows — split the file`),
        })
      )
      .min(1, "The workbook has no sheets")
      .max(IMPORT_SHEET_MAX_SHEETS, `At most ${IMPORT_SHEET_MAX_SHEETS} sheets at a time`),
  }),
  z.object({
    kind: z.literal("text"),
    fileName: z.string().trim().max(200).nullable(),
    text: z.string().trim().min(1, "There is no text to read").max(IMPORT_TEXT_MAX_CHARS, "The text is too long — split it into parts"),
  }),
  z.object({
    kind: z.literal("attachment"),
    fileName: z.string().trim().min(1).max(200),
    mediaType: z.enum(IMPORT_ATTACHMENT_TYPES),
    base64: z
      .string()
      .min(1)
      .max(Math.ceil((IMPORT_ATTACHMENT_MAX_BYTES * 4) / 3) + 8, "The file is over 3 MB. Send a photo of each page, or split the PDF."),
  }),
]);

/** The import body: the input plus the owner's prompt (the direction, R7). */
export const importBodySchema = z.object({
  prompt: z.string().trim().min(1, "Say what this is and what to do with it").max(IMPORT_PROMPT_MAX_CHARS),
  input: importInputSchema,
});

// ─── Cell text — one rule for browser and server ─────────────────────────────

/**
 * A spreadsheet cell as text. A Date cell (xlsx `cellDates`) is read back with the LOCAL
 * getters: xlsx builds it in local time, and toISOString() on an IST midnight is the previous
 * day. A number keeps its value without float noise.
 *
 * Rounded to the nearest minute first (13 Oct 2026): SheetJS builds dates from an 1899 epoch,
 * and in Asia/Kolkata that epoch's offset carries seconds its correction drops — every date
 * cell came back at 23:59:50 the day BEFORE, so every date was a day early. The error is always
 * under a minute, so rounding restores the day in any time zone.
 */
export function cellText(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(parseFloat(v.toFixed(6)));
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return "";
    const d = new Date(Math.round(v.getTime() / 60_000) * 60_000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  return String(v).replace(/\s+/g, " ").trim();
}

// ─── The plan — what the AI decides for a sheet ──────────────────────────────

export const IMPORT_ACTIONS = ["STATEMENT_ROWS", "CLAIMS", "NOT_A_LEDGER"] as const;
export type ImportAction = (typeof IMPORT_ACTIONS)[number];

export const PLAN_COLUMNS = ["date", "label", "type", "ref", "note", "debit", "credit", "amount", "balance"] as const;
export type PlanColumn = (typeof PLAN_COLUMNS)[number];

export interface SheetPlan {
  sheet: string;
  /** 0-based index of the header row in that sheet. Data starts on the next row. */
  headerRow: number;
  /** Column index for each meaning, or null. */
  columns: Record<PlanColumn, number | null>;
  /** With one signed `amount` column: is a positive figure a debit (BCH owes more) or a credit? */
  amountSign: "positive_is_debit" | "positive_is_credit";
  /** true = 05/04/2025 is 5 April. */
  dayFirst: boolean;
  /** Rows whose text contains any of these (case-insensitive) are skipped, with the reason. */
  skipContains: string[];
  /** Keep only rows dated within this range (YYYY-MM-DD), when the prompt asks for a period. */
  dateFrom: string | null;
  dateTo: string | null;
}

export const sheetPlanSchema = z.object({
  sheet: z.string().min(1),
  headerRow: z.number().int().min(0),
  columns: z.object(
    Object.fromEntries(PLAN_COLUMNS.map((c) => [c, z.number().int().min(0).nullable()])) as Record<PlanColumn, z.ZodNullable<z.ZodNumber>>
  ),
  amountSign: z.enum(["positive_is_debit", "positive_is_credit"]),
  dayFirst: z.boolean(),
  skipContains: z.array(z.string().trim().min(1).max(60)).max(20),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
});

/**
 * The plan checked against the actual sheets — the AI's word is never taken for a column that
 * does not exist. Returns the sentence to show, or null when the plan is usable.
 */
export function planProblem(plan: SheetPlan, sheets: ImportSheet[]): string | null {
  const sheet = sheets.find((s) => s.name === plan.sheet);
  if (!sheet) return `The plan names a sheet "${plan.sheet}" that is not in the file.`;
  if (plan.headerRow >= sheet.rows.length) return `The plan's header row ${plan.headerRow + 1} is past the end of "${plan.sheet}".`;
  const width = Math.max(0, ...sheet.rows.slice(plan.headerRow, plan.headerRow + 50).map((r) => r.length));
  for (const c of PLAN_COLUMNS) {
    const i = plan.columns[c];
    if (i !== null && i >= width) return `The plan puts "${c}" in column ${i + 1}, but "${plan.sheet}" has ${width} columns.`;
  }
  const { date, debit, credit, amount } = plan.columns;
  if (date === null) return "The plan does not say which column holds the date.";
  if (debit === null && credit === null && amount === null) return "The plan does not say which column holds the amounts.";
  return null;
}

// ─── Proposal shapes extra to ai-run.ts's ────────────────────────────────────

export interface SkippedRow {
  sheet: string | null;
  /** 1-based row number as the person sees it in Excel, or null for AI-typed input. */
  row: number | null;
  reason: string;
  text: string;
}

export interface PlannedStatementRow {
  date: string;
  label: string;
  ref: string;
  note: string;
  amount: number;
  direction: 1 | -1;
  type: LedgerEntryType;
  side: "VENDOR" | "BCH";
  /** 1-based sheet row the figure came from, for the review page. */
  sourceRow: number | null;
  /** Set when the code had to guess (a carried or day/month-corrected date) — shown on review. */
  warning?: string | null;
}

export interface AppliedPlan {
  rows: PlannedStatementRow[];
  skipped: SkippedRow[];
  opening: number;
  claimedClosing: number | null;
  periodFrom: string | null;
  periodTo: string | null;
}

// ─── Dates ────────────────────────────────────────────────────────────────────

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

function validDay(y: string, m: string, d: string): string | null {
  const yy = y.length === 2 ? `20${y}` : y;
  const mm = m.padStart(2, "0");
  const dd = d.padStart(2, "0");
  const iso = `${yy}-${mm}-${dd}`;
  const t = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(t.getTime()) || t.toISOString().slice(0, 10) !== iso) return null;
  return iso;
}

/**
 * A ledger cell → YYYY-MM-DD, or null. ISO first (what `cellText` writes for a Date cell); then
 * 05/04/2025, 5-4-25, 05.04.2025 in the plan's day/month order; then 5-Apr-25. An impossible
 * date (31/02) is null, never rolled over.
 */
export function planDate(text: string, dayFirst: boolean): string | null {
  const s = text.trim();
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return validDay(m[1], m[2], m[3]);
  if ((m = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2}|\d{4})$/))) {
    return dayFirst ? validDay(m[3], m[2], m[1]) : validDay(m[3], m[1], m[2]);
  }
  if ((m = s.match(/^(\d{1,2})[\s\-]([A-Za-z]{3})[a-z]*[\s\-,]*(\d{2}|\d{4})$/))) {
    const mm = MONTHS[m[2].toLowerCase()];
    return mm ? validDay(m[3], mm, m[1]) : null;
  }
  return null;
}

// ─── Apply a plan to every row ───────────────────────────────────────────────

const DAY_MS = 86_400_000;
const dayNumber = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / DAY_MS;

/** 2025-02-08 → 2025-08-02, or null when the swap is not a real date or changes nothing. */
function swapDayMonth(iso: string): string | null {
  const [y, m, d] = iso.split("-");
  if (m === d || Number(d) > 12) return null;
  return validDay(y, d, m);
}

interface PendingRow {
  rowNo: number;
  raw: string[];
  joined: string;
  dateText: string;
  date: string | null;
  amount: number;
  direction: 1 | -1;
  balance: number | null;
  warning: string | null;
}

/**
 * The plan applied in code. Opening and closing lines seed the tie-out (their figure is a
 * magnitude, whichever column it sits in — the sheet reader's rule), totals are skipped, and
 * every other row with an amount becomes a classified proposal. Anything dropped is listed
 * with its reason, and anything GUESSED carries a warning — so neither a silent loss nor a
 * silent guess reaches the ledger. Learned from the owner's real files (13 Oct 2026):
 *
 * - A date the sheet mangled ("30/12/202") would drop the line and break the tie-out by exactly
 *   its amount. It takes the line above's date, flagged.
 * - Excel stores a typed "2/8/2025" as 8 Feb when the PC is set to US order. When dayFirst and
 *   the rows either side say the swapped date (2 Aug) fits and the stored one does not, the
 *   swap is used, flagged.
 * - A journal line with the same figure in Debit and Credit cancels out; unequal, it nets.
 * - A running balance with no opening line: the opening is worked back from the oldest row,
 *   and the closing is the newest row's balance — whichever way round the sheet is sorted.
 */
export function applyPlan(plan: SheetPlan, sheets: ImportSheet[]): AppliedPlan {
  const sheet = sheets.find((s) => s.name === plan.sheet);
  const empty: AppliedPlan = { rows: [], skipped: [], opening: 0, claimedClosing: null, periodFrom: null, periodTo: null };
  if (!sheet) return empty;

  const at = (r: string[], c: PlanColumn) => {
    const i = plan.columns[c];
    return i === null ? "" : (r[i] ?? "").trim();
  };
  const skipWords = plan.skipContains.map((w) => w.toLowerCase());
  const skipped: SkippedRow[] = [];
  const pending: PendingRow[] = [];
  let opening: number | null = null;
  let claimedClosing: number | null = null;

  // ── Pass 1: what each row is, from its cells ──
  sheet.rows.slice(plan.headerRow + 1).forEach((r, i) => {
    const rowNo = plan.headerRow + 2 + i;
    if (r.every((c) => !c || !c.trim())) return;
    const joined = r.join(" ").trim();
    const skip = (reason: string) => skipped.push({ sheet: sheet.name, row: rowNo, reason, text: joined.slice(0, 160) });

    const hit = skipWords.find((w) => joined.toLowerCase().includes(w));
    if (hit) return skip(`contains "${hit}" (the plan skips these)`);

    const balance = parseAmount(at(r, "balance"));
    const debitCell = parseAmount(at(r, "debit"));
    const creditCell = parseAmount(at(r, "credit"));
    const amountCell = parseAmount(at(r, "amount"));
    const magnitude = () => {
      const v = balance ?? debitCell ?? creditCell ?? amountCell;
      return v === null ? null : Math.abs(v);
    };

    if (/\bopening\b/i.test(joined)) {
      opening = magnitude();
      return skip("opening balance — used as the starting figure");
    }
    if (/\bclosing\b/i.test(joined)) {
      claimedClosing = magnitude();
      return skip("closing balance — used as the figure to tie out to");
    }
    const label = at(r, "label") || at(r, "type");
    if (/^\s*(grand\s+)?total\b|\btotals?\b/i.test(label)) return skip("a total line");

    // Signed: + raises what BCH owes, − lowers it. A negative figure in a column flips it.
    let signed: number | null = null;
    if (debitCell || creditCell) {
      signed = (debitCell ?? 0) - (creditCell ?? 0);
      if (debitCell && creditCell && Math.abs(signed) < 0.005) return skip("debit and credit are equal — the line cancels out");
    } else if (amountCell) {
      signed = plan.amountSign === "positive_is_debit" ? amountCell : -amountCell;
    }
    if (!signed) return skip("no amount");

    const dateText = at(r, "date");
    pending.push({
      rowNo,
      raw: r,
      joined,
      dateText,
      date: planDate(dateText, plan.dayFirst),
      amount: Math.round(Math.abs(signed) * 100) / 100,
      direction: signed > 0 ? 1 : -1,
      balance,
      warning: null,
    });
  });

  // ── Pass 2: dates the sheet got wrong — fixed only with evidence, always flagged ──
  // The nearest trustworthy date either side: not a guess, and not the same date as the row
  // being judged — two lines Excel mis-stored together must not vouch for each other.
  const nearest = (from: number, step: 1 | -1): string | null => {
    const own = pending[from].date;
    for (let j = from + step; j >= 0 && j < pending.length; j += step) {
      if (pending[j].date && !pending[j].warning && pending[j].date !== own) return pending[j].date;
    }
    return null;
  };
  pending.forEach((p, i) => {
    if (!p.date) {
      const carried = nearest(i, -1);
      if (carried) {
        p.date = carried;
        p.warning = `date "${p.dateText || "blank"}" could not be read — used the line above's date, ${carried}; check it`;
      }
      return;
    }
    if (plan.dayFirst) {
      const swapped = swapDayMonth(p.date);
      const before = nearest(i, -1);
      const after = nearest(i, 1);
      if (swapped && (before || after)) {
        const distance = (d: string) =>
          (before ? Math.abs(dayNumber(d) - dayNumber(before)) : 0) + (after ? Math.abs(dayNumber(d) - dayNumber(after)) : 0);
        if (distance(swapped) + 20 < distance(p.date)) {
          p.warning = `the sheet holds ${p.date}; the lines around it say ${swapped} (day and month swapped by Excel) — used ${swapped}; check it`;
          p.date = swapped;
        }
      }
    }
  });
  const today = new Date().toISOString().slice(0, 10);

  // ── Pass 3: rows ──
  const rows: PlannedStatementRow[] = [];
  const kept: PendingRow[] = [];
  for (const p of pending) {
    const skip = (reason: string) => skipped.push({ sheet: sheet.name, row: p.rowNo, reason, text: p.joined.slice(0, 160) });
    if (!p.date) {
      skip(`date "${p.dateText || "blank"}" could not be read, and no line above has one`);
      continue;
    }
    if (plan.dateFrom && p.date < plan.dateFrom) {
      skip(`dated ${p.date}, before ${plan.dateFrom}`);
      continue;
    }
    if (plan.dateTo && p.date > plan.dateTo) {
      skip(`dated ${p.date}, after ${plan.dateTo}`);
      continue;
    }
    if (p.date > today && !p.warning) p.warning = `dated ${p.date}, which is in the future — check the date`;
    const typeText = [at(p.raw, "type"), at(p.raw, "label"), at(p.raw, "note")].filter(Boolean).join(" ");
    let type = classifyEntry(typeText, p.direction);
    if (type === "OPENING") type = p.direction > 0 ? "INVOICE" : "ADJUSTMENT";
    rows.push({
      date: p.date,
      label: at(p.raw, "label") || at(p.raw, "type"),
      ref: at(p.raw, "ref"),
      note: at(p.raw, "note"),
      amount: p.amount,
      direction: p.direction,
      type,
      side: sideForType(type),
      sourceRow: p.rowNo,
      warning: p.warning,
    });
    kept.push(p);
  }

  // ── Opening and closing from a running balance, whichever way the sheet is sorted ──
  const withBalance = kept.filter((p) => p.balance !== null);
  if (withBalance.length) {
    const first = withBalance[0];
    const last = withBalance[withBalance.length - 1];
    const descending = (first.date ?? "") > (last.date ?? "");
    const oldest = descending ? last : first;
    const newest = descending ? first : last;
    if (claimedClosing === null) claimedClosing = Math.abs(newest.balance as number);
    if (opening === null) {
      opening = Math.round(((oldest.balance as number) - oldest.direction * oldest.amount) * 100) / 100;
    }
  }

  const dates = rows.map((r) => r.date).sort();
  return {
    rows,
    skipped,
    opening: opening ?? 0,
    claimedClosing,
    periodFrom: dates[0] ?? null,
    periodTo: dates[dates.length - 1] ?? null,
  };
}

/** The tie-out over (possibly edited) rows — the review page and the accept route share it. */
export function tieOut(rows: { amount: number; direction: number }[], opening: number, claimedClosing: number | null) {
  const check = checkBalance(rows, opening, claimedClosing);
  return { computedClosing: check.computedClosing, difference: check.difference, tiesOut: check.tiesOut };
}

// ─── Preview for the planning call ───────────────────────────────────────────

/**
 * The first IMPORT_PREVIEW_ROWS rows of every sheet as numbered lines, each cell prefixed with
 * its column index, so the plan can name `headerRow` and column indexes exactly.
 */
export function sheetPreview(sheets: ImportSheet[]): string {
  return sheets
    .map((s) => {
      const lines = s.rows.slice(0, IMPORT_PREVIEW_ROWS).map((r, i) => {
        const cells = r.map((c, j) => (c ? `[${j}] ${c.slice(0, 80)}` : "")).filter(Boolean);
        return `R${i} ${cells.join(" | ")}`;
      });
      return [`<sheet name="${s.name.replace(/"/g, "'")}" rows="${s.rows.length}">`, ...lines, "</sheet>"].join("\n");
    })
    .join("\n\n");
}

/** A whole sheet as plain text, for the AI-typed fallback when no plan can map it. */
export function sheetAsText(sheets: ImportSheet[]): string {
  return sheets
    .map((s) => [`Sheet: ${s.name}`, ...s.rows.filter((r) => r.some(Boolean)).map((r) => r.join(" | "))].join("\n"))
    .join("\n\n");
}
