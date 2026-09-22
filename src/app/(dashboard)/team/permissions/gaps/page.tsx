"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Lock, Search, ShieldAlert } from "lucide-react";
import { Input } from "@/components/ui/input";
import { SkeletonList } from "@/components/ui/skeleton";
import { apiFetch } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";
import { searchModules } from "../_lib/module-search";

const log = createLogger("team:permission-gaps");

interface ModuleRow {
  id: string;
  key: string;
  label: string;
  group: string | null;
  parentId: string | null;
  /** false = admin-only: only the system role may hold it, so it is never a gap for others. */
  assignable: boolean;
  actions: string[];
}
interface RoleRow {
  id: string;
  key: string;
  name: string;
  isSystem: boolean;
  isActive: boolean;
  users: number;
  /** moduleId -> actions held. A module missing here means the role holds nothing on it. */
  cells: Record<string, string[]>;
}

const ACTION_ORDER = ["view", "create", "edit", "delete", "approve", "fetch"];
const byAction = (a: string, b: string) => {
  const ia = ACTION_ORDER.indexOf(a);
  const ib = ACTION_ORDER.indexOf(b);
  return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
};
// One letter per action keeps a cell narrow enough for many role columns on a phone.
const SHORT: Record<string, string> = { view: "V", create: "C", edit: "E", delete: "D", approve: "A", fetch: "F" };
const short = (a: string) => SHORT[a] ?? a.slice(0, 2).toUpperCase();

/**
 * Permission gaps (plan 2109 R10, Q16a, owner 21 Sep 2026): a READ-ONLY modules × roles matrix.
 *
 * Every cell shows which actions a role holds on a module; a role holding nothing on a module is
 * highlighted, and a module no active non-system role holds at all is flagged in its own column —
 * that is the startup check "find each module's missing permissions". Nothing here writes:
 * granting stays in the role editor (/team/permissions), which each role header links to.
 *
 * Roles and modules are rows read from the database (GET /api/roles/permission-gaps, guarded by
 * `roles.view`). No role name is compared anywhere; the system role is recognised by `isSystem`.
 */
