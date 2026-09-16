"use client";

// The top of the one-screen delivery detail (plan 1609 R23, R26, R28, A25, A31, A32): what was
// invoiced, paid and still owed, when it goes, where, and from which floor. Replaces the old
// "Payment Pending" strip, which only appeared when something was owed.

import type { ReactNode } from "react";
import Link from "next/link";
import { CalendarDays, IndianRupee, MapPin, Warehouse } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { zoneLabel } from "@/lib/deliveries/zone";
import { DeliveryData, HOLD_STATUSES, formatINR } from "./types";

interface SummaryCardProps {
  data: DeliveryData;
  /** The walk-out screen needs only the money; the schedule, zone and floor rows are left out. */
  paymentOnly?: boolean;
}

/** "partially_paid" / "PARTIALLY_PAID" → "Partially paid". */
export function humanisePaymentStatus(status: string): string {
  const words = status.trim().toLowerCase().replace(/[_-]+/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const IST = "Asia/Kolkata";

/** "Thu 18 Sep, 6 PM" in IST; the time is left off when the date is a whole day (IST midnight). */
export function formatScheduled(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const parts = new Intl.DateTimeFormat("en-US", { weekday: "short", day: "numeric", month: "short", timeZone: IST })
    .formatToParts(d)
    .reduce<Record<string, string>>((acc, p) => ({ ...acc, [p.type]: p.value }), {});
  const day = `${parts.weekday} ${parts.day} ${parts.month}`;

  const time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: IST })
    .format(d);
  if (time === "00:00") return day;
  const [h, m] = time.split(":").map(Number);
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${day}, ${hour12}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h < 12 ? "AM" : "PM"}`;
}

function Row({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 min-w-0">
      <span className="text-slate-400 mt-0.5 shrink-0">{icon}</span>
      <span className="text-xs text-slate-500 w-20 shrink-0">{label}</span>
      <span className="text-xs font-medium text-slate-900 min-w-0 break-words">{children}</span>
    </div>
  );
}

function PaymentBlock({ data }: { data: DeliveryData }) {
  const p = data.payment;
  if (!p) {
    return (
      <div className="space-y-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-xs text-slate-500">Invoice amount</span>
          <span className="text-sm font-semibold text-slate-900 tabular-nums">{formatINR(data.invoiceAmount)}</span>
        </div>
        <p className="text-xs text-slate-500">Payment: not available</p>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="grid grid-cols-3 gap-2">
        <div className="min-w-0">
          <p className="text-[11px] text-slate-500">Invoice</p>
          <p className="text-sm font-semibold text-slate-900 tabular-nums truncate" title={formatINR(data.invoiceAmount)}>
            {formatINR(data.invoiceAmount)}
          </p>
        </div>
        <div className="min-w-0">
          <p className="text-[11px] text-slate-500">Paid</p>
          <p className="text-sm font-semibold text-green-700 tabular-nums truncate" title={formatINR(p.paid)}>
            {formatINR(p.paid)}
          </p>
        </div>
        <div className="min-w-0">
          <p className="text-[11px] text-slate-500">Balance</p>
          <p
            className={`text-sm font-semibold tabular-nums truncate ${p.hasPending ? "text-red-600" : "text-slate-900"}`}
            title={formatINR(p.balance)}
          >
            {formatINR(p.balance)}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
        <span className={`inline-flex items-center gap-1 font-semibold ${p.hasPending ? "text-red-700" : "text-green-700"}`}>
          <IndianRupee className="h-3 w-3" />
          {p.status ? humanisePaymentStatus(p.status) : p.hasPending ? "Balance due" : "Paid"}
        </span>
        <span className="text-slate-400">
          {p.source === "receivables" ? "from receivables" : "from Zoho at import"}
        </span>
        {p.source === "receivables" && (
          <Link href="/receivables" className="text-blue-600 underline ml-auto">
            View
          </Link>
        )}
      </div>
    </div>
  );
}

function scheduleText(data: DeliveryData): { text: string; note: string | null } {
  if (data.scheduledDate) {
    return { text: formatScheduled(data.scheduledDate), note: data.selfFillCompletedAt ? "chosen by customer" : null };
  }
  // Scheduled (or further along) without a day: staff schedule without one (A28) and an
  // outstation customer's submit carries none (A27b).
  if (HOLD_STATUSES.includes(data.status)) return { text: "Date to be confirmed", note: null };
  return { text: "Not scheduled", note: null };
}

export function SummaryCard({ data, paymentOnly = false }: SummaryCardProps) {
  const schedule = scheduleText(data);

  return (
    <Card className={`mb-3 ${data.payment?.hasPending ? "border-red-200" : ""}`}>
      <CardContent className="p-3 space-y-3">
        <PaymentBlock data={data} />

        {!paymentOnly && (
          <div className="space-y-1.5 border-t border-slate-100 pt-2.5">
            <Row icon={<CalendarDays className="h-3.5 w-3.5" />} label="Delivery">
              <span className={data.scheduledDate ? "tabular-nums" : "text-slate-500"}>{schedule.text}</span>
              {schedule.note && <span className="ml-1.5 text-[11px] font-normal text-blue-600">{schedule.note}</span>}
            </Row>
            <Row icon={<MapPin className="h-3.5 w-3.5" />} label="Zone">
              <span className={data.deliveryZone ? "" : "text-slate-500"}>{zoneLabel(data.deliveryZone)}</span>
            </Row>
            <Row icon={<Warehouse className="h-3.5 w-3.5" />} label="Floor">
              {data.isDummy ? (
                <span className="text-red-600">Dummy</span>
              ) : data.warehouse ? (
                data.warehouse.name
              ) : (
                <span className="text-slate-500">—</span>
              )}
            </Row>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
