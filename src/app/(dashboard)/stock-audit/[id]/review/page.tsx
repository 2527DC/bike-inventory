"use client";

import { useState, useEffect, use } from "react";
import { useSession } from "next-auth/react";
import { usePermissions } from "@/lib/use-permissions";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Loader2, Download, ShieldCheck, XCircle, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { exportToExcel, type ExportColumn } from "@/lib/export";

interface StockCountItem {
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
    category: { name: string } | null;
    brand: { name: string } | null;
    bin: { code: string; location: string } | null;
  };
}

interface StockCountData {
  id: string;
  title: string;
  status: string;
  dueDate: string;
  completedAt: string | null;
  notes: string | null;
  assignedTo: { name: string };
  bin: { code: string; name: string; location: string } | null;
  totalItems: number;
  countedItems: number;
  totalVariance: number;
  itemsWithVariance: number;
}

const EXPORT_COLS: ExportColumn[] = [
  { header: "SKU", key: "sku" },
  { header: "Product", key: "name" },
  { header: "Brand", key: "brand" },
  { header: "Suggested Brand", key: "suggestedBrand" },
  { header: "System Qty", key: "systemQty" },
  { header: "Counted Qty", key: "countedQty" },
  { header: "Variance", key: "variance" },
  { header: "Bin", key: "bin" },
];

const REJECTION_REASONS = [
  "Counts seem off",
  "Missing items",
  "Recount section",
  "Wrong bin counted",
  "Incomplete count",
];

