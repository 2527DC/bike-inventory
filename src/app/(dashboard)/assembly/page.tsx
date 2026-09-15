"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
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
  Bike,
  MapPin,
  Camera,
  X,
  Layers,
  ListChecks,
  Loader2,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";
import { ASSEMBLY_LEVELS, assemblyLevelLabel, type AssemblyLevelValue } from "@/lib/assembly-level";

const log = createLogger("assembly:page");

interface ProductRef {
  id: string;
  name: string;
  sku: string;
  /** The product's one level (plan 1509, D3). Null until the first assignment or /stock sets it. */
  assemblyLevel?: AssemblyLevelValue | null;
  brand: { id: string; name: string };
  category: { id: string; name: string };
}

interface AssemblyTask {
  id: string;
  level: AssemblyLevelValue;
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
    product: ProductRef;
    bin?: { id: string; code: string; name: string; directions?: string | null } | null;
  };
}

interface PendingUnit {
  id: string;
  unitCode: string;
  frameNumber?: string | null;
  product: ProductRef;
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

/** GET /api/assembly/tasks — see the route's header for the keys. */
interface AssemblyData {
  tasks: AssemblyTask[];
  pendingUnits: PendingUnit[];
  mechanics: Mechanic[];
  isSupervisor: boolean;
  pendingTotal: number;
  pendingPage: number;
  pendingPageSize: number;
  pendingHasMore: boolean;
}

type Tab = "awaiting" | "tasks" | "mine";

const HOLD_REASONS = [
  "Missing Pedals / Accessories",
  "Scratched Frame / Defect in Carton",
  "Derailleur / Gear Tuning Issue",
  "Disc Brake Rub / Rotor Bent",
  "Called to Customer Counter",
  "Waiting for Workshop Tools",
];

/** "85% · Semi-built" chip, or a muted "Level not set" for a product nobody has decided yet. */
function LevelChip({ level }: { level: string | null | undefined }) {
  return level ? (
    <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700 ring-1 ring-indigo-100">
      {assemblyLevelLabel(level)}
    </span>
  ) : (
    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
      Level not set
    </span>
  );
}

export default function AssemblyPage() {
  // `loading` (not `ready`) so a failed permissions read still lets the page load — it then
  // fails closed to the mechanic view.
  const { can, loading: permsLoading } = usePermissions();
  const isSupervisor = can("assembly", "approve");

  const [activeTab, setActiveTab] = useState<Tab>("mine");
  // The landing tab is chosen ONCE, after the first load. The old effect re-ran on every
  // `activeTask` change — i.e. after every reload — and yanked a supervisor back to the
  // workshop view no matter which view they had clicked.
  const landedRef = useRef(false);

  // Shared state
  const [loading, setLoading] = useState(true);
  const [myTasks, setMyTasks] = useState<AssemblyTask[]>([]);
  const [allTasks, setAllTasks] = useState<AssemblyTask[]>([]);
  const [mechanics, setMechanics] = useState<Mechanic[]>([]);

  // Awaiting Assignment — searched and paged on the server (plan 1509, B5/C2).
  const [pendingUnits, setPendingUnits] = useState<PendingUnit[]>([]);
  const [pendingTotal, setPendingTotal] = useState(0);
  const [pendingPage, setPendingPage] = useState(1);
  const [pendingHasMore, setPendingHasMore] = useState(false);
  const [pendingLoading, setPendingLoading] = useState(false);
  const [pendingQuery, setPendingQuery] = useState("");
  const [debouncedPendingQuery, setDebouncedPendingQuery] = useState("");
  /** The query the list on screen was loaded for — so the debounce does not refetch it. */
  const loadedPendingQueryRef = useRef("");
  // loadData reads the query through a ref so typing does not re-create it (and re-run the
  // load effect) on every keystroke.
  const debouncedPendingQueryRef = useRef("");

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

  // Assembly Tasks tab filters
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [mechanicFilter, setMechanicFilter] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState("");

  // Assign modal. The level starts EMPTY: a product that has none must be chosen on purpose,
  // not defaulted to 85% (the old `useState("A85")` quietly decided it for everyone).
  const [selectedUnitForAssign, setSelectedUnitForAssign] = useState<PendingUnit | null>(null);
  const [assignMechanicId, setAssignMechanicId] = useState("");
  const [assignLevel, setAssignLevel] = useState<AssemblyLevelValue | null>(null);
  const [assignNotes, setAssignNotes] = useState("");
  const [assignSaving, setAssignSaving] = useState(false);
  const [assignError, setAssignError] = useState("");

  const applyPending = useCallback((data: Pick<AssemblyData, "pendingUnits" | "pendingTotal" | "pendingPage" | "pendingHasMore">, append: boolean) => {
    setPendingUnits((prev) => (append ? [...prev, ...(data.pendingUnits ?? [])] : data.pendingUnits ?? []));
    setPendingTotal(data.pendingTotal ?? 0);
    setPendingPage(data.pendingPage ?? 1);
    setPendingHasMore(!!data.pendingHasMore);
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);

    // 1. The signed-in person's own tasks
    const mine = await apiTry<AssemblyData>("/api/assembly/tasks?mine=1");
    if (mine.error) {
      log.error("my tasks load failed", { status: mine.status });
    } else if (mine.data) {
      const list = mine.data.tasks || [];
      setMyTasks(list);
      setActiveTask(list.find((t) => t.status === "IN_PROGRESS" || t.status === "ON_HOLD") || null);
    }

    // 2. Supervisors: every task, the mechanics, and page 1 of the awaiting list for whatever
    //    is in the search box right now.
    if (isSupervisor) {
      const q = debouncedPendingQueryRef.current;
      const all = await apiTry<AssemblyData>(
        `/api/assembly/tasks?pendingPage=1${q ? `&q=${encodeURIComponent(q)}` : ""}`
      );
      if (all.error) {
        log.error("workshop data load failed", { status: all.status });
      } else if (all.data) {
        setAllTasks(all.data.tasks || []);
        setMechanics(all.data.mechanics || []);
        applyPending(all.data, false);
        loadedPendingQueryRef.current = q;
      }
    }

    setLoading(false);
    return mine.data?.tasks ?? [];
  }, [isSupervisor, applyPending]);

