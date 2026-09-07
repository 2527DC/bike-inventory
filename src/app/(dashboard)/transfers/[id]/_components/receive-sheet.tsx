"use client";

import { useState, useEffect, useRef } from "react";
import { X, Loader2, AlertTriangle, PackageCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";

const log = createLogger("transfers:receive-sheet");

export interface ReceiveLine {
  id: string;
  quantity: number;
  productName: string;
  sku: string;
}

export interface ReceiveResult {
  message: string;
  status: "RECEIVED";
  shortLines: number;
}

interface Props {
  open: boolean;
  orderId: string;
  orderNo: string;
  lines: ReceiveLine[];
  onClose: () => void;
  onReceived: (result: ReceiveResult) => void;
}

/**
 * Receive the van: how much of each line actually arrived.
 *
 * ─── WHY THIS HAS A STEPPER WHEN INBOUND DOES NOT ─────────────────────────────────────────
 *
 * The plan says to follow `inbound/[id]` "as rewritten in P7". Inbound has no stepper — it
 * receives a whole line in one tap and its confirm sheet says so out loud: *"Short or damaged?
 * Cancel and use Report Issue instead — receiving records the full billed quantity."* That is
 * right for inbound, where a shortfall is a dispute with a VENDOR and belongs in a vendor issue
 * with photographs attached.
 *
 * A transfer has no vendor. Both ends are ours, the stock has already left one of our own
 * warehouses, and if nine of ten arrive the tenth is simply gone. There is nobody to raise an
 * issue against, so the shortfall has to be recordable at the point of receipt — otherwise the
 * only options are to lie (receive ten) or to strand the order in transit forever.
 *
 * Defaulted to the full dispatched quantity, because "it all arrived" is the overwhelmingly
 * common case and should take zero taps.
 */
export function ReceiveSheet({ open, orderId, orderNo, lines, onClose, onReceived }: Props) {
  const [received, setReceived] = useState<Record<string, number>>(() =>
    Object.fromEntries(lines.map((l) => [l.id, l.quantity]))
  );
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingShort, setConfirmingShort] = useState(false);

  const triggerRef = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;
    triggerRef.current = document.activeElement;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !saving) onClose();
    };
    document.addEventListener("keydown", onKey);

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      (triggerRef.current as HTMLElement | null)?.focus?.();
    };
  }, [open, saving, onClose]);

  if (!open) return null;

  const shortLines = lines.filter((l) => (received[l.id] ?? l.quantity) < l.quantity);
  const totalShort = shortLines.reduce((sum, l) => sum + (l.quantity - (received[l.id] ?? l.quantity)), 0);

  function setQty(id: string, qty: number, max: number) {
    setReceived((prev) => ({ ...prev, [id]: Math.max(0, Math.min(max, qty)) }));
    setConfirmingShort(false);
  }

  async function submit() {
    if (saving) return;

    // A shortfall means units are gone for good — no vendor to claim from, no reversal. Worth
    // one deliberate second press, and only when there IS one.
    if (shortLines.length > 0 && !confirmingShort) {
      setConfirmingShort(true);
      return;
    }

    setSaving(true);
    setError(null);

    const { data, error: err } = await apiTry<ReceiveResult>(
      `/api/transfer-orders/${orderId}/receive`,
      {
        method: "POST",
        json: {
          items: lines.map((l) => ({ itemId: l.id, receivedQty: received[l.id] ?? l.quantity })),
          ...(note.trim() ? { note: note.trim() } : {}),
        },
      }
    );

    setSaving(false);

    if (!data) {
      log.warn("receive failed", { orderId, message: err });
      setError(err ?? "Could not record this receipt");
      return;
    }

    onReceived(data);
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/40 sm:p-4"
      onClick={() => !saving && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Receive transfer"
        className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl max-h-[90dvh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between p-4 border-b border-slate-100 shrink-0">
          <div className="pr-3 min-w-0">
            <h2 className="text-base font-bold text-slate-900">Receive</h2>
            <p className="text-xs text-slate-500 mt-0.5 truncate tabular-nums">
              {orderNo} · {lines.length} line{lines.length === 1 ? "" : "s"}
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={saving}
            aria-label="Close"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center -mr-2 -mt-2 text-slate-400 hover:text-slate-600 disabled:opacity-50 focus-ring"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          <p className="text-xs text-slate-500">
            Each line is filled in with what was dispatched. Lower it only for what did not
            arrive.
          </p>

          {lines.map((line) => {
            const qty = received[line.id] ?? line.quantity;
            const short = qty < line.quantity;
            return (
              <div key={line.id} className={`rounded-lg border p-3 ${short ? "border-red-200 bg-red-50" : "border-slate-200"}`}>
                <p className="text-sm font-medium text-slate-900">{line.productName}</p>
                <p className="text-xs text-slate-500 tabular-nums mb-2">{line.sku}</p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setQty(line.id, qty - 1, line.quantity)}
                    disabled={qty <= 0}
                    aria-label={`Reduce received quantity for ${line.productName}`}
                    className="h-11 w-11 rounded-lg border border-slate-300 bg-white text-slate-700 text-lg font-bold flex items-center justify-center disabled:opacity-30 focus-ring"
                  >
                    −
                  </button>
                  <span className="h-11 min-w-[3rem] rounded-lg border border-slate-200 bg-white flex items-center justify-center text-sm font-semibold text-slate-900 tabular-nums">
                    {qty}
                  </span>
                  <button
                    type="button"
                    onClick={() => setQty(line.id, qty + 1, line.quantity)}
                    disabled={qty >= line.quantity}
                    aria-label={`Increase received quantity for ${line.productName}`}
                    className="h-11 w-11 rounded-lg border border-green-300 bg-green-50 text-green-700 text-lg font-bold flex items-center justify-center disabled:opacity-30 focus-ring"
                  >
                    +
                  </button>
                  <span className="text-[11px] text-slate-400 tabular-nums">/ {line.quantity} dispatched</span>
                </div>
                {short && (
                  <p className="text-xs text-red-700 mt-1.5 tabular-nums">
                    {line.quantity - qty} missing
                  </p>
                )}
              </div>
            );
          })}

          <div>
            <label className="block text-[11px] font-medium text-slate-500 uppercase tracking-wide mb-1" htmlFor="receive-note">
              Note
            </label>
            <textarea
              id="receive-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              maxLength={1000}
              placeholder={shortLines.length > 0 ? "What happened to the missing units?" : "Optional"}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          {confirmingShort && (
            <div className="flex items-start gap-2 p-3 rounded-lg border border-amber-200 bg-amber-50">
              <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-800">
                <span className="font-semibold tabular-nums">{totalShort} unit{totalShort === 1 ? "" : "s"} short.</span>{" "}
                Those units are written off — this is a move between our own warehouses, so there
                is nobody to claim them back from. Press Receive again to confirm.
              </p>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 p-3 rounded-lg border border-red-200 bg-red-50">
              <AlertTriangle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
              <p className="text-xs text-red-700 break-words">{error}</p>
            </div>
          )}
        </div>

        <div className="flex gap-2 p-4 border-t border-slate-100 shrink-0 pb-safe">
          <Button variant="outline" onClick={onClose} disabled={saving} className="flex-1 min-h-[44px]">
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={saving}
            className={`flex-1 min-h-[44px] ${confirmingShort ? "bg-amber-600 hover:bg-amber-700" : ""}`}
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <><PackageCheck className="h-4 w-4 mr-1.5" /> {confirmingShort ? "Confirm short" : "Receive"}</>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default ReceiveSheet;
