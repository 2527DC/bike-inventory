"use client";

import { useEffect, useState, useCallback } from "react";

type Job = {
  id: string;
  tokenNumber: string;
  status: string;
  jobType: string;
  bikeType: string;
  complaint: string | null;
  estimatedHrs: number;
  receivedAt: string;
  customer: { name: string; phone: string };
  mechanic: { name: string; emoji: string } | null;
};

type Mechanic = {
  id: string;
  name: string;
  emoji: string;
  _count: { assignedJobs: number };
};

export default function AssignPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [mechanics, setMechanics] = useState<Mechanic[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedMechanic, setSelectedMechanic] = useState<string | null>(null);
  const [assigning, setAssigning] = useState(false);

  const fetchData = useCallback(async () => {
    const [jobsRes, mechRes] = await Promise.all([
      fetch("/api/services/jobs?includeDelivered=false"),
      fetch("/api/services/mechanics"),
    ]);
    if (jobsRes.ok) setJobs((await jobsRes.json()).jobs);
    if (mechRes.ok) setMechanics((await mechRes.json()).mechanics);
    setLoading(false);
  }, []);

  // Loads once on mount. The auto-refresh interval was removed along with the
  // scheduled jobs — use the refresh control instead.
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const unassignedJobs = jobs.filter((j) => !j.mechanic && j.status !== "DELIVERED");

  const handleAssign = async (jobId: string, mechanicId: string) => {
    setAssigning(true);
    await fetch("/api/services/jobs/assign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId, mechanicId }),
    });
    setAssigning(false);
    fetchData();
  };

  // Mechanic workload
  const mechWorkload = mechanics.map((m) => {
    const mechJobs = jobs.filter(
      (j) => j.mechanic?.name === m.name && j.status !== "DELIVERED"
    );
    const totalHrs = mechJobs.reduce((sum, j) => sum + j.estimatedHrs, 0);
    return { ...m, activeJobs: mechJobs.length, totalHrs };
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-4xl animate-bounce">👥</div>
      </div>
    );
  }

  return (
    <div className="p-4 pb-24">
      <h2 className="text-2xl font-bold mb-2">👥 Assign Jobs</h2>
      <p className="text-gray-500 mb-4">
        {unassignedJobs.length} unassigned job{unassignedJobs.length !== 1 ? "s" : ""}
      </p>

      {/* Mechanic selector */}
      <div className="mb-6">
        <h3 className="font-bold text-gray-700 mb-2">Select Mechanic</h3>
        <div className="grid grid-cols-3 gap-2">
          {mechWorkload.map((m) => (
            <button
              key={m.id}
              onClick={() =>
                setSelectedMechanic(selectedMechanic === m.id ? null : m.id)
              }
              className={`tap-target rounded-2xl p-3 flex flex-col items-center gap-1 active:scale-95 transition-transform border-2 ${
                selectedMechanic === m.id
                  ? "border-gray-800 bg-gray-50"
                  : "border-gray-100 bg-white"
              }`}
            >
              <span className="text-3xl">{m.emoji}</span>
              <span className="font-bold text-sm">{m.name}</span>
              <span className="text-xs text-gray-500">
                {m.activeJobs} jobs
              </span>
              <span
                className={`text-xs font-bold ${
                  m.totalHrs > 6
                    ? "text-red-500"
                    : m.totalHrs > 4
                    ? "text-orange-500"
                    : "text-green-500"
                }`}
              >
                {m.totalHrs.toFixed(1)}h / 8h
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Unassigned jobs */}
      {unassignedJobs.length === 0 ? (
        <div className="text-center py-12">
          <div className="text-6xl mb-4">✅</div>
          <p className="text-gray-400 text-lg">All jobs assigned!</p>
        </div>
      ) : (
        <div>
          <h3 className="font-bold text-gray-700 mb-2">Unassigned Jobs</h3>
          {unassignedJobs.map((job) => {
            const timeSince = Math.floor(
              (Date.now() - new Date(job.receivedAt).getTime()) / 60000
            );
            const timeStr =
              timeSince < 60
                ? `${timeSince}m`
                : `${Math.floor(timeSince / 60)}h ${timeSince % 60}m`;

            return (
              <div
                key={job.id}
                className="bg-white rounded-2xl p-4 mb-3 shadow-sm border border-gray-100"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="font-bold text-lg">{job.tokenNumber}</span>
                  <span className="text-gray-400 text-sm">🕐 {timeStr}</span>
                </div>
                <div className="text-gray-700 mb-1">🚲 {job.bikeType}</div>
                <div className="text-gray-500 text-sm mb-1">
                  👤 {job.customer.name}
                </div>
                {job.complaint && (
                  <div className="text-gray-400 text-sm mb-2">
                    💬 {job.complaint}
                  </div>
                )}
                <div className="text-sm text-gray-500 mb-3">
                  ⏱️ Est. {job.estimatedHrs}h
                </div>

                {selectedMechanic ? (
                  <button
                    onClick={() => handleAssign(job.id, selectedMechanic)}
                    disabled={assigning}
                    className="w-full bg-gray-800 text-white font-bold py-3 rounded-xl active:scale-95 transition-transform disabled:bg-gray-300"
                  >
                    {assigning
                      ? "Assigning..."
                      : `Assign to ${
                          mechanics.find((m) => m.id === selectedMechanic)
                            ?.emoji
                        } ${
                          mechanics.find((m) => m.id === selectedMechanic)
                            ?.name
                        }`}
                  </button>
                ) : (
                  <div className="w-full py-3 bg-yellow-50 text-yellow-700 font-medium text-center rounded-xl text-sm">
                    👆 Select a mechanic above first
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <button
        onClick={() => window.location.reload()}
        className="w-full mt-4 py-3 bg-gray-100 text-gray-600 font-bold rounded-xl"
      >
        🔄 Refresh
      </button>
    </div>
  );
}
