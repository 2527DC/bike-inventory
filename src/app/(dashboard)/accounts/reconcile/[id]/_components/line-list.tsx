"use client";

// The lines of the chosen filter: clubbed groups first, then single lines newest first — and the
// empty state of each filter. The Suspense filter points at /accounts/suspense, where parked lines
// are worked (plan 1210 bank, D3).
import { useMemo, useState } from "react";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { TxnCard } from "./txn-card";
import { TxnGroup } from "./txn-group";
import { groupTransactions, type BankTxn, type FilterKey } from "./types";

const EMPTY: Record<FilterKey, string> = {
  REVIEW: "Every line on this statement is handled.",
  SUSPENSE: "Nothing from this statement is in suspense.",
  RECORDED: "Nothing from this statement is recorded yet.",
  SKIPPED: "No skipped lines.",
  ALL: "This statement has no lines.",
};

export function LineList({ lines, filter }: { lines: BankTxn[]; filter: FilterKey }) {
  const grouped = useMemo(() => groupTransactions(lines), [lines]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const toggle = (label: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });

  return (
    <>
      {filter === "SUSPENSE" && lines.length > 0 && (
        <Link href="/accounts/suspense" className="block mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          Parked lines are chased on the <span className="font-semibold underline">Suspense screen</span> — who is on it,
          the notes, and closing them as explained or written off.
        </Link>
      )}

      <div className="space-y-2">
        {grouped.map((g) =>
          g.txns.length === 1 ? (
            <TxnCard key={g.txns[0].id} txn={g.txns[0]} />
          ) : (
            <TxnGroup
              key={`group-${g.label}`}
              label={g.label}
              txns={g.txns}
              collapsed={collapsed.has(g.label)}
              onToggle={() => toggle(g.label)}
            />
          )
        )}
      </div>

      {lines.length === 0 && (
        <div className="text-center py-10">
          <CheckCircle2 className="h-6 w-6 text-slate-300 mx-auto mb-1" />
          <p className="text-sm text-slate-500">{EMPTY[filter]}</p>
          {filter === "SUSPENSE" && (
            <Link href="/accounts/suspense" className="inline-flex min-h-11 items-center text-sm text-blue-600 underline">
              See every parked line, on all accounts
            </Link>
          )}
        </div>
      )}
    </>
  );
}
