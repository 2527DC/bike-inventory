"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { DeliveryData } from "./types";

interface ScheduleFormProps {
  data: DeliveryData;
  deliveryId: string;
  templates: Record<string, string>;
  onScheduled: () => void;
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

function openWhatsApp(phone: string, message: string) {
  const cleanPhone = phone.replace(/\D/g, "").slice(-10);
  const encodedMsg = encodeURIComponent(message);
  window.open(`https://api.whatsapp.com/send?phone=91${cleanPhone}&text=${encodedMsg}`, "_blank");
}

export function ScheduleForm({ data, deliveryId, templates, onScheduled, onCancel, onConfirmation }: ScheduleFormProps) {
  const [isOutstation, setIsOutstation] = useState(data.isOutstation || false);
  const [schedDate, setSchedDate] = useState("");
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
    if (!schedDate) return;
    if (!isOutstation && !/^\d{6}$/.test(editPincode.trim())) {
      setError("Pincode is required for Bangalore deliveries (6 digits)");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const payload: Record<string, unknown> = {
        status: "SCHEDULED",
        scheduledDate: schedDate,
        deliveryNotes: delNotes,
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
      const res = await fetch(`/api/deliveries/${deliveryId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setError(json.error || "Schedule failed");
        return;
      }

      onConfirmation({
        type: "success",
        title: "Delivery Scheduled",
        referenceId: data.invoiceNo,
        items: [
          { label: "Customer", value: data.customerName },
          { label: "Delivery Date", value: new Date(schedDate).toLocaleDateString("en-IN") },
          { label: "Type", value: isOutstation ? "Outstation" : "Bangalore" },
        ],
      });

      // Auto-trigger WhatsApp scheduled message
      if (data.customerPhone) {
        const date = new Date(schedDate).toLocaleDateString("en-IN");
        const productName = getProductName();
        const msg = templates.scheduled
          ? renderTemplate(templates.scheduled, { customerName: data.customerName, productName, deliveryDate: date })
          : `Hello ${data.customerName},\n\nYour order from Bharath Cycle Hub has been scheduled for delivery.\n\nProduct: ${productName}\nDelivery Date: ${date}\n\nPlease share your delivery location on WhatsApp so our rider can reach you.\n\nThank you!\n- Bharath Cycle Hub`;
        openWhatsApp(data.customerPhone, msg);

        // Mark WhatsApp as sent
        try {
          await fetch(`/api/deliveries/${deliveryId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ whatsAppScheduledSent: true }),
          });
        } catch { /* silent */ }
      }

      onScheduled();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Schedule failed");
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

        {/* Toggle: Inside / Outside Bangalore */}
        <div className="flex rounded-lg overflow-hidden border border-slate-200">
          <button
            type="button"
            onClick={() => setIsOutstation(false)}
            className={`flex-1 py-2 text-xs font-medium transition-colors ${
              !isOutstation ? "bg-blue-600 text-white" : "bg-slate-50 text-slate-600"
            }`}
          >
            Inside Bangalore
          </button>
          <button
            type="button"
            onClick={() => setIsOutstation(true)}
            className={`flex-1 py-2 text-xs font-medium transition-colors ${
              isOutstation ? "bg-amber-600 text-white" : "bg-slate-50 text-slate-600"
            }`}
          >
            Outside Bangalore
          </button>
        </div>

        {/* Auto-populated: Invoice Number */}
        <div>
          <label className="text-xs text-slate-500">Invoice Number</label>
          <div className="text-xs font-medium text-slate-900 bg-slate-50 rounded-lg px-3 py-2 border border-slate-100">
            {data.invoiceNo}
          </div>
        </div>

        {/* Auto-populated: Product Name */}
        <div>
          <label className="text-xs text-slate-500">Product Name</label>
          <div className="text-xs font-medium text-slate-900 bg-slate-50 rounded-lg px-3 py-2 border border-slate-100">
            {data.lineItems?.map((i) => i.name).join(", ") || "\u2014"}
          </div>
        </div>

        {/* Auto-populated: Sales Person */}
        <div>
          <label className="text-xs text-slate-500">Sales Person</label>
          <div className="text-xs font-medium text-slate-900 bg-slate-50 rounded-lg px-3 py-2 border border-slate-100">
            {data.salesPerson || "\u2014"}
          </div>
        </div>

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

        {/* Estimated Delivery Date */}
        <div>
          <label className="text-xs text-slate-500">Estimated Delivery *</label>
          <div className="grid grid-cols-3 gap-1.5 mt-1">
            {[
              { label: "Today", days: 0 },
              { label: "Tomorrow", days: 1 },
              { label: "After 3 days", days: 3 },
              { label: "After a week", days: 7 },
              { label: "After a month", days: 30 },
            ].map((opt) => {
              const d = new Date();
              d.setDate(d.getDate() + opt.days);
              const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
              return (
                <button
                  key={opt.label}
                  type="button"
                  onClick={() => setSchedDate(val)}
                  className={`px-2 py-2 rounded-lg text-xs font-medium transition-colors ${
                    schedDate === val
                      ? isOutstation
                        ? "bg-amber-600 text-white"
                        : "bg-blue-600 text-white"
                      : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
          {schedDate && (
            <p className={`text-xs mt-1 ${isOutstation ? "text-amber-600" : "text-blue-600"}`}>
              Selected:{" "}
              {new Date(schedDate + "T00:00:00").toLocaleDateString("en-IN", {
                weekday: "short",
                day: "numeric",
                month: "short",
              })}
            </p>
          )}
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
            disabled={!schedDate || loading}
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
