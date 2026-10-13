"use client";

// One suspense case, opened from its card (plan 1210-bank-accounts-and-suspense, D3): the bank
// line, a link to it on its statement, where the case stands, the notes trail and the actions.
// Read fresh from GET /api/bank-suspense/[id] every time it opens — someone may have added a note
// since the list loaded. Layout follows apply-credit-sheet.tsx: a bottom sheet on a phone, a
// centred card from `sm:`, Escape closes, focus returns to the card that opened it.
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { X, ExternalLink, CheckCircle2, AlertTriangle } from "lucide-react";
import { apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";
import { inr, whenLabel } from "../../_components/bank-labels";
import { accountChipLabel, dayLabel } from "../../bank-accounts/_components/types";
import { CaseNotes } from "./case-notes";
import { CaseActions } from "./case-actions";
import { RESOLUTION_LABELS, parkedLabel, type SuspenseDetail, type SuspenseNote } from "./types";

const log = createLogger("accounts:suspense");

interface Props {
  caseId: string | null;
  canEdit: boolean;
  canApprove: boolean;
  onClose: () => void;
  /** Something changed — the list behind the sheet should reload. */
  onChanged: () => void;
}

export function CaseSheet({ caseId, canEdit, canApprove, onClose, onChanged }: Props) {
  const [detail, setDetail] = useState<SuspenseDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  // Why the case was re-read after a 409. Kept across that reload (unlike `flash`), and shown
  // only for the case it belongs to.
  const [notice, setNotice] = useState<{ caseId: string; text: string } | null>(null);
  const triggerRef = useRef<Element | null>(null);

  // Derived, not set in the effect body: loading whenever the case (or a retry) names a request
  // whose answer has not landed yet (the expenses-page pattern).
  const requestKey = caseId ? `${caseId}|${reload}` : null;
  const loading = requestKey !== null && loadedFor !== requestKey;

  useEffect(() => {
    if (!caseId) return;
    let cancelled = false;
    const key = `${caseId}|${reload}`;
    apiTry<SuspenseDetail>(`/api/bank-suspense/${caseId}`).then(({ data, error, status }) => {
      if (cancelled) return;
      if (error || !data) {
        log.error("case load failed", { suspenseId: caseId, status, message: error });
        setLoadError(error ?? "Could not load this case.");
        setDetail(null);
      } else {
        setLoadError(null);
        setDetail(data);
      }
      setFlash(null);
      setLoadedFor(key);
    });
    return () => {
      cancelled = true;
    };
  }, [caseId, reload]);

  // Read through refs, so the open/close effect below depends on the case alone. Depending on
  // `busy` would re-run its cleanup on every action — handing focus to the card behind the sheet
  // while the sheet is still open.
  const busyRef = useRef(busy);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    busyRef.current = busy;
    onCloseRef.current = onClose;
  }, [busy, onClose]);

  useEffect(() => {
    if (!caseId) return;
    triggerRef.current = document.activeElement;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busyRef.current) onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      (triggerRef.current as HTMLElement | null)?.focus?.();
    };
  }, [caseId]);

  const onUpdated = useCallback(
    (d: SuspenseDetail, done: string) => {
      setDetail(d);
      setFlash(done);
      setNotice(null);
      onChanged();
    },
    [onChanged]
  );

  const onNoteAdded = useCallback(
    (note: SuspenseNote) => {
      setDetail((d) => (d ? { ...d, notes: [...d.notes, note], noteCount: d.noteCount + 1 } : d));
      onChanged();
    },
    [onChanged]
  );

  if (!caseId) return null;

  const line = detail?.line;
  const debit = line?.type === "DEBIT";
  const account = line ? (line.account ? accountChipLabel(line.account) : `${line.bank} · account not set`) : "";

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/40 sm:p-4" onClick={() => !busy && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Suspense case"
        className="bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between p-4 border-b border-slate-100 shrink-0">
          <div className="pr-3 min-w-0">
            {line ? (
              <>
                <p className={`text-lg font-bold tabular-nums ${debit ? "text-red-600" : "text-green-700"}`}>
                  {debit ? "−" : "+"}
                  {inr(line.amount)}
                  <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">{debit ? "debit" : "credit"}</span>
                </p>
                <p className="text-xs text-slate-500 truncate">
                  {dayLabel(line.date, { weekday: true, year: false })} · {account}
                </p>
              </>
            ) : (
              <h2 className="text-base font-bold text-slate-900">Suspense case</h2>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center -mr-2 -mt-2 text-slate-400 hover:text-slate-600 disabled:opacity-50 focus-ring rounded"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-4 space-y-4 overflow-y-auto">
          {loading ? (
            <div className="space-y-2" aria-busy="true">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-12 rounded-lg bg-slate-100 animate-pulse" />
              ))}
            </div>
          ) : loadError || !detail || !line ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3">
              <p className="text-xs text-red-700">{loadError ?? "Could not load this case."}</p>
              <button type="button" onClick={() => setReload((r) => r + 1)}
                className="mt-2 min-h-[44px] px-3 rounded-lg text-xs font-medium text-red-700 bg-white border border-red-200 focus-ring">
                Retry
              </button>
            </div>
          ) : (
            <>
              <section aria-label="The bank line" className="space-y-1.5">
                <p className="text-sm text-slate-800 break-words">
                  {line.narration || <span className="italic text-slate-400">No narration on the statement</span>}
                </p>
                {line.reference && <p className="text-[11px] text-slate-500 break-all">Ref {line.reference}</p>}
                <Link
                  href={`/accounts/reconcile/${line.statementId}?txn=${line.id}`}
                  className="inline-flex items-center gap-1 min-h-[44px] text-xs font-medium text-blue-600 hover:text-blue-700 focus-ring rounded"
                >
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                  Open it on its statement
                </Link>
              </section>

              <section aria-label="Where it stands" className="rounded-lg bg-slate-50 p-3 space-y-1 text-xs">
                <p className="text-slate-800">
                  <span className="text-slate-500">Why parked: </span>
                  {detail.reason}
                </p>
                <p className="text-slate-600">
                  Parked by {detail.parkedBy.name}, {whenLabel(detail.parkedAt)} · {parkedLabel(detail)}
                </p>
                <p className="text-slate-600">
                  <span className="text-slate-500">Chasing: </span>
                  {detail.assigneeLabel ?? <span className="italic text-slate-400">nobody yet</span>}
                </p>
                {detail.status === "CLOSED" && detail.resolution && (
                  <p className="text-slate-800 pt-1 border-t border-slate-200 mt-1">
                    <span className="font-semibold">{RESOLUTION_LABELS[detail.resolution]}</span>
                    {detail.resolvedBy ? ` by ${detail.resolvedBy.name}` : ""}
                    {detail.resolvedAt ? `, ${whenLabel(detail.resolvedAt)}` : ""}
                    {detail.resolutionNote ? ` — ${detail.resolutionNote}` : ""}
                  </p>
                )}
              </section>

              {notice && notice.caseId === detail.id && (
                <p role="alert" className="flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
                  {notice.text} This is how it stands now.
                </p>
              )}

              {flash && (
                <p role="status" className="flex items-center gap-1.5 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-800">
                  <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                  {flash}
                </p>
              )}

              <CaseActions
                key={`${detail.id}|${detail.status}`}
                detail={detail}
                canEdit={canEdit}
                canApprove={canApprove}
                busy={busy}
                setBusy={setBusy}
                onUpdated={onUpdated}
                onStale={(text) => {
                  setNotice({ caseId: detail.id, text });
                  setReload((r) => r + 1);
                  onChanged();
                }}
              />

              <CaseNotes key={detail.id} caseId={detail.id} notes={detail.notes} canEdit={canEdit} busy={busy} setBusy={setBusy} onAdded={onNoteAdded} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