export default function PermissionGapsPage() {
  const [modules, setModules] = useState<ModuleRow[]>([]);
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [onlyGaps, setOnlyGaps] = useState(false);
  // Same module search as the role editor (plan 2209-permissions-module-search, Q5a).
  const [moduleSearch, setModuleSearch] = useState("");
  const [showSystem, setShowSystem] = useState(false);

  useEffect(() => {
    apiFetch<{ modules: ModuleRow[]; roles: RoleRow[] }>("/api/roles/permission-gaps")
      .then((res) => {
        setModules(res.modules);
        setRoles(res.roles);
      })
      .catch((e) => {
        log.warn("permission matrix failed to load", { error: e instanceof Error ? e.message : String(e) });
        setError(e instanceof Error ? e.message : "Failed to load the permission matrix");
      })
      .finally(() => setLoading(false));
  }, []);

  // The system role holds everything by construction, so it is hidden unless asked for.
  const visibleRoles = useMemo(() => roles.filter((r) => showSystem || !r.isSystem), [roles, showSystem]);
  // "Held by" counts ACTIVE, non-system roles: an inactive role grants nothing to anyone in
  // practice, and the system role holding a module is not evidence anyone else can use it.
  const workingRoles = useMemo(() => roles.filter((r) => r.isActive && !r.isSystem), [roles]);

  // Roots first, then their children, per group — the order the sidebar and editor use.
  const rows = useMemo(() => {
    const groups: { title: string; items: ModuleRow[] }[] = [];
    for (const m of modules) {
      const title = m.group || "Other";
      let g = groups.find((x) => x.title === title);
      if (!g) groups.push((g = { title, items: [] }));
      g.items.push(m);
    }
    return groups.map((g) => {
      const ordered = g.items
        .filter((m) => !m.parentId)
        .flatMap((root) => [root, ...g.items.filter((c) => c.parentId === root.id)]);
      const seen = new Set(ordered.map((m) => m.id));
      return { title: g.title, items: [...ordered, ...g.items.filter((m) => !seen.has(m.id))] };
    });
  }, [modules]);

  // Which rows the module search shows (Q5a). Rendering only; the counts above ignore it.
  const moduleFilter = searchModules(modules, moduleSearch);

  const heldBy = (m: ModuleRow) => workingRoles.filter((r) => r.cells[m.id]?.length).length;
  const isGap = (m: ModuleRow, r: RoleRow) =>
    m.assignable && !r.isSystem && (r.cells[m.id]?.length ?? 0) < m.actions.length;
  const moduleHasGap = (m: ModuleRow) =>
    m.assignable && (heldBy(m) === 0 || visibleRoles.some((r) => isGap(m, r)));

  const unheld = modules.filter((m) => m.assignable && m.actions.length > 0 && heldBy(m) === 0);

  if (loading) return <SkeletonList />;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Link href="/team/permissions" className="text-slate-400 hover:text-slate-900" aria-label="Back">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="min-w-0">
          <h1 className="text-lg font-bold text-slate-900">Permission gaps</h1>
          <p className="text-xs text-slate-500">
            Read-only. Which actions each role holds on each module. To grant, open the role in the{" "}
            <Link href="/team/permissions" className="underline hover:text-slate-900">
              role editor
            </Link>
            .
          </p>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}

      {!error && (
        <div
          className={`rounded-lg border px-3 py-2 text-xs ${
            unheld.length
              ? "border-amber-200 bg-amber-50 text-amber-800"
              : "border-emerald-200 bg-emerald-50 text-emerald-700"
          }`}
        >
          {unheld.length ? (
            <>
              <strong>
                {unheld.length} module{unheld.length === 1 ? "" : "s"} held by no active role
              </strong>{" "}
              other than the system role: {unheld.map((m) => m.label).join(", ")}.
            </>
          ) : (
            "Every assignable module is held by at least one active role."
          )}
        </div>
      )}

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <Input
          placeholder="Search modules..."
          value={moduleSearch}
          onChange={(e) => setModuleSearch(e.target.value)}
          className="pl-9"
          aria-label="Search modules by name"
        />
      </div>
      {moduleFilter.visible && moduleFilter.matched === 0 && (
        <p className="text-xs text-slate-500">No module matches “{moduleSearch.trim()}”.</p>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-600">
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={onlyGaps} onChange={(e) => setOnlyGaps(e.target.checked)} />
          Only modules with gaps
        </label>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={showSystem} onChange={(e) => setShowSystem(e.target.checked)} />
          Show the system role
        </label>
        <span className="text-slate-400">
          V view · C create · E edit · D delete · A approve · F fetch
        </span>
      </div>

      <div className="flex flex-wrap gap-3 text-[11px] text-slate-500">
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded-sm border border-emerald-300 bg-emerald-50" /> holds every action
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded-sm border border-amber-200 bg-amber-50" /> holds some
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded-sm border border-red-200 bg-red-50" /> holds none
        </span>
        <span className="flex items-center gap-1">
          <Lock className="h-3 w-3" /> admin only
        </span>
      </div>

      {/* The matrix scrolls sideways inside its own box so the page itself never does. */}
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full border-collapse text-xs">
          <thead>
            <tr className="bg-slate-50">
              <th className="sticky left-0 z-10 bg-slate-50 px-2 py-2 text-left font-semibold text-slate-700 min-w-[160px]">
                Module
              </th>
              <th className="px-2 py-2 text-center font-semibold text-slate-700 whitespace-nowrap">Held by</th>
              {visibleRoles.map((r) => (
                <th key={r.id} className="px-2 py-2 text-center font-semibold text-slate-700 whitespace-nowrap">
                  <Link
                    href={`/team/permissions?role=${r.id}`}
                    title={`Open the role editor to grant ${r.name}`}
                    className="hover:underline"
                  >
                    {r.isSystem && <Lock className="mr-0.5 inline h-3 w-3" aria-hidden="true" />}
                    {r.name}
                  </Link>
                  <div className="text-[10px] font-normal text-slate-400">
                    {r.users} user{r.users === 1 ? "" : "s"}
                    {!r.isActive && " · inactive"}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((g) => {
              const items = g.items
                .filter((m) => !moduleFilter.visible || moduleFilter.visible.has(m.id))
                .filter((m) => !onlyGaps || moduleHasGap(m));
              if (items.length === 0) return null;
              return [
                <tr key={`g-${g.title}`}>
                  <td
                    colSpan={visibleRoles.length + 2}
                    className="sticky left-0 bg-white px-2 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400"
                  >
                    {g.title}
                  </td>
                </tr>,
                ...items.map((m) => {
                  const count = heldBy(m);
                  const all = [...m.actions].sort(byAction);
                  return (
                    <tr key={m.id} className="border-t border-slate-100">
                      <td className="sticky left-0 z-10 bg-white px-2 py-1.5 text-slate-800">
                        <span className={m.parentId ? "pl-3" : undefined}>
                          {m.parentId && <span className="mr-1 text-slate-400" aria-hidden="true">&#8627;</span>}
                          {m.label}
                          {moduleFilter.contextOnly.has(m.id) && (
                            <span className="ml-1.5 text-[11px] font-normal text-slate-400">(parent)</span>
                          )}
                        </span>
                        {!m.assignable && <Lock className="ml-1 inline h-3 w-3 text-slate-400" aria-label="admin only" />}
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        {!m.assignable ? (
                          <span className="text-slate-300">—</span>
                        ) : count === 0 ? (
                          <span className="inline-flex items-center gap-0.5 rounded bg-red-100 px-1.5 py-0.5 font-semibold text-red-700">
                            <ShieldAlert className="h-3 w-3" /> none
                          </span>
                        ) : (
                          <span className="tabular-nums text-slate-600">{count}</span>
                        )}
                      </td>
                      {visibleRoles.map((r) => {
                        const held = new Set(r.cells[m.id] ?? []);
                        if (!m.assignable && !r.isSystem) {
                          return (
                            <td key={r.id} className="px-2 py-1.5 text-center text-slate-300" title="Admin only">
                              —
                            </td>
                          );
                        }
                        const tone =
                          held.size === 0
                            ? "border-red-200 bg-red-50 text-red-600"
                            : held.size < all.length
                              ? "border-amber-200 bg-amber-50 text-amber-800"
                              : "border-emerald-300 bg-emerald-50 text-emerald-700";
                        const missing = all.filter((a) => !held.has(a));
                        return (
                          <td key={r.id} className="px-1 py-1 text-center">
                            <span
                              title={
                                held.size === 0
                                  ? `${r.name} holds nothing on ${m.label}`
                                  : missing.length
                                    ? `Missing: ${missing.join(", ")}`
                                    : "Holds every action"
                              }
                              className={`inline-flex min-w-[2.5rem] justify-center gap-0.5 rounded border px-1 py-0.5 font-mono ${tone}`}
                            >
                              {held.size === 0
                                ? "none"
                                : all.map((a) => (
                                    <span key={a} className={held.has(a) ? "font-semibold" : "opacity-30 line-through"}>
                                      {short(a)}
                                    </span>
                                  ))}
                            </span>
                          </td>
                        );
                      })}
                    </tr>
                  );
                }),
              ];
            })}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-slate-400 pb-2">
        {modules.length} modules · {roles.length} roles. &quot;Held by&quot; counts active roles other than the
        system role. A struck-out letter is an action the role does not hold.
      </p>
    </div>
  );
}
