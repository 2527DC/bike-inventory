"use client";

import { use, useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Save, ShieldAlert, ShieldCheck, Trash2, ArrowUp, ArrowDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { SkeletonList } from "@/components/ui/skeleton";
import { usePermissions } from "@/lib/use-permissions";
import { usePermissionStore } from "@/stores/permissions";
import { SiteSelect } from "@/components/site-select";
import { apiTry, apiFetch } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";

const log = createLogger("team:detail");

interface GrantedModule {
  key: string;
  label: string;
  route: string | null;
}

interface UserDetail {
  id: string;
  name: string;
  email: string;
  roleId: string;
  role: { id: string; key: string; name: string } | null;
  accessCode?: string;
  storeId: string | null;
  warehouseId: string | null;
  store: { id: string; code: string; name: string } | null;
  warehouse: { id: string; code: string; name: string; storeId: string } | null;
  navTabs?: string[];
  grantedModules?: GrantedModule[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  _count: { transactions: number; stockCounts: number };
}

interface RoleOption {
  id: string;
  key: string;
  name: string;
  description: string | null;
  isActive: boolean;
  _count: { permissions: number; users: number };
}

const MAX_NAV_TABS = 4;

export default function EditTeamMemberPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();

  const { canEdit, canDelete } = usePermissions();
  const currentUserId = usePermissionStore((s) => s.user?.id);
  const mayEdit = canEdit("team");

  const [user, setUser] = useState<UserDetail | null>(null);
  const [roles, setRoles] = useState<RoleOption[]>([]);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [roleId, setRoleId] = useState("");
  const [accessCode, setAccessCode] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [navTabs, setNavTabs] = useState<string[]>([]);
  const [storeId, setStoreId] = useState<string | null>(null);
  const [warehouseId, setWarehouseId] = useState<string | null>(null);
  const [grantedModules, setGrantedModules] = useState<GrantedModule[]>([]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    (async () => {
      // apiTry, not fetch().then(r => r.json()) — an expired session returns HTML with status
      // 200, so res.ok does not catch it and the raw parse throws "Unexpected token '<'".
      // The previous version also swallowed the reason in a catch that set a generic string.
      const [u, rl] = await Promise.all([
        apiTry<UserDetail>(`/api/users/${id}`),
        apiTry<{ roles: RoleOption[] }>("/api/roles"),
      ]);

      if (u.error) {
        log.error("could not load member", { userId: id, message: u.error });
        setError(u.error);
      } else if (u.data) {
        const d = u.data;
        setUser(d);
        setName(d.name);
        setEmail(d.email);
        setRoleId(d.roleId);
        setAccessCode(d.accessCode || "");
        setIsActive(d.isActive);
        setNavTabs(Array.isArray(d.navTabs) ? d.navTabs : []);
        setGrantedModules(d.grantedModules || []);
        setStoreId(d.storeId ?? null);
        setWarehouseId(d.warehouseId ?? null);
      }

      if (rl.error) {
        log.error("could not load roles", { message: rl.error });
        setError((prev) => prev || rl.error!);
      } else {
        setRoles((rl.data?.roles ?? []).filter((r) => r.isActive));
      }

      setLoading(false);
    })();
  }, [id]);

  const selectedRole = roles.find((r) => r.id === roleId);

  async function handleSave() {
    if (!mayEdit) return;
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      // storeId/warehouseId are sent explicitly, including as null. The API treats null as
      // "clear it" and undefined as "leave alone", so omitting them would make an assignment
      // impossible to remove from this screen.
      await apiFetch(`/api/users/${id}`, {
        method: "PUT",
        json: { name, email, roleId, accessCode, isActive, navTabs, storeId, warehouseId },
      });

      log.info("member saved", { userId: id, roleId, hasStore: Boolean(storeId) });
      setSuccess("Saved. The change applies on their next request — no re-login needed.");

      // Their granted modules may have changed with the role, so refresh the picker source.
      const { data: fresh } = await apiTry<UserDetail>(`/api/users/${id}`);
      if (fresh) setGrantedModules(fresh.grantedModules || []);
      setTimeout(() => setSuccess(""), 4000);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to save";
      log.error("save member failed", { userId: id, message: msg });
      setError(msg);
    } finally {
      setSaving(false);
    }
  }

  // Nav-tab candidates are the modules this person's ROLE actually grants — so an admin cannot
  // pin a tab the user would be denied on arrival.
  const navCandidates = grantedModules.filter((m) => m.route && m.route !== "/");
  const moduleByRoute = (route: string) => navCandidates.find((m) => m.route === route);
  const availableNav = navCandidates.filter((m) => !navTabs.includes(m.route!));

  function addNavTab(route: string) {
    if (navTabs.includes(route) || navTabs.length >= MAX_NAV_TABS) return;
    setNavTabs([...navTabs, route]);
  }
  function removeNavTab(route: string) {
    setNavTabs(navTabs.filter((h) => h !== route));
  }
  function moveNavTab(index: number, dir: -1 | 1) {
    const j = index + dir;
    if (j < 0 || j >= navTabs.length) return;
    const next = [...navTabs];
    [next[index], next[j]] = [next[j], next[index]];
    setNavTabs(next);
  }

  if (loading) return <SkeletonList count={5} type="card" />;

  if (!user) {
    return (
      <div className="text-center py-12">
        <ShieldAlert className="h-12 w-12 text-slate-300 mx-auto mb-3" />
        <p className="text-sm text-slate-500">User not found</p>
        <Link href="/team" className="text-sm text-blue-600 mt-2 inline-block">
          Back to Team
        </Link>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <Link
          href="/team"
          aria-label="Back"
          className="p-2 -ml-2 rounded-lg hover:bg-slate-100 focus-ring"
        >
          <ArrowLeft className="h-5 w-5 text-slate-600" />
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-bold text-slate-900 truncate">{user.name}</h1>
          <p className="text-xs text-slate-500 truncate">{user.email}</p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Badge variant="info">{user.role?.name || "No role"}</Badge>
          {!user.isActive && <Badge variant="danger">Inactive</Badge>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="bg-slate-50 rounded-lg p-3 text-center">
          <p className="text-lg font-bold text-slate-900 tabular-nums">
            {user._count.transactions}
          </p>
          <p className="text-[11px] text-slate-500">Transactions</p>
        </div>
        <div className="bg-slate-50 rounded-lg p-3 text-center">
          <p className="text-lg font-bold text-slate-900 tabular-nums">
            {user._count.stockCounts}
          </p>
          <p className="text-[11px] text-slate-500">Stock Audits</p>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}
      {success && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-3 mb-4">
          <p className="text-sm text-green-700">{success}</p>
        </div>
      )}

      {mayEdit ? (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Role</label>
            <select
              value={roleId}
              onChange={(e) => setRoleId(e.target.value)}
              className="flex h-10 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
            >
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
            {selectedRole && (
              <p className="mt-1.5 flex items-start gap-1.5 text-xs text-slate-500">
                <ShieldCheck className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span>
                  {selectedRole.description || "No description."}{" "}
                  <strong className="text-slate-700">
                    {selectedRole._count.permissions} permissions
                  </strong>
                  .{" "}
                  <Link href="/team/permissions" className="underline hover:text-slate-900">
                    Edit this role
                  </Link>
                </span>
              </p>
            )}
          </div>

          <SiteSelect
            storeId={storeId}
            warehouseId={warehouseId}
            onChange={({ storeId: st, warehouseId: wh }) => {
              setStoreId(st);
              setWarehouseId(wh);
            }}
            disabled={!mayEdit || saving}
          />

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Access Code</label>
            <Input
              value={accessCode}
              onChange={(e) => setAccessCode(e.target.value.toUpperCase())}
              className="font-mono uppercase"
            />
          </div>

          <div className="flex items-center justify-between py-2">
            <span className="text-sm font-medium text-slate-700">Active</span>
            <button
              type="button"
              onClick={() => setIsActive(!isActive)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                isActive ? "bg-green-500" : "bg-slate-300"
              }`}
            >
              <span
                className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
                  isActive ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </button>
          </div>

          {/* Bottom navigation pinning */}
          <div className="border-t border-slate-100 pt-4">
            <p className="text-sm font-semibold text-slate-800 mb-1">Bottom Navigation</p>
            <p className="text-[11px] text-slate-500 mb-3">
              Pin up to {MAX_NAV_TABS} tabs (Home and More always show). Only modules this
              person&apos;s role grants are listed. Leave empty to use their highest-priority
              modules automatically.
            </p>

            <div className="flex items-center gap-1 flex-wrap mb-3 bg-slate-50 rounded-lg p-2">
              <Badge variant="default" className="text-[11px]">Home</Badge>
              {navTabs.map((route) => (
                <Badge key={route} variant="info" className="text-[11px]">
                  {moduleByRoute(route)?.label || route}
                </Badge>
              ))}
              <Badge variant="default" className="text-[11px]">More</Badge>
            </div>

            {navTabs.length > 0 && (
              <div className="space-y-1 mb-3">
                {navTabs.map((route, i) => {
                  const permitted = !!moduleByRoute(route);
                  return (
                    <div
                      key={route}
                      className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg p-2"
                    >
                      <span className="text-[11px] text-slate-400 w-4 tabular-nums">{i + 1}</span>
                      <span className="flex-1 text-sm text-slate-800">
                        {moduleByRoute(route)?.label || route}
                        {!permitted && (
                          <span className="text-[11px] text-red-500 ml-1">
                            (role no longer grants this — won&apos;t show)
                          </span>
                        )}
                      </span>
                      <button
                        type="button"
                        onClick={() => moveNavTab(i, -1)}
                        disabled={i === 0}
                        className="p-1 rounded text-slate-400 hover:text-slate-700 disabled:opacity-30"
                      >
                        <ArrowUp className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveNavTab(i, 1)}
                        disabled={i === navTabs.length - 1}
                        className="p-1 rounded text-slate-400 hover:text-slate-700 disabled:opacity-30"
                      >
                        <ArrowDown className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => removeNavTab(route)}
                        className="p-1 rounded text-red-400 hover:text-red-600"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="flex flex-wrap gap-1.5">
              {availableNav.length === 0 ? (
                <p className="text-[11px] text-slate-400">
                  {navTabs.length >= MAX_NAV_TABS
                    ? `Maximum ${MAX_NAV_TABS} tabs selected.`
                    : "No more granted modules to add."}
                </p>
              ) : (
                availableNav.map((m) => (
                  <button
                    key={m.key}
                    type="button"
                    onClick={() => addNavTab(m.route!)}
                    disabled={navTabs.length >= MAX_NAV_TABS}
                    className="text-xs font-medium px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                  >
                    + {m.label}
                  </button>
                ))
              )}
            </div>
          </div>

          <Button
            onClick={handleSave}
            size="lg"
            disabled={saving}
            className="w-full min-h-[48px] rounded-lg font-medium bg-green-600 hover:bg-green-700 text-white"
          >
            <Save className="h-4 w-4 mr-2" />
            {saving ? "Saving..." : "Save Changes"}
          </Button>

          {canDelete("team") && currentUserId !== id && (
            <Button
              variant="outline"
              size="lg"
              disabled={deleting}
              className="w-full min-h-[48px] rounded-lg font-medium border-red-300 text-red-600 hover:bg-red-50"
              onClick={async () => {
                if (!confirm(`Remove ${user.name} from the team?`)) return;
                setDeleting(true);
                setError("");
                try {
                  const res = await fetch(`/api/users/${id}`, { method: "DELETE" }).then((r) =>
                    r.json()
                  );
                  if (res.success) {
                    const d = res.data;
                    setSuccess(d.message);
                    if (d.deleted) setTimeout(() => router.push("/team"), 1500);
                    else if (d.deactivated) {
                      setIsActive(false);
                      setUser((prev) => (prev ? { ...prev, isActive: false } : prev));
                    }
                  } else {
                    setError(res.error || "Failed to remove");
                  }
                } catch {
                  setError("Network error");
                } finally {
                  setDeleting(false);
                }
              }}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              {deleting ? "Removing..." : "Remove from Team"}
            </Button>
          )}

          <p className="text-xs text-slate-400 text-center">
            Member since{" "}
            <span className="tabular-nums">
              {new Date(user.createdAt).toLocaleDateString("en-IN")}
            </span>
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="bg-slate-50 rounded-lg p-3">
            <p className="text-xs text-slate-500">Role</p>
            <p className="text-sm font-medium text-slate-900">{user.role?.name || "—"}</p>
          </div>
          <div className="bg-slate-50 rounded-lg p-3">
            <p className="text-xs text-slate-500">Member Since</p>
            <p className="text-sm font-medium text-slate-900 tabular-nums">
              {new Date(user.createdAt).toLocaleDateString("en-IN")}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
