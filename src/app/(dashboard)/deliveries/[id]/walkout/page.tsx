"use client";

// Focused walk-out screen (plan 1609 R34, R35, A44, A45). The customer takes the cycle at the
// counter: invoice, items, payment, the customer card with Save Customer, then the handover
// checklist. Deliberately absent: the self-fill link, Schedule, Flag, and the zone toggle.

import { useState, use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, CheckCircle2, Warehouse } from "lucide-react";
import { ActionConfirmation } from "@/components/ui/action-confirmation";
import { Badge } from "@/components/ui/badge";
import { ErrorBanner } from "@/components/ui/error-banner";
import { SkeletonList } from "@/components/ui/skeleton";
import { createLogger } from "@/lib/logger";
import { WALKOUT_STATUSES, formatINR } from "../_components/types";
import { useDelivery } from "../_components/use-delivery";
import { CustomerInfoCard } from "../_components/customer-info-card";
import { LineItemsCard } from "../_components/line-items-card";
import { PaymentWarning } from "../_components/payment-warning";
import { HandoverChecklist } from "../_components/handover-checklist";

const log = createLogger("deliveries:walkout");

type Confirmation = {
  type: "success";
  title: string;
  referenceId: string;
  items: Array<{ label: string; value: string }>;
  details?: string;
};

export default function DeliveryWalkoutPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { data, loading, error, refetch } = useDelivery(id);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [done, setDone] = useState(false);

  const backHref = `/deliveries/${id}`;
  const backLink = (
    <Link href={backHref} className="text-blue-600 text-sm font-medium">
      Back to delivery
    </Link>
  );

  if (loading) {
    return (
      <div className="py-2">
        <SkeletonList count={4} type="card" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center py-12 px-4">
        <p className="text-sm text-slate-500 mb-2">{error || "Delivery not found"}</p>
        <div className="flex items-center justify-center gap-4">
          {error && (
            <button onClick={() => void refetch()} className="text-blue-600 text-sm underline">
              Retry
            </button>
          )}
          {backLink}
        </div>
      </div>
    );
  }

  const available = !data.isDummy && WALKOUT_STATUSES.includes(data.status);
  // Walk-out needs the saved customer — the database link, not a per-device flag (plan 1609 A6).
  // The server refuses WALK_OUT without it too; this only keeps the checklist out of the way.
  const needsCustomer = !data.customerId;

  return (
    <div className="max-w-xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-3">
        <Link href={backHref} className="p-2 -ml-2 rounded-lg hover:bg-slate-100 focus-ring" aria-label="Back">
          <ArrowLeft className="h-5 w-5 text-slate-600" />
        </Link>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-green-700">Walk-out</p>
          <h1 className="text-lg font-bold text-slate-900 truncate tabular-nums">{data.invoiceNo}</h1>
          <p className="text-xs text-slate-500 tabular-nums truncate">
            {data.customerName} | {formatINR(data.invoiceAmount)}
          </p>
        </div>
        {data.isDummy ? (
          <Badge variant="danger">Dummy</Badge>
        ) : data.warehouse ? (
          <Badge className="max-w-[9rem] shrink-0" title={data.warehouse.name}>
            <Warehouse className="h-3 w-3 mr-1 shrink-0" />
            <span className="truncate">{data.warehouse.name}</span>
          </Badge>
        ) : null}
      </div>

      {error && <ErrorBanner message={error} onRetry={() => void refetch()} />}

      {done ? (
        <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-center space-y-2">
          <CheckCircle2 className="h-7 w-7 text-green-600 mx-auto" />
          <p className="text-sm font-semibold text-green-900">Walk-out complete</p>
          <p className="text-xs text-green-700">Customer took the cycle. Stock deducted.</p>
          {backLink}
        </div>
      ) : !available ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-center space-y-2">
          <AlertTriangle className="h-6 w-6 text-amber-600 mx-auto" />
          <p className="text-sm font-medium text-amber-900">Walk-out is not available for this delivery</p>
          {data.isDummy && (
            <p className="text-xs text-amber-800">No floor warehouse matched this invoice number.</p>
          )}
          {backLink}
        </div>
      ) : (
        <>
          <LineItemsCard lineItems={data.lineItems} />
          <PaymentWarning data={data} />
          <CustomerInfoCard data={data} onSaved={() => void refetch()} />

          {needsCustomer ? (
            <p className="text-xs text-amber-600 font-medium py-2">Save the customer above to walk out</p>
          ) : (
            <HandoverChecklist
              data={data}
              type="WALK_OUT"
              deliveryId={id}
              onConfirmed={() => {
                log.info("walk-out screen confirmed", { deliveryId: id });
                setDone(true);
                void refetch();
              }}
              onCancel={() => router.push(backHref)}
              onConfirmation={setConfirmation}
            />
          )}
        </>
      )}

      <ActionConfirmation
        open={!!confirmation}
        onClose={() => setConfirmation(null)}
        type={confirmation?.type || "success"}
        title={confirmation?.title || ""}
        referenceId={confirmation?.referenceId || ""}
        items={confirmation?.items}
        details={confirmation?.details}
      />

      {/* Bottom padding for nav bar */}
      <div className="h-20" />
    </div>
  );
}
