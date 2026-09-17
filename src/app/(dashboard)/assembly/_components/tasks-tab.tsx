"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ListChecks, Loader2, PauseCircle, Pencil, Search, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";
import { usePermissions } from "@/lib/use-permissions";
import { HoldIssueChip, LevelChip, StarChip } from "./chips";
import { HOLD_ISSUE_LABEL, type AssemblyTask, type Mechanic } from "./types";

const log = createLogger("assembly:tasks-tab");

interface TasksTabProps {
  /** Every task, ★ first (the API orders them, R20). */
  tasks: AssemblyTask[];
  mechanics: Mechanic[];
  loading: boolean;
  onChanged: () => void;
}

function statusVariant(status: AssemblyTask["status"]) {
  return status === "COMPLETED" ? "success" : status === "IN_PROGRESS" ? "info" : status === "ON_HOLD" ? "warning" : "default";
}

function heldSince(iso: string | null | undefined): string {
  if (!iso) return "—";
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  const when = new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const ago = mins < 60 ? `${mins}m` : mins < 60 * 24 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${Math.floor(mins / 1440)}d`;
  return `${when} · ${ago}`;
}

/** Assembly Tasks — the supervisor's overview, held builds on top (Q5, Q6). */
export function TasksTab({ tasks, mechanics, loading, onChanged }: TasksTabProps) {
  const { can } = usePermissions();
  // Cosmetic — POST /api/vendor-issues re-checks vendor_issues.create.
  const mayRaiseVendorIssue = can("vendor_issues", "create");

  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [mechanicFilter, setMechanicFilter] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState("");

  const held = tasks.filter((t) => t.status === "ON_HOLD");

  const filtered = useMemo(() => {
    return tasks.filter((t) => {
      if (statusFilter !== "ALL" && t.status !== statusFilter) return false;
      if (mechanicFilter !== "ALL" && t.assignedTo.id !== mechanicFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const hay = [t.unit.unitCode, t.unit.product.name, t.unit.product.brand.name, t.assignedTo.name].join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [tasks, statusFilter, mechanicFilter, searchQuery]);

  return (
    <div role="tabpanel" className="space-y-4">
      {/* ── Held builds (Q6) ─────────────────────────────────────────── */}
      <section className="space-y-2" aria-labelledby="held-builds-title">
        <h2 id="held-builds-title" className="flex items-center gap-1.5 text-sm font-bold text-slate-900">
          <PauseCircle className="h-4 w-4 text-amber-600" />
          Builds on hold
          {held.length > 0 && (
            <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">{held.length}</span>
          )}
        </h2>
        {loading && held.length === 0 ? (
          <div className="h-16 animate-pulse rounded-xl bg-slate-100" />
        ) : held.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 bg-white p-4 text-center text-xs text-slate-400">
            No build is on hold.
          </div>
        ) : (
          <ul className="space-y-2">
            {held.map((t) => (
              <HeldBuildRow key={t.id} task={t} mayRaiseVendorIssue={mayRaiseVendorIssue} onChanged={onChanged} />
            ))}
          </ul>
        )}
      </section>

      {/* ── Every task ───────────────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex flex-col justify-between gap-2.5 sm:flex-row sm:items-center">
          <div>
            <h2 className="flex items-center gap-1.5 text-sm font-bold text-slate-900">
              <ListChecks className="h-4 w-4 text-indigo-600" />
              Workshop Assembly Tasks
            </h2>
            <p className="text-[11px] text-slate-500">Live overview across all mechanics and condition levels</p>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
            <div className="relative col-span-2 sm:col-span-1">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <Input
                placeholder="Search unit, model, mechanic..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="min-h-[44px] w-full pl-8 text-xs sm:w-56"
                aria-label="Search tasks"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              aria-label="Status"
              className="min-h-[44px] rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-700"
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
              aria-label="Mechanic"
              className="min-h-[44px] rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-700"
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

        {filtered.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-xs text-slate-400">
            {loading ? "Loading…" : "No assembly tasks found matching the selected filters."}
          </div>
        ) : (
          <>
            {/* Phone: cards, no sideways scroll. */}
            <ul className="space-y-2 sm:hidden">
              {filtered.map((task) => (
                <li
                  key={task.id}
                  className={`rounded-xl border bg-white p-3 text-xs shadow-xs ${task.unit.reservedFor ? "border-amber-300" : "border-slate-200"}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-mono font-bold text-indigo-600">{task.unit.unitCode}</span>
                        <StarChip reservedFor={task.unit.reservedFor} />
                      </div>
                      <div className="truncate font-semibold text-slate-900">{task.unit.product.name}</div>
                      <div className="text-[11px] text-slate-500">
                        {task.unit.product.brand.name} · {task.assignedTo.name}
                      </div>
                    </div>
                    <Badge variant={statusVariant(task.status)} className="shrink-0 px-1.5 py-0 text-[10px]">
                      {task.status}
                    </Badge>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                    <LevelChip level={task.level} />
                    {task.status === "ON_HOLD" && <HoldIssueChip issue={task.holdIssue} legacyReason={task.holdReason} />}
                    <span>{new Date(task.assignedAt).toLocaleDateString([], { month: "short", day: "numeric" })}</span>
                    {task.totalHoldSeconds > 0 && <span className="text-amber-700">{Math.round(task.totalHoldSeconds / 60)}m hold</span>}
                  </div>
                </li>
              ))}
            </ul>

            {/* Wider screens: the table. */}
            <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-xs sm:block">
              <table className="w-full text-left text-xs text-slate-700">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-[10px] uppercase text-slate-400">
                    <th className="p-3 font-semibold">Unit Code</th>
                    <th className="p-3 font-semibold">Bicycle Model</th>
                    <th className="p-3 font-semibold">Assigned Mechanic</th>
                    <th className="p-3 text-center font-semibold">Condition</th>
                    <th className="p-3 text-center font-semibold">Status</th>
                    <th className="p-3 font-semibold">Assigned On</th>
                    <th className="p-3 text-right font-semibold">Hold / Duration</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map((task) => (
                    <tr key={task.id} className="transition-colors hover:bg-slate-50">
                      <td className="p-3">
                        <div className="font-mono font-bold text-indigo-600">{task.unit.unitCode}</div>
                        <StarChip reservedFor={task.unit.reservedFor} />
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
                        <LevelChip level={task.level} />
                      </td>
                      <td className="p-3 text-center">
                        <Badge variant={statusVariant(task.status)} className="px-1.5 py-0 text-[10px]">
                          {task.status}
                        </Badge>
                        {task.status === "ON_HOLD" && (
                          <div className="mt-1">
                            <HoldIssueChip issue={task.holdIssue} legacyReason={task.holdReason} />
                          </div>
                        )}
                      </td>
                      <td className="whitespace-nowrap p-3 text-[11px] text-slate-500">
                        {new Date(task.assignedAt).toLocaleDateString([], { month: "short", day: "numeric" })}
                      </td>
                      <td className="p-3 text-right text-[11px] text-slate-500">
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
          </>
        )}
      </section>
    </div>
  );
}

