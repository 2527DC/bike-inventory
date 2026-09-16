"use client";

import { useState } from "react";
import { Truck } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";
import { whatsappDigits } from "@/lib/phone";
import { DeliveryData, formatINR } from "./types";

const log = createLogger("deliveries:courier");

interface CourierInfoCardProps {
  data: DeliveryData;
  deliveryId: string;
  onSaved: () => void;
  onError: (msg: string) => void;
}

export function CourierInfoCard({ data, deliveryId, onSaved, onError }: CourierInfoCardProps) {
  const [courierName, setCourierName] = useState(data.courierName || "");
  const [courierTrackingNo, setCourierTrackingNo] = useState(data.courierTrackingNo || "");
  const [courierCost, setCourierCost] = useState(data.courierCost ? String(data.courierCost) : "");
  const [loading, setLoading] = useState(false);
  const [showDispatchWhatsApp, setShowDispatchWhatsApp] = useState(false);

  const isEditable = ["OUT_FOR_DELIVERY", "PACKED", "SHIPPED", "IN_TRANSIT"].includes(data.status);
  const isReadOnly = data.courierName && !isEditable;

  const handleSave = async () => {
    setLoading(true);
    try {
      await fetch(`/api/deliveries/${deliveryId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          courierName,
          courierTrackingNo,
          courierCost: courierCost ? parseFloat(courierCost) : undefined,
        }),
      });
      setShowDispatchWhatsApp(true);
      onSaved();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Save courier failed");
    } finally {
      setLoading(false);
    }
  };

  const sendDispatchedWhatsApp = () => {
    if (!data.customerPhone) return;
    const productName = data.lineItems?.map((item) => item.name).join(", ") || "your order";
    const lineItemsText = data.lineItems?.map((item) => `- ${item.name} (Qty: ${item.quantity})`).join("\n") || "";
    const accessories = data.freeAccessories || "None";
    const trackingLink = data.courierTrackingNo || courierTrackingNo;
    const vNo = data.vehicleNo;

    const msg = `Hello ${data.customerName},\n\nYour ${productName} is on the way!${vNo ? `\n\nVehicle No: ${vNo}` : ""}${trackingLink ? `\nTrack: ${trackingLink}` : ""}\n\nItems:\n${lineItemsText}\n\nFree Accessories:\n${accessories}\n\nThank you for choosing Bharath Cycle Hub!`;
    const digits = whatsappDigits(data.customerPhone);
    if (!digits) {
      log.warn("dispatched WhatsApp not opened: the phone has no digits", { deliveryId });
      onError("The customer's phone number is not valid for WhatsApp.");
      return;
    }
    window.open(`https://api.whatsapp.com/send?phone=${digits}&text=${encodeURIComponent(msg)}`, "_blank");

    void apiTry(`/api/deliveries/${deliveryId}`, {
      method: "PUT",
      json: { whatsAppDispatchedSent: true },
    }).then((sent) => {
      if (sent.error) log.warn("whatsAppDispatchedSent flag not saved", { deliveryId, httpStatus: sent.status });
    });
    setShowDispatchWhatsApp(false);
  };

  // Read-only courier display (non-editable statuses)
  if (isReadOnly) {
    return (
      <Card className="mb-3 border-blue-200 bg-blue-50">
        <CardContent className="p-3 space-y-1">
          <div className="flex items-center gap-2">
            <Truck className="h-4 w-4 text-blue-600 shrink-0" />
            <p className="text-xs font-semibold text-blue-900">Courier Details</p>
          </div>
          <p className="text-xs text-blue-800">Courier: {data.courierName}</p>
          {data.courierTrackingNo && (
            <p className="text-xs text-blue-800">Tracking: {data.courierTrackingNo}</p>
          )}
          {data.courierCost != null && (
            <p className="text-xs text-blue-800">Cost: {formatINR(data.courierCost)}</p>
          )}
        </CardContent>
      </Card>
    );
  }

  // Editable courier section
  if (!isEditable) return null;

  return (
    <>
      <Card className="mb-3 border-amber-200">
        <CardContent className="p-3 space-y-2">
          <p className="text-xs font-semibold text-slate-700">Update Courier Info</p>
          <div>
            <label className="text-xs text-slate-500">Courier Name</label>
            <Input
              value={courierName}
              onChange={(e) => setCourierName(e.target.value)}
              placeholder="e.g. DTDC, BlueDart"
              className="text-xs"
            />
          </div>
          <div>
            <label className="text-xs text-slate-500">Tracking Number</label>
            <Input
              value={courierTrackingNo}
              onChange={(e) => setCourierTrackingNo(e.target.value)}
              placeholder="Tracking ID"
              className="text-xs"
            />
          </div>
          <div>
            <label className="text-xs text-slate-500">Courier Cost</label>
            <Input
              type="number"
              value={courierCost}
              onChange={(e) => setCourierCost(e.target.value)}
              placeholder="0"
              className="text-xs"
            />
          </div>
          <button
            onClick={handleSave}
            disabled={loading}
            className="w-full bg-amber-600 text-white py-2 rounded-lg text-xs font-medium disabled:opacity-50"
          >
            {loading ? "Saving..." : "Save Courier Info"}
          </button>
        </CardContent>
      </Card>

      {/* Auto-prompt: Send WhatsApp after saving courier */}
      {showDispatchWhatsApp && data.customerPhone && !data.whatsAppDispatchedSent && (
        <Card className="mb-3 border-green-300 bg-green-50 ring-2 ring-green-300">
          <CardContent className="p-3 space-y-2">
            <p className="text-xs font-semibold text-green-900">Dispatched! Send WhatsApp to customer?</p>
            <p className="text-xs text-green-700">
              {data.vehicleNo && `Vehicle: ${data.vehicleNo}`}
              {data.vehicleNo && data.courierTrackingNo && " | "}
              {data.courierTrackingNo && `Tracking: ${data.courierTrackingNo}`}
            </p>
            <div className="flex gap-2">
              <button
                onClick={sendDispatchedWhatsApp}
                className="flex-1 flex items-center justify-center gap-2 bg-green-600 text-white py-2.5 rounded-lg text-sm font-medium"
              >
                Send WhatsApp Now
              </button>
              <button
                onClick={() => setShowDispatchWhatsApp(false)}
                className="px-4 py-2.5 bg-slate-100 text-slate-600 rounded-lg text-xs font-medium"
              >
                Skip
              </button>
            </div>
          </CardContent>
        </Card>
      )}
    </>
  );
}
