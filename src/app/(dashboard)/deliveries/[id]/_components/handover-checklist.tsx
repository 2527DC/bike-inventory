"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Package, Check } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";
import { DeliveryData, formatINR } from "./types";

const log = createLogger("deliveries:handover");

interface HandoverChecklistProps {
  data: DeliveryData;
  type: "WALK_OUT" | "DELIVERED";
  deliveryId: string;
  onConfirmed: () => void;
  onCancel: () => void;
  onConfirmation: (conf: {
    type: "success";
    title: string;
    referenceId: string;
    items: Array<{ label: string; value: string }>;
    details?: string;
  }) => void;
}

export function HandoverChecklist({
  data,
  type,
  deliveryId,
  onConfirmed,
  onCancel,
  onConfirmation,
}: HandoverChecklistProps) {
  const [checkedItems, setCheckedItems] = useState<Set<string>>(new Set());
  const [accessoriesConfirmed, setAccessoriesConfirmed] = useState(false);
  const [salesPersonConfirmed, setSalesPersonConfirmed] = useState(false);
  const [loading, setLoading] = useState(false);
  // The server refusal, shown inside the card. A floor-short WALK_OUT/DELIVERED comes back as
  // "Not enough stock of <item> … Transfer from godown first." (plan 1609 §1.8).
  const [error, setError] = useState("");

  const itemCount = data.lineItems?.length || 0;
  const allItemsChecked = itemCount === 0 || checkedItems.size >= itemCount;
  const allConfirmed = allItemsChecked && accessoriesConfirmed && salesPersonConfirmed;

  const handleConfirm = async () => {
    setLoading(true);
    setError("");
    try {
      const status = type === "WALK_OUT" ? "WALK_OUT" : "DELIVERED";
      const res = await apiTry(`/api/deliveries/${deliveryId}`, { method: "PUT", json: { status } });
      if (res.error) {
        log.warn("handover refused", { deliveryId, status, httpStatus: res.status });
        setError(res.error);
        return;
      }
      log.info("handover confirmed", { deliveryId, status });

      if (type === "WALK_OUT") {
        onConfirmation({
          type: "success",
          title: "Walk-out Complete",
          referenceId: data.invoiceNo,
          items: [
            { label: "Customer", value: data.customerName },
            { label: "Status", value: "Walk-out" },
            { label: "Items", value: `${itemCount} items` },
          ],
          details: "Customer took the cycle. Stock deducted.",
        });
      } else {
        // Auto-send delivered WhatsApp
        if (data.customerPhone) {
          const reviewLink = data.googleReviewLink || "https://g.page/r/bharathcyclehub/review";
          const msg = data.isOutstation
            ? `Hello ${data.customerName},\n\nYour order from Bharath Cycle Hub has been delivered!\n\nWe hope you enjoy your new cycle. If you have any issues with assembly or setup, please don't hesitate to reach out.\n\nWe'd love your feedback:\n${reviewLink}\n\nThank you for choosing Bharath Cycle Hub!\n- Team BCH`
            : `Hello ${data.customerName},\n\nThank you for your purchase from Bharath Cycle Hub!\n\nWe'd love to hear about your experience. Please leave us a review:\n${reviewLink}\n\nThank you!\n- Bharath Cycle Hub`;
          const cleanPhone = data.customerPhone.replace(/\D/g, "").slice(-10);
          window.open(`https://api.whatsapp.com/send?phone=91${cleanPhone}&text=${encodeURIComponent(msg)}`, "_blank");

          // Best effort: the delivery is already DELIVERED; a missed flag only affects the badge.
          const sent = await apiTry(`/api/deliveries/${deliveryId}`, {
            method: "PUT",
            json: { whatsAppDeliveredSent: true },
          });
          if (sent.error) log.warn("whatsAppDeliveredSent flag not saved", { deliveryId, httpStatus: sent.status });
        }

        onConfirmation({
          type: "success",
          title: "Delivered!",
          referenceId: data.invoiceNo,
          items: [
            { label: "Customer", value: data.customerName },
            { label: "Status", value: "Delivered" },
            { label: "Items", value: `${itemCount} items` },
          ],
        });
      }

      onConfirmed();
    } catch (e) {
      // apiTry never throws; this guards the WhatsApp window and the confirmation callbacks.
      const msg = e instanceof Error ? e.message : "Action failed";
      log.error("handover failed", { deliveryId, error: msg });
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    onCancel();
  };

  return (
    <Card className="mb-3 border-green-300 bg-green-50 ring-2 ring-green-300">
      <CardContent className="p-3 space-y-3">
        <p className="text-xs font-bold text-green-900">
          {type === "WALK_OUT" ? "Walk-out Handover Checklist" : "Delivery Handover Checklist"}
        </p>

        {data.paymentStatus?.hasPending && (
          <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg p-2">
            <AlertTriangle className="h-4 w-4 text-red-600 shrink-0" />
            <p className="text-xs text-red-700 font-medium">
              Payment pending: {formatINR(data.paymentStatus.balance)} balance
            </p>
          </div>
        )}

        {/* Line items -- each must be checked */}
        <div className="space-y-1.5">
          <p className="text-xs text-green-800 font-semibold uppercase">Items</p>
          {(data.lineItems || []).map((item, i) => {
            const key = `item-${i}`;
            return (
              <label
                key={key}
                className="flex items-center gap-2 bg-white rounded-lg px-2.5 py-2 border border-green-200 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={checkedItems.has(key)}
                  onChange={(e) => {
                    const next = new Set(checkedItems);
                    if (e.target.checked) next.add(key);
                    else next.delete(key);
                    setCheckedItems(next);
                  }}
                  className="rounded border-green-400 text-green-600 focus:ring-green-500"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-slate-900 truncate">{item.name}</p>
                  <p className="text-xs text-slate-500">{item.sku} | Qty: {item.quantity}</p>
                </div>
                <CheckCircle2
                  className={`h-4 w-4 shrink-0 ${checkedItems.has(key) ? "text-green-600" : "text-slate-200"}`}
                />
              </label>
            );
          })}
          {(!data.lineItems || data.lineItems.length === 0) && (
            <p className="text-xs text-slate-400 italic">No line items on this invoice</p>
          )}
        </div>

        {/* Accessories confirmation */}
        <label className="flex items-center gap-2 bg-white rounded-lg px-2.5 py-2 border border-blue-200 cursor-pointer">
          <input
            type="checkbox"
            checked={accessoriesConfirmed}
            onChange={(e) => setAccessoriesConfirmed(e.target.checked)}
            className="rounded border-blue-400 text-blue-600 focus:ring-blue-500"
          />
          <div className="flex-1">
            <p className="text-xs font-medium text-slate-900">Free accessories handed over</p>
            <p className="text-xs text-slate-500">
              {data.freeAccessories || "None specified"}
            </p>
          </div>
          <Package className={`h-4 w-4 shrink-0 ${accessoriesConfirmed ? "text-blue-600" : "text-slate-200"}`} />
        </label>

        {/* Sales person confirmation */}
        <label className="flex items-center gap-2 bg-white rounded-lg px-2.5 py-2 border border-purple-200 cursor-pointer">
          <input
            type="checkbox"
            checked={salesPersonConfirmed}
            onChange={(e) => setSalesPersonConfirmed(e.target.checked)}
            className="rounded border-purple-400 text-purple-600 focus:ring-purple-500"
          />
          <div className="flex-1">
            <p className="text-xs font-medium text-slate-900">Confirmed with sales person</p>
            <p className="text-xs text-slate-500">{data.salesPerson || "\u2014"}</p>
          </div>
          <Check className={`h-4 w-4 shrink-0 ${salesPersonConfirmed ? "text-purple-600" : "text-slate-200"}`} />
        </label>

        {error && (
          <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg p-2" role="alert">
            <AlertTriangle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
            <p className="text-xs text-red-700 font-medium">{error}</p>
          </div>
        )}

        {/* Confirm / Cancel */}
        <div className="flex gap-2">
          <button
            onClick={handleConfirm}
            disabled={!allConfirmed || loading}
            className={`flex-1 flex items-center justify-center gap-2 text-white py-2.5 rounded-lg text-sm font-medium disabled:opacity-40 ${
              type === "WALK_OUT" ? "bg-green-600" : "bg-green-700"
            }`}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="h-4 w-4" />
            )}
            {loading
              ? "Processing..."
              : allConfirmed
                ? type === "WALK_OUT"
                  ? "Confirm Walk-out"
                  : "Confirm Delivered"
                : `Check all items (${checkedItems.size + (accessoriesConfirmed ? 1 : 0) + (salesPersonConfirmed ? 1 : 0)}/${itemCount + 2})`}
          </button>
          <button
            onClick={handleCancel}
            className="px-4 py-2.5 bg-slate-100 text-slate-600 rounded-lg text-xs font-medium"
          >
            Cancel
          </button>
        </div>
      </CardContent>
    </Card>
  );
}
