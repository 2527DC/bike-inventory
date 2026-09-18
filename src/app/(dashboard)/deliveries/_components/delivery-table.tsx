"use client";

// Desktop table for /deliveries (lg and up). Mobile renders DeliveryCard instead; both apply the
// same Dummy rule (plan 1609 A41c, T2): a red badge, and no action but delete.

import Link from "next/link";
import { Loader2, Trash2, CalendarClock, Footprints, PackagePlus } from "lucide-react";
import { getAging, AGING_BADGE } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { getStatusColor, getStatusLabel } from "@/lib/status-colors";
import { DesktopTable } from "@/components/desktop-table";
import { isDummyDelivery, ZoneBadge, type DeliveryItem } from "./delivery-card";
import { PriorityStar } from "../[id]/_components/priority-star";

interface DeliveryTableProps {
  deliveries: DeliveryItem[];
  isAdmin: boolean;
  deleting: string | null;
  prebooking: string | null;
  onDelete: (id: string) => void;
  onPrebook: (delivery: DeliveryItem) => void;
  onMarkReady: (id: string) => void;
  /** `delivery_priority.edit` (plan 1709, R19, Q21). Cosmetic — the route re-checks. */
  canStar?: boolean;
  onStarChanged?: () => void;
}

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });

export function DeliveryTable({ deliveries, isAdmin, deleting, prebooking, onDelete, onPrebook, onMarkReady, canStar = false, onStarChanged }: DeliveryTableProps) {
  return (
    <DesktopTable
      className="hidden lg:block"
      rows={deliveries}
      rowKey={(d) => d.id}
      rowHref={(d) => `/deliveries/${d.id}`}
      emptyText="No deliveries found"
      columns={[
        // ★ in its own narrow column, so the eye finds the priority jobs down one line.
        ...(canStar || deliveries.some((d) => d.priorityAt)
          ? [
              {
                header: "",
                className: "w-10",
                cell: (d: DeliveryItem) => (
                  <PriorityStar
                    deliveryId={d.id}
                    priorityAt={d.priorityAt ?? null}
                    canEdit={canStar && !isDummyDelivery(d)}
                    onChanged={() => onStarChanged?.()}
                  />
                ),
              },
            ]
          : []),
        { header: "Invoice", cell: (d) => (
          <div>
            <div className="flex items-center gap-1.5">
              <span className="font-medium text-slate-900">{d.invoiceNo}</span>
              {isDummyDelivery(d)
                ? <Badge variant="danger" className="text-[9px]" title="No floor warehouse matched this invoice number">Dummy</Badge>
                : <ZoneBadge zone={d.deliveryZone} className="text-[9px]" />}
              {d.reversePickup && <Badge variant="info" className="text-[9px]">Reverse</Badge>}
            </div>
            {!isDummyDelivery(d) && d.warehouse && <p className="text-[11px] text-slate-400">{d.warehouse.name}</p>}
          </div>
        ) },
        { header: "Customer", cell: (d) => (
          <div>
            <p className="text-slate-800">{d.customerName}</p>
            {d.customerArea && <p className="text-[11px] text-slate-400">{d.customerArea}</p>}
          </div>
        ) },
        { header: "Items", cell: (d) => {
          const items = d.lineItems || [];
          const text = items.map((i) => `${i.name}${i.quantity > 1 ? ` x${i.quantity}` : ""}`).join(", ");
          return <span className="text-slate-500 line-clamp-1 max-w-[20rem] inline-block align-middle">{text || "—"}</span>;
        } },
        { header: "Amount", cell: (d) => <span className="tabular-nums">{inr.format(d.invoiceAmount)}</span>, className: "text-right whitespace-nowrap" },
        { header: "Date", cell: (d) => new Date(d.invoiceDate).toLocaleDateString("en-IN"), className: "whitespace-nowrap text-slate-500" },
        { header: "Status", cell: (d) => {
          const isPending = ["PENDING", "VERIFIED", "SCHEDULED"].includes(d.status);
          const aging = isPending ? getAging(d.invoiceDate) : null;
          return (
            <div className="flex items-center gap-1.5">
              <Badge className={`text-[10px] ${getStatusColor(d.status)}`}>{getStatusLabel(d.status)}</Badge>
              {aging && aging.level !== "ok" && <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded-full ${AGING_BADGE[aging.level]}`}>{aging.text}</span>}
            </div>
          );
        } },
        { header: "", className: "text-right", cell: (d) => {
          const isDummy = isDummyDelivery(d);
          return (
            <div className="flex items-center justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
              {/* Icon-only actions; the name is the tooltip and the accessible label. */}
              {!isDummy && d.status === "PENDING" && (
                <>
                  <Link href={`/deliveries/${d.id}`} title="Schedule" aria-label="Schedule" className="flex items-center justify-center h-8 w-8 rounded-md bg-blue-600 text-white"><CalendarClock className="h-4 w-4" /></Link>
                  <Link href={`/deliveries/${d.id}/walkout`} title="Walk-out" aria-label="Walk-out" className="flex items-center justify-center h-8 w-8 rounded-md bg-green-600 text-white"><Footprints className="h-4 w-4" /></Link>
                  <button onClick={() => onPrebook(d)} disabled={prebooking === d.id} title="Pre-book" aria-label="Pre-book" className="flex items-center justify-center h-8 w-8 rounded-md bg-purple-600 text-white disabled:opacity-50">{prebooking === d.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackagePlus className="h-4 w-4" />}</button>
                </>
              )}
              {!isDummy && d.status === "SCHEDULED" && <Link href="/deliveries/dispatch"><button className="px-2 py-1 rounded-md bg-orange-600 text-white text-xs font-medium">Dispatch</button></Link>}
              {!isDummy && d.status === "PREBOOKED" && <button onClick={() => onMarkReady(d.id)} className="px-2 py-1 rounded-md bg-blue-600 text-white text-xs font-medium">Mark Ready</button>}
              {isAdmin && <button onClick={() => onDelete(d.id)} disabled={deleting === d.id} title="Delete" aria-label="Delete" className="p-1.5 rounded-md bg-slate-100 text-slate-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-50">{deleting === d.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}</button>}
            </div>
          );
        } },
      ]}
    />
  );
}
