import type { AssemblyLevelValue } from "@/lib/assembly-level";

/** The five `/assembly?tab=` keys (plan 1709, R1, R29, R42). */
export type Tab = "awaiting" | "tasks" | "mine" | "labels" | "no-assembly";

export const TAB_KEYS: readonly Tab[] = ["awaiting", "tasks", "mine", "labels", "no-assembly"];

export function isTab(value: string | null): value is Tab {
  return value !== null && (TAB_KEYS as readonly string[]).includes(value);
}

export type HoldIssue = "CYCLE" | "WORKFLOOR";

export const HOLD_ISSUE_LABEL: Record<HoldIssue, string> = {
  CYCLE: "Issue with the cycle",
  WORKFLOOR: "Issue on the workfloor",
};

export interface ProductRef {
  id: string;
  name: string;
  sku: string;
  /** The product's one level (plan 1509, D3). Null until the first assignment or /stock sets it. */
  assemblyLevel?: AssemblyLevelValue | null;
  brand: { id: string; name: string };
  category: { id: string; name: string };
}

/** The outward a unit is held for (★, R16/R20). Dates arrive as ISO strings. */
export interface ReservedFor {
  deliveryId: string;
  invoiceNo: string;
  scheduledDate: string | null;
  priorityAt: string | null;
}

export interface BinRef {
  id: string;
  code: string;
  name: string;
  directions?: string | null;
}

export interface AssemblyTask {
  id: string;
  level: AssemblyLevelValue;
  status: "PENDING" | "IN_PROGRESS" | "ON_HOLD" | "COMPLETED" | "CANCELLED";
  assignedAt: string;
  startedAt?: string | null;
  holdStartedAt?: string | null;
  totalHoldSeconds: number;
  /** Old free-text reason — no longer written (R3); shown only for holds made before it. */
  holdReason?: string | null;
  holdIssue?: HoldIssue | null;
  holdNote?: string | null;
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
    bin?: BinRef | null;
    reservedFor?: ReservedFor | null;
    /** The vendor the unit was bought from, when the inbound shipment names one (Q5). */
    vendorId?: string | null;
  };
}

export interface PendingUnit {
  id: string;
  unitCode: string;
  frameNumber?: string | null;
  createdAt?: string;
  product: ProductRef;
  bin?: BinRef | null;
  warehouse: { id: string; name: string; code: string };
  reservedFor?: ReservedFor | null;
}

export interface Mechanic {
  id: string;
  name: string;
  email: string;
}

export interface Bin {
  id: string;
  code: string;
  name: string;
  isAssemblyArea: boolean;
}

export type SortKey = "delivery" | "received" | "model";

export interface FilterOptions {
  warehouses: Array<{ id: string; name: string; code: string }>;
  bins: Array<{ id: string; code: string; name: string; warehouseId: string }>;
  brands: Array<{ id: string; name: string }>;
}

/** GET /api/assembly/tasks — see the route's header for the keys. */
export interface AssemblyData {
  tasks: AssemblyTask[];
  pendingUnits: PendingUnit[];
  mechanics: Mechanic[];
  isSupervisor: boolean;
  pendingTotal: number;
  starredTotal?: number;
  pendingPage: number;
  pendingPageSize: number;
  pendingHasMore: boolean;
  filterOptions?: FilterOptions;
  selectedProduct?: { id: string; name: string; sku: string } | null;
}

export interface UnitIdsData {
  pendingIds: string[];
  truncated: boolean;
}

/** "Sat 20 Sep" — the ★ delivery day on a card. */
export function deliveryDayLabel(iso: string | null | undefined): string {
  if (!iso) return "No day yet";
  return new Date(iso).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
}

/** mm:ss (minutes keep counting past 60, as before). */
export function formatTimer(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/**
 * Build seconds on a task. While running: now − start − held. While on hold: frozen at the
 * moment the hold began (defect 1 — a reload used to show 00:00).
 */
export function buildSeconds(task: Pick<AssemblyTask, "status" | "startedAt" | "holdStartedAt" | "totalHoldSeconds">, nowMs: number): number {
  if (!task.startedAt) return 0;
  const start = new Date(task.startedAt).getTime();
  const end = task.status === "ON_HOLD" && task.holdStartedAt ? new Date(task.holdStartedAt).getTime() : nowMs;
  return Math.max(0, Math.round((end - start) / 1000) - (task.totalHoldSeconds || 0));
}
