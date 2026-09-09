"use client";

import { Pencil, Trash2, Plus, Paperclip, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ErrorBanner } from "@/components/ui/error-banner";
import { CATEGORY_LABELS, PAYMENT_MODE_LABELS, batchTotal, formatCurrency, type ExpenseRow } from "./types";

interface ReviewStepProps {
  rows: ExpenseRow[];
  date: string;
  payer: string;
  submitting: boolean;
  error: string;
  onEdit: (key: string) => void;
  onRemove: (key: string) => void;
  onAddAnother: () => void;
  onSubmit: () => void;
  onDismissError: () => void;
}

/** Step 7 — every row, per-row edit and remove, the batch total, one Submit (R9, Q5). */
export function ReviewStep({
  rows, date, payer, submitting, error, onEdit, onRemove, onAddAnother, onSubmit, onDismissError,
}: ReviewStepProps) {
  const total = batchTotal(rows);
  const dateLabel = date ? new Date(`${date}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—";

  return (
    <div>
      {error && <ErrorBanner message={error} onDismiss={onDismissError} />}

      <p className="text-xs text-slate-500 mb-2">
        {dateLabel} · paid by <span className="font-medium text-slate-700">{payer || "—"}</span>
      </p>

      <div className="space-y-2">
        {rows.map((row, i) => (
          <Card key={row.key}>
            <CardContent className="p-3">
              <div className="flex items-start gap-3">
                {row.receiptUrl ? (
                  <a
                    href={row.receiptUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0"
                    aria-label="Open receipt photo"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={row.receiptUrl} alt="" className="h-12 w-12 rounded-lg object-cover border border-slate-200" />
                  </a>
                ) : (
                  <span className="shrink-0 h-12 w-12 rounded-lg bg-slate-100 text-slate-400 text-xs font-semibold flex items-center justify-center tabular-nums">
                    {i + 1}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-base font-bold text-slate-900 tabular-nums">{formatCurrency(row.amount)}</p>
                    <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 shrink-0">
                      {PAYMENT_MODE_LABELS[row.paymentMode]}
                    </span>
                  </div>
                  <p className="text-sm text-slate-800 break-words">{row.description}</p>
                  <p className="text-xs text-slate-500 flex items-center gap-1">
                    {CATEGORY_LABELS[row.category].label}
                    {row.receiptUrl && <Paperclip className="h-3 w-3" aria-label="Photo attached" />}
                  </p>
                </div>
              </div>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => onEdit(row.key)}
                  disabled={submitting}
                  className="flex-1 min-h-[44px] rounded-lg border border-slate-200 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 flex items-center justify-center gap-1.5 disabled:opacity-50"
                >
                  <Pencil className="h-4 w-4" /> Edit
                </button>
                <button
                  type="button"
                  onClick={() => onRemove(row.key)}
                  disabled={submitting}
                  className="flex-1 min-h-[44px] rounded-lg border border-red-200 bg-white text-sm font-medium text-red-600 hover:bg-red-50 flex items-center justify-center gap-1.5 disabled:opacity-50"
                >
                  <Trash2 className="h-4 w-4" /> Remove
                </button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="bg-slate-50 mt-3">
        <CardContent className="p-3 flex items-center justify-between">
          <span className="text-sm text-slate-500">{rows.length === 1 ? "1 expense" : `${rows.length} expenses`}</span>
          <span className="text-xl font-bold text-slate-900 tabular-nums">{formatCurrency(total)}</span>
        </CardContent>
      </Card>

      <div className="mt-6 space-y-2">
        <Button type="button" variant="outline" size="lg" onClick={onAddAnother} disabled={submitting} className="w-full min-h-[48px]">
          <Plus className="h-4 w-4 mr-1.5" /> Add another expense
        </Button>
        <Button
          type="button"
          size="lg"
          onClick={onSubmit}
          disabled={submitting || rows.length === 0}
          className="w-full min-h-[52px] bg-green-600 hover:bg-green-700"
        >
          {submitting ? (
            <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Recording…</>
          ) : (
            `Submit ${rows.length === 1 ? "expense" : `${rows.length} expenses`} · ${formatCurrency(total)}`
          )}
        </Button>
      </div>
    </div>
  );
}
