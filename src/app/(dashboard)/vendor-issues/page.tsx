"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { Search, AlertCircle, Plus, Trash2, Share2, Building2, Users, CalendarCheck, MessagesSquare, X, Loader2, Copy } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useDebounce } from "@/lib/utils";
import { type DateRangeKey } from "@/components/date-filter";
import { FilterSheet } from "@/components/filter-sheet";
import { DesktopTable } from "@/components/desktop-table";

interface IssueItem {
  id: string;
  issueNo: string;
  issueSource: string;
  issueType: string;
  description: string;
  status: string;
  priority: string;
  createdAt: string;
  vendor: { id: string; name: string; waGroupName: string | null; waGroupCode: string | null } | null;
  clientName: string | null;
  openCount: number;
  inProgressCount: number;
  resolvedCount: number;
}

const STATUS_FILTERS = ["ALL", "OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"];
const PRIORITY_FILTERS = ["ALL", "LOW", "MEDIUM", "HIGH", "URGENT"];

const ISSUE_TYPE_COLORS: Record<string, string> = {
  QUALITY: "bg-red-100 text-red-700",
  SHORTAGE: "bg-orange-100 text-orange-700",
  DAMAGE: "bg-red-100 text-red-700",
  WRONG_ITEM: "bg-purple-100 text-purple-700",
  BILLING_ERROR: "bg-blue-100 text-blue-700",
  DELIVERY_DELAY: "bg-yellow-100 text-yellow-700",
  OTHER: "bg-slate-100 text-slate-700",
};

const PRIORITY_VARIANT: Record<string, "default" | "info" | "warning" | "danger"> = {
  LOW: "default",
  MEDIUM: "info",
  HIGH: "warning",
  URGENT: "danger",
};

const STATUS_VARIANT: Record<string, "default" | "info" | "warning" | "success"> = {
  OPEN: "warning",
  IN_PROGRESS: "info",
  RESOLVED: "success",
  CLOSED: "default",
};

function overdueDays(createdAt: string): number {
  return Math.floor((Date.now() - new Date(createdAt).getTime()) / 86400000);
}

// Normalize a group code to always show a leading "#".
function fmtGroupCode(code: string | null | undefined): string {
  const c = (code || "").trim();
  if (!c) return "";
  return c.startsWith("#") ? c : `#${c}`;
}

