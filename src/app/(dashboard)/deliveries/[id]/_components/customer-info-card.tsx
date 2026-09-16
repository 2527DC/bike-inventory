"use client";

// The customer card on the delivery detail and walk-out screens (plan 1609 §2.9).
//
// "Saved" means `Delivery.customerId` is set — a database row, the same on every device (A2).
// Save Customer writes to the database only: no vCard, no share sheet, no download (R5, A1).
// Staff may type or correct the phone before saving (B2); a wrong-length number is still saved
// as written (A3), so the length hint warns but never blocks.

import { useState } from "react";
import { Phone, MapPin, CheckCircle2, Loader2, UserPlus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";
import { isValidMobile } from "@/lib/phone";
import { DeliveryData, WALKOUT_STATUSES } from "./types";

const log = createLogger("deliveries:customer");

interface CustomerInfoCardProps {
  data: DeliveryData;
  /** Called after a successful save so the screen refetches and sees `customerId`. */
  onSaved: () => void;
}

interface SaveCustomerResult {
  customerId: string;
  name: string;
  phone: string;
  alreadyExisted: boolean;
}

function sameName(a: string | null | undefined, b: string | null | undefined) {
  return (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();
}

export function CustomerInfoCard({ data, onSaved }: CustomerInfoCardProps) {
  const isOuts = data.isOutstation;
  const [phone, setPhone] = useState(data.customerPhone ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<SaveCustomerResult | null>(null);

  const saved = !!data.customerId || !!result;
  const canSave = !saved && !data.isDummy && WALKOUT_STATUSES.includes(data.status);
  const hasDigits = /\d/.test(phone);
  const lengthHint = hasDigits && !isValidMobile(phone);

  const handleSave = async () => {
    if (saving || !hasDigits) return;
    setSaving(true);
    setError("");
    const res = await apiTry<SaveCustomerResult>(`/api/deliveries/${data.id}/customer`, {
      method: "POST",
      json: { phone: phone.trim() },
    });
    setSaving(false);
    if (res.error || !res.data) {
      log.warn("save customer refused", { deliveryId: data.id, status: res.status });
      setError(res.error || "Could not save the customer.");
      return;
    }
    log.info("customer saved", {
      deliveryId: data.id,
      customerId: res.data.customerId,
      alreadyExisted: res.data.alreadyExisted,
    });
    setResult(res.data);
    onSaved();
  };

  // What the green line says once saved. A fresh save reports what just happened; a reload
  // reports the linked row, naming it only when it differs from the name on the invoice.
  let savedText = "Customer saved";
  if (result?.alreadyExisted) savedText = `Already saved as ${result.name}`;
  else if (!result && data.customer && !sameName(data.customer.name, data.customerName)) {
    savedText = `Customer saved as ${data.customer.name}`;
  }

  return (
    <>
      <Card className={`mb-3 ${isOuts ? "border-amber-200" : ""}`}>
        <CardContent className="p-3 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-semibold text-slate-900 min-w-0 break-words">{data.customerName}</p>
            {data.customerPhone && (
              <a
                href={`tel:${data.customerPhone}`}
                className="flex items-center gap-1 text-xs text-blue-600 shrink-0 tabular-nums"
              >
                <Phone className="h-3.5 w-3.5" /> {data.customerPhone}
              </a>
            )}
          </div>
          {data.alternatePhone && (
            <p className="text-xs text-slate-500 tabular-nums">Alt: {data.alternatePhone}</p>
          )}
          {data.customerAddress && (
            <div className="flex items-start gap-1.5">
              <MapPin className="h-3.5 w-3.5 text-slate-400 mt-0.5 shrink-0" />
              <p className="text-xs text-slate-600">{data.customerAddress}</p>
            </div>
          )}
          {(data.customerArea || data.customerPincode) && (
            <p className="text-xs text-slate-500">
              {data.customerArea ? `Area: ${data.customerArea}` : ""}
              {data.customerArea && data.customerPincode ? " | " : ""}
              {data.customerPincode ? `Pincode: ${data.customerPincode}` : ""}
            </p>
          )}
          {saved && (
            <p className="flex items-center gap-1.5 text-xs font-medium text-green-700">
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 break-words">{savedText}</span>
            </p>
          )}
        </CardContent>
      </Card>

      {canSave && (
        <Card className="mb-3 border-blue-200 bg-blue-50">
          <CardContent className="p-3 space-y-2">
            <p className="text-xs text-blue-800 font-medium">
              Save the customer before scheduling, walk-out or sending the link
            </p>
            <div>
              <label htmlFor={`customer-phone-${data.id}`} className="block text-[11px] text-slate-600 mb-1">
                Customer phone
              </label>
              <Input
                id={`customer-phone-${data.id}`}
                type="tel"
                inputMode="tel"
                autoComplete="off"
                placeholder="+91-XXXXXXXXXX"
                value={phone}
                onChange={(e) => {
                  setPhone(e.target.value);
                  if (error) setError("");
                }}
                disabled={saving}
                className="h-11 tabular-nums"
              />
              {!hasDigits && (
                <p className="text-[11px] text-slate-500 mt-1">Enter the customer&apos;s phone number.</p>
              )}
              {lengthHint && (
                <p className="text-[11px] text-amber-700 mt-1">
                  This is not a 10-digit mobile number. It will be saved as written.
                </p>
              )}
            </div>
            {error && (
              <p className="text-xs text-red-600" role="alert">
                {error}
              </p>
            )}
            <button
              onClick={handleSave}
              disabled={saving || !hasDigits}
              className="w-full flex items-center justify-center gap-2 bg-blue-600 text-white py-2.5 min-h-[44px] rounded-lg text-sm font-medium disabled:opacity-50"
            >
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Saving...
                </>
              ) : (
                <>
                  <UserPlus className="h-4 w-4" /> Save Customer
                </>
              )}
            </button>
          </CardContent>
        </Card>
      )}
    </>
  );
}
