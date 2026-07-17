"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Trash2, Package, AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { getAging, AGING_BADGE } from "@/lib/utils";
import { getStatusColor, getStatusLabel } from "@/lib/status-colors";

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
  reversePickup: boolean;
  invoiceType: string | null;
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
          </div>
          <div className="text-right space-y-1">
            <Badge className={`text-xs ${getStatusColor(d.status)}`}>
              {getStatusLabel(d.status)}
            </Badge>
            {d.isOutstation && (
              <Badge variant={"warning"} className="text-xs">
                Outstation
              </Badge>
            )}
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

        {/* Action buttons */}
        <div className="flex gap-2 mt-1" onClick={(e) => e.stopPropagation()}>
          {d.status === "PENDING" && (
            <>
              <Link href={`/deliveries/${d.id}`} className="flex-1">
                <button className="w-full bg-blue-600 text-white py-2 rounded-md text-xs font-medium">
                  Schedule
                </button>
              </Link>
              <Link href={`/deliveries/${d.id}?action=walkout`} className="flex-1">
                <button className="w-full bg-green-600 text-white py-2 rounded-md text-xs font-medium">
                  Walk-out
                </button>
              </Link>
              <button
                onClick={() => onPrebook(d)}
                disabled={prebooking === d.id}
                className="flex-1 flex items-center justify-center gap-1 bg-purple-600 text-white py-2 rounded-md text-xs font-medium disabled:opacity-50"
              >
                {prebooking === d.id ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Package className="h-3 w-3" />
                )}{" "}
                Pre-book
              </button>
            </>
          )}
          {d.status === "SCHEDULED" && (
            <Link href="/deliveries/dispatch" className="flex-1">
              <button className="w-full bg-orange-600 text-white py-2 rounded-md text-xs font-medium">
                Go to Dispatch
              </button>
            </Link>
          )}
          {d.status === "PREBOOKED" && (
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
              className="bg-slate-100 text-slate-500 px-2 py-2 rounded-md text-xs hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
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
