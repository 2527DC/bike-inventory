"use client";

import { useState, useEffect, useCallback, use } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Download, Send, MessageSquare, Undo2, XCircle, SendHorizonal, Mail } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SkeletonList } from "@/components/ui/skeleton";
import { apiFetch, apiTry } from "@/lib/api-client";
import { usePermissions } from "@/lib/use-permissions";
import { SendToVendorSheet, type SendResult } from "./_components/send-to-vendor-sheet";
import { ActionConfirmation } from "@/components/ui/action-confirmation";
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
  sentToEmail?: string | null;
  sentBy?: { name: string } | null;
  vendor: {
    name: string;
    code: string;
    whatsappNumber?: string;
    phone?: string;
    email?: string | null;
    contacts?: Array<{ name: string; email: string | null; isPrimary: boolean }>;
  };
  items: Array<{
    id: string;
    quantity: number;
    receivedQty: number;
    unitPrice: number;
    gstRate: number;
    amount: number;
    /** The description as ordered — the sheet's item name, or the product's name for older lines. */
    name: string;
    /** Null for a line raised from the vendor's sheet (plan 0909, D2). */
    product: { name: string; sku: string; currentStock: number } | null;
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
  const [sendOpen, setSendOpen] = useState(false);
  const [sendResult, setSendResult] = useState<SendResult | null>(null);
  // null while unknown — the button is not disabled on a guess, only on a real answer.
  const [emailReady, setEmailReady] = useState<{ emailReady: boolean; reason: string | null } | null>(null);

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

  // Asked once. /api/notifications/config is gated on settings_notifications.view, which a
  // purchasing clerk does not hold — hence the separate requireAuth status route. A failure
  // here leaves emailReady null, and the button stays enabled: better to attempt a send and
  // get a real 503 than to grey out the only way to send because a status check hiccuped.
  useEffect(() => {
    apiTry<{ emailReady: boolean; reason: string | null }>("/api/notifications/status").then(
      ({ data }) => { if (data) setEmailReady(data); }
    );
  }, []);

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

  /**
   * Who the sheet prefills. The same order the server uses: the vendor's own address, then the
   * first CONTACT that actually has one. Sorted rather than filtered on isPrimary, because
   * nothing in the database guarantees a primary contact exists.
   */
  const defaultRecipient =
    po?.vendor.email ??
    po?.vendor.contacts?.find((c) => c.email)?.email ??
    null;

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
    const itemsList = po.items
      .map((i) => `- ${i.name || i.product?.name || "Item"}${i.product ? ` (${i.product.sku})` : ""}: ${i.quantity} pcs @ ${formatCurrency(i.unitPrice)}`)
      .join("\n");
    // Plain text on purpose — no WhatsApp markup (the `*bold*` asterisks it used to carry).
    // Owner, 9 Sep 2026: "the WhatsApp export should be in normal text format".
    const msg = encodeURIComponent(
      `Purchase Order: ${po.poNumber}\n\nDear ${po.vendor.name},\n\nPlease find our order below:\n\n${itemsList}\n\nTotal: ${formatCurrency(po.grandTotal)}\n${po.expectedDate ? `Expected by: ${new Date(po.expectedDate).toLocaleDateString("en-IN")}` : ""}\n\nPlease confirm.`
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
        {/* Every status (plan 0909, R10 / Q8 a): a draft printed for a phone call is normal. The
            PDF becomes an offer only when it is SENT, and sending stays gated on approval. The
            route serves any status under purchase_orders.view — which this page already needs. */}
        <a
          href={`/api/purchase-orders/${id}/pdf`}
          download
          aria-label={`Download ${po.poNumber} as PDF`}
          className="inline-flex items-center gap-1.5 min-h-[44px] px-3 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-sm font-medium text-slate-700 shrink-0"
        >
          <Download className="h-4 w-4" /> <span className="hidden sm:inline">Download</span> PDF
        </a>
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
            {/* Disabled with a reason rather than hidden when email is not configured: a hidden
                button reads as "this order cannot be sent", which is a different and wrong
                statement. */}
            <Button
              onClick={() => setSendOpen(true)}
              disabled={actionLoading || emailReady?.emailReady === false}
              title={emailReady?.emailReady === false ? "Email not configured — Settings › Notifications" : undefined}
              className="flex-1 min-w-[10rem] min-h-[48px] rounded-lg font-medium bg-blue-600 hover:bg-blue-700 text-white"
              
            >
              <Mail className="h-4 w-4 mr-1.5" /> Send to vendor
            </Button>
            <Button onClick={() => markSent("MANUAL")} disabled={actionLoading} variant="outline" className="flex-1 min-w-[10rem] min-h-[48px] rounded-lg font-medium">
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

        {/* SENT_TO_VENDOR had no actions at all before P12 — an order that had gone out could
            only be cancelled. Note the WhatsApp link here does NOT call markSent: the PO is
            already SENT_TO_VENDOR and there is no self-transition, so it would 409. */}
        {po.status === "SENT_TO_VENDOR" && mayEdit && (
          <>
            {/* Disabled with a reason rather than hidden when email is not configured: a hidden
                button reads as "this order cannot be sent", which is a different and wrong
                statement. */}
            <Button
              onClick={() => setSendOpen(true)}
              disabled={actionLoading || emailReady?.emailReady === false}
              title={emailReady?.emailReady === false ? "Email not configured — Settings › Notifications" : undefined}
              className="flex-1 min-w-[10rem] min-h-[48px] rounded-lg font-medium"
              variant="outline"
            >
              <Mail className="h-4 w-4 mr-1.5" /> Resend
            </Button>
            {whatsappLink && (
              <a href={whatsappLink} target="_blank" rel="noopener noreferrer" className="flex-1 min-w-[10rem]">
                <Button variant="outline" className="w-full min-h-[48px] rounded-lg font-medium text-green-600 border-green-300">
                  <MessageSquare className="h-4 w-4 mr-1.5" /> Send via WA
                </Button>
              </a>
            )}
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
          Approved but not yet sent.
          {emailReady?.emailReady === false
            ? " Email is not configured, so use Mark sent once you have sent it another way."
            : " Send it to the vendor, or record that you sent it another way."}
        </p>
      )}

      {/* Rendered only while open, so each open is a fresh mount and the sheet's own state
          initialisers do the resetting — no effect, no cascading render. */}
      {sendOpen && (
      <SendToVendorSheet
        open={sendOpen}
        poId={id}
        poNumber={po.poNumber}
        vendorName={po.vendor.name}
        defaultTo={defaultRecipient}
        alreadySent={po.status === "SENT_TO_VENDOR"}
        onClose={() => setSendOpen(false)}
        onSent={(result) => {
          setSendOpen(false);
          setSendResult(result);
          // Refetch rather than patch: the SERVER decides whether the status flipped — only
          // the first send does — and what sendCount is now.
          load();
        }}
      />
      )}

      {sendResult && (
        <ActionConfirmation
          open
          onClose={() => setSendResult(null)}
          type="success"
          title="Sent to vendor"
          referenceId={po.poNumber}
          items={[
            { label: "Sent to", value: sendResult.to },
            { label: "Attachment", value: sendResult.filename },
            ...(sendResult.sendCount > 1
              ? [{ label: "Send", value: `${sendResult.sendCount} of this order` }]
              : []),
          ]}
          details={
            sendResult.messageId
              ? "The mail server accepted it. A reply from the vendor comes back to your inbox."
              : "The mail server accepted it, but returned no message id."
          }
        />
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
            {/* sentAt / sentVia / sentToEmail / sendCount have been on the header since
                MIG-1a and, until P12, NOTHING wrote them and nothing showed them. Note this
                reads correctly against null for any pre-P12 SENT_TO_VENDOR row, of which
                there can be a few: mark-sent returned 409 for its whole life before the fix,
                so no purchase order was ever marked sent through the UI. */}
            {po.sentAt && (
              <div className="col-span-2">
                <span className="text-[11px] text-slate-500">Sent</span>
                <p className="text-slate-700">
                  {po.sentVia === "EMAIL" && po.sentToEmail
                    ? `By email to ${po.sentToEmail}`
                    : `Marked sent via ${(po.sentVia ?? "").toLowerCase() || "another channel"}`}
                  {" on "}
                  {new Date(po.sentAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                  {po.sentBy?.name ? ` by ${po.sentBy.name}` : ""}
                  {(po.sendCount ?? 0) > 1 ? ` (${po.sendCount}×)` : ""}
                </p>
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
                  <p className="text-sm font-medium text-slate-900 break-words">{item.name || item.product?.name}</p>
                  {/* SKU and stock exist only when the line is a catalogue product; a sheet-built
                      line has neither (D2) and shows nothing rather than a dash nobody asked for. */}
                  {item.product && (
                    <p className="text-xs text-slate-500 tabular-nums">{item.product.sku} | Stock: {item.product.currentStock}</p>
                  )}
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
