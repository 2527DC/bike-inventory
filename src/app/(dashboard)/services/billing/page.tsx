"use client";

import { useEffect, useState, useCallback } from "react";
import { JOB_TYPE } from "@/lib/services/constants";

type Job = {
  id: string;
  tokenNumber: string;
  status: string;
  jobType: string;
  bikeType: string;
  complaint: string | null;
  partsNeeded: string | null;
  workDone: string | null;
  amount: number | null;
  isEcycle: boolean;
  receivedAt: string;
  zohoInvoiceId: string | null;
  customer: { name: string; phone: string };
  mechanic: { name: string; emoji: string } | null;
};

export default function BillingPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [billingJobId, setBillingJobId] = useState<string | null>(null);
  const [invoiceNum, setInvoiceNum] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const fetchJobs = useCallback(async () => {
    try {
      const res = await fetch("/api/services/jobs?includeDelivered=false");
      if (res.ok) {
        const data = await res.json();
        setJobs(data.jobs.filter((j: Job) => j.status === "READY"));
      } else {
        const err = await res.json().catch(() => ({ error: "Failed to load jobs" }));
        setError(err.error || `Failed to load jobs (${res.status})`);
      }
    } catch (e: any) {
      setError(`Network error: ${e.message}`);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchJobs();
    const interval = setInterval(fetchJobs, 60000);
    return () => clearInterval(interval);
  }, [fetchJobs]);

  const handleMarkBilled = async () => {
    if (!billingJobId || !invoiceNum.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/services/jobs/bill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: billingJobId, zohoInvoiceId: invoiceNum.trim() }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Billing failed" }));
        setError(err.error || `Billing failed (${res.status})`);
      }
    } catch (e: any) {
      setError(`Network error: ${e.message}`);
    }
    setSaving(false);
    setBillingJobId(null);
    setInvoiceNum("");
    fetchJobs();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-4xl animate-bounce">🧾</div>
      </div>
    );
  }

  // Client-side search
  const searchedJobs = search.trim()
    ? jobs.filter((j) => {
        const q = search.toLowerCase();
        return j.tokenNumber.toLowerCase().includes(q) ||
          j.customer.name.toLowerCase().includes(q) ||
          j.customer.phone.includes(q);
      })
    : jobs;

  const unbilled = searchedJobs.filter((j) => !j.zohoInvoiceId);
  const billed = searchedJobs.filter((j) => j.zohoInvoiceId);

  return (
    <div className="p-4 pb-24">
      {error && (
        <div className="mb-3 bg-red-600 rounded-xl p-3 flex items-start gap-2 shadow-lg">
          <span className="text-white text-sm font-bold flex-1">⚠️ {error}</span>
          <button onClick={() => setError(null)} className="text-white/70 font-bold text-sm">✕</button>
        </div>
      )}
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-xl font-bold">🧾 Ready for Billing</h2>
          <p className="text-gray-500 text-sm">
            {unbilled.length} to bill · {billed.length} billed
          </p>
        </div>
        <button onClick={() => window.location.reload()} className="tap-target text-gray-700 font-semibold text-sm">
          🔄 Refresh
        </button>
      </div>

      {/* Search */}
      <div className="mb-4">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="🔍 Search token, name, or phone..."
          className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:border-gray-800 focus:outline-none"
        />
      </div>

      {jobs.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-6xl mb-4">✨</div>
          <p className="text-gray-400 text-lg">No bikes ready for billing</p>
          <p className="text-gray-300 text-sm mt-1">Waiting for mechanics to finish</p>
        </div>
      ) : (
        <>
          {/* Unbilled jobs */}
          {unbilled.length > 0 && (
            <div className="mb-6">
              <h3 className="font-bold text-orange-600 mb-2">⏳ Needs Billing ({unbilled.length})</h3>
              <div className="space-y-3">
                {unbilled.map((job) => (
                  <BillingCard key={job.id} job={job} onBill={() => { setBillingJobId(job.id); setInvoiceNum(""); }} />
                ))}
              </div>
            </div>
          )}

          {/* Billed jobs */}
          {billed.length > 0 && (
            <div>
              <h3 className="font-bold text-green-600 mb-2">✅ Billed ({billed.length})</h3>
              <div className="space-y-3">
                {billed.map((job) => (
                  <BillingCard key={job.id} job={job} billed />
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Bill entry overlay */}
      {billingJobId && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end">
          <div className="bg-white rounded-t-3xl w-full p-6">
            <h3 className="text-xl font-bold mb-1">🧾 Enter Zoho Bill Number</h3>
            <p className="text-gray-500 text-sm mb-4">
              {jobs.find((j) => j.id === billingJobId)?.tokenNumber} — {jobs.find((j) => j.id === billingJobId)?.customer.name}
            </p>
            <input
              type="text"
              value={invoiceNum}
              onChange={(e) => setInvoiceNum(e.target.value)}
              placeholder="e.g. INV/25/017869"
              autoFocus
              className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 text-lg font-medium focus:border-gray-800 focus:outline-none mb-4"
              onKeyDown={(e) => e.key === "Enter" && handleMarkBilled()}
            />
            <button
              onClick={handleMarkBilled}
              disabled={saving || !invoiceNum.trim()}
              className="w-full bg-green-500 text-white font-bold py-3 rounded-xl text-lg active:scale-95 transition-transform disabled:bg-gray-300"
            >
              {saving ? "Saving..." : "✅ Mark as Billed"}
            </button>
            <button
              onClick={() => setBillingJobId(null)}
              className="w-full mt-2 py-3 text-gray-400 font-medium"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function BillingCard({ job, onBill, billed = false }: { job: Job; onBill?: () => void; billed?: boolean }) {
  const typeConfig = JOB_TYPE[job.jobType as keyof typeof JOB_TYPE];
  const timeSince = Math.floor((Date.now() - new Date(job.receivedAt).getTime()) / 60000);
  const timeStr = timeSince < 60 ? `${timeSince}m` : `${Math.floor(timeSince / 60)}h ${timeSince % 60}m`;

  return (
    <div className={`bg-white rounded-2xl p-4 shadow-sm border-l-4 ${billed ? "border-green-500" : "border-orange-400"}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-2xl">{typeConfig?.emoji || "🔧"}</span>
          <span className="font-bold text-lg">{job.tokenNumber}</span>
          {job.isEcycle && <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full text-xs font-medium">E-Cycle</span>}
        </div>
        <span className="text-gray-400 text-sm">{timeStr}</span>
      </div>

      {/* Customer details — prominent for billing */}
      <div className="bg-gray-50 rounded-xl p-3 mb-2">
        <div className="text-base font-bold">👤 {job.customer.name}</div>
        <div className="text-gray-600 text-sm">📞 {job.customer.phone}</div>
        <div className="text-gray-500 text-sm">🚲 {job.bikeType}</div>
      </div>

      {/* Service type */}
      <div className="bg-blue-50 rounded-xl p-3 mb-2">
        <div className="text-sm font-bold text-blue-700">📋 Service: {typeConfig?.label || job.jobType}</div>
        {job.complaint && <div className="text-blue-600 text-sm mt-1">💬 {job.complaint}</div>}
      </div>

      {/* Parts consumed — key info for billing */}
      {job.partsNeeded && (
        <div className="bg-orange-50 rounded-xl p-3 mb-2">
          <div className="text-sm font-bold text-orange-700 mb-1">🔧 Parts / Services</div>
          <div className="text-orange-800 text-sm whitespace-pre-line">{job.partsNeeded}</div>
        </div>
      )}

      {job.workDone && (
        <div className="text-gray-500 text-sm mb-2">🛠️ {job.workDone}</div>
      )}

      {/* Amount — prominent payable box */}
      <div className="bg-green-50 border-2 border-green-300 rounded-xl p-3 mb-2 flex items-center justify-between">
        <div>
          <div className="text-xs font-bold text-green-600">💰 INVOICE PAYABLE</div>
          {job.mechanic && (
            <span className="text-gray-500 text-xs">{job.mechanic.emoji} {job.mechanic.name}</span>
          )}
        </div>
        <span className="text-2xl font-black text-green-800">
          {job.amount != null ? `₹${job.amount.toLocaleString("en-IN")}` : "—"}
        </span>
      </div>

      {/* Billed status or Bill button */}
      {billed ? (
        <div className="bg-green-50 rounded-xl p-3 text-center">
          <div className="text-green-700 font-bold text-sm">✅ Billed</div>
          <div className="text-green-800 font-mono text-lg">{job.zohoInvoiceId}</div>
        </div>
      ) : onBill ? (
        <button
          onClick={onBill}
          className="w-full bg-blue-500 text-white font-bold py-3 rounded-xl text-base active:scale-95 transition-transform"
        >
          🧾 Create Bill & Enter Number
        </button>
      ) : null}
    </div>
  );
}
