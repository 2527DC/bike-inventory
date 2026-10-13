"use client";

import { useEffect, useRef, useState } from "react";
import { Trash2, X } from "lucide-react";
import { apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";
import { categoryLabel, formatCurrency, looksBankCreated, payerName, shortDate, type ExpenseRow } from "./types";

const log = createLogger("expenses:list");

interface DeleteResult {
  deleted: boolean;
  bankLinesReopened: number;
}

interface DeleteExpenseSheetProps {
  row: ExpenseRow;
  onClose: () => void;
  /** Called once the server has deleted the row. */
  onDeleted: (id: string, bankLinesReopened: number) => void;
}

/**
 * Confirm, then hard-delete one expense (plan 1210, R5 / E9). Shown only to holders of
 * Expenses › Delete — cosmetic: DELETE /api/expenses/[id] re-checks the grant, writes the
 * activity-log entry and sends any bank statement line back to "to review".
 *
 * A bottom sheet on a phone, a centred dialog on a wide screen (the hold-sheet pattern).
 */
export function DeleteExpenseSheet({ row, onClose, onDeleted }: DeleteExpenseSheetProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Focus starts on Cancel — the safe answer to a question that cannot be undone.
  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  // Esc closes, but not while the delete is in flight: the answer still has to land somewhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  async function confirmDelete() {
    if (busy) return; // a double tap sends once
    setBusy(true);
    setError(null);
    const { data, error: err, status } = await apiTry<DeleteResult>(`/api/expenses/${encodeURIComponent(row.id)}`, {
      method: "DELETE",
    });
    if (err || !data) {
      log.error("delete failed", { expenseId: row.id, status, message: err });
      setError(err || "The expense could not be deleted.");
      setBusy(false);
      return;
    }
    log.info("expense deleted", { expenseId: row.id, bankLinesReopened: data.bankLinesReopened });
    onDeleted(row.id, data.bankLinesReopened ?? 0);
  }

  const fromBank = looksBankCreated(row);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 backdrop-blur-xs sm:items-center sm:p-4"
      onClick={() => !busy && onClose()}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-expense-title"
        aria-describedby="delete-expense-body"
        className="w-full max-w-md rounded-t-2xl bg-white p-4 pb-6 shadow-xl sm:rounded-2xl sm:p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 id="delete-expense-title" className="text-sm font-bold text-slate-900">
            Delete this expense?
          </h3>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            className="-mr-2 flex h-11 w-11 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-50"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div id="delete-expense-body" className="mt-1 space-y-2 text-sm text-slate-700">
          <p>
            Delete <strong className="tabular-nums">{formatCurrency(row.amount, 2)}</strong> {categoryLabel(row.category)},{" "}
            {shortDate(row.date)}, paid by {payerName(row)}? This cannot be undone.
          </p>
          {fromBank && <p className="text-amber-800">Its bank statement line goes back to &lsquo;to review&rsquo;.</p>}
          {row.receiptUrl && <p className="text-slate-500">Its receipt photo is deleted too.</p>}
        </div>

        {error && (
          <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}

        <div className="mt-4 flex gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onClose}
            disabled={busy}
            className="flex-1 min-h-[44px] rounded-lg border border-slate-300 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void confirmDelete()}
            disabled={busy}
            className="flex-1 min-h-[44px] inline-flex items-center justify-center gap-1.5 rounded-lg bg-red-600 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
          >
            <Trash2 className="h-4 w-4" />
            {busy ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}
