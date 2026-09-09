// Ported line-for-line from the ledger app — store.js:67-168 (helpers and constant lists) and
// App.jsx:11-39, 491-494, 795-800 (module-level constants). Pure functions; the only browser
// APIs are the ones the app itself used (Blob / URL / navigator) inside the same helpers.
import {
  LEDGER_VIEW_ENTRY_TYPES,
  LEDGER_VIEW_GAP_STATUSES,
  LEDGER_VIEW_GAP_TYPES,
  type LedgerBrandView,
  type LedgerViewAuditStatus,
  type LedgerViewEntry,
  type LedgerViewEntryType,
  type LedgerViewGap,
} from "@/lib/brand-ledger/view-types";
import { createLogger } from "@/lib/logger";

const log = createLogger("ledger:ui");

// ─── App.jsx:11-17 ───────────────────────────────────────────────────────────

export const REVIEW_CADENCE_DAYS = 15;

export const statusColor: Record<string, string> = {
  open: "red",
  promised: "amber",
  verify: "blue",
  resolved: "green",
  rejected: "",
};

/** Stable, human-referenceable gap IDs — brand code + gap number (e.g. CULT-3, EMOT-12). */
export const gapId = (brand: { code: string }, n: number) => `${brand.code}-${n}`;

// ─── App.jsx:20-39 ───────────────────────────────────────────────────────────

/** One gap → a clean WhatsApp ask for the brand contact. */
export function gapShareText(brand: LedgerBrandView, g: LedgerViewGap): string {
  const L: string[] = [];
  L.push(`*${brand.name} — ${gapId(brand, g.n)}*`);
  L.push(g.title);
  L.push(`Amount: ${gapAmount(g)}`);
  if (g.action) {
    L.push("");
    L.push(`Request: ${g.action}`);
  }
  L.push("");
  L.push("— Bharath Cycle Hub");
  return L.join("\n");
}

/** Open WhatsApp with the message prefilled; user picks the contact. */
export function shareGapOnWhatsApp(brand: LedgerBrandView, g: LedgerViewGap): void {
  const text = gapShareText(brand, g);
  const url = "https://wa.me/?text=" + encodeURIComponent(text);
  if (navigator.share) {
    navigator.share({ text }).catch((e: unknown) => {
      // The share sheet was dismissed or refused (AbortError is the person cancelling); fall back
      // to wa.me in a new tab, exactly as the app did.
      log.debug("share sheet declined, opening wa.me", { gap: gapId(brand, g.n), reason: e instanceof Error ? e.name : String(e) });
      window.open(url, "_blank");
    });
  } else {
    window.open(url, "_blank");
  }
}

// ─── App.jsx:491-494 ─────────────────────────────────────────────────────────

export const PAGE = 80;

export const AUDIT_LABEL: Record<LedgerViewAuditStatus, string> = {
  ok: "✓ disc ok",
  short: "⚠ short",
  missing: "✗ NO DISC",
  kids: "kids · 0%",
  era20: "20% era",
  info: "ℹ",
};
export const AUDIT_CHIP: Record<LedgerViewAuditStatus, string> = {
  ok: "green",
  short: "amber",
  missing: "red",
  kids: "",
  era20: "blue",
  info: "blue",
};

// ─── App.jsx:795-800 ─────────────────────────────────────────────────────────

