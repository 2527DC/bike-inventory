"use client";

// The /transfers list at ≥ 1024 px — plan 2209-transfers-list-table-and-cards, R1/R2/R4/R5, Q1a.
// One row per order; the whole row opens it. Labels, colours and actions come from
// `transfer-row.tsx` so this table and the phone card cannot drift. Render-only: the page owns
// the data and every action.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, FileCheck, Loader2 } from "lucide-react";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import {
  StatusBadge, formatDate, itemsSummary, reviewNote, routeLabel, showReview, transferAccent,
  type TransferOrder, type TransferRowContext,
} from "./transfer-row";

export function TransferTable({ orders, ctx }: { orders: TransferOrder[]; ctx: TransferRowContext }) {
  const router = useRouter();

  // The row navigates on click; an action must not also open the transfer (R5).
  function action(e: React.MouseEvent, run: () => void) {
    e.preventDefault();
    e.stopPropagation();
    run();
  }

  // Not the Table primitive: its `overflow-x-auto` box would always be the sticky header's scroll
  // parent, so the header would never stick against the page. Between 1024 and 1279 px the table
  // scrolls sideways INSIDE its own box (the page never does); from 1280 px the header sticks.
  return (
    <div className="w-full overflow-x-auto xl:overflow-visible rounded-xl border border-slate-200 bg-white shadow-sm">
      <table className="w-full caption-bottom text-sm">
        <TableHeader className="sticky top-0 z-10">
          <TableRow className="hover:bg-transparent">
            <TableHead>Order no</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>From → To</TableHead>
            <TableHead>Items</TableHead>
            <TableHead className="text-center">Doc</TableHead>
            <TableHead>Created</TableHead>
            <TableHead>Reviewed by</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {orders.map((order) => {
            const route = routeLabel(order);
            const items = itemsSummary(order);
            const note = reviewNote(order);
            const busy = ctx.approvingId === order.id;
            return (
              <TableRow
                key={order.id}
                onClick={() => router.push(ctx.hrefFor(order))}
                className="cursor-pointer"
              >
                {/* Order no, a real link for keyboard and middle-click; notes underneath. */}
                <TableCell className={`py-2 min-w-[10rem] max-w-[18rem] border-l-4 ${transferAccent(order.status)}`}>
                  <Link
                    href={ctx.hrefFor(order)}
                    onClick={(e) => e.stopPropagation()}
                    className="text-sm font-semibold text-slate-900 tabular-nums hover:underline focus-ring rounded"
                  >
                    {order.orderNo}
                  </Link>
                  {order.notes && (
                    <p className="text-[11px] text-slate-400 line-clamp-2 break-words mt-0.5" title={order.notes}>
                      {order.notes}
                    </p>
                  )}
                  {note && (
                    <p className={`text-[11px] line-clamp-2 break-words mt-0.5 ${note.tone}`} title={note.text}>
                      {note.label}: {note.text}
                    </p>
                  )}
                </TableCell>

                <TableCell className="py-2 whitespace-nowrap">
                  <StatusBadge status={order.status} />
                </TableCell>

                <TableCell className="py-2 max-w-[16rem]">
                  <span className="flex items-center gap-1 text-xs text-slate-600 min-w-0" title={`${route.from} → ${route.to}`}>
                    <span className="truncate">{route.from}</span>
                    <ArrowRight className="h-3 w-3 text-purple-500 shrink-0" aria-hidden />
                    <span className="truncate">{route.to}</span>
                  </span>
                </TableCell>

                <TableCell className="py-2 max-w-[16rem]">
                  <div className="text-xs text-slate-700 tabular-nums">{items.count}</div>
                  {items.preview && (
                    <div className="text-[11px] text-slate-500 truncate" title={items.preview}>{items.preview}</div>
                  )}
                </TableCell>

                {/* The document decides whether this order can be dispatched at all. */}
                <TableCell className="py-2 text-center">
                  {order.docUrl ? (
                    <FileCheck className="h-4 w-4 text-green-600 inline-block" aria-label="Document attached" />
                  ) : (
                    <span className="text-slate-300">—</span>
                  )}
                </TableCell>

                <TableCell className="py-2 whitespace-nowrap">
                  <div className="text-xs text-slate-700">{order.createdBy.name}</div>
                  <div className="text-[11px] text-slate-400 tabular-nums">{formatDate(order.createdAt)}</div>
                </TableCell>

                <TableCell className="py-2 whitespace-nowrap text-xs text-slate-500">
                  {order.reviewedBy ? order.reviewedBy.name : <span className="text-slate-300">—</span>}
                </TableCell>

                <TableCell className="py-2 text-right whitespace-nowrap">
                  {showReview(order, ctx) ? (
                    <div className="flex gap-1.5 justify-end">
                      <Button size="sm" variant="outline"
                        className="h-8 px-3 text-xs text-green-600 border-green-200 hover:bg-green-50"
                        onClick={(e) => action(e, () => ctx.onApprove(order))}
                        disabled={busy}>
                        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : "Approve"}
                      </Button>
                      <Button size="sm" variant="outline"
                        className="h-8 px-3 text-xs text-red-600 border-red-200 hover:bg-red-50"
                        onClick={(e) => action(e, () => ctx.onReject(order))}
                        disabled={busy}>
                        Reject
                      </Button>
                    </div>
                  ) : null}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </table>
    </div>
  );
}
