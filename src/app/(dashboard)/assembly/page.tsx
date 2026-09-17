"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Bike, CheckCircle, Layers, PackageCheck, QrCode, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SkeletonList } from "@/components/ui/skeleton";
import { usePermissions } from "@/lib/use-permissions";
import { apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";
import { AwaitingTab } from "./_components/awaiting-tab";
import { LabelsTab } from "./_components/labels-tab";
import { MyQueueTab } from "./_components/my-queue-tab";
import { NoAssemblyTab } from "./_components/no-assembly-tab";
import { TasksTab } from "./_components/tasks-tab";
import { isTab, type AssemblyData, type AssemblyTask, type Mechanic, type Tab } from "./_components/types";

const log = createLogger("assembly:page");

/**
 * Assembly & Build Line. Each tab has its own address (plan 1709, R1):
 * `/assembly?tab=awaiting | tasks | mine | labels | no-assembly`.
 *
 * `useSearchParams` in a Client Component must sit under a Suspense boundary, or the production
 * build fails prerendering this page (node_modules/next/dist/docs/01-app/03-api-reference/
 * 04-functions/use-search-params.md) — the pattern of purchase-orders/page.tsx.
 */
export default function AssemblyPage() {
  return (
    <Suspense fallback={<SkeletonList count={4} type="card" />}>
      <AssemblyScreen />
    </Suspense>
  );
}

const TAB_META: Record<Tab, { label: string; icon: typeof Bike }> = {
  awaiting: { label: "Awaiting Assignment", icon: Bike },
  tasks: { label: "Assembly Tasks", icon: Layers },
  mine: { label: "My Build Queue", icon: Wrench },
  "no-assembly": { label: "No Assembly", icon: PackageCheck },
  labels: { label: "Labels", icon: QrCode },
};

const TAB_ORDER: Tab[] = ["awaiting", "tasks", "mine", "no-assembly", "labels"];

function AssemblyScreen() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // `loading` (not `ready`) so a failed permissions read still lets the page load — it then
  // fails closed to whatever the empty grant set allows.
  const { can, loading: permsLoading } = usePermissions();

  // Cosmetic, like every frontend check — each API re-checks its grant (R2).
  const isSupervisor = can("assembly", "approve");

  const [loading, setLoading] = useState(true);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [myTasks, setMyTasks] = useState<AssemblyTask[]>([]);
  const [allTasks, setAllTasks] = useState<AssemblyTask[]>([]);
  const [mechanics, setMechanics] = useState<Mechanic[]>([]);
  const [pendingTotal, setPendingTotal] = useState(0);
  const [successMessage, setSuccessMessage] = useState("");

  const mayMine = can("assembly", "edit");
  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError("");

    // 1. The signed-in person's own tasks, ★ first.
    if (mayMine) {
      const mine = await apiTry<AssemblyData>("/api/assembly/tasks?mine=1");
      if (mine.error) {
        log.error("my tasks load failed", { status: mine.status });
        setLoadError(mine.error);
      } else if (mine.data) {
        setMyTasks(mine.data.tasks || []);
      }
    }

    // 2. Supervisors: every task, the mechanics and the Awaiting count. The Awaiting rows are
    //    loaded by that tab itself, with its filters.
    if (isSupervisor) {
      const all = await apiTry<AssemblyData>("/api/assembly/tasks?only=tasks");
      if (all.error) {
        log.error("workshop data load failed", { status: all.status });
        setLoadError(all.error);
      } else if (all.data) {
        setAllTasks(all.data.tasks || []);
        setMechanics(all.data.mechanics || []);
        setPendingTotal(all.data.pendingTotal ?? 0);
      }
    }

    setLoading(false);
    setLoadedOnce(true);
  }, [isSupervisor, mayMine]);

  // Load once the grants are known: before that everyone looks like a mechanic.
  useEffect(() => {
    if (permsLoading) return;
    (async () => {
      await loadData();
    })();
  }, [loadData, permsLoading]);

  const allowed: Record<Tab, boolean> = {
    awaiting: isSupervisor,
    tasks: isSupervisor,
    mine: mayMine,
    labels: can("barcode", "view"),
    "no-assembly": can("assembly", "view"),
  };

  const activeTask = myTasks.find((t) => t.status === "IN_PROGRESS" || t.status === "ON_HOLD") ?? null;

  // ── Which tab (R1, R2) ────────────────────────────────────────────────────────────────
  const requested = searchParams.get("tab");
  const visibleTabs = TAB_ORDER.filter((t) => allowed[t]);
  let tab: Tab | null = null;
  if (!permsLoading) {
    if (isTab(requested) && allowed[requested]) {
      tab = requested;
    } else if (!isSupervisor || loadedOnce) {
      // Today's landing rule: a supervisor with no active build lands on Awaiting; everyone
      // else on My Build Queue. Without those grants, the first tab they can see.
      tab = isSupervisor && !activeTask ? "awaiting" : allowed.mine ? "mine" : visibleTabs[0] ?? null;
    }
  }

  // Correct the address when the tab shown is not the one asked for (none, unknown, forbidden).
  // Other params (productId, warehouseId from the condition page) are kept.
  useEffect(() => {
    if (!tab || requested === tab) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", tab);
    router.replace(`/assembly?${params.toString()}`, { scroll: false });
  }, [tab, requested, searchParams, router]);

  const selectTab = (next: Tab) => router.replace(`/assembly?tab=${next}`, { scroll: false });

  /** The seeded filters are the user's to change; once they do, the address stops claiming them. */
  const seedProductId = searchParams.get("productId") ?? "";
  const seedWarehouseId = searchParams.get("warehouseId") ?? "";
  const dropSeedParams = () => {
    if (!seedProductId && !seedWarehouseId) return;
    router.replace(`/assembly?tab=${tab ?? "awaiting"}`, { scroll: false });
  };

  const showSuccess = (message: string) => {
    setSuccessMessage(message);
    setTimeout(() => setSuccessMessage(""), 7000);
  };

  const openWorkshopTasks = allTasks.filter((t) => t.status === "PENDING" || t.status === "IN_PROGRESS" || t.status === "ON_HOLD").length;
  const counts: Record<Tab, number | null> = {
    awaiting: pendingTotal,
    tasks: openWorkshopTasks,
    mine: myTasks.filter((t) => t.status === "PENDING").length + (activeTask ? 1 : 0),
    "no-assembly": null,
    labels: null,
  };

  return (
    <div className="space-y-4 pb-12">
      <div className="flex items-center gap-2">
        <div className="rounded-lg bg-indigo-600 p-2 text-white shadow-xs">
          <Wrench className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">Assembly & Build Line</h1>
          <p className="text-xs text-slate-500">Workshop queue, bicycle assembly execution, and condition tracking</p>
        </div>
      </div>

      {/* Tab bar — for anyone with two or more tabs. Scrolls sideways on a phone rather than wrapping. */}
      {visibleTabs.length > 1 && (
        <div className="-mx-1 overflow-x-auto px-1">
          <div role="tablist" aria-label="Assembly views" className="flex min-w-max gap-1 rounded-xl bg-slate-100 p-1">
            {visibleTabs.map((key) => {
              const { label, icon: Icon } = TAB_META[key];
              const selected = tab === key;
              const count = counts[key];
              return (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => selectTab(key)}
                  className={`flex min-h-[44px] items-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-xs font-semibold transition-all focus-ring ${
                    selected ? "bg-white text-indigo-700 shadow-xs" : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span>{label}</span>
                  {count !== null && count > 0 && (
                    <span
                      className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                        selected ? "bg-indigo-100 text-indigo-700" : "bg-slate-200 text-slate-600"
                      }`}
                    >
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {successMessage && (
        <div className="flex items-center gap-2 rounded-xl bg-emerald-50 p-3.5 text-xs font-semibold text-emerald-800 ring-1 ring-emerald-200">
          <CheckCircle className="h-4 w-4 shrink-0 text-emerald-600" />
          <span>{successMessage}</span>
        </div>
      )}

      {loadError && (tab === "mine" || tab === "tasks") && (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-700">
          <span>{loadError}</span>
          <Button size="sm" variant="outline" onClick={() => void loadData()} className="min-h-[36px] text-xs">
            Retry
          </Button>
        </div>
      )}

      {tab === null ? (
        permsLoading || !loadedOnce ? (
          <SkeletonList count={4} type="card" />
        ) : (
          <div className="rounded-xl border border-dashed border-slate-200 bg-white p-6 text-center text-xs text-slate-500">
            You do not have access to any assembly view.
          </div>
        )
      ) : tab === "awaiting" ? (
        <AwaitingTab
          mechanics={mechanics}
          initialProductId={seedProductId}
          initialWarehouseId={seedWarehouseId}
          onFiltersChanged={dropSeedParams}
          onAssigned={(message) => {
            showSuccess(message);
            void loadData();
          }}
        />
      ) : tab === "tasks" ? (
        <TasksTab tasks={allTasks} mechanics={mechanics} loading={loading} onChanged={() => void loadData()} />
      ) : tab === "mine" ? (
        <MyQueueTab tasks={myTasks} loading={loading} onChanged={() => void loadData()} onSuccess={showSuccess} />
      ) : tab === "no-assembly" ? (
        <NoAssemblyTab initialProductId={seedProductId} initialWarehouseId={seedWarehouseId} onFiltersChanged={dropSeedParams} />
      ) : (
        <LabelsTab />
      )}
    </div>
  );
}
