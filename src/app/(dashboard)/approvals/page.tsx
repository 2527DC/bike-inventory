"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Check, X, ChevronRight, Loader2, Inbox, Truck, ArrowRightLeft, ClipboardList, ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SkeletonList } from "@/components/ui/skeleton";
import { ErrorBanner } from "@/components/ui/error-banner";
import { apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";

const log = createLogger("approvals:requests");

/**
 * Requests — everything waiting for an approval this person can give (plan 1709, P17, R24).
 *
 * The list is built from the RECORDS by `GET /api/approvals/pending`, not from an inbox table,
 * so it can never disagree with them and there is no read state to keep. A viewer who holds no
 * `approve` grant sees an empty page rather than a 403: the header badge links here for
 * everybody, and a permission error would read as a fault.
 *
 * Approve and Reject post to each module's OWN route — the same ones the record's own screen
 * uses — so there is one implementation of each decision and this page adds no second opinion.
 * A stock audit is Open-only: approving one means choosing verify-only or "apply the counts",
 * and on a whole-store audit also naming the warehouse a surplus goes to. A one-tap Approve
 * would have to pick one of those silently.
 */

type RequestType = "INBOUND" | "OUTBOUND" | "TRANSFER" | "STOCK_AUDIT";

interface PendingRequest {
  type: RequestType;
  id: string;
  ref: string;
  summary: string;
  requestedByName: string;
  requestedAt: string;
  ageHours: number;
  link: string;
  quickActions: boolean;
  resubmitted: boolean;
}

interface PendingResponse {
  total: number;
  sections: Record<RequestType, boolean>;
  requests: PendingRequest[];
}

const SECTION: Record<RequestType, { label: string; icon: typeof Inbox; accent: string }> = {
  INBOUND: { label: "Inbound shipments", icon: Inbox, accent: "border-l-blue-400" },
  OUTBOUND: { label: "Outwards", icon: Truck, accent: "border-l-purple-400" },
  TRANSFER: { label: "Stock transfers", icon: ArrowRightLeft, accent: "border-l-amber-400" },
  STOCK_AUDIT: { label: "Stock audits", icon: ClipboardList, accent: "border-l-slate-300" },
};

const ORDER: RequestType[] = ["OUTBOUND", "TRANSFER", "INBOUND", "STOCK_AUDIT"];

/** Age in the words somebody standing at a counter would use. */
function ageLabel(hours: number): string {
  if (hours < 1) return "just now";
  if (hours < 24) return `${Math.round(hours)} h`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}

export default function ApprovalsPage() {
  const [data, setData] = useState<PendingResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<PendingRequest | null>(null);
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    const { data: res, error } = await apiTry<PendingResponse>("/api/approvals/pending");
    if (error) {
      log.warn("pending approvals failed", { message: error });
      setLoadError(error);
    } else {
      setData(res);
      setLoadError(null);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await load();
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [load]);

  /** The module's own endpoint and body for each decision. Nothing here decides permissions. */
  function endpointFor(r: PendingRequest, action: "approve" | "reject", reason: string) {
    switch (r.type) {
      case "INBOUND":
        return action === "approve"
          ? { url: `/api/inbound/${r.id}/approve`, json: {} as Record<string, unknown> }
          : { url: `/api/inbound/${r.id}/reject`, json: { rejectionNote: reason } };
      case "OUTBOUND":
        return {
          url: `/api/deliveries/${r.id}/approval`,
          json: action === "approve" ? { action: "approve" } : { action: "reject", note: reason },
        };
      case "TRANSFER":
        return {
          url: `/api/transfer-orders/${r.id}/approve`,
          json: action === "approve" ? { action: "approve" } : { action: "reject", rejectionNote: reason },
        };
      default:
        return null;
    }
  }

  async function act(r: PendingRequest, action: "approve" | "reject", reason = "") {
    const target = endpointFor(r, action, reason);
    if (!target) return;
    setWorking(`${r.type}:${r.id}`);
    setActionError(null);
    const { data: ok, error } = await apiTry<{ message?: string }>(target.url, {
      method: "POST",
      json: target.json,
    });
    setWorking(null);
    if (!ok) {
      log.warn("approval action failed", { type: r.type, action, message: error });
      setActionError(error ?? `Could not ${action} ${r.ref}`);
      return;
    }
    setBanner(ok.message ?? (action === "approve" ? `${r.ref} approved` : `${r.ref} sent back`));
    setRejecting(null);
    setNote("");
    // Re-read rather than drop the row locally: another approver may have cleared others too.
    await load();
  }

  if (loading) {
    return (
      <div>
        <div className="h-7 w-32 bg-slate-100 rounded mb-4 animate-pulse" />
        <SkeletonList count={4} type="card" />
      </div>
    );
  }

  const requests = data?.requests ?? [];
  const visibleSections = ORDER.filter((t) => data?.sections?.[t]);

  return (
    <div className="pb-6">
      <div className="mb-4">
        <h1 className="text-lg font-bold text-slate-900">Requests</h1>
        <p className="text-[11px] text-slate-500">
          Everything waiting for an approval you can give
        </p>
      </div>

      {banner && (
        <div className="mb-3 flex items-start justify-between gap-2 rounded-lg border border-green-200 bg-green-50 p-2.5">
          <p className="text-xs text-green-800">{banner}</p>
          <button onClick={() => setBanner(null)} aria-label="Dismiss" className="text-green-600 focus-ring">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
      {loadError && (
        <ErrorBanner message={loadError} onRetry={() => { setLoadError(null); void load(); }} />
      )}
      {actionError && (
        <div className="mb-3">
          <ErrorBanner message={actionError} onDismiss={() => setActionError(null)} />
        </div>
      )}

      {visibleSections.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-center">
            <ShieldCheck className="h-8 w-8 text-slate-300 mx-auto mb-2" />
            <p className="text-sm text-slate-500">You do not approve anything yet.</p>
            <p className="text-[11px] text-slate-400 mt-1">
              Approval is a permission on each module. Ask an administrator at Team → Roles &amp;
              Permissions.
            </p>
          </CardContent>
        </Card>
      ) : requests.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-center">
            <Check className="h-8 w-8 text-green-500 mx-auto mb-2" />
            <p className="text-sm text-slate-600">Nothing is waiting. All caught up.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-5">
          {visibleSections.map((type) => {
            const rows = requests.filter((r) => r.type === type);
            if (rows.length === 0) return null;
            const meta = SECTION[type];
            const Icon = meta.icon;
            return (
              <section key={type}>
                <div className="flex items-center gap-2 mb-2">
                  <Icon className="h-4 w-4 text-slate-500" />
                  <h2 className="text-sm font-semibold text-slate-900">{meta.label}</h2>
                  <span className="text-xs text-slate-400 tabular-nums">({rows.length})</span>
                </div>
                <div className="space-y-2">
                  {rows.map((r) => {
                    const busy = working === `${r.type}:${r.id}`;
                    return (
                      <Card key={`${r.type}-${r.id}`} className={`border-l-4 ${meta.accent}`}>
                        <CardContent className="p-3">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className="text-sm font-semibold text-slate-900 tabular-nums truncate">
                                  {r.ref}
                                </p>
                                {r.resubmitted && (
                                  <Badge className="text-[10px] bg-amber-100 text-amber-700 border-amber-200">
                                    Resubmitted
                                  </Badge>
                                )}
                                {/* Over a day waiting is the number this page exists to show. */}
                                <span
                                  className={`text-[11px] tabular-nums ${r.ageHours >= 24 ? "text-red-600 font-medium" : "text-slate-400"}`}
                                >
                                  {ageLabel(r.ageHours)}
                                </span>
                              </div>
                              <p className="text-xs text-slate-600 mt-0.5 truncate">{r.summary}</p>
                              <p className="text-[11px] text-slate-400 mt-0.5">
                                Asked by {r.requestedByName}
                              </p>
                            </div>
                            <Link
                              href={r.link}
                              aria-label={`Open ${r.ref}`}
                              className="min-h-[44px] min-w-[44px] -mr-2 -mt-1 flex items-center justify-center text-slate-300 hover:text-slate-500 focus-ring shrink-0"
                            >
                              <ChevronRight className="h-5 w-5" />
                            </Link>
                          </div>

                          <div className="mt-2 flex gap-2">
                            {r.quickActions ? (
                              <>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={busy}
                                  onClick={() => { setRejecting(r); setNote(""); }}
                                  className="flex-1 min-h-[44px] text-red-600 border-red-200 hover:bg-red-50"
                                >
                                  <X className="h-4 w-4 mr-1" /> Reject
                                </Button>
                                <Button
                                  size="sm"
                                  disabled={busy}
                                  onClick={() => act(r, "approve")}
                                  className="flex-1 min-h-[44px] bg-green-600 hover:bg-green-700"
                                >
                                  {busy ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                  ) : (
                                    <><Check className="h-4 w-4 mr-1" /> Approve</>
                                  )}
                                </Button>
                              </>
                            ) : (
                              <Link href={r.link} className="flex-1">
                                <Button size="sm" variant="outline" className="w-full min-h-[44px]">
                                  Open to review
                                </Button>
                              </Link>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {/* Reject always asks for a note: "sent back" with no reason is the thing this replaced. */}
      {rejecting && (
        <div
          className="fixed inset-0 bg-black/50 z-[60] flex items-end sm:items-center justify-center p-4"
          onClick={() => setRejecting(null)}
        >
          <div
            className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-md p-5 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-base font-bold text-slate-900">Send {rejecting.ref} back?</h2>
            <p className="text-xs text-slate-500">
              {rejecting.requestedByName} gets your note and fixes the same record.
            </p>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              maxLength={500}
              placeholder="What needs correcting?"
              className="w-full rounded-lg border border-slate-200 p-2.5 text-sm focus-ring"
            />
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setRejecting(null)} className="flex-1 min-h-[44px]">
                Keep it
              </Button>
              <Button
                onClick={() => act(rejecting, "reject", note.trim())}
                disabled={note.trim().length === 0 || working !== null}
                className="flex-1 min-h-[44px] bg-red-600 hover:bg-red-700"
              >
                {working ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send back"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
