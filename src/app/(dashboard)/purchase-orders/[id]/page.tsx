"use client";

import { useState, useEffect, useCallback, use } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Send, MessageSquare, Undo2, XCircle, SendHorizonal } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SkeletonList } from "@/components/ui/skeleton";
import { apiFetch, apiTry } from "@/lib/api-client";
import { usePermissions } from "@/lib/use-permissions";
import { createLogger } from "@/lib/logger";

const log = createLogger("purchase-orders:detail");

interface PODetail {
  id: string;
  poNumber: string;
  status: string;
  subtotal: number;
  gstTotal: number;
  grandTotal: number;
  orderDate: string;
  expectedDate?: string;
  notes?: string;
  // Written by the mark-sent route (and by P12's email send). They have existed on the header
  // since MIG-1a and were written by NOTHING before P9 — a PO could read SENT_TO_VENDOR with
  // every column recording the send still null.
  sentAt?: string | null;
  sentVia?: string | null;
  sendCount?: number;
  vendor: { name: string; code: string; whatsappNumber?: string; phone?: string };
  items: Array<{
    id: string;
    quantity: number;
    receivedQty: number;
    unitPrice: number;
    gstRate: number;
    amount: number;
    product: { name: string; sku: string; currentStock: number };
  }>;
  createdBy: { name: string };
  approvedBy?: { name: string };
  approvedAt?: string;
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount);
}

