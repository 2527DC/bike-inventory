"use client";

import { useState, useEffect, use } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Phone, CheckCircle2, Calendar, MapPin, Save, Trash2, ShieldCheck, AlertTriangle } from "lucide-react";
import { getStatusColor, getStatusLabel } from "@/lib/status-colors";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SkeletonList } from "@/components/ui/skeleton";
import { ActionConfirmation } from "@/components/ui/action-confirmation";
import { usePermissions } from "@/lib/use-permissions";
import { BIN_TRACKING_ENABLED } from "@/lib/inventory-config";
import { useWarehouses } from "@/hooks/use-sites";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";

const log = createLogger("inbound:detail");

/** What GET /api/categories returns: roots with their children nested one level. */
interface RawCategory {
  id: string;
  name: string;
  children?: Array<{ id: string; name: string }>;
}

/** Flattened for the picker — `hint` carries the parent so two leaves can be told apart. */
interface CategoryOption {
  id: string;
  label: string;
  hint?: string;
}

interface LineItem {
  id: string;
  productName: string;
  product: { name: string; sku: string } | null;
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
  deliveredAt: string | null;
  notes: string | null;
  brand: { name: string };
  createdBy: { name: string };
  deliveredBy: { name: string } | null;
  putawayBy: { name: string } | null;
  createdAt: string;
  lineItems: LineItem[];
  preBookings: { id: string; customerName: string; customerPhone: string | null; status: string; productName: string }[];
  vendorBillId: string | null;
  vendorBill: { vendorId: string } | null;
  categoryId: string | null;
  category: { id: string; name: string; parent: { name: string } | null } | null;
}

