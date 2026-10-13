"use client";

import Link from "next/link";
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Loader2, Settings2, Upload } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  STEPS, accountChipLabel, addDays, dayLabel, daysBetween, todayLocal,
  type BankAccountRow, type UploadStep,
} from "./types";

interface UploadCardProps {
  accounts: BankAccountRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  periodFrom: string;
  periodTo: string;
  onPeriodFrom: (v: string) => void;
  onPeriodTo: (v: string) => void;
  /** End of the latest statement period already on file for the selected account, if known. */
  lastEnded: string | null;
  uploading: boolean;
  step: UploadStep;
  onFile: (file: File) => void;
}

/** The same limit the server applies (bankStatementUploadSchema): a week is ideal. */
const MAX_PERIOD_DAYS = 92;

/**
 * Pick the account, type the period the bank printed on the statement (Q4), then choose the file.
 * The file button stays disabled until all three are set — the server would refuse anyway, but
 * only after the person has gone looking for the file.
 */
export function UploadCard({
  accounts, selectedId, onSelect, periodFrom, periodTo, onPeriodFrom, onPeriodTo,
  lastEnded, uploading, step, onFile,
}: UploadCardProps) {
  const today = todayLocal();
  const selected = accounts.find((a) => a.id === selectedId) ?? null;

  const periodProblem =
    periodFrom && periodTo && periodFrom > periodTo
      ? "Statement from is after Statement to."
      : periodTo && periodTo > today
        ? "Statement to is in the future — a statement covers days that have happened."
        : periodFrom && periodTo && daysBetween(periodFrom, periodTo) > MAX_PERIOD_DAYS
          ? "Upload at most three months at a time — a week is ideal."
          : null;
  const ready = !!selected && !!periodFrom && !!periodTo && !periodProblem && !uploading;
  const nextStart = lastEnded ? addDays(lastEnded, 1) : null;

  const stepIndex = STEPS.findIndex((s) => s.key === step);
  const progressPct =
    step === "error" ? (stepIndex >= 0 ? (stepIndex / STEPS.length) * 100 : 25)
      : step === "done" ? 100
        : step === "idle" ? 0
          : ((stepIndex + 0.5) / STEPS.length) * 100;

  const field = "block text-[10px] font-medium text-slate-500 uppercase tracking-wide mb-1";

  return (
    <Card className="mb-4 border-dashed border-2 border-slate-300">
      <CardContent className="p-4 space-y-4">
        <div className="text-center">
          <FileSpreadsheet className="h-8 w-8 text-slate-400 mx-auto mb-1" />
          <p className="text-sm font-medium text-slate-700">Upload a bank statement</p>
          <p className="text-[11px] text-slate-500">CSV or XLS, as downloaded from the bank</p>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <span className={field}>Account</span>
            <Link
              href="/accounts/bank-accounts"
              className="inline-flex items-center gap-1 min-h-[44px] -my-3 px-1 text-[11px] text-blue-600 focus-ring rounded"
            >
              <Settings2 className="h-3 w-3" />Manage accounts
            </Link>
          </div>
          <div className="flex gap-2 flex-wrap" role="group" aria-label="Bank account">
            {accounts.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => onSelect(a.id)}
                disabled={uploading}
                aria-pressed={a.id === selectedId}
                className={`min-h-[44px] px-4 rounded-full text-xs font-medium transition-colors focus-ring disabled:opacity-60 ${
                  a.id === selectedId ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700"
                }`}
              >
                {accountChipLabel(a)}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label htmlFor="period-from" className={field}>Statement from</label>
            <Input
              id="period-from"
              type="date"
              value={periodFrom}
              max={periodTo || today}
              onChange={(e) => onPeriodFrom(e.target.value)}
              disabled={uploading}
              required
            />
          </div>
          <div>
            <label htmlFor="period-to" className={field}>Statement to</label>
            <Input
              id="period-to"
              type="date"
              value={periodTo}
              min={periodFrom || undefined}
              max={today}
              onChange={(e) => onPeriodTo(e.target.value)}
              disabled={uploading}
              required
            />
          </div>
        </div>
        <p className="text-[11px] text-slate-500 -mt-2">The dates printed on the statement, not the day you downloaded it.</p>
        {periodProblem && <p role="alert" className="text-[11px] text-red-600 -mt-2">{periodProblem}</p>}

        {selected && nextStart && (
          <div className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 -mt-1">
            <p className="text-[11px] text-slate-600">
              The last {selected.name} statement ended {dayLabel(lastEnded, { weekday: true, year: false })}.
            </p>
            {periodFrom !== nextStart && nextStart <= today && (
              <button
                type="button"
                onClick={() => onPeriodFrom(nextStart)}
                disabled={uploading}
                className="shrink-0 min-h-[44px] -my-2 px-2 text-[11px] font-medium text-blue-600 focus-ring rounded"
              >
                Start {dayLabel(nextStart, { year: false })}
              </button>
            )}
          </div>
        )}

        <label
          aria-disabled={!ready}
          className={`flex items-center justify-center gap-2 w-full min-h-[48px] rounded-lg text-sm font-medium transition-colors ${
            uploading
              ? "bg-slate-100 text-slate-400"
              : ready
                ? "bg-blue-600 text-white hover:bg-blue-700 cursor-pointer"
                : "bg-slate-200 text-slate-500 cursor-not-allowed"
          }`}
        >
          {uploading ? (
            <><Loader2 className="h-4 w-4 animate-spin" />Processing…</>
          ) : (
            <><Upload className="h-4 w-4" />Choose file &amp; upload</>
          )}
          <input
            type="file"
            accept=".csv,.xls,.xlsx,.txt"
            className="hidden"
            disabled={!ready}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onFile(file);
              e.target.value = "";
            }}
          />
        </label>
        {!uploading && !ready && !periodProblem && (
          <p className="text-[11px] text-slate-500 text-center -mt-2">
            {!selected ? "Pick the account first." : "Enter the statement's From and To dates first."}
          </p>
        )}

        {step !== "idle" && (
          <div>
            <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  step === "error" ? "bg-red-500" : step === "done" ? "bg-green-500" : "bg-blue-500"
                }`}
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <div className="grid grid-cols-2 sm:flex sm:justify-between gap-1 mt-1.5">
              {STEPS.map((s, i) => {
                const isActive = s.key === step;
                const isPast = stepIndex > i || step === "done";
                const isFailed = step === "error" && stepIndex === i;
                return (
                  <div key={s.key} className="flex items-center gap-1">
                    {isPast ? (
                      <CheckCircle2 className="h-3 w-3 text-green-500" />
                    ) : isFailed ? (
                      <AlertTriangle className="h-3 w-3 text-red-500" />
                    ) : isActive ? (
                      <Loader2 className="h-3 w-3 text-blue-500 animate-spin" />
                    ) : (
                      <div className="h-3 w-3 rounded-full border border-slate-300" />
                    )}
                    <span className={`text-[10px] ${isPast ? "text-green-600" : isFailed ? "text-red-600" : isActive ? "text-blue-600 font-medium" : "text-slate-400"}`}>
                      {s.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
