"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { usePermissions } from "@/lib/use-permissions";
import {
  Loader2, Package, Truck, ArrowDownCircle, ArrowRightLeft,
  Receipt, IndianRupee, FileText, AlertTriangle, Share2,
  ChevronLeft, ChevronRight, ClipboardList,
} from "lucide-react";
import { DataTable, type Column } from "@/components/desktop/data-table";
import { Badge } from "@/components/ui/badge";

interface Activity {
  id: string;
  action: string;
  detail: string;
  category: "STOCK" | "DELIVERY" | "INBOUND" | "TRANSFER" | "EXPENSE" | "PAYMENT" | "PO";
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

const CATEGORY_CONFIG: Record<string, { icon: typeof Package; color: string; label: string }> = {
  STOCK: { icon: Package, color: "text-blue-600", label: "Stock" },
  DELIVERY: { icon: Truck, color: "text-green-600", label: "Delivery" },
  INBOUND: { icon: ArrowDownCircle, color: "text-purple-600", label: "Inbound" },
  TRANSFER: { icon: ArrowRightLeft, color: "text-sky-600", label: "Transfer" },
  EXPENSE: { icon: Receipt, color: "text-amber-600", label: "Expense" },
  PAYMENT: { icon: IndianRupee, color: "text-red-600", label: "Payment" },
  PO: { icon: FileText, color: "text-slate-600", label: "PO" },
};

function formatINR(n: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
}

function formatTime(ts: string) {
  return new Date(ts).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
}

function formatDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function DesktopActivityPage() {
  const { data: session } = useSession();
  // Same rule as /activity — the desktop view of the same feature.
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

  useEffect(() => {
    if (isAdmin) {
      fetch("/api/team")
        .then((r) => r.json())
        .then((res) => { if (res.success) setUsers(res.data); })
        .catch(() => {});
    }
  }, [isAdmin]);

  const fetchActivity = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({ date: formatDate(date) });
    if (selectedUser) params.set("userId", selectedUser);
    fetch(`/api/activity?${params}`)
      .then((r) => r.json())
      .then((res) => {
        if (res.success) {
          setActivities(res.data.activities);
          setUserSummary(res.data.userSummary);
          setTotalActions(res.data.totalActions);
          setErrorCount(res.data.errorCount);
        }
      })
      .catch(() => {})
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

  const filtered = selectedUser ? activities.filter((a) => a.userId === selectedUser) : activities;

  const buildWhatsAppMessage = () => {
    const name = selectedUser ? userSummary.find((u) => u.userId === selectedUser)?.name || "Employee" : "Team";
    const dateStr = date.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    let msg = `📋 *${name} — Activity Report*\n📅 ${dateStr}\n\n✅ Total Actions: ${filtered.length}\n`;
    if (filtered.some((a) => a.isError)) msg += `⚠️ Errors: ${filtered.filter((a) => a.isError).length}\n`;
    msg += "\n";
    const grouped: Record<string, Activity[]> = {};
    for (const a of filtered) { if (!grouped[a.category]) grouped[a.category] = []; grouped[a.category].push(a); }
    for (const [cat, items] of Object.entries(grouped)) {
      const cfg = CATEGORY_CONFIG[cat];
      msg += `*${cfg?.label || cat}* (${items.length})\n`;
      for (const item of items) {
        const time = formatTime(item.timestamp);
        const amt = item.amount ? ` — ${formatINR(item.amount)}` : "";
        msg += `  ${time} ${item.action}: ${item.detail}${amt}${item.isError ? " ⚠️" : ""}\n`;
      }
      msg += "\n";
    }
    msg += "\n_Sent from BCH OPS App_";
    return msg;
  };

  const handleShare = () => {
    window.open(`https://wa.me/?text=${encodeURIComponent(buildWhatsAppMessage())}`, "_blank");
  };

  const activityColumns: Column<Activity>[] = [
    {
      key: "time",
      label: "Time",
      sortable: true,
      className: "w-[80px]",
      sortValue: (r) => r.timestamp,
      render: (r) => <span className="text-xs text-slate-500 font-mono">{formatTime(r.timestamp)}</span>,
    },
    {
      key: "category",
      label: "Type",
      sortable: true,
      className: "w-[100px]",
      sortValue: (r) => r.category,
      render: (r) => {
        const cfg = CATEGORY_CONFIG[r.category];
        return <Badge variant="default" className={`text-[10px] ${cfg?.color || ""}`}>{cfg?.label || r.category}</Badge>;
      },
    },
    {
      key: "action",
      label: "Action",
      sortable: true,
      className: "w-[140px]",
      sortValue: (r) => r.action,
      render: (r) => (
        <div className="flex items-center gap-1.5">
          {r.isError && <AlertTriangle className="h-3.5 w-3.5 text-red-500 shrink-0" />}
          <span className={`text-sm font-medium ${r.isError ? "text-red-700" : "text-slate-900"}`}>{r.action}</span>
        </div>
      ),
    },
    {
      key: "detail",
      label: "Detail",
      render: (r) => (
        <div>
          <p className="text-sm text-slate-700 truncate max-w-[300px]">{r.detail}</p>
          {r.isError && r.errorDetail && <p className="text-[11px] text-red-500">{r.errorDetail}</p>}
        </div>
      ),
    },
    {
      key: "amount",
      label: "Amount",
      sortable: true,
      className: "text-right w-[100px]",
      sortValue: (r) => r.amount || 0,
      render: (r) => r.amount ? <span className="text-sm font-medium">{formatINR(r.amount)}</span> : <span className="text-slate-300">—</span>,
    },
    ...(isAdmin && !selectedUser ? [{
      key: "user",
      label: "Person",
      sortable: true,
      className: "w-[120px]" as string,
      sortValue: (r: Activity) => r.userName,
      render: (r: Activity) => <span className="text-xs text-purple-600 font-medium">{r.userName}</span>,
    }] : []),
  ];

  const summaryColumns: Column<UserSummary>[] = [
    {
      key: "name",
      label: "Employee",
      sortable: true,
      sortValue: (r) => r.name,
      render: (r) => <span className="font-medium text-slate-900">{r.name}</span>,
    },
    {
      key: "actions",
      label: "Actions",
      sortable: true,
      className: "text-center",
      sortValue: (r) => r.actions,
      render: (r) => <span className="text-sm font-semibold text-slate-900">{r.actions}</span>,
    },
    {
      key: "errors",
      label: "Errors",
      sortable: true,
      className: "text-center",
      sortValue: (r) => r.errors,
      render: (r) => r.errors > 0
        ? <Badge variant="danger">{r.errors}</Badge>
        : <span className="text-slate-300">0</span>,
    },
    {
      key: "breakdown",
      label: "Breakdown",
      render: (r) => (
        <div className="flex gap-1.5 flex-wrap">
          {Object.entries(r.categories).map(([cat, count]) => (
            <span key={cat} className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">
              {CATEGORY_CONFIG[cat]?.label || cat}: {count}
            </span>
          ))}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ClipboardList className="h-5 w-5 text-slate-700" />
          <h1 className="text-xl font-bold text-slate-900">Activity Log</h1>
        </div>
        <div className="flex items-center gap-3">
          {/* Date Navigator */}
          <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg px-3 py-1.5">
            <button onClick={() => changeDate(-1)} className="p-0.5 hover:bg-slate-100 rounded">
              <ChevronLeft className="h-4 w-4 text-slate-600" />
            </button>
            <span className="text-sm font-semibold text-slate-800 min-w-[100px] text-center">{dateLabel}</span>
            <button onClick={() => changeDate(1)} disabled={isToday} className="p-0.5 hover:bg-slate-100 rounded disabled:opacity-30">
              <ChevronRight className="h-4 w-4 text-slate-600" />
            </button>
          </div>
          <button onClick={handleShare} disabled={filtered.length === 0}
            className="flex items-center gap-1.5 bg-green-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-50 hover:bg-green-700">
            <Share2 className="h-3.5 w-3.5" /> WhatsApp
          </button>
        </div>
      </div>

      {/* User filter (admin) */}
      {isAdmin && users.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setSelectedUser(null)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              !selectedUser ? "bg-slate-900 text-white" : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"
            }`}
          >
            All Team
          </button>
          {users.map((u) => (
            <button
              key={u.id}
              onClick={() => setSelectedUser(u.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                selectedUser === u.id ? "bg-slate-900 text-white" : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"
              }`}
            >
              {u.name}
            </button>
          ))}
        </div>
      )}

      {/* Stats bar */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-xs text-slate-500 uppercase font-semibold">Actions</p>
          <p className="text-2xl font-bold text-slate-900">{totalActions}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-xs text-slate-500 uppercase font-semibold">People Active</p>
          <p className="text-2xl font-bold text-slate-900">{userSummary.length}</p>
        </div>
        <div className={`rounded-xl border p-4 ${errorCount > 0 ? "bg-red-50 border-red-200" : "bg-white border-slate-200"}`}>
          <p className="text-xs text-slate-500 uppercase font-semibold">Errors</p>
          <p className={`text-2xl font-bold ${errorCount > 0 ? "text-red-600" : "text-slate-900"}`}>{errorCount}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-xs text-slate-500 uppercase font-semibold">Showing</p>
          <p className="text-2xl font-bold text-slate-900">{filtered.length}</p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
        </div>
      ) : (
        <>
          {/* Per-user summary table (admin, all view) */}
          {isAdmin && !selectedUser && userSummary.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-slate-700 mb-2">Per-Employee Summary</h2>
              <DataTable
                data={userSummary}
                columns={summaryColumns}
                keyExtractor={(r) => r.userId}
                onRowClick={(r) => setSelectedUser(r.userId)}
                emptyMessage="No activity"
              />
            </div>
          )}

          {/* Activity table */}
          <div>
            <h2 className="text-sm font-semibold text-slate-700 mb-2">
              {selectedUser ? `${userSummary.find((u) => u.userId === selectedUser)?.name || "Employee"}'s Activity` : "All Activity"}
            </h2>
            <DataTable
              data={filtered}
              columns={activityColumns}
              keyExtractor={(r) => r.id}
              emptyMessage="No activity recorded for this date"
              pageSize={50}
            />
          </div>
        </>
      )}
    </div>
  );
}
