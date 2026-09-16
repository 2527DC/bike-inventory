"use client";

import { CheckCircle2, Loader2, Phone, Calendar } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { toISTDateString, type SlotDay } from "@/lib/deliveries/slots";

/**
 * Pieces of the customer's self-fill form (`/fill/[token]`), split out to keep the page short.
 * Public page — no session, no permissions.
 */

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "YYYY-MM-DD" → "Wed 17 Sep". */
export function formatSlotDate(dateStr: string) {
  const d = new Date(dateStr + "T00:00:00");
  return `${DAY_LABELS[d.getDay()]} ${d.getDate()} ${MONTH_LABELS[d.getMonth()]}`;
}

/** A stored `scheduledDate` (start of the IST day, as ISO) → "Wed 17 Sep". */
export function formatScheduledDate(iso: string) {
  return formatSlotDate(toISTDateString(new Date(iso)));
}

// ── Contact details: main phone read-only (A10), alternate mandatory (A11, A12) ──

export function ContactCard({
  mainPhone,
  alternatePhone,
  onAlternateChange,
  alternateError,
  accent,
}: {
  mainPhone: string | null;
  alternatePhone: string;
  onAlternateChange: (digits: string) => void;
  alternateError: string | null;
  accent: "blue" | "amber";
}) {
  const ring = accent === "amber" ? "focus:ring-amber-400" : "focus:ring-blue-500 focus:border-blue-500";
  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
          <Phone className="h-4 w-4 text-green-500" /> Contact Details
        </h2>
        <div>
          <p className="text-xs font-medium text-slate-600 mb-1">Phone Number</p>
          <p className="text-sm font-semibold text-slate-900 break-all">{mainPhone ?? "Not on file"}</p>
          <p className="text-[11px] text-slate-400 mt-0.5">To change this number, please contact the store.</p>
        </div>
        <div>
          <label htmlFor="alternate-phone" className="text-xs font-medium text-slate-600 block mb-1">
            Alternate Phone <span className="text-red-500">*</span>
          </label>
          <input
            id="alternate-phone"
            type="tel"
            value={alternatePhone}
            onChange={(e) => onAlternateChange(e.target.value.replace(/\D/g, "").slice(0, 10))}
            placeholder="10-digit mobile number"
            maxLength={10}
            inputMode="numeric"
            autoComplete="tel-national"
            aria-invalid={alternateError ? true : undefined}
            className={`w-full border rounded-lg p-3 text-sm focus:ring-2 ${ring} ${
              alternateError ? "border-red-300 bg-red-50" : "border-slate-200"
            }`}
          />
          {alternateError ? (
            <p className="text-xs text-red-600 mt-1">{alternateError}</p>
          ) : (
            <p className="text-[11px] text-slate-400 mt-1">A different number we can reach if the main one is busy.</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Slot picker (Bangalore only) ──

export function SlotPicker({
  slots,
  nextAvailable,
  selectedDate,
  loading,
  loadFailed,
  onSelect,
  onRetry,
}: {
  slots: SlotDay[];
  nextAvailable: string | null;
  selectedDate: string | null;
  loading: boolean;
  loadFailed: boolean;
  onSelect: (date: string) => void;
  onRetry: () => void;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2 mb-1">
          <Calendar className="h-4 w-4 text-purple-500" /> Choose Delivery Date{" "}
          <span className="text-red-500 font-normal text-xs">*</span>
        </h2>
        <p className="text-xs text-slate-500 mb-3">Delivery at 6:00 PM. Max 10 deliveries per day.</p>

        {loading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
          </div>
        ) : loadFailed ? (
          <div className="text-center py-2">
            <p className="text-xs text-red-600">Could not load delivery dates.</p>
            <button onClick={onRetry} className="mt-2 min-h-[44px] px-4 text-sm font-medium text-blue-600">
              Try again
            </button>
          </div>
        ) : (
          <>
            {nextAvailable ? (
              <p className="text-xs text-green-700 font-medium mb-2">
                ✓ Earliest available: {formatSlotDate(nextAvailable)}
              </p>
            ) : (
              <p className="text-xs text-amber-700 font-medium mb-2">
                No dates are open right now. Please contact the store.
              </p>
            )}
            <div className="grid grid-cols-2 gap-2">
              {slots
                .filter((s) => s.reason !== "PAST")
                .slice(0, 10)
                .map((slot) => (
                  <button
                    key={slot.date}
                    disabled={!slot.available}
                    onClick={() => onSelect(slot.date)}
                    className={`py-3 px-3 rounded-xl text-xs font-medium text-left transition-all border-2 ${
                      !slot.available
                        ? "bg-slate-100 text-slate-400 border-slate-100 cursor-not-allowed"
                        : selectedDate === slot.date
                          ? "bg-blue-600 text-white border-blue-600"
                          : "bg-white text-slate-700 border-slate-200 active:bg-blue-50"
                    }`}
                  >
                    <span className="block font-semibold">{formatSlotDate(slot.date)}</span>
                    <span className="block text-[10px] mt-0.5">
                      {!slot.available
                        ? slot.reason === "FULL"
                          ? "Full"
                          : slot.reason === "CUTOFF"
                            ? "Cutoff passed"
                            : ""
                        : `${slot.spotsLeft} slot${slot.spotsLeft === 1 ? "" : "s"} left`}
                    </span>
                  </button>
                ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ── The submitted / locked screen (A7) ──

export function SubmittedScreen({
  invoiceNo,
  outstation,
  scheduledDate,
}: {
  invoiceNo: string | null;
  outstation: boolean;
  scheduledDate: string | null;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <Card className="w-full max-w-md">
        <CardContent className="p-6 text-center">
          <CheckCircle2 className="h-16 w-16 text-green-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-slate-900 mb-2">Thank You!</h2>
          <p className="text-slate-600 text-sm">Your delivery details have been saved.</p>
          {outstation ? (
            <div className="mt-4 bg-amber-50 rounded-lg p-3 text-left">
              <p className="text-xs text-amber-700 font-medium">Dispatch</p>
              <p className="text-sm font-semibold text-amber-900">The store will confirm the dispatch with you.</p>
            </div>
          ) : scheduledDate ? (
            <div className="mt-4 bg-blue-50 rounded-lg p-3 text-left">
              <p className="text-xs text-blue-600 font-medium">Delivery Date</p>
              <p className="text-sm font-semibold text-blue-900">{formatScheduledDate(scheduledDate)} at 6:00 PM</p>
            </div>
          ) : (
            <p className="text-slate-600 text-sm mt-2">Our team will contact you before the delivery.</p>
          )}
          {invoiceNo && (
            <div className="mt-3 bg-slate-50 rounded-lg p-3 text-left">
              <p className="text-xs text-slate-500">Invoice</p>
              <p className="text-sm font-medium text-slate-900 break-all">{invoiceNo}</p>
            </div>
          )}
          <p className="text-xs text-slate-400 mt-4">To change these details, please contact the store.</p>
        </CardContent>
      </Card>
    </div>
  );
}
