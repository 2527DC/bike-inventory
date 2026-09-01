"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import {
  Package, ArrowDownCircle, ArrowUpCircle, AlertTriangle,
  IndianRupee, Truck, Clock, CheckCircle2, Flag,
  Users, ShieldAlert, ChevronRight, Share2, Loader2,
} from "lucide-react";
import { DashboardCard } from "@/components/dashboard-card";
import { TransactionItem } from "@/components/transaction-item";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SkeletonDashboard } from "@/components/ui/skeleton";
import { formatINR, formatTime } from "@/lib/utils";
import { usePermissions } from "@/lib/use-permissions";
import { SendScorecardButton } from "./_components/send-scorecard-button";


interface CEOData {
  // Revenue & Finance
  outstandingPayable: number;
  outstandingReceivable: number;
  overdueBills: number;
  totalStockValue: number;
  // Operations
  totalProducts: number;
  lowStockCount: number;
  todayInwards: number;
  todayOutwards: number;
  openVendorIssues: number;
  // Lists
  overdueBillsList: Array<{ id: string; billNo: string; amount: number; paidAmount: number; dueDate: string; vendor: { name: string } }>;
  // Inbound
  inboundInTransit: number;
  inboundArrivingThisWeek: number;
  // Health
  people: Array<{ name: string; role: string; pending: number; overdue24h: number; overdue48h: number; overdue72h: number }>;
  todaySummary: { inwardsVerified: number; inwardsPending: number; deliveriesClosed: number; deliveriesPending: number; expensesRecorded: number; posWithoutTracking: number };
  criticalAlerts: Array<{ type: string; message: string; owner: string; count: number }>;
}


function ShareDailyReport() {
  const [sharing, setSharing] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);

  const handleShare = async () => {
    setSharing(true);
    try {
      const today = new Date().toISOString().split("T")[0];
      const res = await fetch(`/api/activity?date=${today}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error);

      const { totalActions, activities, userSummary } = json.data;
      const dateStr = new Date().toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" });

      if (totalActions === 0) {
        setShareError("No activities recorded today yet. Complete some tasks first, then share.");
        return;
      }

      // Build WhatsApp message
      let msg = `📋 *Daily Report — ${dateStr}*\n`;
      msg += `Total Actions: ${totalActions}\n\n`;

      // Category breakdown
      const catCounts: Record<string, number> = {};
      for (const a of activities) {
        catCounts[a.category] = (catCounts[a.category] || 0) + 1;
      }
      const catEmoji: Record<string, string> = { DELIVERY: "🚚", STOCK: "📦", INBOUND: "📥", TRANSFER: "🔄", EXPENSE: "💰", PAYMENT: "💳", PO: "📝" };
      for (const [cat, count] of Object.entries(catCounts)) {
        msg += `${catEmoji[cat] || "•"} ${cat}: ${count}\n`;
      }

      // Per-user summary
      if (userSummary.length > 1) {
        msg += `\n👥 *Team Activity:*\n`;
        for (const u of userSummary) {
          msg += `• ${u.name}: ${u.actions} actions\n`;
        }
      }

      // Recent notable actions (last 10)
      msg += `\n📌 *Recent:*\n`;
      for (const a of activities.slice(0, 10)) {
        const time = new Date(a.timestamp).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
        msg += `${time} — ${a.action}: ${a.detail}${a.amount ? ` (${formatINR(a.amount)})` : ""}\n`;
      }

      msg += `\n— Bharath Cycle Hub App`;

      // Open WhatsApp
      window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(msg)}`, "_blank");
    } catch {
      setShareError("Failed to load activity data");
    } finally {
      setSharing(false);
    }
  };

  return (
    <>
      {shareError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-2.5 mb-2 text-xs text-red-700 flex items-center justify-between">
          <span>{shareError}</span>
          <button onClick={() => setShareError(null)} className="text-red-400 hover:text-red-600 ml-2 text-sm leading-none">&times;</button>
        </div>
      )}
      <button onClick={handleShare} disabled={sharing}
        className="flex items-center gap-1.5 bg-green-600 text-white px-3 py-2 min-h-[44px] rounded-lg text-xs font-medium disabled:opacity-50 w-full justify-center focus-ring">
        {sharing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Share2 className="h-3.5 w-3.5" />}
        {sharing ? "Loading..." : "Share Daily Report via WhatsApp"}
      </button>
    </>
  );
}

