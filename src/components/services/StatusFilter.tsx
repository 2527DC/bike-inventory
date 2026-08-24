"use client";

import { JOB_STATUS } from "@/lib/services/constants";

export default function StatusFilter({
  selected,
  onChange,
  counts,
  hideEmpty = false,
}: {
  selected: string | null;
  onChange: (status: string | null) => void;
  counts: Record<string, number>;
  hideEmpty?: boolean;
}) {
  const statuses = Object.entries(JOB_STATUS)
    .map(([key, val]) => ({ key, emoji: val.emoji, label: val.label }))
    .filter((s) => !hideEmpty || (counts[s.key] || 0) > 0 || selected === s.key);

  const overdueCount = counts["OVERDUE"] || 0;

  return (
    <div className="flex gap-2 overflow-x-auto hide-scrollbar pb-2 px-4">
      {statuses.map((s) => {
        const count = s.key ? (counts[s.key] || 0) : Object.values(counts).reduce((a, b) => a + b, 0);
        const active = selected === s.key;
        return (
          <button
            key={s.key || "all"}
            onClick={() => onChange(s.key)}
            className={`tap-target flex-shrink-0 flex items-center gap-1 px-4 py-2 rounded-full font-semibold text-sm transition-all ${
              active
                ? "bg-gray-800 text-white"
                : "bg-white text-gray-600 border border-gray-200"
            }`}
          >
            <span className="text-lg">{s.emoji}</span>
            <span>{s.label}</span>
            <span className={`ml-1 px-1.5 py-0.5 rounded-full text-xs ${active ? "bg-gray-600" : "bg-gray-100"}`}>
              {count}
            </span>
          </button>
        );
      })}
      {overdueCount > 0 && (
        <button
          onClick={() => onChange("OVERDUE")}
          className={`tap-target flex-shrink-0 flex items-center gap-1 px-4 py-2 rounded-full font-semibold text-sm transition-all ${
            selected === "OVERDUE"
              ? "bg-red-600 text-white"
              : "bg-red-50 text-red-600 border border-red-200"
          }`}
        >
          <span className="text-lg">🚨</span>
          <span>Overdue</span>
          <span className={`ml-1 px-1.5 py-0.5 rounded-full text-xs ${selected === "OVERDUE" ? "bg-red-500" : "bg-red-100"}`}>
            {overdueCount}
          </span>
        </button>
      )}
    </div>
  );
}
