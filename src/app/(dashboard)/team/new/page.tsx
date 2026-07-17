"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Eye, Plus, Pencil, Trash2, ShieldCheck, CloudDownload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const ROLES = [
  { value: "CEO", label: "CEO — Full access" },
  { value: "ADMIN", label: "Admin — Full access, settings, team" },
  { value: "SUPERVISOR", label: "Supervisor — View all, manage stock, approve" },
  { value: "PURCHASE_MANAGER", label: "Purchase Manager — Reorder, POs, vendors" },
  { value: "ACCOUNTS_MANAGER", label: "Accounts Manager — Bills, payments, expenses" },
  { value: "INWARDS_EXECUTIVE", label: "Inwards Executive — Receiving, stock count, transfers" },
  { value: "OUTWARDS_EXECUTIVE", label: "Outwards Executive — Deliveries, dispatch" },
  { value: "STORE_MANAGER", label: "Store Manager — Deliveries, stock, vendors, accounts" },
  { value: "SALES_MANAGER", label: "Sales Manager — Deliveries, stock, customers" },
  { value: "SERVICE_MANAGER", label: "Service Manager — Stock, issues, reports" },
  { value: "CUSTOM", label: "Custom Role — Pick permissions" },
];

const APP_FEATURES = [
  { key: "dashboard", label: "Dashboard (Home)", hasApprove: false, hasCreate: false, hasFetch: false },
  { key: "inbound", label: "Inbound Tracking", hasApprove: true, hasCreate: true, hasFetch: true },
  { key: "deliveries", label: "Deliveries & Dispatch", hasApprove: true, hasCreate: true, hasFetch: true },
  { key: "stock", label: "Stock & Inventory", hasApprove: false, hasCreate: false, hasFetch: true },
  { key: "stock_audit", label: "Stock Audit / Count", hasApprove: true, hasCreate: true, hasFetch: false },
  { key: "transfers", label: "Stock Transfers", hasApprove: true, hasCreate: true, hasFetch: false },
  { key: "vendors", label: "Vendors", hasApprove: false, hasCreate: true, hasFetch: true },
  { key: "bills", label: "Bills & Payments", hasApprove: true, hasCreate: true, hasFetch: true },
  { key: "purchase_orders", label: "Purchase Orders", hasApprove: true, hasCreate: true, hasFetch: false },
  { key: "expenses", label: "Expenses", hasApprove: true, hasCreate: true, hasFetch: false },
  { key: "reports", label: "Reports", hasApprove: false, hasCreate: false, hasFetch: false },
  { key: "team", label: "Team Management", hasApprove: false, hasCreate: false, hasFetch: false },
  { key: "barcode", label: "Barcode Scanner", hasApprove: false, hasCreate: false, hasFetch: false },
  { key: "reorder", label: "Reorder & AI Insights", hasApprove: false, hasCreate: false, hasFetch: false },
  { key: "zoho", label: "Zoho Settings & Sync", hasApprove: false, hasCreate: false, hasFetch: true },
  { key: "customers", label: "Customers & Receivables", hasApprove: false, hasCreate: true, hasFetch: false },
  { key: "vendor_issues", label: "Vendor Issues", hasApprove: false, hasCreate: true, hasFetch: false },
];

type Perm = { view: boolean; create: boolean; edit: boolean; delete: boolean; approve: boolean; fetch: boolean };
const emptyPerm = (): Perm => ({ view: false, create: false, edit: false, delete: false, approve: false, fetch: false });

