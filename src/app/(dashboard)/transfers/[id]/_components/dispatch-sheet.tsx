"use client";

import { useState, useEffect, useRef } from "react";
import { X, Loader2, AlertTriangle, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";

const log = createLogger("transfers:dispatch-sheet");

export interface DispatchResult {
  message: string;
  status: "IN_TRANSIT";
  consignmentValue: number;
  warnings: string[];
}

interface Props {
  open: boolean;
  orderId: string;
  orderNo: string;
  routeLabel: string;
  /** Σ qty × cost, but only for somebody holding `cost_price.view`. Null otherwise. */
  estimatedValue: number | null;
  /** True when the server says this consignment crosses the e-way threshold. */
  eWayBillLikely: boolean;
  existingEWayBillNo: string | null;
  onClose: () => void;
  onDispatched: (result: DispatchResult) => void;
}

/**
 * Dispatch: the van is leaving, and the stock leaves with it.
 *
 * ─── BUILT ON send-to-vendor-sheet, NOT reorder-sheet ─────────────────────────────────────
 *
 * `src/components/ui/bottom-sheet.tsx` does not exist — in P8 the owner chose not to add a
 * shared primitive, and both `reorder-sheet.tsx` and `send-to-vendor-sheet.tsx` carry that
 * decision in a comment. Of the two, this follows the send sheet, for the two reasons it
 * already documents and which apply here exactly:
 *
 *   `max-h-[90dvh]`, not `88vh`. Three text fields means the soft keyboard is up for most of
 *   this sheet's life, and `vh` does not shrink when it opens — so on a 360 px phone the
 *   footer, and therefore the Dispatch button, can sit below the fold.
 *
 *   The body scrolls and the footer is `shrink-0 pb-safe`, so Dispatch stays reachable.
 *
 * ─── AND IT STAYS OPEN WHEN THE SERVER REFUSES ────────────────────────────────────────────
 *
 * Every refusal this route can return is something to act on right here: the document is not
 * attached yet, the source no longer holds enough stock, somebody else dispatched it a moment
 * ago. Closing the sheet would throw away the vehicle number and transporter just typed, and
 * hide the sentence explaining why.
 */
export function DispatchSheet({
  open,
  orderId,
  orderNo,
  routeLabel,
  estimatedValue,
  eWayBillLikely,
  existingEWayBillNo,
  onClose,
  onDispatched,
}: Props) {
  const [vehicleNo, setVehicleNo] = useState("");
  const [transporterName, setTransporterName] = useState("");
  const [eWayBillNo, setEWayBillNo] = useState(existingEWayBillNo ?? "");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const firstFieldRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;
    triggerRef.current = document.activeElement;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !sending) onClose();
    };
    document.addEventListener("keydown", onKey);
    firstFieldRef.current?.focus();

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      (triggerRef.current as HTMLElement | null)?.focus?.();
    };
  }, [open, sending, onClose]);

  if (!open) return null;

  async function dispatch() {
    if (sending) return;
    setSending(true);
    setError(null);

    const { data, error: err } = await apiTry<DispatchResult>(
      `/api/transfer-orders/${orderId}/dispatch`,
      {
        method: "POST",
        json: {
          ...(vehicleNo.trim() ? { vehicleNo: vehicleNo.trim() } : {}),
          ...(transporterName.trim() ? { transporterName: transporterName.trim() } : {}),
          ...(eWayBillNo.trim() ? { eWayBillNo: eWayBillNo.trim() } : {}),
        },
      }
    );

    setSending(false);

    if (!data) {
      log.warn("dispatch failed", { orderId, message: err });
      setError(err ?? "Could not dispatch this transfer");
      return;
    }

    onDispatched(data);
  }

  const label = "block text-[11px] font-medium text-slate-500 uppercase tracking-wide mb-1";

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/40 sm:p-4"
      onClick={() => !sending && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Dispatch transfer"
        className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl max-h-[90dvh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between p-4 border-b border-slate-100 shrink-0">
          <div className="pr-3 min-w-0">
            <h2 className="text-base font-bold text-slate-900">Dispatch</h2>
            <p className="text-xs text-slate-500 mt-0.5 truncate tabular-nums">
              {orderNo} · {routeLabel}
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={sending}
            aria-label="Close"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center -mr-2 -mt-2 text-slate-400 hover:text-slate-600 disabled:opacity-50 focus-ring"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2.5">
            The stock leaves the source warehouse now and will not count anywhere until it is
            received. Dispatch cannot be undone — a van that comes back is recorded by receiving
            it short.
          </p>

          {/* The value is behind cost_price.view, because Σ qty × cost on a small transfer is
              trivially invertible into the unit cost. Everyone else sees only the obligation. */}
          {eWayBillLikely && (
            <div className="flex items-start gap-2 p-3 rounded-lg border border-blue-200 bg-blue-50">
              <AlertTriangle className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" />
              <p className="text-xs text-blue-800">
                {estimatedValue != null
                  ? `Value ≈ ₹${estimatedValue.toLocaleString("en-IN", { maximumFractionDigits: 0 })} — an e-way bill is required for this consignment.`
                  : "An e-way bill is required for this consignment."}
              </p>
            </div>
          )}

          <div>
            <label className={label} htmlFor="dispatch-vehicle">Vehicle number</label>
            <Input
              id="dispatch-vehicle"
              ref={firstFieldRef}
              value={vehicleNo}
              onChange={(e) => setVehicleNo(e.target.value.toUpperCase())}
              placeholder="KA 01 AB 1234"
              autoCapitalize="characters"
              className="min-h-[44px]"
            />
          </div>

          <div>
            <label className={label} htmlFor="dispatch-transporter">Transporter</label>
            <Input
              id="dispatch-transporter"
              value={transporterName}
              onChange={(e) => setTransporterName(e.target.value)}
              placeholder="Who is carrying it"
              className="min-h-[44px]"
            />
          </div>

          <div>
            <label className={label} htmlFor="dispatch-eway">E-way bill number</label>
            <Input
              id="dispatch-eway"
              value={eWayBillNo}
              onChange={(e) => setEWayBillNo(e.target.value)}
              placeholder="Optional"
              inputMode="numeric"
              className="min-h-[44px]"
            />
            <p className="text-[11px] text-slate-400 mt-1">
              Raised on the government portal, then typed here. Dispatch is not blocked without it.
            </p>
          </div>

          {error && (
            <div className="flex items-start gap-2 p-3 rounded-lg border border-red-200 bg-red-50">
              <AlertTriangle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
              <p className="text-xs text-red-700 break-words">{error}</p>
            </div>
          )}
        </div>

        <div className="flex gap-2 p-4 border-t border-slate-100 shrink-0 pb-safe">
          <Button variant="outline" onClick={onClose} disabled={sending} className="flex-1 min-h-[44px]">
            Cancel
          </Button>
          <Button onClick={dispatch} disabled={sending} className="flex-1 min-h-[44px]">
            {sending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <><Truck className="h-4 w-4 mr-1.5" /> Dispatch</>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default DispatchSheet;