/** One held build: unit · product · issue · mechanic · on hold since · note (Q6). */
function HeldBuildRow({
  task,
  mayRaiseVendorIssue,
  onChanged,
}: {
  task: AssemblyTask;
  mayRaiseVendorIssue: boolean;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState(task.holdNote ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function saveNote() {
    setSaving(true);
    setError("");
    const { error: failed, status } = await apiTry(`/api/assembly/tasks/${task.id}/hold-note`, {
      method: "PUT",
      json: { note },
    });
    setSaving(false);
    if (failed) {
      log.error("hold note save failed", { taskId: task.id, status });
      setError(failed);
      return;
    }
    setEditing(false);
    onChanged();
  }

  // "U-000481 · Hero Sprint 29 · Issue with the cycle" — the supervisor adds the rest (Q5).
  const vendorIssueHref = (() => {
    const params = new URLSearchParams({
      description: `${task.unit.unitCode} · ${task.unit.product.name} · ${HOLD_ISSUE_LABEL.CYCLE}`,
    });
    if (task.unit.vendorId) params.set("vendorId", task.unit.vendorId);
    return `/vendor-issues/new?${params.toString()}`;
  })();

  return (
    <li className={`rounded-xl border bg-white p-3 text-xs shadow-xs ${task.holdIssue === "CYCLE" ? "border-red-200" : "border-amber-200"}`}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-mono font-bold text-indigo-600">{task.unit.unitCode}</span>
        <StarChip reservedFor={task.unit.reservedFor} />
        <HoldIssueChip issue={task.holdIssue} legacyReason={task.holdReason} />
      </div>
      <div className="mt-0.5 font-semibold text-slate-900">{task.unit.product.name}</div>
      <div className="mt-0.5 grid grid-cols-1 gap-x-3 text-[11px] text-slate-500 sm:grid-cols-2">
        <span>Mechanic: <strong className="text-slate-700">{task.assignedTo.name}</strong></span>
        <span>On hold since: {heldSince(task.holdStartedAt)}</span>
      </div>

      {editing ? (
        <div className="mt-2 space-y-2">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            rows={2}
            autoFocus
            aria-label={`Note for ${task.unit.unitCode}`}
            placeholder="What was agreed with the mechanic…"
            className="w-full rounded-lg border border-slate-300 bg-white p-2 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          {error && <p className="text-[11px] text-red-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              variant="outline"
              type="button"
              className="min-h-[44px]"
              onClick={() => {
                setEditing(false);
                setNote(task.holdNote ?? "");
                setError("");
              }}
            >
              Cancel
            </Button>
            <Button size="sm" type="button" disabled={saving} onClick={saveNote} className="min-h-[44px] gap-1 bg-indigo-600 text-white hover:bg-indigo-700">
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Save note
            </Button>
          </div>
        </div>
      ) : (
        <>
          {task.holdNote && <p className="mt-1.5 rounded-lg bg-slate-50 p-2 text-slate-700">{task.holdNote}</p>}
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" type="button" onClick={() => setEditing(true)} className="min-h-[44px] gap-1 text-xs">
              <Pencil className="h-3.5 w-3.5" />
              {task.holdNote ? "Edit note" : "Add note"}
            </Button>
            {task.holdIssue === "CYCLE" && mayRaiseVendorIssue && (
              <Link
                href={vendorIssueHref}
                className="inline-flex min-h-[44px] items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-3 text-xs font-semibold text-red-700 hover:bg-red-100"
              >
                <TriangleAlert className="h-3.5 w-3.5" />
                Raise vendor issue
              </Link>
            )}
          </div>
        </>
      )}
    </li>
  );
}
