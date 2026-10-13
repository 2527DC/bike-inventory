// Shapes for /accounts/bank-upload (plan 1210-bank-accounts-and-suspense, §3 B6). The account
// shapes and labels live with the accounts screen (../../bank-accounts/_components/types.ts).

export type { BankAccountRow, BankCode } from "../../bank-accounts/_components/types";
export { accountChipLabel, dayLabel, BANK_LABELS } from "../../bank-accounts/_components/types";

/** Live progress per statement, computed by GET /api/bank-statements — never the AI's counts. */
export interface StatementProgress {
  total: number;
  done: number;
  toReview: number;
  suspense: number;
}

/** One row of GET /api/bank-statements. */
export interface StatementRow {
  id: string;
  /** The account's BankCode for new uploads; the free strings "HDFC" / "ICICI" before accounts. */
  bank: string;
  fileName: string;
  fromDate: string | null;
  toDate: string | null;
  totalCredits: number;
  totalDebits: number;
  txnCount: number;
  createdAt: string;
  uploadedBy: { name: string };
  bankAccount: { id: string; name: string; bank: string; accountLast4: string | null; isActive: boolean } | null;
  progress: StatementProgress;
}

/** What POST /api/bank-statements answers on success. */
export interface UploadResult {
  id: string;
  bankAccountId: string;
  accountName: string;
  txnCount: number;
  duplicatesSkipped: number;
  suggested: number;
  aiFlagged: number;
  totalCredits: number;
  totalDebits: number;
}

/** Carried in a refused upload's `data.diagnostics` — never logged, shown only to the uploader. */
export interface Diagnostics {
  step?: string;
  fileStats?: { name: string; size: string; lines: number; chars: number };
  filePreview?: string;
  aiResponse?: string;
  hint?: string;
}

export type UploadStep = "idle" | "reading" | "parsing" | "matching" | "done" | "error";

export const STEPS: { key: UploadStep; label: string }[] = [
  { key: "reading", label: "Reading file" },
  { key: "parsing", label: "AI parsing transactions" },
  { key: "matching", label: "Matching vendors & bills" },
  { key: "done", label: "Complete" },
];

export function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount);
}

/** Today as the phone sees it, "YYYY-MM-DD" — the max for the period inputs. */
export function todayLocal(): string {
  return new Date().toLocaleDateString("en-CA");
}

/** "YYYY-MM-DD" + n days, as a calendar day. */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (both "YYYY-MM-DD"). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** The sentence after a good upload (B6). */
export function successSentence(r: UploadResult): string {
  const parts = [`Imported ${r.txnCount} line${r.txnCount === 1 ? "" : "s"} to ${r.accountName}.`];
  if (r.duplicatesSkipped > 0) {
    parts.push(
      r.duplicatesSkipped === 1
        ? "1 was already uploaded and was skipped."
        : `${r.duplicatesSkipped} were already uploaded and were skipped.`
    );
  }
  parts.push(r.suggested > 0 ? `The AI suggested a match for ${r.suggested}.` : "The AI suggested no matches.");
  if (r.aiFlagged > 0) parts.push(`It left a note on ${r.aiFlagged} to look at.`);
  return parts.join(" ");
}
