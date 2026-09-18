"use client";

// Outbound approval on the delivery detail screen (plan 1709, R25, R26a, Q15, Q16).
//
// Three states worth showing, and one that is not:
//   returned  → a red banner carrying the approver's note, plus "Request approval again"
//   requested → an amber line saying who is waiting on whom
//   approved  → a green line; the dispatch buttons unlock
//   none      → "Request approval", because dispatch is blocked until it exists
//
// Approve / Reject appear for holders of `deliveries.approve` only, and self-approval is allowed
// (Q15) — the grant is the authority. Every one of these checks is cosmetic; the route re-checks.

import { useState } from "react";
import { AlertTriangle, CheckCircle2, Clock, Loader2, Send, ThumbsUp, Undo2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";
import { DeliveryData, WALKOUT_STATUSES, approvalState } from "./types";

const log = createLogger("deliveries:approval");

interface ApprovalSectionProps {
  data: DeliveryData;
  deliveryId: string;
  /** `deliveries.approve`. */
  canApprove: boolean;
  /** `deliveries.edit` — who may ask. */
  canRequest: boolean;
  onChanged: () => void;
}

/** Statuses at which asking for approval is meaningful: before the outward leaves. */
const REQUEST_STATUSES = ["PENDING", "VERIFIED", "SCHEDULED", "PACKED", "PREBOOKED", "FLAGGED"];

export function ApprovalSection({ data, deliveryId, canApprove, canRequest, onChanged }: ApprovalSectionProps) {
  const [busy, setBusy] = useState<"request" | "approve" | "reject" | null>(null);
  const [error, setError] = useState("");
  const [showReject, setShowReject] = useState(false);
  const [note, setNote] = useState("");

  // A Dummy is excluded from the whole mechanism (Q37), and a finished outward has nothing to
  // approve. A walk-out needs no approval at all — but the section still shows once one exists,
  // so the history does not vanish from the screen.
  const state = approvalState(data);
  if (data.isDummy) return null;
  if (["DELIVERED", "WALK_OUT"].includes(data.status) && state === "none") return null;
  if (WALKOUT_STATUSES.includes(data.status) && state === "none" && !canRequest) return null;

  const post = async (action: "request" | "approve" | "reject", body?: Record<string, unknown>) => {
    setBusy(action);
    setError("");
    const res = await apiTry(`/api/deliveries/${deliveryId}/approval`, {
      method: "POST",
      json: { action, ...body },
    });
    setBusy(null);
    if (res.error) {
      log.warn("approval action refused", { deliveryId, action, status: res.status });
      setError(res.error);
      return;
    }
    log.info("approval action done", { deliveryId, action });
    setShowReject(false);
    setNote("");
    onChanged();
  };

  const canAsk = canRequest && REQUEST_STATUSES.includes(data.status) && state !== "approved";

  return (
    <Card
      className={`mb-3 border ${
        state === "approved"
          ? "border-green-200 bg-green-50"
          : state === "returned"
            ? "border-red-200 bg-red-50"
            : state === "requested"
              ? "border-amber-200 bg-amber-50"
              : "border-slate-200"
      }`}
    >
      <CardContent className="p-3 space-y-2">
        {state === "approved" && (
          <p className="text-sm font-medium text-green-900 flex items-center gap-1.5">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            Approved for dispatch
            {data.approvedAt && (
              <span className="text-xs font-normal text-green-700">
                · {new Date(data.approvedAt).toLocaleString("en-IN")}
              </span>
            )}
          </p>
        )}

        {state === "returned" && (
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-red-900">Returned for correction</p>
              {data.approvalNote && <p className="text-xs text-red-800 mt-0.5">{data.approvalNote}</p>}
              <p className="text-[11px] text-red-700 mt-0.5">
                Fix it and request approval again. Dispatch stays blocked until it is approved.
              </p>
            </div>
          </div>
        )}

        {state === "requested" && (
          <p className="text-sm font-medium text-amber-900 flex items-center gap-1.5">
            <Clock className="h-4 w-4 shrink-0" />
            Waiting for approval
            {data.approvalRequestedAt && (
              <span className="text-xs font-normal text-amber-800">
                · asked {new Date(data.approvalRequestedAt).toLocaleString("en-IN")}
              </span>
            )}
          </p>
        )}

        {state === "none" && (
          <p className="text-sm text-slate-700">
            Not approved. Dispatch and Ship need an approval first; a walk-out does not.
          </p>
        )}

        {error && <p className="text-xs text-red-700 font-medium">{error}</p>}

        <div className="flex flex-wrap gap-2">
          {canAsk && (
            <button
              onClick={() => post("request")}
              disabled={busy !== null}
              className="flex items-center justify-center gap-1.5 px-3 py-2 min-h-[40px] rounded-lg text-sm font-medium bg-slate-900 text-white disabled:opacity-50"
            >
              {busy === "request" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {state === "returned" ? "Request approval again" : "Request approval"}
            </button>
          )}

          {canApprove && state !== "approved" && !["DELIVERED", "WALK_OUT"].includes(data.status) && (
            <>
              <button
                onClick={() => post("approve")}
                disabled={busy !== null}
                className="flex items-center justify-center gap-1.5 px-3 py-2 min-h-[40px] rounded-lg text-sm font-medium bg-green-600 text-white disabled:opacity-50"
              >
                {busy === "approve" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ThumbsUp className="h-4 w-4" />}
                Approve
              </button>
              <button
                onClick={() => setShowReject((v) => !v)}
                disabled={busy !== null}
                className="flex items-center justify-center gap-1.5 px-3 py-2 min-h-[40px] rounded-lg text-sm font-medium bg-white border border-red-300 text-red-700 disabled:opacity-50"
              >
                <Undo2 className="h-4 w-4" /> Return
              </button>
            </>
          )}
        </div>

        {showReject && (
          <div className="space-y-2">
            {/* The note is REQUIRED (R25): a return with no reason is the defect the returned-
                record rule exists to fix, so the button stays disabled until something is typed. */}
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              maxLength={500}
              placeholder="What needs correcting?"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus-ring"
            />
            <button
              onClick={() => post("reject", { note: note.trim() })}
              disabled={busy !== null || note.trim().length === 0}
              className="w-full flex items-center justify-center gap-2 py-2.5 min-h-[44px] rounded-lg text-sm font-medium bg-red-600 text-white disabled:opacity-50"
            >
              {busy === "reject" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Undo2 className="h-4 w-4" />}
              Return for correction
            </button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
