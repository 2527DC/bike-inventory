"use client";

// Park in suspense (plan 1210 bank, R6–R7, D2): a bank line — debit or credit — that nobody can
// explain yet is parked with a reason and, optionally, someone to chase it: a staff user, or a
// typed name for someone outside the app (the external accountant). It is then worked on
// /accounts/suspense — notes, reassign, explained or written off.
//
// Layout follows src/components/apply-credit-sheet.tsx: a bottom sheet on a phone, a centred card
// from `sm:`, Escape closes, focus returns to the button that opened it.
import { useEffect, useRef, useState } from "react";
import { Loader2, X } from "lucide-react";
import { PersonOrNamePicker } from "@/components/person-or-name-picker";
import { apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";
import { useReconcile } from "./context";
import { inr, shortDate, type BankTxn } from "./types";

const log = createLogger("accounts:reconcile");

type Assignee = { assigneeId: string | null; assigneeName: string | null };

/** One-tap starts for the commonest reasons; the person can still type their own. */
const QUICK_REASONS = ["No narration", "Payee not known", "No bill or record found"];

export function ParkSheet({
  txn,
  onClose,
  onParked,
  onStale,
}: {
  txn: BankTxn;
  onClose: () => void;
  /** Parked — the page reloads and says so. */
  onParked: () => void;
  /** 409: someone handled the line first — the page reloads so it shows what happened. */
  onStale: () => void;
}) {
  const { statementId } = useReconcile();
  const [reason, setReason] = useState("");
  const [assignee, setAssignee] = useState<Assignee>({ assigneeId: null, assigneeName: null });
  const [users, setUsers] = useState<{ id: string; name: string }[]>([]);
  const [usersError, setUsersError] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const triggerRef = useRef<Element | null>(null);

  // Staff who can be asked to chase it. /api/users needs team.view, so the suspense module serves its own list.
  useEffect(() => {
    let alive = true;
    void apiTry<{ users: { id: string; name: string }[] }>("/api/bank-suspense/assignees").then(({ data, error: err, status }) => {
      if (!alive) return;
      if (err) {
        log.error("assignee list load failed", { status, message: err });
        setUsersError("Could not load staff names — you can still type a name, or leave it unassigned.");
        return;
      }
      setUsers(data?.users ?? []);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Once per opening: lock the page behind the sheet, and give focus back to the opener after.
  useEffect(() => {
    triggerRef.current = document.activeElement;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
      (triggerRef.current as HTMLElement | null)?.focus?.();
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const trimmed = reason.trim();
  const typedName = assignee.assigneeName?.trim() || "";
  const canPark = trimmed.length >= 3 && trimmed.length <= 500 && !busy;

  async function park() {
    if (!canPark) return;
    setBusy(true);
    setError("");
    const { error: err, status } = await apiTry(`/api/bank-statements/${statementId}/review`, {
      method: "POST",
      json: {
        action: "flag",
        txnId: txn.id,
        reason: trimmed,
        ...(assignee.assigneeId ? { assigneeId: assignee.assigneeId } : typedName ? { assigneeName: typedName } : {}),
      },
    });
    setBusy(false);
    if (err) {
      log.error("park failed", { statementId, txnId: txn.id, status, message: err });
      setError(err);
      if (status === 409) onStale();
      return;
    }
    onParked();
    onClose();
  }

  const isDebit = txn.type === "DEBIT";
  const label = "block text-[10px] font-medium text-slate-500 uppercase tracking-wide mb-1";

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/40 sm:p-4" onClick={() => !busy && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Park in suspense"
        className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl max-h-[88vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between p-4 border-b border-slate-100 shrink-0">
          <div className="pr-3 min-w-0">
            <h2 className="text-base font-bold text-slate-900">Park in suspense</h2>
            <p className="text-xs text-slate-500 mt-0.5 tabular-nums">
              {shortDate(txn.date)} · <span className={isDebit ? "text-red-600" : "text-green-700"}>{isDebit ? "−" : "+"}{inr(txn.amount, 2)}</span>
            </p>
            <p className="text-xs text-slate-600 mt-0.5 line-clamp-2">{txn.description || "No narration"}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center -mr-2 -mt-2 text-slate-400 hover:text-slate-600 disabled:opacity-50"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-4 space-y-4 overflow-y-auto">
          <div>
            <label htmlFor="park-reason" className={label}>Why it is parked</label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {QUICK_REASONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setReason(r)}
                  disabled={busy}
                  className="min-h-11 px-3 rounded-full border border-slate-200 text-xs text-slate-700 bg-white hover:bg-slate-50 disabled:opacity-50"
                >
                  {r}
                </button>
              ))}
            </div>
            <textarea
              id="park-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              maxLength={500}
              disabled={busy}
              placeholder="e.g. Debit with no narration — ask the CEO what it was"
              className="w-full text-sm border border-slate-200 rounded-lg p-2.5"
            />
            {trimmed.length > 0 && trimmed.length < 3 && <p className="text-[11px] text-amber-700 mt-1">Say a little more — at least 3 characters.</p>}
          </div>

          <div>
            <p className={label}>Who chases it (optional)</p>
            {usersError && <p className="text-[11px] text-amber-700 mb-1.5">{usersError}</p>}
            <PersonOrNamePicker users={users} value={assignee} onChange={setAssignee} disabled={busy} />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>

        <div className="p-4 border-t border-slate-100 shrink-0">
          <button
            type="button"
            onClick={park}
            disabled={!canPark}
            className="w-full min-h-11 flex items-center justify-center gap-1.5 bg-amber-600 text-white rounded-lg text-sm font-medium disabled:opacity-50"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Park in suspense
          </button>
          <p className="text-[11px] text-slate-500 mt-2 text-center">
            It stays open on the Suspense screen until it is recorded, explained or written off.
          </p>
        </div>
      </div>
    </div>
  );
}
