"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  IndianRupee, Package, ArrowDownCircle, ArrowUpCircle,
  Truck, AlertTriangle, Users, TrendingUp, Loader2,
} from "lucide-react";

function formatINR(n: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
}

interface KPI {
  label: string;
  value: string | number;
  icon: typeof IndianRupee;
  color: string;
  href: string;
}

interface HealthPerson {
  name: string;
  role: string;
  pending: number;
  overdue24h: number;
  overdue48h: number;
  overdue72h: number;
}

interface Alert {
  type: string;
  message: string;
  owner: string;
  count: number;
}

export default function DesktopDashboard() {
  const [loading, setLoading] = useState(true);
  const [kpis, setKpis] = useState<KPI[]>([]);
  const [people, setPeople] = useState<HealthPerson[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [todaySummary, setTodaySummary] = useState<Record<string, number>>({});
  const [compliance, setCompliance] = useState<number | null>(null);

  useEffect(() => {
    const today = new Date().toISOString().split("T")[0];
    const safeFetch = (url: string) => fetch(url).then((r) => r.ok ? r.json() : { success: false }).catch(() => ({ success: false }));

    Promise.all([
      safeFetch("/api/accounts/summary"),
      safeFetch("/api/dashboard/stats"),
      safeFetch(`/api/inventory/inwards?dateFrom=${today}&limit=1`),
      safeFetch(`/api/inventory/outwards?dateFrom=${today}&limit=1`),
      safeFetch("/api/health/summary"),
      safeFetch("/api/inbound/stats"),
      safeFetch("/api/deliveries/stats"),
    ])
      .then(([accountsRes, insightsRes, inwardsRes, outwardsRes, healthRes, inboundRes, delivRes]) => {
        const acct = accountsRes.success ? accountsRes.data : null;
        const insightData = insightsRes.success ? insightsRes.data : [];
        const stockValueInsight = insightData.find((i: { type: string }) => i.type === "stock_value");

        setKpis([
          { label: "Payable", value: formatINR(acct?.stats?.outstandingPayable || 0), icon: IndianRupee, color: "bg-red-50 text-red-700 border-red-200", href: "/desktop/accounts" },
          { label: "Receivable", value: formatINR(acct?.stats?.outstandingReceivable || 0), icon: TrendingUp, color: "bg-blue-50 text-blue-700 border-blue-200", href: "/desktop/accounts" },
          { label: "Stock Value", value: formatINR(stockValueInsight?.value || 0), icon: Package, color: "bg-green-50 text-green-700 border-green-200", href: "/desktop/stock" },
          { label: "Overdue Bills", value: acct?.stats?.overdueBills || 0, icon: AlertTriangle, color: "bg-amber-50 text-amber-700 border-amber-200", href: "/desktop/accounts" },
          { label: "Today Inwards", value: inwardsRes.success ? (inwardsRes.pagination?.total || 0) : 0, icon: ArrowDownCircle, color: "bg-emerald-50 text-emerald-700 border-emerald-200", href: "/desktop/inbound" },
          { label: "Today Outwards", value: outwardsRes.success ? (outwardsRes.pagination?.total || 0) : 0, icon: ArrowUpCircle, color: "bg-purple-50 text-purple-700 border-purple-200", href: "/desktop/deliveries" },
          { label: "In Transit", value: inboundRes.success ? (inboundRes.data?.inTransit?.items || 0) : 0, icon: Truck, color: "bg-sky-50 text-sky-700 border-sky-200", href: "/desktop/inbound" },
          { label: "Pending Deliveries", value: delivRes.success ? (delivRes.data?.pending || 0) : 0, icon: Truck, color: "bg-orange-50 text-orange-700 border-orange-200", href: "/desktop/deliveries" },
        ]);

        if (healthRes.success) {
          setPeople(healthRes.data?.people || []);
          setAlerts(healthRes.data?.criticalAlerts || []);
          setTodaySummary(healthRes.data?.today || {});
          setCompliance(typeof healthRes.data?.compliancePct === "number" ? healthRes.data.compliancePct : null);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-slate-900">Dashboard</h1>

      {/* KPI Cards */}
      <div className="grid grid-cols-4 gap-4">
        {kpis.map((kpi) => {
          const Icon = kpi.icon;
          return (
            <Link key={kpi.label} href={kpi.href}>
              <div className={`rounded-xl border p-4 transition-shadow hover:shadow-md ${kpi.color}`}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold uppercase tracking-wider opacity-70">{kpi.label}</span>
                  <Icon className="h-4.5 w-4.5 opacity-50" />
                </div>
                <p className="text-2xl font-bold">{kpi.value}</p>
              </div>
            </Link>
          );
        })}
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Critical Alerts */}
        <div className="col-span-2 bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100">
            <h2 className="text-sm font-semibold text-slate-900">Critical Alerts</h2>
          </div>
          <div className="divide-y divide-slate-100">
            {alerts.length === 0 ? (
              <div className="px-5 py-8 text-center text-sm text-slate-400">No critical alerts</div>
            ) : (
              alerts.map((alert, i) => (
                <div key={i} className="px-5 py-3 flex items-center gap-3">
                  <AlertTriangle className="h-4 w-4 text-red-500 shrink-0" />
                  <div className="flex-1">
                    <p className="text-sm text-slate-800">{alert.message}</p>
                    <p className="text-xs text-slate-400">Owner: {alert.owner}</p>
                  </div>
                  <span className="text-sm font-bold text-red-600">{alert.count}</span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Today's Summary */}
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100">
            <h2 className="text-sm font-semibold text-slate-900">Today&apos;s Summary</h2>
          </div>
          <div className="px-5 py-3 space-y-3">
            {[
              { label: "Inwards Verified", value: todaySummary.inwardsVerified || 0 },
              { label: "Inwards Pending", value: todaySummary.inwardsPending || 0 },
              { label: "Deliveries Closed", value: todaySummary.deliveriesClosed || 0 },
              { label: "Deliveries Pending", value: todaySummary.deliveriesPending || 0 },
              { label: "Expenses Recorded", value: todaySummary.expensesRecorded || 0 },
            ].map((item) => (
              <div key={item.label} className="flex items-center justify-between">
                <span className="text-sm text-slate-600">{item.label}</span>
                <span className="text-sm font-semibold text-slate-900">{item.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Team Performance */}
      {people.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-slate-500" />
                <h2 className="text-sm font-semibold text-slate-900">Team Status</h2>
              </div>
              {compliance !== null && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400">Compliance</span>
                  <span
                    className={`text-sm font-bold px-2 py-0.5 rounded-full ${
                      compliance >= 90
                        ? "bg-green-50 text-green-700"
                        : compliance >= 70
                        ? "bg-amber-50 text-amber-700"
                        : "bg-red-50 text-red-700"
                    }`}
                  >
                    {compliance}%
                  </span>
                </div>
              )}
            </div>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50">
                <th className="text-left px-5 py-2.5 text-xs font-semibold text-slate-500 uppercase">Name</th>
                <th className="text-left px-5 py-2.5 text-xs font-semibold text-slate-500 uppercase">Role</th>
                <th className="text-center px-5 py-2.5 text-xs font-semibold text-slate-500 uppercase">Pending</th>
                <th className="text-center px-5 py-2.5 text-xs font-semibold text-amber-500 uppercase">24h+</th>
                <th className="text-center px-5 py-2.5 text-xs font-semibold text-orange-500 uppercase">48h+</th>
                <th className="text-center px-5 py-2.5 text-xs font-semibold text-red-500 uppercase">72h+</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {people.map((p) => (
                <tr key={p.name} className="hover:bg-slate-50">
                  <td className="px-5 py-3 font-medium text-slate-900">{p.name}</td>
                  <td className="px-5 py-3 text-slate-500 capitalize">{p.role.toLowerCase().replace(/_/g, " ")}</td>
                  <td className="px-5 py-3 text-center">{p.pending}</td>
                  <td className="px-5 py-3 text-center">{p.overdue24h > 0 ? <span className="text-amber-600 font-semibold">{p.overdue24h}</span> : "—"}</td>
                  <td className="px-5 py-3 text-center">{p.overdue48h > 0 ? <span className="text-orange-600 font-semibold">{p.overdue48h}</span> : "—"}</td>
                  <td className="px-5 py-3 text-center">{p.overdue72h > 0 ? <span className="text-red-600 font-bold">{p.overdue72h}</span> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