  useEffect(() => {
    debouncedPendingQueryRef.current = debouncedPendingQuery;
  }, [debouncedPendingQuery]);

  // Load once the grants are known: before that `isSupervisor` is false for everyone, and the
  // landing tab would be picked from the wrong answer.
  useEffect(() => {
    if (permsLoading) return;
    (async () => {
      const list = await loadData();
      if (!landedRef.current) {
        landedRef.current = true;
        const hasActive = list.some((t) => t.status === "IN_PROGRESS" || t.status === "ON_HOLD");
        setActiveTab(isSupervisor && !hasActive ? "awaiting" : "mine");
      }
    })();
  }, [loadData, isSupervisor, permsLoading]);

  // Debounce the awaiting-assignment search (~300ms)
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedPendingQuery(pendingQuery.trim()), 300);
    return () => clearTimeout(timer);
  }, [pendingQuery]);

  const loadPending = useCallback(
    async (q: string, page: number, append: boolean) => {
      setPendingLoading(true);
      const { data, error, status } = await apiTry<AssemblyData>(
        `/api/assembly/tasks?only=pending&pendingPage=${page}${q ? `&q=${encodeURIComponent(q)}` : ""}`
      );
      setPendingLoading(false);
      if (error || !data) {
        log.error("awaiting list load failed", { status, page, searched: q.length > 0 });
        return;
      }
      applyPending(data, append);
      loadedPendingQueryRef.current = q;
    },
    [applyPending]
  );

  useEffect(() => {
    if (!isSupervisor) return;
    if (debouncedPendingQuery === loadedPendingQueryRef.current) return;
    loadPending(debouncedPendingQuery, 1, false);
  }, [debouncedPendingQuery, isSupervisor, loadPending]);

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
    if (!showCompleteModal || !activeTask) return;
    (async () => {
      const { data, error } = await apiTry<Bin[]>(
        `/api/bins?warehouseId=${encodeURIComponent(activeTask.warehouse.id)}`
      );
      if (error) {
        // Without `bins.view` the list is empty and the build stays in the assembly area.
        log.warn("bins load failed", { warehouseId: activeTask.warehouse.id, message: error });
        return;
      }
      setAvailableBins(data ?? []);
    })();
  }, [showCompleteModal, activeTask]);

  // ── BUILD EXECUTION HANDLERS ──
  async function handleStartTask(taskId: string) {
    const { error, status } = await apiTry(`/api/assembly/tasks/${taskId}/start`, { method: "POST" });
    if (error) {
      log.error("start failed", { taskId, status });
      alert(error);
      return;
    }
    loadData();
  }

  async function handleHoldTask() {
    if (!activeTask) return;
    const finalReason = holdReason === "Other" ? customHoldReason : holdReason;
    if (!finalReason.trim()) {
      alert("Please select or enter a reason for placing this build on hold");
      return;
    }

    const { error, status } = await apiTry(`/api/assembly/tasks/${activeTask.id}/hold`, {
      method: "POST",
      json: { action: "HOLD", reason: finalReason.trim() },
    });
    if (error) {
      log.error("hold failed", { taskId: activeTask.id, status });
      alert(error);
      return;
    }
    setShowHoldModal(false);
    setHoldReason("");
    setCustomHoldReason("");
    loadData();
  }

  async function handleResumeTask() {
    if (!activeTask) return;
    const { error, status } = await apiTry(`/api/assembly/tasks/${activeTask.id}/hold`, {
      method: "POST",
      json: { action: "RESUME" },
    });
    if (error) {
      log.error("resume failed", { taskId: activeTask.id, status });
      alert(error);
      return;
    }
    loadData();
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
    const { error, status } = await apiTry(`/api/assembly/tasks/${activeTask.id}/complete`, {
      method: "POST",
      json: {
        photoUrl: photoDataUrl || undefined,
        destinationBinId: destinationBinId || undefined,
        frameNumber: frameNumber.trim() || undefined,
      },
    });
    setCompleting(false);
    if (error) {
      log.error("complete failed", { taskId: activeTask.id, status });
      alert(error);
      return;
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
  }

  const formatTimer = (totalSec: number) => {
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  };

  // ── SUPERVISOR ASSIGNMENT HANDLERS ──
  function openAssign(unit: PendingUnit) {
    setSelectedUnitForAssign(unit);
    setAssignLevel(null);
    setAssignNotes("");
    setAssignError("");
  }

  const assignProductLevel = selectedUnitForAssign?.product.assemblyLevel ?? null;
  const assignBlockReason = !assignMechanicId
    ? "Choose a mechanic"
    : !assignProductLevel && !assignLevel
    ? "Choose the assembly condition level"
    : "";

  async function handleAssignSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedUnitForAssign || assignBlockReason) return;

    setAssignSaving(true);
    setAssignError("");
    const unit = selectedUnitForAssign;
    const { data, error, status } = await apiTry<{ level: AssemblyLevelValue; levelSource: "product" | "saved-now"; assignedTo: { name: string } }>(
      "/api/assembly/tasks",
      {
        method: "POST",
        json: {
          unitId: unit.id,
          assignedToId: assignMechanicId,
          // A product with a level is assigned at it; the server ignores anything sent (D4).
          ...(assignProductLevel ? {} : { level: assignLevel }),
          notes: assignNotes.trim() || undefined,
        },
      }
    );
    setAssignSaving(false);

    if (error || !data) {
      log.error("assign failed", { unitId: unit.id, productId: unit.product.id, assignedToId: assignMechanicId, status });
      setAssignError(error || "Failed to assign unit");
      return;
    }

    setSelectedUnitForAssign(null);
    setAssignNotes("");
    setAssignMechanicId("");
    setSuccessMessage(
      `${unit.unitCode} assigned to ${data.assignedTo?.name ?? "the mechanic"} at ${assemblyLevelLabel(data.level)}` +
        (data.levelSource === "saved-now" ? ` — saved to ${unit.product.name}, the next one won't ask.` : ".")
    );
    setTimeout(() => setSuccessMessage(""), 7000);
    // Reload so the product's other bicycles now show the saved level.
    loadData();
  }

  // Filtered tasks (Assembly Tasks tab)
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
  const openWorkshopTasks = allTasks.filter(
    (t) => t.status === "PENDING" || t.status === "IN_PROGRESS" || t.status === "ON_HOLD"
  ).length;

  // A non-supervisor only ever sees their own queue, whatever `activeTab` holds.
  const tab: Tab = isSupervisor ? activeTab : "mine";

  // Supervisors get three tabs; everyone else has one, so the bar is not drawn for them.
  const tabs: Array<{ key: Tab; label: string; icon: typeof Bike; count: number | null }> = isSupervisor
    ? [
        { key: "awaiting", label: "Awaiting Assignment", icon: Bike, count: pendingTotal },
        { key: "tasks", label: "Assembly Tasks", icon: Layers, count: openWorkshopTasks },
        { key: "mine", label: "My Build Queue", icon: Wrench, count: pendingMyTasks.length + (activeTask ? 1 : 0) },
      ]
    : [];

  return (
    <div className="space-y-4 pb-12">
      {/* Page Header */}
      <div className="flex items-center gap-2">
        <div className="p-2 rounded-lg bg-indigo-600 text-white shadow-xs">
          <Wrench className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">Assembly & Build Line</h1>
          <p className="text-xs text-slate-500">
            Workshop queue, bicycle assembly execution, and condition tracking
          </p>
        </div>
      </div>

      {/* Top tab bar (plan 1509, C1). Scrolls sideways on a phone rather than wrapping. */}
      {tabs.length > 1 && (
        <div className="-mx-1 overflow-x-auto px-1">
          <div role="tablist" aria-label="Assembly views" className="flex min-w-max gap-1 rounded-xl bg-slate-100 p-1">
            {tabs.map((t) => {
              const Icon = t.icon;
              const selected = tab === t.key;
              return (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => setActiveTab(t.key)}
                  className={`flex min-h-[44px] items-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-xs font-semibold transition-all focus-ring ${
                    selected ? "bg-white text-indigo-700 shadow-xs" : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span>{t.label}</span>
                  {t.count !== null && t.count > 0 && (
                    <span
                      className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                        selected ? "bg-indigo-100 text-indigo-700" : "bg-slate-200 text-slate-600"
                      }`}
                    >
                      {t.count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Success Notification Banner */}
      {successMessage && (
        <div className="flex items-center gap-2 rounded-xl bg-emerald-50 p-3.5 text-xs font-semibold text-emerald-800 ring-1 ring-emerald-200">
          <CheckCircle className="h-4 w-4 shrink-0 text-emerald-600" />
          <span>{successMessage}</span>
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────── */}
      {/* ── TAB: AWAITING ASSIGNMENT (supervisors) ──────────────────── */}
      {/* ───────────────────────────────────────────────────────────── */}
      {tab === "awaiting" && (
        <div role="tabpanel" className="space-y-3">
          <div>
            <h2 className="text-sm font-bold text-slate-900">Unassembled Inventory Awaiting Assignment</h2>
            <p className="text-[11px] text-slate-500">
              Received or put-away bicycles ready to be assigned to workshop mechanics
            </p>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative sm:w-80">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                placeholder="Search unit, frame no., product, SKU, brand, bin…"
                value={pendingQuery}
                onChange={(e) => setPendingQuery(e.target.value)}
                className="min-h-[44px] pl-9 pr-9 text-sm"
                aria-label="Search bicycles awaiting assignment"
              />
              {pendingQuery && (
                <button
                  type="button"
                  onClick={() => setPendingQuery("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600"
                  aria-label="Clear search"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            <p className="text-xs text-slate-500">
              {pendingLoading ? (
                <span className="inline-flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Searching…</span>
              ) : (
                <>
                  {pendingTotal} bicycle{pendingTotal === 1 ? "" : "s"}
                  {debouncedPendingQuery ? ` matching “${debouncedPendingQuery}”` : " ready to build"}
                  {pendingUnits.length < pendingTotal ? ` · showing ${pendingUnits.length}` : ""}
                </>
              )}
            </p>
          </div>

          {loading && pendingUnits.length === 0 ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-16 animate-pulse rounded-xl bg-slate-100" />
              ))}
            </div>
          ) : pendingUnits.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 bg-white p-6 text-center text-xs text-slate-400">
              {debouncedPendingQuery
                ? `No match for “${debouncedPendingQuery}”.`
                : "No bicycles awaiting assignment. All inventory is either assigned or completed."}
            </div>
          ) : (
            <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
              {pendingUnits.map((unit) => (
                <li key={unit.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-bold text-indigo-600">{unit.unitCode}</span>
                      <LevelChip level={unit.product.assemblyLevel} />
                    </div>
                    <p className="truncate text-sm font-semibold text-slate-900">{unit.product.name}</p>
                    <p className="text-[11px] text-slate-500">
                      <span className="font-mono">{unit.product.sku}</span> · {unit.product.brand.name}
                    </p>
                    <p className="flex flex-wrap items-center gap-x-2 text-[11px] text-slate-500">
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="h-3 w-3 text-slate-400" />
                        {unit.warehouse.name}
                        {unit.bin ? ` · Bin ${unit.bin.code}` : " · no bin"}
                      </span>
                      {unit.frameNumber && <span className="font-mono">Frame #{unit.frameNumber}</span>}
                    </p>
                  </div>

                  <Button
                    size="sm"
                    onClick={() => openAssign(unit)}
                    className="min-h-[40px] shrink-0 gap-1 self-start bg-indigo-600 text-xs font-semibold text-white hover:bg-indigo-700 sm:self-auto"
                  >
                    <Plus className="h-3 w-3" />
                    Assign
                  </Button>
                </li>
              ))}
            </ul>
          )}

          {pendingHasMore && (
            <div className="flex justify-center">
              <Button
                variant="outline"
                size="sm"
                disabled={pendingLoading}
                onClick={() => loadPending(loadedPendingQueryRef.current, pendingPage + 1, true)}
                className="min-h-[44px] gap-1.5 text-xs"
              >
                {pendingLoading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Load more ({pendingTotal - pendingUnits.length} left)
              </Button>
            </div>
          )}
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────── */}
      {/* ── TAB: ASSEMBLY TASKS (supervisors) ───────────────────────── */}
      {/* ───────────────────────────────────────────────────────────── */}
      {tab === "tasks" && (
        <div role="tabpanel" className="space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
            <div>
              <h2 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                <ListChecks className="h-4 w-4 text-indigo-600" />
                Workshop Assembly Tasks
              </h2>
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
              {loading ? "Loading…" : "No assembly tasks found matching the selected filters."}
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
                      <td className="p-3 font-mono font-bold text-indigo-600">{task.unit.unitCode}</td>
                      <td className="p-3">
                        <div className="font-semibold text-slate-900">{task.unit.product.name}</div>
                        <div className="text-[10px] text-slate-400">{task.unit.product.brand.name}</div>
                      </td>
                      <td className="p-3">
                        <div className="font-medium text-slate-800">{task.assignedTo.name}</div>
                        <div className="text-[10px] text-slate-400">{task.assignedTo.email}</div>
                      </td>
                      <td className="p-3 text-center">
                        <LevelChip level={task.level} />
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
                          <span className="text-amber-700">{Math.round(task.totalHoldSeconds / 60)}m hold</span>
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
      )}

      {/* ───────────────────────────────────────────────────────────── */}
      {/* ── TAB: MY BUILD QUEUE (Mechanic Task Execution) ──────────── */}
      {/* ───────────────────────────────────────────────────────────── */}
      {tab === "mine" && (
        <div role="tabpanel" className="mx-auto max-w-2xl space-y-4">
          {/* Active Build Hero Card */}
          {activeTask ? (
            <Card className="overflow-hidden border-2 border-indigo-600 bg-gradient-to-b from-white to-slate-50 shadow-md">
              <div className="bg-indigo-600 px-4 py-2.5 text-xs font-bold text-white flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-emerald-400 animate-ping" />
                  <span>CURRENT ACTIVE BUILD</span>
                </div>
                <span className="font-mono bg-indigo-700/60 px-2 py-0.5 rounded text-[11px]">
                  Condition: {assemblyLevelLabel(activeTask.level)}
                </span>
              </div>

              <CardContent className="p-4 sm:p-5 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                  <div>
                    <span className="font-mono text-xl sm:text-2xl font-black text-indigo-600">
                      {activeTask.unit.unitCode}
                    </span>
                    <h2 className="text-base font-bold text-slate-900 mt-0.5">{activeTask.unit.product.name}</h2>
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
                        activeTask.status === "ON_HOLD" ? "bg-amber-100 text-amber-900" : "bg-indigo-100 text-indigo-950"
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
              <div className="mt-2 text-sm font-bold text-slate-800">No Active Build Right Now</div>
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
                        <span className="font-mono font-bold text-xs text-indigo-600">{t.unit.unitCode}</span>
                        <LevelChip level={t.level} />
                      </div>
                      <div className="mt-0.5 text-xs font-semibold text-slate-900 truncate">{t.unit.product.name}</div>
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
              <button type="button" onClick={() => setShowHoldModal(false)} className="text-slate-400 hover:text-slate-600">
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
                    holdReason === r ? "border-amber-500 bg-amber-50 text-amber-900" : "border-slate-200 text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  {r}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setHoldReason("Other")}
                className={`w-full rounded-lg border p-2 text-left text-xs font-medium transition-all ${
                  holdReason === "Other" ? "border-amber-500 bg-amber-50 text-amber-900" : "border-slate-200 text-slate-700 hover:bg-slate-50"
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
              <button type="button" onClick={() => setShowCompleteModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Verify bike build for <strong>{activeTask.unit.unitCode}</strong>.
            </p>

            <form onSubmit={handleCompleteTask} className="mt-4 space-y-3.5 text-xs">
              {/* Photo Verification */}
              <div>
                <label className="font-semibold text-slate-700 block mb-1">1. Bicycle Build Photo (Required)</label>
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
                <label className="font-semibold text-slate-700 block mb-1">2. Frame Number (Engraved on BB / Headtube)</label>
                <Input
                  placeholder="e.g. SN-892019-2026"
                  value={frameNumber}
                  onChange={(e) => setFrameNumber(e.target.value)}
                  className="text-xs uppercase font-mono"
                />
              </div>

              {/* Destination Bin */}
              <div>
                <label className="font-semibold text-slate-700 block mb-1">3. Move To Destination Bin</label>
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
              <button type="button" onClick={() => setSelectedUnitForAssign(null)} className="text-slate-400 hover:text-slate-600">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-2 rounded-xl bg-slate-50 p-3 text-xs">
              <span className="font-mono font-bold text-indigo-600">{selectedUnitForAssign.unitCode}</span>
              <div className="font-semibold text-slate-900">{selectedUnitForAssign.product.name}</div>
              <div className="text-[11px] text-slate-500">
                {selectedUnitForAssign.product.brand.name} · Warehouse: {selectedUnitForAssign.warehouse.code}
              </div>
            </div>

            <form onSubmit={handleAssignSubmit} className="mt-4 space-y-3 text-xs">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Assign To Mechanic *</label>
                <select
                  required
                  value={assignMechanicId}
                  onChange={(e) => setAssignMechanicId(e.target.value)}
                  className="w-full min-h-[44px] rounded-lg border border-slate-200 bg-white p-2.5 text-xs text-slate-800"
                >
                  <option value="">Select mechanic...</option>
                  {mechanics.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} ({m.email})
                    </option>
                  ))}
                </select>
              </div>

              {/* The level is the PRODUCT's (plan 1509, D3/D4). Set → shown, never asked.
                  Not set → asked once, and the answer is saved to the product. */}
              {assignProductLevel ? (
                <div className="rounded-lg border border-indigo-100 bg-indigo-50/60 p-2.5">
                  <div className="font-semibold text-slate-700">
                    Assembly condition level:{" "}
                    <span className="text-indigo-700">{assemblyLevelLabel(assignProductLevel)}</span>{" "}
                    <span className="font-normal text-slate-500">(product setting)</span>
                  </div>
                  <p className="mt-0.5 text-[10px] text-slate-500">Change it from Stock → product.</p>
                </div>
              ) : (
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Assembly Condition Level *</label>
                  <div className="grid grid-cols-3 gap-2">
                    {ASSEMBLY_LEVELS.map((lvl) => (
                      <button
                        type="button"
                        key={lvl.value}
                        onClick={() => setAssignLevel(lvl.value)}
                        aria-pressed={assignLevel === lvl.value}
                        className={`min-h-[44px] rounded-lg border p-2 text-center transition-all ${
                          assignLevel === lvl.value
                            ? "border-indigo-600 bg-indigo-50 text-indigo-900"
                            : "border-slate-200 text-slate-600 hover:bg-slate-50"
                        }`}
                      >
                        <div className="font-bold">{lvl.percent}</div>
                        <div className="text-[10px] text-slate-400">{lvl.description}</div>
                      </button>
                    ))}
                  </div>
                  <p className="mt-1 text-[10px] text-slate-500">
                    Saved to this product — the next {selectedUnitForAssign.product.name} won&apos;t ask.
                  </p>
                </div>
              )}

              <div>
                <label className="font-semibold text-slate-700 block mb-1">Supervisor Notes (Optional)</label>
                <Input
                  placeholder="e.g. Priority build for weekend delivery, check disc brake alignment"
                  value={assignNotes}
                  onChange={(e) => setAssignNotes(e.target.value)}
                  className="text-xs"
                />
              </div>

              {assignError && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-700">{assignError}</div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
                {assignBlockReason && !assignSaving && (
                  <span className="mr-auto text-[10px] text-slate-500">{assignBlockReason} to continue.</span>
                )}
                <Button size="sm" type="button" variant="outline" onClick={() => setSelectedUnitForAssign(null)}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  type="submit"
                  disabled={assignSaving || !!assignBlockReason}
                  className="bg-indigo-600 text-white hover:bg-indigo-700 font-bold"
                >
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
