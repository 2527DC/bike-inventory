// ─── The ledger screen's data contract ───────────────────────────────────────
//
// The screen at /ledger/[vendorId] is a line-for-line port of the ledger app's BrandPage
// (F:\bharath  Cycle\ledgers\app\src\App.jsx:223-1218). Its components read the SAME property
// names the app's `brand` object had, so the port stays verbatim; the server maps database
// rows into this shape (src/lib/brand-ledger/view.ts) and the client never sees an enum.
//
// Shared by: the view route (GET /api/ledger/vendors/[id]), every component under
// src/app/(dashboard)/ledger/[id]/_components, the JSON import and the AI review cards.
// Plan: docs/implementation/pending/0909-vendor-ledger-screens-and-ai-import-plan.md §3 C.2.

/** The app's entry types, lower-case and hyphenated exactly as `store.js:106` lists them. */
export type LedgerViewEntryType =
  | "payment"
  | "invoice"
  | "credit-note"
  | "debit-note"
  | "discount"
  | "adjustment"
  | "note"
  | "opening";

export const LEDGER_VIEW_ENTRY_TYPES: LedgerViewEntryType[] = [
  "payment", "invoice", "credit-note", "debit-note", "discount", "adjustment", "note",
];

/** `store.js:100` — the five statuses, in the app's order. */
export type LedgerViewGapStatus = "open" | "promised" | "verify" | "resolved" | "rejected";
export const LEDGER_VIEW_GAP_STATUSES: LedgerViewGapStatus[] = [
  "open", "promised", "verify", "resolved", "rejected",
];

/** `store.js:101-105` plus the two the schema added; hyphenated like the app. */
export type LedgerViewGapType =
  | "discount-pending"
  | "credit-note-pending"
  | "short-credit"
  | "dispute"
  | "reconciliation-difference"
  | "documentation-gap"
  | "balance-unconfirmed"
  | "operational-warranty"
  | "commitment-pending"
  | "invoice-discrepancy"
  | "scheme-entitlement"
  | "reimbursement-pending";

export const LEDGER_VIEW_GAP_TYPES: LedgerViewGapType[] = [
  "discount-pending", "credit-note-pending", "short-credit", "dispute",
  "reconciliation-difference", "documentation-gap", "balance-unconfirmed",
  "operational-warranty", "commitment-pending", "invoice-discrepancy",
  "scheme-entitlement", "reimbursement-pending",
];

export type LedgerViewGapTier = "firm" | "conditional" | "leverage" | "verify";

/** `App.jsx:493` — the audit verdicts the thread colours by. */
export type LedgerViewAuditStatus = "ok" | "short" | "missing" | "kids" | "era20" | "info";

export interface LedgerViewEntry {
  /** BrandLedgerEntry.id */
  id: string;
  /** YYYY-MM-DD */
  date: string;
  type: LedgerViewEntryType;
  ref: string;
  amount: number | null;
  /** +1 increases what BCH owes, -1 decreases, 0 informational */
  dir: -1 | 0 | 1;
  side: "vendor" | "bch";
  note: string;
  audit?: { s: LedgerViewAuditStatus; t: string; g?: number };
  /** Not in the app. Drives the × button: MANUAL deletes, anything else marks IGNORED (D3). */
  source: "MANUAL" | "STATEMENT_PDF" | "STATEMENT_XLSX" | "STATEMENT_CSV" | "BCH_BOOKS";
  /** Not in the app. An ignored row renders struck through; the balance skips it. */
  ignored: boolean;
}

export interface LedgerViewGapEvidence {
  /** LedgerGapEvidence.id */
  id: string;
  /** The stored public URL (Q1). */
  url: string;
  /** true for a PDF / document — rendered as a link, not a thumbnail (App.jsx:771). */
  doc: boolean;
  /** The app's free-text date: capturedLabel, else capturedOn as YYYY-MM-DD, else "". */
  date: string;
  source: string;
  note: string;
}

export interface LedgerViewGap {
  /** LedgerGap.id */
  id: string;
  /** LedgerGap.number — the app's `n` */
  n: number;
  title: string;
  type: LedgerViewGapType;
  amt: number | null;
  amtText: string;
  status: LedgerViewGapStatus;
  tier?: LedgerViewGapTier;
  evidence: string;
  action: string;
  result: string;
  /** LedgerGapNote rows, oldest first, date = createdAt as YYYY-MM-DD */
  progress: { id: string; date: string; text: string }[];
  /** LedgerGapEvidence rows — replaces evidence.gen.js */
  shots: LedgerViewGapEvidence[];
}

