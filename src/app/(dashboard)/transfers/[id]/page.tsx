"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft, ArrowRight, Loader2, Truck, PackageCheck, Check, X,
  Building2, FileText, XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { SkeletonList } from "@/components/ui/skeleton";
import { ErrorBanner } from "@/components/ui/error-banner";
import { getStatusColor, getStatusLabel } from "@/lib/status-colors";
import { apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";
import { DispatchSheet } from "./_components/dispatch-sheet";
import { ReceiveSheet } from "./_components/receive-sheet";
import { DocumentCard } from "./_components/document-card";

const log = createLogger("transfers:detail");

type DocType = "DELIVERY_CHALLAN" | "TAX_INVOICE";
type Action = "approve" | "reject" | "dispatch" | "receive" | "cancel" | "attach_document";

interface WarehouseRef {
  id: string;
  code: string;
  name: string;
  store: { id: string; name: string; gstin: string | null; stateCode: string | null };
}

interface Item {
  id: string;
  quantity: number;
  receivedQty: number | null;
  unitCost?: number;
  product: { id: string; name: string; sku: string; hsnCode: string | null };
}

interface TransferDetail {
  id: string;
  orderNo: string;
  status: string;
  notes: string | null;
  rejectionNote: string | null;
  transferType: "INTRA_STORE" | "INTER_STORE" | null;
  requiredDocType: DocType | null;
  docType: DocType | null;
  docNumber: string | null;
  docDate: string | null;
  docUrl: string | null;
  docUploadedByName: string | null;
  docUploadedAt: string | null;
  eWayBillNo: string | null;
  eWayBillRequired: boolean | null;
  consignmentValue?: number;
  vehicleNo: string | null;
  transporterName: string | null;
  createdAt: string;
  createdBy: { name: string } | null;
  reviewedAt: string | null;
  reviewedBy: { name: string } | null;
  dispatchedAt: string | null;
  dispatchedByName: string | null;
  receivedAt: string | null;
  receivedByName: string | null;
  receiveNote: string | null;
  fromWarehouse: WarehouseRef | null;
  toWarehouse: WarehouseRef | null;
  items: Item[];
  actions: Action[];
  canSeeCost: boolean;
}

function when(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-IN", {
    day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit",
  });
}

