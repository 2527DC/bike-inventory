"use client";

import { Check, Plus, ListChecks } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CATEGORY_LABELS, PAYMENT_MODE_LABELS, batchTotal, formatCurrency, type ExpenseRow } from "./types";

interface NextStepProps {
  /** The row that was just completed. */
  added: ExpenseRow;
  rows: ExpenseRow[];
  onAddAnother: () => void;
  onReview: () => void;
}

/** Step 6 — the row is in the batch; add another or go to review (R8). */
export function NextStep({ added, rows, onAddAnother, onReview }: NextStepProps) {
  const total = batchTotal(rows);

  return (
    <div>
      <Card className="border-green-200 bg-green-50">
        <CardContent className="p-3 flex items-start gap-3">
          <span className="h-8 w-8 rounded-full bg-green-600 text-white flex items-center justify-center shrink-0">
            <Check className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-green-700">Added to the batch</p>
            <p className="text-lg font-bold text-slate-900 tabular-nums">{formatCurrency(added.amount)}</p>
            <p className="text-sm text-slate-700 truncate">{added.description}</p>
            <p className="text-xs text-slate-500">
              {CATEGORY_LABELS[added.category].label} · {PAYMENT_MODE_LABELS[added.paymentMode]}
              {added.receiptUrl ? " · photo attached" : ""}
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="mt-3 flex items-center justify-between text-sm px-1">
        <span className="text-slate-500">{rows.length === 1 ? "1 expense" : `${rows.length} expenses`} so far</span>
        <span className="font-semibold text-slate-900 tabular-nums">{formatCurrency(total)}</span>
      </div>

      <div className="mt-6 space-y-2">
        <Button type="button" variant="outline" size="lg" onClick={onAddAnother} className="w-full min-h-[52px]">
          <Plus className="h-4 w-4 mr-1.5" /> Add another expense
        </Button>
        <Button type="button" size="lg" onClick={onReview} className="w-full min-h-[52px] bg-blue-600 hover:bg-blue-700">
          <ListChecks className="h-4 w-4 mr-1.5" /> Review {rows.length === 1 ? "and submit" : `${rows.length} expenses`}
        </Button>
      </div>
    </div>
  );
}
