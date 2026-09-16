"use client";

import { useState, useEffect, useCallback, use } from "react";
import { Loader2, MapPin, Navigation, ChevronRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";
import { isValidMobile, samePhone } from "@/lib/phone";
import type { SlotDay } from "@/lib/deliveries/slots";
import { ContactCard, SlotPicker, SubmittedScreen } from "./_components/self-fill-parts";

/**
 * The customer's delivery form, opened from a WhatsApp link. PUBLIC — no session, no permission
 * check (CLAUDE.md "Routes that must stay public").
 *
 * Plan 1609-deliveries §2.8: main phone read-only (A10); alternate mandatory and different from
 * the main number (A11, A12); Bangalore picks a slot, outstation has no date (A27); once
 * submitted the link is locked and shows the thank-you screen (A7).
 */
const log = createLogger("fill:self-fill");

interface DeliveryInfo {
  invoiceNo: string;
  customerName: string;
  customerPhone: string | null;
  alternatePhone: string | null;
  customerAddress: string | null;
  customerArea: string | null;
  customerPincode: string | null;
  lineItems: Array<{ name: string; quantity: number }> | null;
  isOutstation: boolean;
  scheduledDate: string | null;
  selfFillCompletedAt: string | null;
  locked: boolean;
}

interface Submitted {
  outstation: boolean;
  scheduledDate: string | null;
}

const PINCODE_RE = /^\d{6}$/;
const inputBase = "w-full border rounded-lg p-3 text-sm focus:ring-2";

export default function CustomerSelfFillPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const deliveryUrl = `/api/public/delivery/${encodeURIComponent(token)}`;

  const [data, setData] = useState<DeliveryInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState<Submitted | null>(null);
  const [saving, setSaving] = useState(false);

  const [deliveryType, setDeliveryType] = useState<"BANGALORE" | "OUTSIDE" | null>(null);

  // One set of fields for both branches; each branch shows the ones it needs.
  const [address, setAddress] = useState("");
  const [area, setArea] = useState("");
  const [pincode, setPincode] = useState("");
  const [mapsLink, setMapsLink] = useState("");
  const [alternatePhone, setAlternatePhone] = useState("");
  const [deliveryNotes, setDeliveryNotes] = useState("");

  // Slot selection (Bangalore only)
  const [slots, setSlots] = useState<SlotDay[]>([]);
  const [nextAvailable, setNextAvailable] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsLoaded, setSlotsLoaded] = useState(false);
  const [slotsFailed, setSlotsFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await apiTry<DeliveryInfo>(deliveryUrl);
      if (cancelled) return;
      if (res.data) {
        const d = res.data;
        setData(d);
        setAddress(d.customerAddress || "");
        setArea(d.customerArea || "");
        setPincode(d.customerPincode || "");
        if (d.locked) setSubmitted({ outstation: d.isOutstation, scheduledDate: d.scheduledDate });
        log.info("self-fill form loaded", { locked: d.locked });
      } else {
        log.warn("self-fill form failed to load", { status: res.status });
        setLoadError(res.error || "Invalid or expired link");
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [deliveryUrl]);

  /** Fetch the calendar. `pickEarliest` moves the selection to the earliest open day. */
  const loadSlots = useCallback(async (pickEarliest: boolean) => {
    setSlotsLoading(true);
    setSlotsFailed(false);
    const res = await apiTry<{ slots: SlotDay[]; nextAvailable: string | null }>("/api/public/delivery-slots");
    if (res.data) {
      setSlots(res.data.slots);
      setNextAvailable(res.data.nextAvailable);
      if (pickEarliest) setSelectedDate(res.data.nextAvailable);
      setSlotsLoaded(true);
    } else {
      log.warn("delivery slots failed to load", { status: res.status });
      setSlotsFailed(true);
    }
    setSlotsLoading(false);
  }, []);

  const chooseType = (type: "BANGALORE" | "OUTSIDE") => {
    setDeliveryType(type);
    setError("");
    if (type === "BANGALORE" && !slotsLoaded && !slotsLoading) void loadSlots(true);
  };

  // ── Validation (mirrors the server) ──
  const mainPhone = data?.customerPhone ?? null;
  const altTrim = alternatePhone.trim();
  const altIsTen = /^\d{10}$/.test(altTrim) && isValidMobile(altTrim);
  const altSameAsMain = altIsTen && samePhone(altTrim, mainPhone);
  const alternateError = !altTrim
    ? null
    : !altIsTen
      ? "Enter a valid 10-digit alternate number."
      : altSameAsMain
        ? "The alternate number must be different from your main number."
        : null;
  const alternateValid = altIsTen && !altSameAsMain;

  const addressValid = address.trim().length >= 5 && address.trim().length <= 500;
  const pincodeValid = PINCODE_RE.test(pincode.trim());

  const bangaloreFormValid = addressValid && pincodeValid && alternateValid && selectedDate !== null;
  const outstationFormValid = addressValid && pincodeValid && alternateValid;

  const canSubmit =
    deliveryType === "BANGALORE" ? bangaloreFormValid : deliveryType === "OUTSIDE" ? outstationFormValid : false;

  const handleSubmit = async () => {
    if (!deliveryType || !canSubmit || saving) return;
    const outstation = deliveryType === "OUTSIDE";

    // No customerPhone: the main number is not the customer's to change here (A10).
    const payload = outstation
      ? {
          isOutstation: true,
          customerAddress: address.trim(),
          customerPincode: pincode.trim(),
          alternatePhone: altTrim,
          deliveryNotes: deliveryNotes.trim(),
        }
      : {
          isOutstation: false,
          customerAddress: address.trim(),
          customerArea: area.trim(),
          customerPincode: pincode.trim(),
          mapsLink: mapsLink.trim(),
          alternatePhone: altTrim,
          deliveryNotes: deliveryNotes.trim(),
          requestedDate: selectedDate,
        };

    setSaving(true);
    setError("");
    const res = await apiTry<{ saved: boolean; scheduledDate: string | null }>(deliveryUrl, {
      method: "PUT",
      json: payload,
    });
    setSaving(false);

    if (res.data) {
      log.info("self-fill submitted", { outstation });
      setSubmitted({ outstation, scheduledDate: res.data.scheduledDate });
      return;
    }

    log.warn("self-fill submit refused", { status: res.status, outstation });
    if (res.error?.includes("slot is now full")) {
      setError("This date just got fully booked. Please choose another date.");
      void loadSlots(true);
    } else {
      setError(res.error || "Failed to save. Please try again.");
      // A past or cut-off day: the calendar on screen is stale, so refresh it.
      if (!outstation && res.status === 409 && res.error?.includes("choose another date")) void loadSlots(true);
    }
  };

  // ── Loading state ──
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

  // ── Error state (no data) ──
  if (loadError || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <Card className="w-full max-w-md">
          <CardContent className="p-6 text-center">
            <p className="text-red-600 font-medium text-base">{loadError || "Invalid or expired link"}</p>
            <p className="text-slate-400 text-sm mt-2">
              This link may have expired. Please contact the store for a new link.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Submitted / locked ──
  if (submitted) {
    return (
      <SubmittedScreen
        invoiceNo={data.invoiceNo}
        outstation={submitted.outstation}
        scheduledDate={submitted.scheduledDate}
      />
    );
  }

  const isOutside = deliveryType === "OUTSIDE";
  const ring = isOutside ? "focus:ring-amber-400" : "focus:ring-blue-500 focus:border-blue-500";

  return (
    <div className="min-h-screen bg-slate-50 p-4 pb-10">
      <div className="max-w-md mx-auto space-y-4">
        {/* Store Header */}
        <div className="text-center py-4">
          <h1 className="text-lg font-bold text-slate-900">Bharath Cycle Hub</h1>
          <p className="text-sm text-slate-500">Delivery Details Form</p>
        </div>

        {/* Order Summary */}
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-slate-500 mb-1">Invoice</p>
            <p className="text-sm font-semibold text-slate-900 break-all">{data.invoiceNo}</p>
            <p className="text-sm text-slate-600 mt-1">{data.customerName}</p>
            {data.lineItems && data.lineItems.length > 0 && (
              <div className="mt-2 space-y-0.5">
                {data.lineItems.slice(0, 3).map((item, i) => (
                  <p key={i} className="text-xs text-slate-500">
                    {item.name} ×{item.quantity}
                  </p>
                ))}
                {data.lineItems.length > 3 && (
                  <p className="text-xs text-slate-400">+{data.lineItems.length - 3} more</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Error Banner */}
        {error && (
          <div role="alert" className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* ── STEP 0: Bangalore / Outside ── */}
        <Card>
          <CardContent className="p-4">
            <p className="text-sm font-bold text-slate-900 mb-3">Where should we deliver?</p>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => chooseType("BANGALORE")}
                className={`py-4 rounded-xl text-sm font-semibold border-2 transition-all ${
                  deliveryType === "BANGALORE"
                    ? "bg-blue-600 text-white border-blue-600"
                    : "bg-white text-slate-700 border-slate-200"
                }`}
              >
                🏙️ Inside Bangalore
              </button>
              <button
                onClick={() => chooseType("OUTSIDE")}
                className={`py-4 rounded-xl text-sm font-semibold border-2 transition-all ${
                  isOutside ? "bg-amber-600 text-white border-amber-600" : "bg-white text-slate-700 border-slate-200"
                }`}
              >
                🚚 Outside Bangalore
              </button>
            </div>
          </CardContent>
        </Card>

        {deliveryType && (
          <>
            {/* Address */}
            <Card>
              <CardContent className="p-4 space-y-4">
                <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <MapPin className={`h-4 w-4 ${isOutside ? "text-amber-500" : "text-blue-500"}`} /> Delivery Address
                </h2>

                <div>
                  <label htmlFor="address" className="text-xs font-medium text-slate-600 block mb-1">
                    {isOutside ? "Full Address (with city, state)" : "Full Address"}{" "}
                    <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    id="address"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    maxLength={500}
                    placeholder={isOutside ? "House no, street, area, city, state..." : "House no, street, landmark..."}
                    className={`${inputBase} border-slate-200 ${ring} resize-none ${
                      isOutside ? "min-h-[88px]" : "min-h-[72px]"
                    }`}
                  />
                </div>

                <div className={isOutside ? "" : "grid grid-cols-2 gap-3"}>
                  {!isOutside && (
                    <div>
                      <label htmlFor="area" className="text-xs font-medium text-slate-600 block mb-1">
                        Area
                      </label>
                      <input
                        id="area"
                        type="text"
                        value={area}
                        onChange={(e) => setArea(e.target.value)}
                        maxLength={100}
                        placeholder="e.g. Jayanagar"
                        className={`${inputBase} border-slate-200 ${ring}`}
                      />
                    </div>
                  )}
                  <div>
                    <label htmlFor="pincode" className="text-xs font-medium text-slate-600 block mb-1">
                      Pincode <span className="text-red-500">*</span>
                    </label>
                    <input
                      id="pincode"
                      type="text"
                      value={pincode}
                      onChange={(e) => setPincode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                      placeholder={isOutside ? "6-digit pincode" : "560011"}
                      maxLength={6}
                      inputMode="numeric"
                      className={`${inputBase} ${ring} ${
                        pincode && !pincodeValid ? "border-red-300 bg-red-50" : "border-slate-200"
                      }`}
                    />
                  </div>
                </div>

                {!isOutside && (
                  <div>
                    <label htmlFor="maps-link" className="text-xs font-medium text-slate-600 block mb-1">
                      Google Maps Location Link{" "}
                      <span className="text-slate-400 font-normal">(optional — share later if needed)</span>
                    </label>
                    <input
                      id="maps-link"
                      type="url"
                      value={mapsLink}
                      onChange={(e) => setMapsLink(e.target.value)}
                      maxLength={500}
                      placeholder="https://maps.app.goo.gl/..."
                      className={`${inputBase} border-slate-200 ${ring}`}
                      inputMode="url"
                    />
                    <p className="text-[11px] text-slate-400 mt-1">
                      Open Google Maps → tap &apos;Share&apos; → paste the link here
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            <ContactCard
              mainPhone={mainPhone}
              alternatePhone={alternatePhone}
              onAlternateChange={setAlternatePhone}
              alternateError={alternateError}
              accent={isOutside ? "amber" : "blue"}
            />

            {/* Instructions */}
            <Card>
              <CardContent className="p-4">
                <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2 mb-3">
                  <Navigation className="h-4 w-4 text-orange-500" />{" "}
                  {isOutside ? "Courier Instructions" : "Delivery Instructions"}
                </h2>
                <textarea
                  value={deliveryNotes}
                  onChange={(e) => setDeliveryNotes(e.target.value)}
                  maxLength={500}
                  aria-label={isOutside ? "Courier instructions" : "Delivery instructions"}
                  placeholder={
                    isOutside
                      ? "Any packing instructions, fragile items, assembly notes..."
                      : "Call before delivery, gate code, building number..."
                  }
                  className={`${inputBase} border-slate-200 ${ring} min-h-[60px] resize-none`}
                />
              </CardContent>
            </Card>

            {/* Date: Bangalore only (A27) */}
            {!isOutside && (
              <SlotPicker
                slots={slots}
                nextAvailable={nextAvailable}
                selectedDate={selectedDate}
                loading={slotsLoading}
                loadFailed={slotsFailed}
                onSelect={(date) => {
                  setSelectedDate(date);
                  setError("");
                }}
                onRetry={() => void loadSlots(true)}
              />
            )}

            {isOutside && (
              <p className="text-xs text-slate-500 px-1">
                The store will confirm the dispatch date with you after you submit.
              </p>
            )}

            {/* Submit */}
            <button
              onClick={handleSubmit}
              disabled={saving || !canSubmit}
              className={`w-full py-4 rounded-xl text-base font-semibold disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2 text-white ${
                isOutside ? "bg-amber-600 active:bg-amber-700" : "bg-blue-600 active:bg-blue-700"
              }`}
            >
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Saving...
                </>
              ) : (
                <>
                  <ChevronRight className="h-4 w-4" /> Submit Delivery Details
                </>
              )}
            </button>
          </>
        )}

        <p className="text-xs text-slate-400 text-center pb-4">Bharath Cycle Hub | Your details are secure</p>
      </div>
    </div>
  );
}
