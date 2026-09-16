"use client";

import { useState } from "react";
import { MessageCircle, Check, AlertTriangle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";
import { whatsappDigits } from "@/lib/phone";
import { DeliveryData, isOutstationDelivery } from "./types";

const log = createLogger("deliveries:whatsapp");

interface WhatsAppActionsProps {
  data: DeliveryData;
  deliveryId: string;
  templates: Record<string, string>;
  onSent: () => void;
}

type SentField = "whatsAppScheduledSent" | "whatsAppDispatchedSent" | "whatsAppDeliveredSent";

function renderTemplate(template: string, vars: Record<string, string>) {
  let msg = template;
  for (const [key, val] of Object.entries(vars)) {
    msg = msg.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), val);
  }
  msg = msg.replace(/\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_, key, content) => {
    return vars[key] ? content.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), vars[key]) : "";
  });
  return msg.trim();
}

/** Opens WhatsApp on the delivery's main phone (A9). False when the number has no digits. */
function openWhatsApp(phone: string | null, message: string): boolean {
  const digits = whatsappDigits(phone);
  if (!digits) return false;
  window.open(`https://api.whatsapp.com/send?phone=${digits}&text=${encodeURIComponent(message)}`, "_blank");
  return true;
}

export function WhatsAppActions({ data, deliveryId, templates, onSent }: WhatsAppActionsProps) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<SentField | null>(null);

  if (!data.customerPhone) return null;

  const getProductName = () => {
    if (!data.lineItems || data.lineItems.length === 0) return "your order";
    return data.lineItems.map((item) => item.name).join(", ");
  };

  const getLineItemsText = () => {
    if (!data.lineItems || data.lineItems.length === 0) return "";
    return data.lineItems.map((item) => `- ${item.name} (Qty: ${item.quantity})`).join("\n");
  };

  /** Opens the chat, then records that the message went out. Failures are shown, not swallowed. */
  const send = async (field: SentField, message: string) => {
    setError("");
    if (!openWhatsApp(data.customerPhone, message)) {
      log.warn("WhatsApp not opened: the phone has no digits", { deliveryId, field });
      setError("The customer's phone number is not valid for WhatsApp.");
      return;
    }
    setBusy(field);
    const res = await apiTry(`/api/deliveries/${deliveryId}`, { method: "PUT", json: { [field]: true } });
    setBusy(null);
    if (res.error) {
      log.warn("WhatsApp sent flag not saved", { deliveryId, field, httpStatus: res.status });
      setError(`WhatsApp opened, but it was not marked as sent: ${res.error}`);
      return;
    }
    log.info("WhatsApp marked sent", { deliveryId, field });
    onSent();
  };

  const sendScheduledWhatsApp = () => {
    const date = data.scheduledDate ? new Date(data.scheduledDate).toLocaleDateString("en-IN") : "to be confirmed";
    const productName = getProductName();
    const msg = templates.scheduled
      ? renderTemplate(templates.scheduled, { customerName: data.customerName, productName, deliveryDate: date })
      : `Hello ${data.customerName},\n\nYour order from Bharath Cycle Hub has been scheduled for delivery.\n\nProduct: ${productName}\nDelivery Date: ${date}\n\nPlease share your delivery location on WhatsApp so our rider can reach you.\n\nThank you!\n- Bharath Cycle Hub`;
    void send("whatsAppScheduledSent", msg);
  };

  const sendDispatchedWhatsApp = () => {
    const productName = getProductName();
    const lineItemsText = getLineItemsText();
    const accessories = data.freeAccessories || "None";
    const vNo = data.vehicleNo;
    const trackingLink = data.courierTrackingNo;

    const msg = templates.dispatched
      ? renderTemplate(templates.dispatched, {
          customerName: data.customerName,
          productName,
          vehicleNo: vNo || "",
          trackingLink: trackingLink || "",
          lineItems: lineItemsText,
          accessories,
        })
      : `Hello ${data.customerName},\n\nYour ${productName} is on the way!${vNo ? `\n\nVehicle No: ${vNo}` : ""}${trackingLink ? `\nTrack: ${trackingLink}` : ""}\n\nItems:\n${lineItemsText}\n\nFree Accessories:\n${accessories}\n\nThank you for choosing Bharath Cycle Hub!`;
    void send("whatsAppDispatchedSent", msg);
  };

  const sendDeliveredWhatsApp = () => {
    const reviewLink = data.googleReviewLink || "https://g.page/r/bharathcyclehub/review";
    let msg: string;
    if (templates.delivered) {
      msg = renderTemplate(templates.delivered, { customerName: data.customerName, reviewLink });
    } else if (isOutstationDelivery(data)) {
      msg = `Hello ${data.customerName},\n\nYour order from Bharath Cycle Hub has been delivered!\n\nWe hope you enjoy your new cycle. If you have any issues with assembly or setup, please don't hesitate to reach out.\n\nWe'd love your feedback:\n${reviewLink}\n\nThank you for choosing Bharath Cycle Hub!\n- Team BCH`;
    } else {
      msg = `Hello ${data.customerName},\n\nThank you for your purchase from Bharath Cycle Hub!\n\nWe'd love to hear about your experience. Please leave us a review:\n${reviewLink}\n\nThank you!\n- Bharath Cycle Hub`;
    }
    void send("whatsAppDeliveredSent", msg);
  };

  const showScheduled = data.status === "SCHEDULED";
  const showDispatched = ["OUT_FOR_DELIVERY", "SHIPPED", "IN_TRANSIT"].includes(data.status);
  const showDelivered = data.status === "DELIVERED";
  // A39: the customer's form moved it to SCHEDULED, and nobody has confirmed on WhatsApp yet.
  const scheduledByCustomerUnconfirmed = showScheduled && !!data.selfFillCompletedAt && !data.whatsAppScheduledSent;

  if (!showScheduled && !showDispatched && !showDelivered) return null;

  const sendButton = (field: SentField, label: string, onClick: () => void) => (
    <button
      type="button"
      onClick={onClick}
      disabled={busy !== null}
      className="w-full min-h-[44px] flex items-center justify-center gap-2 bg-green-600 text-white py-2 rounded-lg text-xs font-medium disabled:opacity-50"
    >
      <MessageCircle className="h-3.5 w-3.5" /> {busy === field ? "Marking as sent..." : label}
    </button>
  );

  const sentRow = (label: string) => (
    <div className="flex items-center gap-1.5">
      <Check className="h-3.5 w-3.5 text-green-600" />
      <p className="text-xs text-green-600">{label}</p>
    </div>
  );

  return (
    <Card className="mb-3 border-green-200 bg-green-50">
      <CardContent className="p-3 space-y-2">
        <div className="flex items-center gap-2">
          <MessageCircle className="h-4 w-4 text-green-600" />
          <p className="text-xs font-semibold text-green-900">WhatsApp Messages</p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-2 text-xs text-red-700">{error}</div>
        )}

        {scheduledByCustomerUnconfirmed && (
          <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg p-2">
            <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
            <p className="text-xs font-medium text-amber-800">Scheduled by customer – confirmation not sent</p>
          </div>
        )}

        {/* Scheduled message */}
        {showScheduled && (
          data.whatsAppScheduledSent
            ? sentRow("Scheduled msg sent")
            : sendButton("whatsAppScheduledSent", scheduledByCustomerUnconfirmed ? "Send Confirmation" : "Send Scheduled", sendScheduledWhatsApp)
        )}

        {/* Dispatched message */}
        {showDispatched && (
          data.whatsAppDispatchedSent
            ? sentRow("Dispatched msg sent")
            : sendButton("whatsAppDispatchedSent", "Send Dispatched", sendDispatchedWhatsApp)
        )}

        {/* Delivered message */}
        {showDelivered && (
          data.whatsAppDeliveredSent
            ? sentRow("Delivered msg sent")
            : sendButton("whatsAppDeliveredSent", "Send Delivered", sendDeliveredWhatsApp)
        )}
      </CardContent>
    </Card>
  );
}
