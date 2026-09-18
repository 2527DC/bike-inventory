"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft, ArrowRight, Loader2, Truck, PackageCheck, Check, X,
  Building2, FileText, XCircle, Undo2, Pencil,
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
import { EditItemsSheet } from "./_components/edit-items-sheet";

const log = createLogger("transfers:detail");

type DocType = "DELIVERY_CHALLAN" | "TAX_INVOICE";
type Action =
  | "approve"
  | "reject"
  | "dispatch"
  | "receive"
  | "cancel"
  | "attach_document"
  // Plan 1709 (R25): a RETURNED order goes back to its creator to fix and send again.
  | "edit"
  | "resubmit";
type TransferMode = "STORE_TO_STORE" | "STORE_TO_WAREHOUSE";

interface WarehouseRef {
  id: string;
  code: string;
  name: string;
  store: { id: string; name: string };
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
  /** Which of the two create-form buttons raised this order. Null before the column existed. */
  mode?: TransferMode | null;
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
  resubmittedAt: string | null;
  /** The outward this transfer was raised for by Find stock (R45, P16). */
  deliveryId: string | null;
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

/**
 * Wording for the transfer-type chip. `mode` is what the two create-form buttons write and
 * wins when present; older orders only carry `transferType`, which was derived from comparing
 * the two stores' GSTINs, and keep the wording that matched that derivation.
 */
function modeLabel(mode: TransferMode | null | undefined, transferType: TransferDetail["transferType"]): string {
  if (mode === "STORE_TO_STORE") return "Store → Store";
  if (mode === "STORE_TO_WAREHOUSE") return "Store → Warehouse";
  return transferType === "INTER_STORE" ? "Inter-store" : "Within one store";
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
  const [rejecting, setRejecting] = useState(false);
  const [rejectNote, setRejectNote] = useState("");
  const [editingItems, setEditingItems] = useState(false);

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

  // Reject SENDS IT BACK (R25), so it never fires without a note — the note is the whole
  // difference between "returned" and the dead REJECTED row this replaced.
  async function review(action: "approve" | "reject", rejectionNote?: string) {
    setWorking(action);
    setActionError(null);
    const { data, error } = await apiTry<{ message: string }>(
      `/api/transfer-orders/${id}/approve`,
      { method: "POST", json: action === "reject" ? { action, rejectionNote } : { action } }
    );
    setWorking(null);
    setRejecting(false);
    if (!data) { setActionError(error ?? `Could not ${action} this transfer`); return; }
    setBanner(data.message);
    await refresh();
  }

  /** Ask for approval again after a return (R25). The lines are corrected separately. */
  async function resubmit() {
    setWorking("resubmit");
    setActionError(null);
    const { data, error } = await apiTry<{ message: string }>(
      `/api/transfer-orders/${id}/resubmit`,
      { method: "POST", json: {} }
    );
    setWorking(null);
    if (!data) { setActionError(error ?? "Could not resubmit this transfer"); return; }
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
        <Badge
          className={
            order.status === "RETURNED"
              ? "bg-orange-100 text-orange-700 border-orange-200"
              : getStatusColor(order.status)
          }
        >
          {getStatusLabel(order.status)}
        </Badge>
      </div>

      {/* ── Returned: the note is the first thing on the page ──────────────────────────────
          An approver sent this back. Everything the creator needs — what is wrong, and the two
          things to do about it — sits above the record rather than inside the timeline. */}
      {order.status === "RETURNED" && (
        <div className="mb-3 rounded-lg border border-orange-200 bg-orange-50 p-3">
          <div className="flex items-start gap-2">
            <Undo2 className="h-4 w-4 text-orange-600 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-xs font-semibold text-orange-900">
                Sent back for correction{order.reviewedBy?.name ? ` by ${order.reviewedBy.name}` : ""}
              </p>
              <p className="text-xs text-orange-800 mt-0.5 whitespace-pre-wrap">
                {order.rejectionNote || "No reason was given."}
              </p>
              {can("edit") && (
                <p className="text-[11px] text-orange-700 mt-1.5">
                  Fix the lines or the document below, then Resubmit.
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Raised by Find stock for a customer's outward (R45): somebody is waiting on this one. */}
      {order.deliveryId && (
        <Link
          href={`/deliveries/${order.deliveryId}`}
          className="mb-3 flex items-center justify-between gap-2 rounded-lg border border-blue-200 bg-blue-50 p-2.5 focus-ring"
        >
          <span className="text-xs text-blue-800">
            Raised for an outward — this stock is needed for a customer order
          </span>
          <ArrowRight className="h-4 w-4 text-blue-500 shrink-0" />
        </Link>
      )}

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

          {/* The chip reads `mode` first — the column the create form writes from the two
              buttons (plan 0909-transfer-mode-and-document-attachment, Q10). Orders raised
              before the column existed have `mode: null` and keep the older wording, which
              was derived from the GSTIN comparison in `transferType`. */}
          {(order.mode || order.transferType) && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                <Building2 className="h-3 w-3" />
                {modeLabel(order.mode, order.transferType)}
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
                label={order.status === "RETURNED" ? "Sent back" : order.status === "REJECTED" ? "Rejected" : "Approved"}
                who={order.reviewedBy?.name}
                at={order.reviewedAt}
              />
            )}
            {order.resubmittedAt && <Row label="Resubmitted" at={order.resubmittedAt} who={order.createdBy?.name} />}
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
          {/* Already shown in full at the top while the order is RETURNED — repeating it here
              would say the same thing twice on the one screen where it matters most. */}
          {order.rejectionNote && order.status !== "RETURNED" && (
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
                onClick={() => { setRejecting(true); setRejectNote(""); }}
                disabled={working !== null}
                className="flex-1 min-h-[48px] border-red-200 text-red-600 hover:bg-red-50"
              >
                {working === "reject" ? <Loader2 className="h-4 w-4 animate-spin" /> : <><X className="h-4 w-4 mr-1.5" />Reject</>}
              </Button>
            )}
            {can("edit") && (
              <Button
                variant="outline"
                onClick={() => setEditingItems(true)}
                disabled={working !== null}
                className="flex-1 min-h-[48px]"
              >
                <Pencil className="h-4 w-4 mr-1.5" />Edit items
              </Button>
            )}
            {can("resubmit") && (
              <Button
                onClick={resubmit}
                disabled={working !== null}
                className="flex-1 min-h-[48px] bg-slate-900 hover:bg-slate-800"
              >
                {working === "resubmit" ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Undo2 className="h-4 w-4 mr-1.5" />Resubmit</>}
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
              here — without this the button is simply absent and reads as "not allowed".
              It matters more since P16: the document is optional at CREATE now, so an approved
              transfer with no file is an ordinary state rather than a data fault, and this line
              is the only thing that says what to do about it. */}
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

      {rejecting && (
        <div className="fixed inset-0 bg-black/50 z-[60] flex items-end sm:items-center justify-center p-4" onClick={() => setRejecting(false)}>
          <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-md p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-base font-bold text-slate-900">Send {order.orderNo} back?</h2>
            <p className="text-xs text-slate-500">
              {order.createdBy?.name ?? "The person who raised it"} gets your note and fixes this
              same transfer — nothing is cancelled and no stock has moved.
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
              <Button variant="outline" onClick={() => setRejecting(false)} className="flex-1 min-h-[44px]">
                Keep it
              </Button>
              <Button
                onClick={() => review("reject", rejectNote.trim())}
                disabled={rejectNote.trim().length === 0 || working !== null}
                className="flex-1 min-h-[44px] bg-red-600 hover:bg-red-700"
              >
                {working === "reject" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send back"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {editingItems && (
        <EditItemsSheet
          orderId={order.id}
          orderNo={order.orderNo}
          initial={order.items.map((i) => ({
            productId: i.product.id,
            name: i.product.name,
            sku: i.product.sku,
            quantity: i.quantity,
          }))}
          onClose={() => setEditingItems(false)}
          onSaved={(message) => {
            setEditingItems(false);
            setBanner(message);
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
