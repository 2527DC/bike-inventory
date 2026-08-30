"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { ArrowLeft, Save, ShieldCheck, Plus, Trash2, Lock, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { SkeletonList } from "@/components/ui/skeleton";
import { usePermissions } from "@/lib/use-permissions";

interface PermissionRow {
  id: string;
  key: string;
  action: string;
  label: string;
}
interface ModuleRow {
  id: string;
  key: string;
  label: string;
  description: string | null;
  group: string | null;
  /** null = a root module. Sub-modules render indented under their parent. */
  parentId: string | null;
  permissions: PermissionRow[];
}
interface RoleRow {
  id: string;
  key: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  isActive: boolean;
  _count: { permissions: number; users: number };
}

const ACTION_ORDER = ["view", "create", "edit", "delete", "approve", "fetch"];

export default function PermissionsPage() {
  const { canEdit, canCreate, canDelete } = usePermissions();

  const [modules, setModules] = useState<ModuleRow[]>([]);
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [selectedRoleId, setSelectedRoleId] = useState<string>("");
  const [roleSearch, setRoleSearch] = useState("");
  const [granted, setGranted] = useState<Set<string>>(new Set());

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const selectedRole = roles.find((r) => r.id === selectedRoleId);
  const readOnly = !canEdit("roles") || selectedRole?.isSystem;

  // Matches name OR key: an admin who knows the role as SERVICE_MANAGER should find it by
  // typing that, not only by its display name. The SELECTED role always stays visible even
  // when it does not match, so the permission grid below never loses its header.
  const q = roleSearch.trim().toLowerCase();
  const visibleRoles = q
    ? roles.filter(
        (r) =>
          r.id === selectedRoleId ||
          r.name.toLowerCase().includes(q) ||
          r.key.toLowerCase().includes(q)
      )
    : roles;

  // Load the catalog and the role list together.
  useEffect(() => {
    Promise.all([
      fetch("/api/modules").then((r) => r.json()),
      fetch("/api/roles").then((r) => r.json()),
    ])
      .then(([m, r]) => {
        if (m.success) setModules(m.data.modules);
        if (r.success) {
          setRoles(r.data.roles);
          const first = r.data.roles.find((x: RoleRow) => !x.isSystem) || r.data.roles[0];
          if (first) setSelectedRoleId(first.id);
        }
      })
      .catch(() => setError("Failed to load roles and modules"))
      .finally(() => setLoading(false));
  }, []);

  // Load the selected role's grants.
  const loadGrants = useCallback((roleId: string) => {
    if (!roleId) return;
    fetch(`/api/roles/${roleId}`)
      .then((r) => r.json())
      .then((res) => {
        if (res.success) setGranted(new Set<string>(res.data.permissionIds));
      })
      .catch(() => setError("Failed to load role permissions"));
  }, []);

  useEffect(() => {
    loadGrants(selectedRoleId);
  }, [selectedRoleId, loadGrants]);

  const toggle = (permissionId: string) => {
    if (readOnly) return;
    setGranted((prev) => {
      const next = new Set(prev);
      if (next.has(permissionId)) next.delete(permissionId);
      else next.add(permissionId);
      return next;
    });
  };

  const toggleModule = (mod: ModuleRow) => {
    if (readOnly) return;
    const ids = mod.permissions.map((p) => p.id);
    const allOn = ids.every((id) => granted.has(id));
    setGranted((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (allOn) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  };

  const handleSave = async () => {
    if (!selectedRoleId) return;
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const res = await fetch(`/api/roles/${selectedRoleId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ permissionIds: [...granted] }),
      }).then((r) => r.json());

      if (!res.success) throw new Error(res.error || "Save failed");
      setSuccess("Permissions saved. Affected users see the change on their next request.");
      const rl = await fetch("/api/roles").then((r) => r.json());
      if (rl.success) setRoles(rl.data.roles);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleCreateRole = async () => {
    const name = window.prompt("Role name (e.g. Store Manager)");
    if (!name?.trim()) return;
    const key = name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_");
    const res = await fetch("/api/roles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, name: name.trim() }),
    }).then((r) => r.json());

    if (!res.success) return setError(res.error || "Could not create role");
    const rl = await fetch("/api/roles").then((r) => r.json());
    if (rl.success) {
      setRoles(rl.data.roles);
      setSelectedRoleId(res.data.id);
    }
  };

  const handleDeleteRole = async () => {
    if (!selectedRole || selectedRole.isSystem) return;
    if (!window.confirm(`Delete the role "${selectedRole.name}"? This cannot be undone.`)) return;

    const res = await fetch(`/api/roles/${selectedRole.id}`, { method: "DELETE" }).then((r) =>
      r.json()
    );
    if (!res.success) return setError(res.error || "Could not delete role");

    const rl = await fetch("/api/roles").then((r) => r.json());
    if (rl.success) {
      setRoles(rl.data.roles);
      setSelectedRoleId(rl.data.roles[0]?.id || "");
    }
  };

  // Order a group's modules as roots-then-their-children, so the grant screen shows the
  // same tree the sidebar does. Deliberately NOT collapsible: the sidebar collapses because
  // it is navigation you scan constantly, while this is a form you fill in once per role —
  // a hidden section here is a checkbox someone cannot find.
  //
  // The trailing append is not defensive padding. A child whose parent sits in a different
  // `group` (the seeder forbids it, but data drifts) would be picked up by neither loop and
  // would VANISH from this screen — a permission that cannot be granted because it does not
  // render. An ugly row beats a missing one.
  function orderTree(items: ModuleRow[]): ModuleRow[] {
    const ordered = items
      .filter((m) => !m.parentId)
      .flatMap((root) => [root, ...items.filter((c) => c.parentId === root.id)]);
    const seen = new Set(ordered.map((m) => m.id));
    return [...ordered, ...items.filter((m) => !seen.has(m.id))];
  }

  // Group modules for display.
  const groups: { title: string; items: ModuleRow[] }[] = [];
  for (const m of modules) {
    const title = m.group || "Other";
    let g = groups.find((x) => x.title === title);
    if (!g) groups.push((g = { title, items: [] }));
    g.items.push(m);
  }

  if (loading) return <SkeletonList />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link href="/team" className="text-slate-400 hover:text-slate-900">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <h1 className="text-lg font-bold text-slate-900">Roles & Permissions</h1>
            <p className="text-xs text-slate-500">
              A role holds permissions; a user holds one role.
            </p>
          </div>
        </div>
        {canCreate("roles") && (
          <Button variant="outline" onClick={handleCreateRole}>
            <Plus className="h-4 w-4 mr-1" /> New role
          </Button>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}
      {success && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {success}
        </div>
      )}

      {/* Role picker. Filtering is CLIENT-SIDE on purpose: every role already arrives in
          the one /api/roles request, so a round trip per keystroke would be slower, not
          faster, and would make the pill row flicker while typing. */}
      {roles.length > 4 && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input
            placeholder="Search roles..."
            value={roleSearch}
            onChange={(e) => setRoleSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      )}

      <div className="flex gap-2 overflow-x-auto pb-1">
        {visibleRoles.length === 0 && (
          <p className="text-xs text-slate-500 py-2">No role matches “{roleSearch}”.</p>
        )}
        {visibleRoles.map((r) => (
          <button
            key={r.id}
            onClick={() => setSelectedRoleId(r.id)}
            className={`shrink-0 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
              r.id === selectedRoleId
                ? "border-slate-900 bg-slate-900 text-white"
                : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
            }`}
          >
            <span className="flex items-center gap-1.5">
              {r.isSystem && <Lock className="h-3 w-3" />}
              {r.name}
              <span className="text-[10px] opacity-70">({r._count.users})</span>
            </span>
          </button>
        ))}
      </div>

      {selectedRole?.isSystem && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <strong>{selectedRole.name}</strong> is a system role. It always holds every permission
          and cannot be edited or deleted — this is what guarantees you can never lock yourself
          out of this screen.
        </div>
      )}

      {/* Permission grid */}
      {groups.map((group) => (
        <div key={group.title} className="space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 px-1">
            {group.title}
          </p>
          {orderTree(group.items).map((mod) => {
            const ids = mod.permissions.map((p) => p.id);
            const allOn = ids.length > 0 && ids.every((id) => granted.has(id));
            const sorted = [...mod.permissions].sort(
              (a, b) => ACTION_ORDER.indexOf(a.action) - ACTION_ORDER.indexOf(b.action)
            );

            return (
              <Card key={mod.id} className={mod.parentId ? "ml-4" : undefined}>
                <CardContent className="p-3">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900">
                        {mod.parentId && (
                          <span className="text-slate-400 mr-1" aria-hidden="true">
                            &#8627;
                          </span>
                        )}
                        {mod.label}
                      </p>
                      {mod.description && (
                        <p className="text-[11px] text-slate-500">{mod.description}</p>
                      )}
                    </div>
                    {/* Scoped to THIS module only — it must never cascade a parent's ticks
                        onto its children. A grant is one row per module × action; a
                        cascading control would silently write grants nobody chose. */}
                    <button
                      onClick={() => toggleModule(mod)}
                      disabled={readOnly}
                      className="shrink-0 text-[11px] font-medium text-slate-500 hover:text-slate-900 disabled:opacity-40"
                    >
                      {allOn ? "Clear all" : "Select all"}
                    </button>
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    {sorted.map((p) => {
                      const on = granted.has(p.id);
                      return (
                        <button
                          key={p.id}
                          onClick={() => toggle(p.id)}
                          disabled={readOnly}
                          title={p.key}
                          className={`rounded-md border px-2.5 py-1 text-xs font-medium capitalize transition-colors disabled:opacity-50 ${
                            on
                              ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                              : "border-slate-200 bg-white text-slate-400 hover:border-slate-300"
                          }`}
                        >
                          {p.action}
                        </button>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ))}

      {/* Actions */}
      <div className="sticky bottom-16 lg:bottom-4 flex gap-2 pt-2">
        <Button onClick={handleSave} disabled={saving || readOnly} className="flex-1">
          <Save className="h-4 w-4 mr-1" />
          {saving ? "Saving..." : `Save ${selectedRole?.name || ""}`}
        </Button>
        {canDelete("roles") && selectedRole && !selectedRole.isSystem && (
          <Button variant="outline" onClick={handleDeleteRole}>
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>

      <p className="flex items-center gap-1.5 text-[11px] text-slate-400 pb-2">
        <ShieldCheck className="h-3 w-3" />
        {granted.size} permission{granted.size === 1 ? "" : "s"} granted across {modules.length}{" "}
        modules.
      </p>
    </div>
  );
}
