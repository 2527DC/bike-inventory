"use client";

// The phone layout of a /transfers order (plan 2209-transfers-list-table-and-cards, R1, R3–R5,
// Q2a, Q3a). Line 1 order no + status (+ doc); line 2 From → To; line 3 items · date; line 4 the
// note(s), only when present; line 5 Approve / Reject, only for approvers on PENDING. The whole
// card opens the transfer. Labels, colours and actions come from ./transfer-row.

import type { MouseEvent as ReactMouseEvent } from "react";
import Link from "next/link";
import { ArrowRight, FileCheck, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  StatusBadge, formatDate, itemsSummary, reviewNote, routeLabel, showReview, transferAccent,
  type TransferOrder, type TransferRowContext,
} from "./transfer-row";

/** Stop the click reaching the card's Link, so Approve / Reject never also open it (R5). */
function swallow(e: ReactMouseEvent) {
  e.preventDefault();
  e.stopPropagation();
}

export function TransferCard({ order, ctx }: { order: TransferOrder; ctx: TransferRowContext }) {
  const route = routeLabel(order);
  const items = itemsSummary(order);
  const note = reviewNote(order);
  const busy = ctx.approvingId === order.id;

  return (
    <Link href={ctx.hrefFor(order)} className="block focus-ring rounded-xl">
      <Card className={`overflow-hidden border-l-4 ${transferAccent(order.status)} transition-colors hover:border-slate-300 active:bg-slate-50`}>
        <CardContent className="p-3 space-y-1">
          {/* Line 1 — order no · status · document tick. */}
          <div className="flex items-center gap-2 min-w-0">
            <p className="text-base font-semibold text-slate-900 tabular-nums truncate">{order.orderNo}</p>
            <StatusBadge status={order.status} />
            {order.docUrl && (
              <FileCheck className="h-4 w-4 text-green-600 shrink-0" aria-label="Document attached" />
            )}
          </div>

          {/* Line 2 — From → To. */}
          <p className="text-xs text-slate-600 flex items-center gap-1 min-w-0">
            <span className="truncate">{route.from}</span>
            <ArrowRight className="h-3 w-3 text-purple-500 shrink-0" aria-hidden />
            <span className="truncate">{route.to}</span>
          </p>

          {/* Line 3 — items · first product +N more · by · date. */}
          <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
            <p className="min-w-0 truncate">
              <span className="tabular-nums">{items.count}</span>
              {items.preview && <> · {items.preview}</>}
            </p>
            <span className="shrink-0 tabular-nums">{formatDate(order.createdAt)}</span>
          </div>
          <p className="text-[11px] text-slate-400 truncate">
            By {order.createdBy.name}
            {order.reviewedBy && (
              <> · {order.status === "APPROVED" ? "Approved" : "Reviewed"} by {order.reviewedBy.name}</>
            )}
          </p>

          {/* Line 4 — only when present. */}
          {order.notes && <p className="text-xs text-slate-400 line-clamp-2 break-words">{order.notes}</p>}
          {note && (
            <p className={`text-xs line-clamp-2 break-words ${note.tone}`}>{note.label}: {note.text}</p>
          )}

          {/* Line 5 — approvers on PENDING only. */}
          {showReview(order, ctx) && (
            <div className="flex gap-2 pt-1">
              <Button size="sm" variant="outline"
                className="flex-1 min-h-[44px] text-sm text-green-600 border-green-200 hover:bg-green-50"
                onClick={(e) => { swallow(e); ctx.onApprove(order); }}
                disabled={busy}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Approve"}
              </Button>
              <Button size="sm" variant="outline"
                className="flex-1 min-h-[44px] text-sm text-red-600 border-red-200 hover:bg-red-50"
                onClick={(e) => { swallow(e); ctx.onReject(order); }}
                disabled={busy}>
                Reject
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}
