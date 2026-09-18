"use client";

// ★ priority toggle (plan 1709, R16, R19–R21, Q21, Q35).
//
// Shown only to holders of `delivery_priority.edit` — its own grant, so the person who decides
// what gets built first does not need `deliveries.edit`. Cosmetic, as every client check is: the
// route re-checks the grant, refuses a Dummy and refuses a closed outward.
//
// Starring is not a label: the server picks real cycles in the store's godown and holds them for
// this outward, which is what makes them appear ★ on the assembly Awaiting list at once.

import { useState } from "react";
import { Loader2, Star } from "lucide-react";
import { apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";

const log = createLogger("deliveries:priority");

interface PriorityStarProps {
  deliveryId: string;
  priorityAt: string | null;
  /** `delivery_priority.edit`. Without it the star still SHOWS — it is information — but is inert. */
  canEdit: boolean;
  onChanged: () => void;
  /** `icon` for a list row, `button` for the detail screen. */
  variant?: "icon" | "button";
  className?: string;
}

export function PriorityStar({
  deliveryId,
  priorityAt,
  canEdit,
  onChanged,
  variant = "icon",
  className = "",
}: PriorityStarProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const starred = !!priorityAt;

  const toggle = async (e: React.MouseEvent) => {
    // The list rows are clickable links; a star tap must not also open the delivery.
    e.stopPropagation();
    e.preventDefault();
    if (!canEdit || busy) return;
    setBusy(true);
    setError("");
    const res = await apiTry<{ starred: boolean; reserved: number; released: number }>(
      `/api/deliveries/${deliveryId}/priority`,
      { method: "POST", json: { starred: !starred } }
    );
    setBusy(false);
    if (res.error) {
      log.warn("priority toggle refused", { deliveryId, status: res.status });
      setError(res.error);
      return;
    }
    log.info("priority toggled", {
      deliveryId,
      starred: res.data?.starred,
      unitsReserved: res.data?.reserved,
      unitsReleased: res.data?.released,
    });
    onChanged();
  };

  const label = starred ? "Priority — tap to clear" : "Mark as priority";

  if (variant === "icon") {
    return (
      <button
        onClick={toggle}
        disabled={!canEdit || busy}
        title={canEdit ? label : starred ? "Priority" : undefined}
        aria-label={label}
        aria-pressed={starred}
        className={`h-8 w-8 flex items-center justify-center rounded-lg transition-colors focus-ring ${
          canEdit ? "hover:bg-amber-50" : "cursor-default"
        } ${className}`}
      >
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
        ) : (
          <Star className={`h-4 w-4 ${starred ? "fill-amber-400 text-amber-500" : "text-slate-300"}`} />
        )}
      </button>
    );
  }

  return (
    <div className={className}>
      <button
        onClick={toggle}
        disabled={!canEdit || busy}
        aria-pressed={starred}
        className={`w-full flex items-center justify-center gap-2 py-2.5 min-h-[48px] rounded-lg text-sm font-medium transition-colors disabled:opacity-50 ${
          starred ? "bg-amber-100 text-amber-900 border border-amber-300" : "bg-slate-100 text-slate-700"
        }`}
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Star className={`h-4 w-4 ${starred ? "fill-amber-500 text-amber-600" : ""}`} />}
        {starred ? "Priority — tap to clear" : "Mark as priority"}
      </button>
      {starred && (
        <p className="text-[11px] text-amber-700 mt-1">
          Its cycles are built and moved first. Any short line is held in this store&apos;s godown.
        </p>
      )}
      {error && <p className="text-[11px] text-red-700 font-medium mt-1">{error}</p>}
    </div>
  );
}
