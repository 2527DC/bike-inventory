"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";
import { whatsappDigits } from "@/lib/phone";
import { DeliveryData } from "./types";

const log = createLogger("deliveries:dispatch");

interface DispatchFormProps {
  data: DeliveryData;
  deliveryId: string;
  onDispatched: () => void;
  onCancel: () => void;
  onError: (msg: string) => void;
  onStatusChange: (status: string, extra?: Record<string, unknown>) => Promise<void>;
}

export function DispatchForm({ data, deliveryId, onDispatched, onCancel, onError, onStatusChange }: DispatchFormProps) {
  const [courierName, setCourierName] = useState(data.courierName || "");
  const [courierTrackingNo, setCourierTrackingNo] = useState(data.courierTrackingNo || "");
  const [courierCost, setCourierCost] = useState(data.courierCost ? String(data.courierCost) : "");
  const [loading, setLoading] = useState(false);

  const handleDispatch = async () => {
    if (!courierName.trim()) {
      onError("Please enter courier name");
      return;
    }
    setLoading(true);
    try {
      await onStatusChange("OUT_FOR_DELIVERY", {
        courierName: courierName.trim(),
        courierTrackingNo: courierTrackingNo.trim() || undefined,
        courierCost: courierCost ? parseFloat(courierCost) : undefined,
      });

      // Auto-trigger dispatched WhatsApp
      if (data.customerPhone) {
        const productName = data.lineItems?.map((item) => item.name).join(", ") || "your order";
        const lineItemsText = data.lineItems?.map((item) => `- ${item.name} (Qty: ${item.quantity})`).join("\n") || "";
        const accessories = data.freeAccessories || "None";
        const trackingLink = courierTrackingNo.trim();

        const msg = `Hello ${data.customerName},\n\nYour ${productName} is on the way!${trackingLink ? `\nTrack: ${trackingLink}` : ""}\n\nItems:\n${lineItemsText}\n\nFree Accessories:\n${accessories}\n\nThank you for choosing Bharath Cycle Hub!`;
        const digits = whatsappDigits(data.customerPhone);
        if (digits) {
          window.open(`https://api.whatsapp.com/send?phone=${digits}&text=${encodeURIComponent(msg)}`, "_blank");

          // Best effort: the delivery is already dispatched; a missed flag only affects the badge.
          const sent = await apiTry(`/api/deliveries/${deliveryId}`, {
            method: "PUT",
            json: { whatsAppDispatchedSent: true },
          });
          if (sent.error) log.warn("whatsAppDispatchedSent flag not saved", { deliveryId, httpStatus: sent.status });
        } else {
          log.warn("dispatched WhatsApp not opened: the phone has no digits", { deliveryId });
        }
      }

      onDispatched();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Dispatch failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="border-orange-200">
      <CardContent className="p-3 space-y-2">
        <p className="text-xs font-semibold text-slate-700">Dispatch Details (Outstation)</p>
        <div>
          <label className="text-xs text-slate-500">Courier / Delivery Person *</label>
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
          <label className="text-xs text-slate-500">Delivery Cost (Rs.)</label>
          <Input
            type="number"
            value={courierCost}
            onChange={(e) => setCourierCost(e.target.value)}
            placeholder="0"
            className="text-xs"
            inputMode="numeric"
          />
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleDispatch}
            disabled={loading}
            className="flex-1 bg-amber-600 text-white py-2 rounded-lg text-xs font-medium disabled:opacity-50"
          >
            {loading ? "Dispatching..." : "Confirm Dispatch"}
          </button>
          <button
            onClick={onCancel}
            className="px-4 py-2 bg-slate-100 text-slate-600 rounded-lg text-xs font-medium"
          >
            Cancel
          </button>
        </div>
      </CardContent>
    </Card>
  );
}