export default function VendorIssuesPage() {
  const { data: session } = useSession();
  const role = (session?.user as { role?: string })?.role || "";
  const isAdmin = role === "ADMIN" || role === "CEO";

  const urlParams = useSearchParams();
  const vendorIdParam = urlParams.get("vendorId") || "";

  const [issues, setIssues] = useState<IssueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [sourceTab, setSourceTab] = useState<"ALL" | "VENDOR" | "CLIENT">("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [priorityFilter, setPriorityFilter] = useState("ALL");
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search);
  const [dateFilter, setDateFilter] = useState<DateRangeKey>("all");
  const [dateFrom, setDateFrom] = useState<string | undefined>();
  const [dateTo, setDateTo] = useState<string | undefined>();
  const [brandFilter, setBrandFilter] = useState("ALL");
  const [actionError, setActionError] = useState<string | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  // Brand → WhatsApp group editor
  const [groupsOpen, setGroupsOpen] = useState(false);
  const [groupDraft, setGroupDraft] = useState<Record<string, { name: string; code: string }>>({});
  const [savingGroups, setSavingGroups] = useState(false);
  const [copyToast, setCopyToast] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ limit: "100" });
    if (vendorIdParam) params.set("vendorId", vendorIdParam);
    // Don't filter by source in API — we'll group client-side for both-sections view
    if (statusFilter !== "ALL") params.set("status", statusFilter);
    if (priorityFilter !== "ALL") params.set("priority", priorityFilter);
    if (debouncedSearch.length >= 2) params.set("search", debouncedSearch);
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);

    fetch(`/api/vendor-issues?${params}`)
      .then((r) => r.json())
      .then((res) => { if (res.success) setIssues(res.data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [vendorIdParam, statusFilter, priorityFilter, debouncedSearch, dateFrom, dateTo]);

  // Split issues by source
  const brandIssues = issues.filter(i => i.issueSource === "VENDOR");
  const clientIssues = issues.filter(i => i.issueSource === "CLIENT");

  // Brand names for filter
  const brandNames = Array.from(
    new Set(brandIssues.filter(i => i.vendor?.name).map(i => i.vendor!.name))
  ).sort();

  // Live count of OPEN issues per brand — shown next to each brand in the filter.
  const openByBrand = brandIssues.reduce<Record<string, number>>((acc, i) => {
    if (i.status === "OPEN" && i.vendor?.name) {
      acc[i.vendor.name] = (acc[i.vendor.name] || 0) + 1;
    }
    return acc;
  }, {});

  // Brand → vendor id + its mapped WhatsApp group (used for per-brand share routing).
  const brandMeta: Record<string, { id: string; waGroupName: string | null; waGroupCode: string | null }> = {};
  for (const i of brandIssues) {
    if (i.vendor?.name && !brandMeta[i.vendor.name]) {
      brandMeta[i.vendor.name] = { id: i.vendor.id, waGroupName: i.vendor.waGroupName, waGroupCode: i.vendor.waGroupCode };
    }
  }

  // Apply brand filter
  const filteredBrandIssues = brandFilter === "ALL"
    ? brandIssues
    : brandIssues.filter(i => i.vendor?.name === brandFilter);

  const openCount = issues[0]?.openCount ?? 0;
  const inProgressCount = issues[0]?.inProgressCount ?? 0;
  const resolvedCount = issues[0]?.resolvedCount ?? 0;

  // WhatsApp share with overdue days
  // Build the formatted WhatsApp message for the current selection.
  // Returns the text + the target group label (when a single mapped brand is selected).
  const buildShareMessage = (shareBrand: boolean, shareClient: boolean): { text: string; target: string | null } | null => {
    const toShare: IssueItem[] = [];
    if (shareBrand) toShare.push(...filteredBrandIssues.filter(i => i.status !== "CLOSED"));
    if (shareClient) toShare.push(...clientIssues.filter(i => i.status !== "CLOSED"));
    if (!toShare.length) return null;

    const today = new Date();
    const lines: string[] = [];
    const heading = brandFilter !== "ALL"
      ? `⚠️ *${brandFilter} — Open Issues*`
      : shareBrand && shareClient ? "⚠️ *Ops Issues Summary*"
      : shareBrand ? "⚠️ *Brand Issues Summary*"
      : "⚠️ *Client Issues Summary*";

    // Per-brand share → prepend the mapped WhatsApp group as a routing label (the human taps that group).
    let target: string | null = null;
    if (shareBrand && brandFilter !== "ALL") {
      const meta = brandMeta[brandFilter];
      const code = fmtGroupCode(meta?.waGroupCode);
      if (meta && (meta.waGroupName || code)) {
        lines.push(`📍 *${meta.waGroupName || brandFilter}*${code ? `  ${code}` : ""}`);
        lines.push("");
        target = `${meta.waGroupName || brandFilter}${code ? ` ${code}` : ""}`;
      }
    }
    lines.push(heading);
    lines.push(`📅 ${today.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" })}`);
    lines.push("");

    // Group: brand first, then client
    const brandItems = toShare.filter(i => i.issueSource === "VENDOR");
    const clientItems = toShare.filter(i => i.issueSource === "CLIENT");

    if (brandItems.length > 0) {
      lines.push(`🏭 *Brand Issues (${brandItems.length})*`);
      brandItems.forEach((issue, i) => {
        const days = overdueDays(issue.createdAt);
        const overdueStr = days > 0 ? ` ⏰ ${days}d overdue` : "";
        lines.push(`${i + 1}. *[${issue.issueNo}]* ${issue.issueType.replace(/_/g, " ")}`);
        lines.push(`   Brand: ${issue.vendor?.name || "Unknown"}${overdueStr}`);
        lines.push(`   ${issue.description.slice(0, 80)}${issue.description.length > 80 ? "..." : ""}`);
        lines.push(`   Status: ${issue.status.replace(/_/g, " ")} | Priority: ${issue.priority}`);
        lines.push("");
      });
    }

    if (clientItems.length > 0) {
      lines.push(`👤 *Client Issues (${clientItems.length})*`);
      clientItems.forEach((issue, i) => {
        const days = overdueDays(issue.createdAt);
        const overdueStr = days > 0 ? ` ⏰ ${days}d overdue` : "";
        lines.push(`${i + 1}. *[${issue.issueNo}]* ${issue.issueType.replace(/_/g, " ")}`);
        lines.push(`   Client: ${issue.clientName || "Unknown"}${overdueStr}`);
        lines.push(`   ${issue.description.slice(0, 80)}${issue.description.length > 80 ? "..." : ""}`);
        lines.push(`   Status: ${issue.status.replace(/_/g, " ")} | Priority: ${issue.priority}`);
        lines.push("");
      });
    }

    lines.push(`📊 *Total: ${toShare.length} open issues*`);
    lines.push("\n_Sent from BCH OPS App_");
    return { text: lines.join("\n"), target };
  };

  // Open WhatsApp's chat picker with the message pre-filled (user picks the chat/group).
  const shareIssuesWhatsApp = (shareBrand: boolean = true, shareClient: boolean = true) => {
    const msg = buildShareMessage(shareBrand, shareClient);
    if (!msg) return;
    window.open(`https://wa.me/?text=${encodeURIComponent(msg.text)}`, "_blank");
  };

  // Copy the message so it can be pasted straight into the correct group (reliable — no wrong-chat risk).
  const copyIssues = async (shareBrand: boolean = true, shareClient: boolean = true) => {
    const msg = buildShareMessage(shareBrand, shareClient);
    if (!msg) { setCopyToast("Nothing to copy"); window.setTimeout(() => setCopyToast(null), 2500); return; }
    let ok = true;
    try {
      await navigator.clipboard.writeText(msg.text);
    } catch {
      try {
        const ta = document.createElement("textarea");
        ta.value = msg.text; ta.style.position = "fixed"; ta.style.opacity = "0";
        document.body.appendChild(ta); ta.focus(); ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      } catch { ok = false; }
    }
    setCopyToast(ok
      ? (msg.target ? `Copied ✓ — open “${msg.target}” in WhatsApp & paste` : "Copied ✓ — open the group in WhatsApp & paste")
      : "Couldn't copy — long-press the text to select");
    window.setTimeout(() => setCopyToast(null), 4500);
  };

  // Open the brand → WhatsApp group editor, seeded from current mappings.
  const openGroupsEditor = () => {
    const draft: Record<string, { name: string; code: string }> = {};
    for (const b of brandNames) {
      const meta = brandMeta[b];
      if (meta) draft[meta.id] = { name: meta.waGroupName || "", code: meta.waGroupCode || "" };
    }
    setGroupDraft(draft);
    setActionError(null);
    setGroupsOpen(true);
  };

  // Persist only the brands whose group/name changed, then reflect locally (no refetch needed).
  const saveGroups = async () => {
    setSavingGroups(true);
    setActionError(null);
    try {
      const updates: Array<{ id: string; name: string; code: string }> = [];
      for (const b of brandNames) {
        const meta = brandMeta[b];
        const d = meta && groupDraft[meta.id];
        if (!meta || !d) continue;
        const name = d.name.trim();
        const code = d.code.trim();
        if (name !== (meta.waGroupName || "") || code !== (meta.waGroupCode || "")) {
          updates.push({ id: meta.id, name, code });
        }
      }
      for (const u of updates) {
        const res = await fetch(`/api/vendor-issues/groups`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ vendorId: u.id, waGroupName: u.name, waGroupCode: u.code }),
        });
        const json = await res.json();
        if (!json.success) throw new Error(json.error || "Failed to save group");
      }
      // Mirror saved values into loaded issues so the next share uses them immediately.
      setIssues((prev) => prev.map((it) => {
        const d = it.vendor && groupDraft[it.vendor.id];
        return it.vendor && d
          ? { ...it, vendor: { ...it.vendor, waGroupName: d.name.trim() || null, waGroupCode: d.code.trim() || null } }
          : it;
      }));
      setGroupsOpen(false);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Failed to save groups");
    } finally {
      setSavingGroups(false);
    }
  };

  // Daily progress report — what came in today, what was processed, current backlog.
  const handleDailyReport = async () => {
    if (reportLoading) return;
    setReportLoading(true);
    setActionError(null);
    try {
      const res = await fetch("/api/vendor-issues/daily-report");
      const json = await res.json();
      if (!json.success) { setActionError(json.error || "Failed to build report"); return; }
      const r = json.data as {
        date: string;
        createdTodayCount: number; resolvedTodayCount: number;
        openTotal: number; inProgressTotal: number;
        createdToday: Array<{ issueNo: string; issueType: string; priority: string; status: string; vendor: { name: string } | null; clientName: string | null }>;
        resolvedToday: Array<{ issueNo: string; issueType: string; vendor: { name: string } | null; clientName: string | null }>;
      };
      const who = (val: { vendor: { name: string } | null; clientName: string | null }) => val.vendor?.name || val.clientName || "—";
      const dateStr = new Date(r.date).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" });

      const lines: string[] = [];
      lines.push("📊 *Ops Issues — Daily Report*");
      lines.push(`📅 ${dateStr}`);
      lines.push("");
      lines.push(`🆕 New today: ${r.createdTodayCount}`);
      lines.push(`✅ Resolved today: ${r.resolvedTodayCount}`);
      lines.push(`🔧 In progress: ${r.inProgressTotal}`);
      lines.push(`📂 Open backlog: ${r.openTotal}`);

      if (r.createdToday.length) {
        lines.push("");
        lines.push(`🆕 *New today (${r.createdTodayCount})*`);
        r.createdToday.slice(0, 15).forEach((i, n) => {
          lines.push(`${n + 1}. [${i.issueNo}] ${i.issueType.replace(/_/g, " ")} — ${who(i)} — ${i.priority}`);
        });
        if (r.createdToday.length > 15) lines.push(`…and ${r.createdToday.length - 15} more`);
      }
      if (r.resolvedToday.length) {
        lines.push("");
        lines.push(`✅ *Resolved today (${r.resolvedTodayCount})*`);
        r.resolvedToday.slice(0, 15).forEach((i, n) => {
          lines.push(`${n + 1}. [${i.issueNo}] ${i.issueType.replace(/_/g, " ")} — ${who(i)}`);
        });
        if (r.resolvedToday.length > 15) lines.push(`…and ${r.resolvedToday.length - 15} more`);
      }
      lines.push("\n_Sent from BCH OPS App_");
      window.open(`https://wa.me/?text=${encodeURIComponent(lines.join("\n"))}`, "_blank");
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Failed to build report");
    } finally {
      setReportLoading(false);
    }
  };

  const handleDelete = async (e: React.MouseEvent, issueId: string, issueNo: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(`Delete issue ${issueNo}? This cannot be undone.`)) return;
    try {
      const res = await fetch(`/api/vendor-issues/${issueId}`, { method: "DELETE" }).then(r => r.json());
      if (res.success) {
        setIssues((prev) => prev.filter((i) => i.id !== issueId));
      } else {
        setActionError(res.error || "Failed to delete");
      }
    } catch { setActionError("Network error"); }
  };

  const renderIssueCard = (issue: IssueItem) => (
    <Link key={issue.id} href={`/vendor-issues/${issue.id}`}>
      <Card className="hover:border-slate-300 transition-colors mb-2">
        <CardContent className="p-3">
          <div className="flex items-start justify-between">
            <div className="flex-1 min-w-0 mr-3">
              <div className="flex items-center gap-2 mb-0.5">
                <p className="text-sm font-bold text-slate-900">{issue.issueNo}</p>
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${ISSUE_TYPE_COLORS[issue.issueType] || ISSUE_TYPE_COLORS.OTHER}`}>
                  {issue.issueType.replace(/_/g, " ")}
                </span>
              </div>
              <p className="text-xs text-slate-500 mb-1">
                {issue.issueSource === "CLIENT" ? (
                  <><span className="text-teal-600 font-medium">Client:</span> {issue.clientName || "Unknown"}</>
                ) : (
                  <><span className="text-orange-600 font-medium">Brand:</span> {issue.vendor?.name || "Unknown"}</>
                )}
              </p>
              <p className="text-xs text-slate-600 line-clamp-2">{issue.description}</p>
            </div>
            <div className="text-right shrink-0 space-y-1">
              <Badge variant={PRIORITY_VARIANT[issue.priority] || "default"} className="text-[10px]">{issue.priority}</Badge>
              <br />
              <Badge variant={STATUS_VARIANT[issue.status] || "default"} className="text-[10px]">{issue.status.replace(/_/g, " ")}</Badge>
            </div>
          </div>
          <div className="flex items-center justify-between mt-1.5">
            <p className="text-[10px] text-slate-400">
              {new Date(issue.createdAt).toLocaleDateString("en-IN")}
              {issue.status !== "CLOSED" && issue.status !== "RESOLVED" && (() => {
                const days = overdueDays(issue.createdAt);
                return days > 0 ? <span className="text-red-500 font-medium ml-1">({days}d overdue)</span> : null;
              })()}
            </p>
            {isAdmin && (
              <button
                onClick={(e) => handleDelete(e, issue.id, issue.issueNo)}
                className="p-1.5 rounded-full hover:bg-red-50 text-slate-300 hover:text-red-500 transition-colors"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </CardContent>
      </Card>
    </Link>
  );

  // Desktop: dense table; mobile: the existing cards.
  const renderIssueList = (list: IssueItem[]) => (
    <>
      <DesktopTable
        className="hidden lg:block"
        rows={list}
        rowKey={(i) => i.id}
        rowHref={(i) => `/vendor-issues/${i.id}`}
        emptyText="No issues found"
        columns={[
          { header: "Issue", cell: (i) => (
            <div className="flex items-center gap-2">
              <span className="font-semibold text-slate-900">{i.issueNo}</span>
              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${ISSUE_TYPE_COLORS[i.issueType] || ISSUE_TYPE_COLORS.OTHER}`}>{i.issueType.replace(/_/g, " ")}</span>
            </div>
          ) },
          { header: "Brand / Client", cell: (i) => i.issueSource === "CLIENT"
            ? <span><span className="text-teal-600 font-medium">Client:</span> {i.clientName || "Unknown"}</span>
            : <span><span className="text-orange-600 font-medium">Brand:</span> {i.vendor?.name || "Unknown"}</span> },
          { header: "Description", cell: (i) => <span className="text-slate-600 line-clamp-1 max-w-[24rem] inline-block align-middle">{i.description}</span> },
          { header: "Priority", cell: (i) => <Badge variant={PRIORITY_VARIANT[i.priority] || "default"} className="text-[10px]">{i.priority}</Badge> },
          { header: "Status", cell: (i) => <Badge variant={STATUS_VARIANT[i.status] || "default"} className="text-[10px]">{i.status.replace(/_/g, " ")}</Badge> },
          { header: "Age", className: "whitespace-nowrap", cell: (i) => {
            const days = (i.status !== "CLOSED" && i.status !== "RESOLVED") ? overdueDays(i.createdAt) : 0;
            return <span className="text-slate-500">{new Date(i.createdAt).toLocaleDateString("en-IN")}{days > 0 && <span className="text-red-500 font-medium ml-1">({days}d)</span>}</span>;
          } },
          ...(isAdmin ? [{ header: "", className: "text-right w-10", cell: (i: IssueItem) => (
            <button onClick={(e) => handleDelete(e, i.id, i.issueNo)} className="p-1.5 rounded-full hover:bg-red-50 text-slate-300 hover:text-red-500 transition-colors"><Trash2 className="h-3.5 w-3.5" /></button>
          ) }] : []),
        ]}
      />
      <div className="space-y-0 lg:hidden">{list.map(renderIssueCard)}</div>
    </>
  );

  return (
    <div className="pb-24">
      <div className="flex flex-wrap items-center justify-between gap-y-2 mb-3">
        <h1 className="text-lg font-bold text-slate-900">Ops Issues</h1>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            onClick={handleDailyReport}
            disabled={reportLoading}
            className="flex items-center gap-1.5 h-9 px-3 rounded-full bg-slate-900 text-white text-xs font-medium active:scale-95 transition-transform shadow disabled:opacity-50"
            title="Share today's progress report on WhatsApp"
          >
            <CalendarCheck className="w-4 h-4" /> {reportLoading ? "..." : "Daily Report"}
          </button>
          <button
            onClick={openGroupsEditor}
            className="flex items-center gap-1.5 h-9 px-3 rounded-full bg-white border border-slate-200 text-slate-600 text-xs font-medium active:scale-95 transition-transform shadow-sm"
            title="Map brands to WhatsApp groups"
          >
            <MessagesSquare className="w-4 h-4" /> Groups
          </button>
          <button
            onClick={() => copyIssues(sourceTab !== "CLIENT", sourceTab !== "VENDOR")}
            className="flex items-center gap-1.5 h-9 px-3 rounded-full bg-green-600 text-white text-xs font-semibold active:scale-95 transition-transform shadow"
            title="Copy the message to paste into the WhatsApp group"
          >
            <Copy className="w-4 h-4" /> Copy
          </button>
          <button
            onClick={() => shareIssuesWhatsApp(sourceTab !== "CLIENT", sourceTab !== "VENDOR")}
            className="w-9 h-9 rounded-full bg-white border border-slate-200 flex items-center justify-center active:scale-95 transition-transform shadow-sm"
            title="Open WhatsApp share (you pick the chat)"
          >
            <Share2 className="w-4 h-4 text-green-600" />
          </button>
        </div>
      </div>

      {actionError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-2.5 mb-3 text-xs text-red-700 flex items-center justify-between">
          <span>{actionError}</span>
          <button onClick={() => setActionError(null)} className="text-red-400 hover:text-red-600 ml-2 text-sm leading-none">&times;</button>
        </div>
      )}

      {/* Source Tabs — top-level, always visible */}
      <div className="flex gap-2 mb-3">
        {([
          { key: "ALL" as const, label: "All", icon: AlertCircle, count: issues.length },
          { key: "VENDOR" as const, label: "Brand", icon: Building2, count: brandIssues.length },
          { key: "CLIENT" as const, label: "Client", icon: Users, count: clientIssues.length },
        ]).map((tab) => {
          const active = sourceTab === tab.key;
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              onClick={() => setSourceTab(tab.key)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-semibold transition-colors ${
                active
                  ? tab.key === "VENDOR" ? "bg-orange-600 text-white" : tab.key === "CLIENT" ? "bg-teal-600 text-white" : "bg-slate-900 text-white"
                  : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {tab.label} ({tab.count})
            </button>
          );
        })}
      </div>

      {/* Summary */}
      {!loading && issues.length > 0 && (
        <div className="flex gap-2 mb-3">
          <Badge variant="warning" className="text-xs">Open: {openCount}</Badge>
          <Badge variant="info" className="text-xs">In Progress: {inProgressCount}</Badge>
          <Badge variant="success" className="text-xs">Resolved: {resolvedCount}</Badge>
        </div>
      )}

      {/* Search */}
      <div className="relative mb-3">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <Input placeholder="Search issue no, vendor, or client..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
      </div>

      {/* Filters */}
      <FilterSheet
        className="mb-3"
        dateValue={dateFilter}
        onDateChange={(key, from, to) => { setDateFilter(key); setDateFrom(from); setDateTo(to); }}
        groups={[
          {
            label: "Status",
            value: statusFilter,
            defaultValue: "ALL",
            options: STATUS_FILTERS.map((s) => ({ key: s, label: s === "ALL" ? "All" : s.replace(/_/g, " ") })),
            onChange: (key) => setStatusFilter(key),
          },
          {
            label: "Priority",
            value: priorityFilter,
            defaultValue: "ALL",
            options: PRIORITY_FILTERS.map((p) => ({ key: p, label: p === "ALL" ? "All" : p })),
            onChange: (key) => setPriorityFilter(key),
          },
          ...(brandNames.length > 0 && (sourceTab === "ALL" || sourceTab === "VENDOR")
            ? [{
                label: "Brand",
                value: brandFilter,
                defaultValue: "ALL",
                options: [{ key: "ALL", label: "All" }, ...brandNames.map((b) => ({ key: b, label: `${b} (${openByBrand[b] || 0})` }))],
                onChange: (key: string) => setBrandFilter(key),
              }]
            : []),
        ]}
      />

      {/* Nudge: a brand is selected but has no WhatsApp group mapped yet */}
      {brandFilter !== "ALL" && brandMeta[brandFilter] && !(brandMeta[brandFilter].waGroupName || brandMeta[brandFilter].waGroupCode) && (
        <button
          onClick={openGroupsEditor}
          className="mb-3 w-full text-left text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 active:scale-[0.99] transition-transform"
        >
          No WhatsApp group set for <span className="font-semibold">{brandFilter}</span>. Tap to add its group &amp; #code so shares route to the right group.
        </button>
      )}

      {/* Content */}
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="p-3 border border-slate-100 rounded-lg animate-pulse">
              <div className="flex items-start justify-between">
                <div className="flex-1 space-y-1.5"><div className="h-4 bg-slate-200 rounded w-3/4" /><div className="h-3 bg-slate-200 rounded w-1/2" /></div>
                <div className="h-5 w-14 bg-slate-200 rounded-full ml-auto" />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <>
          {/* ALL tab: show both sections */}
          {sourceTab === "ALL" && (
            <div className="space-y-4">
              {/* Brand Issues Section */}
              {filteredBrandIssues.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <Building2 className="w-4 h-4 text-orange-600" />
                    <p className="text-xs font-bold text-orange-700 uppercase tracking-wider">Brand Issues ({filteredBrandIssues.length})</p>
                    <button
                      onClick={() => copyIssues(true, false)}
                      className="ml-auto p-1 rounded-full hover:bg-green-50 text-green-600"
                      title="Copy brand issues"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => shareIssuesWhatsApp(true, false)}
                      className="p-1 rounded-full hover:bg-green-50 text-green-500"
                      title="Share brand issues (pick chat)"
                    >
                      <Share2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  {renderIssueList(filteredBrandIssues)}
                </div>
              )}

              {/* Client Issues Section */}
              {clientIssues.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <Users className="w-4 h-4 text-teal-600" />
                    <p className="text-xs font-bold text-teal-700 uppercase tracking-wider">Client Issues ({clientIssues.length})</p>
                    <button
                      onClick={() => copyIssues(false, true)}
                      className="ml-auto p-1 rounded-full hover:bg-green-50 text-green-600"
                      title="Copy client issues"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => shareIssuesWhatsApp(false, true)}
                      className="p-1 rounded-full hover:bg-green-50 text-green-500"
                      title="Share client issues (pick chat)"
                    >
                      <Share2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  {renderIssueList(clientIssues)}
                </div>
              )}

              {filteredBrandIssues.length === 0 && clientIssues.length === 0 && (
                <div className="text-center py-12">
                  <AlertCircle className="h-8 w-8 text-slate-300 mx-auto mb-2" />
                  <p className="text-sm text-slate-400">No issues found</p>
                </div>
              )}
            </div>
          )}

          {/* VENDOR tab: only brand issues */}
          {sourceTab === "VENDOR" && (
            <div className="space-y-0">
              {filteredBrandIssues.length > 0 ? renderIssueList(filteredBrandIssues) : (
                <div className="text-center py-12">
                  <Building2 className="h-8 w-8 text-slate-300 mx-auto mb-2" />
                  <p className="text-sm text-slate-400">No brand issues found</p>
                </div>
              )}
            </div>
          )}

          {/* CLIENT tab: only client issues */}
          {sourceTab === "CLIENT" && (
            <div className="space-y-0">
              {clientIssues.length > 0 ? renderIssueList(clientIssues) : (
                <div className="text-center py-12">
                  <Users className="h-8 w-8 text-slate-300 mx-auto mb-2" />
                  <p className="text-sm text-slate-400">No client issues found</p>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Floating action button */}
      <Link
        href="/vendor-issues/new"
        className="fixed above-nav right-6 bg-blue-600 hover:bg-blue-700 text-white rounded-full p-4 shadow-lg transition-colors z-50"
      >
        <Plus className="h-5 w-5" />
      </Link>

      {/* Copy confirmation toast */}
      {copyToast && (
        <div className="fixed inset-x-0 bottom-24 z-[70] flex justify-center px-4 pointer-events-none">
          <div className="pointer-events-auto max-w-sm text-center bg-slate-900 text-white text-xs font-medium px-4 py-2.5 rounded-full shadow-lg">
            {copyToast}
          </div>
        </div>
      )}

      {/* Brand → WhatsApp group editor */}
      {groupsOpen && (
        <div
          className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/40 sm:p-4"
          onClick={() => !savingGroups && setGroupsOpen(false)}
        >
          <div
            className="bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between p-4 border-b border-slate-100">
              <div className="pr-3">
                <h2 className="text-base font-bold text-slate-900">WhatsApp Groups</h2>
                <p className="text-xs text-slate-500 mt-0.5">Map each brand to its group &amp; #code. It&apos;s added to the share so you tap the right group.</p>
              </div>
              <button onClick={() => !savingGroups && setGroupsOpen(false)} className="p-1.5 rounded-full hover:bg-slate-100 shrink-0">
                <X className="w-5 h-5 text-slate-500" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {brandNames.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-6">No brands with issues yet.</p>
              ) : (
                brandNames.map((b) => {
                  const meta = brandMeta[b];
                  if (!meta) return null;
                  const d = groupDraft[meta.id] || { name: "", code: "" };
                  return (
                    <div key={meta.id} className="border border-slate-100 rounded-xl p-3">
                      <p className="text-sm font-semibold text-slate-800 mb-2">
                        {b} <span className="text-xs font-normal text-slate-400">({openByBrand[b] || 0} open)</span>
                      </p>
                      <div className="flex gap-2">
                        <input
                          value={d.name}
                          onChange={(e) => setGroupDraft((prev) => ({ ...prev, [meta.id]: { ...d, name: e.target.value } }))}
                          placeholder="Group name"
                          className="flex-1 min-w-0 h-9 px-3 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-green-500/40"
                        />
                        <input
                          value={d.code}
                          onChange={(e) => setGroupDraft((prev) => ({ ...prev, [meta.id]: { ...d, code: e.target.value } }))}
                          placeholder="#code"
                          className="w-24 shrink-0 h-9 px-3 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-green-500/40"
                        />
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {actionError && groupsOpen && (
              <p className="px-4 text-xs text-red-600">{actionError}</p>
            )}
            <div className="p-4 border-t border-slate-100 flex gap-2">
              <button
                onClick={() => !savingGroups && setGroupsOpen(false)}
                className="flex-1 h-10 rounded-full border border-slate-200 text-sm font-medium text-slate-600"
              >
                Cancel
              </button>
              <button
                onClick={saveGroups}
                disabled={savingGroups}
                className="flex-1 h-10 rounded-full bg-green-600 text-white text-sm font-semibold flex items-center justify-center gap-1.5 disabled:opacity-50"
              >
                {savingGroups ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</> : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
