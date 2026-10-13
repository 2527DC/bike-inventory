// The review page's data contract and its pure helpers — plan 1310-ledger-prompted-import
// Part C. Types only from the server modules (`import type` is erased, so nothing server-side
// reaches the browser bundle); the browser-safe code comes from prompted-import.ts / reconcile.ts.
import type { LedgerEntryType } from "@prisma/client";
import type { LedgerProposals, StatementRowProposal } from "@/lib/brand-ledger/ai-run";
import type { ClaimProposal } from "@/lib/brand-ledger/ai-prompts";
import type { ImportSource } from "@/lib/brand-ledger/prompted-import";
import { sideForType } from "@/lib/brand-ledger/reconcile";

export type RunStatus = "RUNNING" | "DONE" | "FAILED" | "ACCEPTED" | "DISCARDED";
export type RunTask = "STATEMENT_ROWS" | "CLAIMS_FROM_CHAT" | "CLAIMS_FROM_IMAGE" | "PROMPTED_IMPORT";
export type UploadKind = "STATEMENT" | "CHAT" | "SCREENSHOT" | "DOCUMENT";

export interface RunSibling {
  id: string;
  status: RunStatus;
  userPrompt: string | null;
  createdAt: string;
}

export interface ExistingEntry {
  date: string;
  amount: number;
  direction: number;
  ref: string;
}

/** GET /api/ledger/runs/[id]. `source`, `siblings`, `existing` come with a PROMPTED_IMPORT only. */
export interface ReviewRun {
  id: string;
  vendorId: string;
  task: RunTask;
  status: RunStatus;
  userPrompt: string | null;
  provider: string | null;
  model: string | null;
  usageIn: number | null;
  usageOut: number | null;
  latencyMs: number | null;
  chunks: number;
  proposals: LedgerProposals | null;
  error: string | null;
  acceptedAt: string | null;
  statementId: string | null;
  createdAt: string;
  uploadId: string;
  upload: { id: string; fileName: string; kind: UploadKind; fileUrl: string | null; deletedAt: string | null };
  source?: ImportSource | null;
  siblings?: RunSibling[];
  existing?: ExistingEntry[];
}

/** The entry types a person may pick for a row (the accept schema also allows OPENING). */
export const ROW_TYPES: LedgerEntryType[] = ["INVOICE", "PAYMENT", "CREDIT_NOTE", "DEBIT_NOTE", "DISCOUNT", "ADJUSTMENT", "NOTE"];

export const TYPE_LABEL: Record<LedgerEntryType, string> = {
  OPENING: "Opening",
  INVOICE: "Invoice",
  PAYMENT: "Payment",
  CREDIT_NOTE: "Credit note",
  DEBIT_NOTE: "Debit note",
  DISCOUNT: "Discount",
  ADJUSTMENT: "Adjustment",
  NOTE: "Note",
};

export const STATUS_LABEL: Record<RunStatus, { text: string; chip: string }> = {
  RUNNING: { text: "Reading", chip: "amber" },
  DONE: { text: "Waiting for review", chip: "blue" },
  FAILED: { text: "Failed", chip: "red" },
  ACCEPTED: { text: "Added to the ledger", chip: "green" },
  DISCARDED: { text: "Discarded", chip: "" },
};

// ─── Editable rows ────────────────────────────────────────────────────────────

/** One statement row as the person edits it. `amount` is kept as typed. */
export interface EditRow {
  key: number;
  ticked: boolean;
  date: string;
  label: string;
  ref: string;
  note: string;
  amount: string;
  direction: 1 | -1;
  type: LedgerEntryType;
  sourceRow: number | null;
  warning: string | null;
}

/** What the accept route takes per row — `sourceRow` and `warning` stripped. */
export type AcceptRow = Pick<StatementRowProposal, "date" | "label" | "ref" | "note" | "amount" | "direction" | "type" | "side">;

type ProposedRow = StatementRowProposal & { warning?: string | null };

let keySeq = 0;

