"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Plus, ArrowRightLeft } from "lucide-react";
// No warehouse lookup needed: the API now returns the warehouse names on each line, so
// the page renders what it was given instead of translating a code through a table.
import { type DateRangeKey } from "@/components/date-filter";
import { FilterSheet } from "@/components/filter-sheet";
import { Button } from "@/components/ui/button";
import { SkeletonList } from "@/components/ui/skeleton";
import { ActionConfirmation } from "@/components/ui/action-confirmation";
import { ErrorBanner } from "@/components/ui/error-banner";
import { usePermissions } from "@/lib/use-permissions";
import { apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";
import { endpointLabel, type TransferOrder, type TransferRowContext } from "./_components/transfer-row";
import { TransferTable } from "./_components/transfer-table";
import { TransferCard } from "./_components/transfer-card";

const log = createLogger("transfers:list");

type StatusFilter = "all" | "PENDING" | "APPROVED" | "RETURNED" | "IN_TRANSIT" | "RECEIVED" | "REJECTED" | "CANCELLED";

export default function TransfersPage() {
  const { canApprove: canApproveCheck } = usePermissions();
  const canApprove = canApproveCheck("transfers");
  const [orders, setOrders] = useState<TransferOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [approving, setApproving] = useState<string | null>(null);
  const [dateFilter, setDateFilter] = useState<DateRangeKey>("all");
  const [dateFrom, setDateFrom] = useState<string | undefined>();
  const [dateTo, setDateTo] = useState<string | undefined>();
  const [confirmation, setConfirmation] = useState<{
    type: "success" | "warning" | "error" | "info";
    title: string;
    referenceId: string;
    items?: Array<{ label: string; value: string }>;
    details?: string;
  } | null>(null);
  const [dataError, setDataError] = useState<string | null>(null);
  // Reject asks for a note before it sends anything (R25).
  const [rejectTarget, setRejectTarget] = useState<TransferOrder | null>(null);
  const [rejectNote, setRejectNote] = useState("");

  // apiTry, not a raw fetch. An expired session answers a bare fetch with a 307 to /login and
  // 200 HTML, so `res.ok` is true and `.json()` throws "Unexpected token <" — which surfaced
  // here as "Failed to load data" and sent people looking for a server fault instead of
  // signing back in.
  const fetchData = useCallback(async () => {
    const params = new URLSearchParams({ limit: "50" });
    if (filter !== "all") params.set("status", filter);
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);

    const { data, error } = await apiTry<TransferOrder[]>(`/api/transfer-orders?${params}`);
    if (error) {
      log.warn("transfer list failed", { message: error });
      setDataError(
        typeof navigator !== "undefined" && !navigator.onLine
          ? "You’re offline. Check your connection and retry."
          : error
      );
    } else {
      setOrders(data ?? []);
      setDataError(null);
    }
    return true;
  }, [filter, dateFrom, dateTo]);

  // The load runs INSIDE the effect behind a `cancelled` guard — P7 `inbound/[id]`. The old
  // shape called a loader from the effect body, which set `loading` synchronously on every
  // filter change and tripped react-hooks/set-state-in-effect. The guard also stops a slow
  // response for the previous filter overwriting the current one.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await fetchData();
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [fetchData]);

  // Reject sends the transfer BACK with a note (R25), so it asks for one first. An empty
  // "sent back" is what this replaced: the creator saw a dead record and no idea what to fix.
  async function handleAction(id: string, action: "approve" | "reject", rejectionNote?: string) {
    setApproving(id);
    {
      const { data: ok, error } = await apiTry<{ message: string }>(
        `/api/transfer-orders/${id}/approve`,
        { method: "POST", json: action === "reject" ? { action, rejectionNote } : { action } }
      );
      if (!ok) {
        // The refusal used to be swallowed by a bare `catch {}` and the button simply
        // stopped spinning, which reads as "nothing happened" for a 403, a 409 and a
        // network fault alike.
        log.warn("transfer review failed", { action, message: error });
        setDataError(error ?? `Could not ${action} this transfer`);
        setApproving(null);
        return;
      }
      {
        const order = orders.find((o) => o.id === id);
        setOrders((prev) =>
          prev.map((o) =>
            o.id === id
              ? {
                  ...o,
                  status: action === "approve" ? "APPROVED" : "RETURNED",
                  rejectionNote: action === "reject" ? rejectionNote ?? null : o.rejectionNote,
                }
              : o
          )
        );
        if (order) {
          if (action === "approve") {
            setConfirmation({
              type: "success",
              title: "Transfer Approved",
              referenceId: order.orderNo,
              items: [
                { label: "Items", value: `${order._count.items} item${order._count.items !== 1 ? "s" : ""}` },
                ...order.items.slice(0, 3).map((item) => ({
                  label: item.product.name,
                  value: `${endpointLabel(item.fromBin, item.fromWarehouse?.name ?? null)} → ${endpointLabel(item.toBin, item.toWarehouse?.name ?? null)} (Qty: ${item.quantity})`,
                })),
              ],
              // NOT "stock moved". Approval agrees to the transfer; dispatch is what moves
              // it. Saying otherwise sends somebody to look for goods still in the other
              // building — which is exactly what the old auto-approve copy did.
              details: order.notes
                ? `${order.notes} — approved, not yet dispatched.`
                : "Approved — nothing has moved yet. Dispatch it when the van leaves.",
            });
          } else {
            setConfirmation({
              type: "warning",
              title: "Sent back for correction",
              referenceId: order.orderNo,
              items: [
                { label: "Items", value: `${order._count.items} item${order._count.items !== 1 ? "s" : ""}` },
                { label: "Back with", value: order.createdBy.name },
              ],
              details: rejectionNote || "No reason provided",
            });
          }
        }
      }
    }
    setApproving(null);
  }

  // What the table and the cards need besides the order itself (plan 2209). The whole row or
  // card opens the transfer; Approve / Reject call back here and never navigate (R1, R5).
  const rowCtx: TransferRowContext = {
    canApprove,
    approvingId: approving,
    onApprove: (order) => { void handleAction(order.id, "approve"); },
    onReject: (order) => { setRejectTarget(order); setRejectNote(""); },
    hrefFor: (order) => `/transfers/${order.id}`,
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900">Transfer Orders</h1>
          <p className="text-xs text-slate-500">Stock moves between warehouses</p>
        </div>
        <Link href="/transfers/new">
          <Button size="sm" className="h-12 px-4 bg-purple-600 hover:bg-purple-700 text-sm">
            <Plus className="h-4 w-4 mr-1" /> New Order
          </Button>
        </Link>
      </div>

      <FilterSheet
        className="mb-3"
        dateValue={dateFilter}
        onDateChange={(key, from, to) => { setDateFilter(key); setDateFrom(from); setDateTo(to); }}
        groups={[{
          label: "Status",
          value: filter,
          defaultValue: "all",
          options: [
            { key: "all", label: "All" },
            { key: "PENDING", label: "Pending" },
            { key: "APPROVED", label: "Approved" },
            // Sent back to its creator (R25). Without a chip a returned transfer would be
            // invisible on every tab but All — the mistake CANCELLED made for months.
            { key: "RETURNED", label: "Returned" },
            // Filterable from today even though P14 is what starts writing them. An order
            // that reaches one of these states must not be invisible on every tab.
            { key: "IN_TRANSIT", label: "In Transit" },
            { key: "RECEIVED", label: "Received" },
            { key: "REJECTED", label: "Rejected" },
            // Without this a cancelled transfer was invisible on every tab except All —
            // the status has existed since 0_init and has never had a chip.
            { key: "CANCELLED", label: "Cancelled" },
          ],
          onChange: (key) => setFilter(key as StatusFilter),
        }]}
      />

      {/* Data Load Error */}
      {dataError && (
        <ErrorBanner
          message={dataError}
          type={typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "error"}
          onRetry={() => { setDataError(null); void fetchData(); }}
          onDismiss={() => setDataError(null)}
        />
      )}

      {loading ? (
        <SkeletonList count={6} type="card" />
      ) : orders.length === 0 ? (
        <div className="text-center py-12">
          <ArrowRightLeft className="h-10 w-10 text-slate-300 mx-auto mb-3" />
          <p className="text-sm text-slate-400">No transfer orders found</p>
          <Link href="/transfers/new">
            <Button variant="outline" size="sm" className="mt-3">Create First Transfer</Button>
          </Link>
        </div>
      ) : (
        <>
          {/* One list, two layouts (R2/R3): the table from 1024 px, cards below it. */}
          <div className="hidden lg:block">
            <TransferTable orders={orders} ctx={rowCtx} />
          </div>
          <div className="lg:hidden space-y-2">
            {orders.map((order) => (
              <TransferCard key={order.id} order={order} ctx={rowCtx} />
            ))}
          </div>
        </>
      )}

      {rejectTarget && (
        <div
          className="fixed inset-0 bg-black/50 z-[60] flex items-end sm:items-center justify-center p-4"
          onClick={() => setRejectTarget(null)}
        >
          <div
            className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-md p-5 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-base font-bold text-slate-900">Send {rejectTarget.orderNo} back?</h2>
            <p className="text-xs text-slate-500">
              {rejectTarget.createdBy.name} gets your note and fixes this same transfer.
            </p>
            <textarea
              value={rejectNote}
              onChange={(e) => setRejectNote(e.target.value)}
              rows={3}
              maxLength={1000}
              placeholder="What needs correcting?"
              className="w-full rounded-lg border border-slate-200 p-2.5 text-sm focus-ring"
            />
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setRejectTarget(null)} className="flex-1 min-h-[44px]">
                Keep it
              </Button>
              <Button
                onClick={() => {
                  const target = rejectTarget;
                  setRejectTarget(null);
                  void handleAction(target.id, "reject", rejectNote.trim());
                }}
                disabled={rejectNote.trim().length === 0 || approving !== null}
                className="flex-1 min-h-[44px] bg-red-600 hover:bg-red-700"
              >
                Send back
              </Button>
            </div>
          </div>
        </div>
      )}

      <ActionConfirmation
        open={!!confirmation}
        onClose={() => setConfirmation(null)}
        type={confirmation?.type || "success"}
        title={confirmation?.title || ""}
        referenceId={confirmation?.referenceId || ""}
        items={confirmation?.items}
        details={confirmation?.details}
      />
    </div>
  );
}
