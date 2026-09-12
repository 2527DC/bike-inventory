"use client";

import { useState, useEffect, useCallback, use } from "react";
import { useSession } from "next-auth/react";
import { usePermissions } from "@/lib/use-permissions";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Loader2, Download, ShieldCheck, XCircle, X, AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/error-banner";
import { ActionConfirmation } from "@/components/ui/action-confirmation";
import { exportToExcel, type ExportColumn } from "@/lib/export";
import { apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";

const log = createLogger("stock-audit:review");

interface StockCountItem {
  id: string;
  systemQty: number;
  countedQty: number | null;
  variance: number | null;
  /** Stock in the audit's scope NOW, as opposed to `systemQty`, the snapshot at raise time. */
  liveQty?: number;
  suggestedBrand: string | null;
  notes: string | null;
  countedAt: string | null;
  product: {
    name: string;
    sku: string;
    currentStock: number;
    category: { name: string } | null;
    brand: { name: string } | null;
    bin: { code: string; location: string } | null;
  };
}

interface StockCountData {
  id: string;
  countNo: string | null;
  title: string;
  status: string;
  dueDate: string;
  completedAt: string | null;
  notes: string | null;
  assignedToId: string;
  assignedTo: { name: string };
  storeId: string | null;
  warehouseId: string | null;
  scopeLabel: string;
  canCorrectStock: boolean;
  correctionWarehouses: Array<{ id: string; name: string }>;
  bin: { id: string; code: string; name: string; location: string | null; directions: string | null; floor: string | null; zone: string | null } | null;
  totalItems: number;
  countedItems: number;
  totalVariance: number;
  itemsWithVariance: number;
}

/** What `PUT` answers after "set system stock" — null on a verify-only approval. */
interface AppliedSummary {
  lines: number;
  changed: number;
  netUnits: number;
  zeroLines: number;
  writtenOff: number;
  warehouse: string;
  scope: "warehouse" | "store";
}

type ApproveMode = "verify" | "apply";

const EXPORT_COLS: ExportColumn[] = [
  { header: "SKU", key: "sku" },
  { header: "Product", key: "name" },
  { header: "Brand", key: "brand" },
  { header: "Suggested Brand", key: "suggestedBrand" },
  { header: "System Qty", key: "systemQty" },
  { header: "Now", key: "liveQty" },
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

const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);

export default function StockCountReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { data: session } = useSession();
  const { canApprove: canApproveCheck } = usePermissions();
  const canApprove = canApproveCheck("stock_audit");
  const canCorrectStockPerm = canApproveCheck("stock_correction");
  // WHOSE audit this is. The API refuses an assignee who tries to sign off their own count;
  // the screen says so up front instead of offering a button that will be refused.
  const currentUserId = (session?.user as { userId?: string } | undefined)?.userId;

  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [data, setData] = useState<StockCountData | null>(null);
  const [items, setItems] = useState<StockCountItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"all" | "counted" | "variance">("counted");
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [selectedChip, setSelectedChip] = useState<string | null>(null);

  // The approver's choice. "verify" records the differences and leaves stock alone;
  // "apply" sets system stock to the counted quantities. Approve always goes through the
  // confirm sheet — nothing that overwrites stock fires on a single tap.
  const [mode, setMode] = useState<ApproveMode>("verify");
  const [correctionWarehouseId, setCorrectionWarehouseId] = useState("");
  const [showApproveSheet, setShowApproveSheet] = useState(false);
  const [approved, setApproved] = useState<{ mode: ApproveMode; applied: AppliedSummary | null } | null>(null);

  // No synchronous setState before the first await: `loading` starts true, and the retry
  // button resets it itself, so the mount effect never sets state in its own body
  // (react-hooks/set-state-in-effect).
  const load = useCallback(() => {
    void Promise.all([
      apiTry<StockCountData>(`/api/stock-counts/${id}`),
      apiTry<{ items: StockCountItem[] } | StockCountItem[]>(`/api/stock-counts/${id}/items?filter=all&limit=10000`),
    ]).then(([summaryRes, itemsRes]) => {
      if (summaryRes.error || !summaryRes.data) {
        log.error("could not load stock count", { countId: id, message: summaryRes.error });
        setLoadError(summaryRes.error ?? "Could not load this stock count");
        return;
      }
      if (itemsRes.error || !itemsRes.data) {
        log.error("could not load count lines", { countId: id, message: itemsRes.error });
        setLoadError(itemsRes.error ?? "Could not load the count lines");
        return;
      }
      setData(summaryRes.data);
      setItems(Array.isArray(itemsRes.data) ? itemsRes.data : itemsRes.data.items);
    }).finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="py-6">
        <ErrorBanner message={loadError} onRetry={() => { setLoading(true); setLoadError(""); void load(); }} />
        <Link href="/stock-audit" className="text-blue-600 text-sm mt-3 inline-block">Back to audits</Link>
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

  const isAssignee = currentUserId !== undefined && data.assignedToId === currentUserId;
  const isWholeStore = Boolean(data.storeId) && !data.warehouseId;
  // Not until the session has resolved: before that `isAssignee` is false for everyone, and
  // the assignee would see the approve card flash for a moment. The API refuses them anyway.
  const mayApproveHere =
    currentUserId !== undefined && data.status === "COMPLETED" && canApprove && !isAssignee;

  // What stock in the scope is NOW, per line. The items route sends `liveQty`; a response
  // without it (an older server) falls back to the snapshot so nothing renders undefined.
  const liveOf = (i: StockCountItem) => i.liveQty ?? i.systemQty;
  const anyStale = items.some((i) => i.liveQty !== undefined && i.liveQty !== i.systemQty);

  // The differences the approver is deciding on — against LIVE stock, which is what "set
  // system stock" would actually change. The summary cards above keep the snapshot figures
  // the counter worked from; both are shown, neither pretends to be the other.
  const countedLines = items.filter((i) => i.countedQty !== null);
  const differing = countedLines.filter((i) => (i.countedQty ?? 0) - liveOf(i) !== 0);
  const netUnits = differing.reduce((sum, i) => sum + ((i.countedQty ?? 0) - liveOf(i)), 0);
  const zeroLines = countedLines.filter((i) => i.countedQty === 0);
  const writtenOff = zeroLines.reduce((sum, i) => sum + liveOf(i), 0);

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
    liveQty: liveOf(i),
    countedQty: i.countedQty ?? "—",
    variance: i.variance ?? "—",
    bin: i.product.bin?.code || "—",
  }));

  const applyReady = mode === "verify" || (data.canCorrectStock && (!isWholeStore || correctionWarehouseId !== ""));
  const chosenWarehouseName = isWholeStore
    ? data.correctionWarehouses.find((w) => w.id === correctionWarehouseId)?.name ?? ""
    : data.scopeLabel;

  const handleApprove = async () => {
    setActionLoading(true);
    setActionError("");
    const body: Record<string, unknown> = { status: "APPROVED" };
    if (mode === "apply") {
      body.applyToStock = true;
      if (isWholeStore) body.correctionWarehouseId = correctionWarehouseId;
    }
    const { data: res, error } = await apiTry<{ applied: AppliedSummary | null }>(`/api/stock-counts/${id}`, {
      method: "PUT",
      json: body,
      timeoutMs: 60_000,
    });
    setActionLoading(false);
    setShowApproveSheet(false);
    if (error) {
      // The API's sentence, verbatim — it names the reason (a warehouse gone inactive, a
      // count that changed underneath, an assignee signing their own work).
      log.error("approve failed", { countId: id, mode, message: error });
      setActionError(error);
      return;
    }
    log.info("stock count approved", { countId: id, mode, changed: res?.applied?.changed ?? 0 });
    setApproved({ mode, applied: res?.applied ?? null });
  };

  const handleReject = async () => {
    const reason = selectedChip && rejectReason
      ? `${selectedChip}: ${rejectReason}`
      : selectedChip || rejectReason || "No reason given";
    setActionLoading(true);
    setActionError("");
    const { error } = await apiTry(`/api/stock-counts/${id}`, {
      method: "PUT",
      json: { status: "REJECTED", rejectionReason: reason },
      timeoutMs: 60_000,
    });
    setActionLoading(false);
    setShowRejectModal(false);
    if (error) {
      log.error("reject failed", { countId: id, message: error });
      setActionError(error);
      return;
    }
    router.push(`/stock-audit/${id}`);
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
            {data.assignedTo.name} | {data.scopeLabel}
            {data.bin ? ` | Bin ${data.bin.code} (${data.bin.name})${data.bin.floor ? ` Fl ${data.bin.floor}` : ""}${data.bin.zone ? ` Zone ${data.bin.zone}` : ""}` : ""}
            {data.completedAt && ` | Completed: ${new Date(data.completedAt).toLocaleDateString("en-IN")}`}
          </p>
          {data.bin?.directions && (
            <p className="text-[11px] text-blue-700 bg-blue-50 border border-blue-200 rounded px-2 py-0.5 mt-1 inline-block">
              📍 Directions: {data.bin.directions}
            </p>
          )}
        </div>
        <Badge variant={data.status === "COMPLETED" ? "success" : data.status === "APPROVED" ? "success" : data.status === "REJECTED" ? "danger" : "info"}>
          {data.status === "IN_PROGRESS" ? "In Progress" : data.status.charAt(0) + data.status.slice(1).toLowerCase()}
        </Badge>
      </div>

      {/* Summary cards — the snapshot figures the counter worked from */}
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
            {signed(data.totalVariance)}
          </p>
          <p className="text-[10px] text-slate-500">Net units</p>
        </CardContent></Card>
      </div>

      {/* Differences — against stock as it is NOW, which is what an approval would change */}
      {mayApproveHere && (
        <Card className="mb-3">
          <CardContent className="p-3">
            <p className="text-xs font-semibold text-slate-900 mb-1">Differences against current stock</p>
            <p className="text-xs text-slate-600">
              <span className="font-medium text-slate-900">{differing.length}</span> line{differing.length === 1 ? "" : "s"} differ
              {" · "}net <span className={`font-medium ${netUnits === 0 ? "text-green-700" : netUnits > 0 ? "text-blue-700" : "text-red-700"}`}>{signed(netUnits)}</span> units
              {zeroLines.length > 0 && (
                <>
                  {" · "}
                  <span className="font-medium text-slate-900">{zeroLines.length}</span> line{zeroLines.length === 1 ? "" : "s"} counted 0
                  {writtenOff > 0 && <> (<span className="font-medium text-red-700">{writtenOff}</span> units on the books)</>}
                </>
              )}
            </p>
            {anyStale && (
              <p className="text-[11px] text-amber-700 mt-1.5 flex items-start gap-1">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                Stock moved since this audit was raised. The <span className="font-medium">Now</span> column shows what the books hold today; the differences above use it.
              </p>
            )}
          </CardContent>
        </Card>
      )}

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

      {/* The approver's choice, then Approve / Reject */}
      {data.status === "COMPLETED" && canApprove && isAssignee && (
        <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg p-2.5 mb-3">
          You counted this audit. Someone else must approve it.
        </p>
      )}
      {mayApproveHere && (
        <Card className="mb-3">
          <CardContent className="p-3">
            <p className="text-xs font-semibold text-slate-900 mb-2">How do you want to approve?</p>
            <div className="flex flex-col gap-2">
              <label className={`flex items-start gap-2.5 rounded-lg border p-2.5 cursor-pointer ${mode === "verify" ? "border-slate-900 bg-slate-50" : "border-slate-200"}`}>
                <input type="radio" name="approve-mode" className="mt-0.5" checked={mode === "verify"} onChange={() => setMode("verify")} />
                <span>
                  <span className="block text-sm font-medium text-slate-900">Record the differences only</span>
                  <span className="block text-[11px] text-slate-500">System stock is unchanged. The variance stays on this audit for reference.</span>
                </span>
              </label>
              {data.canCorrectStock ? (
                canCorrectStockPerm ? (
                  <label className={`flex items-start gap-2.5 rounded-lg border p-2.5 cursor-pointer ${mode === "apply" ? "border-slate-900 bg-slate-50" : "border-slate-200"}`}>
                    <input type="radio" name="approve-mode" className="mt-0.5" checked={mode === "apply"} onChange={() => setMode("apply")} />
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-medium text-slate-900">Set system stock to the counts</span>
                      <span className="block text-[11px] text-slate-500">
                        {isWholeStore
                          ? "Every counted line becomes the store's stock. A surplus is booked to the warehouse you choose; a shortage is taken from the store's warehouses in picker order. An adjustment entry is written for each line that changes."
                          : `Every counted line becomes the stock at ${data.scopeLabel}. An adjustment entry is written for each line that changes.`}
                      </span>
                      {isWholeStore && mode === "apply" && (
                        <select
                          value={correctionWarehouseId}
                          onChange={(e) => setCorrectionWarehouseId(e.target.value)}
                          className="mt-2 w-full h-9 rounded-lg border border-slate-200 px-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-400"
                        >
                          <option value="">Choose the warehouse that receives a surplus…</option>
                          {data.correctionWarehouses.map((w) => (
                            <option key={w.id} value={w.id}>{w.name}</option>
                          ))}
                        </select>
                      )}
                    </span>
                  </label>
                ) : (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-xs text-slate-500">
                    <p className="font-medium text-slate-700">Set system stock to the counts (Disabled)</p>
                    <p className="text-[11px] text-amber-700 mt-0.5">
                      Requires <code>stock_correction.approve</code> module permission to apply audit counts to live system stock.
                    </p>
                  </div>
                )
              ) : (
                <p className="text-[11px] text-slate-500 rounded-lg border border-dashed border-slate-200 p-2.5">
                  {isWholeStore
                    ? "This store has no active warehouse to receive a correction, so its counts cannot be applied to stock. It can only be approved as a record of the differences."
                    : "This audit has no recorded location, so its counts cannot be applied to stock. It can only be approved as a record of the differences."}
                </p>
              )}
            </div>
            <div className="flex gap-2 mt-3">
              <button onClick={() => setShowApproveSheet(true)} disabled={actionLoading || !applyReady}
                className="flex-1 flex items-center justify-center gap-2 bg-green-600 text-white py-2.5 rounded-lg text-sm font-medium disabled:opacity-50">
                <ShieldCheck className="h-4 w-4" /> Approve
              </button>
              <button onClick={() => setShowRejectModal(true)} disabled={actionLoading}
                className="flex-1 flex items-center justify-center gap-2 bg-red-600 text-white py-2.5 rounded-lg text-sm font-medium disabled:opacity-50">
                <XCircle className="h-4 w-4" /> Reject
              </button>
            </div>
          </CardContent>
        </Card>
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
            <div className="flex items-center gap-2 mt-2 pt-2 border-t border-slate-100">
              <div className="text-center flex-1">
                <p className="text-[10px] text-slate-500">System</p>
                <p className="text-sm font-semibold text-slate-700">{item.systemQty}</p>
              </div>
              {anyStale && (
                <>
                  <div className="text-slate-300">→</div>
                  <div className="text-center flex-1">
                    <p className="text-[10px] text-slate-500">Now</p>
                    <p className={`text-sm font-semibold ${liveOf(item) !== item.systemQty ? "text-amber-700" : "text-slate-700"}`}>{liveOf(item)}</p>
                  </div>
                </>
              )}
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
                  {item.variance === null ? "—" : signed(item.variance)}
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

      {/* Approve confirm sheet — repeats the choice, so nothing that overwrites stock fires on one tap */}
      {showApproveSheet && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end justify-center"
          onClick={() => !actionLoading && setShowApproveSheet(false)}>
          <div className="bg-white w-full max-w-lg rounded-t-2xl p-4 pb-8 animate-in slide-in-from-bottom"
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-base font-bold text-slate-900">
                {mode === "apply" ? "Set system stock to the counts?" : "Approve as a record of the differences?"}
              </h3>
              <button onClick={() => setShowApproveSheet(false)} disabled={actionLoading} className="p-1 rounded-full hover:bg-slate-100">
                <X className="h-5 w-5 text-slate-400" />
              </button>
            </div>
            <div className="text-xs text-slate-600 space-y-1 mb-3">
              <p><span className="font-medium text-slate-900">{countedLines.length}</span> counted line{countedLines.length === 1 ? "" : "s"}, <span className="font-medium text-slate-900">{differing.length}</span> differ from current stock, net <span className="font-medium text-slate-900">{signed(netUnits)}</span> units.</p>
              {zeroLines.length > 0 && (
                <p><span className="font-medium text-slate-900">{zeroLines.length}</span> line{zeroLines.length === 1 ? "" : "s"} counted 0{writtenOff > 0 ? <> — <span className="font-medium text-red-700">{writtenOff}</span> units {mode === "apply" ? "will be written off" : "are on the books for them"}</> : ""}.</p>
              )}
              {mode === "apply" ? (
                <p className="text-red-700 font-medium flex items-start gap-1 pt-1">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  This overwrites stock at {chosenWarehouseName || data.scopeLabel}. There is no undo except another audit.
                </p>
              ) : (
                <p className="pt-1">System stock stays as it is. The differences remain on this audit for reference.</p>
              )}
            </div>
            <div className="flex gap-2">
              <button onClick={() => setShowApproveSheet(false)} disabled={actionLoading}
                className="flex-1 py-2.5 rounded-lg text-sm font-medium bg-slate-100 text-slate-600 disabled:opacity-50">
                Cancel
              </button>
              <button onClick={handleApprove} disabled={actionLoading}
                className={`flex-1 flex items-center justify-center gap-2 text-white py-2.5 rounded-lg text-sm font-medium disabled:opacity-50 ${mode === "apply" ? "bg-red-600" : "bg-green-600"}`}>
                {actionLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                {actionLoading ? "Approving…" : mode === "apply" ? "Set stock & approve" : "Approve"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Receipt — what the approval did; closing it returns to the count screen */}
      {approved && (
        <ActionConfirmation
          open
          onClose={() => router.push(`/stock-audit/${id}`)}
          type="success"
          title={approved.mode === "apply" ? "Stock corrected" : "Approved"}
          referenceId={data.countNo || data.title}
          performedBy={session?.user?.name ?? undefined}
          items={
            approved.applied
              ? [
                  { label: "Where", value: approved.applied.scope === "store" ? `${data.scopeLabel} · surplus to ${approved.applied.warehouse}` : approved.applied.warehouse },
                  { label: "Lines applied", value: `${approved.applied.lines}` },
                  { label: "Lines changed", value: `${approved.applied.changed}` },
                  { label: "Net units", value: signed(approved.applied.netUnits) },
                  ...(approved.applied.zeroLines > 0
                    ? [{ label: "Written off", value: `${approved.applied.writtenOff} units across ${approved.applied.zeroLines} line${approved.applied.zeroLines === 1 ? "" : "s"}` }]
                    : []),
                ]
              : [
                  { label: "Mode", value: "Differences recorded, stock unchanged" },
                  { label: "Lines that differ", value: `${differing.length}` },
                  { label: "Net units", value: signed(netUnits) },
                ]
          }
        />
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
