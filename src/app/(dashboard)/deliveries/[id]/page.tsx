"use client";

import { useState, useEffect, use } from "react";
import Link from "next/link";
import { AlertTriangle, Phone } from "lucide-react";
import { ActionConfirmation } from "@/components/ui/action-confirmation";
import { ErrorBanner } from "@/components/ui/error-banner";
import { SkeletonList } from "@/components/ui/skeleton";
import { apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";
import { StockShortLine } from "./_components/types";
import { useDelivery } from "./_components/use-delivery";
import { DetailHeader } from "./_components/detail-header";
import { CustomerInfoCard } from "./_components/customer-info-card";
import { LineItemsCard } from "./_components/line-items-card";
import { DeliveryDetailsCard } from "./_components/delivery-details-card";
import { DeliveryDateEditor } from "./_components/delivery-date-editor";
import { CourierInfoCard } from "./_components/courier-info-card";
import { FreeAccessoriesEditor } from "./_components/free-accessories-editor";
import { PaymentWarning } from "./_components/payment-warning";
import { WhatsAppActions } from "./_components/whatsapp-actions";
import { SelfFillLinkButton } from "./_components/self-fill-link-button";
import { DetailActions } from "./_components/detail-actions";
import { StockHoldCard } from "./_components/stock-hold-card";

const log = createLogger("deliveries:detail");

type Confirmation = {
  type: "success" | "warning" | "error" | "info";
  title: string;
  referenceId: string;
  items?: Array<{ label: string; value: string }>;
  details?: string;
};

function statusLabel(status: string) {
  if (status === "WALK_OUT") return "Walk-out";
  if (status === "IN_TRANSIT") return "In Transit";
  return status.charAt(0) + status.slice(1).toLowerCase().replace(/_/g, " ");
}

export default function DeliveryDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, loading, error: loadError, refetch } = useDelivery(id);

  const [actionError, setActionError] = useState("");
  // Floor lines the last SCHEDULED/PACKED change could not hold (plan 1609 T5).
  const [stockShort, setStockShort] = useState<StockShortLine[]>([]);
  const [templates, setTemplates] = useState<Record<string, string>>({});
  const [activeTab, setActiveTab] = useState<"actions" | "details">("actions");
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);

  useEffect(() => {
    void apiTry<Record<string, string>>("/api/whatsapp-templates").then((res) => {
      if (res.data) setTemplates(res.data);
      // Not fatal: the WhatsApp buttons fall back to their built-in wording.
      else log.warn("whatsapp templates not loaded", { status: res.status });
    });
  }, []);

  const handleStatusChange = async (status: string, extra?: Record<string, unknown>) => {
    const res = await apiTry<{ stockShort?: StockShortLine[] }>(`/api/deliveries/${id}`, {
      method: "PUT",
      json: { status, ...extra },
    });
    if (res.error) {
      log.warn("status change refused", { deliveryId: id, status, httpStatus: res.status });
      setActionError(res.error);
      return;
    }
    const short = status === "SCHEDULED" || status === "PACKED" ? res.data?.stockShort ?? [] : [];
    setStockShort(short);
    log.info("status changed", { deliveryId: id, status, shortLines: short.length });
    void refetch();
    if (!data) return;

    const shortNote = short.length > 0
      ? `Stock not reserved — ${data.warehouse?.name || "the floor"} is short on ${short.length} item(s).`
      : undefined;
    if (status === "OUT_FOR_DELIVERY") {
      setConfirmation({
        type: "success",
        title: "Dispatched!",
        referenceId: data.invoiceNo,
        items: [
          { label: "Customer", value: data.customerName },
          { label: "Area", value: data.customerArea || "N/A" },
          { label: "Courier", value: (extra?.courierName as string) || data.courierName || "Direct" },
        ],
        details: "Send WhatsApp to customer for tracking",
      });
    } else {
      setConfirmation({
        type: short.length > 0 ? "warning" : "success",
        title: "Status Updated",
        referenceId: data.invoiceNo,
        items: [
          { label: "Customer", value: data.customerName },
          { label: "New Status", value: statusLabel(status) },
          { label: "Items", value: `${data.lineItems?.length || 0} items` },
        ],
        details: shortNote,
      });
    }
  };

  const handleRefetch = () => { void refetch(); };

  if (loading) {
    return (
      <div className="py-2">
        <SkeletonList count={5} type="card" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center py-12 px-4">
        <p className="text-sm text-slate-500 mb-2">{loadError || "Not found"}</p>
        <div className="flex items-center justify-center gap-4">
          {loadError && (
            <button onClick={handleRefetch} className="text-blue-600 text-sm underline">Retry</button>
          )}
          <Link href="/deliveries" className="text-blue-600 text-sm">Back</Link>
        </div>
      </div>
    );
  }

  // A Dummy is read-only: the read-only cards stay, every write surface is withheld (A41c).
  // The customer card hides Save Customer on a Dummy itself.
  // "Customer saved" is the database link, the same on every device (plan 1609 A2).
  const isDummy = data.isDummy;
  const customerSaved = !!data.customerId;
  const customerCard = <CustomerInfoCard data={data} onSaved={handleRefetch} />;

  return (
    <div>
      {actionError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-2.5 mb-3 text-xs text-red-700" role="alert">
          {actionError}
          <button onClick={() => setActionError("")} className="ml-2 underline">dismiss</button>
        </div>
      )}

      {loadError && (
        <ErrorBanner message={loadError} onRetry={handleRefetch} />
      )}

      <DetailHeader data={data} />

      {isDummy && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-300 rounded-lg p-3 mb-3" role="alert">
          <AlertTriangle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
          <p className="text-sm text-red-800 font-medium">
            Dummy delivery — no floor warehouse matched this invoice number. No actions are available.
          </p>
        </div>
      )}

      {/* Tab Switcher */}
      <div className="flex gap-1 bg-slate-100 rounded-lg p-1 mb-3">
        {(["actions", "details"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 py-2 rounded-md text-sm font-semibold transition-colors ${
              activeTab === tab ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"
            }`}
          >
            {tab === "actions" ? "Actions" : "Details"}
          </button>
        ))}
      </div>

      {/* ACTIONS TAB */}
      {activeTab === "actions" && (
        <>
          {data.customerPhone && (
            <div className="flex gap-2 mb-3">
              <a
                href={`tel:${data.customerPhone}`}
                className="flex-1 flex items-center justify-center gap-2 bg-slate-100 text-slate-700 py-2.5 min-h-[48px] rounded-lg text-sm font-medium tabular-nums focus-ring"
              >
                <Phone className="h-4 w-4" /> {data.customerPhone}
              </a>
            </div>
          )}

          {customerCard}

          {isDummy ? (
            <LineItemsCard lineItems={data.lineItems} />
          ) : (
            <>
              {(data.status === "PENDING" || data.status === "VERIFIED") && (
                <SelfFillLinkButton
                  deliveryId={id}
                  customerPhone={data.customerPhone}
                  customerSaved={customerSaved}
                  selfFillCompletedAt={data.selfFillCompletedAt}
                />
              )}

              <StockHoldCard
                data={data}
                deliveryId={id}
                knownShort={stockShort}
                onReserved={() => {
                  setStockShort([]);
                  handleRefetch();
                }}
              />

              <DetailActions
                data={data}
                deliveryId={id}
                customerSaved={customerSaved}
                templates={templates}
                onStatusChange={handleStatusChange}
                onRefetch={handleRefetch}
                onStockShort={setStockShort}
                onError={setActionError}
                onConfirmation={setConfirmation}
              />
            </>
          )}
        </>
      )}

      {/* DETAILS TAB */}
      {activeTab === "details" && (
        <>
          {customerCard}
          {!isDummy && (
            <DeliveryDetailsCard data={data} deliveryId={id} onSaved={handleRefetch} onError={setActionError} />
          )}
          <PaymentWarning data={data} />
          {!isDummy && (
            <>
              <DeliveryDateEditor data={data} deliveryId={id} onSaved={handleRefetch} onError={setActionError} />
              <CourierInfoCard data={data} deliveryId={id} onSaved={handleRefetch} onError={setActionError} />
            </>
          )}
          <LineItemsCard lineItems={data.lineItems} />
          {!isDummy && (
            <>
              <FreeAccessoriesEditor data={data} deliveryId={id} onSaved={handleRefetch} onError={setActionError} />
              <WhatsAppActions data={data} deliveryId={id} templates={templates} onSent={handleRefetch} />
            </>
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