export default function NewTeamMemberPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("INWARDS_EXECUTIVE");
  const [accessCode, setAccessCode] = useState("");
  const [customRoleName, setCustomRoleName] = useState("");
  const [permissions, setPermissions] = useState<Record<string, Perm>>(
    Object.fromEntries(APP_FEATURES.map((f) => [f.key, emptyPerm()]))
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const toggle = (featureKey: string, perm: keyof Perm) => {
    setPermissions((prev) => ({
      ...prev,
      [featureKey]: { ...prev[featureKey], [perm]: !prev[featureKey]?.[perm] },
    }));
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name || !email || !accessCode) return;
    if (role === "CUSTOM" && !customRoleName.trim()) return;

    setSubmitting(true);
    setError("");
    try {
      const payload: Record<string, unknown> = {
        name, email, role,
        accessCode: accessCode.toUpperCase(),
        password: accessCode.toUpperCase(),
      };
      if (role === "CUSTOM") {
        payload.customRoleName = customRoleName.trim();
        payload.permissions = permissions;
      }
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.success) {
        router.push("/team");
      } else {
        setError(data.error || "Failed to create user");
      }
    } catch {
      setError("Network error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <Link href="/team" aria-label="Back" className="p-2 -ml-2 rounded-lg hover:bg-slate-100 focus-ring">
          <ArrowLeft className="h-5 w-5 text-slate-600" />
        </Link>
        <h1 className="text-lg font-bold text-slate-900">Add Team Member</h1>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Name *</label>
          <Input placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} autoFocus className="min-h-[44px]" />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Email *</label>
          <Input type="email" placeholder="name@bikeinventory.local" value={email} onChange={(e) => setEmail(e.target.value)} className="min-h-[44px]" />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Role *</label>
          <select value={role} onChange={(e) => setRole(e.target.value)}
            className="flex min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus-ring">
            {ROLES.map((r) => (<option key={r.value} value={r.value}>{r.label}</option>))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Access Code *</label>
          <Input placeholder="e.g. JOHN123" value={accessCode} onChange={(e) => setAccessCode(e.target.value.toUpperCase())}
            className="font-mono uppercase tabular-nums min-h-[44px]" />
          <p className="text-xs text-slate-500 mt-1">Used to log in. Must be unique.</p>
        </div>

        {/* Custom role config */}
        {role === "CUSTOM" && (
          <>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Role Name *</label>
              <Input placeholder="e.g. Store Helper, Mechanic" value={customRoleName}
                onChange={(e) => setCustomRoleName(e.target.value)} className="min-h-[44px]" />
            </div>

            <div>
              <p className="text-sm font-medium text-slate-700 mb-2">Permissions</p>
              <div className="flex items-center gap-3 mb-2 px-1 overflow-x-auto">
                <span className="flex items-center gap-1 text-[11px] text-slate-500 shrink-0"><Eye className="h-3 w-3" /> View</span>
                <span className="flex items-center gap-1 text-[11px] text-slate-500 shrink-0"><Plus className="h-3 w-3" /> Add</span>
                <span className="flex items-center gap-1 text-[11px] text-slate-500 shrink-0"><Pencil className="h-3 w-3" /> Edit</span>
                <span className="flex items-center gap-1 text-[11px] text-slate-500 shrink-0"><Trash2 className="h-3 w-3" /> Del</span>
                <span className="flex items-center gap-1 text-[11px] text-slate-500 shrink-0"><ShieldCheck className="h-3 w-3" /> Appr</span>
                <span className="flex items-center gap-1 text-[11px] text-slate-500 shrink-0"><CloudDownload className="h-3 w-3" /> Fetch</span>
              </div>
              <div className="space-y-1">
                {APP_FEATURES.map((f) => {
                  const p = permissions[f.key] || emptyPerm();
                  return (
                    <div key={f.key} className="flex items-center justify-between bg-white border border-slate-100 rounded-lg p-2">
                      <p className="text-xs font-medium text-slate-800 flex-1 min-w-0 mr-2">{f.label}</p>
                      <div className="flex items-center gap-0.5 shrink-0">
                        <button type="button" onClick={() => toggle(f.key, "view")}
                          className={`p-1.5 rounded-md ${p.view ? "bg-blue-100 text-blue-700" : "bg-slate-50 text-slate-300"}`}>
                          <Eye className="h-3 w-3" />
                        </button>
                        {f.hasCreate ? (
                          <button type="button" onClick={() => toggle(f.key, "create")}
                            className={`p-1.5 rounded-md ${p.create ? "bg-purple-100 text-purple-700" : "bg-slate-50 text-slate-300"}`}>
                            <Plus className="h-3 w-3" />
                          </button>
                        ) : <div className="p-1.5 w-[22px]" />}
                        <button type="button" onClick={() => toggle(f.key, "edit")}
                          className={`p-1.5 rounded-md ${p.edit ? "bg-amber-100 text-amber-700" : "bg-slate-50 text-slate-300"}`}>
                          <Pencil className="h-3 w-3" />
                        </button>
                        <button type="button" onClick={() => toggle(f.key, "delete")}
                          className={`p-1.5 rounded-md ${p.delete ? "bg-red-100 text-red-700" : "bg-slate-50 text-slate-300"}`}>
                          <Trash2 className="h-3 w-3" />
                        </button>
                        {f.hasApprove ? (
                          <button type="button" onClick={() => toggle(f.key, "approve")}
                            className={`p-1.5 rounded-md ${p.approve ? "bg-green-100 text-green-700" : "bg-slate-50 text-slate-300"}`}>
                            <ShieldCheck className="h-3 w-3" />
                          </button>
                        ) : <div className="p-1.5 w-[22px]" />}
                        {f.hasFetch ? (
                          <button type="button" onClick={() => toggle(f.key, "fetch")}
                            className={`p-1.5 rounded-md ${p.fetch ? "bg-cyan-100 text-cyan-700" : "bg-slate-50 text-slate-300"}`}>
                            <CloudDownload className="h-3 w-3" />
                          </button>
                        ) : <div className="p-1.5 w-[22px]" />}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}

        <Button type="submit" size="lg"
          disabled={!name || !email || !accessCode || (role === "CUSTOM" && !customRoleName.trim()) || submitting}
          className="w-full min-h-[48px] bg-emerald-600 hover:bg-emerald-700 focus-ring">
          {submitting ? "Creating..." : "Add Member"}
        </Button>
      </form>
    </div>
  );
}
