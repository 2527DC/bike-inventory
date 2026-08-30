"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Users, Plus, Shield, Search, Pencil, UserCheck, UserX, Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SkeletonList } from "@/components/ui/skeleton";
import { ErrorBanner } from "@/components/ui/error-banner";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Pagination } from "@/components/ui/pagination";
import { ActionConfirmation } from "@/components/ui/action-confirmation";
import { useDebounce } from "@/hooks/use-debounce";
import { usePermissions } from "@/lib/use-permissions";
import { apiFetch, apiFetchEnvelope, apiTry, type PageMeta } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";

const log = createLogger("team:list");

const PAGE_SIZE = 20;

interface SiteRef {
  id: string;
  code: string;
  name: string;
}

interface TeamUser {
  id: string;
  name: string;
  email: string;
  roleId: string;
  role: { id: string; key: string; name: string } | null;
  store: SiteRef | null;
  warehouse: SiteRef | null;
  isActive: boolean;
  createdAt: string;
  _count: { transactions: number };
}

/** What DELETE /api/users/[id] actually returns. It does NOT always delete — see below. */
interface DeleteOutcome {
  deleted: boolean;
  deactivated: boolean;
  name: string;
  message: string;
}

export default function TeamPage() {
  const router = useRouter();
  const { canCreate, canView, canEdit, canDelete } = usePermissions();

  const [members, setMembers] = useState<TeamUser[]>([]);
  const [meta, setMeta] = useState<PageMeta>({ total: 0, page: 1, limit: PAGE_SIZE, totalPages: 1, hasMore: false });
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [roleOptions, setRoleOptions] = useState<Array<{ id: string; name: string }>>([]);
  const debouncedSearch = useDebounce(search);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<(DeleteOutcome & { failed?: boolean }) | null>(null);

  // apiFetchEnvelope, never fetch().then(r => r.json()). An expired session 307s to /login,
  // which returns HTML with status 200 — res.ok does not catch it and a raw .json() throws
  // "Unexpected token '<'", hiding the real fault. The envelope variant is used rather than
  // apiFetch because `pagination` sits BESIDE `data` and apiFetch returns only `data`.
  //
  // The version of this file being replaced did `fetch(...).then(r => r.json())` with a bare
  // `.catch(() => {})`, so any failure left an empty list and no explanation at all.
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
    if (debouncedSearch.length >= 2) params.set("search", debouncedSearch);
    if (roleFilter) params.set("roleId", roleFilter);

    try {
      const env = await apiFetchEnvelope<TeamUser[]>(`/api/users?${params}`);
      setMembers(env.data ?? []);
      if (env.pagination) setMeta(env.pagination);
      log.debug("team list loaded", {
        page,
        rows: env.data?.length ?? 0,
        total: env.pagination?.total,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load the team";
      log.error("team list failed", { page, message: msg });
      setError(msg);
      setMembers([]);
    } finally {
      setLoading(false);
    }
  }, [page, debouncedSearch, roleFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  // Role list for the filter, fetched once. The filter itself is applied SERVER-side via
  // ?roleId= — pagination is server-side too, so filtering in the browser would leave the
  // footer claiming "Showing 1-20 of 47" while rendering three rows.
  useEffect(() => {
    (async () => {
      const { data, error: err } = await apiTry<{ roles: Array<{ id: string; name: string; isActive: boolean }> }>("/api/roles");
      if (err) {
        log.warn("role filter unavailable", { message: err });
        return;
      }
      setRoleOptions((data?.roles ?? []).filter((r) => r.isActive).map((r) => ({ id: r.id, name: r.name })));
    })();
  }, []);

  // A new search or role filter must not leave the user on page 7 of the old result set.
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, roleFilter]);

  async function toggleActive(u: TeamUser) {
    setBusyId(u.id);
    try {
      await apiFetch(`/api/users/${u.id}`, { method: "PUT", json: { isActive: !u.isActive } });
      log.info("user active toggled", { userId: u.id, isActive: !u.isActive });
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not update this user";
      log.error("toggle active failed", { userId: u.id, message: msg });
      setError(msg);
    } finally {
      setBusyId(null);
    }
  }

  async function remove(u: TeamUser) {
    if (!confirm(`Delete ${u.name}? If they have linked records they will be deactivated instead.`)) return;
    setBusyId(u.id);
    try {
      // DELETE does NOT always delete. It falls back to deactivation twice — once when the
      // user has transactions or stock counts, and again in a catch when any other FK fires.
      // Render the returned `message` verbatim: reporting both outcomes as "deleted" is a lie.
      const res = await apiFetch<DeleteOutcome>(`/api/users/${u.id}`, { method: "DELETE" });
      log.info("user delete handled", { userId: u.id, deleted: res.deleted, deactivated: res.deactivated });
      setOutcome(res);
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not delete this user";
      log.error("user delete failed", { userId: u.id, message: msg });
      setOutcome({ deleted: false, deactivated: false, name: u.name, message: msg, failed: true });
    } finally {
      setBusyId(null);
    }
  }

  const showActions = canEdit("team") || canDelete("team");

  function siteLabel(u: TeamUser) {
    const parts = [u.store?.name, u.warehouse?.name].filter(Boolean);
    return parts.length ? parts.join(" · ") : "—";
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-lg font-bold text-slate-900">Team</h1>
          <p className="text-xs text-slate-500 tabular-nums">{meta.total} members</p>
        </div>
        <div className="flex gap-2">
          {canView("roles") && (
            <Link href="/team/permissions">
              <Button size="sm" variant="outline" className="text-xs">
                <Shield className="h-3.5 w-3.5 mr-1" />Roles
              </Button>
            </Link>
          )}
          {canCreate("team") && (
            <Link href="/team/new">
              <Button size="sm" className="bg-blue-600 hover:bg-blue-700">
                <Plus className="h-3.5 w-3.5 mr-1" />Add
              </Button>
            </Link>
          )}
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-2 mb-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input
            placeholder="Search team..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        {roleOptions.length > 1 && (
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            aria-label="Filter by role"
            className="min-h-[44px] sm:w-52 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus-ring"
          >
            <option value="">All roles</option>
            {roleOptions.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
        )}
      </div>

      {error && <ErrorBanner message={error} onRetry={() => void load()} />}

      {loading ? (
        <SkeletonList count={5} type="card" />
      ) : members.length === 0 ? (
        <div className="text-center py-12">
          <Users className="h-12 w-12 text-slate-300 mx-auto mb-3" />
          <p className="text-sm text-slate-500">No team members found</p>
        </div>
      ) : (
        <>
          {/* Desktop and tablet: the table. */}
          <div className="hidden sm:block">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-slate-50">
                  <TableHead>Name</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Store · Warehouse</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Txns</TableHead>
                  <TableHead>Created</TableHead>
                  {showActions && <TableHead className="text-right">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((m) => (
                  <TableRow key={m.id} className={m.isActive ? "" : "opacity-60"}>
                    <TableCell>
                      <Link href={`/team/${m.id}`} className="block focus-ring rounded">
                        <span className="text-sm font-semibold text-slate-900">{m.name}</span>
                        <span className="block text-[11px] text-slate-500 truncate">{m.email}</span>
                      </Link>
                    </TableCell>
                    <TableCell className="text-xs">{m.role?.name || "No role"}</TableCell>
                    <TableCell className="text-xs text-slate-600">{siteLabel(m)}</TableCell>
                    <TableCell>
                      {m.isActive ? (
                        <Badge variant="success">Active</Badge>
                      ) : (
                        <Badge variant="danger">Inactive</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">{m._count.transactions}</TableCell>
                    <TableCell className="text-xs text-slate-500 tabular-nums whitespace-nowrap">
                      {new Date(m.createdAt).toLocaleDateString("en-IN")}
                    </TableCell>
                    {showActions && (
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          <RowActions
                            user={m}
                            busy={busyId === m.id}
                            canEditTeam={canEdit("team")}
                            canDeleteTeam={canDelete("team")}
                            onEdit={() => router.push(`/team/${m.id}`)}
                            onToggle={() => void toggleActive(m)}
                            onDelete={() => void remove(m)}
                          />
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Below sm: the same rows and the same three actions, as cards. */}
          <div className="sm:hidden space-y-1.5">
            {members.map((m) => (
              <Card key={m.id} className={m.isActive ? "" : "opacity-60"}>
                <CardContent className="p-3">
                  <div className="flex items-start gap-2">
                    <Link href={`/team/${m.id}`} className="flex-1 min-w-0 focus-ring rounded">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-slate-900 truncate">{m.name}</p>
                        {!m.isActive && <Badge variant="danger" className="text-[11px]">Inactive</Badge>}
                      </div>
                      <p className="text-[11px] text-slate-500 truncate">{m.email}</p>
                      <p className="text-[11px] text-slate-600 mt-0.5">
                        {m.role?.name || "No role"} · {siteLabel(m)}
                      </p>
                      <p className="text-[11px] text-slate-400 tabular-nums mt-0.5">
                        {m._count.transactions} txns · {new Date(m.createdAt).toLocaleDateString("en-IN")}
                      </p>
                    </Link>
                    {showActions && (
                      <div className="flex flex-col gap-1 shrink-0">
                        <RowActions
                          user={m}
                          busy={busyId === m.id}
                          canEditTeam={canEdit("team")}
                          canDeleteTeam={canDelete("team")}
                          onEdit={() => router.push(`/team/${m.id}`)}
                          onToggle={() => void toggleActive(m)}
                          onDelete={() => void remove(m)}
                        />
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <Pagination
            page={meta.page}
            totalPages={meta.totalPages}
            total={meta.total}
            count={members.length}
            limit={meta.limit}
            onPageChange={setPage}
          />
        </>
      )}

      {outcome && (
        <ActionConfirmation
          open
          onClose={() => setOutcome(null)}
          // Deactivated is NOT a success — the user asked to delete and the record survived.
          type={outcome.failed ? "error" : outcome.deleted ? "success" : "warning"}
          title={outcome.failed ? "Delete failed" : outcome.deleted ? "User deleted" : "User deactivated"}
          referenceId={outcome.name}
          details={outcome.message}
        />
      )}
    </div>
  );
}

/** The three row actions, shared by the table and the mobile cards so they cannot drift. */
function RowActions({
  user, busy, canEditTeam, canDeleteTeam, onEdit, onToggle, onDelete,
}: {
  user: TeamUser;
  busy: boolean;
  canEditTeam: boolean;
  canDeleteTeam: boolean;
  onEdit: () => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const btn =
    "min-h-[36px] min-w-[36px] inline-flex items-center justify-center rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-40 focus-ring";

  return (
    <>
      {canEditTeam && (
        <>
          <button type="button" onClick={onEdit} aria-label={`Edit ${user.name}`} className={`${btn} text-slate-600`}>
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onToggle}
            disabled={busy}
            aria-label={user.isActive ? `Deactivate ${user.name}` : `Activate ${user.name}`}
            className={`${btn} ${user.isActive ? "text-amber-600" : "text-green-600"}`}
          >
            {user.isActive ? <UserX className="h-3.5 w-3.5" /> : <UserCheck className="h-3.5 w-3.5" />}
          </button>
        </>
      )}
      {canDeleteTeam && (
        <button
          type="button"
          onClick={onDelete}
          disabled={busy}
          aria-label={`Delete ${user.name}`}
          className={`${btn} text-red-600`}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
    </>
  );
}
