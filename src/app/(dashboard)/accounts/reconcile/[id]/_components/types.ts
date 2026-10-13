// Shapes, labels and small pure helpers for /accounts/reconcile/[id]
// (plan 1210-bank-accounts-and-suspense, §3 C3 and Part F).
//
// Every shape here is what GET /api/bank-statements/[id]/review answers — keep the two in step.

export type LineType = "CREDIT" | "DEBIT";
export type MatchStatus = "UNMATCHED" | "MATCHED" | "FLAGGED" | "EXPENSE" | "IGNORED";

/** The line's suspense case, when it has one (open, or closed). */
export interface SuspenseCase {
  id: string;
  reason: string;
  /** A staff user's name, or the typed outsider's. */
  assignee: string | null;
  assigneeOutside: boolean;
  parkedAt: string;
  resolution: "RECORDED" | "EXPLAINED" | "WRITTEN_OFF" | null;
  resolvedAt: string | null;
  resolutionNote: string | null;
  noteCount: number;
}

/** Part F — a payment or expense already recorded that looks like the same money. A suggestion only. */
export interface AlreadyRecorded {
  kind: "payment" | "expense";
  id: string;
  amount: number;
  date: string;
  label: string;
  reference: string | null;
  /** "exact" = the UTR matches; "likely" = same amount, nearest date. */
  confidence: "exact" | "likely";
  dayGap: number;
}

export interface BankTxn {
  id: string;
  date: string;
  description: string;
  reference: string | null;
  amount: number;
  type: LineType;
  balance: number | null;
  matchStatus: MatchStatus;
  /** On a to-review line: the AI's note. Never a decision. */
  flagReason: string | null;
  suggestedCategory: string | null;
  confidence: number | null;
  suggestedVendor: { id: string; name: string } | null;
  suggestedBill: { id: string; billNo: string; amount: number; paidAmount: number; vendorId: string; status: string } | null;
  confirmedVendorId: string | null;
  confirmedVendor: { name: string } | null;
  confirmedPaymentId: string | null;
  confirmedExpenseId: string | null;
  processedAt: string | null;
  suspense: SuspenseCase | null;
  alreadyRecorded: AlreadyRecorded | null;
}

export interface ExpenseStore {
  id: string;
  name: string;
}

export interface Statement {
  id: string;
  bank: string;
  fileName: string;
  fromDate: string | null;
  toDate: string | null;
  totalCredits: number;
  totalDebits: number;
  txnCount: number;
  uploadedBy: { name: string };
  /** Null for a statement uploaded before bank accounts existed. */
  bankAccount: {
    id: string;
    name: string;
    bank: string;
    accountLast4: string | null;
    storeId: string | null;
    store: { id: string; name: string; code: string } | null;
  } | null;
  transactions: BankTxn[];
  /** Active stores, for the Expense panels. Served by the review route so no expenses grant is needed. */
  expenseStores: ExpenseStore[];
}

export interface Vendor {
  id: string;
  name: string;
  code: string;
}

/** One row of GET /api/bills?vendorId=… */
export interface OpenBill {
  id: string;
  billNo: string;
  amount: number;
  paidAmount: number;
  status: string;
  vendorId: string;
}

/** What POST …/review answers for a bulk action (txnIds). */
export interface BulkResult {
  action: "confirm_payment" | "confirm_expense" | "ignore";
  processed: number;
  againstBills?: number;
  asAdvances?: number;
  refused: { txnId: string; reason: string }[];
}

/** The body of POST …/review — validated again by bankReviewActionSchema on the server. */
export type ReviewBody =
  | { action: "confirm_payment"; vendorId: string; billId?: string }
  | { action: "confirm_expense"; storeId: string; category: string }
  | { action: "link_payment"; paymentId: string }
  | { action: "link_expense"; expenseId: string }
  | { action: "ignore" }
  | { action: "flag"; reason: string; assigneeId?: string; assigneeName?: string };

// ─── Filters (C3) ───────────────────────────────────────────────────────────────

export type LineState = "REVIEW" | "SUSPENSE" | "RECORDED" | "SKIPPED";
export type FilterKey = LineState | "ALL";

export const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "REVIEW", label: "To review" },
  { key: "SUSPENSE", label: "Suspense" },
  { key: "RECORDED", label: "Recorded" },
  { key: "SKIPPED", label: "Skipped" },
  { key: "ALL", label: "All" },
];

/**
 * Where a line stands — the state table in src/lib/bank-recon/lines.ts. "To review" is
 * processedAt null, AI-suggested lines included (the AI never decides a line, D5).
 */
export function lineState(t: Pick<BankTxn, "processedAt" | "matchStatus">): LineState {
  if (!t.processedAt) return "REVIEW";
  if (t.matchStatus === "FLAGGED") return "SUSPENSE";
  if (t.matchStatus === "MATCHED" || t.matchStatus === "EXPENSE") return "RECORDED";
  return "SKIPPED"; // IGNORED — skipped, or a suspense case closed as explained / written off
}

