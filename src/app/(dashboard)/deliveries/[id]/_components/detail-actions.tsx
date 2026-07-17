"use client";

import { useState } from "react";
import { CheckCircle2, Truck, Package, Wrench } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { DeliveryData } from "./types";
import { ScheduleForm } from "./schedule-form";
import { DispatchForm } from "./dispatch-form";
import { HandoverChecklist } from "./handover-checklist";
import { ServiceInvoiceSection } from "./service-invoice-section";
import { FlagSection } from "./flag-section";

interface DetailActionsProps {
  data: DeliveryData;
  deliveryId: string;
  contactSaved: boolean;
  templates: Record<string, string>;
  initialAction: "WALK_OUT" | null;
  onStatusChange: (status: string, extra?: Record<string, unknown>) => Promise<void>;
  onRefetch: () => void;
  onError: (msg: string) => void;
  onConfirmation: (conf: {
    type: "success";
    title: string;
    referenceId: string;
    items: Array<{ label: string; value: string }>;
    details?: string;
  }) => void;
}

export function DetailActions({
  data,
  deliveryId,
  contactSaved,
  templates,
  initialAction,
  onStatusChange,
  onRefetch,
  onError,
  onConfirmation,
}: DetailActionsProps) {
  const [showSchedule, setShowSchedule] = useState(false);
  const [showDispatch, setShowDispatch] = useState(false);
  const [showHandover, setShowHandover] = useState<"WALK_OUT" | "DELIVERED" | null>(
    data.status === "WALK_OUT" || data.status === "DELIVERED" ? null : initialAction
  );
  const [actionLoading, setActionLoading] = useState(false);

  const isOuts = data.isOutstation;

  const handleStatusUpdate = async (status: string, extra?: Record<string, unknown>) => {
    setActionLoading(true);
    try {
      await onStatusChange(status, extra);
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="space-y-2">
      {/* Flag Banner + Flag button */}
      <FlagSection
        data={data}
        deliveryId={deliveryId}
        onFlagged={onRefetch}
        onResolved={onRefetch}
      />

      {/* Prebook Info */}
      {data.status === "PREBOOKED" && (
        <Card className="mb-3 border-purple-200 bg-purple-50">
          <CardContent className="p-3">
            <div className="flex items-center gap-2">
              <Package className="h-5 w-5 text-purple-600 shrink-0" />
              <div>
                <p className="text-sm font-medium text-purple-900">Prebooked</p>
                {data.expectedReadyDate && (
                  <p className="text-xs text-purple-700">
                    Expected ready: {new Date(data.expectedReadyDate).toLocaleDateString("en-IN")}
                  </p>
                )}
                {data.prebookNotes && (
                  <p className="text-xs text-purple-600 mt-0.5">{data.prebookNotes}</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Schedule Form */}
      {showSchedule && (
        <ScheduleForm
          data={data}
          deliveryId={deliveryId}
          templates={templates}
          onScheduled={() => {
            setShowSchedule(false);
            onRefetch();
          }}
          onCancel={() => setShowSchedule(false)}
          onConfirmation={onConfirmation}
        />
      )}

      {/* Handover Checklist */}
      {showHandover && (
        <HandoverChecklist
          data={data}
          type={showHandover}
          deliveryId={deliveryId}
          onConfirmed={() => {
            setShowHandover(null);
            onRefetch();
          }}
          onCancel={() => setShowHandover(null)}
          onError={onError}
          onConfirmation={onConfirmation}
        />
      )}

      {/* Dispatch Form */}
      {showDispatch && data.status === "SCHEDULED" && isOuts && (
        <DispatchForm
          data={data}
          deliveryId={deliveryId}
          onDispatched={() => {
            setShowDispatch(false);
            onRefetch();
          }}
          onCancel={() => setShowDispatch(false)}
          onError={onError}
          onStatusChange={onStatusChange}
        />
      )}

      {/* Action Buttons */}
      {(data.status === "PENDING" || data.status === "VERIFIED") && !showSchedule && !showHandover && (
        <div className="space-y-2">
          {!contactSaved && data.customerPhone ? (
            <p className="text-xs text-amber-600 font-medium py-2">
              Save customer contact above to proceed
            </p>
          ) : (
            <div className="flex gap-2">
              <button
                onClick={() => setShowSchedule(true)}
                className="flex-1 bg-blue-600 text-white py-2.5 min-h-[48px] rounded-lg text-sm font-medium"
              >
                Schedule Delivery
              </button>
              <button
                onClick={() => {
                  if (!contactSaved && data.customerPhone) return;
                  setShowHandover("WALK_OUT");
                }}
                className="flex-1 bg-green-600 text-white py-2.5 min-h-[48px] rounded-lg text-sm font-medium flex items-center justify-center gap-1.5"
              >
                <CheckCircle2 className="h-4 w-4" /> Walk-out
              </button>
            </div>
          )}
        </div>
      )}

      {/* Inside Bangalore: SCHEDULED -> DELIVERED directly */}
      {data.status === "SCHEDULED" && !isOuts && !showHandover && (
        <button
          onClick={() => setShowHandover("DELIVERED")}
          disabled={actionLoading}
          className="w-full flex items-center justify-center gap-2 bg-green-600 text-white py-2.5 min-h-[48px] rounded-lg text-sm font-medium disabled:opacity-50"
        >
          <CheckCircle2 className="h-4 w-4" /> Mark Delivered
        </button>
      )}

      {/* Outstation: SCHEDULED -> dispatch form */}
      {data.status === "SCHEDULED" && isOuts && !showDispatch && (
        <button
          onClick={() => setShowDispatch(true)}
          disabled={actionLoading}
          className="w-full flex items-center justify-center gap-2 bg-orange-600 text-white py-2.5 min-h-[48px] rounded-lg text-sm font-medium disabled:opacity-50"
        >
          <Truck className="h-4 w-4" /> Dispatch
        </button>
      )}

      {/* Outstation: SCHEDULED -> PACKED */}
      {data.status === "SCHEDULED" && isOuts && (
        <button
          onClick={() => handleStatusUpdate("PACKED")}
          disabled={actionLoading}
          className="w-full flex items-center justify-center gap-2 bg-amber-600 text-white py-2.5 min-h-[48px] rounded-lg text-sm font-medium disabled:opacity-50"
        >
          <Package className="h-4 w-4" /> Mark Packed
        </button>
      )}

      {/* Outstation: PACKED -> SHIPPED or rollback */}
      {data.status === "PACKED" && (
        <div className="space-y-2">
          <button
            onClick={() => {
              if (data.isOutstation) {
                const trackingNo = prompt("Enter courier tracking number:");
                if (!trackingNo?.trim()) return;
                handleStatusUpdate("SHIPPED", { courierTrackingNo: trackingNo.trim() });
              } else {
                handleStatusUpdate("SHIPPED");
              }
            }}
            disabled={actionLoading}
            className="w-full flex items-center justify-center gap-2 bg-amber-600 text-white py-2.5 min-h-[48px] rounded-lg text-sm font-medium disabled:opacity-50"
          >
            <Truck className="h-4 w-4" /> Mark Shipped
          </button>
          <button
            onClick={() => handleStatusUpdate("VERIFIED")}
            disabled={actionLoading}
            className="w-full flex items-center justify-center gap-2 bg-slate-200 text-slate-700 py-2 rounded-lg text-xs font-medium disabled:opacity-50"
          >
            Cancel Pack (Return to Verified)
          </button>
        </div>
      )}

      {/* Outstation: SHIPPED -> IN_TRANSIT */}
      {data.status === "SHIPPED" && (
        <button
          onClick={() => handleStatusUpdate("IN_TRANSIT")}
          disabled={actionLoading}
          className="w-full flex items-center justify-center gap-2 bg-amber-600 text-white py-2.5 min-h-[48px] rounded-lg text-sm font-medium disabled:opacity-50"
        >
          <Truck className="h-4 w-4" /> Mark In Transit
        </button>
      )}

      {/* Outstation: IN_TRANSIT -> DELIVERED */}
      {data.status === "IN_TRANSIT" && !showHandover && (
        <button
          onClick={() => setShowHandover("DELIVERED")}
          disabled={actionLoading}
          className="w-full flex items-center justify-center gap-2 bg-green-600 text-white py-2.5 min-h-[48px] rounded-lg text-sm font-medium disabled:opacity-50"
        >
          <CheckCircle2 className="h-4 w-4" /> Mark Delivered
        </button>
      )}

      {/* OUT_FOR_DELIVERY -> DELIVERED */}
      {data.status === "OUT_FOR_DELIVERY" && !showHandover && (
        <button
          onClick={() => setShowHandover("DELIVERED")}
          disabled={actionLoading}
          className="w-full flex items-center justify-center gap-2 bg-green-600 text-white py-2.5 min-h-[48px] rounded-lg text-sm font-medium disabled:opacity-50"
        >
          <CheckCircle2 className="h-4 w-4" /> Mark Delivered
        </button>
      )}

      {/* Service Invoice Section */}
      <ServiceInvoiceSection
        data={data}
        deliveryId={deliveryId}
        onMarked={onRefetch}
      />

      {/* FLAGGED -> Resolve */}
      {data.status === "FLAGGED" && (
        <button
          onClick={() => handleStatusUpdate("PENDING")}
          disabled={actionLoading}
          className="w-full bg-slate-900 text-white py-2.5 min-h-[48px] rounded-lg text-sm font-medium disabled:opacity-50"
        >
          Resolve Flag
        </button>
      )}

      {/* PREBOOKED -> VERIFIED (cycle is now available) */}
      {data.status === "PREBOOKED" && (
        <button
          onClick={() => handleStatusUpdate("VERIFIED")}
          disabled={actionLoading}
          className="w-full bg-blue-600 text-white py-2.5 min-h-[48px] rounded-lg text-sm font-medium disabled:opacity-50"
        >
          Mark Ready (Cycle Available)
        </button>
      )}

      {/* Delivered banner */}
      {data.status === "DELIVERED" && (
        <Card className="border-green-200 bg-green-50">
          <CardContent className="p-3 text-center">
            <CheckCircle2 className="h-6 w-6 text-green-600 mx-auto mb-1" />
            <p className="text-sm font-medium text-green-900">Delivered</p>
            {data.deliveredAt && (
              <p className="text-xs text-green-700">
                {new Date(data.deliveredAt).toLocaleString("en-IN")}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Walk-out banner */}
      {data.status === "WALK_OUT" && (
        <Card className="border-green-200 bg-green-50">
          <CardContent className="p-3 text-center">
            <CheckCircle2 className="h-6 w-6 text-green-600 mx-auto mb-1" />
            <p className="text-sm font-medium text-green-900">Walk-out Complete</p>
            <p className="text-xs text-green-700">Customer took the cycle. Stock deducted.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
