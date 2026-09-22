// The shared contract between the /transfers table (PC) and the compact card (phone) — plan
// 2209-transfers-list-table-and-cards. Both render the SAME order with the SAME labels, colours
// and actions; everything they must agree on lives here so the two layouts cannot drift.

import { CheckCircle2, Clock, Truck, Undo2, XCircle } from "lucide-react";
import { getStatusColor, getStatusLabel } from "@/lib/status-colors";
import { Badge } from "@/components/ui/badge";

export interface TransferOrderItem {
  id: string;
  quantity: number;
  product: { name: string; sku: string; currentStock: number };
  fromBin: { code: string; name: string; location: string } | null;
  toBin: { code: string; name: string; location: string } | null;
  fromWarehouse: { id: string; code: string; name: string } | null;
  toWarehouse: { id: string; code: string; name: string } | null;
}

export interface TransferOrder {
  id: string;
  orderNo: string;
  // IN_TRANSIT and RECEIVED were added to the TransferOrderStatus enum by MIG-1a. No code
  // writes them until P14, but this union is hand-written over an API response and `tsc`
  // cannot check it against the enum — so a status it does not list would arrive as a value
  // TypeScript insists is impossible, and the accent/badge below would fall through to the
  // "unknown" branch. Listing them now is what makes that impossible.
  // RETURNED joined them in plan 1709 (R25) and is what Reject writes now; REJECTED stays for
  // the rows written before it.
  status: "PENDING" | "APPROVED" | "RETURNED" | "REJECTED" | "CANCELLED" | "IN_TRANSIT" | "RECEIVED";
  notes: string | null;
  rejectionNote: string | null;
  createdAt: string;
  createdBy: { name: string };
  reviewedBy: { name: string } | null;
  reviewedAt: string | null;
  items: TransferOrderItem[];
  _count: { items: number };
  // The lane lives on the HEADER from P14 onward — one route per order, not one per line.
  // Nullable because an order raised before MIG-2, or one whose items genuinely disagreed
  // about the lane, has no header route and falls back to its first item.
  fromWarehouse: { id: string; code: string; name: string; store: { name: string } } | null;
  toWarehouse: { id: string; code: string; name: string; store: { name: string } } | null;
  requiredDocType: "DELIVERY_CHALLAN" | "TAX_INVOICE" | null;
  docUrl: string | null;
}

// Display label for an endpoint: bin code in bin mode, location name in location mode.
export function endpointLabel(bin: { code: string } | null, loc: string | null): string {
  if (bin) return bin.code;
  if (loc) return loc;
  return "—";
}

/**
 * The route From → To. The header warehouses when the order has them; otherwise the first
 * item's endpoints, which is what the old card showed per line for an order with no header lane.
 */
export function routeLabel(order: TransferOrder): { from: string; to: string } {
  if (order.fromWarehouse || order.toWarehouse) {
    return { from: order.fromWarehouse?.name ?? "—", to: order.toWarehouse?.name ?? "—" };
  }
  const first = order.items[0];
  if (!first) return { from: "—", to: "—" };
  return {
    from: endpointLabel(first.fromBin, first.fromWarehouse?.name ?? null),
    to: endpointLabel(first.toBin, first.toWarehouse?.name ?? null),
  };
}

/** "3 items" and "Hero Kids 20T +2 more" — the preview that replaced the in-list expand (Q3a). */
export function itemsSummary(order: TransferOrder): { count: string; preview: string | null } {
  const n = order._count.items;
  const count = `${n} item${n !== 1 ? "s" : ""}`;
  const first = order.items[0]?.product.name;
  if (!first) return { count, preview: null };
  return { count, preview: n > 1 ? `${first} +${n - 1} more` : first };
}

export function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN");
}

/** The sent-back / rejection note, with its label and colour — or null when there is none. */
export function reviewNote(order: TransferOrder): { label: string; text: string; tone: string } | null {
  if (!order.rejectionNote) return null;
  return order.status === "RETURNED"
    ? { label: "Sent back", text: order.rejectionNote, tone: "text-orange-600" }
    : { label: "Rejected", text: order.rejectionNote, tone: "text-red-500" };
}

export function StatusBadge({ status }: { status: string }) {
  // IN_TRANSIT gets a truck rather than a clock: "waiting for a decision" and "on a van"
  // are different situations and looked identical before. CANCELLED had no icon at all.
  // RETURNED gets an arrow: it is not a refusal, it is work coming back to somebody.
  const icon = status === "APPROVED" || status === "RECEIVED" ? <CheckCircle2 className="h-3 w-3 mr-0.5" />
    : status === "IN_TRANSIT" ? <Truck className="h-3 w-3 mr-0.5" />
    : status === "PENDING" ? <Clock className="h-3 w-3 mr-0.5" />
    : status === "RETURNED" ? <Undo2 className="h-3 w-3 mr-0.5" />
    : status === "REJECTED" || status === "CANCELLED" ? <XCircle className="h-3 w-3 mr-0.5" />
    : null;
  // RETURNED has no entry in the shared colour map (it would be a second opinion about a
  // status other modules render too), so it is coloured here: orange for "back with you".
  const cls = status === "RETURNED"
    ? "bg-orange-100 text-orange-700 border-orange-200"
    : getStatusColor(status);
  return <Badge className={`text-xs whitespace-nowrap ${cls}`}>{icon}{getStatusLabel(status)}</Badge>;
}

/** The left colour edge on a card, and the left edge of the first cell in a table row. */
export function transferAccent(status: TransferOrder["status"]) {
  if (status === "APPROVED" || status === "RECEIVED") return "border-l-green-500";
  if (status === "REJECTED") return "border-l-red-500";
  if (status === "RETURNED") return "border-l-orange-400";
  if (status === "PENDING" || status === "IN_TRANSIT") return "border-l-amber-400";
  return "border-l-slate-200";
}

/**
 * Everything a row or card needs besides the order itself. The page owns the state; the
 * layouts only render and call back. `approvingId` disables the actions of the order in flight.
 */
export interface TransferRowContext {
  canApprove: boolean;
  approvingId: string | null;
  onApprove: (order: TransferOrder) => void;
  onReject: (order: TransferOrder) => void;
  /** Where a row/card opens: `/transfers/[id]`. */
  hrefFor: (order: TransferOrder) => string;
}

/** Approve / Reject are offered only to `transfers.approve` holders, and only on PENDING. */
export function showReview(order: TransferOrder, ctx: TransferRowContext) {
  return ctx.canApprove && order.status === "PENDING";
}
