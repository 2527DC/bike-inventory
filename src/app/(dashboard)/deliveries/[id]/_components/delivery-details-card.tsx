"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { DeliveryData, isOutstationDelivery } from "./types";

interface DeliveryDetailsCardProps {
  data: DeliveryData;
  deliveryId: string;
  onSaved: () => void;
  onError: (msg: string) => void;
}

export function DeliveryDetailsCard({ data, deliveryId, onSaved, onError }: DeliveryDetailsCardProps) {
  const [editPincode, setEditPincode] = useState(data.customerPincode || "");
  const [editAddress, setEditAddress] = useState(data.customerAddress || "");
  const [editAltPhone, setEditAltPhone] = useState(data.alternatePhone || "");
  const [loading, setLoading] = useState(false);

  if (data.status !== "SCHEDULED") return null;

  const isOuts = isOutstationDelivery(data);

  const handleSave = async () => {
    setLoading(true);
    try {
      await fetch(`/api/deliveries/${deliveryId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerPincode: editPincode.trim() || undefined,
          ...(isOuts
            ? {
                customerAddress: editAddress.trim() || undefined,
                alternatePhone: editAltPhone.trim() || undefined,
              }
            : {}),
        }),
      });
      onSaved();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className={`mb-3 ${isOuts ? "border-amber-200" : "border-slate-200"}`}>
      <CardContent className="p-3 space-y-2">
        <p className="text-xs font-semibold text-slate-700">
          {isOuts ? "Outstation Delivery Details" : "Delivery Details"}
        </p>
        <div>
          <label className="text-xs text-slate-500">{isOuts ? "Delivery Address *" : "Pincode *"}</label>
          {isOuts ? (
            <textarea
              value={editAddress}
              onChange={(e) => setEditAddress(e.target.value)}
              placeholder="House no, street, area, city, state"
              className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-slate-300 resize-none"
              rows={2}
            />
          ) : (
            <Input
              value={editPincode}
              onChange={(e) => setEditPincode(e.target.value)}
              placeholder="e.g. 560001"
              className="text-xs"
              inputMode="numeric"
              maxLength={6}
            />
          )}
        </div>
        {isOuts && (
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
        )}
        <button
          onClick={handleSave}
          disabled={loading}
          className="w-full bg-slate-800 text-white py-2 rounded-lg text-xs font-medium disabled:opacity-50"
        >
          {loading ? "Saving..." : "Update Details"}
        </button>
      </CardContent>
    </Card>
  );
}