export function monthLabel(ym: string | undefined | null): string {
  if (!ym) return "";
  const [y, m] = ym.split("-");
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${names[Number(m) - 1]} ${y}`;
}

// ─── store.js:67-98 ──────────────────────────────────────────────────────────

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function daysSince(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}

export function daysUntil(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  return Math.ceil((d.getTime() - Date.now()) / 86400000);
}

export function fmtINR(n: number | null | undefined): string {
  if (n === null || n === undefined || isNaN(n)) return "—";
  return "₹" + Math.round(n).toLocaleString("en-IN");
}

export function fmtLakh(n: number | null | undefined): string {
  if (n === null || n === undefined || isNaN(n)) return "—";
  if (Math.abs(n) >= 100000) return "₹" + (n / 100000).toFixed(2) + "L";
  return fmtINR(n);
}

export function gapAmount(g: Pick<LedgerViewGap, "amt" | "amtText">): string {
  return g.amtText || (g.amt !== null && g.amt !== undefined ? fmtINR(g.amt) : "TBD");
}

// ─── store.js:100-117 ────────────────────────────────────────────────────────

export const GAP_STATUSES = LEDGER_VIEW_GAP_STATUSES;
export const GAP_TYPES = LEDGER_VIEW_GAP_TYPES;
export const ENTRY_TYPES = LEDGER_VIEW_ENTRY_TYPES;

/** dir: +1 increases what BCH owes, -1 decreases, 0 informational */
export function entryDir(type: LedgerViewEntryType): -1 | 0 | 1 {
  if (type === "invoice" || type === "debit-note" || type === "opening") return +1;
  if (type === "note") return 0;
  return -1;
}

/** side: who "sent" this in the conversation — vendor bills/credits, BCH pays */
export function entrySide(type: LedgerViewEntryType): "vendor" | "bch" {
  return type === "payment" ? "bch" : type === "debit-note" ? "bch" : "vendor";
}

// ─── store.js:121-134 ────────────────────────────────────────────────────────

/**
 * Ascending by date, stable within a day. The app broke ties on `String(id)` because its ids
 * (`lu-0001`, `lu-0002`) carried the statement's own order; database ids do not, so the tie
 * is broken on the order the server returned (entryDate, then createdAt), which is that
 * same order preserved by the import.
 */
export function sortEntries(entries: LedgerViewEntry[]): LedgerViewEntry[] {
  return entries
    .map((e, i) => ({ e, i }))
    .sort((a, b) => a.e.date.localeCompare(b.e.date) || a.i - b.i)
    .map((x) => x.e);
}

/**
 * Running balances for a brand's thread.
 * Returns { sorted, balances: Map<id, number>, closing }
 *
 * An IGNORED row (marked so in place of deletion — plan D3) stays in the thread but does not
 * move the balance: its entry in `balances` is the balance as it stood before it.
 */
export function computeThread(brand: LedgerBrandView) {
  const sorted = sortEntries(brand.entries);
  let bal = brand.ledger?.opening?.amount || 0;
  const balances = new Map<string, number>();
  for (const e of sorted) {
    if (!e.ignored) bal += (e.dir ?? entryDir(e.type)) * (e.amount || 0);
    balances.set(e.id, bal);
  }
  return { sorted, balances, closing: bal };
}

export function openGaps(brand: LedgerBrandView): LedgerViewGap[] {
  return brand.gaps.filter((g) => g.status !== "resolved" && g.status !== "rejected");
}

// ─── store.js:136-150 ────────────────────────────────────────────────────────

export function csvEscape(v: unknown): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export function downloadCSV(filename: string, rows: unknown[][]): void {
  const csv = rows.map((r) => r.map(csvEscape).join(",")).join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── store.js:153-168 ────────────────────────────────────────────────────────

/** WhatsApp-ready plain-text summary for sharing with the vendor */
export function brandSummaryText(brand: LedgerBrandView): string {
  const open = openGaps(brand);
  const lines: string[] = [];
  lines.push(`*${brand.name} — Balance & Open Items* (BCH, ${today()})`);
  lines.push("");
  if (brand.theirBal?.amount != null)
    lines.push(`Your ledger: ${fmtINR(brand.theirBal.amount)} (${brand.theirBal.label})`);
  if (brand.ourBal?.amount != null)
    lines.push(`Our net position: ${fmtINR(brand.ourBal.amount)} (${brand.ourBal.label})`);
  if (brand.recov?.text) lines.push(`Pending credits/gaps: ${brand.recov.text}`);
  lines.push("");
  lines.push(`*Open items (${open.length}):*`);
  open.forEach((g) => {
    lines.push(`${g.n}. ${g.title} — ${gapAmount(g)} [${g.status}]`);
    if (g.action) lines.push(`   → ${g.action}`);
  });
  return lines.join("\n");
}
