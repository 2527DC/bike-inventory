"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { ArrowLeft, Download, Plus, Clock, ChevronRight, Trash2, RefreshCw, Loader2, AlertTriangle, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { usePermissions } from "@/lib/use-permissions";

interface Settlement {
  id: string;
  date: string;
  status: string;
  totalCash: number;
  totalCard: number;
  totalUpi: number;
  totalFinance: number;
  grandTotal: number;
  matchedAmount: number;
  unmatchedAmount: number;
  cashCounted: number | null;
  cashVariance: number | null;
  sessions: Array<{ id: string; totalSales: number; invoiceCount: number; zakyaSessionId: string; cashierName: string | null }>;
  cashVerifiedBy: { name: string } | null;
  _count: { matches: number };
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount);
}

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  PENDING: { bg: "bg-slate-100", text: "text-slate-700", label: "Pending" },
  CASH_VERIFIED: { bg: "bg-amber-100", text: "text-amber-700", label: "Cash Verified" },
  PARTIALLY_MATCHED: { bg: "bg-blue-100", text: "text-blue-700", label: "Partially Matched" },
  FULLY_MATCHED: { bg: "bg-green-100", text: "text-green-700", label: "Fully Matched" },
  DISCREPANCY: { bg: "bg-red-100", text: "text-red-700", label: "Discrepancy" },
};

type FetchStep = "idle" | "connecting" | "fetching" | "creating" | "done" | "error";

