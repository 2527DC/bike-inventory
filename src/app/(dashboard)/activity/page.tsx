"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { usePermissions } from "@/lib/use-permissions";
import {
  Package, Truck, ArrowDownCircle, ArrowRightLeft,
  Receipt, IndianRupee, FileText, AlertTriangle, Share2,
  ChevronLeft, ChevronRight, User,
  ClipboardCheck, AlertOctagon, RefreshCw, Tags,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SkeletonList } from "@/components/ui/skeleton";
import { apiTry } from "@/lib/api-client";
import { formatIST } from "@/lib/services/timezone";

interface Activity {
  id: string;
  action: string;
  detail: string;
  category:
    | "STOCK" | "DELIVERY" | "INBOUND" | "TRANSFER" | "EXPENSE" | "PAYMENT" | "PO"
    | "AUDIT" | "ISSUE" | "ZOHO" | "MASTER_DATA";
  userName: string;
  userId: string;
  timestamp: string;
  amount?: number;
  isError?: boolean;
  errorDetail?: string;
}

interface UserSummary {
  userId: string;
  name: string;
  actions: number;
  errors: number;
  categories: Record<string, number>;
}

interface ActivityResponse {
  date: string;
  totalActions: number;
  errorCount: number;
  activities: Activity[];
  userSummary: UserSummary[];
}

const CATEGORY_CONFIG: Record<string, { icon: typeof Package; color: string; label: string }> = {
  STOCK: { icon: Package, color: "text-blue-600 bg-blue-50", label: "Stock" },
  DELIVERY: { icon: Truck, color: "text-green-600 bg-green-50", label: "Delivery" },
  INBOUND: { icon: ArrowDownCircle, color: "text-purple-600 bg-purple-50", label: "Inbound" },
  TRANSFER: { icon: ArrowRightLeft, color: "text-sky-600 bg-sky-50", label: "Transfer" },
  EXPENSE: { icon: Receipt, color: "text-amber-600 bg-amber-50", label: "Expense" },
  PAYMENT: { icon: IndianRupee, color: "text-red-600 bg-red-50", label: "Payment" },
  PO: { icon: FileText, color: "text-slate-600 bg-slate-50", label: "PO" },
  // The four ActivityLog categories (P5). A category missing here renders with no icon and
  // no label, so this object and the union above are edited together, in both activity pages.
  AUDIT: { icon: ClipboardCheck, color: "text-indigo-600 bg-indigo-50", label: "Audit" },
  ISSUE: { icon: AlertOctagon, color: "text-orange-600 bg-orange-50", label: "Issue" },
  ZOHO: { icon: RefreshCw, color: "text-teal-600 bg-teal-50", label: "Zoho" },
  MASTER_DATA: { icon: Tags, color: "text-violet-600 bg-violet-50", label: "Master data" },
};

function formatINR(n: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
}

/**
 * "3 Sep, 11:42 pm" — IST, and carrying the day.
 *
 * It was `toLocaleTimeString` with no timeZone, so it rendered in the VIEWER's zone while the
 * feed's day window is IST. The two agreed only for a viewer sitting in India. The day is shown
 * because a row near either midnight is otherwise impossible to place.
 */
function formatTime(ts: string) {
  return formatIST(ts, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: true });
}

function formatDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function ActivityPage() {
  const { data: session } = useSession();
  // "See the whole team's activity" vs "see only your own" — CLAUDE.md says that shape of
  // rule IS the module's approve grant. activity.approve was added to the catalog for this.
  const { canApprove } = usePermissions();
  const isAdmin = canApprove("activity");

  const [date, setDate] = useState(new Date());
  const [activities, setActivities] = useState<Activity[]>([]);
  const [userSummary, setUserSummary] = useState<UserSummary[]>([]);
  const [totalActions, setTotalActions] = useState(0);
  const [errorCount, setErrorCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selectedUser, setSelectedUser] = useState<string | null>(null);
  const [users, setUsers] = useState<Array<{ id: string; name: string }>>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Fetch users list for admin
  useEffect(() => {
    if (isAdmin) {
      apiTry<Array<{ id: string; name: string }>>("/api/team").then(({ data }) => {
        if (data) setUsers(data);
      });
    }
  }, [isAdmin]);

  const fetchActivity = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({ date: formatDate(date) });
    if (selectedUser) params.set("userId", selectedUser);
    // Raw fetch + .json() was banned for exactly this screen's failure mode: an expired session
    // answers 307 -> /login -> HTML with status 200, so `res.ok` is true and `res.json()` throws
    // a parse error the `.catch(() => {})` then swallowed. The page showed an empty day.
    apiTry<ActivityResponse>(`/api/activity?${params}`)
      .then(({ data, error }) => {
        if (data) {
          setActivities(data.activities);
          setUserSummary(data.userSummary);
          setTotalActions(data.totalActions);
          setErrorCount(data.errorCount);
          setLoadError(null);
        } else {
          setActivities([]);
          setUserSummary([]);
          setTotalActions(0);
          setErrorCount(0);
          setLoadError(error);
        }
      })
      .finally(() => setLoading(false));
  }, [date, selectedUser]);

  useEffect(() => { fetchActivity(); }, [fetchActivity]);

  const changeDate = (days: number) => {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    if (d <= new Date()) setDate(d);
  };

  const isToday = formatDate(date) === formatDate(new Date());
  const dateLabel = isToday ? "Today" : date.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });

  // Build WhatsApp message
  const buildWhatsAppMessage = () => {
    const filtered = selectedUser ? activities.filter((a) => a.userId === selectedUser) : activities;
    const name = selectedUser ? userSummary.find((u) => u.userId === selectedUser)?.name || "Employee" : "Team";
    const dateStr = date.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

    let msg = `📋 *${name} — Activity Report*\n📅 ${dateStr}\n\n`;
    msg += `✅ Total Actions: ${filtered.length}\n`;
    if (filtered.some((a) => a.isError)) {
      msg += `⚠️ Errors: ${filtered.filter((a) => a.isError).length}\n`;
    }
    msg += "\n";

    // Group by category
    const grouped: Record<string, Activity[]> = {};
    for (const a of filtered) {
      if (!grouped[a.category]) grouped[a.category] = [];
      grouped[a.category].push(a);
    }

    for (const [cat, items] of Object.entries(grouped)) {
      const cfg = CATEGORY_CONFIG[cat];
      msg += `*${cfg?.label || cat}* (${items.length})\n`;
      for (const item of items) {
        const time = formatTime(item.timestamp);
        const error = item.isError ? " ⚠️" : "";
        const amt = item.amount ? ` — ${formatINR(item.amount)}` : "";
        msg += `  ${time} ${item.action}: ${item.detail}${amt}${error}\n`;
      }
      msg += "\n";
    }

    if (filtered.some((a) => a.isError)) {
      msg += "*⚠️ Errors to Resolve:*\n";
      for (const a of filtered.filter((a) => a.isError)) {
        msg += `  • ${a.detail} — ${a.errorDetail}\n`;
      }
    }

    msg += "\n_Sent from BCH OPS App_";
    return msg;
  };

  const handleShare = () => {
    const msg = buildWhatsAppMessage();
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, "_blank");
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h1 className="text-lg font-bold text-slate-900">
          {isAdmin && !selectedUser ? "Team Activity" : "My Activity"}
        </h1>
        <button onClick={handleShare} disabled={activities.length === 0}
          className="flex items-center gap-1.5 bg-green-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-50">
          <Share2 className="h-3.5 w-3.5" /> WhatsApp
        </button>
      </div>

      {/* Date Navigator */}
      <div className="flex items-center justify-center gap-4 mb-3">
        <button onClick={() => changeDate(-1)} className="p-1.5 rounded-full hover:bg-slate-100">
          <ChevronLeft className="h-4 w-4 text-slate-600" />
        </button>
        <span className="text-sm font-semibold text-slate-800 min-w-[100px] text-center">{dateLabel}</span>
        <button onClick={() => changeDate(1)} disabled={isToday} className="p-1.5 rounded-full hover:bg-slate-100 disabled:opacity-30">
          <ChevronRight className="h-4 w-4 text-slate-600" />
        </button>
      </div>

      {/* Admin: User selector */}
      {isAdmin && users.length > 0 && (
        <div className="flex gap-1.5 overflow-x-auto lg:overflow-visible lg:flex-wrap scrollbar-hide mb-3 pb-1">
          <button
            onClick={() => setSelectedUser(null)}
            className={`shrink-0 px-2.5 py-1.5 rounded-full text-xs font-medium transition-colors ${
              !selectedUser ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"
            }`}
          >
            All
          </button>
          {users.map((u) => (
            <button
              key={u.id}
              onClick={() => setSelectedUser(u.id)}
              className={`shrink-0 px-2.5 py-1.5 rounded-full text-xs font-medium transition-colors ${
                selectedUser === u.id ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"
              }`}
            >
              {u.name.split(" ")[0]}
            </button>
          ))}
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        <Card><CardContent className="p-2.5 text-center">
          <p className="text-lg font-bold text-slate-900 tabular-nums">{totalActions}</p>
          <p className="text-[11px] text-slate-500">Actions</p>
        </CardContent></Card>
        <Card><CardContent className="p-2.5 text-center">
          <p className="text-lg font-bold text-slate-900 tabular-nums">{userSummary.length}</p>
          <p className="text-[11px] text-slate-500">People</p>
        </CardContent></Card>
        <Card className={errorCount > 0 ? "bg-red-50 border-red-200" : ""}>
          <CardContent className="p-2.5 text-center">
            <p className={`text-lg font-bold tabular-nums ${errorCount > 0 ? "text-red-600" : "text-slate-900"}`}>{errorCount}</p>
            <p className="text-[11px] text-slate-500">Errors</p>
          </CardContent>
        </Card>
      </div>

      {/* Per-user summary (admin view, all users) */}
      {isAdmin && !selectedUser && userSummary.length > 0 && (
        <div className="space-y-1.5 mb-3">
          {userSummary.map((u) => (
            <button key={u.userId} onClick={() => setSelectedUser(u.userId)}
              className="w-full flex items-center justify-between bg-white border border-slate-200 rounded-lg px-3 py-2.5 hover:bg-slate-50 transition-colors">
              <div className="flex items-center gap-2">
                <User className="h-3.5 w-3.5 text-slate-400" />
                <span className="text-sm font-medium text-slate-800">{u.name}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500 tabular-nums">{u.actions} actions</span>
                {u.errors > 0 && (
                  <Badge variant="danger" className="text-[11px] tabular-nums">{u.errors} errors</Badge>
                )}
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Activity Feed */}
      {/* A failed load used to render as "No activity recorded" — indistinguishable from a quiet
          day, which is the worst possible reading of an expired session. */}
      {!loading && loadError && (
        <div className="flex items-start gap-3 p-3 rounded-xl border border-red-200 bg-red-50 mb-3">
          <AlertTriangle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-red-800">Could not load activity</p>
            <p className="text-xs text-red-600 mt-0.5 break-words">{loadError}</p>
          </div>
          <button
            onClick={fetchActivity}
            className="text-xs font-medium text-red-700 underline shrink-0 min-h-[44px] px-2"
          >
            Retry
          </button>
        </div>
      )}
      {loading ? (
        <SkeletonList count={6} type="transaction" />
      ) : loadError ? null : activities.length === 0 ? (
        <div className="text-center py-12">
          <Package className="h-8 w-8 text-slate-300 mx-auto mb-2" />
          <p className="text-sm text-slate-400">No activity recorded</p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {(selectedUser ? activities.filter((a) => a.userId === selectedUser) : activities).map((a) => {
            const cfg = CATEGORY_CONFIG[a.category] || CATEGORY_CONFIG.STOCK;
            const Icon = cfg.icon;
            return (
              <div key={a.id} className={`flex gap-3 p-3 rounded-xl border ${a.isError ? "bg-red-50 border-red-200" : "bg-white border-slate-200"}`}>
                <div className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${cfg.color}`}>
                  {a.isError ? <AlertTriangle className="h-4 w-4 text-red-500" /> : <Icon className="h-4 w-4" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-slate-900">{a.action}</p>
                    <span className="text-[11px] text-slate-400 tabular-nums shrink-0">{formatTime(a.timestamp)}</span>
                  </div>
                  <p className="text-[11px] text-slate-600 truncate">{a.detail}</p>
                  {a.amount && <p className="text-[11px] text-slate-500 font-medium tabular-nums">{formatINR(a.amount)}</p>}
                  {a.isError && (
                    <p className="flex items-center gap-1 text-[11px] text-red-600 mt-0.5">
                      <AlertTriangle className="h-3 w-3 shrink-0" /> {a.errorDetail}
                    </p>
                  )}
                  {isAdmin && !selectedUser && (
                    <p className="text-[11px] text-purple-500">{a.userName}</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
