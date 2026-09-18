"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { UnitLabelSheet } from "@/components/units/unit-label-sheet";

/**
 * The reprintable label sheet (R46, plan 1709 Part H).
 *
 * `/units/labels?unitIds=…` — the codes just generated, or one unit again
 * `/units/labels?binId=…`   — every item on one shelf
 * `/units/labels?inboundShipmentId=…` — everything that arrived on one shipment; this is the
 *                              address behind "Print unit labels" on the inbound detail screen.
 *
 * The page is only the address bar: the sheet, its data and its printing are the component's,
 * so the bins screen can show the same thing in a modal without a round trip through a URL.
 */
function LabelsPage() {
  const searchParams = useSearchParams();
  const unitIdsParam = searchParams.get("unitIds");
  const binId = searchParams.get("binId");
  const inboundShipmentId = searchParams.get("inboundShipmentId");

  const unitIds = unitIdsParam
    ? unitIdsParam.split(",").map((s) => s.trim()).filter(Boolean)
    : undefined;

  const heading = unitIds
    ? `${unitIds.length} item${unitIds.length === 1 ? "" : "s"}`
    : binId
      ? "Everything in this bin"
      : inboundShipmentId
        ? "Everything received on this shipment"
        : "Nothing chosen";

  return (
    <div className="space-y-4 pb-12">
      <div className="flex items-center gap-2">
        <Link
          href="/bins"
          aria-label="Back to bins"
          className="-ml-2 rounded-lg p-2 hover:bg-slate-100 focus-ring dark:hover:bg-slate-800"
        >
          <ArrowLeft className="h-5 w-5 text-slate-600 dark:text-slate-300" />
        </Link>
        <div className="min-w-0">
          <h1 className="truncate text-lg font-bold text-slate-900 dark:text-white">Item labels</h1>
          <p className="text-xs text-slate-500">{heading}</p>
        </div>
      </div>

      {!unitIds && !binId && !inboundShipmentId ? (
        <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-xs text-slate-400 dark:border-slate-800">
          Open this page from a bin, a shipment or after generating unit codes.
        </div>
      ) : (
        <UnitLabelSheet unitIds={unitIds} binId={binId ?? undefined} inboundShipmentId={inboundShipmentId ?? undefined} />
      )}
    </div>
  );
}

export default function UnitLabelsPage() {
  // `useSearchParams` in a client component must sit under a Suspense boundary, or the
  // production build fails prerendering this page.
  return (
    <Suspense fallback={<div className="py-12 text-center text-xs text-slate-400">Loading labels…</div>}>
      <LabelsPage />
    </Suspense>
  );
}
