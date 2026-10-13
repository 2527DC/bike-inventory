"use client";

// One parked bank line in the register (plan 1210-bank-accounts-and-suspense, D3). The whole
// card is the button that opens its sheet.
import { MessageSquare, UserRound, ChevronRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { inr, whenLabel } from "../../_components/bank-labels";
import { accountChipLabel, dayLabel } from "../../bank-accounts/_components/types";
import { RESOLUTION_LABELS, parkedLabel, type SuspenseRow } from "./types";

const RESOLUTION_STYLE: Record<string, string> = {
  RECORDED: "bg-green-100 text-green-800",
  EXPLAINED: "bg-blue-100 text-blue-800",
  WRITTEN_OFF: "bg-slate-200 text-slate-700",
};

export function SuspenseCard({ row, onOpen }: { row: SuspenseRow; onOpen: (id: string) => void }) {
  const { line } = row;
  const debit = line.type === "DEBIT";
  const account = line.account ? accountChipLabel(line.account) : `${line.bank} · account not set`;
  const day = dayLabel(line.date, { weekday: true, year: false });
  const overdue = row.status === "OPEN" && row.daysParked > 7;

  return (
    <button
      type="button"
      onClick={() => onOpen(row.id)}
      className="w-full text-left rounded-xl focus-ring"
      aria-label={`${debit ? "Debit" : "Credit"} ${inr(line.amount)} on ${day}, ${account}. Open the case.`}
    >
      <Card className={`transition-colors active:bg-slate-50 hover:border-slate-300 ${row.status === "CLOSED" ? "opacity-80" : ""}`}>
        <CardContent className="p-3 space-y-1.5">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className={`text-base font-bold tabular-nums ${debit ? "text-red-600" : "text-green-700"}`}>
                {debit ? "−" : "+"}
                {inr(line.amount)}
                <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                  {debit ? "debit" : "credit"}
                </span>
              </p>
              <p className="text-[11px] text-slate-500 truncate">
                {day} · {account}
              </p>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {row.status === "CLOSED" && row.resolution ? (
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${RESOLUTION_STYLE[row.resolution]}`}>
                  {RESOLUTION_LABELS[row.resolution]}
                </span>
              ) : (
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold tabular-nums ${
                    overdue ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-800"
                  }`}
                >
                  {parkedLabel(row)}
                </span>
              )}
              <ChevronRight className="h-4 w-4 text-slate-300" aria-hidden="true" />
            </div>
          </div>

          {line.narration ? (
            <p className="text-xs text-slate-600 line-clamp-2 break-words">{line.narration}</p>
          ) : (
            <p className="text-xs italic text-slate-400">No narration on the statement</p>
          )}

          <p className="text-xs text-slate-800">
            <span className="text-slate-500">Why: </span>
            {row.reason}
          </p>

          <div className="flex items-center gap-1.5 text-xs">
            <UserRound className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
            {row.assigneeLabel ? (
              <span className="text-slate-700 truncate">{row.assigneeLabel}</span>
            ) : (
              <span className="italic text-slate-400">Nobody is chasing it</span>
            )}
            {row.status === "CLOSED" && <span className="text-slate-400 truncate">· {parkedLabel(row)}</span>}
          </div>

          {row.lastNote && (
            <div className="flex items-start gap-1.5 text-[11px] text-slate-500">
              <MessageSquare className="h-3.5 w-3.5 shrink-0 mt-px text-slate-400" aria-hidden="true" />
              <p className="min-w-0 truncate">
                <span className={row.lastNote.isSystem ? "italic" : "text-slate-700"}>{row.lastNote.body}</span>
                <span className="text-slate-400">
                  {" "}
                  — {row.lastNote.author.name}, {whenLabel(row.lastNote.createdAt)}
                </span>
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </button>
  );
}
