"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Plus, ArrowRightLeft, ArrowRight, CheckCircle2, XCircle, Clock, Loader2, Package } from "lucide-react";
// No warehouse lookup needed: the API now returns the warehouse names on each line, so
// the page renders what it was given instead of translating a code through a table.
import { getStatusColor, getStatusLabel } from "@/lib/status-colors";
import { type DateRangeKey } from "@/components/date-filter";
import { FilterSheet } from "@/components/filter-sheet";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SkeletonList } from "@/components/ui/skeleton";
import { ActionConfirmation } from "@/components/ui/action-confirmation";
import { ErrorBanner } from "@/components/ui/error-banner";
import { usePermissions } from "@/lib/use-permissions";

interface TransferOrderItem {
  id: string;
  quantity: number;
  product: { name: string; sku: string; currentStock: number };
  fromBin: { code: string; name: string; location: string } | null;
  toBin: { code: string; name: string; location: string } | null;
  fromWarehouse: { id: string; code: string; name: string } | null;
  toWarehouse: { id: string; code: string; name: string } | null;
}

// Display label for an endpoint: bin code in bin mode, location name in location mode.
function endpointLabel(bin: { code: string } | null, loc: string | null): string {
  if (bin) return bin.code;
  if (loc) return loc;
  return "—";
}

interface TransferOrder {
  id: string;
  orderNo: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
  notes: string | null;
  rejectionNote: string | null;
  createdAt: string;
  createdBy: { name: string };
  reviewedBy: { name: string } | null;
  reviewedAt: string | null;
  items: TransferOrderItem[];
  _count: { items: number };
}

type StatusFilter = "all" | "PENDING" | "APPROVED" | "REJECTED";

