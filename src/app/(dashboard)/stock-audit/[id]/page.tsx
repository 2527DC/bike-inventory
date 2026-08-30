"use client";
import { useDebounce } from "@/hooks/use-debounce";

import { useState, useEffect, useCallback, useRef, use } from "react";
import { useSession } from "next-auth/react";
import { usePermissions } from "@/lib/use-permissions";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, Play, CheckCircle2, Save, Search, Trash2, Table,
  ShieldCheck, XCircle, RefreshCw, Plus, Minus, Zap, AlertTriangle,
  Info,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ActionConfirmation } from "@/components/ui/action-confirmation";
import { SkeletonList } from "@/components/ui/skeleton";
import { fuzzyMatch } from "@/lib/utils";

interface StockCountItemData {
  id: string;
  systemQty: number;
  countedQty: number | null;
  variance: number | null;
  suggestedBrand: string | null;
  notes: string | null;
  countedAt: string | null;
  product: {
    name: string;
    sku: string;
    currentStock: number;
    type: string;
    size: string | null;
    category: { name: string } | null;
    brand: { name: string } | null;
    bin: { code: string; location: string } | null;
  };
}

interface StockCountSummary {
  id: string;
  countNo: string | null;
  title: string;
  status: string;
  dueDate: string;
  completedAt: string | null;
  approvedAt: string | null;
  approvedBy: { name: string } | null;
  rejectionReason: string | null;
  notes: string | null;
  assignedTo: { name: string };
  bin: { code: string; name: string; location: string } | null;
  totalItems: number;
  countedItems: number;
  totalVariance: number;
  itemsWithVariance: number;
}

const STATUS_STYLE: Record<string, string> = {
  PENDING: "warning",
  IN_PROGRESS: "info",
  COMPLETED: "success",
  APPROVED: "success",
  REJECTED: "danger",
};

// Baseline mode: until July 31 2026, counted stock IS actual stock
const BASELINE_END = new Date("2026-07-31T23:59:59+05:30");

