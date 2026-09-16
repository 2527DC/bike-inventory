"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";
import { whatsappDigits } from "@/lib/phone";
import { DeliveryData, StockShortLine, isOutstationDelivery } from "./types";
import { ZonePicker, ReadOnlyField } from "./schedule-form-parts";

const log = createLogger("deliveries:schedule");

interface ScheduleFormProps {
  data: DeliveryData;
  deliveryId: string;
  templates: Record<string, string>;
  /** Receives the floor lines that could not be held (empty when the stock is held). */
  onScheduled: (stockShort: StockShortLine[]) => void;
  onCancel: () => void;
  onConfirmation: (conf: {
    type: "success";
    title: string;
    referenceId: string;
    items: Array<{ label: string; value: string }>;
  }) => void;
}

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

export function ScheduleForm({ data, deliveryId, templates, onScheduled, onCancel, onConfirmation }: ScheduleFormProps) {
  // A30: a row with a zone schedules only on that side; the toggle exists only when it is not chosen.
  const fixedZone = data.deliveryZone;
  const [isOutstation, setIsOutstation] = useState(fixedZone ? fixedZone === "OUTSTATION" : isOutstationDelivery(data));
  const [editPincode, setEditPincode] = useState(data.customerPincode || "");
  const [editAddress, setEditAddress] = useState(data.customerAddress || "");
  const [editAltPhone, setEditAltPhone] = useState(data.alternatePhone || "");
  const [delNotes, setDelNotes] = useState(data.deliveryNotes || "");
  const [freeAccessories, setFreeAccessories] = useState(data.freeAccessories || "");
  const [reversePickup, setReversePickup] = useState(data.reversePickup || false);
  const [mapsLink, setMapsLink] = useState(data.mapsLink || "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const getProductName = () => {
    if (!data.lineItems || data.lineItems.length === 0) return "your order";
    return data.lineItems.map((item) => item.name).join(", ");
  };

  const handleSubmit = async () => {
    if (!isOutstation && !/^\d{6}$/.test(editPincode.trim())) {
      setError("Pincode is required for Bangalore deliveries (6 digits)");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const payload: Record<string, unknown> = {
        status: "SCHEDULED",
        deliveryNotes: delNotes,
        // deliveryZone is the truth (T6); isOutstation is still sent for the older server logic.
        deliveryZone: isOutstation ? "OUTSTATION" : "BANGALORE",
        isOutstation,
        alternatePhone: editAltPhone.trim() || undefined,
        freeAccessories: freeAccessories.trim() || undefined,
        mapsLink: mapsLink.trim() || undefined,
        ...(isOutstation
          ? { customerAddress: editAddress.trim() || undefined }
          : {
              customerPincode: editPincode.trim() || undefined,
              reversePickup,
            }),
      };
      const res = await apiTry<{ stockShort?: StockShortLine[] }>(`/api/deliveries/${deliveryId}`, {
        method: "PUT",
        json: payload,
      });
      if (res.error) {
        log.warn("schedule refused", { deliveryId, httpStatus: res.status });
        setError(res.error);
        return;
      }
      const stockShort = res.data?.stockShort ?? [];
      // R27, A28: staff schedule without a date. Only the customer's form, or the slot
      // calendar in the date editor, sets one — so show the row's date if it already has one.
      const dateText = data.scheduledDate ? new Date(data.scheduledDate).toLocaleDateString("en-IN") : null;
      log.info("delivery scheduled", { deliveryId, shortLines: stockShort.length, hasDate: dateText !== null });

      onConfirmation({
        type: "success",
        title: "Delivery Scheduled",
        referenceId: data.invoiceNo,
        items: [
          { label: "Customer", value: data.customerName },
          { label: "Delivery Date", value: dateText ?? "To be confirmed" },
          { label: "Type", value: isOutstation ? "Outstation" : "Bangalore" },
        ],
      });

      // Auto-trigger WhatsApp scheduled message
      if (data.customerPhone) {
        const date = dateText ?? "to be confirmed";
        const productName = getProductName();
        const msg = templates.scheduled
          ? renderTemplate(templates.scheduled, { customerName: data.customerName, productName, deliveryDate: date })
          : `Hello ${data.customerName},\n\nYour order from Bharath Cycle Hub has been scheduled for delivery.\n\nProduct: ${productName}\nDelivery Date: ${date}\n\nPlease share your delivery location on WhatsApp so our rider can reach you.\n\nThank you!\n- Bharath Cycle Hub`;
        if (openWhatsApp(data.customerPhone, msg)) {
          // Mark WhatsApp as sent
          const sent = await apiTry(`/api/deliveries/${deliveryId}`, {
            method: "PUT",
            json: { whatsAppScheduledSent: true },
          });
          if (sent.error) log.warn("whatsAppScheduledSent flag not saved", { deliveryId, httpStatus: sent.status });
        } else {
          log.warn("scheduled WhatsApp not opened: the phone has no digits", { deliveryId });
        }
      }

      onScheduled(stockShort);
    } catch (e) {
      // apiTry never throws; this guards the WhatsApp window and the confirmation callback.
      const msg = e instanceof Error ? e.message : "Schedule failed";
      log.error("schedule failed", { deliveryId, error: msg });
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className={`mb-3 ${isOutstation ? "border-amber-200" : "border-blue-200"}`}>
      <CardContent className="p-3 space-y-3">
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-2 text-xs text-red-700">
            {error}
          </div>
        )}

        {/* The row's zone decides the side; both only when not chosen yet (A30) */}
        <ZonePicker fixedZone={fixedZone} isOutstation={isOutstation} onChange={setIsOutstation} />

        {/* Auto-populated */}
        <ReadOnlyField label="Invoice Number" value={data.invoiceNo} />
        <ReadOnlyField label="Product Name" value={data.lineItems?.map((i) => i.name).join(", ") || "\u2014"} />
        <ReadOnlyField label="Sales Person" value={data.salesPerson || "\u2014"} />

        {/* Alternate Phone */}
        <div>
          <label className="text-xs text-slate-500">Alternate Phone</label>
          <Input
            value={editAltPhone}
            onChange={(e) => setEditAltPhone(e.target.value)}
            placeholder="Alternate contact number"
            className="text-xs"
            inputMode="tel"
          />
        </div>

        {/* Inside Bangalore specific fields */}
        {!isOutstation && (
          <>
            <div>
              <label className="text-xs text-slate-500">
                Pincode <span className="text-red-500">*</span>
              </label>
              <Input
                value={editPincode}
                onChange={(e) => setEditPincode(e.target.value)}
                placeholder="e.g. 560064"
                className={`text-xs ${editPincode && !/^\d{6}$/.test(editPincode) ? "border-red-300" : ""}`}
                inputMode="numeric"
                maxLength={6}
              />
              {editPincode && !/^\d{6}$/.test(editPincode) && (
                <p className="text-[11px] text-red-500 mt-0.5">Must be 6 digits</p>
              )}
            </div>
            <div>
              <label className="text-xs text-slate-500">Free Accessories</label>
              <Input
                value={freeAccessories}
                onChange={(e) => setFreeAccessories(e.target.value)}
                placeholder="e.g. Lock, Bell, Pump, Toolkit"
                className="text-xs"
              />
            </div>
            <label className="flex items-center gap-2 py-1 cursor-pointer">
              <input
                type="checkbox"
                checked={reversePickup}
                onChange={(e) => setReversePickup(e.target.checked)}
                className="rounded border-slate-300"
              />
              <span className="text-xs font-medium text-slate-700">
                Reverse Pickup (exchange old cycle)
              </span>
            </label>
          </>
        )}

        {/* Outside Bangalore specific fields */}
        {isOutstation && (
          <>
            <div>
              <label className="text-xs text-slate-500">Delivery Address *</label>
              <textarea
                value={editAddress}
                onChange={(e) => setEditAddress(e.target.value)}
                placeholder="House no, street, area, city, state, pincode"
                className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-slate-300 resize-none"
                rows={2}
              />
            </div>
            <div>
              <label className="text-xs text-slate-500">Free Accessories</label>
              <Input
                value={freeAccessories}
                onChange={(e) => setFreeAccessories(e.target.value)}
                placeholder="e.g. Lock, Bell, Pump, Toolkit"
                className="text-xs"
              />
            </div>
          </>
        )}

        {/* Google Maps Link */}
        <div>
          <label className="text-xs text-slate-500">
            Google Maps Link {mapsLink ? "✓" : <span className="text-amber-600">(needed before dispatch)</span>}
          </label>
          <Input
            value={mapsLink}
            onChange={(e) => setMapsLink(e.target.value)}
            placeholder="https://maps.app.goo.gl/..."
            className="text-xs"
            type="url"
          />
        </div>

        {/* Delivery Notes */}
        <div>
          <label className="text-xs text-slate-500">Delivery Notes</label>
          <Input
            value={delNotes}
            onChange={(e) => setDelNotes(e.target.value)}
            placeholder="Landmark, instructions..."
            className="text-xs"
          />
        </div>

        {/* Submit */}
        <div className="flex gap-2">
          <button
            onClick={handleSubmit}
            disabled={loading}
            className={`flex-1 text-white py-2.5 rounded-lg text-xs font-medium disabled:opacity-50 ${
              isOutstation ? "bg-amber-600" : "bg-blue-600"
            }`}
          >
            {loading ? "Scheduling..." : "Schedule Delivery"}
          </button>
          <button
            onClick={onCancel}
            className="px-4 py-2.5 bg-slate-100 text-slate-600 rounded-lg text-xs font-medium"
          >
            Cancel
          </button>
        </div>
      </CardContent>
    </Card>
  );
}
