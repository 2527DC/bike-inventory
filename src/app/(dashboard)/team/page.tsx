"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Users, Plus, Shield, ShieldCheck, UserCog, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SkeletonList } from "@/components/ui/skeleton";
import { useDebounce } from "@/hooks/use-debounce";
import { usePermissions } from "@/lib/use-permissions";

interface TeamUser {
  id: string;
  name: string;
  email: string;
  roleId: string;
  role: { id: string; key: string; name: string } | null;
  isActive: boolean;
  createdAt: string;
  _count: { transactions: number };
}

export default function TeamPage() {
  const { canCreate, canView } = usePermissions();
  const [members, setMembers] = useState<TeamUser[]>([]);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ limit: "50" });
    if (debouncedSearch.length >= 2) params.set("search", debouncedSearch);
    fetch(`/api/users?${params}`)
      .then((r) => r.json())
      .then((res) => { if (res.success) setMembers(res.data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [debouncedSearch]);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-lg font-bold text-slate-900">Team</h1>
          <p className="text-xs text-slate-500">{members.length} members</p>
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

      <div className="relative mb-3">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <Input placeholder="Search team..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
      </div>

      {loading ? (
        <SkeletonList count={5} type="card" />
      ) : members.length === 0 ? (
        <div className="text-center py-12">
          <Users className="h-12 w-12 text-slate-300 mx-auto mb-3" />
          <p className="text-sm text-slate-500">No team members found</p>
        </div>
      ) : ((() => {
        // Group members by their role. Roles are rows now, so the grouping and its labels come
        // from the data rather than a hardcoded order — a new role appears here automatically.
        const grouped: Record<string, { name: string; members: TeamUser[] }> = {};
        for (const m of members) {
          const key = m.role?.id || "none";
          if (!grouped[key]) grouped[key] = { name: m.role?.name || "No role", members: [] };
          grouped[key].members.push(m);
        }
        const orderedRoles = Object.keys(grouped).sort((a, b) =>
          grouped[a].name.localeCompare(grouped[b].name)
        );

        return (
          <div className="space-y-4">
            {orderedRoles.map(roleId => {
              const group = grouped[roleId];
              const Icon = roleId === "none" ? UserCog : ShieldCheck;
              return (
                <div key={roleId}>
                  <div className="flex items-center gap-2 mb-1.5">
                    <Icon className="h-3.5 w-3.5 text-slate-400" />
                    <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">{group.name}</p>
                    <Badge variant="info" className="text-[11px] tabular-nums">{group.members.length}</Badge>
                  </div>
                  <div className="space-y-1.5">
                    {group.members.map(m => (
                      <Link key={m.id} href={`/team/${m.id}`} className="block rounded-xl focus-ring">
                        <Card className={`border-l-4 ${m.isActive ? "border-l-green-500" : "border-l-slate-300 opacity-60"}`}>
                          <CardContent className="p-3 flex items-center gap-3 min-h-[44px]">
                            <div className="h-10 w-10 rounded-full bg-slate-100 flex items-center justify-center shrink-0">
                              <Icon className="h-5 w-5 text-slate-500" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <p className="text-sm font-semibold text-slate-900 truncate">{m.name}</p>
                                {!m.isActive && <Badge variant="danger" className="text-[11px]">Inactive</Badge>}
                              </div>
                              <div className="flex items-center gap-2 mt-0.5">
                                <span className="text-[11px] text-slate-500 tabular-nums">{m._count.transactions} transactions</span>
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              <p className="text-[11px] text-slate-400 tabular-nums">
                                {new Date(m.createdAt).toLocaleDateString("en-IN")}
                              </p>
                            </div>
                          </CardContent>
                        </Card>
                      </Link>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })())}
    </div>
  );
}
