"use client";

import { useEffect, useState, useCallback } from "react";
import JobCard from "@/components/services/JobCard";
import StatusFilter from "@/components/services/StatusFilter";
import PartsSelector from "@/components/services/PartsSelector";
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

export default function MechanicPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [filter, setFilter] = useState<string | null>("RECEIVED");
  const [loading, setLoading] = useState(true);
  const [mechId, setMechId] = useState<string | null>(null);
  const [partsJobId, setPartsJobId] = useState<string | null>(null);
  const [partsInitialAmount, setPartsInitialAmount] = useState<number | null>(null);
  const [isHoldAction, setIsHoldAction] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<Job[] | null>(null);

  // Fetch current user once
  useEffect(() => {
    fetch("/api/auth/me").then(async (res) => {
      if (res.ok) {
        const data = await res.json();
        if (data.user) setMechId(data.user.id);
      } else {
        const err = await res.json().catch(() => ({ error: "Failed to load user" }));
        setError(err.error || `Failed to load user (${res.status})`);
      }
    }).catch((e) => setError(`Network error: ${errorMessage(e)}`));
  }, []);

  const fetchJobs = useCallback(async () => {
    if (!mechId) return;
    try {
      const res = await fetch(`/api/services/jobs?includeDelivered=false&mechanicId=${mechId}`);
      if (res.ok) {
        setJobs((await res.json()).jobs);
      } else {
        const err = await res.json().catch(() => ({ error: "Failed to load jobs" }));
        setError(err.error || `Failed to load jobs (${res.status})`);
      }
    } catch (e) {
      setError(`Network error: ${errorMessage(e)}`);
    } finally {
      setLoading(false);
    }
  }, [mechId]);

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
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Status update failed" }));
        setError(err.error || `Status update failed (${res.status})`);
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    } catch (e) {
      setError(`Network error: ${errorMessage(e)}`);
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
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Parts update failed" }));
        setError(err.error || `Parts update failed (${res.status})`);
      }
    } catch (e) {
      setError(`Network error: ${errorMessage(e)}`);
    }
    setPartsJobId(null);
    fetchJobs();
  };

  const counts: Record<string, number> = {};
  jobs.forEach((j) => {
    counts[j.status] = (counts[j.status] || 0) + 1;
  });

  // When searching, use server-side results (includes delivered)
  let filtered = search.trim().length >= 2 && searchResults
    ? searchResults
    : filter ? jobs.filter((j) => j.status === filter) : jobs;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-4xl animate-bounce">🔧</div>
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

      {/* Ready bikes not picked up — alert */}
      {(() => {
        const readyCount = jobs.filter((j) => j.status === "READY").length;
        if (readyCount === 0) return null;
        return (
          <button
            onClick={() => setFilter("READY")}
            className="mx-4 mb-3 bg-purple-600 text-white rounded-xl p-3 shadow-lg w-[calc(100%-2rem)] text-left active:scale-95 transition-transform"
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="font-black text-sm">📞 {readyCount} bike{readyCount > 1 ? "s" : ""} ready — not picked up</div>
                <div className="text-xs text-purple-200 mt-0.5">Tap to view · Inform staff to clear deliveries</div>
              </div>
              <span className="text-2xl">👉</span>
            </div>
          </button>
        );
      })()}

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

      <div className="px-4">
        {filtered.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-6xl mb-4">✨</div>
            <p className="text-gray-400 text-lg">No jobs here!</p>
          </div>
        ) : (
          filtered.map((job) => (
            <JobCard
              key={job.id}
              job={job}
              onStatusChange={handleStatusChange}
              onRefresh={fetchJobs}
              onAddParts={(id, amt) => { setPartsJobId(id); setPartsInitialAmount(amt); setIsHoldAction(false); }}
              largePhotos
              hideDeliverFlow
            />
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
