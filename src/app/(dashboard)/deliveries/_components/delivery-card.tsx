"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Trash2, PackagePlus, CalendarClock, Footprints, AlertTriangle, Warehouse } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { getAging, AGING_BADGE } from "@/lib/utils";
import { getStatusColor, getStatusLabel } from "@/lib/status-colors";
import { zoneLabel, type DeliveryZoneValue } from "@/lib/deliveries/zone";

interface DeliveryItem {
  id: string;
  invoiceNo: string;
  invoiceDate: string;
  invoiceAmount: number;
  customerName: string;
  customerPhone: string | null;
  customerArea: string | null;
  status: string;
  scheduledDate: string | null;
  lineItems: Array<{ name: string; quantity: number; rate?: number }> | null;
  flagReason: string | null;
  prebookNotes: string | null;
  verifiedBy: { name: string } | null;
  salesPerson: string | null;
  isOutstation: boolean;
  /** Bangalore / Outstation / null = not chosen (plan 1609 A22). The tag reads this, not isOutstation. */
  deliveryZone: DeliveryZoneValue | null;
  reversePickup: boolean;
  invoiceType: string | null;
  /** The matched FLOOR warehouse (plan 1609 §1.4); null on a Dummy and on old closed rows. */
  warehouse: { id: string; name: string } | null;
}

/**
 * Dummy = an open delivery whose invoice number matched no floor warehouse (plan 1609 T2).
 * The list API does not send the flag, so it is derived here the same way the server does.
 */
function isDummyDelivery(d: Pick<DeliveryItem, "warehouse" | "status">) {
  return !d.warehouse && !["DELIVERED", "WALK_OUT"].includes(d.status);
}

const ZONE_BADGE_VARIANT = {
  Bangalore: "info", // blue
  Outstation: "warning", // amber, as the old Outstation badge
  "Not set": "default", // slate
} as const satisfies Record<ReturnType<typeof zoneLabel>, string>;

/**
 * Bangalore / Outstation / Not set tag — on /deliveries only, mobile cards and desktop table
 * (plan 1609 A23). Callers skip it on a Dummy: the Dummy badge already says enough.
 */
function ZoneBadge({ zone, className = "" }: { zone: DeliveryZoneValue | null; className?: string }) {
  const label = zoneLabel(zone);
  return (
    <Badge
      variant={ZONE_BADGE_VARIANT[label]}
      className={className}
      title={label === "Not set" ? "The customer has not chosen Bangalore or outside Bangalore yet" : undefined}
    >
      {label}
    </Badge>
  );
}

interface DeliveryCardProps {
  delivery: DeliveryItem;
  onDelete: (id: string) => void;
  onPrebook: (delivery: DeliveryItem) => void;
  onMarkReady: (id: string) => void;
  isAdmin: boolean;
  deleting: string | null;
  prebooking: string | null;
}

function formatINR(n: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);
}

