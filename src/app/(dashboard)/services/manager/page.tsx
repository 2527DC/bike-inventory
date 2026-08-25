"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { JOB_STATUS, JOB_TYPE } from "@/lib/services/constants";
import { formatIST, getStartOfTodayIST } from "@/lib/services/timezone";

import JobCard from "@/components/services/JobCard";
import {
  AlertTriangle, PauseCircle, Clock3, ArrowRight, Timer, Star, Trophy,
  Home as HomeIcon, ClipboardList, MoreHorizontal, Wrench, Package,
  ScrollText, Users, TrendingUp, IndianRupee, Search, Loader2,
} from "lucide-react";

type Job = {
  id: string;
  tokenNumber: string;
  status: string;
  jobType: string;
  bikeType: string;
  complaint: string | null;
  partsNeeded: string | null;
  holdReason: string | null;
  notes: string | null;
  estimatedHrs: number;
  amount: number | null;
  isEcycle: boolean;
  priority: number;
  receivedAt: string;
  promisedAt: string | null;
  readyAt: string | null;
  deliveredAt: string | null;
  zohoInvoiceId: string | null;
  photos: string[];
  afterPhotos: string[];
  customer: { name: string; phone: string };
  mechanic: { name: string; emoji: string } | null;
  review: { rating: number; googleReview: boolean } | null;
};

type AssemblyLog = {
  id: string;
  assemblyType: string;
  bikeModel: string | null;
  photos: string[];
  createdAt: string;
  mechanic: { name: string; emoji: string };
};

type Incentive = {
  id: string;
  name: string;
  emoji: string;
  todayDelivered: number;
  todayIncentive: number;
  todayProgress: number;
  monthDelivered: number;
  monthIncentive: number;
};

type AuditEntry = {
  id: string;
  jobId: string;
  action: string;
  fromStatus: string | null;
  toStatus: string | null;
  details: string | null;
  userName: string;
  userRole: string;
  createdAt: string;
};

