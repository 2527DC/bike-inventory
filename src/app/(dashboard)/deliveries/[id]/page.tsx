"use client";

import { useState, useEffect, use } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Phone } from "lucide-react";
import { ActionConfirmation } from "@/components/ui/action-confirmation";
import { SkeletonList } from "@/components/ui/skeleton";
import { DeliveryData } from "./_components/types";
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

export default function DeliveryDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const searchParams = useSearchParams();
  const router = useRouter();

  // Core data state
  const [data, setData] = useState<DeliveryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionError, setActionError] = useState("");

  // Persist contact-saved state in localStorage so it survives refresh
  const contactKey = `contact-saved-${id}`;
  const [contactSaved, setContactSaved] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(contactKey) === "1";
  });

  const markContactSaved = () => {
    setContactSaved(true);
    localStorage.setItem(contactKey, "1");
  };

  // WhatsApp templates
  const [templates, setTemplates] = useState<Record<string, string>>({});

  // Tab: actions (default) vs details
  const [activeTab, setActiveTab] = useState<"actions" | "details">("actions");

  // Confirmation modal
  const [confirmation, setConfirmation] = useState<{
    type: "success" | "warning" | "error" | "info";
    title: string;
    referenceId: string;
    items?: Array<{ label: string; value: string }>;
    details?: string;
  } | null>(null);

  // Initial action from URL (e.g. ?action=walkout) — consume once, then strip param
  const actionParam = searchParams.get("action");
  const initialAction = actionParam === "walkout" ? "WALK_OUT" as const : null;

  useEffect(() => {
    if (actionParam) {
      router.replace(`/deliveries/${id}`, { scroll: false });
    }
  }, [actionParam, id, router]);

  const fetchData = () => {
    fetch(`/api/deliveries/${id}`)
      .then((r) => r.json())
      .then((res) => {
        if (res.success) {
          setData(res.data);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchData(); }, [id]); // eslint-disable-line

  useEffect(() => {
    fetch("/api/whatsapp-templates")
      .then((r) => r.json())
      .then((res) => { if (res.success) setTemplates(res.data); })
      .catch(() => {});
  }, []);

  const handleStatusChange = async (status: string, extra?: Record<string, unknown>) => {
    try {
      const res = await fetch(`/api/deliveries/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, ...extra }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setActionError(json.error || "Status update failed");
        return;
      }
      fetchData();
      if (data) {
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
          const statusLabel =
            status === "WALK_OUT"
              ? "Walk-out"
              : status === "IN_TRANSIT"
                ? "In Transit"
                : status.charAt(0) + status.slice(1).toLowerCase().replace(/_/g, " ");
          setConfirmation({
            type: "success",
            title: "Status Updated",
            referenceId: data.invoiceNo,
            items: [
              { label: "Customer", value: data.customerName },
              { label: "New Status", value: statusLabel },
              { label: "Items", value: `${data.lineItems?.length || 0} items` },
            ],
          });
        }
      }
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Action failed");
    }
  };

  const handleRefetch = () => {
    fetchData();
  };

  const handleError = (msg: string) => {
    setActionError(msg);
  };

  const handleConfirmation = (conf: {
    type: "success";
    title: string;
    referenceId: string;
    items: Array<{ label: string; value: string }>;
    details?: string;
  }) => {
    setConfirmation(conf);
  };

  if (loading) {
    return (
      <div className="py-2">
        <SkeletonList count={5} type="card" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center py-12">
        <p className="text-slate-400">Not found</p>
        <Link href="/deliveries" className="text-blue-600 text-sm">Back</Link>
      </div>
    );
  }

  return (
    <div>
      {actionError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-2.5 mb-3 text-xs text-red-700">
          {actionError}
          <button onClick={() => setActionError("")} className="ml-2 underline">dismiss</button>
        </div>
      )}

      {/* Header with badges and progress */}
      <DetailHeader data={data} />

      {/* Tab Switcher */}
      <div className="flex gap-1 bg-slate-100 rounded-lg p-1 mb-3">
        <button
          onClick={() => setActiveTab("actions")}
          className={`flex-1 py-2 rounded-md text-sm font-semibold transition-colors ${
            activeTab === "actions" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"
          }`}
        >
          Actions
        </button>
        <button
          onClick={() => setActiveTab("details")}
          className={`flex-1 py-2 rounded-md text-sm font-semibold transition-colors ${
            activeTab === "details" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"
          }`}
        >
          Details
        </button>
      </div>

      {/* ACTIONS TAB */}
      {activeTab === "actions" && (
        <>
          {/* Quick call button */}
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

          {/* Save Contact (for PENDING) */}
          <CustomerInfoCard
            data={data}
            onContactSaved={markContactSaved}
            contactSaved={contactSaved}
          />

          {/* Customer self-fill link (for address collection) */}
          {(data.status === "PENDING" || data.status === "VERIFIED") && (
            <SelfFillLinkButton
              deliveryId={id}
              customerPhone={data.customerPhone}
              selfFillCompletedAt={data.selfFillCompletedAt}
            />
          )}

          {/* All action buttons and forms */}
          <DetailActions
            data={data}
            deliveryId={id}
            contactSaved={contactSaved}
            templates={templates}
            initialAction={initialAction}
            onStatusChange={handleStatusChange}
            onRefetch={handleRefetch}
            onError={handleError}
            onConfirmation={handleConfirmation}
          />
        </>
      )}

      {/* DETAILS TAB */}
      {activeTab === "details" && (
        <>
          <CustomerInfoCard
            data={data}
            onContactSaved={markContactSaved}
            contactSaved={contactSaved}
          />

          <DeliveryDetailsCard
            data={data}
            deliveryId={id}
            onSaved={handleRefetch}
            onError={handleError}
          />

          <PaymentWarning data={data} />

          <DeliveryDateEditor
            data={data}
            deliveryId={id}
            onSaved={handleRefetch}
            onError={handleError}
          />

          <CourierInfoCard
            data={data}
            deliveryId={id}
            onSaved={handleRefetch}
            onError={handleError}
          />

          <LineItemsCard lineItems={data.lineItems} />

          <FreeAccessoriesEditor
            data={data}
            deliveryId={id}
            onSaved={handleRefetch}
            onError={handleError}
          />

          <WhatsAppActions
            data={data}
            deliveryId={id}
            templates={templates}
            onSent={handleRefetch}
          />
        </>
      )}

      {/* Action Confirmation Modal */}
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
