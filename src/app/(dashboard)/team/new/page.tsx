"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SiteSelect } from "@/components/site-select";
import { apiTry, apiFetch } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";

const log = createLogger("team:new");

interface RoleOption {
  id: string;
  key: string;
  name: string;
  description: string | null;
  isActive: boolean;
  _count: { permissions: number; users: number };
}

// Creating a member is now: identity + which role they hold. Permissions are NOT set here —
// they belong to the role, so granting one person extra access means either moving them to a
// different role or editing that role in Roles & Permissions. That is the whole point of the
// model: access is defined once per role instead of drifting per user.
export default function NewTeamMemberPage() {
  const router = useRouter();

  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [rolesLoading, setRolesLoading] = useState(true);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [roleId, setRoleId] = useState("");
  const [accessCode, setAccessCode] = useState("");
  const [storeId, setStoreId] = useState<string | null>(null);
  const [warehouseId, setWarehouseId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      // apiTry, not fetch().then(r => r.json()) — an expired session returns HTML with
      // status 200 and the raw parse throws "Unexpected token '<'", hiding the real cause.
      const { data, error: err } = await apiTry<{ roles: RoleOption[] }>("/api/roles");
      if (err) {
        log.error("could not load roles", { message: err });
        setError(err);
      } else {
        const active = (data?.roles ?? []).filter((r) => r.isActive);
        setRoles(active);
        // Default to a non-system role so an admin doesn't accidentally mint another admin.
        const preferred = active.find((r) => r._count.users > 0) || active[0];
        if (preferred) setRoleId(preferred.id);
      }
      setRolesLoading(false);
    })();
  }, []);

  const selected = roles.find((r) => r.id === roleId);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name || !email || !accessCode || !roleId) return;

    setSubmitting(true);
    setError("");
    try {
      await apiFetch("/api/users", {
        method: "POST",
        json: {
          name,
          email,
          roleId,
          accessCode: accessCode.toUpperCase(),
          storeId,
          warehouseId,
        },
      });
      log.info("team member created", { roleId, hasStore: Boolean(storeId), hasWarehouse: Boolean(warehouseId) });
      router.push("/team");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to create user";
      log.error("create team member failed", { message: msg });
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <Link
          href="/team"
          aria-label="Back"
          className="p-2 -ml-2 rounded-lg hover:bg-slate-100 focus-ring"
        >
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
          <Input
            placeholder="Full name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            className="min-h-[44px]"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Email *</label>
          <Input
            type="email"
            placeholder="name@bch.local"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="min-h-[44px]"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Role *</label>
          <select
            value={roleId}
            onChange={(e) => setRoleId(e.target.value)}
            disabled={rolesLoading}
            className="flex min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus-ring disabled:opacity-60"
          >
            {rolesLoading && <option>Loading roles...</option>}
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>

          {selected && (
            <p className="mt-1.5 flex items-start gap-1.5 text-xs text-slate-500">
              <ShieldCheck className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span>
                {selected.description || "No description."}{" "}
                <strong className="text-slate-700">
                  {selected._count.permissions} permission
                  {selected._count.permissions === 1 ? "" : "s"}
                </strong>{" "}
                granted.{" "}
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
          onChange={({ storeId: s, warehouseId: w }) => {
            setStoreId(s);
            setWarehouseId(w);
          }}
          disabled={submitting}
        />

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Access Code *</label>
          <Input
            placeholder="e.g. JOHN123"
            value={accessCode}
            onChange={(e) => setAccessCode(e.target.value.toUpperCase())}
            className="font-mono uppercase tabular-nums min-h-[44px]"
          />
          <p className="text-xs text-slate-500 mt-1">Used to log in. Must be unique.</p>
        </div>

        <Button
          type="submit"
          size="lg"
          disabled={!name || !email || !accessCode || !roleId || submitting}
          className="w-full min-h-[48px] bg-emerald-600 hover:bg-emerald-700 focus-ring"
        >
          {submitting ? "Creating..." : "Add Member"}
        </Button>
      </form>
    </div>
  );
}