export default function TransfersPage() {
  const { canApprove: canApproveCheck } = usePermissions();
  const canApprove = canApproveCheck("transfers");
  const [orders, setOrders] = useState<TransferOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [approving, setApproving] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
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

  const fetchData = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({ limit: "50" });
    if (filter !== "all") params.set("status", filter);
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);

    fetch(`/api/transfer-orders?${params}`)
      .then((r) => r.json())
      .then((res) => { if (res.success) setOrders(res.data); })
      .catch((e) => {
        if (typeof navigator !== "undefined" && !navigator.onLine) {
          setDataError("You're offline. Check your connection and retry.");
        } else {
          setDataError(e instanceof Error ? e.message : "Failed to load data. Tap retry.");
        }
      })
      .finally(() => setLoading(false));
  }, [filter, dateFrom, dateTo]);

  useEffect(() => { fetchData(); }, [fetchData]);

  async function handleAction(id: string, action: "approve" | "reject") {
    setApproving(id);
    try {
      const res = await fetch(`/api/transfer-orders/${id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (data.success) {
        const order = orders.find((o) => o.id === id);
        setOrders((prev) =>
          prev.map((o) =>
            o.id === id ? { ...o, status: action === "approve" ? "APPROVED" : "REJECTED" } : o
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
              details: order.notes || undefined,
            });
          } else {
            setConfirmation({
              type: "warning",
              title: "Transfer Rejected",
              referenceId: order.orderNo,
              items: [
                { label: "Items", value: `${order._count.items} item${order._count.items !== 1 ? "s" : ""}` },
                { label: "Created by", value: order.createdBy.name },
              ],
              details: order.rejectionNote || "No reason provided",
            });
          }
        }
      }
    } catch { /* ignore */ }
    finally { setApproving(null); }
  }

  const statusBadge = (status: string) => {
    const icon = status === "APPROVED" ? <CheckCircle2 className="h-3 w-3 mr-0.5" />
      : status === "PENDING" ? <Clock className="h-3 w-3 mr-0.5" />
      : status === "REJECTED" ? <XCircle className="h-3 w-3 mr-0.5" />
      : null;
    return <Badge className={`text-xs ${getStatusColor(status)}`}>{icon}{getStatusLabel(status)}</Badge>;
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900">Transfer Orders</h1>
          <p className="text-xs text-slate-500">Multi-item bin transfers</p>
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
            { key: "REJECTED", label: "Rejected" },
          ],
          onChange: (key) => setFilter(key as StatusFilter),
        }]}
      />

      {/* Data Load Error */}
      {dataError && (
        <ErrorBanner
          message={dataError}
          type={typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "error"}
          onRetry={() => { setDataError(null); fetchData(); }}
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
        <div className="space-y-2">
          {orders.map((order) => {
            const accent = order.status === "APPROVED"
              ? "border-l-green-500"
              : order.status === "REJECTED"
              ? "border-l-red-500"
              : order.status === "PENDING"
              ? "border-l-amber-400"
              : "border-l-slate-200";
            return (
            <Card key={order.id} className={`overflow-hidden border-l-4 ${accent}`}>
              <CardContent className="p-3">
                {/* Header */}
                <div className="flex items-start justify-between mb-2">
                  <div className="flex-1 min-w-0 mr-2">
                    <div className="flex items-center gap-2">
                      <p className="text-base font-semibold text-slate-900 tabular-nums truncate">{order.orderNo}</p>
                      {statusBadge(order.status)}
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">
                      <span className="tabular-nums">{order._count.items}</span> item{order._count.items !== 1 ? "s" : ""} | By {order.createdBy.name} | <span className="tabular-nums">{new Date(order.createdAt).toLocaleDateString("en-IN")}</span>
                    </p>
                  </div>
                </div>

                {/* Compact item preview (first 2 items) */}
                <div className="space-y-1 mb-2">
                  {order.items.slice(0, expandedId === order.id ? undefined : 2).map((item) => (
                    <div key={item.id} className="bg-slate-50 rounded-lg px-2.5 py-1.5 flex items-center gap-2">
                      <Package className="h-3 w-3 text-slate-400 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-800 truncate">{item.product.name}</p>
                        <div className="flex items-center gap-1 text-xs text-slate-500">
                          <span className="tabular-nums">Qty: {item.quantity}</span>
                          <span>|</span>
                          <span>{endpointLabel(item.fromBin, item.fromWarehouse?.name ?? null)}</span>
                          <ArrowRight className="h-2.5 w-2.5 text-purple-500" />
                          <span>{endpointLabel(item.toBin, item.toWarehouse?.name ?? null)}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                  {order.items.length > 2 && (
                    <button onClick={() => setExpandedId(expandedId === order.id ? null : order.id)}
                      className="text-xs text-purple-600 font-medium pl-2">
                      {expandedId === order.id ? "Show less" : `+${order.items.length - 2} more items`}
                    </button>
                  )}
                </div>

                {/* Notes */}
                {order.notes && <p className="text-xs text-slate-400 mb-2">{order.notes}</p>}
                {order.rejectionNote && (
                  <p className="text-xs text-red-500 mb-2">Rejected: {order.rejectionNote}</p>
                )}

                {/* Actions */}
                <div className="flex items-center justify-between">
                  {order.reviewedBy && (
                    <p className="text-xs text-slate-400">
                      {order.status === "APPROVED" ? "Approved" : "Reviewed"} by {order.reviewedBy.name}
                    </p>
                  )}
                  {!order.reviewedBy && <div />}

                  {canApprove && order.status === "PENDING" && (
                    <div className="flex gap-1.5">
                      <Button size="sm" variant="outline"
                        className="h-10 px-4 py-2 text-sm text-green-600 border-green-200 hover:bg-green-50"
                        onClick={() => handleAction(order.id, "approve")}
                        disabled={approving === order.id}>
                        {approving === order.id ? <Loader2 className="h-3 w-3 animate-spin" /> : "Approve"}
                      </Button>
                      <Button size="sm" variant="outline"
                        className="h-10 px-4 py-2 text-sm text-red-600 border-red-200 hover:bg-red-50"
                        onClick={() => handleAction(order.id, "reject")}
                        disabled={approving === order.id}>
                        Reject
                      </Button>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
            );
          })}
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
