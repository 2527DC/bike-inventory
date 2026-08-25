"use client";

import { useEffect, useState, useCallback } from "react";
import JobCard from "@/components/services/JobCard";
import StatusFilter from "@/components/services/StatusFilter";
import PartsSelector from "@/components/services/PartsSelector";
import { getWhatsAppUrl } from "@/lib/services/whatsapp";
import { errorMessage } from "@/lib/utils";

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

export default function SupervisorPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [mechanics, setMechanics] = useState<Mechanic[]>([]);
  const [filter, setFilter] = useState<string | null>("RECEIVED");
  const [assigningJob, setAssigningJob] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [partsJobId, setPartsJobId] = useState<string | null>(null);
  const [partsInitialAmount, setPartsInitialAmount] = useState<number | null>(null);
  const [isHoldAction, setIsHoldAction] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<Job[] | null>(null);
  const [bulkMode, setBulkMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  const [dateRange, setDateRange] = useState<"all" | "today" | "yesterday" | "3days" | "custom">("all");
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
      return `&from=${fmt(y)}&to=${fmt(y)}`;
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

  // Fetch ALL jobs (no search param — search is client-side for consistent counts)
  const fetchData = useCallback(async () => {
    try {
      const dateParams = getDateParams();
      const [jobsRes, mechRes] = await Promise.all([
        fetch(`/api/services/jobs?includeDelivered=false${dateParams}`),
        fetch("/api/services/mechanics"),
      ]);
      if (jobsRes.ok) setJobs((await jobsRes.json()).jobs);
      else {
        const err = await jobsRes.json().catch(() => ({ error: "Failed to load jobs" }));
        setError(err.error || `Failed to load jobs (${jobsRes.status})`);
      }
      if (mechRes.ok) setMechanics((await mechRes.json()).mechanics);
      else {
        const err = await mechRes.json().catch(() => ({ error: "Failed to load mechanics" }));
        setError(err.error || `Failed to load mechanics (${mechRes.status})`);
      }
    } catch (e) {
      setError(`Network error: ${errorMessage(e)}`);
    }
    setLoading(false);
  }, [getDateParams]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 60000);
    return () => clearInterval(interval);
  }, [fetchData]);

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
    } catch (e) {
      setError(`Network error: ${errorMessage(e)}`);
    }
    setAssigningJob(null);
    fetchData();
  };

  const logNotification = async (job: { id: string; tokenNumber: string; customer: { name: string; phone: string } }, messageType: string) => {
    try {
      await fetch("/api/services/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId: job.id,
          tokenNumber: job.tokenNumber,
          customerPhone: job.customer.phone,
          customerName: job.customer.name,
          messageType,
        }),
      });
    } catch { /* non-critical */ }
  };

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
        if (waUrl) {
          window.open(waUrl, "_blank");
          logNotification(data.job, newStatus);
        }
      } else {
        const err = await res.json().catch(() => ({ error: "Status update failed" }));
        setError(err.error || `Status update failed (${res.status})`);
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    } catch (e) {
      setError(`Network error: ${errorMessage(e)}`);
    }
    fetchData();
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
          if (waUrl) {
            window.open(waUrl, "_blank");
            logNotification(data.job, "PARTS_NEEDED");
          }
        }
      } else {
        const err = await res.json().catch(() => ({ error: "Parts update failed" }));
        setError(err.error || `Parts update failed (${res.status})`);
      }
    } catch (e) {
      setError(`Network error: ${errorMessage(e)}`);
    }
    setPartsJobId(null);
    fetchData();
  };

  const handleBulkUpdate = async (newStatus: string) => {
    if (selected.size === 0) return;
    setBulkLoading(true);
    try {
      const res = await fetch("/api/services/jobs/bulk-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobIds: Array.from(selected), newStatus }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.skipped > 0) {
          setError(`Updated ${data.updated}, skipped ${data.skipped}: ${data.invalidTokens.join(", ")}`);
        }
      } else {
        const err = await res.json().catch(() => ({ error: "Bulk update failed" }));
        setError(err.error || `Bulk update failed (${res.status})`);
      }
    } catch (e) {
      setError(`Network error: ${errorMessage(e)}`);
    }
    setSelected(new Set());
    setBulkMode(false);
    setBulkLoading(false);
    fetchData();
  };

  const toggleSelect = (jobId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(jobId)) next.delete(jobId);
      else next.add(jobId);
      return next;
    });
  };

  const selectAll = () => {
    setSelected(new Set(filtered.map((j) => j.id)));
  };

  const counts: Record<string, number> = {};
  jobs.forEach((j) => { counts[j.status] = (counts[j.status] || 0) + 1; });

  // Compute overdue count
  const now = new Date();
  const todayStart = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  todayStart.setHours(0, 0, 0, 0);
  const overdueJobs = jobs.filter((j) => j.promisedAt && j.status !== "DELIVERED" && new Date(j.promisedAt) < todayStart);
  counts["OVERDUE"] = overdueJobs.length;

  // When searching, use server-side results (includes delivered)
  const filtered = search.trim().length >= 2 && searchResults
    ? searchResults
    : filter === "OVERDUE" ? overdueJobs
    : filter ? jobs.filter((j) => j.status === filter) : jobs;

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="text-4xl animate-bounce">📋</div></div>;
  }

  return (
    <div className="py-4 pb-24">
      {error && (
        <div className="mx-4 mb-3 bg-red-600 rounded-xl p-3 flex items-start gap-2 shadow-lg">
          <span className="text-white text-sm font-bold flex-1">⚠️ {error}</span>
          <button onClick={() => setError(null)} className="text-white/70 font-bold text-sm">✕</button>
        </div>
      )}

      {/* Search bar */}
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

      <StatusFilter selected={filter} onChange={setFilter} counts={counts} hideEmpty />

      <div className="px-4 py-2 flex items-center justify-between">
        <span className="text-gray-500 font-medium">{filtered.length} jobs</span>
        <div className="flex gap-2">
          <button
            onClick={() => { setBulkMode(!bulkMode); setSelected(new Set()); }}
            className={`tap-target font-semibold text-sm px-3 py-1 rounded-lg ${bulkMode ? "bg-blue-100 text-blue-700" : "text-gray-600"}`}
          >
            ☑️ Bulk
          </button>
          <button onClick={() => window.location.reload()} className="tap-target text-gray-700 font-semibold text-sm">🔄 Refresh</button>
        </div>
      </div>

      {/* Bulk action bar */}
      {bulkMode && (
        <div className="px-4 mb-3">
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-bold text-blue-700">{selected.size} selected</span>
              <button onClick={selectAll} className="text-xs font-bold text-blue-600">Select All</button>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => handleBulkUpdate("READY")}
                disabled={selected.size === 0 || bulkLoading}
                className="flex-1 bg-green-500 text-white font-bold py-2 rounded-xl text-sm disabled:bg-gray-300 active:scale-95 transition-transform"
              >
                {bulkLoading ? "..." : "✅ Mark Ready"}
              </button>
              <button
                onClick={() => handleBulkUpdate("PARTS_NEEDED")}
                disabled={selected.size === 0 || bulkLoading}
                className="flex-1 bg-orange-500 text-white font-bold py-2 rounded-xl text-sm disabled:bg-gray-300 active:scale-95 transition-transform"
              >
                {bulkLoading ? "..." : "⏸️ Hold"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Assign overlay */}
      {assigningJob && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end">
          <div className="bg-white rounded-t-3xl w-full p-6 max-h-[60vh] overflow-y-auto">
            <h3 className="text-xl font-bold mb-4">👥 Assign to mechanic</h3>
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

      {/* Jobs */}
      <div className="px-4">
        {filtered.map((job) => (
          <div key={job.id}>
            {bulkMode && (
              <label className="flex items-center gap-3 mb-1 px-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selected.has(job.id)}
                  onChange={() => toggleSelect(job.id)}
                  className="w-5 h-5 rounded accent-blue-600"
                />
                <span className="text-sm font-medium text-gray-600">{job.tokenNumber}</span>
              </label>
            )}
            <JobCard job={job} onStatusChange={handleStatusChange} onRefresh={fetchData} onAddParts={(id, amt) => { setPartsJobId(id); setPartsInitialAmount(amt); setIsHoldAction(false); }} largePhotos showUndo readyBikeCount={counts["READY"] || 0} />
            {!job.mechanic && (
              <button
                onClick={() => setAssigningJob(job.id)}
                className="w-full -mt-1 mb-3 py-2 bg-yellow-100 text-yellow-700 font-bold rounded-b-xl text-sm"
              >
                👆 Tap to assign mechanic
              </button>
            )}
          </div>
        ))}
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
