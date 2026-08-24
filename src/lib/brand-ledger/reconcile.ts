// ─── Brand ledger reconciliation ─────────────────────────────────────────────
// Ported from the standalone ledgers workspace (scripts/extract-entries.mjs), where this ran
// once at build time against files in a repo. Here it runs against the database.
//
// Everything in this file is pure — no Prisma, no I/O — so the classification and matching
// rules can be reasoned about and tested on their own.

import type { LedgerEntryType, LedgerSide } from "@prisma/client";

// ─── Parsing ─────────────────────────────────────────────────────────────────

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

/**
 * Brand statements arrive in whatever format the brand's accounting package emits.
 * Handles `2026-06-10`, `10-Jun-26`, `10 Jun 2026`, `10/06/2026`.
 *
 * Day-first for the slash form: these are Indian statements, so `10/06/2026` is 10 June, not
 * 6 October. Guessing wrong silently shifts an invoice by months and breaks the ageing.
 */
export function parseLedgerDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;

  const s = String(value).trim();
  let m: RegExpMatchArray | null;

  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) {
    return new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);
  }
  if ((m = s.match(/^(\d{1,2})[-\s]([A-Za-z]{3})[a-z]*[-\s](\d{2,4})$/))) {
    const yy = m[3].length === 2 ? `20${m[3]}` : m[3];
    const mm = MONTHS[m[2].toLowerCase()];
    if (!mm) return null;
    return new Date(`${yy}-${mm}-${m[1].padStart(2, "0")}T00:00:00Z`);
  }
  if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/))) {
    const yy = m[3].length === 2 ? `20${m[3]}` : m[3];
    return new Date(`${yy}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}T00:00:00Z`);
  }
  return null;
}

/** Strips currency symbols, thousands separators and stray spaces. */
export function parseAmount(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(String(value).replace(/[,₹\s]/g, ""));
  return isNaN(n) ? null : n;
}

// ─── Classification ──────────────────────────────────────────────────────────

/**
 * Guess an entry type from the brand's own label. Their vocabulary varies wildly — "RCPT",
 * "Receipt", "NEFT", "HDFC" all mean the same thing — so this matches on intent rather than
 * an exact list.
 *
 * `direction` is the tiebreaker: an unrecognised label that reduces the balance is an
 * adjustment, one that increases it is an invoice.
 */
export function classifyEntry(label: string | null | undefined, direction: number): LedgerEntryType {
  const s = String(label || "").toLowerCase();
  if (/opening/.test(s)) return "OPENING";
  if (/credit\s*note|^cn|crnt|slrt|sirt/.test(s)) return "CREDIT_NOTE";
  if (/debit\s*note|^dn/.test(s)) return "DEBIT_NOTE";
  if (/discount|rebate|\bdis-|\bcd\b/.test(s)) return "DISCOUNT";
  if (/payment|receipt|rcpt|neft|rtgs|imps|upi|icici|hdfc|axis|bank/.test(s)) return "PAYMENT";
  if (/purchase|invoice|sale|bill/.test(s)) return "INVOICE";
  return direction < 0 ? "ADJUSTMENT" : "INVOICE";
}

/** Which party an entry belongs to. Money we sent is ours; everything else is theirs. */
export function sideForType(type: LedgerEntryType): LedgerSide {
  return type === "PAYMENT" || type === "DEBIT_NOTE" ? "BCH" : "VENDOR";
}

/** +1 increases what BCH owes; -1 decreases it. */
export function directionForType(type: LedgerEntryType): number {
  return type === "INVOICE" || type === "DEBIT_NOTE" || type === "OPENING" ? 1 : -1;
}

// ─── Running balance ─────────────────────────────────────────────────────────

export interface BalanceRow<T> {
  entry: T;
  balance: number;
}

export interface BalanceCheck {
  opening: number;
  computedClosing: number;
  claimedClosing: number | null;
  /** Signed: positive means the brand claims MORE than their own rows add up to. */
  difference: number | null;
  tiesOut: boolean;
}