/** Proposal rows → editable rows. A row that duplicates a ledger entry starts unticked. */
export function toEditRows(rows: ProposedRow[], existing: ExistingEntry[] | undefined): EditRow[] {
  const dup = findDuplicates(
    rows.map((r) => ({ date: r.date, amount: r.amount, direction: r.direction, ref: r.ref })),
    existing ?? []
  );
  return rows.map((r, i) => ({
    key: ++keySeq,
    ticked: !dup[i],
    date: r.date,
    label: r.label ?? "",
    ref: r.ref ?? "",
    note: r.note ?? "",
    amount: String(r.amount),
    direction: r.direction,
    type: r.type,
    sourceRow: r.sourceRow ?? null,
    warning: r.warning ?? null,
  }));
}

export function parseRowAmount(text: string): number | null {
  const n = Number(String(text).replace(/[,₹\s]/g, ""));
  return text.trim() === "" || !Number.isFinite(n) ? null : Math.round(n * 100) / 100;
}

export function isIsoDay(text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const t = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === text;
}

/** The first thing wrong with a row, or null. Only ticked rows are held to it. */
export function rowProblem(r: EditRow): string | null {
  if (!isIsoDay(r.date)) return "the date is not a real date";
  const n = parseRowAmount(r.amount);
  if (n === null || n <= 0) return "the amount must be more than 0";
  return null;
}

export function toAcceptRow(r: Pick<AcceptRow, "date" | "label" | "ref" | "note" | "direction" | "type"> & { amount: number }): AcceptRow {
  return {
    date: r.date,
    label: (r.label ?? "").trim(),
    ref: (r.ref ?? "").trim(),
    note: (r.note ?? "").trim(),
    amount: r.amount,
    direction: r.direction,
    type: r.type,
    side: sideForType(r.type),
  };
}

export function editToAcceptRow(r: EditRow): AcceptRow {
  return toAcceptRow({ ...r, amount: parseRowAmount(r.amount) ?? 0 });
}

// ─── Duplicates ───────────────────────────────────────────────────────────────

/**
 * Which rows are already on the ledger: same date, same direction, amount within 0.01, and the
 * same reference when both carry one. One-to-one — an entry on the ledger vouches for at most
 * one proposed row, so two identical invoices on the statement against one on the ledger flag
 * only the first.
 */
export function findDuplicates(
  rows: { date: string; amount: number | null; direction: number; ref: string }[],
  existing: ExistingEntry[]
): boolean[] {
  const buckets = new Map<string, { e: ExistingEntry; used: boolean }[]>();
  for (const e of existing) {
    const k = `${e.date}|${e.direction}`;
    const list = buckets.get(k) ?? [];
    list.push({ e, used: false });
    buckets.set(k, list);
  }
  const norm = (s: string) => s.trim().toLowerCase();
  return rows.map((r) => {
    if (r.amount === null) return false;
    const hit = (buckets.get(`${r.date}|${r.direction}`) ?? []).find(
      (c) =>
        !c.used &&
        Math.abs(c.e.amount - (r.amount as number)) <= 0.01 &&
        (!norm(r.ref) || !norm(c.e.ref) || norm(r.ref) === norm(c.e.ref))
    );
    if (!hit) return false;
    hit.used = true;
    return true;
  });
}

// ─── Claims ───────────────────────────────────────────────────────────────────

export interface EditClaim extends ClaimProposal {
  key: number;
  ticked: boolean;
  amountText: string;
}

export function toEditClaims(claims: ClaimProposal[]): EditClaim[] {
  return claims.map((c) => ({ ...c, key: ++keySeq, ticked: true, amountText: c.amount === null ? "" : String(c.amount) }));
}

// ─── Formatting ───────────────────────────────────────────────────────────────

/** ₹ with paise when there are any — a tie-out is judged to the rupee, so paise matter here. */
export function fmtMoney(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  const sign = n < 0 ? "−" : "";
  return sign + "₹" + Math.abs(n).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

export function fmtWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString("en-IN")} ${n === 1 ? one : many}`;
}

/** What kind of input the run read, in the person's words. */
export function inputKindLabel(run: Pick<ReviewRun, "task" | "upload">): string {
  const { kind, fileName } = run.upload;
  if (kind === "STATEMENT") return run.task === "PROMPTED_IMPORT" ? "Spreadsheet" : "Statement (PDF / spreadsheet)";
  if (kind === "CHAT") return "Chat export";
  if (kind === "SCREENSHOT") return "Image";
  if (/\.pdf$/i.test(fileName)) return "PDF";
  return run.task === "PROMPTED_IMPORT" ? "Text" : "Document";
}
