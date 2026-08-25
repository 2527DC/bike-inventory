"use client";

import { useState } from "react";
import { AlertTriangle, Flag } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { DeliveryData } from "./types";

interface FlagSectionProps {
  data: DeliveryData;
  deliveryId: string;
  onFlagged: () => void;
  onResolved: () => void;
}

export function FlagSection({ data, deliveryId, onFlagged, onResolved: _onResolved }: FlagSectionProps) {
  const [flagModalOpen, setFlagModalOpen] = useState(false);
  const [flagReasonInput, setFlagReasonInput] = useState("");

  const [flagError, setFlagError] = useState("");

  const handleFlag = async (reason: string) => {
    setFlagError("");
    try {
      const res = await fetch(`/api/deliveries/${deliveryId}/flag`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const result = await res.json();
      if (!res.ok || !result.success) {
        setFlagError(result.error || "Flag failed");
        return;
      }
      if (result.data.alertPhones?.length > 0) {
        const phone = result.data.alertPhones[0].replace(/\D/g, "");
        window.open(
          `https://api.whatsapp.com/send?phone=${phone}&text=${encodeURIComponent(result.data.whatsappMessage)}`,
          "_blank"
        );
      }
      setFlagModalOpen(false);
      setFlagReasonInput("");
      onFlagged();
    } catch (e) {
      setFlagError(e instanceof Error ? e.message : "Flag failed");
    }
  };

  return (
    <>
      {/* Flag Banner (FLAGGED status) */}
      {data.status === "FLAGGED" && (
        <Card className="mb-3 border-red-200 bg-red-50">
          <CardContent className="p-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-600 shrink-0" />
              <div>
                <p className="text-sm font-medium text-red-900">Flagged</p>
                <p className="text-xs text-red-700">{data.flagReason}</p>
                {data.flaggedAt && (
                  <p className="text-xs text-red-500 mt-0.5">
                    {new Date(data.flaggedAt).toLocaleString("en-IN")}
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Flag button (only for PENDING) */}
      {data.status === "PENDING" && (
        <button
          onClick={() => setFlagModalOpen(true)}
          className="w-full flex items-center justify-center gap-2 bg-red-50 text-red-700 border border-red-200 py-2.5 rounded-lg text-sm font-medium mb-3"
        >
          <Flag className="h-4 w-4" /> Flag this Delivery
        </button>
      )}

      {/* Flag Modal */}
      {flagModalOpen && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => {
              setFlagModalOpen(false);
              setFlagReasonInput("");
            }}
          />
          <div className="relative w-full max-w-md bg-white rounded-t-2xl p-5 shadow-xl">
            <h3 className="text-lg font-semibold text-slate-900">Flag {data.invoiceNo}</h3>
            <p className="text-sm text-slate-600 mt-1">
              Enter the reason for flagging this delivery.
            </p>
            <textarea
              value={flagReasonInput}
              onChange={(e) => setFlagReasonInput(e.target.value)}
              placeholder="e.g. Customer not reachable, wrong address..."
              className="w-full mt-3 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-400 resize-none"
              rows={3}
              autoFocus
            />
            {flagError && <p className="text-xs text-red-600 mt-2">{flagError}</p>}
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => handleFlag(flagReasonInput)}
                disabled={!flagReasonInput.trim()}
                className="flex-1 h-12 bg-red-600 text-white rounded-xl font-semibold disabled:opacity-50"
              >
                Flag Delivery
              </button>
              <button
                onClick={() => {
                  setFlagModalOpen(false);
                  setFlagReasonInput("");
                }}
                className="flex-1 h-12 bg-slate-100 text-slate-700 rounded-xl font-semibold"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