/** Rupee rounding — a statement that ties to within a rupee has tied. */
const TIE_TOLERANCE = 1;

export function runningBalance<T extends { amount: number; direction: number }>(
  entries: T[],
  opening = 0
): BalanceRow<T>[] {
  let bal = opening;
  return entries.map((entry) => {
    bal += entry.direction * entry.amount;
    return { entry, balance: Math.round(bal * 100) / 100 };
  });
}

/**
 * Recompute the chain and compare it against what the brand says their closing balance is.
 *
 * This is the single most valuable check in the import. If a brand's own rows do not add up to
 * their own stated closing, the statement is wrong — and that is a finding worth more than any
 * individual row. An import that fails this must not be committed silently.
 */
export function checkBalance<T extends { amount: number; direction: number }>(
  entries: T[],
  opening = 0,
  claimedClosing: number | null = null
): BalanceCheck {
  const computed =
    Math.round(entries.reduce((sum, e) => sum + e.direction * e.amount, opening) * 100) / 100;

  const difference =
    claimedClosing === null ? null : Math.round((claimedClosing - computed) * 100) / 100;

  return {
    opening,
    computedClosing: computed,
    claimedClosing,
    difference,
    tiesOut: difference === null ? false : Math.abs(difference) <= TIE_TOLERANCE,
  };
}

// ─── Matching against BCH's books ────────────────────────────────────────────

export interface MatchableEntry {
  id: string;
  entryDate: Date;
  amount: number;
  ref?: string | null;
}

export interface BookRecord {
  id: string;
  date: Date;
  amount: number;
  reference?: string | null;
  kind: "bill" | "payment" | "credit";
}

export interface MatchResult {
  entryId: string;
  bookId: string | null;
  kind: BookRecord["kind"] | null;
  /** Days between the two dates — a large gap on an exact amount is worth a human look. */
  dayGap: number | null;
  confidence: "exact" | "likely" | "none";
}

const DAY = 86_400_000;
/** Statements post a payment days after the bank does; beyond this it is probably a different one. */
const MAX_DAY_GAP = 30;

