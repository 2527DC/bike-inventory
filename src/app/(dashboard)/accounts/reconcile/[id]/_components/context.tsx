"use client";

// What every line card needs from the page, without threading it through the group card, the
// line card and its panels (frontend-engineer: no prop drilling beyond two levels).
import { createContext, useContext } from "react";
import type { BankTxn, ExpenseStore, ReviewBody } from "./types";

/** Cosmetic — the API re-checks every one (CLAUDE.md, frontend checks are cosmetic). */
export interface ReconcilePerms {
  /** bank_recon.edit — work the lines at all. */
  edit: boolean;
  /** + bills.create — record a NEW vendor payment (Q3). */
  payment: boolean;
  /** + expenses.create — record a NEW expense (Q3). */
  expense: boolean;
}

export interface ReconcileCtx {
  statementId: string;
  perms: ReconcilePerms;
  /** The line whose action is in flight, or "". Every button of that line is disabled meanwhile. */
  busyTxn: string;
  /** True while lines are ticked: per-line actions step aside for the bulk bar. */
  bulkMode: boolean;
  selected: Set<string>;
  toggleSelect: (txnId: string) => void;
  /** Tick (on) or untick every id — a group's select-all. */
  selectMany: (txnIds: string[], on: boolean) => void;
  /** POST one action for one line. Resolves true when it was done. */
  run: (txnId: string, body: ReviewBody) => Promise<boolean>;
  /** The last refused single action — shown under the line it belongs to, where the person tapped. */
  lastError: { txnId: string; message: string } | null;
  openPark: (txn: BankTxn) => void;
  expenseStores: ExpenseStore[];
  /** The statement account's store when it is an active store — pre-selected on Expense. */
  defaultStoreId: string;
  /** `?txn=` — the line the suspense screen linked to. */
  highlightId: string | null;
}

const Ctx = createContext<ReconcileCtx | null>(null);

export const ReconcileProvider = Ctx.Provider;

export function useReconcile(): ReconcileCtx {
  const value = useContext(Ctx);
  if (!value) throw new Error("useReconcile() used outside <ReconcileProvider>");
  return value;
}
