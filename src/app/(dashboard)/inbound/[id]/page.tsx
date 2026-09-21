"use client";

import { useState, useEffect, use } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Phone, CheckCircle2, Calendar, MapPin, Trash2, ShieldCheck, AlertTriangle, Info, Lock, Undo2, QrCode } from "lucide-react";
import { getStatusColor, getStatusLabel } from "@/lib/status-colors";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SkeletonList } from "@/components/ui/skeleton";
import { ActionConfirmation } from "@/components/ui/action-confirmation";
import { usePermissions } from "@/lib/use-permissions";
import { useWarehouses } from "@/hooks/use-sites";
import { apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";
import { formatDateTime } from "@/lib/utils";

const log = createLogger("inbound:detail");

interface LineItem {
  id: string;
  productName: string;
  product: {
    name: string;
    sku: string;
    brand?: { id: string; name: string } | null;
    category?: { id: string; name: string } | null;
  } | null;
  sku: string | null;
  quantity: number;
  rate: number;
  amount: number;
  hsn: string | null;
  isDelivered: boolean;
  deliveredQty: number | null;
  binId: string | null;
  bin: { id: string; code: string; name: string; location: string } | null;
  preBookedCustomerName: string | null;
  preBookedCustomerPhone: string | null;
  preBookedInvoiceNo: string | null;
  whatsAppSent: boolean;
  preBooking: { id: string; customerName: string; status: string } | null;
}

interface Bin {
  id: string;
  code: string;
  name: string;
  location: string;
}

/** What `GET /api/inbound/[id]/putaway` says about one line's bin. */
interface PutawayItemInfo {
  suggestedBin?: Bin | null;
  matchedRule?: { type: string; label: string } | null;
  /** A home-bin RULE matched (not the product-default fallback): the line is locked (R34). */
  ruleLocked?: boolean;
}

interface Shipment {
  id: string;
  shipmentNo: string;
  billNo: string;
  billImageUrl: string | null;
  billPdfUrl: string | null;
  billDate: string;
  expectedDeliveryDate: string;
  status: string;
  totalAmount: number;
  totalItems: number;
  approvedAt: string | null;
  approvedBy: { name: string } | null;
  // Sent back for correction (plan 1709, R25, Q17). `rejectedAt` set = it is with its creator,
  // not with an approver; Resubmit clears it and stamps `resubmittedAt`.
  rejectedAt: string | null;
  rejectionNote: string | null;
  resubmittedAt: string | null;
  deliveredAt: string | null;
  notes: string | null;
  brand: { name: string };
  createdBy: { name: string };
  deliveredBy: { name: string } | null;
  putawayBy: { name: string } | null;
  putawayAt: string | null;
  createdAt: string;
  lineItems: LineItem[];
  preBookings: { id: string; customerName: string; customerPhone: string | null; status: string; productName: string }[];
  vendorBillId: string | null;
  vendorBill: { vendorId: string } | null;
}

function formatINR(n: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
}

// Date only — for Bill Date and Expected Delivery, which are dates, not moments. The moments
// (created, approved, delivered, putaway) go through `formatDateTime` from @/lib/utils.
function formatDate(d: string) {
  return new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export default function InboundDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { warehouses } = useWarehouses();
  const { id } = use(params);
  const router = useRouter();
  const { data: session } = useSession();
  const { canEdit: canEditCheck, canApprove: canApproveCheck, canView } = usePermissions();
  // Line rate / amount / total are MONEY, so cost_price — not "is this person an admin".
  const isAdmin = canView("cost_price");
  const canDeliver = canEditCheck("inbound");
  const canApprove = canApproveCheck("inbound");

  const [shipment, setShipment] = useState<Shipment | null>(null);
  const [bins, setBins] = useState<Bin[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [itemLoading, setItemLoading] = useState<string | null>(null);
  const [approveLoading, setApproveLoading] = useState(false);
  // Reject asks for a note before anything is sent (R25).
  const [showReject, setShowReject] = useState(false);
  const [rejectNote, setRejectNote] = useState("");
  const [successMsg, setSuccessMsg] = useState<{ shipmentNo: string; deliveredCount: number } | null>(null);
  const [actionError, setActionError] = useState("");
  const [issueModal, setIssueModal] = useState<{ lineItem: LineItem; } | null>(null);
  const [issueType, setIssueType] = useState<"SHORTAGE" | "DAMAGE" | "WRONG_ITEM" | "QUALITY">("SHORTAGE");
  const [issueNotes, setIssueNotes] = useState("");
  const [issueQty, setIssueQty] = useState(0);
  const [issueSaving, setIssueSaving] = useState(false);
  // The issue modal gets its OWN error. The page-level actionError rendered BEHIND the open
  // modal, so a failed report looked like the button doing nothing at all.
  const [issueError, setIssueError] = useState("");
  const [confirmation, setConfirmation] = useState<{
    type: "success" | "warning" | "error" | "info";
    title: string;
    referenceId: string;
    items?: Array<{ label: string; value: string }>;
    details?: string;
  } | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  // "Applied to N · M kept by rule" after the bulk bin action (R1).
  const [bulkMessage, setBulkMessage] = useState("");

  // Per-LINE bin selection: lineItemId → binId. One bin per line (plan
  // 1509-assembly-queue-single-bin-and-product-assembly-level, D2) — it used to be one bin per
  // unit, but the server only ever honoured the first, so a split line put everything there.
  const [binSelections, setBinSelections] = useState<Record<string, string>>({});
  // Putaway matched rule metadata per line item: lineItemId → { suggestedBin, matchedRule }
  const [putawayItems, setPutawayItems] = useState<Record<string, PutawayItemInfo>>({});
  // The warehouse sent with a receive: the route's schema requires one, and the server then
  // replaces it with the chosen BIN's own warehouse (D2). Was DEFAULT_STOCK_LOCATION; there is
  // no default warehouse any more — the API rejects a missing one rather than guessing.
  //
  // The first GODOWN (plan 0909-stock-store-and-warehouse-scoping, D5), else the first
  // warehouse of any kind. DERIVED, not state: the "Receive into" picker that let a person
  // change it went with the bin switch (plan 2109, Q27), so there is no choice left to keep —
  // and the effect that copied it into state was a set-state-in-effect.
  const receiveLocation = (warehouses.find((w) => w.kind === "GODOWN") ?? warehouses[0])?.id ?? "";

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [shipRes, binRes, putawayRes] = await Promise.all([
        apiTry<Shipment>(`/api/inbound/${id}`),
        apiTry<Bin[]>("/api/bins"),
        apiTry<{ items: Array<{ id: string } & PutawayItemInfo> }>(`/api/inbound/${id}/putaway`),
      ]);
      if (cancelled) return;
      if (shipRes.error) {
        log.error("could not load shipment", { shipmentId: id, message: shipRes.error });
        setActionError(shipRes.error);
      } else if (shipRes.data) {
        setShipment(shipRes.data);
      }
      if (binRes.error) log.warn("could not load bins", { shipmentId: id, message: binRes.error });
      if (binRes.data) setBins(binRes.data);
      if (putawayRes.error) {
        log.warn("could not load home bin suggestions", { shipmentId: id, message: putawayRes.error });
      }
      if (putawayRes.data?.items) {
        const initialBins: Record<string, string> = {};
        const suggestionsMap: Record<string, PutawayItemInfo> = {};
        for (const it of putawayRes.data.items) {
          suggestionsMap[it.id] = {
            suggestedBin: it.suggestedBin,
            matchedRule: it.matchedRule,
            ruleLocked: it.ruleLocked,
          };
          // The suggestion is the line's pre-selected bin. For a rule-matched line it is also
          // the ONLY bin (R34) — `binForLine` reads the rule's bin, not this selection.
          if (it.suggestedBin?.id) initialBins[it.id] = it.suggestedBin.id;
        }
        setPutawayItems(suggestionsMap);
        setBinSelections((prev) => ({ ...initialBins, ...prev }));
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [id]);

  const refreshShipment = async () => {
    const { data, error } = await apiTry<Shipment>(`/api/inbound/${id}`);
    if (error) {
      log.error("could not refresh shipment", { shipmentId: id, message: error });
      setActionError(error);
    } else if (data) {
      setShipment(data);
    }
  };

  // A home-bin RULE matched this line (R34): its bin is locked to the rule's.
  const isRuleLocked = (lineItemId: string) =>
    Boolean(putawayItems[lineItemId]?.ruleLocked && putawayItems[lineItemId]?.suggestedBin?.id);

  // The bin a line will be received into: the rule's when locked, otherwise the selection.
  const binForLine = (lineItemId: string): string =>
    isRuleLocked(lineItemId)
      ? putawayItems[lineItemId].suggestedBin?.id ?? ""
      : binSelections[lineItemId] || "";

  // The whole line goes into this one bin (D2).
  const setBinForLine = (lineItemId: string, binId: string) => {
    setBinSelections((prev) => ({ ...prev, [lineItemId]: binId }));
  };

  // The `|| isAdmin` bypass is DELETED, not mapped to a permission (plan §8 Q3).
  //
  // It let an admin see the receive controls on a shipment NOBODY had approved, so stock
  // entered inventory with approvedAt and approvedBy still null and the record showed no
  // authoriser. It saved exactly one click — and that click IS the audit record.
  //
  // The API never implemented the bypass either, and now it actively refuses: the receive
  // branch of PUT /api/inbound/[id] returns 403 when `approvedAt` is null. That gate is new —
  // the per-line route previously had NO approval check at all, so this button being hidden
  // was the only thing standing between an unapproved shipment and inventory.
  const isApproved = !!shipment?.approvedAt;
  // Sent back to whoever raised it (R25). While this is true the shipment is theirs to fix:
  // the approve gate is hidden and the API refuses an approval outright.
  const isReturned = !isApproved && !!shipment?.rejectedAt;

  // `apiTry`, not a raw fetch. An expired session answers a bare fetch with a 307 to /login and
  // 200 HTML, so `res.ok` is true and `.json()` throws "Unexpected token <" — which reads as a
  // server fault instead of "sign back in" (CLAUDE.md).
  const handleApprove = async () => {
    setApproveLoading(true);
    const { data, error } = await apiTry<{ message?: string }>(`/api/inbound/${id}/approve`, {
      method: "POST",
      json: {},
    });
    setApproveLoading(false);
    if (!data) {
      log.warn("shipment approval failed", { shipmentId: id, message: error });
      setActionError(error || "Approval failed");
      return;
    }
    setActionError("");
    await refreshShipment();
  };

  /** Send it back with a note (R25, Q17). The note is required — see the modal. */
  const handleReject = async () => {
    setApproveLoading(true);
    const { data, error } = await apiTry<{ message?: string }>(`/api/inbound/${id}/reject`, {
      method: "POST",
      json: { rejectionNote: rejectNote.trim() },
    });
    setApproveLoading(false);
    if (!data) {
      log.warn("shipment return failed", { shipmentId: id, message: error });
      setActionError(error || "Could not send this shipment back");
      return;
    }
    setActionError("");
    setShowReject(false);
    setRejectNote("");
    await refreshShipment();
  };

  /** Ask for approval again once it is fixed (R25). */
  const handleResubmit = async () => {
    setApproveLoading(true);
    const { data, error } = await apiTry<{ message?: string }>(`/api/inbound/${id}/resubmit`, {
      method: "POST",
      json: {},
    });
    setApproveLoading(false);
    if (!data) {
      log.warn("shipment resubmit failed", { shipmentId: id, message: error });
      setActionError(error || "Could not resubmit this shipment");
      return;
    }
    setActionError("");
    await refreshShipment();
  };

  // `handleReceiveLine` — the "dormant bins" receive with no bin, behind a confirmation — is
  // GONE (plan 2109-inbound-bins-navigation-fixes, R34 + Q27). Bin tracking is always on, every
  // line is received into a bin, and `handleMarkItemDelivered` below is the one receive path.
  // Mark All / Partial / Undo were already gone: the shipment finishes itself when the last
  // outstanding line is received.

  const handleWhatsApp = async (li: LineItem) => {
    if (!li.preBookedCustomerPhone) return;
    const phone = li.preBookedCustomerPhone.replace(/\D/g, "").slice(-10);
    const expectedDate = shipment ? formatDate(shipment.expectedDeliveryDate) : "soon";
    const message = `Hello ${li.preBookedCustomerName}, great news! Your ${li.productName} has been dispatched from the brand and is expected to arrive at our store by ${expectedDate}. We'll notify you once it's ready for pickup/delivery. - Bharath Cycle Hub`;
    window.open(`https://wa.me/91${phone}?text=${encodeURIComponent(message)}`, "_blank");

    const { error } = await apiTry<{ updated: boolean }>(`/api/inbound/${id}`, {
      method: "PUT",
      json: { lineItemId: li.id, whatsAppSent: true },
    });
    if (error) log.warn("could not mark WhatsApp sent", { shipmentId: id, lineItemId: li.id, message: error });
  };

  // ONE line at a time, always into a bin (R34). A rule-matched line sends the rule's bin —
  // never a stale selection — because the server refuses any other with a 409.
  const handleMarkItemDelivered = async (li: LineItem) => {
    const binId = binForLine(li.id);
    if (!binId) {
      setConfirmation({
        type: "error",
        title: "Bin Assignment Required",
        referenceId: shipment?.shipmentNo || "",
        items: [
          { label: "Product", value: li.productName },
          { label: "Units", value: `${li.quantity}` },
        ],
        details: "Select the bin this line goes into before receiving it.",
      });
      return;
    }
    if (!receiveLocation) {
      log.warn("receive blocked: warehouses not loaded", { shipmentId: id, lineItemId: li.id });
      setActionError("Warehouses are still loading — try again in a moment.");
      return;
    }
    setItemLoading(li.id);
    // `warehouseId` because the route's schema requires it; the server records the stock in
    // the BIN's own warehouse (D2), so a Floor bin is not booked into the default godown.
    const { data, error } = await apiTry<{ updated: boolean; alreadyReceived: boolean; shipmentDelivered: boolean }>(
      `/api/inbound/${id}`,
      {
        method: "PUT",
        json: { lineItemId: li.id, deliveredQty: li.quantity, warehouseId: receiveLocation, binId },
        timeoutMs: 30_000,
      }
    );
    if (error) {
      log.error("mark delivered failed", { shipmentId: id, lineItemId: li.id, binId, message: error });
      setActionError(error);
    } else {
      setActionError("");
      setBinSelections((prev) => { const n = { ...prev }; delete n[li.id]; return n; });
      await refreshShipment();
      // The server says whether THAT receipt finished the shipment, so the completion message
      // cannot fire twice when two people receive the last two lines.
      if (data?.shipmentDelivered) {
        setSuccessMsg({ shipmentNo: shipment?.shipmentNo || "", deliveredCount: shipment?.lineItems.length || 0 });
      } else {
        setConfirmation({
          type: "success",
          title: "Item Received & Binned",
          referenceId: shipment?.shipmentNo || "",
          items: [
            { label: "Product", value: li.productName },
            { label: "Quantity", value: `${li.quantity} units` },
            { label: "Bin", value: bins.find((b) => b.id === binId)?.code || "Assigned" },
          ],
          details: `Bill: ${shipment?.billNo}`,
        });
      }
    }
    setItemLoading(null);
  };

  // `handlePutaway` (the after-delivery "Save Bin Assignment") is GONE — plan 2109, R34: no
  // line can be received without a bin, so there is nothing left to put away afterwards.

  // `handleRevert` is GONE with the Undo button and api/inbound/[id]/status.
  //
  // It set the shipment back to IN_TRANSIT without touching a single line item or removing
  // any stock, so "Undo" undid the label and left the received quantities in inventory —
  // the shipment then read as unreceived while its stock was already on the shelves. With
  // receiving per line there is nothing coherent for it to undo: a line that is in the
  // building is in the building, and a mistaken receipt is a stock correction (Report Issue
  // or a warehouse audit), not a status flip.

  const handleDelete = async () => {
    setShowDeleteConfirm(false);
    setActionLoading(true);
    // `apiTry`, not `fetch().then(r => r.json())` — an expired session answers with HTML and
    // the raw `.json()` threw "Unexpected token <" (CLAUDE.md).
    const { data, error } = await apiTry<{ deleted: boolean }>(`/api/inbound/${id}`, { method: "DELETE" });
    setActionLoading(false);
    if (data) {
      router.push("/inbound");
    } else {
      log.warn("shipment delete failed", { shipmentId: id, message: error });
      setConfirmation({
        type: "error",
        title: "Cannot Delete",
        referenceId: shipment?.shipmentNo || "",
        details: error || "Cannot delete shipment",
      });
    }
  };

  // Reports to the NEW inbound-scoped route, which fixes all three reasons this never worked:
  //   * it was gated on vendor_issues.create, which no seeded role held -> 403;
  //   * a shipment with no Zoho bill sent no vendorId -> 400;
  //   * the description was assembled here, so the two callers could drift.
  // The route resolves the vendor itself (bill -> brand name -> create) and builds the
  // description, so this sends only what the goods desk actually knows.
  const handleReportIssue = async () => {
    if (!issueModal || !shipment) return;
    setIssueSaving(true);
    setIssueError("");
    const { data, error } = await apiTry<{ id: string; issueNo: string }>(
      `/api/inbound/${id}/issues`,
      {
        method: "POST",
        json: {
          lineItemId: issueModal.lineItem.id,
          issueType,
          issueQty: issueQty || undefined,
          notes: issueNotes || undefined,
        },
      }
    );
    if (error) {
      log.error("report issue failed", { shipmentId: id, lineItemId: issueModal.lineItem.id, message: error });
      // INSIDE the modal. It used to set the page-level actionError, which rendered behind
      // the open modal — the user saw the form sit there having apparently done nothing.
      setIssueError(error);
    } else if (data) {
      setIssueNotes("");
      setIssueQty(0);
      setActionError("");
      setIssueModal(null);
      setConfirmation({
        type: "warning",
        title: "Issue Reported",
        referenceId: data.issueNo,
        items: [
          { label: "Product", value: issueModal.lineItem.productName },
          { label: "Issue Type", value: issueType },
          { label: "Shipment", value: shipment.shipmentNo },
        ],
        // Was "Sravan (Finance Head) will be notified" — nothing notifies anyone. Saying so
        // meant the reporter walked away expecting a follow-up that was never coming.
        details: "Visible on Vendor Issues",
      });
    }
    setIssueSaving(false);
  };

  // ONE bin selector per line (D2). The per-unit selectors let a line be split across bins,
  // which the server never honoured beyond the first.
  // Only for a line NO rule matched — a rule-matched line shows its bin locked instead (R34).
  const renderBinSelectors = (li: LineItem) => {
    if (bins.length === 0) {
      return (
        <div className="mt-2 p-2 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800">
          No warehouse bins configured yet. Create a bin in Warehouse Bins to assign items.
        </div>
      );
    }

    return (
      <select
        value={binSelections[li.id] || ""}
        onChange={(e) => setBinForLine(li.id, e.target.value)}
        aria-label={`Bin for ${li.productName}`}
        className="mt-2 w-full min-h-[44px] text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white text-slate-700"
      >
        <option value="">{li.quantity > 1 ? `Select bin for all ${li.quantity} units *` : "Select bin *"}</option>
        {bins.map((b) => (
          <option key={b.id} value={b.id}>{b.code} — {b.name}{b.location ? ` (${b.location})` : ""}</option>
        ))}
      </select>
    );
  };

  if (loading) {
    return (
      <div className="pt-2">
        <SkeletonList count={5} type="card" />
      </div>
    );
  }

  if (!shipment) {
    return (
      <div className="text-center py-20">
        <p className="text-sm text-slate-400">Shipment not found</p>
        <Link href="/inbound"><Button variant="outline" size="sm" className="mt-3">Back</Button></Link>
      </div>
    );
  }

  const deliveredCount = shipment.lineItems.filter((li) => li.isDelivered).length;
  const needsBinCount = shipment.lineItems.filter((li) => li.isDelivered && !li.binId).length;
  const statusBadge = {
    colorClass: getStatusColor(shipment.status === "PARTIALLY_DELIVERED" ? "PARTIAL" : shipment.status),
    label: shipment.status === "PARTIALLY_DELIVERED" ? "Partial" : getStatusLabel(shipment.status),
  };

  // Lines still to receive that have no bin yet — the "Choose a bin for N lines" prompt (R34).
  const linesWithoutBin = shipment.lineItems.filter((li) => !li.isDelivered && !binForLine(li.id)).length;

  return (
    <div className="pb-4">
      <div className="flex items-center gap-2 mb-4">
        <Link href="/inbound" className="p-2 -ml-2 rounded-lg hover:bg-slate-100 focus-ring" aria-label="Back"><ArrowLeft className="h-5 w-5 text-slate-600" /></Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-bold text-slate-900 tabular-nums truncate">{shipment.shipmentNo}</h1>
          <p className="text-xs text-slate-500 tabular-nums truncate">Bill: {shipment.billNo}</p>
        </div>
        <Badge className={`text-xs shrink-0 ${statusBadge.colorClass}`}>{statusBadge.label}</Badge>
      </div>

      {/* Action Error */}
      {actionError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-2.5 mb-3 text-xs text-red-700">
          {actionError}
          <button onClick={() => setActionError("")} className="ml-2 underline">dismiss</button>
        </div>
      )}

      {/* Summary */}
      <Card className="mb-3">
        <CardContent className="p-3 space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-xs text-slate-500">Bill Date</span>
            <span className="text-sm font-semibold text-slate-900 tabular-nums">{formatDate(shipment.billDate)}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-xs text-slate-500">Expected Delivery</span>
            <span className="text-sm font-semibold text-amber-600 flex items-center gap-1 tabular-nums">
              <Calendar className="h-3 w-3" /> {formatDate(shipment.expectedDeliveryDate)}
            </span>
          </div>
          {shipment.deliveredAt && (
            <div className="flex justify-between items-center">
              <span className="text-xs text-slate-500">Delivered</span>
              <span className="text-sm font-semibold text-green-600 tabular-nums">{formatDateTime(shipment.deliveredAt)}</span>
            </div>
          )}
          {isAdmin && (
            <div className="flex justify-between items-center">
              <span className="text-xs text-slate-500">Total</span>
              <span className="text-sm font-semibold text-slate-900 tabular-nums">{formatINR(shipment.totalAmount)}</span>
            </div>
          )}
          <div className="flex justify-between items-center">
            <span className="text-xs text-slate-500">Items</span>
            <span className="text-sm font-semibold text-slate-700 tabular-nums">{deliveredCount}/{shipment.totalItems} delivered</span>
          </div>
          {/* Only an OLD line can be here — received while the bin switch was off. Nothing on
              this screen places it any more (plan 2109, R34); the R37 check finds them. */}
          {needsBinCount > 0 && (
            <div className="flex justify-between items-center">
              <span className="text-xs text-slate-500">Received with no bin</span>
              <Badge variant="warning" className="text-xs">{needsBinCount} item{needsBinCount > 1 ? "s" : ""}</Badge>
            </div>
          )}
          <div className="flex justify-between items-center">
            <span className="text-xs text-slate-500">Created by</span>
            <span className="text-xs text-slate-700 tabular-nums">{shipment.createdBy.name} on {formatDateTime(shipment.createdAt)}</span>
          </div>
          {shipment.approvedBy && (
            <div className="flex justify-between items-center">
              <span className="text-xs text-slate-500">Approved by</span>
              <span className="text-xs text-green-700 font-medium tabular-nums">{shipment.approvedBy.name} on {formatDateTime(shipment.approvedAt)}</span>
            </div>
          )}
          {/* Delivered and putaway are moments the row already carries (`deliveredAt`,
              `putawayAt` — plan 0909-stock-screens-size-category-and-sidebar, Part F). A
              name with no time answered "who" and threw "when" away. */}
          {shipment.deliveredBy && (
            <div className="flex justify-between items-center">
              <span className="text-xs text-slate-500">Delivered by</span>
              <span className="text-xs text-slate-700 tabular-nums">
                {shipment.deliveredBy.name}{shipment.deliveredAt ? ` on ${formatDateTime(shipment.deliveredAt)}` : ""}
              </span>
            </div>
          )}
          {shipment.putawayBy && (
            <div className="flex justify-between items-center">
              <span className="text-xs text-slate-500">Putaway by</span>
              <span className="text-xs text-slate-700 tabular-nums">
                {shipment.putawayBy.name}{shipment.putawayAt ? ` on ${formatDateTime(shipment.putawayAt)}` : ""}
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Returned for correction (R25, Q17) ──────────────────────────────────────────
          The note is the point. Before this, a shipment nobody approved just sat there and
          the person who raised it had no way of learning that anything was wrong with it. */}
      {isReturned && (
        <div className="mb-3 rounded-xl border border-orange-200 bg-orange-50 p-3">
          <div className="flex items-start gap-2">
            <Undo2 className="h-4 w-4 text-orange-600 shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-orange-900">Sent back for correction</p>
              <p className="text-xs text-orange-800 mt-0.5 whitespace-pre-wrap">
                {shipment.rejectionNote || "No reason was given."}
              </p>
              {canDeliver && (
                <Button
                  onClick={handleResubmit}
                  disabled={approveLoading}
                  className="mt-2 w-full min-h-[44px] bg-orange-600 hover:bg-orange-700"
                >
                  {approveLoading ? "Working..." : "Fixed — resubmit for approval"}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Approval Gate */}
      {!isApproved && !isReturned && shipment.status !== "DELIVERED" && (
        <div className="mb-3">
          {canApprove ? (
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => { setShowReject(true); setRejectNote(""); }}
                disabled={approveLoading}
                className="flex-1 min-h-[48px] rounded-lg font-medium text-red-600 border-red-200 hover:bg-red-50" size="lg">
                <Undo2 className="h-4 w-4 mr-2" /> Reject
              </Button>
              <Button onClick={handleApprove} disabled={approveLoading}
                className="flex-1 min-h-[48px] rounded-lg font-medium bg-indigo-600 hover:bg-indigo-700" size="lg">
                <ShieldCheck className="h-4 w-4 mr-2" /> {approveLoading ? "Approving..." : "Approve Inward"}
              </Button>
            </div>
          ) : (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-center">
              <ShieldCheck className="h-5 w-5 text-amber-500 mx-auto mb-1" />
              <p className="text-xs font-medium text-amber-800">Awaiting Approval</p>
              <p className="text-xs text-amber-600 mt-0.5">Anyone whose role can approve inbound must sign this off before delivery</p>
            </div>
          )}
        </div>
      )}

      {/* The labels are pasted on the physical items, so they are printed from the shipment
          that brought them in (R46). The sheet itself is Part H's `/units/labels`. */}
      {shipment.status === "DELIVERED" && (
        <Link
          href={`/units/labels?inboundShipmentId=${shipment.id}`}
          className="mb-3 flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-3 focus-ring"
        >
          <span className="text-xs font-medium text-slate-700">Print unit labels for this shipment</span>
          <QrCode className="h-4 w-4 text-slate-400 shrink-0" />
        </Link>
      )}

      {/* Reject always takes a note — "sent back" with no reason is what this replaced. */}
      {showReject && (
        <div className="fixed inset-0 bg-black/50 z-[60] flex items-end sm:items-center justify-center p-4"
          onClick={() => setShowReject(false)}>
          <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-md p-5 space-y-3"
            onClick={(e) => e.stopPropagation()}>
            <h2 className="text-base font-bold text-slate-900">Send {shipment.shipmentNo} back?</h2>
            <p className="text-xs text-slate-500">
              {shipment.createdBy.name} gets your note and fixes this same shipment. Nothing is
              deleted and no stock has moved.
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
              <Button variant="outline" onClick={() => setShowReject(false)} className="flex-1 min-h-[44px]">
                Keep it
              </Button>
              <Button onClick={handleReject}
                disabled={rejectNote.trim().length === 0 || approveLoading}
                className="flex-1 min-h-[44px] bg-red-600 hover:bg-red-700">
                Send back
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* The "Receive into" warehouse picker (bins dormant) is GONE — plan
          2109-inbound-bins-navigation-fixes, Q27: bin tracking is always on, and the chosen
          bin decides the warehouse on the server. */}

      {/* Mark All Delivered / Partial / Undo are GONE (R3, D6).
          They wrote a shipment STATUS directly through api/inbound/[id]/status without
          touching a single line item, so a shipment could read DELIVERED while every line
          was still unreceived and no stock had moved. Receiving is per line now, and the
          shipment finishes itself when the last outstanding line is received — the state is
          derived from the lines rather than asserted over them. */}

      {/* The after-delivery "N items need bin assignment / Save Bin Assignment" panel is GONE
          (plan 2109-inbound-bins-navigation-fixes, R34): a bin is required on every line before
          it is received, so no line reaches DELIVERED without one. */}

      {/* Success message after delivery */}
      <ActionConfirmation
        open={!!successMsg}
        onClose={() => setSuccessMsg(null)}
        type="success"
        title="Inward Completed Successfully!"
        referenceId={successMsg?.shipmentNo || ""}
        performedBy={(session?.user as { name?: string } | undefined)?.name}
        items={[
          { label: "Items Received", value: `${successMsg?.deliveredCount || 0} items` },
          { label: "Bill", value: shipment?.billNo || "" },
        ]}
        details="All items received and stock updated"
      />

      {/* "Apply to all unmatched lines" (plan 2109-inbound-bins-navigation-fixes, R1). It was
          "Apply same bin to all items" and overwrote every undelivered line, rule-matched ones
          included, so the rule's bin was lost. It now fills only lines no home-bin rule
          matched; a rule-matched line is locked (R34) and is reported as kept. */}
      {canDeliver && isApproved && (shipment.status === "IN_TRANSIT" || shipment.status === "PARTIALLY_DELIVERED") && bins.length > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 mb-3">
          <p className="text-xs font-medium text-blue-800 mb-1.5">Apply to all unmatched lines</p>
          <select
            aria-label="Bin for all unmatched lines"
            onChange={(e) => {
              if (!e.target.value) return;
              const binId = e.target.value;
              const undelivered = shipment.lineItems.filter((li) => !li.isDelivered);
              const unmatched = undelivered.filter((li) => !isRuleLocked(li.id));
              const newSelections = { ...binSelections };
              for (const li of unmatched) {
                newSelections[li.id] = binId;
              }
              setBinSelections(newSelections);
              setBulkMessage(`Applied to ${unmatched.length} · ${undelivered.length - unmatched.length} kept by rule`);
              log.debug("bulk bin applied", {
                shipmentId: id,
                binId,
                applied: unmatched.length,
                keptByRule: undelivered.length - unmatched.length,
              });
              e.target.value = "";
            }}
            className="w-full min-h-[44px] text-xs border border-blue-200 rounded-lg px-2 py-1.5 bg-white text-slate-700"
          >
            <option value="">Select a bin for every unmatched line...</option>
            {bins.map((b) => (
              <option key={b.id} value={b.id}>{b.code} — {b.name}{b.location ? ` (${b.location})` : ""}</option>
            ))}
          </select>
          {bulkMessage && <p className="text-xs text-blue-700 mt-1.5 tabular-nums">{bulkMessage}</p>}
          {linesWithoutBin > 0 && (
            <p className="text-xs text-amber-700 mt-1.5 tabular-nums">
              Choose a bin for {linesWithoutBin} line{linesWithoutBin > 1 ? "s" : ""}
            </p>
          )}
        </div>
      )}

      {/* Line Items */}
      <p className="text-sm font-semibold text-slate-700 mb-2">Line Items</p>
      <div className="space-y-2 mb-4">
        {shipment.lineItems.map((li) => (
          <Card key={li.id} className={li.isDelivered ? "border-green-200 bg-green-50/30" : ""}>
            <CardContent className="p-3">
              <div className="flex items-start justify-between mb-1">
                <div className="flex-1 min-w-0 mr-2">
                  <p className="text-base font-medium text-slate-900">{li.productName}</p>
                  {li.product && <p className="text-xs text-slate-500">{li.product.sku} | {li.product.name}</p>}
                  <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                    {li.product?.brand?.name && (
                      <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">
                        Brand: {li.product.brand.name}
                      </span>
                    )}
                    {li.product?.category?.name && (
                      <span className="inline-flex items-center rounded-md bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700">
                        Category: {li.product.category.name}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {li.isDelivered && <CheckCircle2 className="h-4 w-4 text-green-500" />}
                  {li.isDelivered && !li.binId && <Badge variant="warning" className="text-[11px] px-1.5">No Bin</Badge>}
                </div>
              </div>

              <div className="flex items-center gap-3 mt-1 text-xs text-slate-500">
                <span className="text-base font-bold text-slate-800 tabular-nums">Qty: {li.quantity}</span>
                {isAdmin && <span className="tabular-nums">Rate: {formatINR(li.rate)}</span>}
                {isAdmin && <span className="font-medium text-slate-700 tabular-nums">{formatINR(li.amount)}</span>}
              </div>

              {/* Current bin assignment */}
              {li.bin && (
                <div className="flex items-center gap-1.5 mt-1.5 text-xs text-indigo-600">
                  <MapPin className="h-3 w-3" /> {li.bin.code} — {li.bin.name} ({li.bin.location})
                </div>
              )}

              {/* The bin, before receiving (plan 2109-inbound-bins-navigation-fixes, R1 + R34).
                  A line a home-bin rule matched shows the rule's bin LOCKED — no select, and the
                  bulk action skips it; the server refuses any other bin with a 409. Every other
                  line gets a required select. Bin tracking is always on (Q27), so the "dormant"
                  Receive button, its confirmation and the warehouse picker are gone. */}
              {canDeliver && isApproved && (shipment.status === "IN_TRANSIT" || shipment.status === "PARTIALLY_DELIVERED") && !li.isDelivered && (
                <div>
                  {isRuleLocked(li.id) ? (
                    <div className="mt-2 flex items-center gap-2 min-h-[44px] rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs text-emerald-800">
                      <Lock className="h-3.5 w-3.5 text-emerald-600 shrink-0" aria-hidden />
                      <span className="flex-1 min-w-0 truncate">
                        <strong>{putawayItems[li.id].suggestedBin?.code}</strong> — {putawayItems[li.id].suggestedBin?.name}
                      </span>
                      <Badge variant="success" className="text-[11px] shrink-0">
                        Rule: {putawayItems[li.id].matchedRule?.label || "Home bin"}
                      </Badge>
                    </div>
                  ) : (
                    <>
                      {putawayItems[li.id]?.suggestedBin ? (
                        <div className="flex items-center gap-1.5 mt-2 px-2.5 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-600">
                          <Info className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                          <span>No home bin rule matched — pre-filled with the product&apos;s current bin, {putawayItems[li.id].suggestedBin?.code}. Change it if needed.</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 mt-2 px-2.5 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-500">
                          <Info className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                          <span>No home bin rule matched — choose a bin</span>
                        </div>
                      )}
                      {renderBinSelectors(li)}
                    </>
                  )}
                  <button
                    onClick={() => handleMarkItemDelivered(li)}
                    disabled={itemLoading === li.id || !binForLine(li.id)}
                    className="mt-2 w-full min-h-[44px] rounded-lg bg-green-50 text-green-700 text-xs font-medium border border-green-200 hover:bg-green-100 disabled:opacity-50"
                  >
                    {itemLoading === li.id
                      ? "Receiving…"
                      : binForLine(li.id)
                        ? `Receive ×${li.quantity}`
                        : "Choose a bin first"}
                  </button>
                </div>
              )}

              {li.isDelivered && (
                <div className="mt-2 w-full min-h-[44px] flex items-center justify-center rounded-lg bg-green-50 text-green-700 text-sm font-semibold border border-green-200">
                  Received ×{li.deliveredQty ?? li.quantity} ✓
                </div>
              )}

              {/* The post-delivery bin picker for a received line with no bin is GONE (plan 2109,
                  R34): no line can be received without a bin any more. An old line received while
                  the switch was off still shows its "No Bin" badge above; R37 checks for them. */}

              {/* Report Issue button */}
              {canDeliver && shipment.status !== "DELIVERED" && (
                <button
                  onClick={() => { setIssueModal({ lineItem: li }); setIssueQty(1); }}
                  className="mt-2 flex items-center gap-1.5 text-xs text-red-600 hover:text-red-700 font-medium"
                >
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Report Issue
                </button>
              )}

              {/* Pre-booked customer */}
              {li.preBookedCustomerName && (
                <div className="mt-2 bg-purple-50 rounded-lg p-2 flex items-center justify-between">
                  <div>
                    <p className="text-xs text-purple-700 font-medium">Pre-booked: {li.preBookedCustomerName}</p>
                    {li.preBookedInvoiceNo && <p className="text-xs text-purple-500">Invoice: {li.preBookedInvoiceNo}</p>}
                  </div>
                  <div className="flex items-center gap-1.5">
                    {li.whatsAppSent && <span className="text-[11px] text-green-600 font-medium">Sent</span>}
                    {li.preBookedCustomerPhone && (
                      <button onClick={() => handleWhatsApp(li)}
                        className="p-2.5 rounded-full hover:bg-green-100">
                        <Phone className="h-4 w-4 text-green-600" />
                      </button>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Notes */}
      {shipment.notes && (
        <p className="text-xs text-slate-400 text-center mt-4">Notes: {shipment.notes}</p>
      )}

      {/* Delete — admin only */}
      {isAdmin && (
        <button
          onClick={() => setShowDeleteConfirm(true)}
          disabled={actionLoading}
          className="mt-6 w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-red-600 text-xs font-medium border border-red-200 hover:bg-red-50 disabled:opacity-50"
        >
          <Trash2 className="h-3.5 w-3.5" />
          {deliveredCount > 0 ? "Delete & Reverse Stock" : "Delete Shipment"}
        </button>
      )}

      {/* Delete Confirmation */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-4">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-md p-5 space-y-4">
            <h3 className="text-base font-bold text-red-700">Delete Shipment?</h3>
            <p className="text-sm text-slate-600">This action cannot be undone. {deliveredCount > 0 ? "Stock entries will be reversed." : "The shipment will be permanently removed."}</p>
            <div className="flex gap-2">
              <button onClick={() => setShowDeleteConfirm(false)}
                className="flex-1 py-2.5 rounded-lg border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50">
                Cancel
              </button>
              <button onClick={handleDelete}
                className="flex-1 py-2.5 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700">
                Yes, Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Issue Report Modal */}
      {issueModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-4">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-md p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900">Report Issue</h3>
              <button onClick={() => setIssueModal(null)} className="text-slate-400 text-lg">&times;</button>
            </div>

            <p className="text-sm text-slate-600">{issueModal.lineItem.productName} (Qty: {issueModal.lineItem.quantity})</p>

            <div>
              <label className="text-xs font-medium text-slate-700 mb-1 block">Issue Type</label>
              <div className="grid grid-cols-2 gap-2">
                {(["SHORTAGE", "DAMAGE", "WRONG_ITEM", "QUALITY"] as const).map((t) => (
                  <button key={t} onClick={() => setIssueType(t)}
                    className={`py-2 px-3 rounded-lg text-xs font-medium border transition-colors ${issueType === t ? "bg-red-50 border-red-300 text-red-700" : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
                    {t === "SHORTAGE" ? "Shortage" : t === "DAMAGE" ? "Damage" : t === "WRONG_ITEM" ? "Wrong Item" : "Quality"}
                  </button>
                ))}
              </div>
            </div>

            {(issueType === "SHORTAGE" || issueType === "DAMAGE") && (
              <div>
                <label className="text-xs font-medium text-slate-700 mb-1 block">
                  {issueType === "SHORTAGE" ? "Units short" : "Units damaged"}
                </label>
                <input type="number" min={1} max={issueModal.lineItem.quantity} value={issueQty}
                  onChange={(e) => setIssueQty(parseInt(e.target.value) || 0)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
              </div>
            )}

            <div>
              <label className="text-xs font-medium text-slate-700 mb-1 block">Notes (optional)</label>
              <textarea value={issueNotes} onChange={(e) => setIssueNotes(e.target.value)}
                placeholder="Describe the issue..."
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm h-20 resize-none" />
            </div>

            {/* Inside the modal, not on the page behind it. */}
            {issueError && (
              <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {issueError}
              </p>
            )}

            <div className="flex gap-2">
              <button onClick={() => { setIssueModal(null); setIssueError(""); }}
                className="flex-1 min-h-[48px] rounded-lg border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50">
                Cancel
              </button>
              <button onClick={handleReportIssue} disabled={issueSaving}
                className="flex-1 min-h-[48px] rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-50">
                {issueSaving ? "Reporting..." : "Report Issue"}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmation && (
        <ActionConfirmation
          open={!!confirmation}
          onClose={() => setConfirmation(null)}
          type={confirmation.type}
          title={confirmation.title}
          referenceId={confirmation.referenceId}
          performedBy={(session?.user as { name?: string } | undefined)?.name}
          items={confirmation.items}
          details={confirmation.details}
        />
      )}
    </div>
  );
}