function normaliseRef(ref: string | null | undefined): string {
  return String(ref || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
}

/**
 * Match statement rows to our own records: same amount, nearest date, reference as a tiebreak.
 *
 * Deliberately conservative — a book record is consumed by at most one entry, and anything it
 * cannot place is left unmatched rather than force-fitted. An unmatched row is a question for
 * a human, not a conclusion (see LedgerMatchStatus.NEEDS_REVIEW).
 */
export function matchEntries(entries: MatchableEntry[], books: BookRecord[]): MatchResult[] {
  const consumed = new Set<string>();
  const results: MatchResult[] = [];

  // Exact reference matches first — a UTR is far stronger evidence than a date proximity.
  for (const entry of entries) {
    const entryRef = normaliseRef(entry.ref);
    let hit: BookRecord | undefined;

    if (entryRef.length >= 6) {
      hit = books.find(
        (b) =>
          !consumed.has(b.id) &&
          Math.abs(b.amount - entry.amount) < 0.01 &&
          normaliseRef(b.reference).includes(entryRef)
      );
    }

    if (hit) {
      consumed.add(hit.id);
      results.push({
        entryId: entry.id,
        bookId: hit.id,
        kind: hit.kind,
        dayGap: Math.round(Math.abs(+hit.date - +entry.entryDate) / DAY),
        confidence: "exact",
      });
    }
  }

  // Then amount + nearest date for whatever is left.
  const placed = new Set(results.map((r) => r.entryId));
  for (const entry of entries) {
    if (placed.has(entry.id)) continue;

    let best: { book: BookRecord; gap: number } | null = null;
    for (const b of books) {
      if (consumed.has(b.id)) continue;
      if (Math.abs(b.amount - entry.amount) >= 0.01) continue;
      const gap = Math.abs(+b.date - +entry.entryDate) / DAY;
      if (gap > MAX_DAY_GAP) continue;
      if (!best || gap < best.gap) best = { book: b, gap };
    }

    if (best) {
      consumed.add(best.book.id);
      results.push({
        entryId: entry.id,
        bookId: best.book.id,
        kind: best.book.kind,
        dayGap: Math.round(best.gap),
        confidence: "likely",
      });
    } else {
      results.push({ entryId: entry.id, bookId: null, kind: null, dayGap: null, confidence: "none" });
    }
  }

  return results;
}

/** Book records that no statement row claimed — i.e. things WE have that THEY have not posted. */
export function unclaimedBooks(books: BookRecord[], matches: MatchResult[]): BookRecord[] {
  const claimed = new Set(matches.map((m) => m.bookId).filter(Boolean) as string[]);
  return books.filter((b) => !claimed.has(b.id));
}

// ─── Coverage ────────────────────────────────────────────────────────────────

export type CoverageLevel = "good" | "partial" | "sparse" | "empty";

export interface Coverage {
  level: CoverageLevel;
  ourCount: number;
  theirCount: number;
  message: string;
}

/**
 * Safeguard 3 from the merge plan.
 *
 * Before flagging anything as a discrepancy, compare volumes. If their statement lists 26
 * receipts and our books hold 3 payments, the problem is almost certainly our record-keeping,
 * not their honesty — and reporting 23 discrepancies would be noise that trains people to
 * ignore the tool.
 */
export function assessCoverage(ourCount: number, theirCount: number): Coverage {
  if (ourCount === 0 && theirCount > 0) {
    return {
      level: "empty",
      ourCount,
      theirCount,
      message:
        "None of this vendor's bills or payments are recorded in Accounts. Differences below " +
        "are almost certainly gaps in our records, not theirs.",
    };
  }
  if (theirCount === 0) {
    return { level: "good", ourCount, theirCount, message: "No statement imported yet." };
  }

  const ratio = ourCount / theirCount;
  if (ratio >= 0.85) {
    return { level: "good", ourCount, theirCount, message: "Our records look complete for this vendor." };
  }
  if (ratio >= 0.5) {
    return {
      level: "partial",
      ourCount,
      theirCount,
      message: `Our books hold ${ourCount} records against ${theirCount} on their statement — some of ours may be missing.`,
    };
  }
  return {
    level: "sparse",
    ourCount,
    theirCount,
    message: `Our books hold only ${ourCount} records against ${theirCount} on their statement. Treat unmatched rows as our gap until Accounts is caught up.`,
  };
}

// ─── Discount expectations ───────────────────────────────────────────────────

export interface DiscountTermLike {
  kind: string;
  percentage: number | null;
  perUnitAmount: number | null;
  effectiveFrom: Date | null;
  effectiveTo: Date | null;
  isProven: boolean;
  appliesTo: string | null;
}

export interface DiscountExpectation {
  expected: number;
  termsApplied: number;
  unprovenTerms: number;
}

/**
 * What discount SHOULD have been credited on an invoice, given the agreed terms in force on
 * its date. This is what replaces the hand-typed "18% via DIS-90, group short ₹539" notes.
 *
 * Unproven terms still count toward the expectation but are reported separately — you may
 * well be owed the money, but you cannot prove the agreement, and that changes how hard the
 * claim can be pressed.
 */
export function expectedDiscount(
  invoiceAmount: number,
  invoiceDate: Date,
  terms: DiscountTermLike[]
): DiscountExpectation {
  let expected = 0;
  let applied = 0;
  let unproven = 0;

  for (const t of terms) {
    if (t.kind === "CASH") continue; // time-dependent; not a per-invoice entitlement
    if (t.effectiveFrom && invoiceDate < t.effectiveFrom) continue;
    if (t.effectiveTo && invoiceDate > t.effectiveTo) continue;

    if (t.percentage) {
      expected += (invoiceAmount * t.percentage) / 100;
      applied++;
      if (!t.isProven) unproven++;
    }
  }

  return {
    expected: Math.round(expected * 100) / 100,
    termsApplied: applied,
    unprovenTerms: unproven,
  };
}