export default function ManagerPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [liveJobs, setLiveJobs] = useState<Job[]>([]);
  const [openNow, setOpenNow] = useState<"overdue" | "hold" | "ready" | null>(null);
  const [incentives, setIncentives] = useState<Incentive[]>([]);
  const [assemblies, setAssemblies] = useState<AssemblyLog[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"home" | "jobs" | "more">("home");
  const [moreView, setMoreView] = useState<"mechstatus" | "incentives" | "assembly" | "tat" | "audit" | "team">("mechstatus");
  const [deleting, setDeleting] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [mechFilter, setMechFilter] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<Job[] | null>(null);
  const [exportFrom, setExportFrom] = useState("");
  const [exportTo, setExportTo] = useState("");
  const [dashDateRange, setDashDateRange] = useState<"today" | "3days" | "7days" | "all">("today");
  const [dashDay, setDashDay] = useState<string | null>(null); // a specific day (YYYY-MM-DD); overrides the preset
  const [dashFrom, setDashFrom] = useState(""); // custom range start (YYYY-MM-DD)
  const [dashTo, setDashTo] = useState("");     // custom range end (YYYY-MM-DD)

  const fetchData = useCallback(async () => {
    const today = formatIST(new Date(), { year: "numeric", month: "2-digit", day: "2-digit" }).split("/").reverse().join("-");
    const todayIST = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
    const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    let dateParams = "";
    if (dashFrom && dashTo) dateParams = `&from=${dashFrom}&to=${dashTo}`;
    else if (dashDay) dateParams = `&from=${dashDay}&to=${dashDay}`;
    else if (dashDateRange === "today") dateParams = `&from=${fmt(todayIST)}&to=${fmt(todayIST)}`;
    else if (dashDateRange === "3days") { const d = new Date(todayIST); d.setDate(d.getDate() - 2); dateParams = `&from=${fmt(d)}&to=${fmt(todayIST)}`; }
    else if (dashDateRange === "7days") { const d = new Date(todayIST); d.setDate(d.getDate() - 6); dateParams = `&from=${fmt(d)}&to=${fmt(todayIST)}`; }
    const [jobsRes, liveRes, incRes, asmRes, auditRes] = await Promise.all([
      fetch(`/api/services/jobs?includeDelivered=true${dateParams}`),
      fetch(`/api/services/jobs`), // live backlog — all active jobs, ignores the date filter
      fetch("/api/services/incentives"),
      fetch(`/api/services/assembly?date=${today}`),
      fetch("/api/services/audit?limit=100"),
    ]);
    if (jobsRes.ok) setJobs((await jobsRes.json()).jobs);
    if (liveRes.ok) setLiveJobs((await liveRes.json()).jobs);
    if (incRes.ok) setIncentives((await incRes.json()).incentives);
    if (asmRes.ok) setAssemblies((await asmRes.json()).logs);
    if (auditRes.ok) setAuditLogs((await auditRes.json()).logs);
    setLoading(false);
  }, [dashDateRange, dashDay, dashFrom, dashTo]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 60000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // Auto-dismiss the toast
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  // Server-side search — finds delivered jobs too
  useEffect(() => {
    if (search.trim().length < 2) { setSearchResults(null); return; }
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/services/jobs?includeDelivered=true&search=${encodeURIComponent(search.trim())}`);
        if (res.ok) setSearchResults((await res.json()).jobs);
      } catch { /* ignore */ }
    }, 400);
    return () => clearTimeout(timer);
  }, [search]);

  const handleDelete = async (jobId: string) => {
    if (!confirm("Delete this job? This cannot be undone.")) return;
    setDeleting(jobId);
    try {
      const res = await fetch("/api/services/jobs/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId }),
      });
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        // Remove the card from view immediately — don't wait on the refetch.
        setJobs((prev) => prev.filter((j) => j.id !== jobId));
        setSearchResults((prev) => (prev ? prev.filter((j) => j.id !== jobId) : prev));
        setToast(`🗑️ Deleted ${data.tokenNumber || "job"}`);
        fetchData();
      } else {
        alert((await res.json().catch(() => ({ error: "Delete failed" }))).error);
      }
    } catch {
      alert("Network error");
    }
    setDeleting(null);
  };

  const handleExport = () => {
    const params = new URLSearchParams();
    if (exportFrom) params.set("from", exportFrom);
    if (exportTo) params.set("to", exportTo);
    window.open(`/api/services/export?${params.toString()}`, "_blank");
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 size={32} className="animate-spin text-blue-700" />
      </div>
    );
  }

  const filteredJobs = search.trim().length >= 2 && searchResults ? searchResults : jobs;

  // Mechanic productivity for the SELECTED period (driven by the date / month filter).
  const mechStats: Record<string, { name: string; emoji: string; total: number; delivered: number }> = {};
  jobs.forEach((j) => {
    if (!j.mechanic) return;
    if (!mechStats[j.mechanic.name]) {
      mechStats[j.mechanic.name] = { name: j.mechanic.name, emoji: j.mechanic.emoji, total: 0, delivered: 0 };
    }
    mechStats[j.mechanic.name].total++;
    if (j.status === "DELIVERED") mechStats[j.mechanic.name].delivered++;
  });

  // TAT calculations (for delivered jobs)
  const deliveredJobs = jobs.filter((j) => j.status === "DELIVERED" && j.deliveredAt);
  const tatMinutes = deliveredJobs.map((j) => {
    const received = new Date(j.receivedAt).getTime();
    const delivered = new Date(j.deliveredAt!).getTime();
    return (delivered - received) / 60000;
  });
  const avgTatMins = tatMinutes.length > 0 ? tatMinutes.reduce((a, b) => a + b, 0) / tatMinutes.length : 0;
  const fmtTat = (mins: number) => {
    if (mins < 60) return `${Math.round(mins)}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ${Math.round(mins % 60)}m`;
    const days = Math.floor(hrs / 24);
    return `${days}d ${hrs % 24}h`;
  };
  const avgTatStr = fmtTat(avgTatMins);

  // Reviews — split CONFIRMED Google reviews from in-app placeholder ratings.
  // Every delivery auto-creates a review row, so the total review count overstates real reviews;
  // only googleReview === true are confirmed Google reviews (matches the incentive engine's gate).
  const googleReviews = jobs.filter((j) => j.review?.googleReview).map((j) => j.review!.rating);
  const inAppRatings = jobs.filter((j) => j.review).map((j) => j.review!.rating);
  const avgGoogleRating = googleReviews.length > 0 ? (googleReviews.reduce((a, b) => a + b, 0) / googleReviews.length).toFixed(1) : "—";

  // NOW — live backlog needing action (always current; ignores the date filter)
  const startTodayMs = getStartOfTodayIST().getTime();
  const nowOverdue = liveJobs.filter((j) => j.promisedAt && new Date(j.promisedAt).getTime() < startTodayMs);
  const nowHold = liveJobs.filter((j) => j.status === "PARTS_NEEDED");
  const nowReady = liveJobs.filter((j) => j.status === "READY");
  const nowMap: Record<"overdue" | "hold" | "ready", Job[]> = { overdue: nowOverdue, hold: nowHold, ready: nowReady };

  // PERIOD — throughput inside the selected date window
  const periodIntake = jobs.length;
  const periodDelivered = deliveredJobs.length;
  const promisedDelivered = deliveredJobs.filter((j) => j.promisedAt);
  const onTimeCount = promisedDelivered.filter((j) => new Date(j.deliveredAt!) <= new Date(new Date(j.promisedAt!).getTime() + 86400000)).length;
  const onTimePct = promisedDelivered.length > 0 ? Math.round((onTimeCount / promisedDelivered.length) * 100) : null;

  // Total incentive payout today
  const totalTodayIncentive = incentives.reduce((sum, i) => sum + i.todayIncentive, 0);

  // Date-filter helpers (month / custom range)
  const todayStr = formatIST(new Date(), { year: "numeric", month: "2-digit", day: "2-digit" }).split("/").reverse().join("-");
  const dashScopeLabel = (() => {
    if (dashFrom && dashTo) {
      // Friendly label when the range is exactly one calendar month, e.g. "Apr 2026".
      if (dashFrom.endsWith("-01") && dashFrom.slice(0, 7) === dashTo.slice(0, 7)) {
        const [y, mo] = dashFrom.split("-");
        return `${new Date(Number(y), Number(mo) - 1, 1).toLocaleString("en-US", { month: "short" })} ${y}`;
      }
      return `${dashFrom} → ${dashTo}`;
    }
    if (dashDay) return dashDay;
    if (dashDateRange === "all") return "all time";
    if (dashDateRange === "today") return "today";
    return `last ${dashDateRange.replace("days", " days")}`;
  })();

  // Top tabs collapse to Home / Jobs / More; the old per-section keys live under "More".
  const view = tab === "home" ? "overview" : tab === "jobs" ? "jobs" : moreView;

  return (
    <div className="p-4 pb-24">
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-gray-900 text-white text-sm font-bold px-4 py-2 rounded-full shadow-lg">
          {toast}
        </div>
      )}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold">Dashboard</h2>
      </div>

      {/* Search */}
      <div className="mb-4 relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search token or mechanic…"
          className="w-full border border-gray-200 rounded-xl pl-9 pr-3 py-2.5 text-sm focus:border-gray-800 focus:outline-none"
        />
      </div>

      {/* Date filter */}
      <div className="mb-4 space-y-2">
        {/* Preset pills */}
        <div className="flex gap-1.5 overflow-x-auto hide-scrollbar">
          {([["today", "Today"], ["3days", "3 Days"], ["7days", "7 Days"], ["all", "All"]] as const).map(([key, label]) => {
            const active = !dashDay && !(dashFrom && dashTo) && dashDateRange === key;
            return (
              <button key={key} onClick={() => { setDashDateRange(key); setDashDay(null); setDashFrom(""); setDashTo(""); }}
                className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-bold ${active ? "bg-gray-800 text-white" : "bg-gray-100 text-gray-600"}`}>
                {label}
              </button>
            );
          })}
        </div>
        {/* Month picker — see any past month's data */}
        <div className="flex items-center gap-2">
          <label className="text-xs font-bold text-gray-500 w-12">Month</label>
          <input type="month" max={todayStr.slice(0, 7)}
            value={dashFrom && dashTo && dashFrom.endsWith("-01") && dashFrom.slice(0, 7) === dashTo.slice(0, 7) ? dashFrom.slice(0, 7) : ""}
            onChange={(e) => {
              const v = e.target.value;
              setDashDay(null);
              if (!v) { setDashFrom(""); setDashTo(""); return; }
              const [y, mo] = v.split("-").map(Number);
              const lastDay = new Date(y, mo, 0).getDate();
              setDashFrom(`${v}-01`);
              setDashTo(`${v}-${String(lastDay).padStart(2, "0")}`);
            }}
            className="flex-1 border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:border-gray-800 focus:outline-none" />
        </div>
        {/* Custom range */}
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <label className="text-[10px] text-gray-400 block mb-0.5">From</label>
            <input type="date" value={dashFrom} max={todayStr}
              onChange={(e) => { setDashFrom(e.target.value); setDashDay(null); }}
              className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:border-gray-800 focus:outline-none" />
          </div>
          <div className="flex-1">
            <label className="text-[10px] text-gray-400 block mb-0.5">To</label>
            <input type="date" value={dashTo} max={todayStr}
              onChange={(e) => { setDashTo(e.target.value); setDashDay(null); }}
              className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:border-gray-800 focus:outline-none" />
          </div>
          {(dashFrom || dashTo) && <button onClick={() => { setDashFrom(""); setDashTo(""); }} className="text-xs text-gray-400 font-medium pb-2">clear</button>}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1.5 mb-4">
        {([
          ["home", "Home", HomeIcon],
          ["jobs", "Jobs", ClipboardList],
          ["more", "More", MoreHorizontal],
        ] as const).map(([key, label, Icon]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl font-bold text-xs transition-colors ${tab === key ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-600"}`}
          >
            <Icon size={15} />{label}
          </button>
        ))}
      </div>

      {/* More — section picker */}
      {tab === "more" && (
        <div className="flex gap-1.5 mb-4 overflow-x-auto hide-scrollbar">
          {([
            ["mechstatus", "Mech Status", Wrench],
            ["tat", "TAT", Timer],
            ["incentives", "Incentives", IndianRupee],
            ["assembly", "Assembly", Package],
            ["audit", "Audit", ScrollText],
            ["team", "Team", Users],
          ] as const).map(([key, label, Icon]) => (
            <button
              key={key}
              onClick={() => setMoreView(key)}
              className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl font-bold text-xs transition-colors ${moreView === key ? "bg-blue-700 text-white" : "bg-gray-100 text-gray-600"}`}
            >
              <Icon size={14} />{label}
            </button>
          ))}
        </div>
      )}

      {view === "tat" ? (() => {
        /* ─── TAT Dashboard (driven by the universal date filter) ─── */
        const tatJobs = deliveredJobs;
        const tatMins = tatJobs.map((j) => (new Date(j.deliveredAt!).getTime() - new Date(j.receivedAt).getTime()) / 60000);
        const tatAvgMins = tatMins.length > 0 ? tatMins.reduce((a, b) => a + b, 0) / tatMins.length : 0;
        const tatAvgStr = fmtTat(tatAvgMins);

        // Promised vs actual
        const promisedJobs = tatJobs.filter((j) => j.promisedAt && j.deliveredAt);
        const onTime = promisedJobs.filter((j) => new Date(j.deliveredAt!) <= new Date(new Date(j.promisedAt!).getTime() + 86400000)); // delivered by end of promised day
        const overdue = promisedJobs.filter((j) => new Date(j.deliveredAt!) > new Date(new Date(j.promisedAt!).getTime() + 86400000));
        const onTimePct = promisedJobs.length > 0 ? Math.round((onTime.length / promisedJobs.length) * 100) : 0;

        return (
          <>
            {/* Summary */}
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="bg-blue-50 rounded-2xl p-4 text-center">
                <div className="text-2xl font-black text-blue-700">{tatAvgStr}</div>
                <div className="text-sm text-blue-600 font-medium">⏱️ Avg time: check-in → delivered</div>
              </div>
              <div className="bg-green-50 rounded-2xl p-4 text-center">
                <div className="text-2xl font-black text-green-700">{tatJobs.length}</div>
                <div className="text-sm text-green-600 font-medium">✅ Delivered</div>
              </div>
            </div>

            {/* Delivery commitment */}
            {promisedJobs.length > 0 && (
              <>
                <h3 className="font-bold text-gray-700 mb-2">📅 Delivery Commitment</h3>
                <div className="bg-white rounded-2xl p-4 shadow-sm mb-4">
                  <div className="grid grid-cols-3 gap-3 text-center mb-3">
                    <div>
                      <div className={`text-2xl font-black ${onTimePct >= 80 ? "text-green-700" : onTimePct >= 50 ? "text-orange-600" : "text-red-600"}`}>{onTimePct}%</div>
                      <div className="text-xs text-gray-500">On-Time</div>
                    </div>
                    <div>
                      <div className="text-2xl font-black text-green-700">{onTime.length}</div>
                      <div className="text-xs text-gray-500">On Time</div>
                    </div>
                    <div>
                      <div className="text-2xl font-black text-red-600">{overdue.length}</div>
                      <div className="text-xs text-gray-500">Overdue</div>
                    </div>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-3">
                    <div className={`h-3 rounded-full ${onTimePct >= 80 ? "bg-green-500" : onTimePct >= 50 ? "bg-orange-500" : "bg-red-500"}`}
                      style={{ width: `${onTimePct}%` }} />
                  </div>
                </div>
              </>
            )}

            {/* TAT by job type */}
            <h3 className="font-bold text-gray-700 mb-2">TAT by Job Type</h3>
            <div className="bg-white rounded-2xl p-4 shadow-sm mb-4">
              {Object.entries(JOB_TYPE).map(([key, config]) => {
                const typeJobs = tatJobs.filter((j) => j.jobType === key && j.deliveredAt);
                if (typeJobs.length === 0) return null;
                const typeTat = typeJobs.map((j) => (new Date(j.deliveredAt!).getTime() - new Date(j.receivedAt).getTime()) / 3600000);
                const avg = typeTat.reduce((a, b) => a + b, 0) / typeTat.length;
                return (
                  <div key={key} className="flex items-center gap-3 py-2 border-b border-gray-50 last:border-0">
                    <span className="text-lg">{config.emoji}</span>
                    <span className="text-sm font-medium flex-1">{config.label}</span>
                    <span className="text-sm font-bold text-gray-700">{fmtTat(avg * 60)}</span>
                    <span className="text-xs text-gray-400">({typeJobs.length})</span>
                  </div>
                );
              })}
              {tatJobs.length === 0 && <p className="text-gray-400 text-center py-4">No deliveries in this period</p>}
            </div>

            {/* TAT by mechanic */}
            <h3 className="font-bold text-gray-700 mb-2">TAT by Mechanic</h3>
            <div className="bg-white rounded-2xl p-4 shadow-sm mb-4">
              {(() => {
                const mechTat: Record<string, { name: string; emoji: string; tats: number[] }> = {};
                tatJobs.forEach((j) => {
                  if (!j.mechanic || !j.deliveredAt) return;
                  if (!mechTat[j.mechanic.name]) mechTat[j.mechanic.name] = { name: j.mechanic.name, emoji: j.mechanic.emoji, tats: [] };
                  mechTat[j.mechanic.name].tats.push((new Date(j.deliveredAt).getTime() - new Date(j.receivedAt).getTime()) / 3600000);
                });
                const entries = Object.values(mechTat).sort((a, b) => (a.tats.reduce((x, y) => x + y, 0) / a.tats.length) - (b.tats.reduce((x, y) => x + y, 0) / b.tats.length));
                if (entries.length === 0) return <p className="text-gray-400 text-center py-4">No data</p>;
                return entries.map((m) => {
                  const avg = m.tats.reduce((a, b) => a + b, 0) / m.tats.length;
                  return (
                    <div key={m.name} className="flex items-center gap-3 py-2 border-b border-gray-50 last:border-0">
                      <span className="text-xl">{m.emoji}</span>
                      <div className="flex-1">
                        <div className="font-bold text-sm">{m.name}</div>
                        <div className="text-xs text-gray-400">{m.tats.length} delivered</div>
                      </div>
                      <div className="text-right">
                        <div className="font-bold text-sm">{fmtTat(avg * 60)}</div>
                        <div className="text-xs text-gray-400">avg TAT</div>
                      </div>
                    </div>
                  );
                });
              })()}
            </div>

            {/* CSV Export */}
            <div className="bg-gray-50 rounded-2xl p-4 border border-gray-200">
              <h3 className="font-bold text-gray-700 mb-3">📥 Export Jobs (CSV)</h3>
              <div className="flex gap-2 mb-3">
                <div className="flex-1">
                  <label className="text-xs text-gray-500 mb-1 block">From</label>
                  <input type="date" value={exportFrom} onChange={(e) => setExportFrom(e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-2 py-2 text-sm focus:outline-none" />
                </div>
                <div className="flex-1">
                  <label className="text-xs text-gray-500 mb-1 block">To</label>
                  <input type="date" value={exportTo} onChange={(e) => setExportTo(e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-2 py-2 text-sm focus:outline-none" />
                </div>
              </div>
              <button
                onClick={handleExport}
                className="w-full bg-gray-800 text-white font-bold py-2.5 rounded-xl text-sm active:scale-95 transition-transform"
              >
                📥 Download CSV
              </button>
            </div>
          </>
        );
      })() : view === "audit" ? (
        /* ─── Audit Log ─── */
        <>
          <h3 className="font-bold text-gray-700 mb-3">📝 Recent Activity</h3>
          <div className="space-y-2">
            {auditLogs.length === 0 ? (
              <p className="text-gray-400 text-center py-8">No audit logs yet</p>
            ) : auditLogs.map((log) => {
              const time = formatIST(log.createdAt, { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short" });
              const actionLabel = log.action === "STATUS_CHANGE" ? `${log.fromStatus} → ${log.toStatus}`
                : log.action === "JOB_CREATE" ? "Created"
                : log.action === "JOB_DELETE" ? "Deleted"
                : log.action === "PHOTO_DELETE" ? "Photo removed"
                : log.action === "BILL_UPDATE" ? "Bill updated"
                : log.action;
              return (
                <div key={log.id} className="bg-white rounded-xl p-3 shadow-sm border border-gray-100">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold text-sm">{actionLabel}</span>
                    <span className="text-xs text-gray-400">{time}</span>
                  </div>
                  <div className="text-xs text-gray-500">
                    by {log.userName} ({log.userRole}) {log.details ? `• ${log.details}` : ""}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      ) : view === "mechstatus" ? (() => {
        // Driven by the universal date filter (same job set as the rest of the dashboard).
        const now = Date.now();
        const rangeJobs = filteredJobs;

        // Group by mechanic
        const mechMap: Record<string, { name: string; emoji: string; pending: Job[]; hold: Job[]; ready: Job[]; delivered: Job[] }> = {};
        rangeJobs.forEach((j) => {
          const key = j.mechanic ? j.mechanic.name : "Unassigned";
          if (!mechMap[key]) mechMap[key] = { name: key, emoji: j.mechanic?.emoji || "❓", pending: [], hold: [], ready: [], delivered: [] };
          if (j.status === "RECEIVED") mechMap[key].pending.push(j);
          else if (j.status === "PARTS_NEEDED") mechMap[key].hold.push(j);
          else if (j.status === "READY") mechMap[key].ready.push(j);
          else if (j.status === "DELIVERED") mechMap[key].delivered.push(j);
        });
        const mechList = Object.values(mechMap).sort((a, b) => (b.pending.length + b.hold.length) - (a.pending.length + a.hold.length));

        return (
          <>
            {/* Summary */}
            <div className="grid grid-cols-4 gap-2 mb-4">
              <div className="bg-blue-50 rounded-xl p-2 text-center">
                <div className="text-lg font-black text-blue-700">{rangeJobs.filter((j) => j.status === "RECEIVED").length}</div>
                <div className="text-xs text-blue-600">Pending</div>
              </div>
              <div className="bg-orange-50 rounded-xl p-2 text-center">
                <div className="text-lg font-black text-orange-700">{rangeJobs.filter((j) => j.status === "PARTS_NEEDED").length}</div>
                <div className="text-xs text-orange-600">Hold</div>
              </div>
              <div className="bg-green-50 rounded-xl p-2 text-center">
                <div className="text-lg font-black text-green-700">{rangeJobs.filter((j) => j.status === "READY").length}</div>
                <div className="text-xs text-green-600">Ready</div>
              </div>
              <div className="bg-gray-50 rounded-xl p-2 text-center">
                <div className="text-lg font-black text-gray-700">{rangeJobs.filter((j) => j.status === "DELIVERED").length}</div>
                <div className="text-xs text-gray-600">Done</div>
              </div>
            </div>

            {/* Per mechanic cards */}
            {mechList.length === 0 ? (
              <div className="text-center py-12"><p className="text-gray-400">No jobs in this period</p></div>
            ) : mechList.map((m) => {
              const total = m.pending.length + m.hold.length + m.ready.length + m.delivered.length;
              const isExpanded = mechFilter === m.name;
              const activeJobs = [...m.pending, ...m.hold];
              return (
                <div key={m.name} className="bg-white rounded-2xl p-4 mb-3 shadow-sm">
                  <button onClick={() => setMechFilter(isExpanded ? null : m.name)} className="w-full">
                    <div className="flex items-center gap-3 mb-2">
                      <span className="text-2xl">{m.emoji}</span>
                      <div className="flex-1 text-left">
                        <div className="font-bold text-base">{m.name}</div>
                        <div className="text-xs text-gray-500">{total} jobs · {activeJobs.length} active</div>
                      </div>
                      <span className="text-gray-400 text-sm">{isExpanded ? "▲" : "▼"}</span>
                    </div>
                    <div className="grid grid-cols-4 gap-1.5">
                      <div className="bg-blue-50 rounded-lg p-1.5 text-center">
                        <div className="text-sm font-black text-blue-700">{m.pending.length}</div>
                        <div className="text-[10px] text-blue-500">Pending</div>
                      </div>
                      <div className="bg-orange-50 rounded-lg p-1.5 text-center">
                        <div className="text-sm font-black text-orange-700">{m.hold.length}</div>
                        <div className="text-[10px] text-orange-500">Hold</div>
                      </div>
                      <div className="bg-green-50 rounded-lg p-1.5 text-center">
                        <div className="text-sm font-black text-green-700">{m.ready.length}</div>
                        <div className="text-[10px] text-green-500">Ready</div>
                      </div>
                      <div className="bg-gray-50 rounded-lg p-1.5 text-center">
                        <div className="text-sm font-black text-gray-600">{m.delivered.length}</div>
                        <div className="text-[10px] text-gray-500">Done</div>
                      </div>
                    </div>
                  </button>

                  {/* Expanded: show individual jobs */}
                  {isExpanded && activeJobs.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-gray-100 space-y-2">
                      {activeJobs.map((j) => {
                        const sc = JOB_STATUS[j.status as keyof typeof JOB_STATUS];
                        const tc = JOB_TYPE[j.jobType as keyof typeof JOB_TYPE];
                        const mins = Math.floor((now - new Date(j.receivedAt).getTime()) / 60000);
                        const age = mins < 60 ? `${mins}m` : mins < 1440 ? `${Math.floor(mins / 60)}h` : `${Math.floor(mins / 1440)}d`;
                        return (
                          <div key={j.id} className="flex items-center gap-2 text-sm">
                            <span className={`${sc?.color} text-white text-[10px] font-bold px-2 py-0.5 rounded-full`}>{sc?.label}</span>
                            <span className="font-bold">{j.tokenNumber}</span>
                            <span className="text-gray-400 text-xs">{tc?.emoji} {tc?.label}</span>
                            <span className="ml-auto text-xs text-gray-400">{age}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </>
        );
      })() : view === "team" ? (
        // The service app had its own team manager against its own users table. After the
        // merge there is one user table and one place to manage it, so this points there
        // instead of shipping a second, divergent editor.
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-center">
          <p className="text-sm font-medium text-slate-800 mb-1">Team is managed in one place</p>
          <p className="text-xs text-slate-500 mb-4">
            Workshop staff are ordinary users holding a Service role. Add people, change their
            role, or adjust what a role can do from the team screen.
          </p>
          <div className="flex items-center justify-center gap-2">
            <Link
              href="/team"
              className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800"
            >
              Open Team
            </Link>
            <Link
              href="/team/permissions"
              className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              Roles &amp; Permissions
            </Link>
          </div>
        </div>
      ) : view === "jobs" ? (
        <>
          <p className="text-gray-500 text-sm mb-3">{filteredJobs.length} jobs — full details below</p>
          <div>
            {filteredJobs
              .sort((a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime())
              .map((job) => (
                <div key={job.id}>
                  <JobCard job={job} onStatusChange={async (jobId, newStatus) => {
                    const res = await fetch("/api/services/jobs/update-status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId, newStatus }) });
                    if (!res.ok) { const err = await res.json().catch(() => ({})); alert(err.error || "Failed"); }
                    fetchData();
                  }} onRefresh={fetchData} largePhotos showUndo />
                  <button
                    onClick={() => handleDelete(job.id)}
                    disabled={deleting === job.id}
                    className="w-full -mt-1 mb-3 py-2 bg-red-50 text-red-600 font-bold rounded-b-xl text-sm active:scale-95 transition-transform disabled:opacity-50"
                  >
                    {deleting === job.id ? "Deleting..." : "🗑️ Delete Job"}
                  </button>
                </div>
              ))}
          </div>
        </>
      ) : view === "assembly" ? (
        <>
          <div className="bg-blue-50 rounded-2xl p-4 mb-4 text-center">
            <div className="text-sm text-blue-600 font-medium mb-1">Today&apos;s Assemblies</div>
            <div className="text-3xl font-black text-blue-700">{assemblies.length}</div>
          </div>

          {(() => {
            const byMech: Record<string, { name: string; emoji: string; logs: AssemblyLog[] }> = {};
            assemblies.forEach((a) => {
              if (!byMech[a.mechanic.name]) {
                byMech[a.mechanic.name] = { name: a.mechanic.name, emoji: a.mechanic.emoji, logs: [] };
              }
              byMech[a.mechanic.name].logs.push(a);
            });
            const entries = Object.values(byMech).sort((a, b) => b.logs.length - a.logs.length);

            if (entries.length === 0) {
              return (
                <div className="text-center py-12">
                  <div className="text-6xl mb-4">📦</div>
                  <p className="text-gray-400 text-lg">No assemblies logged today</p>
                </div>
              );
            }

            return entries.map((m) => {
              const a50 = m.logs.filter((l) => l.assemblyType === "A50").length;
              const a85 = m.logs.filter((l) => l.assemblyType === "A85").length;
              const full = m.logs.filter((l) => l.assemblyType === "FULL").length;
              return (
                <div key={m.name} className="bg-white rounded-2xl p-4 mb-3 shadow-sm">
                  <div className="flex items-center gap-3 mb-3">
                    <span className="text-3xl">{m.emoji}</span>
                    <div className="flex-1">
                      <div className="font-bold text-lg">{m.name}</div>
                      <div className="text-xs text-gray-500">{m.logs.length} assemblies today</div>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 mb-3">
                    <div className="bg-blue-50 rounded-xl p-2 text-center">
                      <div className="text-xl font-black text-blue-700">{a50}</div>
                      <div className="text-xs text-blue-600">50%</div>
                    </div>
                    <div className="bg-purple-50 rounded-xl p-2 text-center">
                      <div className="text-xl font-black text-purple-700">{a85}</div>
                      <div className="text-xs text-purple-600">85%</div>
                    </div>
                    <div className="bg-green-50 rounded-xl p-2 text-center">
                      <div className="text-xl font-black text-green-700">{full}</div>
                      <div className="text-xs text-green-600">Full</div>
                    </div>
                  </div>
                  <div className="space-y-1">
                    {m.logs.map((log) => {
                      const time = formatIST(log.createdAt, { hour: "2-digit", minute: "2-digit" });
                      const typeLabel = log.assemblyType === "A50" ? "50%" : log.assemblyType === "A85" ? "85%" : "Full";
                      return (
                        <div key={log.id} className="flex items-center gap-2 text-sm py-1.5 border-b border-gray-50 last:border-0">
                          {log.photos && log.photos.length > 0 && (
                            <img src={`/api/services/assembly/photo?logId=${log.id}&index=0`} alt="" className="w-10 h-10 rounded-lg object-cover flex-shrink-0" />
                          )}
                          <span className="flex-1 text-gray-700">📦 {typeLabel}</span>
                          <span className="text-xs text-gray-400">{time}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            });
          })()}
        </>
      ) : view === "overview" ? (
        <>
          {/* ── NOW: live backlog needing action (ignores the date filter) ── */}
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle size={16} className="text-red-600" />
            <h3 className="font-bold text-gray-800 text-sm">Needs action now</h3>
            <span className="text-[11px] text-gray-400 font-medium">live · all open jobs</span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {([
              ["overdue", "Overdue", nowOverdue.length, AlertTriangle, nowOverdue.length > 0 ? "bg-red-600" : "bg-gray-100"],
              ["hold", "On hold", nowHold.length, PauseCircle, nowHold.length > 0 ? "bg-amber-500" : "bg-gray-100"],
              ["ready", "Ready · waiting", nowReady.length, Clock3, nowReady.length > 0 ? "bg-blue-700" : "bg-gray-100"],
            ] as const).map(([key, label, count, Icon, bg]) => {
              const active = count > 0;
              return (
                <button key={key} onClick={() => setOpenNow(openNow === key ? null : key)}
                  className={`rounded-2xl p-3 text-left transition-colors ${bg} ${openNow === key ? "ring-2 ring-gray-900" : ""}`}>
                  <Icon size={18} className={active ? "text-white/80" : "text-gray-400"} />
                  <div className={`text-2xl font-black leading-none mt-1 ${active ? "text-white" : "text-gray-400"}`}>{count}</div>
                  <div className={`text-[11px] font-semibold mt-1 ${active ? "text-white/90" : "text-gray-400"}`}>{label}</div>
                </button>
              );
            })}
          </div>
          {/* Inline drill-down for the tapped bucket */}
          {openNow ? (
            <div className="bg-white rounded-2xl p-3 shadow-sm mt-2 mb-6 border border-gray-100">
              {nowMap[openNow].length === 0 ? (
                <p className="text-gray-400 text-sm text-center py-2">All clear — nothing here</p>
              ) : [...nowMap[openNow]]
                .sort((a, b) => new Date(a.receivedAt).getTime() - new Date(b.receivedAt).getTime())
                .map((j) => {
                  const days = Math.floor((Date.now() - new Date(j.receivedAt).getTime()) / 86400000);
                  return (
                    <div key={j.id} className="flex items-center gap-2 py-2 border-b border-gray-50 last:border-0 text-sm">
                      <span className="font-bold">{j.tokenNumber}</span>
                      <span className="text-gray-400 text-xs truncate flex-1">{j.mechanic ? `${j.mechanic.emoji} ${j.mechanic.name}` : "Unassigned"}</span>
                      <span className="text-xs text-gray-400 flex-shrink-0">{days}d old</span>
                    </div>
                  );
                })}
            </div>
          ) : <div className="mb-6" />}

          {/* ── PERIOD: throughput inside the selected date window ── */}
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp size={16} className="text-blue-700" />
            <h3 className="font-bold text-gray-800 text-sm">This period</h3>
            <span className="text-[11px] text-gray-400 font-medium">{dashScopeLabel}</span>
          </div>
          <div className="bg-white rounded-2xl p-4 shadow-sm mb-6">
            <div className="flex items-center justify-around">
              <div className="text-center">
                <div className="text-3xl font-black text-gray-800">{periodIntake}</div>
                <div className="text-xs text-gray-500 font-medium mt-0.5">Intake</div>
              </div>
              <ArrowRight size={20} className="text-gray-300" />
              <div className="text-center">
                <div className="text-3xl font-black text-blue-700">{periodDelivered}</div>
                <div className="text-xs text-gray-500 font-medium mt-0.5">Delivered</div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 mt-4 pt-4 border-t border-gray-100">
              <div className="flex items-center gap-2">
                <Timer size={20} className="text-gray-400 flex-shrink-0" />
                <div>
                  <div className="font-black text-gray-800 leading-tight">{avgTatStr}</div>
                  <div className="text-[11px] text-gray-500">avg check-in → delivered</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-xl font-black flex-shrink-0 ${onTimePct === null ? "text-gray-400" : onTimePct >= 80 ? "text-green-600" : onTimePct >= 50 ? "text-amber-600" : "text-red-600"}`}>{onTimePct === null ? "—" : `${onTimePct}%`}</span>
                <div className="text-[11px] text-gray-500 leading-tight">on-time<br />{promisedDelivered.length} with promise date</div>
              </div>
            </div>
          </div>

          {/* ── QUALITY + PEOPLE ── */}
          <div className="flex items-center gap-2 mb-2">
            <Star size={16} className="text-amber-500" />
            <h3 className="font-bold text-gray-800 text-sm">Quality &amp; team</h3>
            <span className="text-[11px] text-gray-400 font-medium">{dashScopeLabel}</span>
          </div>
          <div className="bg-white rounded-2xl p-4 shadow-sm mb-3 flex items-center gap-4">
            <div className="flex items-center gap-1">
              <Star size={22} className="fill-amber-400 text-amber-400" />
              <span className="text-2xl font-black text-gray-800">{avgGoogleRating}</span>
            </div>
            <div className="w-px self-stretch bg-gray-100" />
            <div className="text-xs text-gray-500 leading-tight">
              <span className="font-bold text-gray-700">{googleReviews.length}</span> verified Google reviews<br />
              {inAppRatings.length} in-app ratings total
            </div>
          </div>
          <div className="bg-white rounded-2xl p-4 shadow-sm">
            <div className="flex items-center gap-2 mb-1">
              <Trophy size={16} className="text-amber-500" />
              <span className="font-bold text-gray-700 text-sm">Top mechanics</span>
            </div>
            {Object.values(mechStats).sort((a, b) => b.total - a.total).slice(0, 5).map((m, i) => (
              <div key={m.name} className="flex items-center gap-3 py-2.5 border-b border-gray-50 last:border-0">
                <span className="text-sm font-bold text-gray-400 w-5">{i + 1}</span>
                <span className="text-xl">{m.emoji}</span>
                <div className="flex-1">
                  <div className="font-bold text-sm">{m.name}</div>
                  <div className="text-[11px] text-gray-500">{m.delivered} delivered</div>
                </div>
                <div className="text-lg font-black text-blue-700">{m.total}</div>
              </div>
            ))}
            {Object.keys(mechStats).length === 0 && (
              <p className="text-gray-400 text-center py-3 text-sm">No data for this period</p>
            )}
          </div>
        </>
      ) : (
        <>
          {/* Incentives tab */}
          <div className="bg-green-50 rounded-2xl p-4 mb-4 text-center">
            <div className="text-sm text-green-600 font-medium mb-1">Today&apos;s Payout</div>
            <div className="text-3xl font-black text-green-700">₹{totalTodayIncentive}</div>
            <div className="text-xs text-green-500 mt-1">₹100 per 10 paid jobs with Google review</div>
          </div>

          {incentives
            .sort((a, b) => b.todayDelivered - a.todayDelivered)
            .map((m) => (
              <div key={m.id} className="bg-white rounded-2xl p-4 mb-3 shadow-sm">
                <div className="flex items-center gap-3 mb-3">
                  <span className="text-3xl">{m.emoji}</span>
                  <div className="flex-1">
                    <div className="font-bold text-lg">{m.name}</div>
                    <div className="text-xs text-gray-500">{m.todayDelivered} delivered today</div>
                  </div>
                  <div className="text-right">
                    <div className="text-xl font-black text-green-600">₹{m.todayIncentive}</div>
                    <div className="text-xs text-gray-400">today</div>
                  </div>
                </div>

                {/* Progress to next ₹100 */}
                <div className="mb-2">
                  <div className="flex justify-between text-xs text-gray-500 mb-1">
                    <span>Next ₹100</span>
                    <span>{m.todayProgress}/10 jobs</span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-3">
                    <div className="h-3 rounded-full bg-green-500 transition-all" style={{ width: `${(m.todayProgress / 10) * 100}%` }} />
                  </div>
                </div>

                {/* Monthly */}
                <div className="flex justify-between text-sm text-gray-500 pt-2 border-t">
                  <span>📅 This month: {m.monthDelivered} jobs</span>
                  <span className="font-bold text-green-600">₹{m.monthIncentive}</span>
                </div>
              </div>
            ))}
        </>
      )}
    </div>
  );
}
