"use client";

import Link from "next/link";
import { ArrowLeft, Globe, MapPin, RotateCcw, Warehouse } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { getStatusColor, getStatusLabel } from "@/lib/status-colors";
import { zoneLabel } from "@/lib/deliveries/zone";
import {
  DeliveryData,
  formatINR,
  isOutstationDelivery,
  BANGALORE_STEPS,
  OUTSTATION_STEPS,
  COURIER_STEPS,
} from "./types";

interface DetailHeaderProps {
  data: DeliveryData;
  /** The list this detail was opened from: /deliveries, /deliveries/blr or /deliveries/outstation (A29). */
  backHref: string;
}

export function DetailHeader({ data, backHref }: DetailHeaderProps) {
  const isOuts = isOutstationDelivery(data);
  const isCourierFlow = isOuts && ["VERIFIED", "PACKED", "SHIPPED", "IN_TRANSIT"].includes(data.status);
  const activeSteps = isCourierFlow ? COURIER_STEPS : isOuts ? OUTSTATION_STEPS : BANGALORE_STEPS;
  const stepIdx = activeSteps.indexOf(data.status);

  return (
    <>
      {/* Header row */}
      <div className="flex items-center gap-3 mb-3">
        <Link href={backHref} className="p-2 -ml-2 rounded-lg hover:bg-slate-100 focus-ring" aria-label="Back">
          <ArrowLeft className="h-5 w-5 text-slate-600" />
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-bold text-slate-900 truncate tabular-nums">{data.invoiceNo}</h1>
          <p className="text-xs text-slate-500 tabular-nums truncate">
            {data.customerName} | {formatINR(data.invoiceAmount)}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-1.5 max-w-[55%]">
          {/* Floor warehouse the invoice matched, or Dummy when none did (plan 1609 A41c, T2) */}
          {data.isDummy ? (
            <Badge variant="danger">Dummy</Badge>
          ) : data.warehouse ? (
            <Badge className="max-w-[9rem]" title={data.warehouse.name}>
              <Warehouse className="h-3 w-3 mr-1 shrink-0" />
              <span className="truncate">{data.warehouse.name}</span>
            </Badge>
          ) : null}
          {data.reversePickup && (
            <Badge variant="info">
              <RotateCcw className="h-3 w-3 mr-1" />Reverse
            </Badge>
          )}
          {/* Bangalore / Outstation / Not set (plan 1609 A22) */}
          {data.deliveryZone === "OUTSTATION" ? (
            <Badge variant="warning">
              <Globe className="h-3 w-3 mr-1" />
              {zoneLabel(data.deliveryZone)}
            </Badge>
          ) : (
            <Badge variant={data.deliveryZone === "BANGALORE" ? "info" : "default"}>
              <MapPin className="h-3 w-3 mr-1" />
              {zoneLabel(data.deliveryZone)}
            </Badge>
          )}
          <Badge className={`text-xs ${getStatusColor(data.status)}`}>
            {getStatusLabel(data.status)}
          </Badge>
        </div>
      </div>

      {/* Progress Steps — only shown for non-terminal statuses in actions context */}
      {!["FLAGGED", "WALK_OUT", "PREBOOKED", "PENDING"].includes(data.status) && (
        <div className="flex items-center gap-1 mb-3">
          {activeSteps.map((step, i) => (
            <div key={step} className="flex-1">
              <div className={`h-1.5 rounded-full ${i <= stepIdx ? (isOuts ? "bg-amber-500" : "bg-blue-500") : "bg-slate-200"}`} />
              <p className={`text-[11px] mt-0.5 text-center ${i <= stepIdx ? (isOuts ? "text-amber-600 font-medium" : "text-blue-600 font-medium") : "text-slate-400"}`}>
                {step === "OUT_FOR_DELIVERY" ? "Out" : step === "IN_TRANSIT" ? "Transit" : step.charAt(0) + step.slice(1).toLowerCase().replace(/_/g, " ")}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* PENDING progress */}
      {data.status === "PENDING" && (
        <div className="flex items-center gap-1 mb-3">
          {BANGALORE_STEPS.map((step, i) => (
            <div key={step} className="flex-1">
              <div className={`h-1.5 rounded-full ${i === 0 ? "bg-blue-500" : "bg-slate-200"}`} />
              <p className={`text-[11px] mt-0.5 text-center ${i === 0 ? "text-blue-600 font-medium" : "text-slate-400"}`}>
                {step.charAt(0) + step.slice(1).toLowerCase()}
              </p>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