export default function PurchaseOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [po, setPo] = useState<PODetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);

  // This screen had NO permission checks of any kind before P9. Approve was shown to
  // everyone, and because the handlers used bare fetch with no !success branch, a 403 came
  // back and nothing happened at all — the error banner below was unreachable code.
  const { canEdit, canApprove } = usePermissions();
  const mayEdit = canEdit("purchase_orders");
  const mayApprove = canApprove("purchase_orders");

  const load = useCallback(() => {
    setLoading(true);
    apiTry<PODetail>(`/api/purchase-orders/${id}`)
      .then(({ data, error }) => {
        setPo(data);
        setLoadError(data ? null : error);
      })
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  /**
   * Every action re-reads the PO instead of patching the status locally.
   *
   * The old handlers did `setPo(prev => ({ ...prev, status }))`, which is a guess about what
   * the server did. It is wrong for approve (approvedBy and approvedAt come back), wrong for
   * mark-sent (sentAt, sentVia, sendCount), and wrong for re-open (the approval is cleared).
   * A refetch is one extra request on an action somebody tapped deliberately.
   */
  async function runAction(fn: () => Promise<unknown>, label: string) {
    setActionLoading(true);
    setActionError("");
    try {
      await fn();
      load();
    } catch (e) {
      const message = e instanceof Error ? e.message : `${label} failed`;
      log.error("po action failed", { poId: id, action: label, message });
      setActionError(message);
    } finally {
      setActionLoading(false);
    }
  }

  const submitForApproval = () =>
    runAction(() => apiFetch(`/api/purchase-orders/${id}`, { method: "PUT", json: { status: "PENDING_APPROVAL" } }), "Submit");

  const approve = () =>
    runAction(() => apiFetch(`/api/purchase-orders/${id}/approve`, { method: "POST", json: {} }), "Approve");

  const sendBackToDraft = () =>
    runAction(() => apiFetch(`/api/purchase-orders/${id}`, { method: "PUT", json: { status: "DRAFT" } }), "Send back to draft");

  const markSent = (channel: "WHATSAPP" | "MANUAL") =>
    runAction(() => apiFetch(`/api/purchase-orders/${id}/mark-sent`, { method: "POST", json: { channel } }), "Mark sent");

  const cancel = () =>
    runAction(() => apiFetch(`/api/purchase-orders/${id}`, { method: "PUT", json: { status: "CANCELLED" } }), "Cancel");

  function getWhatsAppLink() {
    if (!po?.vendor.whatsappNumber) return null;
    const phone = `91${po.vendor.whatsappNumber.replace(/\D/g, "").slice(-10)}`;
    const itemsList = po.items.map((i) => `- ${i.product.name} (${i.product.sku}): ${i.quantity} pcs @ ${formatCurrency(i.unitPrice)}`).join("\n");
    const msg = encodeURIComponent(
      `*Purchase Order: ${po.poNumber}*\n\nDear ${po.vendor.name},\n\nPlease find our order below:\n\n${itemsList}\n\n*Total: ${formatCurrency(po.grandTotal)}*\n${po.expectedDate ? `Expected by: ${new Date(po.expectedDate).toLocaleDateString("en-IN")}` : ""}\n\nPlease confirm.`
    );
    return `https://wa.me/${phone}?text=${msg}`;
  }

  if (loading) {
    return (
      <div className="pt-2">
        <SkeletonList count={5} type="card" />
      </div>
    );
  }

  if (!po) return (
    <div className="text-center py-12">
      {/* A failed load and a genuinely missing PO used to look identical, because the fetch
          swallowed its error. An expired session read as "PO not found". */}
      <p className="text-sm text-slate-400">{loadError ?? "PO not found"}</p>
      {loadError && (
        <button onClick={load} className="text-sm text-blue-600 hover:underline mt-2 block mx-auto min-h-[44px]">
          Try again
        </button>
      )}
      <Link href="/purchase-orders" className="text-sm text-blue-600 hover:underline mt-2 inline-block">
        Back to Purchase Orders
      </Link>
    </div>
  );

  const whatsappLink = getWhatsAppLink();

  return (
    <div>
      {actionError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-2.5 mb-3 text-xs text-red-700">
          {actionError}
          <button onClick={() => setActionError("")} className="ml-2 underline">dismiss</button>
        </div>
      )}

      <div className="flex items-center gap-3 mb-4">
        <Link href="/purchase-orders" className="p-2 -ml-2 rounded-lg hover:bg-slate-100 focus-ring" aria-label="Back">
          <ArrowLeft className="h-5 w-5 text-slate-600" />
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-bold text-slate-900 tabular-nums truncate">{po.poNumber}</h1>
          <p className="text-xs text-slate-500 tabular-nums truncate">{po.vendor.name} ({po.vendor.code})</p>
        </div>
        <Badge variant={po.status === "RECEIVED" || po.status === "APPROVED" ? "success" : po.status === "CANCELLED" ? "danger" : "warning"}>
          {po.status.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase())}
        </Badge>
      </div>

      {/* ─── Actions, by state ────────────────────────────────────────────────────────────
          Every button here matches an edge in PO_TRANSITIONS (src/lib/purchase-orders/status.ts)
          and is gated on the SAME permission the route demands. Before P9 there was one
          Approve button shown on DRAFT as well as PENDING_APPROVAL — so a draft went straight
          to approved and the review step did not exist — and no permission check at all.

          Approve is deliberately NOT hidden from someone lacking the grant on a PENDING PO:
          it is disabled with a reason, because a hidden button reads as "this PO cannot be
          approved" rather than "you cannot approve it". */}
      <div className="flex flex-wrap gap-2 mb-4">
        {po.status === "DRAFT" && mayEdit && (
          <Button onClick={submitForApproval} disabled={actionLoading} className="flex-1 min-w-[10rem] min-h-[48px] rounded-lg font-medium">
            <SendHorizonal className="h-4 w-4 mr-1.5" /> Submit for approval
          </Button>
        )}

        {po.status === "PENDING_APPROVAL" && (
          <>
            <Button
              onClick={approve}
              disabled={actionLoading || !mayApprove}
              title={mayApprove ? undefined : "You do not have permission to approve purchase orders"}
              className="flex-1 min-w-[10rem] min-h-[48px] rounded-lg font-medium bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
            >
              <Check className="h-4 w-4 mr-1.5" /> Approve
            </Button>
            {mayEdit && (
              <Button onClick={sendBackToDraft} disabled={actionLoading} variant="outline" className="flex-1 min-w-[10rem] min-h-[48px] rounded-lg font-medium">
                <Undo2 className="h-4 w-4 mr-1.5" /> Send back to draft
              </Button>
            )}
          </>
        )}

        {po.status === "APPROVED" && mayEdit && (
          <>
            <Button onClick={() => markSent("MANUAL")} disabled={actionLoading} className="flex-1 min-w-[10rem] min-h-[48px] rounded-lg font-medium">
              <Send className="h-4 w-4 mr-1.5" /> Mark sent
            </Button>
            {whatsappLink && (
              // Opens WhatsApp AND records the send, because the old version did neither —
              // it was a bare link, so a PO sent this way stayed APPROVED for ever.
              <a
                href={whatsappLink}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => { void markSent("WHATSAPP"); }}
                className="flex-1 min-w-[10rem]"
              >
                <Button variant="outline" className="w-full min-h-[48px] rounded-lg font-medium text-green-600 border-green-300">
                  <MessageSquare className="h-4 w-4 mr-1.5" /> Send via WA
                </Button>
              </a>
            )}
            <Button onClick={sendBackToDraft} disabled={actionLoading} variant="outline" className="flex-1 min-w-[10rem] min-h-[48px] rounded-lg font-medium">
              <Undo2 className="h-4 w-4 mr-1.5" /> Re-open
            </Button>
          </>
        )}

        {/* Cancel is offered from every non-terminal state. It had no route into the UI at
            all before P9, so a mistaken PO could only be left sitting there. */}
        {mayEdit && po.status !== "RECEIVED" && po.status !== "CANCELLED" && (
          <Button
            onClick={cancel}
            disabled={actionLoading}
            variant="outline"
            className="flex-1 min-w-[10rem] min-h-[48px] rounded-lg font-medium text-red-600 border-red-300"
          >
            <XCircle className="h-4 w-4 mr-1.5" /> Cancel PO
          </Button>
        )}
      </div>

      {po.status === "APPROVED" && !po.sentAt && (
        <p className="text-[11px] text-slate-400 -mt-2 mb-4">
          Approved but not yet sent. Marking it sent records who sent it and how.
        </p>
      )}

      {/* Order Info */}
      <Card className="mb-4">
        <CardContent className="p-3 space-y-2">
          <div className="grid grid-cols-2 gap-y-3 gap-x-2 text-sm">
            <div>
              <span className="text-[11px] text-slate-500">Order Date</span>
              <p className="font-semibold text-slate-900 tabular-nums">{new Date(po.orderDate).toLocaleDateString("en-IN")}</p>
            </div>
            {po.expectedDate && (
              <div>
                <span className="text-[11px] text-slate-500">Expected</span>
                <p className="font-semibold text-slate-900 tabular-nums">{new Date(po.expectedDate).toLocaleDateString("en-IN")}</p>
              </div>
            )}
            <div>
              <span className="text-[11px] text-slate-500">Created By</span>
              <p className="font-semibold text-slate-900">{po.createdBy.name}</p>
            </div>
            {po.approvedBy && (
              <div>
                <span className="text-[11px] text-slate-500">Approved By</span>
                <p className="font-semibold text-slate-900">{po.approvedBy.name}</p>
              </div>
            )}
          </div>
          {po.notes && <p className="text-xs text-slate-500 border-t pt-2">{po.notes}</p>}
        </CardContent>
      </Card>

      {/* Items */}
      <h2 className="text-sm font-semibold text-slate-900 mb-2">Items</h2>
      <div className="space-y-2 mb-4">
        {po.items.map((item) => (
          <Card key={item.id}>
            <CardContent className="p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-900">{item.product.name}</p>
                  <p className="text-xs text-slate-500 tabular-nums">{item.product.sku} | Stock: {item.product.currentStock}</p>
                </div>
                <p className="text-sm font-bold text-slate-900 tabular-nums shrink-0">{formatCurrency(item.amount * (1 + item.gstRate / 100))}</p>
              </div>
              <div className="flex gap-4 mt-1 text-xs text-slate-500 tabular-nums">
                <span>Qty: {item.quantity}</span>
                <span>Rcvd: {item.receivedQty}</span>
                <span>@ {formatCurrency(item.unitPrice)}</span>
                <span>GST: {item.gstRate}%</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Totals */}
      <Card className="bg-slate-50">
        <CardContent className="p-3 space-y-1">
          <div className="flex justify-between text-sm">
            <span className="text-slate-500">Subtotal</span>
            <span className="tabular-nums">{formatCurrency(po.subtotal)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-slate-500">GST</span>
            <span className="tabular-nums">{formatCurrency(po.gstTotal)}</span>
          </div>
          <div className="flex justify-between text-sm font-bold border-t pt-1">
            <span>Grand Total</span>
            <span className="tabular-nums">{formatCurrency(po.grandTotal)}</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