export default function SettlementListPage() {
  const { data: session, status: sessionStatus } = useSession();

  const { canView, canDelete: canDeleteCheck } = usePermissions();
  const canAccess = canView("bills");
  // The permission half already worked; the two role comparisons in front of it were dead
  // weight that could only ever be false. Only the half that did something is left.
  const isAdmin = canDeleteCheck("bills");

  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [fetchDays, setFetchDays] = useState(7);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Progress state
  const [fetchStep, setFetchStep] = useState<FetchStep>("idle");
  const [fetchProgress, setFetchProgress] = useState("");
  const [fetchResult, setFetchResult] = useState<{
    source: string;
    created: number;
    settlements: number;
    skipped: number;
    paymentsFound: number;
    paymentError: string | null;
    paymentModes: string[];
  } | null>(null);

  const loadSettlements = () => {
    setLoading(true);
    fetch("/api/pos/settlement")
      .then((r) => r.json())
      .then((res) => { if (res.success) setSettlements(res.data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadSettlements(); }, []);

  const fetchSessions = async (force = false) => {
    setFetchStep("connecting");
    setFetchProgress("Connecting to Zakya...");
    setFetchResult(null);

    let dateTo: string;
    let dateFrom: string;
    if (fetchDays === 0 && customFrom && customTo) {
      dateFrom = customFrom;
      dateTo = customTo;
    } else {
      dateTo = new Date().toISOString().split("T")[0];
      dateFrom = new Date(Date.now() - (fetchDays || 1) * 86400000).toISOString().split("T")[0];
    }

    try {
      if (force) setFetchProgress("Clearing old data...");

      setFetchStep("fetching");
      setFetchProgress(`Fetching invoices & payment details (${dateFrom} to ${dateTo})...`);

      const res = await fetch("/api/pos/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dateFrom, dateTo, force }),
      });
      const data = await res.json();

      if (!data.success) {
        setFetchStep("error");
        setFetchProgress(data.error || "Failed to fetch sessions");
        return;
      }

      const { source, created, skipped, paymentsFound, paymentError, paymentModes } = data.data;

      // Auto-create settlements
      setFetchStep("creating");
      setFetchProgress("Creating settlements...");

      let settlementsCreated = 0;
      if (created > 0) {
        const start = new Date(dateFrom);
        const end = new Date(dateTo);
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
          const ds = d.toISOString().split("T")[0];
          try {
            const sRes = await fetch("/api/pos/settlement", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ date: ds }),
            });
            const sData = await sRes.json();
            if (sData.success) settlementsCreated++;
          } catch { /* skip */ }
        }
      }

      setFetchStep("done");
      setFetchProgress("");
      setFetchResult({
        source,
        created,
        settlements: settlementsCreated,
        skipped,
        paymentsFound: paymentsFound || 0,
        paymentError: paymentError || null,
        paymentModes: paymentModes || [],
      });

      loadSettlements();
    } catch (err) {
      setFetchStep("error");
      setFetchProgress(err instanceof Error ? err.message : "Network error");
    }
  };

  const createSettlement = async () => {
    const dateStr = prompt("Enter date (YYYY-MM-DD):", new Date().toISOString().split("T")[0]);
    if (!dateStr) return;
    setCreating(true);
    try {
      const res = await fetch("/api/pos/settlement", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: dateStr }),
      });
      const data = await res.json();
      if (data.success) loadSettlements();
      else setActionError(data.error || "Failed to create settlement");
    } catch { setActionError("Network error"); }
    finally { setCreating(false); }
  };

  const deleteSettlement = async (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm("Delete this settlement? Sessions will be unlinked and can be re-used.")) return;
    setDeleting(id);
    try {
      const res = await fetch("/api/pos/settlement", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = await res.json();
      if (data.success) loadSettlements();
      else setActionError(data.error || "Failed to delete");
    } catch { setActionError("Network error"); }
    finally { setDeleting(null); }
  };

  const isFetching = fetchStep === "connecting" || fetchStep === "fetching" || fetchStep === "creating";

  if (sessionStatus === "loading") {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-6 w-6 border-2 border-slate-900 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!canAccess) {
    return <div className="text-center py-12"><p className="text-sm font-medium text-red-600">Access Denied</p></div>;
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Link href="/accounts"><ArrowLeft className="h-5 w-5 text-slate-500" /></Link>
        <h1 className="text-lg font-bold text-slate-900 flex-1">Daily Settlement</h1>
      </div>

      {actionError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-2.5 mb-3 text-xs text-red-700 flex items-center justify-between">
          <span>{actionError}</span>
          <button onClick={() => setActionError(null)} className="text-red-400 hover:text-red-600 ml-2 text-sm leading-none">&times;</button>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2 mb-3">
        <div className="flex items-center gap-1 flex-1">
          <select value={fetchDays} onChange={(e) => setFetchDays(Number(e.target.value))}
            className="text-xs border rounded-lg px-2 py-2 bg-white">
            <option value={1}>1 day</option>
            <option value={3}>3 days</option>
            <option value={7}>7 days</option>
            <option value={14}>14 days</option>
            <option value={30}>30 days</option>
            <option value={0}>Custom</option>
          </select>
          {fetchDays === 0 && (
            <>
              <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)}
                className="text-xs border rounded-lg px-2 py-2 bg-white w-[120px]" />
              <span className="text-xs text-slate-400">to</span>
              <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)}
                className="text-xs border rounded-lg px-2 py-2 bg-white w-[120px]" />
            </>
          )}
          <Button size="sm" variant="outline" onClick={() => fetchSessions(false)} disabled={isFetching || (fetchDays === 0 && (!customFrom || !customTo))}>
            <Download className="h-3.5 w-3.5 mr-1" />
            {isFetching ? "Fetching..." : "Fetch POS"}
          </Button>
          {isAdmin && (
            <Button size="sm" variant="outline" onClick={() => {
              if (confirm("Re-fetch will delete existing sessions & settlements for this period and pull fresh from Zakya. Continue?")) {
                fetchSessions(true);
              }
            }} disabled={isFetching} className="text-orange-600 border-orange-300 hover:bg-orange-50">
              <RefreshCw className="h-3.5 w-3.5 mr-1" />
              Re-fetch
            </Button>
          )}
        </div>
        <Button size="sm" className="bg-blue-600 hover:bg-blue-700" onClick={createSettlement} disabled={creating}>
          <Plus className="h-3.5 w-3.5 mr-1" />
          {creating ? "..." : "New"}
        </Button>
      </div>

      {/* Progress Bar */}
      {isFetching && (
        <Card className="mb-3 border-blue-200 bg-blue-50">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-2">
              <Loader2 className="h-4 w-4 animate-spin text-blue-600 shrink-0" />
              <span className="text-xs font-medium text-blue-700">{fetchProgress}</span>
            </div>
            <div className="w-full bg-blue-200 rounded-full h-1.5">
              <div className="bg-blue-600 h-1.5 rounded-full transition-all duration-500" style={{
                width: fetchStep === "connecting" ? "20%" : fetchStep === "fetching" ? "60%" : "90%"
              }} />
            </div>
            <div className="flex justify-between mt-1">
              <span className={`text-[10px] ${fetchStep === "connecting" ? "text-blue-700 font-medium" : "text-blue-400"}`}>Connect</span>
              <span className={`text-[10px] ${fetchStep === "fetching" ? "text-blue-700 font-medium" : "text-blue-400"}`}>Fetch</span>
              <span className={`text-[10px] ${fetchStep === "creating" ? "text-blue-700 font-medium" : "text-blue-400"}`}>Create</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Success Result */}
      {fetchStep === "done" && fetchResult && (
        <Card className="mb-3 border-green-200 bg-green-50">
          <CardContent className="p-3">
            <div className="flex items-start gap-2">
              <CheckCircle className="h-4 w-4 text-green-600 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-xs font-medium text-green-800">
                  {fetchResult.created > 0
                    ? `Created ${fetchResult.created} sessions → ${fetchResult.settlements} settlement(s)`
                    : `${fetchResult.skipped} sessions already existed`}
                </p>
                <p className="text-[10px] text-green-600 mt-0.5">
                  Source: {fetchResult.source === "zoho-books" ? "Zoho Books (payments)" : fetchResult.source === "zakya" ? "Zakya (payments)" : "Invoices only"}
                  {fetchResult.paymentsFound > 0 && ` — ${fetchResult.paymentsFound} payments found`}
                </p>
                {fetchResult.paymentModes.length > 0 && (
                  <p className="text-[10px] text-blue-600 mt-0.5">
                    Payment modes: {fetchResult.paymentModes.join(", ")}
                  </p>
                )}
                {fetchResult.paymentError && (
                  <div className="mt-1.5 p-2 bg-amber-50 border border-amber-200 rounded text-[10px] text-amber-700">
                    <p className="font-medium">Payment API note:</p>
                    <p className="mt-0.5 font-mono">{fetchResult.paymentError}</p>
                  </div>
                )}
              </div>
              <button onClick={() => { setFetchStep("idle"); setFetchResult(null); }} className="text-[10px] text-green-500 underline shrink-0">
                dismiss
              </button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Error Result */}
      {fetchStep === "error" && (
        <Card className="mb-3 border-red-200 bg-red-50">
          <CardContent className="p-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-xs font-medium text-red-800">Fetch failed</p>
                <p className="text-[10px] text-red-600 mt-0.5 font-mono break-all">{fetchProgress}</p>
              </div>
              <button onClick={() => { setFetchStep("idle"); setFetchProgress(""); }} className="text-[10px] text-red-500 underline shrink-0">
                dismiss
              </button>
            </div>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="h-6 w-6 border-2 border-slate-900 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : settlements.length === 0 ? (
        <div className="text-center py-12">
          <Clock className="h-8 w-8 text-slate-300 mx-auto mb-2" />
          <p className="text-sm text-slate-400">No settlements yet</p>
          <p className="text-xs text-slate-400 mt-1">Fetch POS sessions first</p>
        </div>
      ) : (
        <div className="space-y-2">
          {settlements.map((s) => {
            const st = STATUS_STYLES[s.status] || STATUS_STYLES.PENDING;
            const invoiceCount = s.sessions.reduce((sum, p) => sum + p.invoiceCount, 0);
            // Show session IDs (e.g. SE1-728)
            const sessionIds = s.sessions
              .map(p => p.cashierName || p.zakyaSessionId)
              .filter(Boolean);
            return (
              <Link key={s.id} href={`/accounts/settlement/${s.id}`}>
                <Card className="mb-2 hover:border-slate-300 transition-colors">
                  <CardContent className="p-3">
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0 mr-3">
                        <div className="flex items-center gap-2 mb-1">
                          <p className="text-sm font-bold text-slate-900">
                            {new Date(s.date).toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short", year: "numeric" })}
                          </p>
                          <Badge className={`${st.bg} ${st.text} text-[10px]`}>{st.label}</Badge>
                        </div>
                        <p className="text-xs text-slate-500">
                          {invoiceCount} invoices | {s.sessions.length} session{s.sessions.length !== 1 ? "s" : ""}
                          {s._count.matches > 0 && ` | ${s._count.matches} matched`}
                        </p>
                        {sessionIds.length > 0 && (
                          <p className="text-[10px] text-slate-400 mt-0.5">
                            {sessionIds.join(", ")}
                          </p>
                        )}
                        {s.cashVariance !== null && s.cashVariance !== 0 && (
                          <p className={`text-[10px] mt-0.5 ${s.cashVariance > 0 ? "text-green-600" : "text-red-600"}`}>
                            Cash variance: {s.cashVariance > 0 ? "+" : ""}{formatCurrency(s.cashVariance)}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="text-right">
                          <p className="text-sm font-bold text-slate-900">{formatCurrency(s.grandTotal)}</p>
                          {s.matchedAmount > 0 && (
                            <p className="text-[10px] text-green-600">{formatCurrency(s.matchedAmount)} matched</p>
                          )}
                        </div>
                        {isAdmin && (
                          <button onClick={(e) => deleteSettlement(s.id, e)} disabled={deleting === s.id}
                            className="p-1.5 rounded-lg hover:bg-red-50 transition-colors">
                            <Trash2 className={`h-3.5 w-3.5 ${deleting === s.id ? "text-slate-300" : "text-red-400 hover:text-red-600"}`} />
                          </button>
                        )}
                        <ChevronRight className="h-4 w-4 text-slate-400" />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
