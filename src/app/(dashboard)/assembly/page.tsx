"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { usePermissions } from "@/lib/use-permissions";
import {
  Wrench,
  Clock,
  CheckCircle2,
  CheckCircle,
  AlertTriangle,
  Play,
  Pause,
  Plus,
  Search,
  Filter,
  UserCheck,
  Bike,
  MapPin,
  Camera,
  X,
  Sparkles,
  Upload,
  ArrowRight,
  Layers,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

interface AssemblyTask {
  id: string;
  level: "A50" | "A85" | "FULL";
  status: "PENDING" | "IN_PROGRESS" | "ON_HOLD" | "COMPLETED" | "CANCELLED";
  assignedAt: string;
  startedAt?: string | null;
  holdStartedAt?: string | null;
  totalHoldSeconds: number;
  holdReason?: string | null;
  completedAt?: string | null;
  photoUrl?: string | null;
  notes?: string | null;
  assignedTo: { id: string; name: string; email: string };
  assignedBy: { id: string; name: string };
  warehouse: { id: string; name: string; code: string; kind: string };
  unit: {
    id: string;
    unitCode: string;
    frameNumber?: string | null;
    status: string;
    product: {
      id: string;
      name: string;
      sku: string;
      brand: { id: string; name: string };
      category: { id: string; name: string };
    };
    bin?: { id: string; code: string; name: string; directions?: string | null } | null;
  };
}

interface PendingUnit {
  id: string;
  unitCode: string;
  product: {
    id: string;
    name: string;
    sku: string;
    brand: { id: string; name: string };
    category: { id: string; name: string };
  };
  bin?: { id: string; code: string; name: string; directions?: string | null } | null;
  warehouse: { id: string; name: string; code: string };
}

interface Mechanic {
  id: string;
  name: string;
  email: string;
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

export default function AssemblyPage() {
  const { can } = usePermissions();
  const isSupervisor = can("assembly", "approve");

  // Tab state (for supervisors: "my_tasks" vs "supervisor")
  const [activeTab, setActiveTab] = useState<"my_tasks" | "supervisor">("my_tasks");

  // Shared state
  const [loading, setLoading] = useState(true);
  const [myTasks, setMyTasks] = useState<AssemblyTask[]>([]);
  const [allTasks, setAllTasks] = useState<AssemblyTask[]>([]);
  const [pendingUnits, setPendingUnits] = useState<PendingUnit[]>([]);
  const [mechanics, setMechanics] = useState<Mechanic[]>([]);

  // Mechanic Queue Execution State
  const [activeTask, setActiveTask] = useState<AssemblyTask | null>(null);
  const [elapsedSec, setElapsedSec] = useState<number>(0);

  // Modals for build execution
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

  // Supervisor Filters
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [mechanicFilter, setMechanicFilter] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState("");

  // Supervisor Assignment Modal
  const [selectedUnitForAssign, setSelectedUnitForAssign] = useState<PendingUnit | null>(null);
  const [assignMechanicId, setAssignMechanicId] = useState("");
  const [assignLevel, setAssignLevel] = useState<"A50" | "A85" | "FULL">("A85");
  const [assignNotes, setAssignNotes] = useState("");
  const [assignSaving, setAssignSaving] = useState(false);

  async function loadData() {
    setLoading(true);
    try {
      // 1. Fetch user's own tasks
      const myRes = await fetch("/api/assembly/tasks?mine=1");
      const myJson = await myRes.json();
      if (myJson.success) {
        const list: AssemblyTask[] = myJson.data.tasks || [];
        setMyTasks(list);

        const current = list.find(
          (t) => t.status === "IN_PROGRESS" || t.status === "ON_HOLD"
        );
        setActiveTask(current || null);
      }

      // 2. If supervisor, also fetch all workshop data
      if (isSupervisor) {
        const allRes = await fetch("/api/assembly/tasks");
        const allJson = await allRes.json();
        if (allJson.success) {
          setAllTasks(allJson.data.tasks || []);
          setPendingUnits(allJson.data.pendingUnits || []);
          setMechanics(allJson.data.mechanics || []);
        }
      }
    } catch (err) {
      console.error("Failed to load assembly data", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, [isSupervisor]);

  // If user has isSupervisor, default to supervisor tab unless they have an active task
  useEffect(() => {
    if (isSupervisor) {
      if (activeTask) {
        setActiveTab("my_tasks");
      } else {
        setActiveTab("supervisor");
      }
    } else {
      setActiveTab("my_tasks");
    }
  }, [isSupervisor, activeTask]);

  // Live timer tick for active task
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

  // ── BUILD EXECUTION HANDLERS ──
  async function handleStartTask(taskId: string) {
    try {
      const res = await fetch(`/api/assembly/tasks/${taskId}/start`, { method: "POST" });
      const json = await res.json();
      if (json.success) {
        loadData();
      } else {
        alert(json.error || "Failed to start task");
      }
    } catch (err) {
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
        loadData();
      } else {
        alert(json.error || "Hold failed");
      }
    } catch (err) {
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
        loadData();
      } else {
        alert(json.error || "Resume failed");
      }
    } catch (err) {
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
      loadData();
    } catch (err) {
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

  // ── SUPERVISOR ASSIGNMENT HANDLERS ──
  async function handleAssignSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedUnitForAssign || !assignMechanicId) return;

    setAssignSaving(true);
    try {
      const res = await fetch("/api/assembly/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          unitId: selectedUnitForAssign.id,
          assignedToId: assignMechanicId,
          level: assignLevel,
          notes: assignNotes.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (json.success) {
        setSelectedUnitForAssign(null);
        setAssignNotes("");
        setAssignMechanicId("");
        loadData();
      } else {
        alert(json.error || "Failed to assign unit");
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "Error creating assignment");
    } finally {
      setAssignSaving(false);
    }
  }

  // Filtered supervisor tasks
  const filteredSupervisorTasks = useMemo(() => {
    return allTasks.filter((t) => {
      if (statusFilter !== "ALL" && t.status !== statusFilter) return false;
      if (mechanicFilter !== "ALL" && t.assignedTo.id !== mechanicFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const code = t.unit.unitCode.toLowerCase();
        const name = t.unit.product.name.toLowerCase();
        const brand = t.unit.product.brand.name.toLowerCase();
        const mech = t.assignedTo.name.toLowerCase();
        if (!code.includes(q) && !name.includes(q) && !brand.includes(q) && !mech.includes(q)) {
          return false;
        }
      }
      return true;
    });
  }, [allTasks, statusFilter, mechanicFilter, searchQuery]);

  const pendingMyTasks = myTasks.filter((t) => t.status === "PENDING");
  const completedMyTasks = myTasks.filter((t) => t.status === "COMPLETED");

  return (
    <div className="space-y-4 pb-12">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-indigo-600 text-white shadow-xs">
              <Wrench className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-slate-900">
                Assembly & Build Line
              </h1>
              <p className="text-xs text-slate-500">
                Workshop queue, bicycle assembly execution, and condition tracking
              </p>
            </div>
          </div>
        </div>

        {/* View Switcher for Supervisors */}
        {isSupervisor && (
          <div className="flex items-center bg-slate-100 p-1 rounded-xl self-start sm:self-auto">
            <button
              type="button"
              onClick={() => setActiveTab("my_tasks")}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all flex items-center gap-1.5 ${
                activeTab === "my_tasks"
                  ? "bg-white text-indigo-700 shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <Wrench className="h-3.5 w-3.5" />
              <span>My Build Queue</span>
              {(pendingMyTasks.length > 0 || activeTask) && (
                <Badge variant="default" className="text-[10px] px-1 py-0 bg-indigo-100 text-indigo-700">
                  {pendingMyTasks.length + (activeTask ? 1 : 0)}
                </Badge>
              )}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("supervisor")}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all flex items-center gap-1.5 ${
                activeTab === "supervisor"
                  ? "bg-white text-indigo-700 shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <Layers className="h-3.5 w-3.5" />
              <span>Workshop & Assignments</span>
              {pendingUnits.length > 0 && (
                <Badge variant="warning" className="text-[10px] px-1 py-0">
                  {pendingUnits.length} unassigned
                </Badge>
              )}
            </button>
          </div>
        )}
      </div>

      {/* Success Notification Banner */}
      {successMessage && (
        <div className="flex items-center gap-2 rounded-xl bg-emerald-50 p-3.5 text-xs font-semibold text-emerald-800 ring-1 ring-emerald-200">
          <CheckCircle className="h-4 w-4 shrink-0 text-emerald-600" />
          <span>{successMessage}</span>
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────── */}
      {/* ── VIEW 1: MY BUILD QUEUE (Mechanic Task Execution) ───────── */}
      {/* ───────────────────────────────────────────────────────────── */}
      {activeTab === "my_tasks" && (
        <div className="mx-auto max-w-2xl space-y-4">
          {/* Active Build Hero Card */}
          {activeTask ? (
            <Card className="overflow-hidden border-2 border-indigo-600 bg-gradient-to-b from-white to-slate-50 shadow-md">
              <div className="bg-indigo-600 px-4 py-2.5 text-xs font-bold text-white flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-emerald-400 animate-ping" />
                  <span>CURRENT ACTIVE BUILD</span>
                </div>
                <span className="font-mono bg-indigo-700/60 px-2 py-0.5 rounded text-[11px]">
                  Condition: {activeTask.level}
                </span>
              </div>

              <CardContent className="p-4 sm:p-5 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                  <div>
                    <span className="font-mono text-xl sm:text-2xl font-black text-indigo-600">
                      {activeTask.unit.unitCode}
                    </span>
                    <h2 className="text-base font-bold text-slate-900 mt-0.5">
                      {activeTask.unit.product.name}
                    </h2>
                    <p className="text-xs text-slate-500">
                      {activeTask.unit.product.brand.name} · {activeTask.unit.product.category.name}
                    </p>
                    {activeTask.unit.bin && (
                      <p className="text-[11px] text-slate-600 mt-1 flex items-center gap-1">
                        <MapPin className="h-3 w-3 text-slate-400" />
                        Location: <strong className="text-slate-800">{activeTask.unit.bin.name} ({activeTask.unit.bin.code})</strong>
                      </p>
                    )}
                  </div>

                  {/* Digital Live Timer */}
                  <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-start gap-2 bg-slate-100 sm:bg-transparent p-2 sm:p-0 rounded-xl">
                    <div
                      className={`flex items-center gap-1.5 rounded-xl px-3 py-1 font-mono text-xl font-black ${
                        activeTask.status === "ON_HOLD"
                          ? "bg-amber-100 text-amber-900"
                          : "bg-indigo-100 text-indigo-950"
                      }`}
                    >
                      <Clock className="h-4 w-4" />
                      <span>{formatTimer(elapsedSec)}</span>
                    </div>
                    <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                      {activeTask.status === "ON_HOLD" ? "Paused (On Hold)" : "Build Time"}
                    </span>
                  </div>
                </div>

                {/* On Hold Alert if paused */}
                {activeTask.status === "ON_HOLD" && (
                  <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900">
                    <div className="flex items-center gap-1.5 font-bold">
                      <AlertTriangle className="h-4 w-4 text-amber-600" />
                      <span>Build On Hold</span>
                    </div>
                    <p className="mt-1 text-slate-700">{activeTask.holdReason}</p>
                    <div className="mt-1 text-[10px] text-amber-700">
                      Total hold time: {Math.round(activeTask.totalHoldSeconds / 60)} mins
                    </div>
                  </div>
                )}

                {/* Large Action Buttons */}
                <div className="grid grid-cols-2 gap-3 pt-1">
                  {activeTask.status === "ON_HOLD" ? (
                    <Button
                      onClick={handleResumeTask}
                      className="h-12 gap-2 bg-emerald-600 text-sm font-bold text-white hover:bg-emerald-700 shadow-sm"
                    >
                      <Play className="h-4 w-4 fill-current" />
                      Resume Build
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      onClick={() => setShowHoldModal(true)}
                      className="h-12 gap-2 border-amber-300 text-amber-800 hover:bg-amber-50 font-bold"
                    >
                      <Pause className="h-4 w-4" />
                      Put On Hold
                    </Button>
                  )}

                  <Button
                    onClick={() => setShowCompleteModal(true)}
                    className="h-12 gap-2 bg-indigo-600 text-sm font-bold text-white hover:bg-indigo-700 shadow-sm"
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
              <div className="mt-2 text-sm font-bold text-slate-800">
                No Active Build Right Now
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                {pendingMyTasks.length > 0
                  ? "Select a bicycle from your queue below to start assembling."
                  : "No bicycles currently assigned to you."}
              </p>
            </div>
          )}

          {/* Pending Tasks Queue */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between text-xs font-bold uppercase text-slate-600">
              <span>My Assigned Tasks ({pendingMyTasks.length})</span>
            </div>

            {loading ? (
              <div className="space-y-2">
                {[1, 2].map((i) => (
                  <div key={i} className="h-16 animate-pulse rounded-xl bg-slate-100" />
                ))}
              </div>
            ) : pendingMyTasks.length === 0 ? (
              <div className="rounded-xl border border-slate-200 bg-white p-5 text-center text-xs text-slate-400">
                No pending tasks in your queue.
              </div>
            ) : (
              <div className="space-y-2">
                {pendingMyTasks.map((t) => (
                  <div
                    key={t.id}
                    className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-3.5 shadow-xs transition-all hover:border-indigo-300 gap-3"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-xs text-indigo-600">
                          {t.unit.unitCode}
                        </span>
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
                          Level: {t.level}
                        </span>
                      </div>
                      <div className="mt-0.5 text-xs font-semibold text-slate-900 truncate">
                        {t.unit.product.name}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {t.unit.product.brand.name} · {t.unit.product.category.name}
                      </div>
                    </div>

                    <Button
                      onClick={() => handleStartTask(t.id)}
                      disabled={activeTask !== null}
                      size="sm"
                      className="h-8 gap-1 bg-indigo-600 text-xs font-semibold text-white hover:bg-indigo-700 shrink-0"
                    >
                      <Play className="h-3 w-3 fill-current" />
                      Start
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Completed Builds Today */}
          {completedMyTasks.length > 0 && (
            <div className="space-y-2.5 pt-2">
              <div className="flex items-center justify-between text-xs font-bold uppercase text-slate-600">
                <span>Completed Today ({completedMyTasks.length})</span>
              </div>
              <div className="space-y-2">
                {completedMyTasks.map((t) => (
                  <div
                    key={t.id}
                    className="flex items-center justify-between rounded-xl border border-emerald-100 bg-emerald-50/40 p-3 text-xs"
                  >
                    <div>
                      <div className="flex items-center gap-1.5">
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                        <span className="font-mono font-bold text-slate-800">{t.unit.unitCode}</span>
                        <span className="text-slate-400">·</span>
                        <span className="font-medium text-slate-700">{t.unit.product.name}</span>
                      </div>
                      <p className="text-[10px] text-slate-500 mt-0.5">
                        Assembled: {t.completedAt ? new Date(t.completedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "Done"}
                        {t.unit.frameNumber && ` · Frame #${t.unit.frameNumber}`}
                      </p>
                    </div>
                    <Badge variant="success" className="text-[10px] px-1.5 py-0">
                      Assembled
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────── */}
      {/* ── VIEW 2: SUPERVISOR & ASSIGNMENTS ───────────────────────── */}
      {/* ───────────────────────────────────────────────────────────── */}
      {activeTab === "supervisor" && isSupervisor && (
        <div className="space-y-5">
          {/* Section 1: Unassembled Bicycles Awaiting Assignment */}
          <Card className="border border-indigo-100 bg-gradient-to-r from-indigo-50/40 via-white to-white shadow-xs">
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                    <Bike className="h-4 w-4 text-indigo-600" />
                    <span>Unassembled Inventory Awaiting Assignment</span>
                  </h2>
                  <p className="text-[11px] text-slate-500">
                    Received or put-away bicycles ready to be assigned to workshop mechanics
                  </p>
                </div>
                <Badge variant="default" className="text-xs font-semibold">
                  {pendingUnits.length} Ready to Build
                </Badge>
              </div>

              {pendingUnits.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-xs text-slate-400">
                  No unassembled bicycles awaiting assignment. All inventory is either assigned or completed.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5 max-h-72 overflow-y-auto pr-1">
                  {pendingUnits.map((unit) => (
                    <div
                      key={unit.id}
                      className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-3 shadow-xs hover:border-indigo-200 transition-colors"
                    >
                      <div className="min-w-0 pr-2">
                        <span className="font-mono font-bold text-xs text-indigo-600">
                          {unit.unitCode}
                        </span>
                        <p className="text-xs font-bold text-slate-900 truncate mt-0.5">
                          {unit.product.name}
                        </p>
                        <p className="text-[11px] text-slate-500">
                          {unit.product.brand.name} · {unit.warehouse.code}
                        </p>
                        {unit.bin && (
                          <span className="text-[10px] text-slate-500 mt-0.5 block">
                            Bin: {unit.bin.code}
                          </span>
                        )}
                      </div>

                      <Button
                        size="sm"
                        onClick={() => {
                          setSelectedUnitForAssign(unit);
                          setAssignLevel("A85");
                          setAssignNotes("");
                        }}
                        className="h-8 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white shrink-0 gap-1"
                      >
                        <Plus className="h-3 w-3" />
                        Assign
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Section 2: All Workshop Assembly Tasks & Filters */}
          <div className="space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
              <div>
                <h2 className="text-sm font-bold text-slate-900">Workshop Assembly Tasks</h2>
                <p className="text-[11px] text-slate-500">Live overview across all mechanics and condition levels</p>
              </div>

              {/* Filters */}
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
                  <Input
                    placeholder="Search unit, model, mechanic..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="h-8 pl-8 text-xs w-48 sm:w-56"
                  />
                </div>

                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="h-8 rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-700"
                >
                  <option value="ALL">All Statuses</option>
                  <option value="PENDING">Pending</option>
                  <option value="IN_PROGRESS">In Progress</option>
                  <option value="ON_HOLD">On Hold</option>
                  <option value="COMPLETED">Completed</option>
                </select>

                <select
                  value={mechanicFilter}
                  onChange={(e) => setMechanicFilter(e.target.value)}
                  className="h-8 rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-700"
                >
                  <option value="ALL">All Mechanics</option>
                  {mechanics.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Task Table */}
            {filteredSupervisorTasks.length === 0 ? (
              <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-xs text-slate-400">
                No assembly tasks found matching the selected filters.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-xs">
                <table className="w-full text-left text-xs text-slate-700 min-w-[700px]">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-[10px] uppercase text-slate-400">
                      <th className="p-3 font-semibold">Unit Code</th>
                      <th className="p-3 font-semibold">Bicycle Model</th>
                      <th className="p-3 font-semibold">Assigned Mechanic</th>
                      <th className="p-3 font-semibold text-center">Condition</th>
                      <th className="p-3 font-semibold text-center">Status</th>
                      <th className="p-3 font-semibold">Assigned On</th>
                      <th className="p-3 font-semibold text-right">Hold / Duration</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredSupervisorTasks.map((task) => (
                      <tr key={task.id} className="hover:bg-slate-50 transition-colors">
                        <td className="p-3 font-mono font-bold text-indigo-600">
                          {task.unit.unitCode}
                        </td>
                        <td className="p-3">
                          <div className="font-semibold text-slate-900">{task.unit.product.name}</div>
                          <div className="text-[10px] text-slate-400">{task.unit.product.brand.name}</div>
                        </td>
                        <td className="p-3">
                          <div className="font-medium text-slate-800">{task.assignedTo.name}</div>
                          <div className="text-[10px] text-slate-400">{task.assignedTo.email}</div>
                        </td>
                        <td className="p-3 text-center">
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-mono font-bold text-slate-700">
                            {task.level}
                          </span>
                        </td>
                        <td className="p-3 text-center">
                          <Badge
                            variant={
                              task.status === "COMPLETED"
                                ? "success"
                                : task.status === "IN_PROGRESS"
                                ? "info"
                                : task.status === "ON_HOLD"
                                ? "warning"
                                : "default"
                            }
                            className="text-[10px] px-1.5 py-0"
                          >
                            {task.status}
                          </Badge>
                        </td>
                        <td className="p-3 text-slate-500 whitespace-nowrap text-[11px]">
                          {new Date(task.assignedAt).toLocaleDateString([], { month: "short", day: "numeric" })}
                        </td>
                        <td className="p-3 text-right text-slate-500 text-[11px]">
                          {task.totalHoldSeconds > 0 ? (
                            <span className="text-amber-700">
                              {Math.round(task.totalHoldSeconds / 60)}m hold
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────── */}
      {/* ── MODALS ─────────────────────────────────────────────────── */}
      {/* ───────────────────────────────────────────────────────────── */}

      {/* 1. Hold Task Modal */}
      {showHoldModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                <Pause className="h-4 w-4 text-amber-600" />
                Place Build On Hold
              </h3>
              <button
                type="button"
                onClick={() => setShowHoldModal(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Select the reason for pausing assembly. The timer will freeze until resumed.
            </p>

            <div className="mt-4 space-y-1.5">
              {HOLD_REASONS.map((r) => (
                <button
                  type="button"
                  key={r}
                  onClick={() => {
                    setHoldReason(r);
                    setCustomHoldReason("");
                  }}
                  className={`w-full rounded-lg border p-2 text-left text-xs font-medium transition-all ${
                    holdReason === r
                      ? "border-amber-500 bg-amber-50 text-amber-900"
                      : "border-slate-200 text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  {r}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setHoldReason("Other")}
                className={`w-full rounded-lg border p-2 text-left text-xs font-medium transition-all ${
                  holdReason === "Other"
                    ? "border-amber-500 bg-amber-50 text-amber-900"
                    : "border-slate-200 text-slate-700 hover:bg-slate-50"
                }`}
              >
                Other Reason...
              </button>

              {holdReason === "Other" && (
                <Input
                  placeholder="Specify reason..."
                  value={customHoldReason}
                  onChange={(e) => setCustomHoldReason(e.target.value)}
                  className="mt-2 text-xs"
                />
              )}
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={() => setShowHoldModal(false)}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleHoldTask} className="bg-amber-600 text-white hover:bg-amber-700">
                Confirm Hold
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* 2. Complete Task Modal */}
      {showCompleteModal && activeTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                <CheckCircle className="h-4 w-4 text-emerald-600" />
                Finish Assembly & Verification
              </h3>
              <button
                type="button"
                onClick={() => setShowCompleteModal(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Verify bike build for <strong>{activeTask.unit.unitCode}</strong>.
            </p>

            <form onSubmit={handleCompleteTask} className="mt-4 space-y-3.5 text-xs">
              {/* Photo Verification */}
              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  1. Bicycle Build Photo (Required)
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
                  <div className="relative overflow-hidden rounded-xl border border-slate-200">
                    <img src={photoDataUrl} alt="Build preview" className="h-44 w-full object-cover" />
                    <button
                      type="button"
                      onClick={() => setPhotoDataUrl("")}
                      className="absolute right-2 top-2 rounded-full bg-black/60 p-1 text-white hover:bg-black"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex h-32 w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 hover:bg-slate-100 transition-colors"
                  >
                    <Camera className="h-6 w-6 text-slate-400" />
                    <span className="font-medium text-slate-600">Take Photo or Upload</span>
                  </button>
                )}
              </div>

              {/* Frame Number */}
              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  2. Frame Number (Engraved on BB / Headtube)
                </label>
                <Input
                  placeholder="e.g. SN-892019-2026"
                  value={frameNumber}
                  onChange={(e) => setFrameNumber(e.target.value)}
                  className="text-xs uppercase font-mono"
                />
              </div>

              {/* Destination Bin */}
              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  3. Move To Destination Bin
                </label>
                <select
                  value={destinationBinId}
                  onChange={(e) => setDestinationBinId(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white p-2.5 text-xs text-slate-800"
                >
                  <option value="">Keep in current assembly area...</option>
                  {availableBins.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.code} ({b.name}) {b.isAssemblyArea ? "— Assembly Area" : ""}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button size="sm" type="button" variant="outline" onClick={() => setShowCompleteModal(false)}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  type="submit"
                  disabled={completing || !photoDataUrl}
                  className="bg-emerald-600 text-white hover:bg-emerald-700 font-bold"
                >
                  {completing ? "Completing..." : "Complete Build"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 3. Supervisor Assignment Modal */}
      {selectedUnitForAssign && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                <Wrench className="h-4 w-4 text-indigo-600" />
                Assign Bicycle to Mechanic
              </h3>
              <button
                type="button"
                onClick={() => setSelectedUnitForAssign(null)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-2 rounded-xl bg-slate-50 p-3 text-xs">
              <span className="font-mono font-bold text-indigo-600">
                {selectedUnitForAssign.unitCode}
              </span>
              <div className="font-semibold text-slate-900">
                {selectedUnitForAssign.product.name}
              </div>
              <div className="text-[11px] text-slate-500">
                {selectedUnitForAssign.product.brand.name} · Warehouse: {selectedUnitForAssign.warehouse.code}
              </div>
            </div>

            <form onSubmit={handleAssignSubmit} className="mt-4 space-y-3 text-xs">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  Assign To Mechanic *
                </label>
                <select
                  required
                  value={assignMechanicId}
                  onChange={(e) => setAssignMechanicId(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white p-2.5 text-xs text-slate-800"
                >
                  <option value="">Select mechanic...</option>
                  {mechanics.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} ({m.email})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  Assembly Condition Level *
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: "A50", label: "50%", desc: "Box build" },
                    { id: "A85", label: "85%", desc: "Semi-built" },
                    { id: "FULL", label: "100%", desc: "Full tune" },
                  ].map((lvl) => (
                    <button
                      type="button"
                      key={lvl.id}
                      onClick={() => setAssignLevel(lvl.id as "A50" | "A85" | "FULL")}
                      className={`rounded-lg border p-2 text-center transition-all ${
                        assignLevel === lvl.id
                          ? "border-indigo-600 bg-indigo-50 text-indigo-900"
                          : "border-slate-200 text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      <div className="font-bold">{lvl.label}</div>
                      <div className="text-[10px] text-slate-400">{lvl.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  Supervisor Notes (Optional)
                </label>
                <Input
                  placeholder="e.g. Priority build for weekend delivery, check disc brake alignment"
                  value={assignNotes}
                  onChange={(e) => setAssignNotes(e.target.value)}
                  className="text-xs"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button size="sm" type="button" variant="outline" onClick={() => setSelectedUnitForAssign(null)}>
                  Cancel
                </Button>
                <Button size="sm" type="submit" disabled={assignSaving} className="bg-indigo-600 text-white hover:bg-indigo-700 font-bold">
                  {assignSaving ? "Assigning..." : "Confirm & Move to ASM"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