/** The app's `brand` object (App.jsx:227-263, 537-564, 590, 910, 1015). */
export interface LedgerBrandView {
  /** Vendor.id */
  id: string;
  /** Vendor.name */
  name: string;
  /** VendorLedgerProfile.code — the CULT in CULT-3 */
  code: string;
  sub: string;
  /** YYYY-MM-DD or null */
  updated: string | null;
  lastReviewed: string | null;
  position: string;
  notes: string;
  theirBal: { amount: number | null; label: string };
  ourBal: { amount: number | null; label: string };
  recov: { amount: number | null; text: string };
  deadline: { label: string; date: string } | null;
  ledger: {
    opening: { date: string; amount: number } | null;
    coverage: string;
    matchable: boolean;
    note: string;
  };
  entries: LedgerViewEntry[];
  gaps: LedgerViewGap[];
  /** Server-decided: false when the caller lacks brand_ledger_gaps.view (gaps is then []). */
  canSeeGaps: boolean;
  /** true while the vendor has no ledger rows at all — shows the one-time Import JSON card. */
  isEmpty: boolean;
}

// ─── Write contracts (what the screen sends) ─────────────────────────────────

/** PUT /api/ledger/vendors/[id]/profile — any subset. */
export interface LedgerProfileWrite {
  theirBal?: { amount: number | null; label: string };
  ourBal?: { amount: number | null; label: string };
  /** true = stamp lastReviewed with today */
  reviewed?: boolean;
}

/** POST /api/ledger/vendors/[id]/gaps and PUT /api/ledger/gaps/[id] — the app's GapForm. */
export interface LedgerGapWrite {
  title: string;
  type: LedgerViewGapType;
  amt: number | null;
  amtText: string;
  status: LedgerViewGapStatus;
  evidence: string;
  action: string;
}

/** POST /api/ledger/vendors/[id]/entries — the app's EntryForm. */
export interface LedgerEntryWrite {
  /** YYYY-MM-DD */
  date: string;
  type: Exclude<LedgerViewEntryType, "opening">;
  ref: string;
  amount: number | null;
  note: string;
}

/** POST /api/ledger/gaps/[id]/notes */
export interface LedgerNoteWrite {
  text: string;
}

// ─── Enum ↔ view maps (used by the server mapper and the import) ─────────────

export const ENTRY_TYPE_TO_VIEW: Record<string, LedgerViewEntryType> = {
  OPENING: "opening",
  INVOICE: "invoice",
  PAYMENT: "payment",
  CREDIT_NOTE: "credit-note",
  DEBIT_NOTE: "debit-note",
  DISCOUNT: "discount",
  ADJUSTMENT: "adjustment",
  NOTE: "note",
};

export const ENTRY_TYPE_FROM_VIEW: Record<LedgerViewEntryType, string> = {
  opening: "OPENING",
  invoice: "INVOICE",
  payment: "PAYMENT",
  "credit-note": "CREDIT_NOTE",
  "debit-note": "DEBIT_NOTE",
  discount: "DISCOUNT",
  adjustment: "ADJUSTMENT",
  note: "NOTE",
};

export const GAP_TYPE_TO_VIEW: Record<string, LedgerViewGapType> = {
  DISCOUNT_PENDING: "discount-pending",
  CREDIT_NOTE_PENDING: "credit-note-pending",
  SHORT_CREDIT: "short-credit",
  DISPUTE: "dispute",
  RECONCILIATION_DIFFERENCE: "reconciliation-difference",
  DOCUMENTATION_GAP: "documentation-gap",
  BALANCE_UNCONFIRMED: "balance-unconfirmed",
  OPERATIONAL_WARRANTY: "operational-warranty",
  COMMITMENT_PENDING: "commitment-pending",
  INVOICE_DISCREPANCY: "invoice-discrepancy",
  SCHEME_ENTITLEMENT: "scheme-entitlement",
  REIMBURSEMENT_PENDING: "reimbursement-pending",
};

export const GAP_TYPE_FROM_VIEW = Object.fromEntries(
  Object.entries(GAP_TYPE_TO_VIEW).map(([k, v]) => [v, k])
) as Record<LedgerViewGapType, string>;

export const GAP_STATUS_TO_VIEW: Record<string, LedgerViewGapStatus> = {
  OPEN: "open",
  PROMISED: "promised",
  VERIFY: "verify",
  RESOLVED: "resolved",
  REJECTED: "rejected",
};

export const GAP_STATUS_FROM_VIEW: Record<LedgerViewGapStatus, string> = {
  open: "OPEN",
  promised: "PROMISED",
  verify: "VERIFY",
  resolved: "RESOLVED",
  rejected: "REJECTED",
};

export const GAP_TIER_TO_VIEW: Record<string, LedgerViewGapTier> = {
  FIRM: "firm",
  CONDITIONAL: "conditional",
  LEVERAGE: "leverage",
  VERIFY: "verify",
};

export const GAP_TIER_FROM_VIEW: Record<LedgerViewGapTier, string> = {
  firm: "FIRM",
  conditional: "CONDITIONAL",
  leverage: "LEVERAGE",
  verify: "VERIFY",
};

/** Date → YYYY-MM-DD in UTC, matching the app's `today()` (store.js:67). */
export function isoDay(d: Date | null | undefined): string | null {
  if (!d) return null;
  const t = d instanceof Date ? d : new Date(d);
  return isNaN(t.getTime()) ? null : t.toISOString().slice(0, 10);
}