function formatINR(n: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
}

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
  const [putawayLoading, setPutawayLoading] = useState(false);
  const [approveLoading, setApproveLoading] = useState(false);
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
  // Which line is mid-receive, so only THAT row shows a spinner rather than the whole page
  // freezing — receiving is now one tap per line and several happen in quick succession.
  const [receivingLineId, setReceivingLineId] = useState<string | null>(null);
  // The line awaiting confirmation. Receiving adds stock, so it asks first.
  const [confirmReceive, setConfirmReceive] = useState<LineItem | null>(null);

  // Per-item bin selections: lineItemId → array of binIds (one per unit)
  const [binSelections, setBinSelections] = useState<Record<string, string[]>>({});
  // Location mode (bins dormant): where this shipment's stock is received
  // Was DEFAULT_STOCK_LOCATION. There is no default warehouse any more — the API rejects a
  // missing one with a 400 rather than guessing, because putting stock in the wrong building
  // reports nothing anywhere. Set to the first warehouse once the list loads, so a normal
  // receive still carries one without the user having to think about it.
  const [receiveLocation, setReceiveLocation] = useState<string>("");

  // Pick the first warehouse once the list arrives, so a normal receive carries one without
  // the user choosing. Only when nothing is selected — never clobber a deliberate choice.
  useEffect(() => {
    if (!receiveLocation && warehouses.length > 0) setReceiveLocation(warehouses[0].id);
  }, [warehouses, receiveLocation]);
  // The Cycles/Spares/Accessories choice is a COLUMN on the shipment now, not a value in this
  // browser's localStorage (R3). It used to be keyed `inbound-shiptype-<id>` on one phone, so
  // the shipment read as uncategorised to every other device and lost the choice whenever the
  // browser cleared — and nothing on the server ever knew it.
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [savingCategory, setSavingCategory] = useState(false);
  const [changingCategory, setChangingCategory] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [shipRes, binRes, catRes] = await Promise.all([
        apiTry<Shipment>(`/api/inbound/${id}`),
        BIN_TRACKING_ENABLED
          ? apiTry<Bin[]>("/api/bins")
          : Promise.resolve({ data: [] as Bin[], error: null, isAuth: false, isTimeout: false }),
        // GET /api/categories is gated on `stock.view`. A receiving role without it gets an
        // empty picker and cannot receive anything — check the role's grants before release.
        apiTry<RawCategory[]>("/api/categories"),
      ]);
      if (cancelled) return;
      if (shipRes.error) {
        log.error("could not load shipment", { shipmentId: id, message: shipRes.error });
        setActionError(shipRes.error);
      } else if (shipRes.data) {
        setShipment(shipRes.data);
      }
      if (binRes.data) setBins(binRes.data);
      if (catRes.error) {
        log.error("could not load categories", { message: catRes.error });
      } else if (catRes.data) {
        // Flattened parent + children, with the parent as the hint so "Tyres" is
        // distinguishable from another "Tyres" under a different parent.
        const flat: CategoryOption[] = [];
        for (const c of catRes.data) {
          flat.push({ id: c.id, label: c.name });
          for (const ch of c.children ?? []) {
            flat.push({ id: ch.id, label: ch.name, hint: c.name });
          }
        }
        setCategories(flat);
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

  const handleCategorySelect = async (categoryId: string | null) => {
    if (!categoryId) return;
    setSavingCategory(true);
    setActionError("");
    const { error } = await apiTry(`/api/inbound/${id}`, {
      method: "PUT",
      json: { categoryId },
    });
    if (error) {
      log.error("could not set shipment category", { shipmentId: id, message: error });
      setActionError(error);
    } else {
      setChangingCategory(false);
      await refreshShipment();
    }
    setSavingCategory(false);
  };

  // Set bin for a specific unit of a line item
  const setBinForUnit = (lineItemId: string, unitIndex: number, binId: string, totalQty: number) => {
    setBinSelections((prev) => {
      const current = prev[lineItemId] || new Array(totalQty).fill("");
      const updated = [...current];
      // Ensure array is the right length
      while (updated.length < totalQty) updated.push("");
      updated[unitIndex] = binId;
      return { ...prev, [lineItemId]: updated };
    });
  };

  // Set all units of a line item to the same bin
  const setBinForAll = (lineItemId: string, binId: string, totalQty: number) => {
    setBinSelections((prev) => ({
      ...prev,
      [lineItemId]: new Array(totalQty).fill(binId),
    }));
  };

  // Get bin selections as grouped allocations [{binId, qty}]
  const getBinAllocations = (lineItemId: string): Array<{ binId: string; qty: number }> => {
    const selections = binSelections[lineItemId] || [];
    const groups: Record<string, number> = {};
    for (const binId of selections) {
      if (binId) groups[binId] = (groups[binId] || 0) + 1;
    }
    return Object.entries(groups).map(([binId, qty]) => ({ binId, qty }));
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

  const handleApprove = async () => {
    setApproveLoading(true);
    try {
      const res = await fetch(`/api/inbound/${id}/approve`, { method: "POST" }).then((r) => r.json());
      if (res.success) { setActionError(""); await refreshShipment(); }
      else setActionError(res.error || "Approval failed");
    } catch (e) { setActionError(e instanceof Error ? e.message : "Approval failed"); }
    finally { setApproveLoading(false); }
  };

  // ONE line at a time. Mark All / Partial / Undo are gone: the shipment finishes itself
  // when the last outstanding line is received, and the old buttons wrote a STATUS directly
  // (via api/inbound/[id]/status, now deleted) without touching the lines they claimed to
  // cover — so a shipment could read DELIVERED with every line still unreceived.
  const handleReceiveLine = async (li: LineItem) => {
    if (!receiveLocation) { setActionError("Choose where the stock is going first"); return; }
    setReceivingLineId(li.id);
    setActionError("");
    const { data, error } = await apiTry<{ updated: boolean; alreadyReceived: boolean; shipmentDelivered: boolean }>(
      `/api/inbound/${id}`,
      {
        method: "PUT",
        json: { lineItemId: li.id, deliveredQty: li.quantity, warehouseId: receiveLocation },
        timeoutMs: 30_000,
      }
    );
    if (error) {
      log.error("receive line failed", { shipmentId: id, lineItemId: li.id, message: error });
      setActionError(error);
    } else {
      await refreshShipment();
      // The server tells us whether THAT receipt was the one that finished the shipment, so
      // the confirmation cannot fire twice when two people receive the last two lines.
      if (data?.shipmentDelivered) {
        setSuccessMsg({ shipmentNo: shipment?.shipmentNo || "", deliveredCount: shipment?.lineItems.length || 0 });
      }
    }
    setReceivingLineId(null);
    setConfirmReceive(null);
  };


  const handleWhatsApp = async (li: LineItem) => {
    if (!li.preBookedCustomerPhone) return;
    const phone = li.preBookedCustomerPhone.replace(/\D/g, "").slice(-10);
    const expectedDate = shipment ? formatDate(shipment.expectedDeliveryDate) : "soon";
    const message = `Hello ${li.preBookedCustomerName}, great news! Your ${li.productName} has been dispatched from the brand and is expected to arrive at our store by ${expectedDate}. We'll notify you once it's ready for pickup/delivery. - Bharath Cycle Hub`;
    window.open(`https://wa.me/91${phone}?text=${encodeURIComponent(message)}`, "_blank");

    await fetch(`/api/inbound/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lineItemId: li.id, whatsAppSent: true }),
    });
  };

  const handleMarkItemDelivered = async (li: LineItem) => {
    if (BIN_TRACKING_ENABLED) {
      const selections = binSelections[li.id] || [];
      const allFilled = selections.length === li.quantity && selections.every((b) => b);
      if (!allFilled) {
        setConfirmation({
          type: "error",
          title: "Bin Assignment Required",
          referenceId: shipment?.shipmentNo || "",
          items: [
            { label: "Product", value: li.productName },
            { label: "Units", value: `${li.quantity}` },
          ],
          details: `Please select a bin for all ${li.quantity} unit(s) before marking delivered.`,
        });
        return;
      }
    }
    setItemLoading(li.id);
    try {
      const binAllocations = getBinAllocations(li.id);
      const res = await fetch(`/api/inbound/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        // `warehouseId` on BOTH branches. The route's schema requires it now, so the bin
        // branch — dormant while BIN_TRACKING_ENABLED is false — would have 400'd the day
        // somebody switched bins on. Stock still lands in a warehouse; the bins are an extra
        // axis on top of it, not a replacement for one.
        body: JSON.stringify(
          BIN_TRACKING_ENABLED
            ? { lineItemId: li.id, deliveredQty: li.quantity, warehouseId: receiveLocation, binAllocations }
            : { lineItemId: li.id, deliveredQty: li.quantity, warehouseId: receiveLocation }
        ),
      }).then((r) => r.json());
      if (res.success) {
        setActionError("");
        setBinSelections((prev) => { const n = { ...prev }; delete n[li.id]; return n; });
        await refreshShipment();
        setConfirmation({
          type: "success",
          title: BIN_TRACKING_ENABLED ? "Item Received & Binned" : "Item Received",
          referenceId: shipment?.shipmentNo || "",
          items: [
            { label: "Product", value: li.productName },
            { label: "Quantity", value: `${li.quantity} units` },
            BIN_TRACKING_ENABLED
              ? { label: "Bin", value: bins.find(b => b.id === (binSelections[li.id]?.[0]))?.code || "Assigned" }
              : { label: "Location", value: warehouses.find((w) => w.id === receiveLocation)?.name ?? "—" },
          ],
          details: `Bill: ${shipment?.billNo}`,
        });
      } else {
        setActionError(res.error || `Failed to mark "${li.productName}" as delivered`);
      }
    } catch (e) { setActionError(e instanceof Error ? e.message : "Mark delivered failed"); }
    finally { setItemLoading(null); }
  };

  const handlePutaway = async () => {
    const items = Object.entries(binSelections)
      .filter(([lineItemId]) => {
        const li = shipment?.lineItems.find((l) => l.id === lineItemId);
        return li?.isDelivered && !li.binId;
      })
      .map(([lineItemId]) => ({
        lineItemId,
        binId: (binSelections[lineItemId] || [])[0] || "",
      }))
      .filter((i) => i.binId);

    if (items.length === 0) return;
    setPutawayLoading(true);
    try {
      const res = await fetch(`/api/inbound/${id}/putaway`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      }).then((r) => r.json());
      if (res.success) {
        setActionError("");
        setBinSelections({});
        await refreshShipment();
      } else {
        setActionError(res.error || "Putaway failed");
      }
    } catch (e) { setActionError(e instanceof Error ? e.message : "Putaway failed"); }
    finally { setPutawayLoading(false); }
  };

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
    try {
      const res = await fetch(`/api/inbound/${id}`, { method: "DELETE" }).then((r) => r.json());
      if (res.success) {
        router.push("/inbound");
      } else {
        setConfirmation({
          type: "error",
          title: "Cannot Delete",
          referenceId: shipment?.shipmentNo || "",
          details: res.error || "Cannot delete shipment",
        });
      }
    } catch (e) { setActionError(e instanceof Error ? e.message : "Delete failed"); }
    finally { setActionLoading(false); }
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

  // Render bin selectors for a line item (one per unit)
  const renderBinSelectors = (li: LineItem, variant: "default" | "amber" = "default") => {
    const qty = li.quantity;
    const selections = binSelections[li.id] || [];
    const borderClass = variant === "amber" ? "border-amber-200" : "border-slate-200";
    const bgClass = variant === "amber" ? "bg-amber-50" : "bg-white";

    if (qty === 1) {
      return (
        <select
          value={selections[0] || ""}
          onChange={(e) => setBinForUnit(li.id, 0, e.target.value, qty)}
          className={`mt-2 w-full text-xs border ${borderClass} rounded-lg px-2 py-1.5 ${bgClass} text-slate-700`}
        >
          <option value="">Select bin *</option>
          {bins.map((b) => (
            <option key={b.id} value={b.id}>{b.code} — {b.name} ({b.location})</option>
          ))}
        </select>
      );
    }

    // Multiple units — show "Apply to all" + per-unit selectors
    const allSame = selections.length > 0 && selections.every((b) => b && b === selections[0]);
    return (
      <div className="mt-2 space-y-1.5">
        {/* Apply to all shortcut */}
        <div className="flex items-center gap-2">
          <select
            value={allSame ? selections[0] : ""}
            onChange={(e) => { if (e.target.value) setBinForAll(li.id, e.target.value, qty); }}
            className={`flex-1 text-xs border ${borderClass} rounded-lg px-2 py-1.5 ${bgClass} text-slate-700`}
          >
            <option value="">Apply same bin to all {qty} units</option>
            {bins.map((b) => (
              <option key={b.id} value={b.id}>{b.code} — {b.name} ({b.location})</option>
            ))}
          </select>
        </div>
        {/* Per-unit selectors */}
        {Array.from({ length: qty }).map((_, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="text-xs text-slate-400 w-10 shrink-0">#{i + 1}</span>
            <select
              value={selections[i] || ""}
              onChange={(e) => setBinForUnit(li.id, i, e.target.value, qty)}
              className={`flex-1 text-xs border ${borderClass} rounded-lg px-2 py-1.5 ${bgClass} text-slate-700`}
            >
              <option value="">Select bin *</option>
              {bins.map((b) => (
                <option key={b.id} value={b.id}>{b.code} — {b.name} ({b.location})</option>
              ))}
            </select>
          </div>
        ))}
      </div>
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

  const putawayReady = Object.entries(binSelections).filter(([liId]) => {
    const li = shipment.lineItems.find((l) => l.id === liId);
    return li?.isDelivered && !li.binId;
  }).length;

  return (
    <div className="pb-4">
      <div className="flex items-center gap-2 mb-4">
        <Link href="/inbound" className="p-2 -ml-2 rounded-lg hover:bg-slate-100 focus-ring" aria-label="Back"><ArrowLeft className="h-5 w-5 text-slate-600" /></Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-bold text-slate-900 tabular-nums truncate">{shipment.shipmentNo}</h1>
          <p className="text-xs text-slate-500 tabular-nums truncate">{shipment.brand.name} | Bill: {shipment.billNo}</p>
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
              <span className="text-sm font-semibold text-green-600 tabular-nums">{formatDate(shipment.deliveredAt)}</span>
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
          {BIN_TRACKING_ENABLED && needsBinCount > 0 && (
            <div className="flex justify-between items-center">
              <span className="text-xs text-slate-500">Needs Bin</span>
              <Badge variant="warning" className="text-xs">{needsBinCount} item{needsBinCount > 1 ? "s" : ""}</Badge>
            </div>
          )}
          <div className="flex justify-between items-center">
            <span className="text-xs text-slate-500">Created by</span>
            <span className="text-xs text-slate-700 tabular-nums">{shipment.createdBy.name} on {formatDate(shipment.createdAt)}</span>
          </div>
          {shipment.approvedBy && (
            <div className="flex justify-between items-center">
              <span className="text-xs text-slate-500">Approved by</span>
              <span className="text-xs text-green-700 font-medium tabular-nums">{shipment.approvedBy.name} on {formatDate(shipment.approvedAt!)}</span>
            </div>
          )}
          {shipment.deliveredBy && (
            <div className="flex justify-between items-center">
              <span className="text-xs text-slate-500">Delivered by</span>
              <span className="text-xs text-slate-700">{shipment.deliveredBy.name}</span>
            </div>
          )}
          {shipment.putawayBy && (
            <div className="flex justify-between items-center">
              <span className="text-xs text-slate-500">Putaway by</span>
              <span className="text-xs text-slate-700">{shipment.putawayBy.name}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Approval Gate */}
      {!isApproved && shipment.status !== "DELIVERED" && (
        <div className="mb-3">
          {canApprove ? (
            <Button onClick={handleApprove} disabled={approveLoading}
              className="w-full min-h-[48px] rounded-lg font-medium bg-indigo-600 hover:bg-indigo-700" size="lg">
              <ShieldCheck className="h-4 w-4 mr-2" /> {approveLoading ? "Approving..." : "Approve Inward"}
            </Button>
          ) : (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-center">
              <ShieldCheck className="h-5 w-5 text-amber-500 mx-auto mb-1" />
              <p className="text-xs font-medium text-amber-800">Awaiting Approval</p>
              <p className="text-xs text-amber-600 mt-0.5">Supervisor or Accounts Manager must approve before delivery</p>
            </div>
          )}
        </div>
      )}

      {/* CATEGORY — saved on the shipment, and receiving is blocked until it is set.
          The four hardcoded buttons (Cycles / Spares / Accessories / Mixed) are gone: the
          value is a real Category row now, so the picker searches the actual tree instead of
          offering four labels that matched nothing in the database. */}
      {shipment.status !== "DELIVERED" && (
        !shipment.category || changingCategory ? (
          <div className="mb-3 bg-blue-50 border border-blue-200 rounded-xl p-4">
            <p className="text-sm font-semibold text-blue-900 mb-0.5">Which category is this shipment?</p>
            <p className="text-xs text-blue-600 mb-3">
              Choose it before receiving. It cannot be changed once the first item is received.
            </p>
            <SearchableSelect
              options={categories}
              value={shipment.category?.id ?? null}
              onChange={handleCategorySelect}
              placeholder="Search categories…"
              emptyText="No matching category"
              disabled={savingCategory}
            />
            {changingCategory && (
              <button
                onClick={() => setChangingCategory(false)}
                className="mt-2 text-xs text-slate-500 underline min-h-[44px]"
              >
                Cancel
              </button>
            )}
          </div>
        ) : (
          <div className="mb-3 flex items-center justify-between bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-xs text-slate-500 shrink-0">Category:</span>
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-200 text-slate-700 truncate">
                {shipment.category.parent ? `${shipment.category.parent.name} › ` : ""}
                {shipment.category.name}
              </span>
            </div>
            {/* Only until the first receipt — after that the API refuses, so offering the
                button would be a promise the server does not keep. */}
            {canDeliver && !shipment.lineItems.some((li) => li.isDelivered) && (
              <button onClick={() => setChangingCategory(true)} className="text-xs text-slate-400 underline shrink-0 ml-2">
                Change
              </button>
            )}
          </div>
        )
      )}

      {/* Location selector (bins dormant) — where this shipment is received */}
      {!BIN_TRACKING_ENABLED && canDeliver && isApproved && (shipment.status === "IN_TRANSIT" || shipment.status === "PARTIALLY_DELIVERED") && shipment.categoryId && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 mb-3">
          <p className="text-xs font-medium text-blue-800 mb-1.5 flex items-center gap-1.5">
            <MapPin className="h-3.5 w-3.5" /> Receive into
          </p>
          <div className="grid grid-cols-2 gap-2">
            {warehouses.map((loc) => (
              <button
                key={loc.id}
                onClick={() => setReceiveLocation(loc.id)}
                className={`py-2.5 rounded-lg text-sm font-semibold border transition-colors ${
                  receiveLocation === loc.id
                    ? "bg-blue-600 text-white border-blue-600"
                    : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                }`}
              >
                {loc.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Mark All Delivered / Partial / Undo are GONE (R3, D6).
          They wrote a shipment STATUS directly through api/inbound/[id]/status without
          touching a single line item, so a shipment could read DELIVERED while every line
          was still unreceived and no stock had moved. Receiving is per line now, and the
          shipment finishes itself when the last outstanding line is received — the state is
          derived from the lines rather than asserted over them. */}

      {/* Post-delivery Putaway */}
      {BIN_TRACKING_ENABLED && canDeliver && isApproved && needsBinCount > 0 && shipment.status === "DELIVERED" && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-3">
          <p className="text-xs text-amber-800 font-medium mb-1 flex items-center gap-1.5">
            <MapPin className="h-3.5 w-3.5" /> {needsBinCount} item{needsBinCount > 1 ? "s" : ""} need bin assignment
          </p>
          <p className="text-xs text-amber-600 mb-2">Select bins below, then save.</p>
          {putawayReady > 0 && (
            <Button onClick={handlePutaway} disabled={putawayLoading} size="sm"
              className="w-full bg-amber-600 hover:bg-amber-700">
              <Save className="h-3.5 w-3.5 mr-1.5" />
              {putawayLoading ? "Saving..." : `Save Bin Assignment (${putawayReady})`}
            </Button>
          )}
        </div>
      )}

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
          { label: "Brand", value: shipment?.brand.name || "" },
        ]}
        details="All items received and stock updated"
      />

      {/* Select All — apply one bin to ALL undelivered items */}
      {BIN_TRACKING_ENABLED && canDeliver && isApproved && (shipment.status === "IN_TRANSIT" || shipment.status === "PARTIALLY_DELIVERED") && bins.length > 0 && shipment.categoryId && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 mb-3">
          <p className="text-xs font-medium text-blue-800 mb-1.5">Apply same bin to all items</p>
          <select
            onChange={(e) => {
              if (!e.target.value) return;
              const binId = e.target.value;
              const undelivered = shipment.lineItems.filter((li) => !li.isDelivered);
              const newSelections = { ...binSelections };
              for (const li of undelivered) {
                newSelections[li.id] = new Array(li.quantity).fill(binId);
              }
              setBinSelections(newSelections);
              e.target.value = "";
            }}
            className="w-full text-xs border border-blue-200 rounded-lg px-2 py-1.5 bg-white text-slate-700"
          >
            <option value="">Select bin for all items...</option>
            {bins.map((b) => (
              <option key={b.id} value={b.id}>{b.code} — {b.name} ({b.location})</option>
            ))}
          </select>
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
              {BIN_TRACKING_ENABLED && li.bin && (
                <div className="flex items-center gap-1.5 mt-1.5 text-xs text-indigo-600">
                  <MapPin className="h-3 w-3" /> {li.bin.code} — {li.bin.name} ({li.bin.location})
                </div>
              )}

              {/* Bin mode: selectors for undelivered items (during partial delivery) */}
              {BIN_TRACKING_ENABLED && canDeliver && shipment.status === "PARTIALLY_DELIVERED" && !li.isDelivered && bins.length > 0 && shipment.categoryId && (
                <div>
                  {renderBinSelectors(li)}
                  <button
                    onClick={() => handleMarkItemDelivered(li)}
                    disabled={itemLoading === li.id}
                    className="mt-2 w-full py-2.5 h-10 rounded-lg bg-green-50 text-green-700 text-xs font-medium border border-green-200 hover:bg-green-100 disabled:opacity-50"
                  >
                    {itemLoading === li.id ? "Marking..." : `Mark Delivered (Qty: ${li.quantity})`}
                  </button>
                </div>
              )}

              {/* RECEIVE THIS LINE.
                  Shown from IN_TRANSIT onwards, not only during PARTIALLY_DELIVERED — the
                  old button appeared only after somebody had pressed "Partial", so on a fresh
                  shipment there was no way to receive a single line at all. Four conditions,
                  all of which the API re-checks: permission, approved, category chosen, and
                  the shipment not already finished. */}
              {!BIN_TRACKING_ENABLED && canDeliver && isApproved && shipment.categoryId
                && shipment.status !== "DELIVERED" && !li.isDelivered && (
                <button
                  onClick={() => setConfirmReceive(li)}
                  disabled={receivingLineId === li.id}
                  className="mt-2 w-full min-h-[44px] rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 focus-ring"
                >
                  {receivingLineId === li.id ? "Receiving…" : `Receive ×${li.quantity}`}
                </button>
              )}

              {/* Received. Green and final — undoing a receipt is a stock correction, not a
                  button, which is why the old Undo went with api/inbound/[id]/status. */}
              {!BIN_TRACKING_ENABLED && li.isDelivered && (
                <div className="mt-2 w-full min-h-[44px] flex items-center justify-center rounded-lg bg-green-50 text-green-700 text-sm font-semibold border border-green-200">
                  Received ×{li.deliveredQty ?? li.quantity} ✓
                </div>
              )}

              {/* Bin mode: selectors for IN_TRANSIT items (pre-select before Mark All Delivered) */}
              {BIN_TRACKING_ENABLED && canDeliver && shipment.status === "IN_TRANSIT" && bins.length > 0 && shipment.categoryId && (
                renderBinSelectors(li)
              )}

              {/* Bin mode: post-delivery bin assignment (delivered but no bin) */}
              {BIN_TRACKING_ENABLED && canDeliver && li.isDelivered && !li.binId && bins.length > 0 && (
                renderBinSelectors(li, "amber")
              )}

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

      {/* RECEIVE CONFIRMATION.
          Receiving adds stock to a warehouse, and the goods desk is a phone in someone's hand
          — a mis-tap should not silently move inventory. It names the product, the quantity
          and the destination, because "into which building" is the part that is easy to get
          wrong and impossible to see afterwards. */}
      {confirmReceive && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-4">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-md p-5 space-y-4">
            <h3 className="text-base font-bold text-slate-900">Receive this item?</h3>
            <p className="text-sm text-slate-600">
              {confirmReceive.productName} — <span className="font-semibold tabular-nums">×{confirmReceive.quantity}</span>
              {" into "}
              <span className="font-semibold">
                {warehouses.find((w) => w.id === receiveLocation)?.name ?? "the selected warehouse"}
              </span>
              .
            </p>
            <p className="text-[11px] text-slate-500">
              Short or damaged? Cancel and use Report Issue instead — receiving records the full
              billed quantity.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmReceive(null)}
                className="flex-1 min-h-[48px] rounded-lg border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={() => handleReceiveLine(confirmReceive)}
                disabled={receivingLineId === confirmReceive.id}
                className="flex-1 min-h-[48px] rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                {receivingLineId === confirmReceive.id ? "Receiving…" : "Receive"}
              </button>
            </div>
          </div>
        </div>
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
