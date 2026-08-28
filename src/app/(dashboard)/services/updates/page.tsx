"use client";

import { useEffect, useState, useCallback } from "react";
import { JOB_STATUS, JOB_TYPE } from "@/lib/services/constants";

type Job = {
  id: string;
  tokenNumber: string;
  status: string;
  jobType: string;
  bikeType: string;
  complaint: string | null;
  partsNeeded: string | null;
  amount: number | null;
  isEcycle: boolean;
  priority: number;
  receivedAt: string;
  customer: { name: string; phone: string };
  mechanic: { name: string; emoji: string } | null;
};

export default function UpdatesPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string | null>(null);

  const fetchJobs = useCallback(async () => {
    try {
      const res = await fetch("/api/services/jobs?includeDelivered=false");
      if (res.ok) setJobs((await res.json()).jobs);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  // Loads once on mount. The auto-refresh interval was removed along with the
  // scheduled jobs — use the refresh control instead.
  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  // Filter
  let filtered = jobs;
  if (statusFilter) {
    filtered = filtered.filter((j) => j.status === statusFilter);
  }
  if (search.trim()) {
    const q = search.toLowerCase();
    filtered = filtered.filter((j) =>
      j.tokenNumber.toLowerCase().includes(q) ||
      j.customer.name.toLowerCase().includes(q) ||
      j.customer.phone.includes(q)
    );
  }

  // Counts
  const counts: Record<string, number> = {};
  jobs.forEach((j) => { counts[j.status] = (counts[j.status] || 0) + 1; });

  const timeSince = (date: string) => {
    const mins = Math.floor((Date.now() - new Date(date).getTime()) / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-4xl animate-bounce">📋</div>
      </div>
    );
  }

  return (
    <div className="py-4 pb-24">
      <div className="px-4 mb-4">
        <h2 className="text-2xl font-bold">📋 Service Updates</h2>
        <p className="text-gray-500 text-sm">{jobs.length} active jobs — view only</p>
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

      {/* Status filter pills */}
      <div className="px-4 mb-3 flex gap-2 overflow-x-auto hide-scrollbar">
        <button
          onClick={() => setStatusFilter(null)}
          className={`flex-shrink-0 px-3 py-1.5 rounded-full text-sm font-bold ${!statusFilter ? "bg-gray-800 text-white" : "bg-gray-100 text-gray-600"}`}
        >
          All ({jobs.length})
        </button>
        {Object.entries(JOB_STATUS).filter(([key]) => key !== "DELIVERED").map(([key, config]) => (
          <button
            key={key}
            onClick={() => setStatusFilter(statusFilter === key ? null : key)}
            className={`flex-shrink-0 px-3 py-1.5 rounded-full text-sm font-bold ${statusFilter === key ? `${config.color} text-white` : "bg-gray-100 text-gray-600"}`}
          >
            {config.emoji} {config.label} ({counts[key] || 0})
          </button>
        ))}
      </div>

      <div className="px-4 py-2 flex items-center justify-between">
        <span className="text-gray-500 font-medium">{filtered.length} job{filtered.length !== 1 ? "s" : ""}</span>
        <button onClick={() => window.location.reload()} className="tap-target text-gray-700 font-semibold text-sm">🔄 Refresh</button>
      </div>

      {/* Job cards — view only, no actions */}
      <div className="px-4">
        {filtered.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-6xl mb-4">✨</div>
            <p className="text-gray-400 text-lg">{search ? "No matching jobs" : "No active jobs"}</p>
          </div>
        ) : (
          filtered.map((job) => {
            const sc = JOB_STATUS[job.status as keyof typeof JOB_STATUS];
            const tc = JOB_TYPE[job.jobType as keyof typeof JOB_TYPE];
            return (
              <div
                key={job.id}
                className={`rounded-2xl p-4 mb-3 shadow-sm border-l-4 ${sc?.bgLight || "bg-white"}`}
                style={{ borderLeftColor: sc?.hex || "#9ca3af" }}
              >
                {/* Token + Status */}
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xl">{tc?.emoji || "🔧"}</span>
                    <span className="font-bold text-lg">{job.tokenNumber}</span>
                    {job.priority > 0 && <span className="text-red-500">🔴</span>}
                  </div>
                  <span className={`px-3 py-1 rounded-full text-sm font-semibold text-white ${sc?.color || "bg-gray-400"}`}>
                    {sc?.emoji} {sc?.label}
                  </span>
                </div>

                {/* Details */}
                <div className="mb-2">
                  <div className="text-base font-semibold">🚲 {job.bikeType}</div>
                  <div className="text-gray-600">👤 {job.customer.name}</div>
                  <div className="text-gray-400 text-sm">📞 {job.customer.phone !== "0000000000" ? job.customer.phone : "Walk-in"}</div>
                  {job.complaint && (
                    <div className="text-gray-500 text-sm mt-1">💬 {job.complaint}</div>
                  )}
                  {job.partsNeeded && (
                    <div className="text-orange-600 text-sm mt-1 font-medium">🔧 Parts: {job.partsNeeded}</div>
                  )}
                </div>

                {/* Amount */}
                {job.amount != null && job.amount > 0 && (
                  <div className="bg-green-50 rounded-xl px-3 py-2 mb-2 flex items-center justify-between">
                    <span className="text-sm font-bold text-green-700">💰 Amount</span>
                    <span className="text-lg font-black text-green-800">₹{job.amount.toLocaleString("en-IN")}</span>
                  </div>
                )}

                {/* Bottom: mechanic + time */}
                <div className="flex items-center justify-between text-sm text-gray-500">
                  <div className="flex items-center gap-2">
                    {job.mechanic ? (
                      <span className="bg-gray-100 px-2 py-1 rounded-full">{job.mechanic.emoji} {job.mechanic.name}</span>
                    ) : (
                      <span className="bg-red-50 text-red-500 px-2 py-1 rounded-full">❓ Unassigned</span>
                    )}
                    {job.isEcycle && <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full text-xs font-medium">E-Cycle</span>}
                  </div>
                  <span className="text-gray-400">{timeSince(job.receivedAt)}</span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
