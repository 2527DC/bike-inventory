"use client";

import { useState } from "react";
import { Clock, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";
import { toISTDateString, type SlotDay } from "@/lib/deliveries/slots";
import { DeliveryData } from "./types";

const log = createLogger("deliveries:date-editor");

interface DeliveryDateEditorProps {
  data: DeliveryData;
  deliveryId: string;
  onSaved: () => void;
  /** Kept for the caller's signature; the editor shows its own errors inline, next to the calendar. */
  onError?: (msg: string) => void;
}

const EDITABLE_STATUSES = ["SCHEDULED", "OUT_FOR_DELIVERY", "PACKED", "SHIPPED", "IN_TRANSIT"];

const REASON_TEXT: Record<"FULL" | "CUTOFF", string> = {
  FULL: "Full",
  CUTOFF: "Closed after 1 PM",
};

/** "Wed, 17 Sep" for an IST calendar day "YYYY-MM-DD". */
function dayLabel(date: string) {
  return new Date(`${date}T00:00:00+05:30`).toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "Asia/Kolkata",
  });
}

/**
 * The delivery date, and the staff editor for it (plan 1609 A36): the same 10-per-day slot
 * calendar the customer's form uses, so staff cannot overbook a day. Shown with no date too
 * when the delivery is SCHEDULED, because staff now schedule without one (A28).
 */
export function DeliveryDateEditor({ data, deliveryId, onSaved }: DeliveryDateEditorProps) {
  const [editing, setEditing] = useState(false);
  const [newDate, setNewDate] = useState("");
  const [slots, setSlots] = useState<SlotDay[] | null>(null);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  if (!data.scheduledDate && data.status !== "SCHEDULED") return null;

  const canEditDate = EDITABLE_STATUSES.includes(data.status) && !data.isDummy;
  const currentDay = data.scheduledDate ? toISTDateString(new Date(data.scheduledDate)) : null;
  const actionLabel = currentDay ? "Change delivery date" : "Set delivery date";

  const loadSlots = async () => {
    setSlotsLoading(true);
    const res = await apiTry<{ slots: SlotDay[]; nextAvailable: string | null }>("/api/public/delivery-slots");
    if (res.error) {
      log.warn("slot calendar not loaded", { deliveryId, httpStatus: res.status });
      setError(res.error);
    } else {
      setSlots(res.data?.slots ?? []);
    }
    setSlotsLoading(false);
  };

  const startEditing = () => {
    if (!canEditDate) return;
    setNewDate(currentDay ?? "");
    setError("");
    setSlots(null);
    setEditing(true);
    void loadSlots();
  };

  const handleSave = async () => {
    if (!newDate || newDate === currentDay) return;
    setSaving(true);
    setError("");
    const res = await apiTry(`/api/deliveries/${deliveryId}`, {
      method: "PUT",
      json: { scheduledDate: newDate },
    });
    setSaving(false);
    if (res.error) {
      // 409 when the day filled up, passed or closed since the calendar loaded — show why and
      // reload the calendar so the day is shown as it is now.
      log.warn("delivery date refused", { deliveryId, httpStatus: res.status });
      setError(res.error);
      void loadSlots();
      return;
    }
    log.info("delivery date saved", { deliveryId, hadDate: currentDay !== null });
    setEditing(false);
    onSaved();
  };

  const visibleSlots = (slots ?? []).filter((s) => s.reason !== "PAST");

  return (
    <Card className="mb-3">
      <CardContent className="p-3">
        {editing ? (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-slate-700">{actionLabel}</p>
            {currentDay && (
              <p className="text-[11px] text-slate-500">Current: {dayLabel(currentDay)}</p>
            )}

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-2 text-xs text-red-700">{error}</div>
            )}

            {slotsLoading && !slots ? (
              <div className="flex items-center gap-2 py-3 text-xs text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading available days...
              </div>
            ) : slots === null ? (
              <button type="button" onClick={() => { setError(""); void loadSlots(); }} className="text-xs text-blue-600 font-medium py-2">
                Retry loading days
              </button>
            ) : visibleSlots.length === 0 ? (
              <p className="text-xs text-slate-500 py-2">No delivery days available.</p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                {visibleSlots.map((slot) => {
                  const isCurrent = slot.date === currentDay;
                  const isSelected = slot.date === newDate && !isCurrent;
                  const disabled = !slot.available || isCurrent;
                  const sub = isCurrent
                    ? "Current date"
                    : slot.reason === "FULL" || slot.reason === "CUTOFF"
                      ? REASON_TEXT[slot.reason]
                      : `${slot.spotsLeft} slot${slot.spotsLeft === 1 ? "" : "s"} left`;
                  return (
                    <button
                      key={slot.date}
                      type="button"
                      disabled={disabled}
                      onClick={() => setNewDate(slot.date)}
                      className={`min-h-[44px] px-2 py-1.5 rounded-lg text-left border transition-colors ${
                        isSelected
                          ? "bg-blue-600 border-blue-600 text-white"
                          : isCurrent
                            ? "bg-blue-50 border-blue-300 text-blue-800"
                            : disabled
                              ? "bg-slate-50 border-slate-100 text-slate-400"
                              : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
                      }`}
                    >
                      <span className="block text-xs font-medium">{dayLabel(slot.date)}</span>
                      <span className={`block text-[11px] ${isSelected ? "text-blue-100" : ""}`}>{sub}</span>
                    </button>
                  );
                })}
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={handleSave}
                disabled={!newDate || newDate === currentDay || saving}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg text-xs font-medium disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save"}
              </button>
              <button
                type="button"
                onClick={() => setEditing(false)}
                disabled={saving}
                className="px-3 py-2 text-slate-500 text-xs"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            disabled={!canEditDate}
            onClick={startEditing}
            className={`w-full flex items-center gap-2 text-left ${canEditDate ? "cursor-pointer" : "cursor-default"}`}
          >
            <Clock className="h-4 w-4 text-blue-600 shrink-0" />
            <p className="text-xs text-slate-700">
              Delivery:{" "}
              <span className={`font-medium ${data.scheduledDate ? "" : "text-amber-700"}`}>
                {data.scheduledDate ? new Date(data.scheduledDate).toLocaleDateString("en-IN") : "date not set"}
              </span>
              {data.deliveryNotes && ` — ${data.deliveryNotes}`}
            </p>
            {canEditDate && (
              <span className="text-xs text-blue-500 ml-auto shrink-0">
                {data.scheduledDate ? "tap to change" : "Set delivery date"}
              </span>
            )}
          </button>
        )}
        {data.dispatchedAt && (
          <p className="text-xs text-slate-500 ml-6 mt-0.5">
            Dispatched: {new Date(data.dispatchedAt).toLocaleString("en-IN")}
          </p>
        )}
        {data.deliveredAt && (
          <p className="text-xs text-green-600 ml-6 mt-0.5">
            Delivered: {new Date(data.deliveredAt).toLocaleString("en-IN")}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
