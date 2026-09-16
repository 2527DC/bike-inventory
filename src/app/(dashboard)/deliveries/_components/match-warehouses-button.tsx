"use client";

// "Match warehouses" (plan 1609 A43, A43b): links open deliveries that have no warehouse to a
// FLOOR warehouse by invoice prefix. Re-runnable; the route never overwrites a set warehouse.
// Visibility is cosmetic — the route re-checks deliveries.edit.

import { useState } from "react";
import { Loader2, Warehouse } from "lucide-react";
import { apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";

const log = createLogger("deliveries:match-warehouses");

interface MatchResult {
  checked: number;
  matched: number;
  stillDummy: number;
}

export function MatchWarehousesButton({ onMatched }: { onMatched: () => void }) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<MatchResult | null>(null);
  const [error, setError] = useState("");

  const run = async () => {
    setRunning(true);
    setError("");
    setResult(null);
    const res = await apiTry<MatchResult>("/api/deliveries/match-warehouses", { method: "POST" });
    setRunning(false);
    if (res.error || !res.data) {
      log.warn("match warehouses failed", { status: res.status });
      setError(res.error || "Match failed");
      return;
    }
    log.info("match warehouses finished", { ...res.data });
    setResult(res.data);
    onMatched();
  };

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mb-2">
      <button
        onClick={run}
        disabled={running}
        className="flex items-center gap-1.5 px-3 py-2 min-h-[40px] rounded-lg bg-slate-100 text-slate-700 text-xs font-medium hover:bg-slate-200 disabled:opacity-50"
      >
        {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Warehouse className="h-3.5 w-3.5" />}
        {running ? "Matching..." : "Match warehouses"}
      </button>
      {result && (
        <p className="text-xs text-slate-600 tabular-nums">
          Checked {result.checked} · matched {result.matched} · still Dummy {result.stillDummy}
        </p>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
