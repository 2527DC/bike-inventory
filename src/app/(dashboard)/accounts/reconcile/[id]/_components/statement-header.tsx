"use client";

// The top of /accounts/reconcile/[id]: which account and period this statement is, and the three
// numbers that matter — credits, debits, lines still to review (processedAt null, AI-suggested
// lines included: the AI never decides a line, D5).
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { inr, shortDate, type Statement } from "./types";

export function StatementHeader({ statement, toReview }: { statement: Statement; toReview: number }) {
  const account = statement.bankAccount;
  const period =
    statement.fromDate && statement.toDate ? `${shortDate(statement.fromDate)} – ${shortDate(statement.toDate)}` : null;

  return (
    <>
      <div className="flex items-start gap-2 mb-3">
        <Link
          href="/accounts/bank-upload"
          aria-label="Back to bank statements"
          className="min-h-11 min-w-11 -ml-2 flex items-center justify-center"
        >
          <ArrowLeft className="h-5 w-5 text-slate-600" />
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-base font-bold text-slate-900">Reconcile</h1>
          <p className="text-xs text-slate-700 truncate">
            {account ? (
              <>
                {account.name}
                {account.accountLast4 ? ` ••••${account.accountLast4}` : ""}
                {account.store ? ` · ${account.store.name}` : " · Store not set"}
              </>
            ) : (
              <span className="text-amber-700">{statement.bank} · no bank account assigned yet</span>
            )}
          </p>
          <p className="text-[11px] text-slate-500 truncate">
            {period ? `${period} · ` : ""}
            {statement.txnCount} lines · {statement.fileName}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-1.5 mb-3">
        <Card className="bg-green-50 border-green-200">
          <CardContent className="p-2 text-center">
            <p className="text-sm font-bold text-green-700 tabular-nums">{inr(statement.totalCredits)}</p>
            <p className="text-[10px] text-green-600">Credits</p>
          </CardContent>
        </Card>
        <Card className="bg-red-50 border-red-200">
          <CardContent className="p-2 text-center">
            <p className="text-sm font-bold text-red-700 tabular-nums">{inr(statement.totalDebits)}</p>
            <p className="text-[10px] text-red-600">Debits</p>
          </CardContent>
        </Card>
        <Card className="bg-blue-50 border-blue-200">
          <CardContent className="p-2 text-center">
            <p className="text-sm font-bold text-blue-700 tabular-nums">{toReview}</p>
            <p className="text-[10px] text-blue-600">To review</p>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
