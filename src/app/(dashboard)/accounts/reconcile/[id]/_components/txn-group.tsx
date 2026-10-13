"use client";

// Lines the AI gave the same note or category, clubbed so they can be ticked together (ten
// "bank charges" lines skipped in one go). Every line inside keeps its own actions.
import { CheckSquare, ChevronDown, ChevronUp, Layers, Square } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { useReconcile } from "./context";
import { TxnLine } from "./txn-card";
import { inr, lineState, type BankTxn } from "./types";

export function TxnGroup({
  label,
  txns,
  collapsed,
  onToggle,
}: {
  label: string;
  txns: BankTxn[];
  collapsed: boolean;
  onToggle: () => void;
}) {
  const { perms, selected, selectMany } = useReconcile();
  const total = txns.reduce((s, t) => s + t.amount, 0);
  const selectable = perms.edit ? txns.filter((t) => lineState(t) === "REVIEW").map((t) => t.id) : [];
  const allTicked = selectable.length > 0 && selectable.every((id) => selected.has(id));

  return (
    <Card className="border-amber-200 bg-amber-50/30">
      <CardContent className="p-0">
        {/* A div, not a button: the select-all control sits inside it, and a <button> inside a
            <button> is invalid HTML. Collapse is an overlay button under the select button. */}
        <div className="relative w-full p-3 flex items-center gap-2 text-left rounded-xl focus-within:ring-2 focus-within:ring-slate-900">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={!collapsed}
            aria-label={`${collapsed ? "Expand" : "Collapse"} ${label}`}
            className="absolute inset-0 z-0 rounded-xl focus:outline-none"
          />
          <Layers className="h-4 w-4 text-amber-600 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-xs font-semibold text-slate-800 truncate">{label}</p>
              <Badge variant="warning" className="text-[10px] shrink-0">
                {txns.length} lines
              </Badge>
            </div>
            <p className="text-[11px] text-slate-500">Total {inr(total)}</p>
          </div>
          <div className="flex items-center shrink-0">
            {selectable.length > 0 && (
              <button
                type="button"
                onClick={() => selectMany(selectable, !allTicked)}
                aria-pressed={allTicked}
                aria-label={allTicked ? `Untick all ${label}` : `Tick all ${label}`}
                className="relative z-10 min-h-11 min-w-11 flex items-center justify-center"
              >
                {allTicked ? <CheckSquare className="h-5 w-5 text-blue-600" /> : <Square className="h-5 w-5 text-slate-300" />}
              </button>
            )}
            {collapsed ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronUp className="h-4 w-4 text-slate-400" />}
          </div>
        </div>

        {!collapsed && (
          <div className="px-3 pb-3 border-t border-amber-100 divide-y divide-amber-100">
            {txns.map((t) => (
              <div key={t.id} className="py-3">
                <TxnLine txn={t} />
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
