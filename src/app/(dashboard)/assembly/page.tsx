"use client";

import { useState, useEffect, useMemo } from "react";
import { usePermissions } from "@/lib/use-permissions";
import {
  Wrench,
  Clock,
  CheckCircle2,
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

export default function AssemblySupervisorPage() {
  const { canApprove, canCreate, canEdit } = usePermissions();

  const [tasks, setTasks] = useState<AssemblyTask[]>([]);
  const [pendingUnits, setPendingUnits] = useState<PendingUnit[]>([]);
  const [mechanics, setMechanics] = useState<Mechanic[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [mechanicFilter, setMechanicFilter] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState("");

  // Assignment Modal
  const [selectedUnitForAssign, setSelectedUnitForAssign] = useState<PendingUnit | null>(null);
  const [assignMechanicId, setAssignMechanicId] = useState("");
  const [assignLevel, setAssignLevel] = useState<"A50" | "A85" | "FULL">("A85");
  const [assignNotes, setAssignNotes] = useState("");
  const [assignSaving, setAssignSaving] = useState(false);

  async function loadData() {
    setLoading(true);
    try {
      const res = await fetch("/api/assembly/tasks");
      const json = await res.json();
      if (json.success) {
        setTasks(json.data.tasks || []);
        setPendingUnits(json.data.pendingUnits || []);
        setMechanics(json.data.mechanics || []);
      }
    } catch (err) {
      console.error("Failed to load assembly tasks", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  async function handleAssign(e: React.FormEvent) {
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
      if (!res.ok || !json.success) {
        throw new Error(json.error || "Assignment failed");
      }

      setSelectedUnitForAssign(null);
      setAssignMechanicId("");
      setAssignLevel("A85");
      setAssignNotes("");
      loadData();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Assignment failed");
    } finally {
      setAssignSaving(false);
    }
  }

  // Filtered Tasks
  const filteredTasks = useMemo(() => {
    return tasks.filter((t) => {
      const matchesStatus = statusFilter === "ALL" || t.status === statusFilter;
      const matchesMechanic = mechanicFilter === "ALL" || t.assignedTo.id === mechanicFilter;
      const matchesSearch =
        t.unit.unitCode.toLowerCase().includes(searchQuery.toLowerCase()) ||
        t.unit.product.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        t.assignedTo.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (t.holdReason && t.holdReason.toLowerCase().includes(searchQuery.toLowerCase()));

      return matchesStatus && matchesMechanic && matchesSearch;
    });
  }, [tasks, statusFilter, mechanicFilter, searchQuery]);

  // Aggregate stats
  const inProgressCount = tasks.filter((t) => t.status === "IN_PROGRESS").length;
  const onHoldCount = tasks.filter((t) => t.status === "ON_HOLD").length;
  const completedTodayCount = tasks.filter(
    (t) =>
      t.status === "COMPLETED" &&
      t.completedAt &&
      new Date(t.completedAt).toDateString() === new Date().toDateString()
  ).length;

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
            <Wrench className="h-4 w-4" />
            <span>Workshop Build-Line Management</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Assembly Supervisor Board
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Assign boxed bicycles to mechanics, track active build timers, manage hold exceptions, and verify completed builds.
          </p>
        </div>
      </div>

      {/* KPI Stats */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Card className="border-indigo-100 bg-indigo-50/20 backdrop-blur-sm dark:border-indigo-950/60 dark:bg-indigo-950/10">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-indigo-700 dark:text-indigo-400">Awaiting Assembly</span>
              <Bike className="h-4 w-4 text-indigo-600" />
            </div>
            <div className="mt-1 text-2xl font-bold text-indigo-950 dark:text-indigo-200">
              {pendingUnits.length}
            </div>
            <div className="mt-1 text-xs text-indigo-600/70 dark:text-indigo-400/70">Unassigned boxed units</div>
          </CardContent>
        </Card>

        <Card className="border-blue-100 bg-blue-50/20 backdrop-blur-sm dark:border-blue-950/60 dark:bg-blue-950/10">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-blue-700 dark:text-blue-400">On The Stand</span>
              <Play className="h-4 w-4 text-blue-600" />
            </div>
            <div className="mt-1 text-2xl font-bold text-blue-950 dark:text-blue-200">{inProgressCount}</div>
            <div className="mt-1 text-xs text-blue-600/70 dark:text-blue-400/70">Currently being assembled</div>
          </CardContent>
        </Card>

        <Card className="border-amber-100 bg-amber-50/20 backdrop-blur-sm dark:border-amber-950/60 dark:bg-amber-950/10">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-amber-700 dark:text-amber-400">Stuck / On Hold</span>
              <AlertTriangle className="h-4 w-4 text-amber-600" />
            </div>
            <div className="mt-1 text-2xl font-bold text-amber-950 dark:text-amber-200">{onHoldCount}</div>
            <div className="mt-1 text-xs text-amber-600/70 dark:text-amber-400/70">Missing parts or issues</div>
          </CardContent>
        </Card>

        <Card className="border-emerald-100 bg-emerald-50/20 backdrop-blur-sm dark:border-emerald-950/60 dark:bg-emerald-950/10">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400">Completed Today</span>
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            </div>
            <div className="mt-1 text-2xl font-bold text-emerald-950 dark:text-emerald-200">
              {completedTodayCount}
            </div>
            <div className="mt-1 text-xs text-emerald-600/70 dark:text-emerald-400/70">Verified ready for floor</div>
          </CardContent>
        </Card>
      </div>

      {/* Unassigned Boxed Bicycles Section */}
      {pendingUnits.length > 0 && (
        <div className="rounded-2xl border border-indigo-100 bg-gradient-to-r from-indigo-50/50 via-white to-white p-5 shadow-sm dark:border-indigo-950 dark:from-slate-900/60 dark:to-slate-900">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="flex h-2 w-2 rounded-full bg-indigo-600 ring-4 ring-indigo-100" />
              <h2 className="text-sm font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200">
                Boxed Units Ready For Assignment ({pendingUnits.length})
              </h2>
            </div>
            <span className="text-xs text-slate-500">
              Assigning moves bicycle automatically to the warehouse's assembly staging area (ASM)
            </span>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {pendingUnits.slice(0, 6).map((u) => (
              <div
                key={u.id}
                className="flex items-center justify-between rounded-xl border border-slate-200/80 bg-white p-3.5 shadow-sm transition-all hover:border-indigo-300 dark:border-slate-800 dark:bg-slate-900"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-indigo-600 dark:text-indigo-400">
                      {u.unitCode}
                    </span>
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                      {u.warehouse.name}
                    </span>
                  </div>
                  <div className="mt-1 text-xs font-semibold text-slate-900 dark:text-white">
                    {u.product.name}
                  </div>
                  <div className="text-[11px] text-slate-400">
                    {u.product.brand.name} · {u.product.category.name}
                    {u.bin && ` · Bin ${u.bin.code}`}
                  </div>
                </div>

                <Button
                  size="sm"
                  onClick={() => setSelectedUnitForAssign(u)}
                  className="gap-1 bg-indigo-600 text-xs text-white hover:bg-indigo-700"
                >
                  <UserCheck className="h-3.5 w-3.5" /> Assign
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filter and State Bar */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap items-center gap-1.5">
          {["ALL", "PENDING", "IN_PROGRESS", "ON_HOLD", "COMPLETED"].map((st) => (
            <button
              key={st}
              onClick={() => setStatusFilter(st)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                statusFilter === st
                  ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400"
              }`}
            >
              {st === "ALL" ? "All Tasks" : st.replace("_", " ")}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <div className="relative w-full md:w-64">
            <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
            <Input
              placeholder="Search unit, mechanic, bike..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 text-xs"
            />
          </div>

          <select
            value={mechanicFilter}
            onChange={(e) => setMechanicFilter(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white p-2 text-xs text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300"
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

      {/* Assembly Tasks Grid */}
      {loading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="h-44 animate-pulse rounded-xl border border-slate-200 bg-slate-100/60 dark:border-slate-800 dark:bg-slate-800/40" />
          ))}
        </div>
      ) : filteredTasks.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 p-12 text-center dark:border-slate-800">
          <Wrench className="h-10 w-10 text-slate-300 dark:text-slate-600" />
          <h3 className="mt-3 text-base font-semibold text-slate-800 dark:text-slate-200">No Tasks Match</h3>
          <p className="mt-1 text-xs text-slate-500">
            No assembly tasks match the selected filter criteria.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredTasks.map((task) => {
            const isHold = task.status === "ON_HOLD";
            const isInProgress = task.status === "IN_PROGRESS";
            const isCompleted = task.status === "COMPLETED";

            // Calculate active duration in minutes (excluding holds)
            let durationMin = null;
            if (task.startedAt) {
              const end = task.completedAt ? new Date(task.completedAt).getTime() : Date.now();
              const grossSec = Math.max(0, Math.round((end - new Date(task.startedAt).getTime()) / 1000));
              const netSec = Math.max(0, grossSec - task.totalHoldSeconds);
              durationMin = Math.round(netSec / 60);
            }

            return (
              <Card
                key={task.id}
                className={`overflow-hidden transition-all hover:shadow-md ${
                  isHold
                    ? "border-amber-300 bg-amber-50/10 dark:border-amber-800/60 dark:bg-amber-950/10"
                    : isInProgress
                    ? "border-blue-300 bg-blue-50/10 dark:border-blue-800/60 dark:bg-blue-950/10"
                    : isCompleted
                    ? "border-emerald-200 bg-emerald-50/5 dark:border-emerald-900/40"
                    : "border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
                }`}
              >
                <CardContent className="p-5">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-base font-bold text-indigo-600 dark:text-indigo-400">
                          {task.unit.unitCode}
                        </span>
                        <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                          Level: {task.level}
                        </span>
                      </div>
                      <div className="mt-1 font-semibold text-slate-900 dark:text-white">
                        {task.unit.product.name}
                      </div>
                      <div className="text-[11px] text-slate-400">
                        {task.unit.product.brand.name} · {task.unit.product.category.name}
                      </div>
                    </div>

                    <Badge
                      variant={
                        isCompleted
                          ? "success"
                          : isInProgress
                          ? "info"
                          : isHold
                          ? "warning"
                          : "default"
                      }
                      className="capitalize"
                    >
                      {task.status.replace("_", " ")}
                    </Badge>
                  </div>

                  {/* Mechanic & Location info */}
                  <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3 text-xs text-slate-600 dark:border-slate-800 dark:text-slate-300">
                    <div className="flex items-center gap-1.5">
                      <UserCheck className="h-3.5 w-3.5 text-slate-400" />
                      <span className="font-semibold">{task.assignedTo.name}</span>
                    </div>

                    {durationMin !== null && (
                      <div className="flex items-center gap-1 text-[11px] text-slate-500">
                        <Clock className="h-3.5 w-3.5" />
                        <span>{durationMin} mins</span>
                      </div>
                    )}
                  </div>

                  {/* Hold Exception banner */}
                  {isHold && task.holdReason && (
                    <div className="mt-3 flex items-start gap-2 rounded-lg bg-amber-50 p-2.5 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                      <div>
                        <span className="font-semibold">On Hold:</span> {task.holdReason}
                        <div className="text-[10px] text-amber-600/80 dark:text-amber-400/80">
                          Total hold duration: {Math.round(task.totalHoldSeconds / 60)} mins
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Completed Photo verification */}
                  {isCompleted && task.photoUrl && (
                    <div className="mt-3 flex items-center gap-2 rounded-lg bg-slate-50 p-2 text-xs text-slate-600 dark:bg-slate-800/40 dark:text-slate-300">
                      <Camera className="h-3.5 w-3.5 text-emerald-600" />
                      <span>Verification photo attached</span>
                    </div>
                  )}

                  {/* Staged location */}
                  <div className="mt-3 flex items-center gap-1.5 text-[11px] text-slate-400">
                    <MapPin className="h-3 w-3" />
                    <span>
                      {task.warehouse.name} ({task.unit.bin ? task.unit.bin.code : "ASM Area"})
                    </span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* ── ASSIGN MECHANIC MODAL ── */}
      {selectedUnitForAssign && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <Wrench className="h-5 w-5 text-indigo-600" />
                <h2 className="text-base font-bold text-slate-900 dark:text-white">
                  Assign Build Task
                </h2>
              </div>
              <button
                onClick={() => setSelectedUnitForAssign(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleAssign} className="mt-4 space-y-4 text-xs">
              <div className="rounded-xl bg-indigo-50/60 p-3 text-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-200">
                <div className="font-mono text-sm font-bold text-indigo-600 dark:text-indigo-400">
                  {selectedUnitForAssign.unitCode}
                </div>
                <div className="mt-0.5 font-semibold">{selectedUnitForAssign.product.name}</div>
                <div className="text-[11px] text-indigo-700 dark:text-indigo-300">
                  {selectedUnitForAssign.product.brand.name} · {selectedUnitForAssign.product.category.name}
                </div>
              </div>

              <div>
                <label className="font-semibold text-slate-700 dark:text-slate-300">
                  Assign To Mechanic *
                </label>
                <select
                  required
                  value={assignMechanicId}
                  onChange={(e) => setAssignMechanicId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white p-2.5 text-xs text-slate-900 dark:border-slate-800 dark:bg-slate-800 dark:text-white"
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
                <label className="font-semibold text-slate-700 dark:text-slate-300">
                  Assembly Condition Level *
                </label>
                <div className="mt-1.5 grid grid-cols-3 gap-2">
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
                          ? "border-indigo-600 bg-indigo-50 text-indigo-900 dark:border-indigo-500 dark:bg-indigo-950/60 dark:text-white"
                          : "border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-800 dark:text-slate-400"
                      }`}
                    >
                      <div className="font-bold">{lvl.label}</div>
                      <div className="text-[10px] text-slate-400">{lvl.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="font-semibold text-slate-700 dark:text-slate-300">
                  Supervisor Notes (Optional)
                </label>
                <Input
                  placeholder="e.g. Priority build for weekend delivery, check disc brake alignment"
                  value={assignNotes}
                  onChange={(e) => setAssignNotes(e.target.value)}
                  className="mt-1 text-xs"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setSelectedUnitForAssign(null)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={assignSaving} className="bg-indigo-600 text-white hover:bg-indigo-700">
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