export default function StockAuditDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { data: session } = useSession();
  const { canApprove: canApproveCheck, canEdit } = usePermissions();
  const canApprove = canApproveCheck("stock_audit");
  // NOT stock_audit.approve. "Correct stock levels" does not approve anything — it
  // OVERWRITES each product’s currentStock with the counted quantity. That is a write to
  // stock, so it is stock.edit: someone who may approve a count is not automatically someone
  // who may overwrite the books.
  const isAdmin = canEdit("stock");
  const [summary, setSummary] = useState<StockCountSummary | null>(null);
  // Screenshot receipt shown when a count is completed (WhatsApp verification gate)
  const [receipt, setReceipt] = useState<{ referenceId: string; items: Array<{ label: string; value: string }> } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [brands, setBrands] = useState<Record<string, string>>({});
  const [brandList, setBrandList] = useState<string[]>([]);
  const [items, setItems] = useState<StockCountItemData[]>([]);
  const [loadingSummary, setLoadingSummary] = useState(true);
  const [loadingItems, setLoadingItems] = useState(false);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search);
  const [counts, setCounts] = useState<Record<string, number | null>>({});
  const [saving, setSaving] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState("");
  const [autoSaveStatus, setAutoSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [tab, setTab] = useState<"uncounted" | "counted" | "all">("uncounted");
  const [tabCounts, setTabCounts] = useState({ total: 0, counted: 0, uncounted: 0 });
  const [staleCount, setStaleCount] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [quickMode, setQuickMode] = useState(false);
  const [hideZeroCount, setHideZeroCount] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const itemRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirtyRef = useRef<Set<string>>(new Set());

  const isBaseline = new Date() < BASELINE_END;

  // Fetch summary
  const fetchSummary = useCallback(() => {
    fetch(`/api/stock-counts/${id}`)
      .then((r) => r.json())
      .then((res) => { if (res.success) setSummary(res.data); })
      .catch(() => {})
      .finally(() => setLoadingSummary(false));
  }, [id]);

  // Fetch items with tab filter
  const fetchItems = useCallback(() => {
    setLoadingItems(true);
    const params = new URLSearchParams();
    if (debouncedSearch) {
      params.set("search", debouncedSearch);
    } else {
      params.set("filter", tab);
    }

    fetch(`/api/stock-counts/${id}/items?${params}`)
      .then((r) => r.json())
      .then((res) => {
        if (res.success) {
          const fetchedItems: StockCountItemData[] = res.data.items || res.data;
          // Client-side fuzzy fallback if API returns 0 results and we have a search term
          if (debouncedSearch && fetchedItems.length === 0) {
            // Re-fetch all items and filter client-side
            fetch(`/api/stock-counts/${id}/items?filter=all`)
              .then((r2) => r2.json())
              .then((res2) => {
                if (res2.success) {
                  const allItems: StockCountItemData[] = res2.data.items || res2.data;
                  const fuzzyResults = allItems.filter((item) =>
                    fuzzyMatch(debouncedSearch, item.product.name) ||
                    fuzzyMatch(debouncedSearch, item.product.sku) ||
                    fuzzyMatch(debouncedSearch, item.product.brand?.name) ||
                    fuzzyMatch(debouncedSearch, item.product.category?.name) ||
                    fuzzyMatch(debouncedSearch, item.product.size)
                  );
                  setItems(fuzzyResults);
                  mergeServerCounts(fuzzyResults);
                }
              })
              .catch(() => {})
              .finally(() => setLoadingItems(false));
            return;
          }

          setItems(fetchedItems);
          mergeServerCounts(fetchedItems);
          // Update tab counts
          if (res.data.totalCount !== undefined) {
            setTabCounts({
              total: res.data.totalCount,
              counted: res.data.countedCount,
              uncounted: res.data.uncountedCount,
            });
          }
          if (res.data.staleCount !== undefined) {
            setStaleCount(res.data.staleCount);
          }
        }
      })
      .catch(() => {})
      .finally(() => setLoadingItems(false));
  }, [id, debouncedSearch, tab]);

  function mergeServerCounts(fetchedItems: StockCountItemData[]) {
    setCounts((prev) => {
      const merged = { ...prev };
      fetchedItems.forEach((item) => {
        if (!(item.id in merged) && item.countedQty !== null) {
          merged[item.id] = item.countedQty;
        }
      });
      return merged;
    });
  }

  useEffect(() => { fetchSummary(); }, [fetchSummary]);
  useEffect(() => { fetchItems(); }, [fetchItems]);
  useEffect(() => {
    fetch("/api/brands").then((r) => r.json()).then((res) => {
      if (res.success) setBrandList(res.data.map((b: { name: string }) => b.name));
    }).catch(() => {});
  }, []);

  // Auto-save: whenever counts change, debounce 2s then save
  useEffect(() => {
    if (dirtyRef.current.size === 0) return;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => {
      doAutoSave();
    }, 2000);
    return () => { if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current); };
  }, [counts]);

  const doAutoSave = async () => {
    const dirty = Array.from(dirtyRef.current);
    if (dirty.length === 0) return;

    const batch = dirty
      .filter((itemId) => counts[itemId] !== undefined && counts[itemId] !== null)
      .map((itemId) => ({
        id: itemId,
        countedQty: counts[itemId]!,
        ...(brands[itemId] ? { suggestedBrand: brands[itemId] } : {}),
      }));

    if (batch.length === 0) return;

    setAutoSaveStatus("saving");
    try {
      const res = await fetch(`/api/stock-counts/${id}/items`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: batch }),
      });
      const data = await res.json();
      if (data.success) {
        dirtyRef.current = new Set();
        setAutoSaveStatus("saved");
        setTimeout(() => setAutoSaveStatus("idle"), 2000);
        fetchSummary();
      }
    } catch (e) { setActionError(e instanceof Error ? e.message : "Auto-save failed"); }
  };

  const handleManualSave = async () => {
    const batch = Object.entries(counts)
      .filter(([, val]) => val !== null && val !== undefined)
      .map(([itemId, val]) => ({
        id: itemId,
        countedQty: val!,
        ...(brands[itemId] ? { suggestedBrand: brands[itemId] } : {}),
      }));

    if (batch.length === 0) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/stock-counts/${id}/items`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: batch }),
      });
      const data = await res.json();
      if (data.success) {
        dirtyRef.current = new Set();
        setAutoSaveStatus("saved");
        setTimeout(() => setAutoSaveStatus("idle"), 2000);
        fetchSummary();
        fetchItems();
      }
    } catch (e) { setActionError(e instanceof Error ? e.message : "Save failed"); }
    finally { setSaving(false); }
  };

  const handleStatusChange = async (newStatus: string, extras?: Record<string, unknown>) => {
    setActionLoading(true);
    try {
      const res = await fetch(`/api/stock-counts/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus, ...extras }),
      });
      const data = await res.json();
      if (!data.success) {
        setActionError(data.error || `Failed to change status to ${newStatus}`);
      } else if (newStatus === "COMPLETED" && summary) {
        // Screenshottable receipt for the WhatsApp group to verify/approve.
        setReceipt({
          referenceId: summary.countNo || summary.title,
          items: [
            { label: "Count", value: summary.title },
            { label: "Counted by", value: summary.assignedTo?.name || "—" },
            { label: "Items counted", value: `${summary.countedItems}/${summary.totalItems}` },
            { label: "Items with variance", value: `${summary.itemsWithVariance}` },
            { label: "Total variance", value: `${summary.totalVariance > 0 ? "+" : ""}${summary.totalVariance}` },
          ],
        });
      }
      fetchSummary();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Network error");
    }
    finally { setActionLoading(false); }
  };

  const handleRefreshSystemQty = async () => {
    setRefreshing(true);
    try {
      await fetch(`/api/stock-counts/${id}/items`, { method: "PATCH" });
      setStaleCount(0);
      fetchItems();
    } catch (e) { setActionError(e instanceof Error ? e.message : "Refresh failed"); }
    finally { setRefreshing(false); }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const res = await fetch(`/api/stock-counts/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (data.success) router.push("/stock-audit");
      else setActionError(data.error || "Failed to delete");
    } catch { setActionError("Failed to delete"); }
    finally { setDeleting(false); }
  };

  const handleReject = () => {
    handleStatusChange("REJECTED", { rejectionReason: rejectReason });
    setShowRejectModal(false);
    setRejectReason("");
  };

  const setCount = (itemId: string, value: number | null) => {
    setCounts((prev) => ({ ...prev, [itemId]: value }));
    if (value !== null) {
      dirtyRef.current.add(itemId);
    }
  };

  const increment = (itemId: string) => {
    const current = counts[itemId] ?? 0;
    setCount(itemId, current + 1);
  };

  const decrement = (itemId: string) => {
    const current = counts[itemId] ?? 0;
    if (current > 0) setCount(itemId, current - 1);
  };


  if (loadingSummary) {
    return <SkeletonList count={5} type="card" />;
  }

  if (!summary) {
    return (
      <div className="text-center py-12">
        <p className="text-sm text-slate-400">Stock audit not found</p>
        <Link href="/stock-audit" className="text-sm text-blue-600 mt-2 inline-block">Back to audits</Link>
      </div>
    );
  }

  const progress = summary.totalItems > 0 ? Math.round((summary.countedItems / summary.totalItems) * 100) : 0;
  const remaining = summary.totalItems - summary.countedItems;

  return (
    <div>
      {actionError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-2.5 mb-3 text-xs text-red-700">
          {actionError}
          <button onClick={() => setActionError("")} className="ml-2 underline">dismiss</button>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <Link href="/stock-audit" className="p-2 -ml-2 rounded-lg hover:bg-slate-100 focus-ring" aria-label="Back">
          <ArrowLeft className="h-5 w-5 text-slate-600" />
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-bold text-slate-900 truncate">{summary.title}</h1>
          <p className="text-xs text-slate-500 tabular-nums truncate">
            {summary.countNo && <span className="font-mono text-slate-400">{summary.countNo} | </span>}
            {summary.assignedTo.name} | Due: {new Date(summary.dueDate).toLocaleDateString("en-IN")}
            {summary.bin && ` | ${summary.bin.name} (${summary.bin.location})`}
          </p>
        </div>
        <Badge variant={STATUS_STYLE[summary.status] as "warning" | "info" | "success" | "danger"}>
          {summary.status === "IN_PROGRESS" ? "In Progress" : summary.status.charAt(0) + summary.status.slice(1).toLowerCase()}
        </Badge>
        <button onClick={() => setShowDeleteConfirm(true)} disabled={deleting} aria-label="Delete stock count"
          className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg disabled:opacity-50 focus-ring">
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      {/* Baseline / Verification Banner */}
      {summary.status === "IN_PROGRESS" && (
        <Card className={`mb-3 ${isBaseline ? "border-blue-200 bg-blue-50" : "border-slate-200 bg-slate-50"}`}>
          <CardContent className="p-2.5 flex items-center gap-2">
            <Info className={`h-4 w-4 shrink-0 ${isBaseline ? "text-blue-600" : "text-slate-500"}`} />
            <p className={`text-xs ${isBaseline ? "text-blue-800" : "text-slate-600"}`}>
              {isBaseline
                ? "Baseline Count — only count items you physically find. Uncounted items will be set to 0."
                : "Audit Count — only variances will create stock adjustments"}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Movement Warning Banner */}
      {staleCount > 0 && summary.status === "IN_PROGRESS" && (
        <Card className="mb-3 border-amber-200 bg-amber-50">
          <CardContent className="p-2.5 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
            <p className="text-xs text-amber-800 flex-1 tabular-nums">
              {staleCount} item{staleCount > 1 ? "s" : ""} had stock movements since count started
            </p>
            <button onClick={handleRefreshSystemQty} disabled={refreshing}
              className="shrink-0 flex items-center gap-1 text-xs font-medium text-amber-700 bg-amber-100 px-2.5 py-1 rounded-lg disabled:opacity-50">
              <RefreshCw className={`h-3 w-3 ${refreshing ? "animate-spin" : ""}`} /> Refresh
            </button>
          </CardContent>
        </Card>
      )}

      {/* Progress */}
      <Card className="mb-3">
        <CardContent className="p-3">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs text-slate-500">Progress</span>
            <span className="text-xs font-medium text-slate-700 tabular-nums">
              {summary.countedItems} of {summary.totalItems} counted{remaining > 0 ? ` — ${remaining} left` : " — all done!"}
            </span>
          </div>
          <div className="w-full bg-slate-200 rounded-full h-2 mb-2">
            <div
              className={`h-2 rounded-full transition-all ${progress === 100 ? "bg-green-500" : "bg-blue-500"}`}
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="text-xs">
            {summary.itemsWithVariance === 0 ? (
              <span className="text-green-600 font-medium">All counts match the system</span>
            ) : (
              <span className="text-slate-600">
                <span className="font-semibold text-slate-800 tabular-nums">{summary.itemsWithVariance}</span>
                {summary.itemsWithVariance === 1 ? " item differs" : " items differ"} from system
                <span className="text-slate-400"> · </span>
                <span className="font-medium text-slate-700 tabular-nums">
                  net {summary.totalVariance > 0 ? "+" : ""}{summary.totalVariance} {Math.abs(summary.totalVariance) === 1 ? "unit" : "units"}
                </span>
                {summary.totalVariance !== 0 && (
                  <span className="text-slate-400"> ({summary.totalVariance > 0 ? "surplus" : "short"})</span>
                )}
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Status Banners */}
      {summary.status === "APPROVED" && (
        <Card className="mb-3 border-green-200 bg-green-50">
          <CardContent className="p-3 flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-green-600 shrink-0" />
            <div>
              <p className="text-sm font-medium text-green-900">Approved</p>
              <p className="text-[11px] text-green-700 tabular-nums">
                By {summary.approvedBy?.name} on {summary.approvedAt ? new Date(summary.approvedAt).toLocaleDateString("en-IN") : "—"}
              </p>
            </div>
          </CardContent>
        </Card>
      )}
      {summary.status === "REJECTED" && (
        <Card className="mb-3 border-red-200 bg-red-50">
          <CardContent className="p-3 flex items-center gap-2">
            <XCircle className="h-5 w-5 text-red-600 shrink-0" />
            <div>
              <p className="text-sm font-medium text-red-900">Rejected</p>
              {summary.rejectionReason && <p className="text-[11px] text-red-700">{summary.rejectionReason}</p>}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Action Buttons */}
      {(summary.status === "COMPLETED" || summary.status === "APPROVED") && (
        <Link href={`/stock-audit/${id}/review`}>
          <button className="w-full flex items-center justify-center gap-2 bg-slate-900 text-white min-h-[48px] rounded-lg text-sm font-medium mb-3 focus-ring">
            <Table className="h-4 w-4" /> Review Table View
          </button>
        </Link>
      )}

      {summary.status === "COMPLETED" && canApprove && (
        <div className="mb-3 space-y-2">
          <div className="flex gap-2">
            <button onClick={() => handleStatusChange("APPROVED")} disabled={actionLoading}
              className="flex-1 flex items-center justify-center gap-2 bg-green-600 text-white min-h-[48px] rounded-lg text-sm font-medium disabled:opacity-50 focus-ring">
              <ShieldCheck className="h-4 w-4" /> {actionLoading ? "..." : "Approve (verify only)"}
            </button>
            <button onClick={() => setShowRejectModal(true)}
              className="flex-1 flex items-center justify-center gap-2 bg-red-600 text-white min-h-[48px] rounded-lg text-sm font-medium focus-ring">
              <XCircle className="h-4 w-4" /> Reject
            </button>
          </div>
          {isAdmin && (
            <button onClick={() => handleStatusChange("APPROVED", { applyToStock: true })} disabled={actionLoading}
              className="w-full flex items-center justify-center gap-2 border border-amber-300 bg-amber-50 text-amber-800 min-h-[48px] rounded-lg text-sm font-medium disabled:opacity-50 focus-ring">
              <ShieldCheck className="h-4 w-4" /> Approve &amp; correct stock levels
            </button>
          )}
          <p className="text-[11px] text-slate-500">
            <span className="font-medium">Verify only</span> records the count without changing stock (Inwards adds stock).
            {isAdmin ? " Correct stock levels overwrites each item's stock at this location with the counted quantity — admin only." : ""}
          </p>
        </div>
      )}

      {summary.status === "REJECTED" && !isAdmin && (
        <button onClick={() => handleStatusChange("IN_PROGRESS")} disabled={actionLoading}
          className="w-full flex items-center justify-center gap-2 bg-blue-600 text-white min-h-[48px] rounded-lg text-sm font-medium mb-3 disabled:opacity-50 focus-ring">
          <Play className="h-4 w-4" /> {actionLoading ? "Starting..." : "Re-start Counting"}
        </button>
      )}

      {summary.status === "PENDING" && !isAdmin && (
        <button onClick={() => handleStatusChange("IN_PROGRESS")} disabled={actionLoading}
          className="w-full flex items-center justify-center gap-2 bg-blue-600 text-white min-h-[48px] rounded-lg text-sm font-medium mb-3 disabled:opacity-50 focus-ring">
          <Play className="h-4 w-4" /> {actionLoading ? "Starting..." : "Start Counting"}
        </button>
      )}

      {summary.status === "IN_PROGRESS" && (
        <div className="flex gap-2 mb-3">
          <button onClick={handleManualSave} disabled={saving || dirtyRef.current.size === 0}
            className="flex-1 flex items-center justify-center gap-2 bg-slate-900 text-white min-h-[48px] rounded-lg text-sm font-medium disabled:opacity-50 focus-ring">
            <Save className="h-4 w-4" />
            {saving ? "Saving..." : autoSaveStatus === "saved" ? "Saved ✓" : `Save (${dirtyRef.current.size})`}
          </button>
          <button onClick={async () => {
            if (dirtyRef.current.size > 0) await handleManualSave();
            if (remaining > 0) {
              const msg = isBaseline
                ? `You've counted ${summary.countedItems} item(s). The remaining ${remaining} uncounted item(s) will be set to 0 stock. Continue?`
                : `${remaining} item(s) haven't been counted yet. Their stock will remain unchanged. Complete anyway?`;
              if (!confirm(msg)) return;
            }
            handleStatusChange("COMPLETED");
          }} disabled={actionLoading || saving}
            className="flex-1 flex items-center justify-center gap-2 bg-green-600 text-white min-h-[48px] rounded-lg text-sm font-medium disabled:opacity-50 focus-ring">
            <CheckCircle2 className="h-4 w-4" /> {actionLoading ? "..." : "Complete"}
          </button>
        </div>
      )}

      {/* Auto-save indicator */}
      {autoSaveStatus !== "idle" && summary.status === "IN_PROGRESS" && (
        <p className={`text-xs text-center mb-2 ${autoSaveStatus === "saving" ? "text-slate-400" : "text-green-600"}`}>
          {autoSaveStatus === "saving" ? "Auto-saving..." : "Auto-saved ✓"}
        </p>
      )}

      {/* Tabs, Search, Items — only show after counting starts */}
      {summary.status !== "PENDING" && (<>
      <div className="flex bg-slate-100 rounded-lg p-0.5 mb-2">
        {(["uncounted", "counted", "all"] as const).map((t) => {
          const count = t === "uncounted" ? tabCounts.uncounted : t === "counted" ? tabCounts.counted : tabCounts.total;
          return (
            <button key={t} onClick={() => { setTab(t); setSearch(""); }}
              className={`flex-1 px-2 py-1.5 rounded-md text-xs font-medium tabular-nums transition-colors ${
                tab === t ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"
              }`}>
              {t.charAt(0).toUpperCase() + t.slice(1)} ({count})
            </button>
          );
        })}
      </div>

      {/* Search + Quick Mode Toggle */}
      <div className="flex gap-2 mb-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input
            placeholder="Search name, SKU, brand (typos ok)..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        {summary.status === "IN_PROGRESS" && (
          <button onClick={() => setQuickMode(!quickMode)}
            className={`shrink-0 flex items-center gap-1 px-3 rounded-lg text-xs font-medium border ${
              quickMode ? "bg-purple-50 border-purple-300 text-purple-700" : "bg-white border-slate-200 text-slate-600"
            }`}>
            <Zap className="h-3.5 w-3.5" /> Quick
          </button>
        )}
      </div>

      {/* Hide zero-count toggle (only on Counted tab) */}
      {tab === "counted" && !loadingItems && items.length > 0 && (
        <div className="flex items-center justify-end mb-2">
          <button
            onClick={() => setHideZeroCount(!hideZeroCount)}
            className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${
              hideZeroCount ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            {hideZeroCount ? "Showing stock > 0" : "Show stock > 0 only"}
          </button>
        </div>
      )}

      {/* Items */}
      {loadingItems ? (
        <SkeletonList count={5} type="card" />
      ) : (
        <div className="space-y-2">
          {items.filter((item) => {
            if (hideZeroCount && tab === "counted") {
              const val = counts[item.id] ?? item.countedQty;
              return val !== null && val !== undefined && val > 0;
            }
            return true;
          }).map((item) => {
            const val = counts[item.id];
            const displayVal = val ?? item.countedQty;
            const variance = displayVal !== null && displayVal !== undefined ? displayVal - item.systemQty : null;
            const isCounted = displayVal !== null && displayVal !== undefined;

            if (quickMode && summary.status === "IN_PROGRESS") {
              // Quick Count Mode — compact row with +/- buttons
              return (
                <div key={item.id} ref={(el) => { itemRefs.current[item.id] = el; }}
                  className={`flex items-center gap-2 p-2 rounded-lg border ${isCounted ? "border-green-200 bg-green-50/50" : "border-slate-200"}`}>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-slate-900 truncate">{item.product.name}</p>
                    <p className="text-[11px] text-slate-400 tabular-nums">{item.product.sku} {item.product.brand ? `| ${item.product.brand.name}` : ""}</p>
                  </div>
                  <div className="text-right shrink-0 mr-1">
                    <p className="text-[11px] text-slate-400">Sys</p>
                    <p className="text-xs font-semibold text-slate-600 tabular-nums">{item.systemQty}</p>
                  </div>
                  <div className="flex items-center gap-0 shrink-0">
                    <button onClick={() => decrement(item.id)}
                      className="h-9 w-9 flex items-center justify-center bg-slate-100 rounded-l-lg border border-slate-200 active:bg-slate-200">
                      <Minus className="h-4 w-4 text-slate-600" />
                    </button>
                    <button
                      onClick={() => {
                        const input = prompt("Enter count:", String(displayVal ?? 0));
                        if (input !== null) {
                          const n = parseInt(input, 10);
                          if (!isNaN(n) && n >= 0) setCount(item.id, n);
                        }
                      }}
                      className="h-9 min-w-[44px] flex items-center justify-center bg-white border-y border-slate-200 text-sm font-bold text-slate-900 tabular-nums">
                      {displayVal ?? 0}
                    </button>
                    <button onClick={() => increment(item.id)}
                      className="h-9 w-9 flex items-center justify-center bg-blue-50 rounded-r-lg border border-blue-200 active:bg-blue-100">
                      <Plus className="h-4 w-4 text-blue-600" />
                    </button>
                  </div>
                  {variance !== null && (
                    <p className={`text-xs font-bold shrink-0 min-w-[30px] text-right tabular-nums ${variance === 0 ? "text-green-600" : "text-red-600"}`}>
                      {variance > 0 ? "+" : ""}{variance}
                    </p>
                  )}
                </div>
              );
            }

            // Card View (default)
            return (
              <div key={item.id} ref={(el: HTMLDivElement | null) => { if (el) itemRefs.current[item.id] = el; }}>
              <Card className={`${isCounted ? "border-l-4 border-l-green-400" : ""}`}>
                <CardContent className="p-3">
                  <div className="flex items-start justify-between mb-1">
                    <div className="flex-1 min-w-0 mr-2">
                      <p className="text-sm font-medium text-slate-900">{item.product.name}</p>
                      <p className="text-xs text-slate-500 tabular-nums">
                        {item.product.sku}
                        {item.product.brand ? ` | ${item.product.brand.name}` : ""}
                        {item.product.category ? ` | ${item.product.category.name}` : ""}
                        {item.product.bin ? ` | ${item.product.bin.code}` : ""}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xs text-slate-500">System</p>
                      <p className="text-sm font-bold text-slate-900 tabular-nums">{item.systemQty}</p>
                    </div>
                  </div>

                  {summary.status === "IN_PROGRESS" ? (
                    <div className="space-y-2 mt-2">
                      {/* Plus/Minus Counter */}
                      <div className="flex items-center gap-3">
                        <div className="flex items-center flex-1">
                          <button onClick={() => decrement(item.id)}
                            className="h-10 w-12 flex items-center justify-center bg-slate-100 rounded-l-lg border border-slate-200 active:bg-slate-200">
                            <Minus className="h-5 w-5 text-slate-600" />
                          </button>
                          <button
                            onClick={() => {
                              const input = prompt("Enter count:", String(displayVal ?? 0));
                              if (input !== null) {
                                const n = parseInt(input, 10);
                                if (!isNaN(n) && n >= 0) setCount(item.id, n);
                              }
                            }}
                            className="h-10 flex-1 flex items-center justify-center bg-white border-y border-slate-200 text-lg font-bold text-slate-900 min-w-[60px] tabular-nums">
                            {displayVal ?? 0}
                          </button>
                          <button onClick={() => increment(item.id)}
                            className="h-10 w-12 flex items-center justify-center bg-blue-50 rounded-r-lg border border-blue-200 active:bg-blue-100">
                            <Plus className="h-5 w-5 text-blue-600" />
                          </button>
                        </div>
                        {variance !== null && (
                          <div className={`text-right shrink-0 min-w-[50px] ${variance === 0 ? "text-green-600" : "text-red-600"}`}>
                            <p className="text-xs">Var</p>
                            <p className="text-sm font-bold tabular-nums">{variance > 0 ? "+" : ""}{variance}</p>
                          </div>
                        )}
                      </div>
                      <div className="mt-1">
                        <label className="text-[11px] text-slate-500 mb-0.5 block">
                          Brand {item.product.brand ? `(current: ${item.product.brand.name})` : ""}
                        </label>
                        <select
                          value={brands[item.id] ?? item.suggestedBrand ?? ""}
                          onChange={async (e) => {
                            if (e.target.value === "__custom__") {
                              const custom = prompt("Enter new brand name:");
                              if (custom && custom.trim()) {
                                const brandName = custom.trim();
                                // Create brand in DB
                                try {
                                  await fetch("/api/brands", {
                                    method: "POST",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({ name: brandName }),
                                  });
                                } catch { /* ignore — will still work locally */ }
                                // Add to dropdown if not already there
                                setBrandList((prev) =>
                                  prev.includes(brandName) ? prev : [...prev, brandName].sort()
                                );
                                setBrands((prev) => ({ ...prev, [item.id]: brandName }));
                                dirtyRef.current.add(item.id);
                              }
                            } else {
                              setBrands((prev) => ({ ...prev, [item.id]: e.target.value }));
                              if (e.target.value) dirtyRef.current.add(item.id);
                            }
                          }}
                          className="w-full rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-amber-400"
                        >
                          <option value="">— Keep current —</option>
                          {brandList.map((b) => <option key={b} value={b}>{b}</option>)}
                          <option value="__custom__">+ Add new brand...</option>
                        </select>
                      </div>
                    </div>
                  ) : item.countedQty !== null ? (
                    <div className="flex items-center gap-2 mt-2 text-xs tabular-nums">
                      <span className="text-slate-700">Counted <span className="font-semibold">{item.countedQty}</span></span>
                      {item.variance === 0 ? (
                        <span className="text-green-600">· matches</span>
                      ) : item.variance !== null ? (
                        <span className={`font-medium ${item.variance > 0 ? "text-green-600" : "text-red-600"}`}>
                          · {item.variance > 0 ? "+" : ""}{item.variance} vs system
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                </CardContent>
              </Card>
              </div>
            );
          })}

          {items.length === 0 && !loadingItems && (
            <p className="text-sm text-slate-400 text-center py-8">
              {search ? "No items match — try a different spelling" : tab === "counted" ? "No items counted yet — tap + on items you find" : tab === "uncounted" ? "All items have been counted!" : "No items in this count"}
            </p>
          )}

          {items.length >= 500 && (
            <p className="text-xs text-slate-400 text-center py-2">
              Showing first 500 results. Use search to find specific items.
            </p>
          )}
        </div>
      )}

      </>)}

      {/* Rejection Bottom Sheet Modal */}
      {showRejectModal && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40" onClick={() => setShowRejectModal(false)}>
          <div className="w-full max-w-lg bg-white rounded-t-2xl p-4 pb-8 safe-bottom" onClick={(e) => e.stopPropagation()}>
            <div className="w-10 h-1 bg-slate-300 rounded-full mx-auto mb-4" />
            <h3 className="text-base font-bold text-slate-900 mb-3">Reject Stock Count</h3>
            <div className="flex flex-wrap gap-2 mb-3">
              {["Counts seem off", "Missing items", "Recount needed", "Wrong bin"].map((r) => (
                <button key={r} onClick={() => setRejectReason(r)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                    rejectReason === r ? "bg-red-50 border-red-300 text-red-700" : "bg-white border-slate-200 text-slate-600"
                  }`}>
                  {r}
                </button>
              ))}
            </div>
            <textarea
              placeholder="Add details (optional)..."
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400 min-h-[80px] mb-3"
            />
            <div className="flex gap-2">
              <button onClick={() => setShowRejectModal(false)}
                className="flex-1 py-2.5 rounded-lg text-sm font-medium bg-slate-100 text-slate-700">
                Cancel
              </button>
              <button onClick={handleReject} disabled={!rejectReason}
                className="flex-1 py-2.5 rounded-lg text-sm font-medium bg-red-600 text-white disabled:opacity-50">
                Reject
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40" onClick={() => setShowDeleteConfirm(false)}>
          <div className="bg-white rounded-2xl p-5 mx-4 max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-bold text-slate-900 mb-2">Delete Stock Count?</h3>
            <p className="text-sm text-slate-500 mb-4">This cannot be undone. All counted data will be lost.</p>
            <div className="flex gap-2">
              <button onClick={() => setShowDeleteConfirm(false)} className="flex-1 py-2.5 rounded-lg text-sm font-medium bg-slate-100 text-slate-700">Cancel</button>
              <button onClick={() => { setShowDeleteConfirm(false); handleDelete(); }} disabled={deleting}
                className="flex-1 py-2.5 rounded-lg text-sm font-medium bg-red-600 text-white disabled:opacity-50">
                {deleting ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

      <ActionConfirmation
        open={!!receipt}
        onClose={() => setReceipt(null)}
        type="success"
        title="Stock Count Completed"
        referenceId={receipt?.referenceId || ""}
        performedBy={(session?.user as { name?: string })?.name}
        items={receipt?.items}
        details="Screenshot and share on the WhatsApp group for verification."
      />
    </div>
  );
}
