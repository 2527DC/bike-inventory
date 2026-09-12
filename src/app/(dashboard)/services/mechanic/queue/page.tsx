"use client";

import { useState, useEffect, useRef } from "react";
import { usePermissions } from "@/lib/use-permissions";
import {
  Wrench,
  Play,
  Pause,
  CheckCircle,
  Camera,
  AlertTriangle,
  Clock,
  Bike,
  MapPin,
  ArrowRight,
  Upload,
  X,
  Sparkles,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

interface Task {
  id: string;
  level: "A50" | "A85" | "FULL";
  status: "PENDING" | "IN_PROGRESS" | "ON_HOLD" | "COMPLETED";
  startedAt?: string | null;
  holdStartedAt?: string | null;
  totalHoldSeconds: number;
  holdReason?: string | null;
  completedAt?: string | null;
  photoUrl?: string | null;
  notes?: string | null;
  unit: {
    id: string;
    unitCode: string;
    product: {
      id: string;
      name: string;
      sku: string;
      brand: { id: string; name: string };
      category: { id: string; name: string };
    };
    bin?: { id: string; code: string; name: string } | null;
  };
  warehouse: { id: string; name: string; code: string };
}

interface Bin {
  id: string;
  code: string;
  name: string;
  isAssemblyArea: boolean;
}

const HOLD_REASONS = [
  "Missing Pedals / Accessories",
  "Scratched Frame / Defect in Carton",
  "Derailleur / Gear Tuning Issue",
  "Disc Brake Rub / Rotor Bent",
  "Called to Customer Counter",
  "Waiting for Workshop Tools",
];

export default function MechanicQueuePage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [elapsedSec, setElapsedSec] = useState<number>(0);

  // Modals
  const [showHoldModal, setShowHoldModal] = useState(false);
  const [holdReason, setHoldReason] = useState("");
  const [customHoldReason, setCustomHoldReason] = useState("");

  const [showCompleteModal, setShowCompleteModal] = useState(false);
  const [photoDataUrl, setPhotoDataUrl] = useState<string>("");
  const [frameNumber, setFrameNumber] = useState<string>("");
  const [destinationBinId, setDestinationBinId] = useState<string>("");
  const [availableBins, setAvailableBins] = useState<Bin[]>([]);
  const [completing, setCompleting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string>("");

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load Mechanic's Tasks
  async function loadMyTasks() {
    try {
      const res = await fetch("/api/assembly/tasks");
      const json = await res.json();
      if (json.success) {
        const myTasks = json.data.tasks || [];
        setTasks(myTasks);

        // Find active task (IN_PROGRESS or ON_HOLD)
        const current = myTasks.find(
          (t: Task) => t.status === "IN_PROGRESS" || t.status === "ON_HOLD"
        );
        setActiveTask(current || null);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadMyTasks();
  }, []);

  // Timer tick for active task
  useEffect(() => {
    if (!activeTask || activeTask.status !== "IN_PROGRESS" || !activeTask.startedAt) {
      return;
    }

    function calculateElapsed() {
      if (!activeTask?.startedAt) return 0;
      const startMs = new Date(activeTask.startedAt).getTime();
      const nowMs = Date.now();
      const grossSec = Math.max(0, Math.round((nowMs - startMs) / 1000));
      return Math.max(0, grossSec - (activeTask.totalHoldSeconds || 0));
    }

    setElapsedSec(calculateElapsed());
    const interval = setInterval(() => {
      setElapsedSec(calculateElapsed());
    }, 1000);

    return () => clearInterval(interval);
  }, [activeTask]);

  // Load available bins when complete modal opens
  useEffect(() => {
    if (showCompleteModal && activeTask) {
      fetch(`/api/bins?warehouseId=${encodeURIComponent(activeTask.warehouse.id)}`)
        .then((r) => r.json())
        .then((res) => {
          if (res.success) setAvailableBins(res.data);
        })
        .catch(console.error);
    }
  }, [showCompleteModal, activeTask]);

  // Actions
  async function handleStartTask(taskId: string) {
    try {
      const res = await fetch(`/api/assembly/tasks/${taskId}/start`, { method: "POST" });
      const json = await res.json();
      if (json.success) {
        loadMyTasks();
      } else {
        alert(json.error || "Failed to start task");
      }
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Error starting task");
    }
  }

  async function handleHoldTask() {
    if (!activeTask) return;
    const finalReason = holdReason === "Other" ? customHoldReason : holdReason;
    if (!finalReason.trim()) {
      alert("Please select or enter a reason for placing this build on hold");
      return;
    }

    try {
      const res = await fetch(`/api/assembly/tasks/${activeTask.id}/hold`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "HOLD", reason: finalReason.trim() }),
      });
      const json = await res.json();
      if (json.success) {
        setShowHoldModal(false);
        setHoldReason("");
        setCustomHoldReason("");
        loadMyTasks();
      } else {
        alert(json.error || "Hold failed");
      }
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Error putting on hold");
    }
  }

  async function handleResumeTask() {
    if (!activeTask) return;
    try {
      const res = await fetch(`/api/assembly/tasks/${activeTask.id}/hold`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "RESUME" }),
      });
      const json = await res.json();
      if (json.success) {
        loadMyTasks();
      } else {
        alert(json.error || "Resume failed");
      }
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Error resuming");
    }
  }

  function handlePhotoCapture(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      setPhotoDataUrl(reader.result as string);
    };
    reader.readAsDataURL(file);
  }

  async function handleCompleteTask(e: React.FormEvent) {
    e.preventDefault();
    if (!activeTask) return;

    setCompleting(true);
    try {
      const res = await fetch(`/api/assembly/tasks/${activeTask.id}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          photoUrl: photoDataUrl || undefined,
          destinationBinId: destinationBinId || undefined,
          frameNumber: frameNumber.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || "Failed to complete task");
      }

      setShowCompleteModal(false);
      setPhotoDataUrl("");
      setFrameNumber("");
      setDestinationBinId("");
      setSuccessMessage(
        `Great job! ${activeTask.unit.unitCode} marked assembled & credited to your workshop earnings.`
      );
      setTimeout(() => setSuccessMessage(""), 7000);
      loadMyTasks();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Error completing task");
    } finally {
      setCompleting(false);
    }
  }

  const formatTimer = (totalSec: number) => {
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  };

  const pendingTasks = tasks.filter((t) => t.status === "PENDING");
  const completedTasks = tasks.filter((t) => t.status === "COMPLETED");

  return (
    <div className="mx-auto max-w-xl space-y-5 pb-16">
      {/* Top Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
            <Wrench className="h-4 w-4" />
            <span>Mechanic Workspace</span>
          </div>
          <h1 className="text-2xl font-black tracking-tight text-slate-900 dark:text-white">
            My Build Line
          </h1>
        </div>
        <Badge variant="default" className="text-xs font-semibold">
          {pendingTasks.length + (activeTask ? 1 : 0)} Active
        </Badge>
      </div>

      {/* Success Notification Banner */}
      {successMessage && (
        <div className="flex items-center gap-2 rounded-2xl bg-emerald-50 p-4 text-xs font-semibold text-emerald-800 shadow-sm ring-1 ring-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-200 dark:ring-emerald-800">
          <CheckCircle className="h-5 w-5 shrink-0 text-emerald-600" />
          <span>{successMessage}</span>
        </div>
      )}

      {/* ── ACTIVE TASK HERO CARD ── */}
      {activeTask ? (
        <Card className="overflow-hidden border-2 border-indigo-500 bg-gradient-to-b from-white to-slate-50 shadow-xl dark:border-indigo-600 dark:from-slate-900 dark:to-slate-950">
          <div className="bg-indigo-600 px-4 py-2.5 text-xs font-bold text-white flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-ping" />
              <span>CURRENT BUILD IN PROGRESS</span>
            </div>
            <span className="font-mono">{activeTask.level} (Condition)</span>
          </div>

          <CardContent className="p-5 space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <span className="font-mono text-2xl font-black tracking-tight text-indigo-600 dark:text-indigo-400">
                  {activeTask.unit.unitCode}
                </span>
                <h2 className="text-base font-bold text-slate-900 dark:text-white">
                  {activeTask.unit.product.name}
                </h2>
                <p className="text-xs text-slate-500">
                  {activeTask.unit.product.brand.name} · {activeTask.unit.product.category.name}
                </p>
              </div>

              {/* Large Digital Timer */}
              <div className="flex flex-col items-end">
                <div
                  className={`flex items-center gap-1.5 rounded-xl px-3 py-1 font-mono text-xl font-black ${
                    activeTask.status === "ON_HOLD"
                      ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                      : "bg-indigo-100 text-indigo-900 dark:bg-indigo-950 dark:text-indigo-200"
                  }`}
                >
                  <Clock className="h-4 w-4" />
                  <span>{formatTimer(elapsedSec)}</span>
                </div>
                <span className="mt-1 text-[10px] text-slate-400">
                  {activeTask.status === "ON_HOLD" ? "PAUSED (ON HOLD)" : "ACTIVE BUILD TIME"}
                </span>
              </div>
            </div>

            {/* Hold Reason Alert if On Hold */}
            {activeTask.status === "ON_HOLD" && (
              <div className="rounded-xl bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                <div className="flex items-center gap-1.5 font-bold">
                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                  <span>Build On Hold</span>
                </div>
                <p className="mt-1">{activeTask.holdReason}</p>
                <div className="mt-1 text-[10px] text-amber-700 dark:text-amber-400">
                  Total hold time: {Math.round(activeTask.totalHoldSeconds / 60)} mins
                </div>
              </div>
            )}

            {/* Large Big Action Touch Buttons */}
            <div className="grid grid-cols-2 gap-3 pt-2">
              {activeTask.status === "ON_HOLD" ? (
                <Button
                  onClick={handleResumeTask}
                  className="h-14 gap-2 bg-emerald-600 text-base font-bold text-white hover:bg-emerald-700 shadow-md"
                >
                  <Play className="h-5 w-5 fill-current" />
                  Resume Build
                </Button>
              ) : (
                <Button
                  variant="outline"
                  onClick={() => setShowHoldModal(true)}
                  className="h-14 gap-2 border-amber-300 text-amber-800 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-300 dark:hover:bg-amber-950/40 font-bold"
                >
                  <Pause className="h-5 w-5" />
                  Put On Hold
                </Button>
              )}

              <Button
                onClick={() => setShowCompleteModal(true)}
                className="h-14 gap-2 bg-indigo-600 text-base font-bold text-white hover:bg-indigo-700 shadow-md"
              >
                <CheckCircle className="h-5 w-5" />
                Finish & Photo
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/50 p-6 text-center dark:border-slate-800 dark:bg-slate-900/30">
          <Bike className="mx-auto h-8 w-8 text-slate-400" />
          <div className="mt-2 text-sm font-bold text-slate-800 dark:text-slate-200">
            No Active Build Right Now
          </div>
          <p className="text-xs text-slate-500">
            Pick a bicycle from your queue below to start assembling.
          </p>
        </div>
      )}

      {/* ── QUEUED PENDING TASKS ── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between text-xs font-bold uppercase text-slate-600 dark:text-slate-400">
          <span>My Assigned Tasks ({pendingTasks.length})</span>
        </div>

        {loading ? (
          <div className="space-y-2">
            {[1, 2].map((i) => (
              <div key={i} className="h-20 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800" />
            ))}
          </div>
        ) : pendingTasks.length === 0 ? (
          <div className="rounded-xl border border-slate-200 p-6 text-center text-xs text-slate-400 dark:border-slate-800">
            No pending tasks assigned to you right now.
          </div>
        ) : (
          <div className="space-y-2.5">
            {pendingTasks.map((t) => (
              <div
                key={t.id}
                className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-all hover:border-indigo-300 dark:border-slate-800 dark:bg-slate-900"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-indigo-600 dark:text-indigo-400">
                      {t.unit.unitCode}
                    </span>
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                      Level: {t.level}
                    </span>
                  </div>
                  <div className="mt-1 text-xs font-semibold text-slate-900 dark:text-white">
                    {t.unit.product.name}
                  </div>
                  <div className="text-[11px] text-slate-400">
                    {t.unit.product.brand.name} · {t.unit.product.category.name}
                  </div>
                </div>

                <Button
                  onClick={() => handleStartTask(t.id)}
                  disabled={activeTask !== null}
                  size="sm"
                  className="h-9 gap-1.5 bg-indigo-600 text-xs font-bold text-white hover:bg-indigo-700"
                >
                  <Play className="h-3.5 w-3.5 fill-current" />
                  Start
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── HOLD MODAL ── */}
      {showHoldModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-amber-600" />
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  Put Build On Hold
                </h3>
              </div>
              <button
                onClick={() => setShowHoldModal(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-4 space-y-2.5">
              <p className="text-xs text-slate-500">
                Timer will pause until you tap Resume. Select reason:
              </p>

              {HOLD_REASONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setHoldReason(r)}
                  className={`w-full rounded-xl border p-2.5 text-left text-xs font-medium transition-all ${
                    holdReason === r
                      ? "border-amber-500 bg-amber-50 text-amber-900 dark:border-amber-600 dark:bg-amber-950/60 dark:text-amber-200"
                      : "border-slate-200 text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:text-slate-300"
                  }`}
                >
                  {r}
                </button>
              ))}

              <button
                type="button"
                onClick={() => setHoldReason("Other")}
                className={`w-full rounded-xl border p-2.5 text-left text-xs font-medium ${
                  holdReason === "Other"
                    ? "border-amber-500 bg-amber-50 text-amber-900"
                    : "border-slate-200 text-slate-700"
                }`}
              >
                Other Reason...
              </button>

              {holdReason === "Other" && (
                <Input
                  placeholder="Describe reason..."
                  value={customHoldReason}
                  onChange={(e) => setCustomHoldReason(e.target.value)}
                  className="mt-2 text-xs"
                />
              )}

              <div className="flex justify-end gap-2 pt-3">
                <Button type="button" variant="outline" onClick={() => setShowHoldModal(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={handleHoldTask}
                  className="bg-amber-600 text-white hover:bg-amber-700 font-bold"
                >
                  Confirm Pause
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── COMPLETE MODAL WITH PHOTO & DESTINATION BIN ── */}
      {showCompleteModal && activeTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl dark:bg-slate-900 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <CheckCircle className="h-5 w-5 text-emerald-600" />
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  Finish Assembly & Verify
                </h3>
              </div>
              <button
                onClick={() => setShowCompleteModal(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleCompleteTask} className="mt-4 space-y-4 text-xs">
              <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800/60">
                <div className="font-mono text-sm font-bold text-indigo-600 dark:text-indigo-400">
                  {activeTask.unit.unitCode}
                </div>
                <div className="font-semibold text-slate-900 dark:text-white">
                  {activeTask.unit.product.name}
                </div>
                <div className="text-[11px] text-slate-500">
                  Recorded Net Build Time: <strong>{formatTimer(elapsedSec)}</strong>
                </div>
              </div>

              {/* Photo Verification Upload */}
              <div>
                <label className="font-semibold text-slate-700 dark:text-slate-300">
                  Verification Photo (Frame sticker & built cycle)
                </label>
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  ref={fileInputRef}
                  onChange={handlePhotoCapture}
                  className="hidden"
                />

                {photoDataUrl ? (
                  <div className="relative mt-2 overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
                    <img
                      src={photoDataUrl}
                      alt="Build verification"
                      className="h-44 w-full object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => setPhotoDataUrl("")}
                      className="absolute right-2 top-2 rounded-full bg-black/60 p-1 text-white hover:bg-black/80"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="mt-2 flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-200 p-6 text-slate-600 transition-colors hover:border-indigo-400 hover:bg-indigo-50/20 dark:border-slate-800 dark:text-slate-400"
                  >
                    <Camera className="h-6 w-6 text-indigo-600" />
                    <span className="font-semibold">Tap to Take Photo</span>
                    <span className="text-[10px] text-slate-400">
                      Snap finished bike with U-code sticker
                    </span>
                  </button>
                )}
              </div>

              {/* Frame Number */}
              <div>
                <label className="font-semibold text-slate-700 dark:text-slate-300">
                  Frame Number (Stamped on BB shell)
                </label>
                <Input
                  placeholder="e.g. HR29-8472910"
                  value={frameNumber}
                  onChange={(e) => setFrameNumber(e.target.value)}
                  className="mt-1 font-mono uppercase text-xs"
                />
              </div>

              {/* Destination Bin Selection */}
              <div>
                <label className="font-semibold text-slate-700 dark:text-slate-300">
                  Where are you parking this bicycle? (Destination Bin)
                </label>
                <select
                  value={destinationBinId}
                  onChange={(e) => setDestinationBinId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white p-2.5 text-xs text-slate-900 dark:border-slate-800 dark:bg-slate-800 dark:text-white"
                >
                  <option value="">Keep in current assembly staging area</option>
                  {availableBins.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.code} - {b.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                <Button type="button" variant="outline" onClick={() => setShowCompleteModal(false)}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={completing}
                  className="bg-emerald-600 text-white hover:bg-emerald-700 font-bold"
                >
                  {completing ? "Submitting..." : "Complete & Register Earnings"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
