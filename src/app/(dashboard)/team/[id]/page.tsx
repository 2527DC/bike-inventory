"use client";

import { use, useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Save, ShieldAlert, Trash2, Eye, Plus, Pencil, ShieldCheck, CloudDownload, ArrowUp, ArrowDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { SkeletonList } from "@/components/ui/skeleton";
import { FEATURE_NAV_ITEMS, NAV_FEATURE_MAP } from "@/lib/nav-config";

interface UserDetail {
  id: string;
  name: string;
  email: string;
  role: string;
  customRoleName: string | null;
  permissions: Record<string, Perm> | null;
  navTabs?: string[];
  effectivePermissions?: Record<string, Perm>;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  _count: { transactions: number; stockCounts: number };
}

type Perm = { view: boolean; create: boolean; edit: boolean; delete: boolean; approve: boolean; fetch: boolean };
const MAX_NAV_TABS = 4;
const emptyPerm = (): Perm => ({ view: false, create: false, edit: false, delete: false, approve: false, fetch: false });

const APP_FEATURES = [
  { key: "dashboard", label: "Dashboard", hasApprove: false, hasCreate: false, hasFetch: false },
  { key: "inbound", label: "Inbound", hasApprove: true, hasCreate: true, hasFetch: true },
  { key: "deliveries", label: "Deliveries", hasApprove: true, hasCreate: true, hasFetch: true },
  { key: "stock", label: "Stock", hasApprove: false, hasCreate: false, hasFetch: true },
  { key: "stock_audit", label: "Stock Audit", hasApprove: true, hasCreate: true, hasFetch: false },
  { key: "transfers", label: "Transfers", hasApprove: true, hasCreate: true, hasFetch: false },
  { key: "vendors", label: "Vendors", hasApprove: false, hasCreate: true, hasFetch: true },
  { key: "bills", label: "Bills", hasApprove: true, hasCreate: true, hasFetch: true },
  { key: "purchase_orders", label: "POs", hasApprove: true, hasCreate: true, hasFetch: false },
  { key: "expenses", label: "Expenses", hasApprove: true, hasCreate: true, hasFetch: false },
  { key: "reports", label: "Reports", hasApprove: false, hasCreate: false, hasFetch: false },
  { key: "team", label: "Team", hasApprove: false, hasCreate: false, hasFetch: false },
  { key: "barcode", label: "Barcode", hasApprove: false, hasCreate: false, hasFetch: false },
  { key: "zoho", label: "Zoho Sync", hasApprove: false, hasCreate: false, hasFetch: true },
  { key: "customers", label: "Customers", hasApprove: false, hasCreate: true, hasFetch: false },
  { key: "vendor_issues", label: "Vendor Issues", hasApprove: false, hasCreate: true, hasFetch: false },
];

const ROLES = [
  { value: "CEO", label: "CEO" },
  { value: "ADMIN", label: "Admin" },
  { value: "SUPERVISOR", label: "Supervisor" },
  { value: "PURCHASE_MANAGER", label: "Purchase Manager" },
  { value: "ACCOUNTS_MANAGER", label: "Accounts Manager" },
  { value: "INWARDS_EXECUTIVE", label: "Inwards Executive" },
  { value: "OUTWARDS_EXECUTIVE", label: "Outwards Executive" },
  { value: "STORE_MANAGER", label: "Store Manager" },
  { value: "SALES_MANAGER", label: "Sales Manager" },
  { value: "SERVICE_MANAGER", label: "Service Manager" },
  { value: "CUSTOM", label: "Custom Role" },
];

const ROLE_PERMISSIONS: Record<string, string[]> = {
  CEO: ["Full access to all features", "Team performance", "P&L review", "Approve bills", "All reports"],
  ADMIN: ["Full access to all features", "Manage team & roles", "Zoho sync", "Reports", "Vendors & POs", "Bills & Payments", "Expenses", "AI Insights", "Bin management", "Settings"],
  SUPERVISOR: ["View all data", "Manage stock", "Team view", "Reports", "Bills & Payments", "Expenses", "Approve stock counts & transfers"],
  PURCHASE_MANAGER: ["Reorder dashboard", "Purchase Orders", "Vendors", "Stock view", "Barcode Scanner", "Brand Stock Upload"],
  ACCOUNTS_MANAGER: ["Expenses", "Accounts", "Bills & Payments", "Record Payments", "Receivables", "Stock Audit (view)"],
  INWARDS_EXECUTIVE: ["Inbound receiving & putaway", "Stock Count (brand count)", "Stock view", "Deliveries", "Transfers", "Barcode Scanner"],
  OUTWARDS_EXECUTIVE: ["Deliveries & dispatch", "Stock view", "Inbound view", "Barcode Scanner"],
  STORE_MANAGER: ["Deliveries", "Stock view", "Vendors", "Accounts", "Team view", "Reports"],
  SALES_MANAGER: ["Deliveries", "Stock view", "Customers", "Reports"],
  SERVICE_MANAGER: ["Stock view", "Vendor Issues", "Stock Audit", "Reports"],
};

export default function EditTeamMemberPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: session } = useSession();
  const currentUser = session?.user as { role?: string; userId?: string } | undefined;
  const isAdmin = currentUser?.role === "ADMIN" || currentUser?.role === "CEO";
  const router = useRouter();

  const [user, setUser] = useState<UserDetail | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("");
  const [accessCode, setAccessCode] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [customRoleName, setCustomRoleName] = useState("");
  const [permissions, setPermissions] = useState<Record<string, Perm>>(
    Object.fromEntries(APP_FEATURES.map((f) => [f.key, emptyPerm()]))
  );
  const [navTabs, setNavTabs] = useState<string[]>([]);
  const [effectivePerms, setEffectivePerms] = useState<Record<string, Perm>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    fetch(`/api/users/${id}`)
      .then((r) => r.json())
      .then((res) => {
        if (res.success) {
          const u = res.data;
          setUser(u);
          setName(u.name);
          setEmail(u.email);
          setRole(u.role);
          setAccessCode(u.accessCode || "");
          setIsActive(u.isActive);
          setCustomRoleName(u.customRoleName || "");
          if (u.permissions) setPermissions(u.permissions);
          setNavTabs(Array.isArray(u.navTabs) ? u.navTabs : []);
          setEffectivePerms(u.effectivePermissions || {});
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  async function handleSave() {
    if (!isAdmin) return;
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const body: Record<string, unknown> = { name, email, role, accessCode, isActive, navTabs };
      if (role === "CUSTOM") {
        body.customRoleName = customRoleName;
        body.permissions = permissions;
      }

      const res = await fetch(`/api/users/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.success) {
        setSuccess("Saved successfully");
        // saved
        setTimeout(() => setSuccess(""), 3000);
      } else {
        setError(data.error || "Failed to save");
      }
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  }

  // Which features this employee may VIEW (and thus can appear in their bottom nav). For a CUSTOM
  // role we read the permissions being edited live; for built-in roles we use the server-computed
  // effective permissions. Admin/CEO see everything.
  function canViewFeature(featureKey?: string): boolean {
    if (!featureKey) return true;
    if (role === "ADMIN" || role === "CEO") return true;
    if (role === "CUSTOM") return !!permissions[featureKey]?.view;
    return !!effectivePerms[featureKey]?.view;
  }
  const navCandidates = FEATURE_NAV_ITEMS.filter((f) => canViewFeature(NAV_FEATURE_MAP[f.href]));
  const navItemByHref = (href: string) => FEATURE_NAV_ITEMS.find((f) => f.href === href);
  const availableNav = navCandidates.filter((f) => !navTabs.includes(f.href));

  function addNavTab(href: string) {
    if (navTabs.includes(href) || navTabs.length >= MAX_NAV_TABS) return;
    setNavTabs([...navTabs, href]);
  }
  function removeNavTab(href: string) {
    setNavTabs(navTabs.filter((h) => h !== href));
  }
  function moveNavTab(index: number, dir: -1 | 1) {
    const j = index + dir;
    if (j < 0 || j >= navTabs.length) return;
    const next = [...navTabs];
    [next[index], next[j]] = [next[j], next[index]];
    setNavTabs(next);
  }

  if (loading) {
    return (
      <div className="space-y-3">
        <SkeletonList count={5} type="card" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="text-center py-12">
        <ShieldAlert className="h-12 w-12 text-slate-300 mx-auto mb-3" />
        <p className="text-sm text-slate-500">User not found</p>
        <Link href="/team" className="text-sm text-blue-600 mt-2 inline-block">Back to Team</Link>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <Link href="/team" aria-label="Back" className="p-2 -ml-2 rounded-lg hover:bg-slate-100 focus-ring"><ArrowLeft className="h-5 w-5 text-slate-600" /></Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-bold text-slate-900 truncate">{user.name}</h1>
          <p className="text-xs text-slate-500 truncate">{user.email}</p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Badge variant="info">{ROLES.find(r => r.value === user.role)?.label || user.role}</Badge>
          {!user.isActive && <Badge variant="danger">Inactive</Badge>}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="bg-slate-50 rounded-lg p-3 text-center">
          <p className="text-lg font-bold text-slate-900 tabular-nums">{user._count.transactions}</p>
          <p className="text-[11px] text-slate-500">Transactions</p>
        </div>
        <div className="bg-slate-50 rounded-lg p-3 text-center">
          <p className="text-lg font-bold text-slate-900 tabular-nums">{user._count.stockCounts}</p>
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

      {isAdmin ? (
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
            <select value={role} onChange={(e) => setRole(e.target.value)}
              className="flex h-10 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900">
              {ROLES.map((r) => (<option key={r.value} value={r.value}>{r.label}</option>))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Access Code</label>
            <Input value={accessCode} onChange={(e) => setAccessCode(e.target.value.toUpperCase())} className="font-mono uppercase" />
          </div>

          <div className="flex items-center justify-between py-2">
            <span className="text-sm font-medium text-slate-700">Active</span>
            <button type="button" onClick={() => setIsActive(!isActive)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${isActive ? "bg-green-500" : "bg-slate-300"}`}>
              <span className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${isActive ? "translate-x-6" : "translate-x-1"}`} />
            </button>
          </div>

          {/* Custom Role Builder */}
          {role === "CUSTOM" && (
            <>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Role Name</label>
                <Input value={customRoleName} onChange={(e) => setCustomRoleName(e.target.value)}
                  placeholder="e.g. Store Helper, Mechanic" />
              </div>
              <div>
                <p className="text-xs font-semibold text-slate-700 mb-2">Permissions</p>
                <div className="flex items-center gap-2 mb-2 px-1 overflow-x-auto">
                  <span className="flex items-center gap-0.5 text-[11px] text-slate-500 shrink-0"><Eye className="h-2.5 w-2.5" />View</span>
                  <span className="flex items-center gap-0.5 text-[11px] text-slate-500 shrink-0"><Plus className="h-2.5 w-2.5" />Add</span>
                  <span className="flex items-center gap-0.5 text-[11px] text-slate-500 shrink-0"><Pencil className="h-2.5 w-2.5" />Edit</span>
                  <span className="flex items-center gap-0.5 text-[11px] text-slate-500 shrink-0"><Trash2 className="h-2.5 w-2.5" />Del</span>
                  <span className="flex items-center gap-0.5 text-[11px] text-slate-500 shrink-0"><ShieldCheck className="h-2.5 w-2.5" />Appr</span>
                  <span className="flex items-center gap-0.5 text-[11px] text-slate-500 shrink-0"><CloudDownload className="h-2.5 w-2.5" />Fetch</span>
                </div>
                <div className="space-y-1">
                  {APP_FEATURES.map((f) => {
                    const p = permissions[f.key] || emptyPerm();
                    return (
                      <div key={f.key} className="flex items-center justify-between bg-white border border-slate-100 rounded-lg p-2">
                        <p className="text-[11px] font-medium text-slate-800 flex-1 min-w-0 mr-1">{f.label}</p>
                        <div className="flex items-center gap-0.5 shrink-0">
                          <button type="button" onClick={() => setPermissions(prev => ({ ...prev, [f.key]: { ...prev[f.key], view: !p.view } }))}
                            className={`p-1 rounded ${p.view ? "bg-blue-100 text-blue-700" : "bg-slate-50 text-slate-300"}`}><Eye className="h-3 w-3" /></button>
                          {f.hasCreate ? (
                            <button type="button" onClick={() => setPermissions(prev => ({ ...prev, [f.key]: { ...prev[f.key], create: !p.create } }))}
                              className={`p-1 rounded ${p.create ? "bg-purple-100 text-purple-700" : "bg-slate-50 text-slate-300"}`}><Plus className="h-3 w-3" /></button>
                          ) : <div className="p-1 w-[20px]" />}
                          <button type="button" onClick={() => setPermissions(prev => ({ ...prev, [f.key]: { ...prev[f.key], edit: !p.edit } }))}
                            className={`p-1 rounded ${p.edit ? "bg-amber-100 text-amber-700" : "bg-slate-50 text-slate-300"}`}><Pencil className="h-3 w-3" /></button>
                          <button type="button" onClick={() => setPermissions(prev => ({ ...prev, [f.key]: { ...prev[f.key], delete: !p.delete } }))}
                            className={`p-1 rounded ${p.delete ? "bg-red-100 text-red-700" : "bg-slate-50 text-slate-300"}`}><Trash2 className="h-3 w-3" /></button>
                          {f.hasApprove ? (
                            <button type="button" onClick={() => setPermissions(prev => ({ ...prev, [f.key]: { ...prev[f.key], approve: !p.approve } }))}
                              className={`p-1 rounded ${p.approve ? "bg-green-100 text-green-700" : "bg-slate-50 text-slate-300"}`}><ShieldCheck className="h-3 w-3" /></button>
                          ) : <div className="p-1 w-[20px]" />}
                          {f.hasFetch ? (
                            <button type="button" onClick={() => setPermissions(prev => ({ ...prev, [f.key]: { ...prev[f.key], fetch: !p.fetch } }))}
                              className={`p-1 rounded ${p.fetch ? "bg-cyan-100 text-cyan-700" : "bg-slate-50 text-slate-300"}`}><CloudDownload className="h-3 w-3" /></button>
                          ) : <div className="p-1 w-[20px]" />}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}

          {/* Role Permissions Summary (for non-custom roles) */}
          {role !== "CUSTOM" && role && ROLE_PERMISSIONS[role] && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
              <p className="text-xs font-semibold text-blue-800 mb-1.5">Permissions for {ROLES.find(r => r.value === role)?.label}</p>
              <ul className="space-y-0.5">
                {ROLE_PERMISSIONS[role].map((perm) => (
                  <li key={perm} className="text-xs text-blue-700 flex items-center gap-1.5">
                    <span className="h-1 w-1 rounded-full bg-blue-400 shrink-0" />
                    {perm}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Bottom Navigation control — admin picks which tabs show in this person's bottom bar */}
          <div className="border-t border-slate-100 pt-4">
            <p className="text-sm font-semibold text-slate-800 mb-1">Bottom Navigation</p>
            <p className="text-[11px] text-slate-500 mb-3">
              Choose up to {MAX_NAV_TABS} tabs (Home and More are always shown). Only features this
              person can access are listed. Leave empty to use the role default.
            </p>

            {/* Live preview */}
            <div className="flex items-center gap-1 flex-wrap mb-3 bg-slate-50 rounded-lg p-2">
              <Badge variant="default" className="text-[11px]">Home</Badge>
              {navTabs.map((href) => {
                const it = navItemByHref(href);
                return <Badge key={href} variant="info" className="text-[11px]">{it?.label || href}</Badge>;
              })}
              <Badge variant="default" className="text-[11px]">More</Badge>
            </div>

            {/* Selected, ordered */}
            {navTabs.length > 0 && (
              <div className="space-y-1 mb-3">
                {navTabs.map((href, i) => {
                  const it = navItemByHref(href);
                  const permitted = canViewFeature(NAV_FEATURE_MAP[href]);
                  return (
                    <div key={href} className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg p-2">
                      <span className="text-[11px] text-slate-400 w-4 tabular-nums">{i + 1}</span>
                      <span className="flex-1 text-sm text-slate-800">
                        {it?.label || href}
                        {!permitted && <span className="text-[11px] text-red-500 ml-1">(no access — won&apos;t show)</span>}
                      </span>
                      <button type="button" onClick={() => moveNavTab(i, -1)} disabled={i === 0}
                        className="p-1 rounded text-slate-400 hover:text-slate-700 disabled:opacity-30"><ArrowUp className="h-3.5 w-3.5" /></button>
                      <button type="button" onClick={() => moveNavTab(i, 1)} disabled={i === navTabs.length - 1}
                        className="p-1 rounded text-slate-400 hover:text-slate-700 disabled:opacity-30"><ArrowDown className="h-3.5 w-3.5" /></button>
                      <button type="button" onClick={() => removeNavTab(href)}
                        className="p-1 rounded text-red-400 hover:text-red-600"><X className="h-3.5 w-3.5" /></button>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Available to add */}
            <div className="flex flex-wrap gap-1.5">
              {availableNav.length === 0 ? (
                <p className="text-[11px] text-slate-400">
                  {navTabs.length >= MAX_NAV_TABS ? `Maximum ${MAX_NAV_TABS} tabs selected.` : "No more accessible features to add."}
                </p>
              ) : (
                availableNav.map((f) => (
                  <button key={f.href} type="button" onClick={() => addNavTab(f.href)}
                    disabled={navTabs.length >= MAX_NAV_TABS}
                    className="text-xs font-medium px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40">
                    + {f.label}
                  </button>
                ))
              )}
            </div>
          </div>

          <Button onClick={handleSave} size="lg" disabled={saving} className="w-full min-h-[48px] rounded-lg font-medium bg-green-600 hover:bg-green-700 text-white">
            <Save className="h-4 w-4 mr-2" />{saving ? "Saving..." : "Save Changes"}
          </Button>

          {/* Delete / Remove user */}
          {currentUser?.userId !== id && (
            <Button variant="outline" size="lg" disabled={deleting}
              className="w-full min-h-[48px] rounded-lg font-medium border-red-300 text-red-600 hover:bg-red-50"
              onClick={async () => {
                if (!confirm(`Remove ${user.name} from the team?`)) return;
                setDeleting(true);
                setError("");
                try {
                  const res = await fetch(`/api/users/${id}`, { method: "DELETE" }).then(r => r.json());
                  if (res.success) {
                    const d = res.data;
                    if (d.deleted) {
                      setSuccess(d.message);
                      setTimeout(() => router.push("/team"), 1500);
                    } else if (d.deactivated) {
                      setSuccess(d.message);
                      setIsActive(false);
                      setUser((prev) => prev ? { ...prev, isActive: false } : prev);
                    }
                  } else {
                    setError(res.error || "Failed to remove");
                  }
                } catch { setError("Network error"); }
                finally { setDeleting(false); }
              }}>
              <Trash2 className="h-4 w-4 mr-2" />{deleting ? "Removing..." : "Remove from Team"}
            </Button>
          )}

          <p className="text-xs text-slate-400 text-center">
            Member since <span className="tabular-nums">{new Date(user.createdAt).toLocaleDateString("en-IN")}</span>
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="bg-slate-50 rounded-lg p-3">
            <p className="text-xs text-slate-500">Name</p>
            <p className="text-sm font-medium text-slate-900">{user.name}</p>
          </div>
          <div className="bg-slate-50 rounded-lg p-3">
            <p className="text-xs text-slate-500">Email</p>
            <p className="text-sm font-medium text-slate-900">{user.email}</p>
          </div>
          <div className="bg-slate-50 rounded-lg p-3">
            <p className="text-xs text-slate-500">Member Since</p>
            <p className="text-sm font-medium text-slate-900 tabular-nums">{new Date(user.createdAt).toLocaleDateString("en-IN")}</p>
          </div>
          <p className="text-xs text-slate-400 text-center mt-4">Only admins can edit team members</p>
        </div>
      )}
    </div>
  );
}