function InwardsEODReport() {
  const [sharing, setSharing] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);

  const handleShare = async () => {
    setSharing(true);
    try {
      const today = new Date().toISOString().split("T")[0];
      const dateStr = new Date().toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" });

      const [inwardsRes, transfersRes, inboundRes] = await Promise.all([
        fetch(`/api/inventory/inwards?dateFrom=${today}&limit=100&mine=true`).then(r => r.json()),
        fetch(`/api/transfers?dateFrom=${today}&limit=100`).then(r => r.json()),
        fetch(`/api/inventory/inwards?dateFrom=${today}&limit=100`).then(r => r.json()),
      ]);

      const inwards = inwardsRes.success ? (inwardsRes.data || []) : [];
      const transfers = transfersRes.success ? (transfersRes.data || []) : [];
      const allInwards = inboundRes.success ? (inboundRes.data || []) : [];

      const totalInwardQty = inwards.reduce((s: number, t: { quantity: number }) => s + t.quantity, 0);
      const totalAllInwardQty = allInwards.reduce((s: number, t: { quantity: number }) => s + t.quantity, 0);

      let msg = `📥 *Inwards EOD Report — ${dateStr}*\n\n`;

      // Inwards summary
      msg += `📦 *My Inwards:* ${inwards.length} entries (${totalInwardQty} units)\n`;
      msg += `📦 *Total Inwards:* ${allInwards.length} entries (${totalAllInwardQty} units)\n`;
      msg += `🔄 *Transfers:* ${transfers.length} today\n\n`;

      // Inward details
      if (inwards.length > 0) {
        msg += `*Inward Details:*\n`;
        for (const t of inwards.slice(0, 15)) {
          const name = t.product?.name || "Unknown";
          const qty = t.quantity;
          const ref = t.referenceNo ? ` (${t.referenceNo})` : "";
          msg += `• ${name} × ${qty}${ref}\n`;
        }
        if (inwards.length > 15) msg += `... +${inwards.length - 15} more\n`;
        msg += `\n`;
      }

      // Transfer details
      if (transfers.length > 0) {
        msg += `*Transfer Details:*\n`;
        for (const t of transfers.slice(0, 10)) {
          const no = t.transferNo || t.id?.slice(0, 8);
          const status = t.status || "PENDING";
          msg += `• ${no}: ${status}\n`;
        }
        if (transfers.length > 10) msg += `... +${transfers.length - 10} more\n`;
        msg += `\n`;
      }

      if (inwards.length === 0 && transfers.length === 0) {
        msg += `_No inward entries or transfers recorded today._\n\n`;
      }

      msg += `— Bharath Cycle Hub App`;
      window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(msg)}`, "_blank");
    } catch {
      setReportError("Failed to load report data");
    } finally {
      setSharing(false);
    }
  };

  return (
    <>
      {reportError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-2.5 mb-2 text-xs text-red-700 flex items-center justify-between">
          <span>{reportError}</span>
          <button onClick={() => setReportError(null)} className="text-red-400 hover:text-red-600 ml-2 text-sm leading-none">&times;</button>
        </div>
      )}
      <button onClick={handleShare} disabled={sharing}
        className="flex items-center gap-1.5 bg-blue-600 text-white px-3 py-2 min-h-[44px] rounded-lg text-xs font-medium disabled:opacity-50 w-full justify-center mb-2 focus-ring">
        {sharing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Share2 className="h-3.5 w-3.5" />}
        {sharing ? "Loading..." : "Share Inwards EOD Report"}
      </button>
    </>
  );
}




function AdminDashboard() {
  const [data, setData] = useState<CEOData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    const today = new Date().toISOString().split("T")[0];
    const safeFetch = (url: string) => fetch(url).then((r) => r.ok ? r.json() : { success: false }).catch(() => ({ success: false }));

    Promise.all([
      safeFetch("/api/accounts/summary"),
      safeFetch("/api/dashboard/stats"),
      safeFetch(`/api/inventory/inwards?dateFrom=${today}&limit=1`),
      safeFetch(`/api/inventory/outwards?dateFrom=${today}&limit=1`),
      safeFetch("/api/health/summary"),
      safeFetch("/api/vendor-issues?limit=1"),
      safeFetch("/api/inbound/stats"),
    ])
      .then(([accountsRes, insightsRes, inwardsRes, outwardsRes, healthRes, issuesRes, inboundRes]) => {
        const acct = accountsRes.success ? accountsRes.data : null;
        const insightData = insightsRes.success ? insightsRes.data : [];
        const stockValueInsight = insightData.find((i: { type: string }) => i.type === "stock_value");
        const reorderInsight = insightData.find((i: { type: string }) => i.type === "reorder");

        setData({
          outstandingPayable: acct?.stats?.outstandingPayable || 0,
          outstandingReceivable: acct?.stats?.outstandingReceivable || 0,
          overdueBills: acct?.stats?.overdueBills || 0,
          totalStockValue: stockValueInsight?.value || 0,
          totalProducts: inwardsRes.success ? (inwardsRes.pagination?.total || 0) : 0,
          lowStockCount: reorderInsight?.value || 0,
          todayInwards: inwardsRes.success ? (inwardsRes.pagination?.total || 0) : 0,
          todayOutwards: outwardsRes.success ? (outwardsRes.pagination?.total || 0) : 0,
          openVendorIssues: issuesRes.success ? (issuesRes.pagination?.total || 0) : 0,
          inboundInTransit: inboundRes.success ? (inboundRes.data?.inTransit?.items || 0) : 0,
          inboundArrivingThisWeek: inboundRes.success ? (inboundRes.data?.arrivingThisWeek?.items || 0) : 0,
          overdueBillsList: acct?.overdueBillsList || [],
          people: healthRes.success ? (healthRes.data?.people || []) : [],
          todaySummary: healthRes.success ? (healthRes.data?.today || {}) : {},
          criticalAlerts: healthRes.success ? (healthRes.data?.criticalAlerts || []) : [],
        });
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <SkeletonDashboard />;
  }

  if (error || !data) {
    return (
      <div className="text-center py-12">
        <AlertTriangle className="h-8 w-8 text-red-400 mx-auto mb-2" />
        <p className="text-sm text-slate-500">Failed to load dashboard. Pull down to retry.</p>
      </div>
    );
  }

  return (
    <>
      {/* What needs me now — Critical Alerts first */}
      {data.criticalAlerts.length > 0 && (
        <Card className="mb-3 border-red-300 bg-red-50">
          <CardHeader className="pb-1">
            <CardTitle className="flex items-center gap-1.5 text-red-700">
              <ShieldAlert className="h-4 w-4" />
              What needs you now
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {data.criticalAlerts.map((alert, i) => (
              <div key={i} className="flex items-center justify-between gap-2 py-1">
                <p className="text-xs text-red-700 font-medium">{alert.message}</p>
                <Badge variant="danger" className="text-[10px] shrink-0 animate-pulse">{alert.owner}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Financial Overview */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Link href="/accounts" className="focus-ring rounded-xl">
          <Card className="bg-red-50 border-red-200 min-h-[44px]">
            <CardContent className="p-3">
              <p className="text-[11px] text-red-600 font-medium uppercase tracking-wide">Payable</p>
              <p className="text-lg font-bold text-red-700 tabular-nums">{formatINR(data.outstandingPayable)}</p>
            </CardContent>
          </Card>
        </Link>
        <Link href="/receivables" className="focus-ring rounded-xl">
          <Card className="bg-blue-50 border-blue-200 min-h-[44px]">
            <CardContent className="p-3">
              <p className="text-[11px] text-blue-600 font-medium uppercase tracking-wide">Receivable</p>
              <p className="text-lg font-bold text-blue-700 tabular-nums">{formatINR(data.outstandingReceivable)}</p>
            </CardContent>
          </Card>
        </Link>
        <Link href="/stock" className="focus-ring rounded-xl">
          <Card className="bg-green-50 border-green-200 min-h-[44px]">
            <CardContent className="p-3">
              <p className="text-[11px] text-green-600 font-medium uppercase tracking-wide">Stock Value</p>
              <p className="text-lg font-bold text-green-700 tabular-nums">{formatINR(data.totalStockValue)}</p>
            </CardContent>
          </Card>
        </Link>
        <Link href="/bills" className="focus-ring rounded-xl">
          <Card className={`min-h-[44px] ${data.overdueBills > 0 ? "bg-amber-50 border-amber-300" : ""}`}>
            <CardContent className="p-3">
              <p className="text-[11px] text-slate-500 font-medium uppercase tracking-wide">Overdue Bills</p>
              <p className={`text-lg font-bold tabular-nums ${data.overdueBills > 0 ? "text-amber-600" : "text-green-600"}`}>
                {data.overdueBills > 0 ? data.overdueBills : "None"}
              </p>
            </CardContent>
          </Card>
        </Link>
      </div>

      {/* Operations + Service Row — three tiles since the AI Insights tile was removed with
          the /ai page. grid-cols-3 rather than the old 2/4 split, which now left a hole at
          both breakpoints. Matches the other three-tile grids in this file. */}
      <div className="grid grid-cols-3 gap-2 mt-3">
        <Link href="/reorder" className="focus-ring rounded-xl">
          <Card className={`min-h-[44px] ${data.lowStockCount > 0 ? "border-red-200" : ""}`}>
            <CardContent className="p-2.5 text-center">
              <AlertTriangle className="h-4 w-4 text-red-500 mx-auto mb-0.5" />
              <p className="text-xl font-bold text-slate-900 tabular-nums leading-none">{data.lowStockCount}</p>
              <p className="text-[11px] font-medium text-slate-500 mt-1">Low Stock</p>
            </CardContent>
          </Card>
        </Link>
        <Link href="/inbound" className="focus-ring rounded-xl">
          <Card className={`min-h-[44px] ${data.inboundInTransit > 0 ? "border-amber-200" : ""}`}>
            <CardContent className="p-2.5 text-center">
              <Truck className="h-4 w-4 text-amber-500 mx-auto mb-0.5" />
              <p className="text-xl font-bold text-slate-900 tabular-nums leading-none">{data.inboundInTransit}</p>
              <p className="text-[11px] font-medium text-slate-500 mt-1">In Transit</p>
            </CardContent>
          </Card>
        </Link>
        <Link href="/vendor-issues" className="focus-ring rounded-xl">
          <Card className={`min-h-[44px] ${data.openVendorIssues > 0 ? "border-red-200" : ""}`}>
            <CardContent className="p-2.5 text-center">
              <ShieldAlert className="h-4 w-4 text-red-500 mx-auto mb-0.5" />
              <p className="text-xl font-bold text-slate-900 tabular-nums leading-none">{data.openVendorIssues}</p>
              <p className="text-[11px] font-medium text-slate-500 mt-1">Ops Issues</p>
            </CardContent>
          </Card>
        </Link>
      </div>

      {/* Daily Pulse */}
      <div className="flex gap-3 mt-3">
        <Card className="flex-1">
          <CardContent className="p-3 text-center">
            <ArrowDownCircle className="h-4 w-4 text-blue-500 mx-auto mb-1" />
            <p className="text-xl font-bold text-slate-900 tabular-nums leading-none">{data.todayInwards}</p>
            <p className="text-[11px] font-medium text-slate-500 mt-1">Inwards Today</p>
          </CardContent>
        </Card>
        <Card className="flex-1">
          <CardContent className="p-3 text-center">
            <ArrowUpCircle className="h-4 w-4 text-orange-500 mx-auto mb-1" />
            <p className="text-xl font-bold text-slate-900 tabular-nums leading-none">{data.todayOutwards}</p>
            <p className="text-[11px] font-medium text-slate-500 mt-1">Outwards Today</p>
          </CardContent>
        </Card>
      </div>

      <div className="mb-3">
        <ShareDailyReport />
      </div>

      {/* Critical Alerts moved to top of dashboard */}

      {/* Team Health — Per-person accountability */}
      {data.people.length > 0 && (
        <Card className="mt-4">
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-1.5">
                <Users className="h-4 w-4 text-slate-600" />
                Team Health
              </CardTitle>
              {/* Replaces the 08:00 cron that used to push this scorecard automatically. */}
              <SendScorecardButton />
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.people.map((person) => (
              <div key={person.name} className="flex items-center justify-between py-1.5 border-b border-slate-100 last:border-0">
                <div>
                  <p className="text-sm font-medium text-slate-900">{person.name}</p>
                  <p className="text-[11px] text-slate-500">{person.role}</p>
                </div>
                <div className="flex items-center gap-1.5">
                  {person.overdue72h > 0 && (
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-red-200 text-red-900 tabular-nums animate-pulse">
                      {person.overdue72h} 72h+
                    </span>
                  )}
                  {person.overdue48h > person.overdue72h && (
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-red-100 text-red-800 tabular-nums">
                      {person.overdue48h - person.overdue72h} 48h+
                    </span>
                  )}
                  {person.overdue24h > person.overdue48h && (
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-yellow-100 text-yellow-800 tabular-nums">
                      {person.overdue24h - person.overdue48h} 24h+
                    </span>
                  )}
                  <span className="text-sm font-bold text-slate-700 tabular-nums">{person.pending}</span>
                  <span className="text-[11px] text-slate-400">pending</span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Today's Summary */}
      {data.todaySummary && (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5">
              <Clock className="h-4 w-4 text-slate-600" />
              Today&apos;s Summary
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              <div className="flex justify-between py-1 border-b border-slate-50">
                <span className="text-slate-500">Inwards verified</span>
                <span className="font-medium text-green-600 tabular-nums">{data.todaySummary.inwardsVerified || 0}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-50">
                <span className="text-slate-500">Inwards pending</span>
                <span className={`font-medium tabular-nums ${(data.todaySummary.inwardsPending || 0) > 0 ? "text-amber-600" : "text-green-600"}`}>{data.todaySummary.inwardsPending || 0}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-50">
                <span className="text-slate-500">Deliveries closed</span>
                <span className="font-medium text-green-600 tabular-nums">{data.todaySummary.deliveriesClosed || 0}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-50">
                <span className="text-slate-500">Deliveries pending</span>
                <span className={`font-medium tabular-nums ${(data.todaySummary.deliveriesPending || 0) > 0 ? "text-amber-600" : "text-green-600"}`}>{data.todaySummary.deliveriesPending || 0}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-50">
                <span className="text-slate-500">Expenses today</span>
                <span className="font-medium tabular-nums">{data.todaySummary.expensesRecorded || 0}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-50">
                <span className="text-slate-500">POs no tracking</span>
                <span className={`font-medium tabular-nums ${(data.todaySummary.posWithoutTracking || 0) > 0 ? "text-red-600" : "text-green-600"}`}>{data.todaySummary.posWithoutTracking || 0}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Overdue Bills */}
      {data.overdueBillsList.length > 0 && (
        <Card className="mt-4">
          <CardHeader><CardTitle className="text-red-600">Overdue Bills</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {data.overdueBillsList.slice(0, 5).map((bill) => (
              <Link key={bill.id} href={`/bills/${bill.id}`} className="block focus-ring rounded-lg">
                <div className="flex items-center justify-between gap-2 py-2 border-b border-slate-100 last:border-0">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900 truncate">{bill.vendor.name}</p>
                    <p className="text-xs text-slate-500 tabular-nums">{bill.billNo} | Due: {new Date(bill.dueDate).toLocaleDateString("en-IN")}</p>
                  </div>
                  <p className="text-sm font-bold text-red-600 tabular-nums shrink-0">{formatINR(bill.amount - bill.paidAmount)}</p>
                </div>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}

    </>
  );
}

interface SupervisorData {
  outstandingPayable: number;
  outstandingReceivable: number;
  overdueBills: number;
  openIssues: number;
  todayInwards: number;
  todayOutwards: number;
  overdueBillsList: Array<{ id: string; billNo: string; amount: number; paidAmount: number; dueDate: string; vendor: { name: string } }>;
}

function SupervisorDashboard() {
  const [data, setData] = useState<SupervisorData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const today = new Date().toISOString().split("T")[0];
    const safeFetch = (url: string) => fetch(url).then((r) => r.ok ? r.json() : { success: false }).catch(() => ({ success: false }));

    Promise.all([
      safeFetch("/api/accounts/summary"),
      safeFetch(`/api/inventory/inwards?dateFrom=${today}&limit=50`),
      safeFetch(`/api/inventory/outwards?dateFrom=${today}&limit=50`),
      safeFetch("/api/customer-invoices?status=PENDING&limit=500"),
      safeFetch("/api/vendor-issues?status=OPEN&limit=1"),
    ])
      .then(([accountsRes, inwardsRes, outwardsRes, receivablesRes, issuesRes]) => {
        const acct = accountsRes.success ? accountsRes.data : null;
        const inwards = inwardsRes.success ? inwardsRes.data : [];
        const outwards = outwardsRes.success ? outwardsRes.data : [];
        const inwardQty = inwards.reduce((s: number, t: { quantity: number }) => s + t.quantity, 0);
        const outwardQty = outwards.reduce((s: number, t: { quantity: number }) => s + t.quantity, 0);

        // Calculate total receivable from pending invoices
        const invoices = receivablesRes.success ? receivablesRes.data : [];
        const totalReceivable = invoices.reduce((s: number, inv: { amount: number; paidAmount: number }) => s + (inv.amount - inv.paidAmount), 0);

        setData({
          outstandingPayable: acct?.stats?.outstandingPayable || 0,
          outstandingReceivable: totalReceivable,
          overdueBills: acct?.stats?.overdueBills || 0,
          openIssues: issuesRes.success ? (issuesRes.pagination?.total || 0) : 0,
          todayInwards: inwardQty,
          todayOutwards: outwardQty,
          overdueBillsList: acct?.overdueBillsList || [],
        });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <SkeletonDashboard />;
  }

  if (!data) {
    return (
      <div className="text-center py-12">
        <AlertTriangle className="h-8 w-8 text-red-400 mx-auto mb-2" />
        <p className="text-sm text-slate-500">Failed to load dashboard.</p>
      </div>
    );
  }

  return (
    <>
      {/* What needs me now — priorities first */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Link href="/accounts" className="focus-ring rounded-xl">
          <Card className="bg-red-50 border-red-200 min-h-[44px]">
            <CardContent className="p-3">
              <p className="text-[11px] text-red-600 font-medium">Outstanding Payable</p>
              <p className="text-lg font-bold text-red-700 tabular-nums">{formatINR(data.outstandingPayable)}</p>
            </CardContent>
          </Card>
        </Link>
        <Link href="/receivables" className="focus-ring rounded-xl">
          <Card className="bg-blue-50 border-blue-200 min-h-[44px]">
            <CardContent className="p-3">
              <p className="text-[11px] text-blue-600 font-medium">Outstanding Receivable</p>
              <p className="text-lg font-bold text-blue-700 tabular-nums">{formatINR(data.outstandingReceivable)}</p>
            </CardContent>
          </Card>
        </Link>
        <Link href="/bills" className="focus-ring rounded-xl">
          <Card className={`min-h-[44px] ${data.overdueBills > 0 ? "bg-red-50 border-red-300" : ""}`}>
            <CardContent className="p-3">
              <p className="text-[11px] text-slate-500 font-medium">Overdue Bills</p>
              <p className={`text-lg font-bold tabular-nums ${data.overdueBills > 0 ? "text-red-600" : "text-green-600"}`}>
                {data.overdueBills > 0 ? data.overdueBills : "None"}
              </p>
            </CardContent>
          </Card>
        </Link>
        <Link href="/vendor-issues" className="focus-ring rounded-xl">
          <Card className={`min-h-[44px] ${data.openIssues > 0 ? "bg-orange-50 border-orange-200" : ""}`}>
            <CardContent className="p-3">
              <p className="text-[11px] text-slate-500 font-medium">Open Issues</p>
              <p className={`text-lg font-bold tabular-nums ${data.openIssues > 0 ? "text-orange-600" : "text-green-600"}`}>
                {data.openIssues > 0 ? data.openIssues : "None"}
              </p>
            </CardContent>
          </Card>
        </Link>
      </div>

      {/* Daily Pulse */}
      <div className="flex gap-3 mt-3">
        <Card className="flex-1">
          <CardContent className="p-3 text-center">
            <ArrowDownCircle className="h-4 w-4 text-blue-500 mx-auto mb-1" />
            <p className="text-xl font-bold text-slate-900 tabular-nums leading-none">{data.todayInwards}</p>
            <p className="text-[11px] font-medium text-slate-500 mt-1">Inwards Today</p>
          </CardContent>
        </Card>
        <Card className="flex-1">
          <CardContent className="p-3 text-center">
            <ArrowUpCircle className="h-4 w-4 text-orange-500 mx-auto mb-1" />
            <p className="text-xl font-bold text-slate-900 tabular-nums leading-none">{data.todayOutwards}</p>
            <p className="text-[11px] font-medium text-slate-500 mt-1">Outwards Today</p>
          </CardContent>
        </Card>
      </div>

      {/* Daily Report */}
      <div className="mt-3">
        <ShareDailyReport />
      </div>

      {/* Overdue Bills */}
      {data.overdueBillsList.length > 0 && (
        <Card className="mt-4">
          <CardHeader><CardTitle className="text-red-600">Overdue Bills</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {data.overdueBillsList.slice(0, 5).map((bill) => (
              <Link key={bill.id} href={`/bills/${bill.id}`} className="block focus-ring rounded-lg">
                <div className="flex items-center justify-between gap-2 py-2 border-b border-slate-100 last:border-0">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900 truncate">{bill.vendor.name}</p>
                    <p className="text-xs text-slate-500 tabular-nums">{bill.billNo} | Due: {new Date(bill.dueDate).toLocaleDateString("en-IN")}</p>
                  </div>
                  <p className="text-sm font-bold text-red-600 tabular-nums shrink-0">{formatINR(bill.amount - bill.paidAmount)}</p>
                </div>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}
    </>
  );
}

function ClerkDashboard({ type }: { type: "inward" | "outward" }) {
  const [transactions, setTransactions] = useState<Array<{ id: string; type: string; quantity: number; createdAt: string; referenceNo?: string; product: { name: string; sku: string } }>>([]);
  const [deliveryStats, setDeliveryStats] = useState<{ pending: number; verified: number; scheduled: number; packed: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [shareOpen, setShareOpen] = useState(false);

  useEffect(() => {
    const today = new Date().toISOString().split("T")[0];
    const endpoint = type === "inward" ? "/api/inventory/inwards" : "/api/inventory/outwards";
    Promise.all([
      fetch(`${endpoint}?dateFrom=${today}&limit=50&mine=true`).then(r => r.json()),
      fetch("/api/deliveries/stats").then(r => r.json()).catch(() => ({ success: false })),
    ]).then(([txRes, statsRes]) => {
      if (txRes.success) setTransactions(txRes.data);
      if (statsRes.success) setDeliveryStats(statsRes.data);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [type]);

  if (loading) {
    return <SkeletonDashboard />;
  }

  const totalQty = transactions.reduce((s, t) => s + t.quantity, 0);
  const label = type === "inward" ? "Inwards" : "Outwards";

  return (
    <>
      {/* Share dropdown — top-right */}
      <div className="flex justify-end mb-3 relative">
        <button
          onClick={() => setShareOpen(!shareOpen)}
          className="flex items-center gap-1.5 px-3 py-2 min-h-[44px] rounded-lg border border-slate-200 bg-white text-sm text-slate-600 hover:bg-slate-50 focus-ring"
        >
          <Share2 className="h-4 w-4" />
          Share
        </button>
        {shareOpen && (
          <div className="absolute right-0 top-10 z-20 bg-white border border-slate-200 rounded-lg shadow-lg py-1 w-56">
            <div onClick={() => setShareOpen(false)}>
              <ShareDailyReport />
            </div>
            {type === "inward" && (
              <div onClick={() => setShareOpen(false)}>
                <InwardsEODReport />
              </div>
            )}
          </div>
        )}
      </div>

      {/* 3 stat cards */}
      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-3 text-center">
            <ArrowDownCircle className="h-5 w-5 text-blue-500 mx-auto mb-1" />
            <p className="text-2xl font-bold text-slate-900 tabular-nums leading-none">{totalQty}</p>
            <p className="text-[11px] font-medium text-slate-500 mt-1">
              {type === "inward" ? "Received Today" : "Dispatched Today"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <Clock className="h-5 w-5 text-amber-500 mx-auto mb-1" />
            <p className="text-2xl font-bold text-slate-900 tabular-nums leading-none">
              {type === "inward"
                ? (deliveryStats?.pending ?? 0)
                : ((deliveryStats?.packed ?? 0) + (deliveryStats?.scheduled ?? 0))}
            </p>
            <p className="text-[11px] font-medium text-slate-500 mt-1">
              {type === "inward" ? "Pending Verify" : "Pending Dispatch"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            {type === "inward" ? (
              <Truck className="h-5 w-5 text-orange-500 mx-auto mb-1" />
            ) : (
              <Users className="h-5 w-5 text-green-500 mx-auto mb-1" />
            )}
            <p className="text-2xl font-bold text-slate-900 tabular-nums leading-none">
              {type === "inward"
                ? ((deliveryStats?.pending ?? 0) + (deliveryStats?.verified ?? 0))
                : (deliveryStats?.pending ?? 0)}
            </p>
            <p className="text-[11px] font-medium text-slate-500 mt-1">
              {type === "inward" ? "Stock Out Queue" : "Walk-outs Today"}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Quick action button */}
      <Link href={type === "inward" ? "/inbound" : "/deliveries"} className="block mt-4 focus-ring rounded-lg">
        <button className="w-full min-h-[44px] h-14 text-base font-semibold bg-green-600 hover:bg-green-700 text-white rounded-lg flex items-center justify-center gap-2 mb-4">
          {type === "inward" ? (
            <><ArrowDownCircle className="h-5 w-5" /> Receive Shipment</>
          ) : (
            <><ArrowUpCircle className="h-5 w-5" /> Process Outward</>
          )}
        </button>
      </Link>

      {/* Transaction list */}
      {transactions.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Today&apos;s {label}</CardTitle></CardHeader>
          <CardContent>
            {transactions.map((t) => (
              <TransactionItem key={t.id} direction={type === "inward" ? "in" : "out"} productName={t.product?.name || "Unknown"} sku={t.product?.sku || ""} quantity={t.quantity} time={formatTime(t.createdAt)} reference={t.referenceNo} />
            ))}
          </CardContent>
        </Card>
      )}
    </>
  );
}

function OutwardsClerkDashboard() {
  const [stats, setStats] = useState<{ pending: number; verified: number; scheduled: number; outForDelivery: number; delivered: number; deliveredToday: number; flagged: number; prebooked: number; packed?: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [shareOpen, setShareOpen] = useState(false);

  useEffect(() => {
    fetch("/api/deliveries/stats")
      .then((r) => r.json())
      .then((res) => { if (res.success) setStats(res.data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <SkeletonDashboard />;
  }
  if (!stats) {
    return <div className="text-center py-12"><AlertTriangle className="h-8 w-8 text-red-400 mx-auto mb-2" /><p className="text-sm text-slate-500">Failed to load dashboard.</p></div>;
  }

  return (
    <>
      {/* Share dropdown — top-right */}
      <div className="flex justify-end mb-3 relative">
        <button
          onClick={() => setShareOpen(!shareOpen)}
          className="flex items-center gap-1.5 px-3 py-2 min-h-[44px] rounded-lg border border-slate-200 bg-white text-sm text-slate-600 hover:bg-slate-50 focus-ring"
        >
          <Share2 className="h-4 w-4" />
          Share
        </button>
        {shareOpen && (
          <div className="absolute right-0 top-10 z-20 bg-white border border-slate-200 rounded-lg shadow-lg py-1 w-56">
            <div onClick={() => setShareOpen(false)}>
              <ShareDailyReport />
            </div>
          </div>
        )}
      </div>

      {/* What needs me now — Walk-out nudge, urgent if pending > 0 */}
      {stats.pending > 0 && (
        <Link href="/deliveries/walkout" className="block focus-ring rounded-xl">
          <Card className="mb-3 border-amber-300 bg-amber-50 animate-pulse-slow">
            <CardContent className="p-3 flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-amber-200 flex items-center justify-center flex-shrink-0">
                <CheckCircle2 className="h-5 w-5 text-amber-700" />
              </div>
              <div className="flex-1">
                <p className="text-base font-bold text-amber-800 tabular-nums">{stats.pending} Walk-outs pending</p>
                <p className="text-xs text-amber-600">Verify walk-out deliveries before end of day</p>
              </div>
              <ChevronRight className="h-4 w-4 text-amber-400" />
            </CardContent>
          </Card>
        </Link>
      )}

      {/* 3 stat cards */}
      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-3 text-center">
            <ArrowUpCircle className="h-5 w-5 text-orange-500 mx-auto mb-1" />
            <p className="text-2xl font-bold text-slate-900 tabular-nums leading-none">{stats.delivered || stats.deliveredToday || 0}</p>
            <p className="text-[11px] font-medium text-slate-500 mt-1">Dispatched Today</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <Clock className="h-5 w-5 text-amber-500 mx-auto mb-1" />
            <p className="text-2xl font-bold text-slate-900 tabular-nums leading-none">{(stats.packed ?? 0) + stats.scheduled}</p>
            <p className="text-[11px] font-medium text-slate-500 mt-1">Pending Dispatch</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <Users className="h-5 w-5 text-green-500 mx-auto mb-1" />
            <p className="text-2xl font-bold text-slate-900 tabular-nums leading-none">{stats.pending}</p>
            <p className="text-[11px] font-medium text-slate-500 mt-1">Walk-outs Today</p>
          </CardContent>
        </Card>
      </div>

      {/* Quick action button */}
      <Link href="/deliveries" className="block mt-4 focus-ring rounded-lg">
        <button className="w-full min-h-[44px] h-14 text-base font-semibold bg-green-600 hover:bg-green-700 text-white rounded-lg flex items-center justify-center gap-2 mb-4">
          <ArrowUpCircle className="h-5 w-5" /> Process Outward
        </button>
      </Link>

      {/* Secondary cards row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Link href="/deliveries/dispatch">
          <DashboardCard label="Out for Delivery" value={stats.outForDelivery} icon={Truck} color="bg-orange-100 text-orange-700" />
        </Link>
        <Link href="/deliveries">
          <DashboardCard label="Delivered" value={stats.delivered || stats.deliveredToday} icon={CheckCircle2} color="bg-green-100 text-green-700" />
        </Link>
        {stats.flagged > 0 && (
          <Link href="/deliveries">
            <DashboardCard label="Flagged" value={stats.flagged} icon={Flag} color="bg-red-100 text-red-700" />
          </Link>
        )}
        {stats.prebooked > 0 && (
          <Link href="/deliveries?status=PREBOOKED">
            <DashboardCard label="Prebooked" value={stats.prebooked} icon={Package} color="bg-purple-100 text-purple-700" />
          </Link>
        )}
      </div>
    </>
  );
}

function PurchaseManagerDashboard() {
  const [stats, setStats] = useState<{ totalProducts: number; lowStock: number; todayInwards: number } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const today = new Date().toISOString().split("T")[0];
    const safeFetch = (url: string) => fetch(url).then((r) => r.ok ? r.json() : { success: false }).catch(() => ({ success: false }));
    Promise.all([
      safeFetch("/api/products?limit=1&status=ACTIVE"),
      safeFetch("/api/dashboard/stats"),
      safeFetch(`/api/inventory/inwards?dateFrom=${today}&limit=1`),
    ]).then(([prodRes, insightsRes, inwardsRes]) => {
      const insightData = insightsRes.success ? insightsRes.data : [];
      const reorderInsight = insightData.find((i: { type: string }) => i.type === "reorder");
      setStats({
        totalProducts: prodRes.success ? (prodRes.pagination?.total || 0) : 0,
        lowStock: reorderInsight?.value || 0,
        todayInwards: inwardsRes.success ? (inwardsRes.pagination?.total || 0) : 0,
      });
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <SkeletonDashboard />;
  }
  if (!stats) {
    return <div className="text-center py-12"><AlertTriangle className="h-8 w-8 text-red-400 mx-auto mb-2" /><p className="text-sm text-slate-500">Failed to load dashboard.</p></div>;
  }
  return (
    <>
    {/* What needs me now — Low Stock first */}
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <Link href="/reorder" className="focus-ring rounded-xl"><DashboardCard label="Low Stock" value={stats.lowStock} icon={AlertTriangle} color="bg-red-100 text-red-600" /></Link>
      <DashboardCard label="Total Products" value={stats.totalProducts} icon={Package} color="bg-blue-100 text-blue-700" />
      <DashboardCard label="Inwards Today" value={stats.todayInwards} icon={ArrowDownCircle} color="bg-blue-100 text-blue-600" />
      <Link href="/purchase-orders" className="focus-ring rounded-xl"><DashboardCard label="Pending POs" value="—" icon={Package} color="bg-orange-100 text-orange-600" /></Link>
    </div>
    <div className="mt-3">
      <ShareDailyReport />
    </div>
    </>
  );
}

function AccountsManagerDashboard() {
  const [stats, setStats] = useState<{ openIssues: number; pendingAudits: number; expenses30d: number } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const safeFetch = (url: string) => fetch(url).then((r) => r.ok ? r.json() : { success: false }).catch(() => ({ success: false }));
    Promise.all([
      safeFetch("/api/vendor-issues?status=OPEN&limit=1"),
      safeFetch("/api/stock-counts?status=PENDING&limit=1"),
      safeFetch("/api/accounts/summary"),
    ])
      .then(([issuesRes, auditsRes, accountsRes]) => {
        const acct = accountsRes.success ? accountsRes.data : null;
        setStats({
          openIssues: issuesRes.success ? (issuesRes.pagination?.total || 0) : 0,
          pendingAudits: auditsRes.success ? (auditsRes.pagination?.total || 0) : 0,
          expenses30d: acct?.stats?.totalExpenses30d || 0,
        });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <SkeletonDashboard />;
  }
  if (!stats) {
    return <div className="text-center py-12"><AlertTriangle className="h-8 w-8 text-red-400 mx-auto mb-2" /><p className="text-sm text-slate-500">Failed to load dashboard.</p></div>;
  }
  return (
    <>
    {/* What needs me now — Ops Issues first */}
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <Link href="/vendor-issues" className="focus-ring rounded-xl"><DashboardCard label="Ops Issues" value={stats.openIssues} icon={ShieldAlert} color={stats.openIssues > 0 ? "bg-red-100 text-red-600" : "bg-green-100 text-green-600"} /></Link>
      <Link href="/stock-audit" className="focus-ring rounded-xl"><DashboardCard label="Pending Audits" value={stats.pendingAudits} icon={Package} color="bg-blue-100 text-blue-700" /></Link>
      <Link href="/expenses" className="focus-ring rounded-xl"><DashboardCard label="Expenses (30d)" value={formatINR(stats.expenses30d)} icon={IndianRupee} color="bg-green-100 text-green-700" /></Link>
    </div>
    <div className="mt-3">
      <ShareDailyReport />
    </div>
    </>
  );
}

export default function DashboardPage() {
  const { data: session } = useSession();
  const { role, can, loading } = usePermissions();
  const userName = session?.user?.name || "User";

  // Which dashboard to show is decided by what the user can actually DO, not by their role's
  // name. A role created in the UI tomorrow gets a sensible dashboard automatically; the old
  // name-matching switch would have rendered a blank page for it.
  function pickDashboard() {
    if (can("team", "view") && can("reports", "view")) return <AdminDashboard />;
    if (can("stock_audit", "approve") || can("transfers", "approve")) return <SupervisorDashboard />;
    if (can("purchase_orders", "view")) return <PurchaseManagerDashboard />;
    if (can("bills", "view") || can("expenses", "view")) return <AccountsManagerDashboard />;
    if (can("deliveries", "view")) return <OutwardsClerkDashboard />;
    return <ClerkDashboard type="inward" />;
  }

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-lg font-bold text-slate-900">Hello, {userName}</h1>
        <p className="text-sm text-slate-500 tabular-nums">
          {new Date().toLocaleDateString("en-IN", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
        </p>
        <p className="text-xs font-medium text-slate-400 mt-0.5">{role?.name || "Team Member"}</p>
      </div>

      {!loading && pickDashboard()}
    </div>
  );
}

