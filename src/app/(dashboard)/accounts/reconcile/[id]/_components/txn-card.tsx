"use client";

// One bank line: what the bank printed, what the AI suggests (never a decision — D5), where the
// line stands, and — for a line still to review or in suspense — what can be done with it.
import Link from "next/link";
import { Building2, CheckCircle2, CheckSquare, PauseCircle, Sparkles, Square } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { useReconcile } from "./context";
import { LineActions } from "./line-actions";
import { aiSuggestion, inr, lineState, shortDate, type BankTxn } from "./types";

const FRAME: Record<ReturnType<typeof lineState>, string> = {
  REVIEW: "",
  SUSPENSE: "border-amber-300 bg-amber-50/30",
  RECORDED: "border-green-200 bg-green-50/30",
  SKIPPED: "border-slate-200 opacity-70",
};

/** A line on its own card. Inside a group, `TxnLine` is used without the frame. */
export function TxnCard({ txn }: { txn: BankTxn }) {
  return (
    <Card className={FRAME[lineState(txn)]}>
      <CardContent className="p-3">
        <TxnLine txn={txn} />
      </CardContent>
    </Card>
  );
}

export function TxnLine({ txn }: { txn: BankTxn }) {
  const { perms, bulkMode, selected, toggleSelect, highlightId } = useReconcile();
  const state = lineState(txn);
  const isDebit = txn.type === "DEBIT";
  const selectable = state === "REVIEW" && perms.edit;
  const checked = selected.has(txn.id);
  const ai = state === "REVIEW" ? aiSuggestion(txn) : null;
  const bill = txn.suggestedBill && txn.suggestedBill.vendorId === txn.suggestedVendor?.id ? txn.suggestedBill : null;
  const showActions = perms.edit && !bulkMode && (state === "REVIEW" || state === "SUSPENSE");
  const highlighted = txn.id === highlightId;

  return (
    <div
      id={`txn-${txn.id}`}
      className={`scroll-mt-24 ${highlighted ? "ring-2 ring-amber-400 ring-offset-4 rounded-lg" : ""}`}
      aria-current={highlighted ? "true" : undefined}
    >
      <div className="flex items-start gap-1">
        {selectable && (
          <button
            type="button"
            onClick={() => toggleSelect(txn.id)}
            aria-pressed={checked}
            aria-label={checked ? "Untick this line" : "Tick this line"}
            className="-ml-3 -mt-3 min-h-11 min-w-11 flex items-center justify-center shrink-0"
          >
            {checked ? <CheckSquare className="h-5 w-5 text-blue-600" /> : <Square className="h-5 w-5 text-slate-300" />}
          </button>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs text-slate-500 truncate">
                {shortDate(txn.date)}
                {txn.reference ? ` · ${txn.reference}` : ""}
              </p>
              <p className="text-sm text-slate-700 mt-0.5 line-clamp-2 break-words">
                {txn.description || <span className="italic text-slate-400">No narration</span>}
              </p>
            </div>
            <div className="text-right shrink-0">
              <p className={`text-sm font-bold tabular-nums ${isDebit ? "text-red-600" : "text-green-600"}`}>
                {isDebit ? "−" : "+"}
                {inr(txn.amount)}
              </p>
              {txn.balance !== null && <p className="text-[10px] text-slate-400 tabular-nums">Bal {inr(txn.balance)}</p>}
            </div>
          </div>

          {ai && (
            <div className="mt-1.5 inline-flex max-w-full flex-col rounded-md bg-blue-50 px-2 py-1 text-[11px] text-blue-800">
              <span className="flex items-center gap-1 font-medium">
                {txn.suggestedVendor ? <Building2 className="h-3 w-3 shrink-0" /> : <Sparkles className="h-3 w-3 shrink-0" />}
                <span className="truncate">{ai}</span>
              </span>
              {bill && (
                <span className="text-blue-600 truncate">
                  Bill {bill.billNo} — {inr(bill.amount - bill.paidAmount)} left
                </span>
              )}
            </div>
          )}
          {state === "REVIEW" && txn.flagReason && (
            <p className="mt-1.5 rounded-md bg-amber-50 border border-amber-200 px-2 py-1 text-[11px] text-amber-800">
              AI note: {txn.flagReason}
            </p>
          )}

          <LineStatus txn={txn} />
          {showActions && <LineActions txn={txn} />}
        </div>
      </div>
    </div>
  );
}

function LineStatus({ txn }: { txn: BankTxn }) {
  const state = lineState(txn);
  const s = txn.suspense;
  if (state === "REVIEW") return null;

  if (state === "SUSPENSE") {
    return (
      <div className="mt-2 bg-amber-50 border border-amber-200 rounded-lg px-2 pt-1.5 text-[11px] text-amber-900">
        <p className="font-medium flex items-start gap-1">
          <PauseCircle className="h-3.5 w-3.5 shrink-0 mt-px" />
          <span>In suspense{s ? ` — ${s.reason}` : ""}</span>
        </p>
        {s && (
          <p className="mt-0.5">
            {s.assignee ? `Chasing: ${s.assignee}${s.assigneeOutside ? " (outside the team)" : ""}` : "Nobody chasing it yet"}
            {" · "}
            {s.noteCount} note{s.noteCount === 1 ? "" : "s"} · parked {shortDate(s.parkedAt)}
          </p>
        )}
        <Link href="/accounts/suspense" className="inline-flex min-h-11 items-center font-medium underline">
          Open the Suspense screen
        </Link>
      </div>
    );
  }

  let text: string;
  if (txn.matchStatus === "EXPENSE") text = "Expense recorded";
  else if (txn.matchStatus === "MATCHED") {
    text = txn.confirmedPaymentId
      ? `Payment recorded${txn.confirmedVendor ? ` · ${txn.confirmedVendor.name}` : ""}`
      : "Matched on Daily Settlement";
  } else if (s?.resolution === "EXPLAINED") text = `Explained${s.resolutionNote ? ` — ${s.resolutionNote}` : ""}`;
  else if (s?.resolution === "WRITTEN_OFF") text = `Written off${s.resolutionNote ? ` — ${s.resolutionNote}` : ""}`;
  else text = "Skipped";
  const wasParked = state === "RECORDED" && s?.resolution === "RECORDED";

  return (
    <p className={`flex items-start gap-1 mt-1.5 text-[11px] ${state === "RECORDED" ? "text-green-700" : "text-slate-500"}`}>
      <CheckCircle2 className="h-3.5 w-3.5 shrink-0 mt-px" />
      <span>
        {text}
        {wasParked ? " · was in suspense" : ""}
      </span>
    </p>
  );
}