export function DeliveryCard({
  delivery: d,
  onDelete,
  onPrebook,
  onMarkReady,
  isAdmin,
  deleting,
  prebooking,
}: DeliveryCardProps) {
  const router = useRouter();
  const isDummy = isDummyDelivery(d);
  const items = d.lineItems || [];
  const isPending = ["PENDING", "VERIFIED", "SCHEDULED"].includes(d.status);
  const aging = isPending ? getAging(d.invoiceDate) : null;
  const accent =
    (aging && (aging.level === "critical" || aging.level === "danger")) || d.status === "FLAGGED"
      ? "border-l-red-500"
      : d.status === "PENDING"
      ? "border-l-amber-400"
      : d.status === "VERIFIED" || d.status === "SCHEDULED" || d.status === "OUT_FOR_DELIVERY"
      ? "border-l-blue-400"
      : d.status === "DELIVERED" || d.status === "WALK_OUT"
      ? "border-l-green-500"
      : "border-l-slate-200";

  return (
    <div
      className={`block rounded-xl border border-slate-200 border-l-4 ${accent} bg-white shadow-sm transition-colors active:bg-slate-50 focus-ring cursor-pointer`}
      onClick={() => router.push(`/deliveries/${d.id}`)}
    >
      <div className="p-3.5">
        <div className="flex items-start justify-between mb-1.5">
          <div className="flex-1 min-w-0 mr-2">
            <p className="text-base font-semibold text-slate-900 tabular-nums">{d.invoiceNo}</p>
            <p className="text-sm font-medium text-slate-600">{d.customerName}</p>
            {items.length > 0 && (
              <p className="text-xs text-slate-700 font-medium mt-0.5">
                {items.map((item, i) => (
                  <span key={i}>
                    {item.name}
                    {item.quantity > 1 ? ` x${item.quantity}` : ""}
                    {i < items.length - 1 ? ", " : ""}
                  </span>
                ))}
              </p>
            )}
            {d.salesPerson && (
              <p className="text-xs text-purple-600">Sales: {d.salesPerson}</p>
            )}
            <p className="text-xs text-slate-400 tabular-nums">
              {formatINR(d.invoiceAmount)} |{" "}
              {new Date(d.invoiceDate).toLocaleDateString("en-IN")}
            </p>
            {!isDummy && d.warehouse && (
              <p className="text-[11px] text-slate-400 truncate flex items-center gap-1">
                <Warehouse className="h-3 w-3 shrink-0" /> {d.warehouse.name}
              </p>
            )}
          </div>
          <div className="text-right space-y-1">
            {isDummy && (
              <Badge variant="danger" className="text-xs mr-1" title="No floor warehouse matched this invoice number">
                Dummy
              </Badge>
            )}
            <Badge className={`text-xs ${getStatusColor(d.status)}`}>
              {getStatusLabel(d.status)}
            </Badge>
            {!isDummy && <ZoneBadge zone={d.deliveryZone} className="text-xs" />}
            {d.reversePickup && (
              <Badge variant={"info"} className="text-xs">
                Reverse
              </Badge>
            )}
            {aging && aging.level !== "ok" && (
              <span
                className={`block text-xs font-medium px-1.5 py-0.5 rounded-full ${AGING_BADGE[aging.level]}`}
              >
                {aging.text}
              </span>
            )}
          </div>
        </div>

        {/* Scheduled date (read-only) */}
        {d.scheduledDate && (
          <p className="text-xs text-blue-600 mb-1.5 tabular-nums">
            Delivery: {new Date(d.scheduledDate).toLocaleDateString("en-IN")}
            {d.customerArea && ` | ${d.customerArea}`}
          </p>
        )}

        {/* Flag reason */}
        {d.status === "FLAGGED" && d.flagReason && (
          <div className="bg-red-50 rounded p-1.5 mb-1.5">
            <p className="text-xs text-red-600">
              <AlertTriangle className="h-3 w-3 inline mr-1" />
              {d.flagReason}
            </p>
          </div>
        )}

        {/* Action buttons. A Dummy gets none except delete (plan 1609 A41c, T2). */}
        <div className="flex gap-2 mt-1" onClick={(e) => e.stopPropagation()}>
          {/* Icon-only actions; the name is the tooltip and the accessible label. */}
          {!isDummy && d.status === "PENDING" && (
            <>
              <Link
                href={`/deliveries/${d.id}`}
                title="Schedule"
                aria-label="Schedule"
                className="flex items-center justify-center h-10 w-11 rounded-md bg-blue-600 text-white"
              >
                <CalendarClock className="h-4 w-4" />
              </Link>
              <Link
                href={`/deliveries/${d.id}/walkout`}
                title="Walk-out"
                aria-label="Walk-out"
                className="flex items-center justify-center h-10 w-11 rounded-md bg-green-600 text-white"
              >
                <Footprints className="h-4 w-4" />
              </Link>
              <button
                onClick={() => onPrebook(d)}
                disabled={prebooking === d.id}
                title="Pre-book"
                aria-label="Pre-book"
                className="flex items-center justify-center h-10 w-11 rounded-md bg-purple-600 text-white disabled:opacity-50"
              >
                {prebooking === d.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <PackagePlus className="h-4 w-4" />
                )}
              </button>
            </>
          )}
          {!isDummy && d.status === "SCHEDULED" && (
            <Link href="/deliveries/dispatch" className="flex-1">
              <button className="w-full bg-orange-600 text-white py-2 rounded-md text-xs font-medium">
                Go to Dispatch
              </button>
            </Link>
          )}
          {!isDummy && d.status === "PREBOOKED" && (
            <button
              onClick={() => onMarkReady(d.id)}
              className="flex-1 bg-blue-600 text-white py-2 rounded-md text-xs font-medium"
            >
              Mark Ready
            </button>
          )}
          {isAdmin && (
            <button
              onClick={() => onDelete(d.id)}
              disabled={deleting === d.id}
              title="Delete"
              aria-label="Delete"
              className="ml-auto bg-slate-100 text-slate-500 px-2 py-2 rounded-md text-xs hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
            >
              {deleting === d.id ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Trash2 className="h-3 w-3" />
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export type { DeliveryItem };
export { isDummyDelivery, ZoneBadge };