export default function StockCountReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { data: session } = useSession();
  const { canApprove: canApproveCheck } = usePermissions();
  const canApprove = canApproveCheck("stock_audit");
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState("");
  const [data, setData] = useState<StockCountData | null>(null);
  const [items, setItems] = useState<StockCountItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"all" | "counted" | "variance">("counted");
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [selectedChip, setSelectedChip] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch(`/api/stock-counts/${id}`).then((r) => r.json()),
      fetch(`/api/stock-counts/${id}/items?filter=all&limit=10000`).then((r) => r.json()),
    ]).then(([summaryRes, itemsRes]) => {
      if (summaryRes.success) setData(summaryRes.data);
      if (itemsRes.success) setItems(itemsRes.data.items || itemsRes.data);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center py-12">
        <p className="text-slate-500">Stock count not found</p>
        <Link href="/stock-audit" className="text-blue-600 text-sm mt-2 inline-block">Back</Link>
      </div>
    );
  }

  const filtered = tab === "counted"
    ? items.filter((i) => i.countedQty !== null && (i.systemQty > 0 || (i.countedQty ?? 0) > 0))
    : tab === "variance"
    ? items.filter((i) => i.variance !== null && i.variance !== 0)
    : items.filter((i) => i.systemQty > 0 || (i.countedQty ?? 0) > 0);

  const exportData = filtered.map((i) => ({
    sku: i.product.sku,
    name: i.product.name,
    brand: i.product.brand?.name || "—",
    suggestedBrand: i.suggestedBrand || "—",
    systemQty: i.systemQty,
    countedQty: i.countedQty ?? "—",
    variance: i.variance ?? "—",
    bin: i.product.bin?.code || "—",
  }));

  const handleApprove = async () => {
    setActionLoading(true);
    try {
      await fetch(`/api/stock-counts/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "APPROVED" }),
      });
      router.push(`/stock-audit/${id}`);
    } catch (e) { setActionError(e instanceof Error ? e.message : "Approve failed"); }
    finally { setActionLoading(false); }
  };

  const handleReject = async () => {
    const reason = selectedChip && rejectReason
      ? `${selectedChip}: ${rejectReason}`
      : selectedChip || rejectReason || "No reason given";
    setActionLoading(true);
    try {
      await fetch(`/api/stock-counts/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "REJECTED", rejectionReason: reason }),
      });
      router.push(`/stock-audit/${id}`);
    } catch (e) { setActionError(e instanceof Error ? e.message : "Reject failed"); }
    finally { setActionLoading(false); setShowRejectModal(false); }
  };

  const getVarianceColor = (v: number | null) => {
    if (v === null || v === 0) return "border-l-green-500 bg-green-50/50";
    if (Math.abs(v) <= 2) return "border-l-amber-500 bg-amber-50/50";
    return "border-l-red-500 bg-red-50/50";
  };

  return (
    <div className="pb-4">
      {actionError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-2.5 mb-3 text-xs text-red-700">
          {actionError}
          <button onClick={() => setActionError("")} className="ml-2 underline">dismiss</button>
        </div>
      )}

      <div className="flex items-center gap-3 mb-3">
        <Link href={`/stock-audit/${id}`} className="p-1"><ArrowLeft className="h-5 w-5 text-slate-600" /></Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-bold text-slate-900 truncate">{data.title}</h1>
          <p className="text-xs text-slate-500">
            {data.assignedTo.name}{data.bin ? ` | ${data.bin.name} (${data.bin.location})` : ""}
            {data.completedAt && ` | Completed: ${new Date(data.completedAt).toLocaleDateString("en-IN")}`}
          </p>
        </div>
        <Badge variant={data.status === "COMPLETED" ? "success" : data.status === "APPROVED" ? "success" : data.status === "REJECTED" ? "danger" : "info"}>
          {data.status === "IN_PROGRESS" ? "In Progress" : data.status.charAt(0) + data.status.slice(1).toLowerCase()}
        </Badge>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-2 mb-3">
        <Card><CardContent className="p-2 text-center">
          <p className="text-lg font-bold text-slate-900">{data.totalItems}</p>
          <p className="text-[10px] text-slate-500">Total</p>
        </CardContent></Card>
        <Card><CardContent className="p-2 text-center">
          <p className="text-lg font-bold text-blue-600">{data.countedItems}</p>
          <p className="text-[10px] text-slate-500">Counted</p>
        </CardContent></Card>
        <Card><CardContent className="p-2 text-center">
          <p className="text-lg font-bold text-yellow-600">{data.itemsWithVariance}</p>
          <p className="text-[10px] text-slate-500">Items differ</p>
        </CardContent></Card>
        <Card><CardContent className="p-2 text-center">
          <p className={`text-lg font-bold ${data.totalVariance === 0 ? "text-green-600" : "text-red-600"}`}>
            {data.totalVariance > 0 ? "+" : ""}{data.totalVariance}
          </p>
          <p className="text-[10px] text-slate-500">Net units</p>
        </CardContent></Card>
      </div>

      {/* Tabs + Export */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex gap-1.5">
          {(["counted", "variance", "all"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium ${tab === t ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"}`}>
              {t === "counted" ? `Counted (${items.filter((i) => i.countedQty !== null && (i.systemQty > 0 || (i.countedQty ?? 0) > 0)).length})`
                : t === "variance" ? `Variance (${items.filter((i) => i.variance && i.variance !== 0).length})`
                : `All (${items.filter((i) => i.systemQty > 0 || (i.countedQty ?? 0) > 0).length})`}
            </button>
          ))}
        </div>
        <Button variant="outline" size="sm" onClick={() => exportToExcel(exportData as unknown as Record<string, unknown>[], EXPORT_COLS, data.title)}>
          <Download className="h-3.5 w-3.5 mr-1" /> Excel
        </Button>
      </div>

      {/* Approve / Reject */}
      {data.status === "COMPLETED" && canApprove && (
        <div className="flex gap-2 mb-3">
          <button onClick={handleApprove} disabled={actionLoading}
            className="flex-1 flex items-center justify-center gap-2 bg-green-600 text-white py-2.5 rounded-lg text-sm font-medium disabled:opacity-50">
            <ShieldCheck className="h-4 w-4" /> {actionLoading ? "..." : "Approve (verify only)"}
          </button>
          <button onClick={() => setShowRejectModal(true)} disabled={actionLoading}
            className="flex-1 flex items-center justify-center gap-2 bg-red-600 text-white py-2.5 rounded-lg text-sm font-medium disabled:opacity-50">
            <XCircle className="h-4 w-4" /> Reject
          </button>
        </div>
      )}

      {/* Mobile card layout */}
      <div className="space-y-2">
        {filtered.map((item) => (
          <div key={item.id}
            className={`border-l-4 rounded-lg border border-slate-200 p-3 ${getVarianceColor(item.variance)}`}>
            <div className="flex items-start justify-between mb-1">
              <div className="flex-1 min-w-0 mr-2">
                <p className="text-sm font-medium text-slate-900 leading-tight">{item.product.name}</p>
                <p className="text-[10px] text-slate-400 mt-0.5">{item.product.sku}</p>
              </div>
              {item.product.bin && (
                <span className="shrink-0 px-1.5 py-0.5 bg-slate-100 rounded text-[10px] text-slate-600">
                  {item.product.bin.code}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1 mt-1 text-[10px] text-slate-500">
              {item.product.brand?.name && <span>{item.product.brand.name}</span>}
              {item.suggestedBrand && (
                <span className="text-amber-600"> (Sug: {item.suggestedBrand})</span>
              )}
            </div>
            <div className="flex items-center gap-4 mt-2 pt-2 border-t border-slate-100">
              <div className="text-center flex-1">
                <p className="text-[10px] text-slate-500">System</p>
                <p className="text-sm font-semibold text-slate-700">{item.systemQty}</p>
              </div>
              <div className="text-slate-300">→</div>
              <div className="text-center flex-1">
                <p className="text-[10px] text-slate-500">Counted</p>
                <p className="text-sm font-semibold text-blue-600">{item.countedQty ?? "—"}</p>
              </div>
              <div className="text-slate-300">→</div>
              <div className="text-center flex-1">
                <p className="text-[10px] text-slate-500">Variance</p>
                <p className={`text-sm font-bold ${
                  item.variance === null || item.variance === 0 ? "text-green-600" :
                  item.variance > 0 ? "text-blue-600" : "text-red-600"
                }`}>
                  {item.variance === null ? "—" : item.variance > 0 ? `+${item.variance}` : item.variance}
                </p>
              </div>
            </div>
            {item.notes && (
              <p className="text-[10px] text-slate-500 mt-1.5 italic">Note: {item.notes}</p>
            )}
          </div>
        ))}
      </div>

      {filtered.length === 0 && (
        <p className="text-sm text-slate-400 text-center py-6">No items in this view</p>
      )}

      {/* Rejection Bottom Sheet Modal */}
      {showRejectModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end justify-center"
          onClick={() => setShowRejectModal(false)}>
          <div className="bg-white w-full max-w-lg rounded-t-2xl p-4 pb-8 animate-in slide-in-from-bottom"
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-base font-bold text-slate-900">Reject Stock Count</h3>
              <button onClick={() => setShowRejectModal(false)} className="p-1 rounded-full hover:bg-slate-100">
                <X className="h-5 w-5 text-slate-400" />
              </button>
            </div>
            <p className="text-xs text-slate-500 mb-3">Select a reason or type your own:</p>
            <div className="flex flex-wrap gap-2 mb-3">
              {REJECTION_REASONS.map((r) => (
                <button key={r} onClick={() => setSelectedChip(selectedChip === r ? null : r)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                    selectedChip === r ? "bg-red-600 text-white" : "bg-slate-100 text-slate-600"
                  }`}>
                  {r}
                </button>
              ))}
            </div>
            <textarea
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 min-h-[80px]"
              placeholder="Add details (optional)..."
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
            />
            <div className="flex gap-2 mt-3">
              <button onClick={() => setShowRejectModal(false)}
                className="flex-1 py-2.5 rounded-lg text-sm font-medium bg-slate-100 text-slate-600">
                Cancel
              </button>
              <button onClick={handleReject}
                disabled={actionLoading || (!selectedChip && !rejectReason.trim())}
                className="flex-1 flex items-center justify-center gap-2 bg-red-600 text-white py-2.5 rounded-lg text-sm font-medium disabled:opacity-50">
                <XCircle className="h-4 w-4" /> {actionLoading ? "Rejecting..." : "Confirm Reject"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