export default function TransferDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const [order, setOrder] = useState<TransferDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [working, setWorking] = useState<Action | null>(null);
  const [sheet, setSheet] = useState<"dispatch" | "receive" | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);

  // Every mutation re-fetches rather than patching local state. The server decides `actions[]`,
  // the status and the stock figures, so guessing any of them here would only create a second
  // opinion that can drift.
  const refresh = useCallback(async () => {
    const { data, error } = await apiTry<TransferDetail>(`/api/transfer-orders/${id}`);
    if (error) {
      log.error("could not load transfer", { id, message: error });
      setLoadError(error);
    } else {
      setOrder(data);
      setLoadError(null);
    }
  }, [id]);

  // The IIFE lives INSIDE the effect, with a `cancelled` guard — P7 `inbound/[id]`, which is
  // the shape that keeps this file clean under react-hooks/set-state-in-effect. Calling an
  // async loader from the effect body instead trips the rule, because the linter cannot see
  // that the setState calls happen after an await. The guard is not decoration either: without
  // it, a fast back-navigation sets state on an unmounted page.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await apiTry<TransferDetail>(`/api/transfer-orders/${id}`);
      if (cancelled) return;
      if (error) {
        log.error("could not load transfer", { id, message: error });
        setLoadError(error);
      } else {
        setOrder(data);
        setLoadError(null);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [id]);

  async function review(action: "approve" | "reject") {
    setWorking(action);
    setActionError(null);
    const { data, error } = await apiTry<{ message: string }>(
      `/api/transfer-orders/${id}/approve`,
      { method: "POST", json: { action } }
    );
    setWorking(null);
    if (!data) { setActionError(error ?? `Could not ${action} this transfer`); return; }
    setBanner(data.message);
    await refresh();
  }

  async function cancel() {
    setWorking("cancel");
    setActionError(null);
    const { data, error } = await apiTry<{ message: string }>(
      `/api/transfer-orders/${id}/cancel`,
      { method: "POST", json: {} }
    );
    setWorking(null);
    setConfirmCancel(false);
    if (!data) { setActionError(error ?? "Could not cancel this transfer"); return; }
    setBanner(data.message);
    await refresh();
  }

  if (loading) {
    return (
      <div className="pb-32">
        <div className="h-8 w-40 bg-slate-100 rounded mb-4 animate-pulse" />
        <SkeletonList count={3} type="card" />
      </div>
    );
  }

  if (loadError || !order) {
    return (
      <div className="pb-32">
        <ErrorBanner message={loadError ?? "Transfer not found"} onRetry={() => { void refresh(); }} />
        <Link href="/transfers" className="inline-flex items-center gap-1.5 text-sm text-blue-600 mt-3 min-h-[44px] focus-ring">
          <ArrowLeft className="h-4 w-4" /> Back to transfers
        </Link>
      </div>
    );
  }

  const can = (a: Action) => order.actions.includes(a);
  const routeLabel = `${order.fromWarehouse?.name ?? "—"} → ${order.toWarehouse?.name ?? "—"}`;
  const hasActions = order.actions.some((a) => a !== "attach_document");

  return (
    <div className="pb-40">
      <div className="flex items-center gap-3 mb-4">
        <Link href="/transfers" className="p-2 -ml-2 rounded-lg hover:bg-slate-100 focus-ring" aria-label="Back">
          <ArrowLeft className="h-5 w-5 text-slate-600" />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-bold text-slate-900 truncate tabular-nums">{order.orderNo}</h1>
          <p className="text-xs text-slate-500 truncate">{routeLabel}</p>
        </div>
        <Badge className={getStatusColor(order.status)}>{getStatusLabel(order.status)}</Badge>
      </div>

      {banner && (
        <div className="mb-3 flex items-start justify-between gap-2 rounded-lg border border-green-200 bg-green-50 p-2.5">
          <p className="text-xs text-green-800">{banner}</p>
          <button onClick={() => setBanner(null)} aria-label="Dismiss" className="text-green-600 focus-ring">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
      {actionError && (
        <div className="mb-3">
          <ErrorBanner message={actionError} onDismiss={() => setActionError(null)} />
        </div>
      )}

      {/* ── Route ──────────────────────────────────────────────────────────────────────── */}
      <Card className="mb-3">
        <CardContent className="p-4">
          <p className="text-sm font-semibold text-slate-900 mb-3">Route</p>
          <div className="flex items-center gap-2">
            <div className="flex-1 min-w-0">
              <p className="text-[11px] text-slate-400 uppercase tracking-wide">From</p>
              <p className="text-sm font-medium text-slate-900 truncate">{order.fromWarehouse?.name ?? "—"}</p>
              <p className="text-xs text-slate-500 truncate">{order.fromWarehouse?.store.name ?? ""}</p>
            </div>
            <ArrowRight className="h-4 w-4 text-purple-500 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-[11px] text-slate-400 uppercase tracking-wide">To</p>
              <p className="text-sm font-medium text-slate-900 truncate">{order.toWarehouse?.name ?? "—"}</p>
              <p className="text-xs text-slate-500 truncate">{order.toWarehouse?.store.name ?? ""}</p>
            </div>
          </div>

          {order.transferType && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                <Building2 className="h-3 w-3" />
                {order.transferType === "INTER_STORE" ? "Inter-store" : "Within one store"}
              </span>
              {order.requiredDocType && (
                <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700">
                  <FileText className="h-3 w-3" />
                  {order.requiredDocType === "TAX_INVOICE" ? "Tax invoice" : "Delivery challan"}
                </span>
              )}
              {order.eWayBillRequired && (
                <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                  E-way bill required
                </span>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <DocumentCard
        orderId={order.id}
        orderNo={order.orderNo}
        requiredDocType={order.requiredDocType}
        docType={order.docType}
        docNumber={order.docNumber}
        docDate={order.docDate}
        docUrl={order.docUrl}
        docUploadedByName={order.docUploadedByName}
        docUploadedAt={order.docUploadedAt}
        canAttach={can("attach_document")}
        onAttached={() => { setBanner("Document attached"); void refresh(); }}
      />

      {/* ── Items ──────────────────────────────────────────────────────────────────────── */}
      <Card className="mb-3">
        <CardContent className="p-4">
          <p className="text-sm font-semibold text-slate-900 mb-3">
            Items <span className="text-slate-400 font-normal tabular-nums">({order.items.length})</span>
          </p>
          <div className="space-y-2">
            {order.items.map((item) => {
              const received = item.receivedQty;
              const short = received != null && received < item.quantity;
              return (
                <div key={item.id} className="rounded-lg border border-slate-200 p-3">
                  <p className="text-sm font-medium text-slate-900">{item.product.name}</p>
                  <p className="text-xs text-slate-500 tabular-nums">{item.product.sku}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs tabular-nums">
                    <span className="text-slate-500">
                      Sent <span className="font-semibold text-slate-900">{item.quantity}</span>
                    </span>
                    {received != null && (
                      <span className={short ? "text-red-600" : "text-green-700"}>
                        Received <span className="font-semibold">{received}</span>
                      </span>
                    )}
                    {short && (
                      <span className="text-red-600 font-semibold">
                        {item.quantity - received!} short
                      </span>
                    )}
                    {/* Only with cost_price.view — the server omits it entirely otherwise. */}
                    {item.unitCost != null && (
                      <span className="text-slate-500">
                        @ ₹{item.unitCost.toLocaleString("en-IN")}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {order.consignmentValue != null && (
            <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3">
              <span className="text-xs text-slate-500">Consignment value</span>
              <span className="text-sm font-semibold text-slate-900 tabular-nums">
                ₹{order.consignmentValue.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Timeline ───────────────────────────────────────────────────────────────────── */}
      <Card className="mb-3">
        <CardContent className="p-4">
          <p className="text-sm font-semibold text-slate-900 mb-3">Timeline</p>
          <div className="space-y-2 text-xs">
            <Row label="Created" who={order.createdBy?.name} at={order.createdAt} />
            {order.reviewedAt && (
              <Row
                label={order.status === "REJECTED" ? "Rejected" : "Approved"}
                who={order.reviewedBy?.name}
                at={order.reviewedAt}
              />
            )}
            {order.dispatchedAt && <Row label="Dispatched" who={order.dispatchedByName} at={order.dispatchedAt} />}
            {order.receivedAt && <Row label="Received" who={order.receivedByName} at={order.receivedAt} />}
            {order.vehicleNo && <Row label="Vehicle" value={order.vehicleNo} />}
            {order.transporterName && <Row label="Transporter" value={order.transporterName} />}
            {order.eWayBillNo && <Row label="E-way bill" value={order.eWayBillNo} />}
          </div>

          {order.notes && (
            <p className="mt-3 border-t border-slate-100 pt-3 text-xs text-slate-600 whitespace-pre-wrap">
              {order.notes}
            </p>
          )}
          {order.rejectionNote && (
            <p className="mt-2 rounded-lg bg-red-50 border border-red-200 p-2.5 text-xs text-red-700 whitespace-pre-wrap">
              {order.rejectionNote}
            </p>
          )}
          {order.receiveNote && (
            <p className="mt-2 rounded-lg bg-slate-50 border border-slate-200 p-2.5 text-xs text-slate-600 whitespace-pre-wrap">
              {order.receiveNote}
            </p>
          )}
        </CardContent>
      </Card>

      {/* ── Action bar ─────────────────────────────────────────────────────────────────────
          Rendered from the server's `actions[]`. Nothing here derives a button from a role
          name or from the status — that is the server's answer, and the routes re-check it. */}
      {hasActions && (
        <div className="fixed above-nav left-0 right-0 bg-white border-t border-slate-200 p-4 pb-safe z-50">
          <div className="flex gap-2">
            {can("reject") && (
              <Button
                variant="outline"
                onClick={() => review("reject")}
                disabled={working !== null}
                className="flex-1 min-h-[48px] border-red-200 text-red-600 hover:bg-red-50"
              >
                {working === "reject" ? <Loader2 className="h-4 w-4 animate-spin" /> : <><X className="h-4 w-4 mr-1.5" />Reject</>}
              </Button>
            )}
            {can("approve") && (
              <Button
                onClick={() => review("approve")}
                disabled={working !== null}
                className="flex-1 min-h-[48px] bg-green-600 hover:bg-green-700"
              >
                {working === "approve" ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Check className="h-4 w-4 mr-1.5" />Approve</>}
              </Button>
            )}
            {can("dispatch") && (
              <Button onClick={() => setSheet("dispatch")} disabled={working !== null} className="flex-1 min-h-[48px]">
                <Truck className="h-4 w-4 mr-1.5" />Dispatch
              </Button>
            )}
            {can("receive") && (
              <Button onClick={() => setSheet("receive")} disabled={working !== null} className="flex-1 min-h-[48px] bg-green-600 hover:bg-green-700">
                <PackageCheck className="h-4 w-4 mr-1.5" />Receive
              </Button>
            )}
            {can("cancel") && !can("approve") && (
              <Button
                variant="outline"
                onClick={() => setConfirmCancel(true)}
                disabled={working !== null}
                className="flex-1 min-h-[48px]"
              >
                <XCircle className="h-4 w-4 mr-1.5" />Cancel
              </Button>
            )}
          </div>

          {/* Approve and Reject already fill the bar, so Cancel moves below rather than
              squeezing three buttons onto a 360 px phone. */}
          {can("cancel") && can("approve") && (
            <button
              onClick={() => setConfirmCancel(true)}
              disabled={working !== null}
              className="w-full mt-2 min-h-[44px] text-xs text-slate-500 font-medium focus-ring"
            >
              Cancel this transfer
            </button>
          )}

          {/* The one case where the server withholds Dispatch and the reason is fixable right
              here — without this the button is simply absent and reads as "not allowed". */}
          {order.status === "APPROVED" && !can("dispatch") && order.requiredDocType && !order.docUrl && (
            <p className="mt-2 text-center text-xs text-amber-700">
              Attach the {order.requiredDocType === "TAX_INVOICE" ? "tax invoice" : "delivery challan"} to dispatch.
            </p>
          )}
        </div>
      )}

      {sheet === "dispatch" && (
      <DispatchSheet
        open
        orderId={order.id}
        orderNo={order.orderNo}
        routeLabel={routeLabel}
        estimatedValue={order.consignmentValue ?? null}
        eWayBillLikely={order.eWayBillRequired === true}
        existingEWayBillNo={order.eWayBillNo}
        onClose={() => setSheet(null)}
        onDispatched={(r) => {
          setSheet(null);
          setBanner(r.warnings.length > 0 ? r.warnings.join(" ") : "Dispatched");
          void refresh();
        }}
      />
      )}

      {sheet === "receive" && (
      <ReceiveSheet
        open
        orderId={order.id}
        orderNo={order.orderNo}
        lines={order.items.map((i) => ({
          id: i.id,
          quantity: i.quantity,
          productName: i.product.name,
          sku: i.product.sku,
        }))}
        onClose={() => setSheet(null)}
        onReceived={(r) => {
          setSheet(null);
          setBanner(
            r.shortLines > 0
              ? `Received with ${r.shortLines} line${r.shortLines === 1 ? "" : "s"} short`
              : "Received in full"
          );
          void refresh();
        }}
      />
      )}

      {confirmCancel && (
        <div className="fixed inset-0 bg-black/50 z-[60] flex items-end sm:items-center justify-center p-4" onClick={() => setConfirmCancel(false)}>
          <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-md p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-base font-bold text-slate-900">Cancel this transfer?</h2>
            <p className="text-sm text-slate-600">
              {order.orderNo} will be called off. No stock has moved, so nothing is reversed.
            </p>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setConfirmCancel(false)} className="flex-1 min-h-[44px]">
                Keep it
              </Button>
              <Button onClick={cancel} disabled={working === "cancel"} className="flex-1 min-h-[44px] bg-red-600 hover:bg-red-700">
                {working === "cancel" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Cancel transfer"}
              </Button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

function Row({ label, who, at, value }: { label: string; who?: string | null; at?: string | null; value?: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-slate-500 shrink-0">{label}</span>
      <span className="text-slate-900 text-right tabular-nums">
        {value ?? (
          <>
            {who ?? "—"}
            {at && <span className="block text-[11px] text-slate-400">{when(at)}</span>}
          </>
        )}
      </span>
    </div>
  );
}
