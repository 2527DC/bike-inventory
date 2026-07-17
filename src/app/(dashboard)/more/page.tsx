"use client";

import { useState } from "react";
import { useSession, signOut } from "next-auth/react";
import { User, LogOut, ChevronRight, ChevronDown, RefreshCw } from "lucide-react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { usePermissions } from "@/lib/use-permissions";
import { MENU_GROUPS } from "@/lib/menu-config";
import type { Role } from "@/types";

const ROLE_LABELS: Record<Role, string> = {
  CEO: "CEO",
  ADMIN: "Owner / Director",
  SUPERVISOR: "Ops Manager",
  PURCHASE_MANAGER: "Purchase Manager",
  ACCOUNTS_MANAGER: "Finance Head",
  INWARDS_EXECUTIVE: "Inwards Executive",
  OUTWARDS_EXECUTIVE: "Outwards Executive",
  STORE_MANAGER: "Store Manager",
  SALES_MANAGER: "Sales Manager",
  SERVICE_MANAGER: "Service Manager",
  CUSTOM: "Custom Role",
};


export default function MorePage() {
  const { data: session } = useSession();
  const user = session?.user as { name?: string; role?: string; userId?: string } | undefined;
  const role = (user?.role || "INWARDS_EXECUTIVE") as Role;
  const { canView } = usePermissions(role);
  const [syncClearing, setSyncClearing] = useState(false);
  const [syncResult, setSyncResult] = useState("");
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  const handleClearSync = async () => {
    setSyncClearing(true);
    setSyncResult("");
    try {
      const res = await fetch("/api/sync/clear", { method: "POST" }).then(r => r.json());
      if (res.success) {
        const { clearedSyncs, clearedPulls } = res.data;
        setSyncResult(clearedSyncs + clearedPulls > 0
          ? `Cleared ${clearedSyncs} sync(s), ${clearedPulls} pull(s)`
          : "No stuck syncs found");
      } else {
        setSyncResult(res.error || "Failed");
      }
    } catch { setSyncResult("Network error"); }
    finally { setSyncClearing(false); }
  };

  const toggleGroup = (title: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      next.has(title) ? next.delete(title) : next.add(title);
      return next;
    });
  };

  return (
    <div>
      {/* User Card */}
      <Card className="mb-4">
        <CardContent className="p-4 flex items-center gap-3">
          <div className="h-12 w-12 rounded-full bg-slate-200 flex items-center justify-center">
            <User className="h-6 w-6 text-slate-500" />
          </div>
          <div className="flex-1">
            <p className="text-base font-semibold text-slate-900">
              {user?.name || "User"}
            </p>
            <Badge variant="info">{ROLE_LABELS[role]}</Badge>
          </div>
        </CardContent>
      </Card>

      {/* Grouped Menu */}
      <div className="space-y-2">
        {MENU_GROUPS.map((group) => {
          const visibleItems = group.items.filter((item) => {
            // CEO inherits all ADMIN menu access
            const effectiveRole = role === "CEO" ? "ADMIN" : role;
            if (!item.roles.includes(effectiveRole)) return false;
            if (effectiveRole !== "ADMIN" && item.featureKey && !canView(item.featureKey)) return false;
            return true;
          });
          if (visibleItems.length === 0) return null;
          const isExpanded = expandedGroups.has(group.title);

          return (
            <Card key={group.title}>
              <button
                onClick={() => toggleGroup(group.title)}
                className="w-full flex items-center justify-between px-4 py-3 min-h-[44px] focus-ring rounded-xl"
              >
                <span className="text-[13px] font-bold uppercase tracking-wide text-slate-500">{group.title}</span>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-medium text-slate-400 tabular-nums">{visibleItems.length}</span>
                  {isExpanded ? (
                    <ChevronDown className="h-4 w-4 text-slate-400" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-slate-400" />
                  )}
                </div>
              </button>
              {isExpanded && (
                <div className="border-t border-slate-100">
                  {visibleItems.map((item) => {
                    const Icon = item.icon;
                    if (item.comingSoon) {
                      return (
                        <div key={item.label} className="flex items-center gap-3 px-4 py-2.5 min-h-[44px] opacity-50 cursor-not-allowed">
                          <Icon className="h-4 w-4 text-slate-400 shrink-0" />
                          <span className="flex-1 text-sm text-slate-500">{item.label}</span>
                          <Badge variant="default">Soon</Badge>
                        </div>
                      );
                    }
                    return (
                      <Link key={item.href} href={item.href} className="block focus-ring rounded-lg">
                        <div className="flex items-center gap-3 px-4 py-2.5 min-h-[44px] hover:bg-slate-50 transition-colors">
                          <Icon className="h-4 w-4 text-slate-500 shrink-0" />
                          <span className="flex-1 text-sm text-slate-700">{item.label}</span>
                          <ChevronRight className="h-4 w-4 text-slate-300 shrink-0" />
                        </div>
                      </Link>
                    );
                  })}
                </div>
              )}
            </Card>
          );
        })}
      </div>

      {/* Admin: Clear Stuck Syncs — admin-only, hidden for non-admins */}
      {(role === "ADMIN" || role === "CEO") && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-[11px] font-bold uppercase tracking-wide text-amber-700 mb-2">Admin</p>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-800">Zoho Sync</p>
              <p className="text-xs text-slate-500">Clear stuck syncs if fetch shows &quot;already in progress&quot;</p>
            </div>
            <button onClick={handleClearSync} disabled={syncClearing}
              className="flex items-center gap-1.5 px-3 py-2 min-h-[44px] bg-amber-100 text-amber-800 rounded-lg text-xs font-semibold hover:bg-amber-200 disabled:opacity-50 focus-ring shrink-0">
              <RefreshCw className={`h-3.5 w-3.5 ${syncClearing ? "animate-spin" : ""}`} />
              {syncClearing ? "Clearing..." : "Clear & Reset"}
            </button>
          </div>
          {syncResult && (
            <p className="text-xs text-green-600 mt-1.5">{syncResult}</p>
          )}
        </div>
      )}

      {/* Sign Out — destructive, set apart */}
      <button
        onClick={() => signOut({ callbackUrl: "/login" })}
        className="flex items-center gap-3 px-4 py-3 min-h-[44px] rounded-xl border border-red-200 bg-white hover:bg-red-50 transition-colors w-full mt-4 focus-ring"
      >
        <LogOut className="h-5 w-5 text-red-500 shrink-0" />
        <span className="text-sm font-semibold text-red-600">Sign Out</span>
      </button>

      <p className="text-[11px] text-slate-400 text-center mt-8 tabular-nums">
        BCH OPS v0.8.0 | Final
      </p>
    </div>
  );
}
