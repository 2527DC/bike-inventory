"use client";

import { useEffect, useState, useCallback } from "react";
import JobCard from "@/components/services/JobCard";
import StatusFilter from "@/components/services/StatusFilter";
import PartsSelector from "@/components/services/PartsSelector";
import { getWhatsAppUrl, getInwardWhatsAppUrl } from "@/lib/services/whatsapp";
import { JOB_TYPE } from "@/lib/services/constants";

const PAID_TYPES = ["RSVC", "SND", "ECYC"];

type Job = {
  id: string;
  tokenNumber: string;
  status: string;
  jobType: string;
  bikeType: string;
  complaint: string | null;
  partsNeeded: string | null;
  holdReason: string | null;
  promisedAt: string | null;
  estimatedHrs: number;
  amount: number | null;
  isEcycle: boolean;
  priority: number;
  receivedAt: string;
  photos?: string[];
  customer: { name: string; phone: string };
  mechanic: { name: string; emoji: string } | null;
};

type Mechanic = {
  id: string;
  name: string;
  emoji: string;
  _count: { assignedJobs: number };
};

export default function QueuePage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [mechanics, setMechanics] = useState<Mechanic[]>([]);
  const [filter, setFilter] = useState<string | null>("RECEIVED");
  const [loading, setLoading] = useState(true);
  const [partsJobId, setPartsJobId] = useState<string | null>(null);
  const [partsInitialAmount, setPartsInitialAmount] = useState<number | null>(null);
  const [isHoldAction, setIsHoldAction] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [assigningJob, setAssigningJob] = useState<string | null>(null);
  const [sentJobIds, setSentJobIds] = useState<Set<string>>(new Set());
  const [searchResults, setSearchResults] = useState<Job[] | null>(null);
  const [dateRange, setDateRange] = useState<"today" | "yesterday" | "3days" | "custom" | "all">("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const getDateParams = useCallback(() => {
    const todayIST = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
    const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    if (dateRange === "today") {
      const d = fmt(todayIST);
      return `&from=${d}&to=${d}`;
    }
    if (dateRange === "yesterday") {
      const y = new Date(todayIST); y.setDate(y.getDate() - 1);
      const d = fmt(y);
      return `&from=${d}&to=${d}`;
    }
    if (dateRange === "3days") {
      const y = new Date(todayIST); y.setDate(y.getDate() - 2);
      return `&from=${fmt(y)}&to=${fmt(todayIST)}`;
    }
    if (dateRange === "custom" && customFrom) {
      return `&from=${customFrom}${customTo ? `&to=${customTo}` : ""}`;
    }
    return "";
  }, [dateRange, customFrom, customTo]);

  const fetchJobs = useCallback(async () => {
    try {
      const dateParams = getDateParams();
      const [jobsRes, mechRes, notifRes] = await Promise.all([
        fetch(`/api/services/jobs?includeDelivered=false${dateParams}`),
        fetch("/api/services/mechanics"),
        fetch("/api/services/notifications?limit=500"),
      ]);
      if (jobsRes.ok) setJobs((await jobsRes.json()).jobs);
      else {
        const err = await jobsRes.json().catch(() => ({ error: "Failed to load jobs" }));
        setError(err.error || `Failed to load jobs (${jobsRes.status})`);
      }
      if (mechRes.ok) setMechanics((await mechRes.json()).mechanics);
      if (notifRes.ok) {
        const notifs = (await notifRes.json()).notifications as { jobId: string; messageType: string }[];
        setSentJobIds(new Set(notifs.filter((n) => n.messageType === "INWARD").map((n) => n.jobId)));
      }
    } catch (e: any) {
      setError(`Network error: ${e.message}`);
    }
    setLoading(false);
  }, [getDateParams]);

  useEffect(() => {
    fetchJobs();
    const interval = setInterval(fetchJobs, 60000);
    return () => clearInterval(interval);
  }, [fetchJobs]);

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

  const handleStatusChange = async (jobId: string, newStatus: string) => {
    if (newStatus === "PARTS_NEEDED") {
      const job = jobs.find((j) => j.id === jobId);
      setPartsJobId(jobId);
      setPartsInitialAmount(job?.amount ?? null);
      setIsHoldAction(true);
      return;
    }
    try {
      const res = await fetch("/api/services/jobs/update-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, newStatus }),
      });
      if (res.ok) {
        const data = await res.json();
        const waUrl = getWhatsAppUrl(data.job.customer.phone, newStatus, data.job.customer.name, data.job.tokenNumber);
        if (waUrl) window.open(waUrl, "_blank");
      } else {
        const err = await res.json().catch(() => ({ error: "Status update failed" }));
        setError(err.error || `Status update failed (${res.status})`);
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    } catch (e: any) {
      setError(`Network error: ${e.message}`);
    }
    fetchJobs();
  };

  const handlePartsConfirm = async (partsText: string, totalAmount: number, holdReason?: string) => {
    if (!partsJobId) return;
    try {
      const res = await fetch("/api/services/jobs/update-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          isHoldAction
            ? { jobId: partsJobId, newStatus: "PARTS_NEEDED", partsNeeded: partsText, amount: totalAmount, holdReason }
            : { jobId: partsJobId, billUpdateOnly: true, partsNeeded: partsText, amount: totalAmount }
        ),
      });
      if (res.ok) {
        const data = await res.json();
        if (isHoldAction) {
          const items = data.job.partsNeeded ? data.job.partsNeeded.split(", ").map((s: string) => `• ${s}`).join("\n") : null;
          const waUrl = getWhatsAppUrl(data.job.customer.phone, "PARTS_NEEDED", data.job.customer.name, data.job.tokenNumber, { amount: data.job.amount, items });
          if (waUrl) window.open(waUrl, "_blank");
        }
      } else {
        const err = await res.json().catch(() => ({ error: "Parts update failed" }));
        setError(err.error || `Parts update failed (${res.status})`);
      }
    } catch (e: any) {
      setError(`Network error: ${e.message}`);
    }
    setPartsJobId(null);
    fetchJobs();
  };

  const handleAssign = async (jobId: string, mechanicId: string) => {
    try {
      const res = await fetch("/api/services/jobs/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, mechanicId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Assign failed" }));
        setError(err.error || `Assign failed (${res.status})`);
      }
    } catch (e: any) {
      setError(`Network error: ${e.message}`);
    }
    setAssigningJob(null);
    fetchJobs();
  };

  const counts: Record<string, number> = {};
  jobs.forEach((j) => {
    counts[j.status] = (counts[j.status] || 0) + 1;
  });

  // Compute overdue
  const now = new Date();
  const todayStart = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  todayStart.setHours(0, 0, 0, 0);
  const overdueJobs = jobs.filter((j) => j.promisedAt && j.status !== "DELIVERED" && new Date(j.promisedAt) < todayStart);
  counts["OVERDUE"] = overdueJobs.length;

  // Paid service jobs just inwarded with no WhatsApp quote sent
  const pendingWA = jobs.filter((j) =>
    PAID_TYPES.includes(j.jobType) &&
    j.status === "RECEIVED" &&
    j.customer.phone !== "0000000000" &&
    !sentJobIds.has(j.id)
  );

  // When searching, use server-side results (includes delivered)
  let filtered = search.trim().length >= 2 && searchResults
    ? searchResults
    : filter === "OVERDUE" ? overdueJobs
    : filter === "WA_PENDING" ? pendingWA
    : filter ? jobs.filter((j) => j.status === filter) : jobs;

  // Group by status for queue view
  const readyJobs = filtered.filter((j) => j.status === "READY");
  const otherJobs = filtered.filter((j) => j.status !== "READY");

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-4xl animate-bounce">📋</div>
      </div>
    );
  }

  return (
    <div className="py-4 pb-24">
      {error && (
        <div className="mx-4 mb-3 bg-red-600 rounded-xl p-3 flex items-start gap-2 shadow-lg">
          <span className="text-white text-sm font-bold flex-1">⚠️ {error}</span>
          <button onClick={() => setError(null)} className="text-white/70 font-bold text-sm">✕</button>
        </div>
      )}
      <div className="px-4 mb-4">
        <h2 className="text-2xl font-bold">📋 Service Queue</h2>
        <p className="text-gray-500 text-sm">
          {jobs.length} active • {readyJobs.length} ready for pickup
        </p>
      </div>

      {/* Search */}
      <div className="px-4 mb-3">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="🔍 Search token, name, or phone..."
          className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:border-gray-800 focus:outline-none"
        />
      </div>

      {/* Date filter */}
      <div className="px-4 mb-3">
        <div className="flex gap-1.5 overflow-x-auto hide-scrollbar">
          {([
            ["all", "All"],
            ["today", "Today"],
            ["yesterday", "Yesterday"],
            ["3days", "3 Days"],
            ["custom", "Custom"],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setDateRange(key)}
              className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-bold ${dateRange === key ? "bg-gray-800 text-white" : "bg-gray-100 text-gray-600"}`}
            >
              {label}
            </button>
          ))}
        </div>
        {dateRange === "custom" && (
          <div className="flex gap-2 mt-2">
            <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)}
              className="flex-1 border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none" />
            <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)}
              className="flex-1 border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none" />
          </div>
        )}
      </div>

      {/* Pending WhatsApp alert — tap to filter */}
      {pendingWA.length > 0 && (
        <div className="px-4 mb-3">
          <button
            onClick={() => setFilter(filter === "WA_PENDING" ? null : "WA_PENDING")}
            className="w-full bg-orange-500 text-white rounded-xl p-3 shadow-lg active:scale-95 transition-transform text-left"
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="font-black text-sm">📱 {pendingWA.length} WhatsApp quote{pendingWA.length > 1 ? "s" : ""} pending</div>
                <div className="text-xs text-orange-100 mt-0.5">{filter === "WA_PENDING" ? "Tap to show all jobs" : "Tap to see which tickets"}</div>
              </div>
              <span className="text-2xl">{filter === "WA_PENDING" ? "✕" : "👉"}</span>
            </div>
          </button>
        </div>
      )}

      <StatusFilter selected={filter} onChange={setFilter} counts={counts} hideEmpty />

      <div className="px-4 py-2 flex items-center justify-between">
        <span className="text-gray-500 font-medium">
          {filtered.length} job{filtered.length !== 1 ? "s" : ""}
        </span>
        <button
          onClick={() => window.location.reload()}
          className="tap-target text-gray-700 font-semibold text-sm"
        >
          🔄 Refresh
        </button>
      </div>

      {/* Assign mechanic overlay */}
      {assigningJob && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end">
          <div className="bg-white rounded-t-3xl w-full p-6 max-h-[60vh] overflow-y-auto">
            <h3 className="text-xl font-bold mb-4">👥 Assign / Reassign mechanic</h3>
            <div className="grid grid-cols-3 gap-3">
              {mechanics.map((m) => (
                <button
                  key={m.id}
                  onClick={() => handleAssign(assigningJob, m.id)}
                  className="tap-target bg-gray-50 rounded-2xl p-4 flex flex-col items-center gap-1 active:scale-95 transition-transform"
                >
                  <span className="text-3xl">{m.emoji}</span>
                  <span className="font-bold text-sm">{m.name}</span>
                  <span className="text-xs text-gray-500">{m._count.assignedJobs} jobs</span>
                </button>
              ))}
            </div>
            <button
              onClick={() => setAssigningJob(null)}
              className="w-full mt-4 py-3 bg-gray-200 rounded-xl font-bold text-gray-600"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Ready for pickup — highlighted */}
      {!filter && readyJobs.length > 0 && (
        <div className="px-4 mb-4">
          <h3 className="font-bold text-green-700 mb-2">
            ✅ Ready for Pickup ({readyJobs.length})
          </h3>
          {readyJobs.map((job) => (
            <JobCard
              key={job.id}
              job={job}
              onStatusChange={handleStatusChange}
              onRefresh={fetchJobs}
              onAddParts={(id, amt) => { setPartsJobId(id); setPartsInitialAmount(amt); setIsHoldAction(false); }}
              largePhotos
              readyBikeCount={counts["READY"] || 0}
            />
          ))}
        </div>
      )}

      {/* Other jobs */}
      <div className="px-4">
        {!filter && readyJobs.length > 0 && otherJobs.length > 0 && (
          <h3 className="font-bold text-gray-700 mb-2">
            🔧 In Progress ({otherJobs.length})
          </h3>
        )}
        {(filter ? filtered : otherJobs).length === 0 && readyJobs.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-6xl mb-4">✨</div>
            <p className="text-gray-400 text-lg">Queue is empty!</p>
          </div>
        ) : (
          (filter ? filtered : otherJobs).map((job) => (
            <div key={job.id}>
              <JobCard
                job={job}
                onStatusChange={handleStatusChange}
                onRefresh={fetchJobs}
                onAddParts={(id, amt) => { setPartsJobId(id); setPartsInitialAmount(amt); setIsHoldAction(false); }}
                largePhotos
                readyBikeCount={counts["READY"] || 0}
              />
              {/* WhatsApp quote not sent — for paid services */}
              {PAID_TYPES.includes(job.jobType) && !sentJobIds.has(job.id) && job.customer.phone !== "0000000000" && job.status === "RECEIVED" && (
                <button
                  onClick={() => {
                    const typeLabel = JOB_TYPE[job.jobType as keyof typeof JOB_TYPE]?.label || job.jobType;
                    const items = job.partsNeeded ? job.partsNeeded.split(", ").map((s) => `• ${s}`).join("\n") : null;
                    const waUrl = getInwardWhatsAppUrl(job.customer.phone, job.customer.name, job.tokenNumber, typeLabel, job.amount, items, job.promisedAt);
                    if (waUrl) {
                      window.open(waUrl, "_blank");
                      fetch("/api/services/notifications", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ jobId: job.id, tokenNumber: job.tokenNumber, customerPhone: job.customer.phone, customerName: job.customer.name, messageType: "INWARD" }),
                      }).then(() => setSentJobIds((prev) => new Set(prev).add(job.id))).catch(() => {});
                    }
                  }}
                  className="w-full -mt-1 mb-1 py-2.5 bg-red-500 text-white font-bold rounded-b-xl text-sm animate-pulse active:scale-95 transition-transform"
                >
                  📱 WhatsApp Quote Not Sent — Tap to Send
                </button>
              )}
              {/* Reassign button for pending jobs */}
              {(job.status === "RECEIVED" || job.status === "PARTS_NEEDED") && (
                <button
                  onClick={() => setAssigningJob(job.id)}
                  className="w-full -mt-1 mb-3 py-2 bg-yellow-100 text-yellow-700 font-bold rounded-b-xl text-sm"
                >
                  {job.mechanic ? `🔄 Reassign (${job.mechanic.emoji} ${job.mechanic.name})` : "👆 Assign mechanic"}
                </button>
              )}
            </div>
          ))
        )}
      </div>

      {partsJobId && (
        <PartsSelector
          initialAmount={partsInitialAmount}
          onConfirm={handlePartsConfirm}
          onCancel={() => { setPartsJobId(null); setIsHoldAction(false); }}
          isHold={isHoldAction}
        />
      )}
    </div>
  );
}
