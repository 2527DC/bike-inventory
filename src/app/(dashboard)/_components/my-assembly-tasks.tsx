"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Wrench, Play, Pause, AlertTriangle, ArrowRight, Bike } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface AssemblyTaskRow {
  id: string;
  level: "A50" | "A85" | "FULL";
  status: "PENDING" | "IN_PROGRESS" | "ON_HOLD" | "COMPLETED";
  startedAt?: string | null;
  holdStartedAt?: string | null;
  totalHoldSeconds: number;
  unit: {
    id: string;
    unitCode: string;
    product: {
      name: string;
      brand: { name: string };
      category: { name: string };
    };
    bin?: { code: string; name: string } | null;
  };
  warehouse: { name: string; code: string };
}

export function MyAssemblyTasks() {
  const [tasks, setTasks] = useState<AssemblyTaskRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadTasks() {
      try {
        const res = await fetch("/api/assembly/tasks?mine=1");
        const json = await res.json();
        if (!cancelled && json.success) {
          const list = json.data?.tasks || [];
          setTasks(list);
        }
      } catch (err) {
        console.error("Failed to load user assembly tasks", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadTasks();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return null;

  const activeTask = tasks.find(
    (t) => t.status === "IN_PROGRESS" || t.status === "ON_HOLD"
  );
  const pendingTasks = tasks.filter((t) => t.status === "PENDING");

  // If no active build and no pending tasks, render nothing (0px footprint)
  if (!activeTask && pendingTasks.length === 0) {
    return null;
  }

  return (
    <Card className="mb-4 border border-indigo-100 bg-gradient-to-r from-indigo-50/70 to-blue-50/50 shadow-xs">
      <CardContent className="p-3.5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-2.5 min-w-0">
            <div className="p-2 rounded-lg bg-indigo-600 text-white shrink-0 shadow-xs">
              <Bike className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-semibold text-indigo-950 uppercase tracking-wider">
                  Assigned Assembly
                </span>
                {activeTask && (
                  <Badge
                    variant={activeTask.status === "IN_PROGRESS" ? "success" : "warning"}
                    className="text-[10px] px-1.5 py-0"
                  >
                    {activeTask.status === "IN_PROGRESS" ? (
                      <span className="flex items-center gap-1">
                        <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
                        In Progress
                      </span>
                    ) : (
                      <span className="flex items-center gap-1">
                        <Pause className="h-2.5 w-2.5" /> On Hold
                      </span>
                    )}
                  </Badge>
                )}
                {pendingTasks.length > 0 && (
                  <span className="text-[11px] text-slate-500 font-medium">
                    {pendingTasks.length} {pendingTasks.length === 1 ? "build" : "builds"} queued
                  </span>
                )}
              </div>

              {activeTask ? (
                <div className="mt-1">
                  <p className="text-sm font-bold text-slate-900 truncate">
                    {activeTask.unit.product.name}
                  </p>
                  <div className="flex items-center gap-2 text-[11px] text-slate-600 flex-wrap mt-0.5">
                    <span className="font-mono font-semibold bg-white/80 px-1 rounded border border-indigo-100 text-indigo-700">
                      {activeTask.unit.unitCode}
                    </span>
                    <span>Level: <strong>{activeTask.level}</strong></span>
                    {activeTask.unit.bin && (
                      <span>Bin: {activeTask.unit.bin.code}</span>
                    )}
                  </div>
                </div>
              ) : (
                <p className="text-xs text-slate-700 mt-0.5">
                  You have {pendingTasks.length} bicycle {pendingTasks.length === 1 ? "build" : "builds"} assigned and ready to assemble.
                </p>
              )}
            </div>
          </div>

          <Link
            href="/assembly"
            className="inline-flex items-center justify-center gap-1.5 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white px-3.5 py-2 rounded-lg shadow-xs transition-colors shrink-0"
          >
            <Wrench className="h-3.5 w-3.5" />
            {activeTask ? "Continue Assembly" : "Open Build Queue"}
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
