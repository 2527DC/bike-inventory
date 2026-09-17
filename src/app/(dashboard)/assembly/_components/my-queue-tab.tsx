"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Bike, CheckCircle, CheckCircle2, Clock, MapPin, Pause, Play } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";
import { assemblyLevelLabel } from "@/lib/assembly-level";
import { HoldIssueChip, LevelChip, StarChip } from "./chips";
import { CompleteModal } from "./complete-modal";
import { HoldSheet } from "./hold-sheet";
import { buildSeconds, deliveryDayLabel, formatTimer, type AssemblyTask } from "./types";

const log = createLogger("assembly:my-queue");

interface MyQueueTabProps {
  /** My tasks, ★ first (the API orders them, R20). */
  tasks: AssemblyTask[];
  loading: boolean;
  onChanged: () => void;
  onSuccess: (message: string) => void;
}

/** My Build Queue — the mechanic's screen: the active build with Start / Hold / Finish. */
export function MyQueueTab({ tasks, loading, onChanged, onSuccess }: MyQueueTabProps) {
  const activeTask = tasks.find((t) => t.status === "IN_PROGRESS" || t.status === "ON_HOLD") ?? null;
  const pendingTasks = tasks.filter((t) => t.status === "PENDING");
  const completedTasks = tasks.filter((t) => t.status === "COMPLETED");

  const [nowMs, setNowMs] = useState(() => Date.now());
  const [showHold, setShowHold] = useState(false);
  const [showComplete, setShowComplete] = useState(false);
  const [busy, setBusy] = useState(false);

  // Tick only while the build runs. On hold the value is computed from holdStartedAt, so a
  // reload shows the frozen time rather than 00:00 (defect 1).
  const running = activeTask?.status === "IN_PROGRESS";
  // The first tick is scheduled, not called in the effect body (react-hooks/set-state-in-effect).
  useEffect(() => {
    if (!running) return;
    const tick = () => setNowMs(Date.now());
    const first = setTimeout(tick, 0);
    const interval = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(interval);
    };
  }, [running, activeTask?.id]);

  const elapsedSec = activeTask ? buildSeconds(activeTask, nowMs) : 0;

  async function handleStart(taskId: string) {
    setBusy(true);
    const { error, status } = await apiTry(`/api/assembly/tasks/${taskId}/start`, { method: "POST" });
    setBusy(false);
    if (error) {
      log.error("start failed", { taskId, status });
      alert(error);
      return;
    }
    onChanged();
  }

  async function handleResume() {
    if (!activeTask) return;
    setBusy(true);
    const { error, status } = await apiTry(`/api/assembly/tasks/${activeTask.id}/hold`, {
      method: "POST",
      json: { action: "RESUME" },
    });
    setBusy(false);
    if (error) {
      log.error("resume failed", { taskId: activeTask.id, status });
      alert(error);
      return;
    }
    onChanged();
  }

  return (
    <div role="tabpanel" className="mx-auto max-w-2xl space-y-4">
      {activeTask ? (
        <Card className="overflow-hidden border-2 border-indigo-600 bg-gradient-to-b from-white to-slate-50 shadow-md">
          <div className="flex items-center justify-between gap-2 bg-indigo-600 px-4 py-2.5 text-xs font-bold text-white">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 animate-ping rounded-full bg-emerald-400" />
              <span>CURRENT ACTIVE BUILD</span>
            </div>
            <span className="rounded bg-indigo-700/60 px-2 py-0.5 font-mono text-[11px]">
              Condition: {assemblyLevelLabel(activeTask.level)}
            </span>
          </div>

          <CardContent className="space-y-4 p-4 sm:p-5">
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xl font-black text-indigo-600 sm:text-2xl">{activeTask.unit.unitCode}</span>
                  <StarChip reservedFor={activeTask.unit.reservedFor} />
                </div>
                <h2 className="mt-0.5 text-base font-bold text-slate-900">{activeTask.unit.product.name}</h2>
                <p className="text-xs text-slate-500">
                  {activeTask.unit.product.brand.name} · {activeTask.unit.product.category.name}
                </p>
                {activeTask.unit.reservedFor && (
                  <p className="mt-1 text-[11px] font-semibold text-amber-800">
                    Priority — delivery {deliveryDayLabel(activeTask.unit.reservedFor.scheduledDate)}
                  </p>
                )}
                {activeTask.unit.bin && (
                  <p className="mt-1 flex items-center gap-1 text-[11px] text-slate-600">
                    <MapPin className="h-3 w-3 text-slate-400" />
                    Location:{" "}
                    <strong className="text-slate-800">
                      {activeTask.unit.bin.name} ({activeTask.unit.bin.code})
                    </strong>
                  </p>
                )}
              </div>

              <div className="flex items-center justify-between gap-2 rounded-xl bg-slate-100 p-2 sm:flex-col sm:items-end sm:justify-start sm:bg-transparent sm:p-0">
                <div
                  className={`flex items-center gap-1.5 rounded-xl px-3 py-1 font-mono text-xl font-black ${
                    activeTask.status === "ON_HOLD" ? "bg-amber-100 text-amber-900" : "bg-indigo-100 text-indigo-950"
                  }`}
                >
                  <Clock className="h-4 w-4" />
                  <span>{formatTimer(elapsedSec)}</span>
                </div>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  {activeTask.status === "ON_HOLD" ? "Paused (On Hold)" : "Build Time"}
                </span>
              </div>
            </div>

            {activeTask.status === "ON_HOLD" && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                <div className="flex flex-wrap items-center gap-1.5 font-bold">
                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                  <span>Build On Hold</span>
                  <HoldIssueChip issue={activeTask.holdIssue} legacyReason={activeTask.holdReason} />
                </div>
                {activeTask.holdNote && <p className="mt-1 text-slate-700">Supervisor: {activeTask.holdNote}</p>}
                <div className="mt-1 text-[10px] text-amber-700">
                  Total hold time: {Math.round(activeTask.totalHoldSeconds / 60)} mins
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 pt-1">
              {activeTask.status === "ON_HOLD" ? (
                <Button
                  onClick={handleResume}
                  disabled={busy}
                  className="h-12 gap-2 bg-emerald-600 text-sm font-bold text-white shadow-sm hover:bg-emerald-700"
                >
                  <Play className="h-4 w-4 fill-current" />
                  Resume Build
                </Button>
              ) : (
                <Button
                  variant="outline"
                  onClick={() => setShowHold(true)}
                  disabled={busy}
                  className="h-12 gap-2 border-amber-300 font-bold text-amber-800 hover:bg-amber-50"
                >
                  <Pause className="h-4 w-4" />
                  Put On Hold
                </Button>
              )}

              <Button
                onClick={() => setShowComplete(true)}
                className="h-12 gap-2 bg-indigo-600 text-sm font-bold text-white shadow-sm hover:bg-indigo-700"
              >
                <CheckCircle className="h-4 w-4" />
                Finish & Photo
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-6 text-center shadow-xs">
          <Bike className="mx-auto h-8 w-8 text-slate-400" />
          <div className="mt-2 text-sm font-bold text-slate-800">No Active Build Right Now</div>
          <p className="mt-0.5 text-xs text-slate-500">
            {pendingTasks.length > 0
              ? "Select a bicycle from your queue below to start assembling."
              : "No bicycles currently assigned to you."}
          </p>
        </div>
      )}

      <div className="space-y-2.5">
        <div className="flex items-center justify-between text-xs font-bold uppercase text-slate-600">
          <span>My Assigned Tasks ({pendingTasks.length})</span>
        </div>

        {loading ? (
          <div className="space-y-2">
            {[1, 2].map((i) => (
              <div key={i} className="h-16 animate-pulse rounded-xl bg-slate-100" />
            ))}
          </div>
        ) : pendingTasks.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white p-5 text-center text-xs text-slate-400">
            No pending tasks in your queue.
          </div>
        ) : (
          <div className="space-y-2">
            {pendingTasks.map((t) => (
              <div
                key={t.id}
                className={`flex items-center justify-between gap-3 rounded-xl border bg-white p-3.5 shadow-xs transition-all hover:border-indigo-300 ${
                  t.unit.reservedFor ? "border-amber-300" : "border-slate-200"
                }`}
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-bold text-indigo-600">{t.unit.unitCode}</span>
                    <StarChip reservedFor={t.unit.reservedFor} />
                    <LevelChip level={t.level} />
                  </div>
                  <div className="mt-0.5 truncate text-xs font-semibold text-slate-900">{t.unit.product.name}</div>
                  <div className="text-[11px] text-slate-500">
                    {t.unit.product.brand.name} · {t.unit.product.category.name}
                  </div>
                </div>

                <Button
                  onClick={() => handleStart(t.id)}
                  disabled={activeTask !== null || busy}
                  size="sm"
                  className="min-h-[44px] shrink-0 gap-1 bg-indigo-600 text-xs font-semibold text-white hover:bg-indigo-700"
                >
                  <Play className="h-3 w-3 fill-current" />
                  Start
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {completedTasks.length > 0 && (
        <div className="space-y-2.5 pt-2">
          <div className="flex items-center justify-between text-xs font-bold uppercase text-slate-600">
            <span>Completed Today ({completedTasks.length})</span>
          </div>
          <div className="space-y-2">
            {completedTasks.map((t) => (
              <div
                key={t.id}
                className="flex items-center justify-between gap-2 rounded-xl border border-emerald-100 bg-emerald-50/40 p-3 text-xs"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                    <span className="font-mono font-bold text-slate-800">{t.unit.unitCode}</span>
                    <span className="text-slate-400">·</span>
                    <span className="font-medium text-slate-700">{t.unit.product.name}</span>
                  </div>
                  <p className="mt-0.5 text-[10px] text-slate-500">
                    Assembled:{" "}
                    {t.completedAt
                      ? new Date(t.completedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                      : "Done"}
                    {t.unit.frameNumber && ` · Frame #${t.unit.frameNumber}`}
                  </p>
                </div>
                <Badge variant="success" className="px-1.5 py-0 text-[10px]">
                  Assembled
                </Badge>
              </div>
            ))}
          </div>
        </div>
      )}

      {showHold && activeTask && (
        <HoldSheet
          taskId={activeTask.id}
          unitCode={activeTask.unit.unitCode}
          onClose={() => setShowHold(false)}
          onHeld={onChanged}
          onError={(message) => {
            alert(message);
            onChanged();
          }}
        />
      )}

      {showComplete && activeTask && (
        <CompleteModal
          task={activeTask}
          onClose={() => setShowComplete(false)}
          onCompleted={(unitCode) => {
            setShowComplete(false);
            onSuccess(`Great job! ${unitCode} marked assembled & credited to your workshop earnings.`);
            onChanged();
          }}
        />
      )}
    </div>
  );
}