// ─── Labels ────────────────────────────────────────────────────────────────────

/** The Expense chips. Keys are what the review route maps onto ExpenseCategory. */
export const EXPENSE_CATEGORIES = [
  { key: "EXPENSE_SALARY", label: "Salary / Advance" },
  { key: "EXPENSE_RENT", label: "Rent / Maintenance" },
  { key: "EXPENSE_UTILITY", label: "Utility Bills" },
  { key: "EXPENSE_DELIVERY", label: "Delivery / Transport" },
  { key: "EXPENSE_TRANSPORT", label: "Transport" },
  { key: "EXPENSE_OTHER", label: "Other / Misc" },
];

/** The AI's own category words (bank-statement upload, call B). */
const AI_CATEGORY_LABELS: Record<string, string> = {
  VENDOR_PAYMENT: "Vendor payment",
  EXPENSE_SALARY: "Salary / Advance expense",
  EXPENSE_RENT: "Rent / Maintenance expense",
  EXPENSE_UTILITY: "Utility bill expense",
  EXPENSE_DELIVERY: "Delivery expense",
  EXPENSE_TRANSPORT: "Transport expense",
  EXPENSE_OTHER: "Other expense",
  TRANSFER: "Transfer between accounts",
  UNKNOWN: "Unknown",
};

export function aiCategoryLabel(key: string | null): string {
  if (!key) return "";
  return AI_CATEGORY_LABELS[key] ?? key.toLowerCase().replace(/_/g, " ");
}

/** "AI suggests Hero Cycles · 82%", or the expense category the AI named. Null when it named nothing. */
export function aiSuggestion(t: BankTxn): string | null {
  const pct = t.confidence ? ` · ${Math.round(t.confidence * 100)}%` : "";
  if (t.suggestedVendor) return `AI suggests ${t.suggestedVendor.name}${pct}`;
  if (t.suggestedCategory?.startsWith("EXPENSE")) return `AI suggests ${aiCategoryLabel(t.suggestedCategory)}${pct}`;
  return null;
}

// ─── Formatting ─────────────────────────────────────────────────────────────────

export function inr(n: number, decimals = 0): string {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: decimals }).format(n);
}

export function shortDate(d: string | null | undefined): string {
  return d ? new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "";
}

/** "12 recorded — 9 against bills, 3 as advances. 1 refused: already handled." */
export function bulkSentence(r: BulkResult): string {
  const head =
    r.action === "confirm_payment"
      ? `${r.processed} recorded — ${r.againstBills ?? 0} against bills, ${r.asAdvances ?? 0} as advances.`
      : r.action === "confirm_expense"
        ? `${r.processed} recorded as expenses.`
        : `${r.processed} skipped.`;
  if (r.refused.length === 0) return head;
  const byReason = new Map<string, number>();
  for (const x of r.refused) byReason.set(x.reason, (byReason.get(x.reason) ?? 0) + 1);
  const reasons =
    byReason.size === 1
      ? [...byReason.keys()][0]
      : [...byReason.entries()].map(([reason, n]) => `${reason} (${n})`).join(", ");
  return `${head} ${r.refused.length} refused: ${reasons}.`;
}

// ─── Clubbing similar lines ──────────────────────────────────────────────────────

/** The clubbing key of a line, or "" when it stands alone. */
function groupKey(t: BankTxn): string {
  // A decided line, or one the AI tied to a vendor, is worked on its own: lines to different
  // vendors must never be clubbed under "Vendor payment".
  if (t.processedAt || t.suggestedVendor) return "";
  if (t.flagReason) return t.flagReason;
  return t.suggestedCategory && t.suggestedCategory !== "VENDOR_PAYMENT" ? aiCategoryLabel(t.suggestedCategory) : "";
}

/**
 * Group to-review lines that share an AI note or AI category, so ten "bank charges" lines can be
 * selected and skipped together. A group needs two or more lines; everything else stands alone.
 */
export function groupTransactions(txns: BankTxn[]): { label: string; txns: BankTxn[] }[] {
  const groups = new Map<string, BankTxn[]>();
  const single: BankTxn[] = [];
  for (const t of txns) {
    const key = groupKey(t);
    if (key) groups.set(key, [...(groups.get(key) ?? []), t]);
    else single.push(t);
  }

  const result: { label: string; txns: BankTxn[] }[] = [];
  for (const [label, items] of groups) {
    if (items.length >= 2) result.push({ label, txns: items });
    else single.push(...items);
  }
  for (const t of single) result.push({ label: "", txns: [t] });

  // Groups first (biggest first), then single lines newest first.
  result.sort((a, b) => {
    const ga = a.txns.length > 1;
    const gb = b.txns.length > 1;
    if (ga !== gb) return ga ? -1 : 1;
    if (ga && gb) return b.txns.length - a.txns.length;
    return new Date(b.txns[0].date).getTime() - new Date(a.txns[0].date).getTime();
  });
  return result;
}
