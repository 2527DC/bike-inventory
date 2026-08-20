"use client";

import { useEffect, useState, useCallback } from "react";
import JobCard from "@/components/services/JobCard";

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
  workDone: string | null;
  estimatedHrs: number;
  amount: number | null;
  isEcycle: boolean;
  priority: number;
  receivedAt: string;
  deliveredAt: string | null;
  photos?: string[];
  customer: { name: string; phone: string };
  mechanic: { name: string; emoji: string } | null;
};

export default function HistoryPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [dateRange, setDateRange] = useState<"today" | "yesterday" | "3days" | "month" | "custom" | "all">("today");
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
    if (dateRange === "month") {
      const y = new Date(todayIST); y.setDate(y.getDate() - 29);
      return `&from=${fmt(y)}&to=${fmt(todayIST)}`;
    }
    if (dateRange === "custom" && customFrom) {
      return `&from=${customFrom}${customTo ? `&to=${customTo}` : ""}`;
    }
    return "";
  }, [dateRange, customFrom, customTo]);

  const fetchJobs = useCallback(async () => {
    const dateParams = getDateParams();
    const res = await fetch(`/api/services/jobs?includeDelivered=true${dateParams}`);
    if (res.ok) setJobs((await res.json()).jobs);
    setLoading(false);
  }, [getDateParams]);

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  const delivered = jobs.filter((j) => j.status === "DELIVERED");

  const filtered = search.trim()
    ? delivered.filter(
        (j) =>
          j.tokenNumber.toLowerCase().includes(search.toLowerCase()) ||
          j.customer.name.toLowerCase().includes(search.toLowerCase()) ||
          j.customer.phone.includes(search) ||
          j.bikeType.toLowerCase().includes(search.toLowerCase())
      )
    : delivered;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-4xl animate-bounce">📚</div>
      </div>
    );
  }

  return (
    <div className="py-4 pb-24">
      <div className="px-4 mb-4">
        <h2 className="text-2xl font-bold mb-3">📚 Job History</h2>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="🔍 Search token, name, phone, bike..."
          className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 text-lg focus:border-gray-800 focus:outline-none"
        />
      </div>

      {/* Date filter */}
      <div className="px-4 mb-3">
        <div className="flex gap-1.5 overflow-x-auto hide-scrollbar">
          {([
            ["today", "Today"],
            ["yesterday", "Yesterday"],
            ["3days", "3 Days"],
            ["month", "1 Month"],
            ["custom", "Custom"],
            ["all", "All"],
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

      <div className="px-4 py-2">
        <span className="text-gray-500 font-medium">
          {filtered.length} delivered job{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      <div className="px-4">
        {filtered.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-6xl mb-4">📭</div>
            <p className="text-gray-400 text-lg">
              {search ? "No matching jobs" : "No delivered jobs in this period"}
            </p>
          </div>
        ) : (
          filtered.map((job) => (
            <JobCard key={job.id} job={job} showActions={false} largePhotos />
          ))
        )}
      </div>
    </div>
  );
}
