"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { FileText, AlertTriangle, Search, Cloud, Loader2, Download, Clock, Zap } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ExportButtons } from "@/components/export-buttons";
import { DesktopTable } from "@/components/desktop-table";
import { exportToExcel, exportToPDF, type ExportColumn } from "@/lib/export";
import { useDebounce } from "@/lib/utils";
import { type DateRangeKey } from "@/components/date-filter";
import { FilterSheet } from "@/components/filter-sheet";
import { usePermissions } from "@/lib/use-permissions";
import { SkeletonList } from "@/components/ui/skeleton";

const BILL_COLUMNS: ExportColumn[] = [
  { header: "Bill No", key: "billNo" },
  { header: "Vendor", key: "vendor.name" },
  { header: "Bill Date", key: "billDate", format: (v) => new Date(String(v)).toLocaleDateString("en-IN") },
  { header: "Due Date", key: "dueDate", format: (v) => new Date(String(v)).toLocaleDateString("en-IN") },
  { header: "Amount", key: "amount", format: (v) => `₹${Number(v || 0).toLocaleString("en-IN")}` },
  { header: "Paid", key: "paidAmount", format: (v) => `₹${Number(v || 0).toLocaleString("en-IN")}` },
  { header: "Balance", key: "amount", format: (_v, row) => `₹${(Number(row.amount || 0) - Number(row.paidAmount || 0)).toLocaleString("en-IN")}` },
  { header: "Status", key: "status", format: (v) => String(v).replace(/_/g, " ") },
];

interface BillItem {
  id: string;
  billNo: string;
  amount: number;
  paidAmount: number;
  status: string;
  dueDate: string;
  billDate: string;
  billedTo: string | null;
  vendor: { name: string; code: string; paymentTermDays?: number };
}

interface ZohoBillPreview {
  id: string;
  zohoId: string;
  data: {
    billNumber: string;
    vendorName: string;
    date: string;
    dueDate: string;
    total: number;
    balance: number;
    status: string;
    lineItems: Array<{ name: string; sku: string; quantity: number; rate: number; itemTotal: number }>;
  };
}

const STATUS_FILTERS = ["ALL", "OVERDUE", "PENDING", "PARTIALLY_PAID", "PAID"];

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount);
}

export default function BillsPage() {
  const { data: session } = useSession();
  const role = (session?.user as { role?: string })?.role || "";
  const { canFetch: canFetchCheck } = usePermissions(role);
  const canFetchBills = canFetchCheck("bills");

  const [bills, setBills] = useState<BillItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("ALL");
  const [billedToFilter, setBilledToFilter] = useState<"ALL" | "HUB" | "CENTRE">("ALL");
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search);

  // Fetch Bills state (same pattern as deliveries Fetch Invoices)
  const [fetchStep, setFetchStep] = useState<"idle" | "pickDate" | "fetching" | "selecting" | "importing">("idle");
  const [fetchProgress, setFetchProgress] = useState("");
  const [billPreviews, setBillPreviews] = useState<ZohoBillPreview[]>([]);
  const [selectedBills, setSelectedBills] = useState<Set<string>>(new Set());
  const [fetchError, setFetchError] = useState("");
  const [fetchPullId, setFetchPullId] = useState("");
  const [billSearch, setBillSearch] = useState("");
  const [fetchDays, setFetchDays] = useState<number>(7);
  const [fetchCustomFrom, setFetchCustomFrom] = useState("");
  const [dateFilter, setDateFilter] = useState<DateRangeKey>("all");
  const [dateFrom, setDateFrom] = useState<string | undefined>();
  const [dateTo, setDateTo] = useState<string | undefined>();

  // Aging + CD data
  const [aging, setAging] = useState<{ buckets: { current: { count: number; amount: number }; days30: { count: number; amount: number }; days60: { count: number; amount: number }; days90plus: { count: number; amount: number } }; totalOutstanding: number; cdWarnings: Array<{ billId: string; vendorName: string; cdDeadline: string; cdPercentage: number; balance: number; daysLeft: number }> } | null>(null);
  const [agingFilter, setAgingFilter] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/bills/aging-summary")
      .then((r) => r.json())
      .then((res) => { if (res.success) setAging(res.data); })
      .catch(() => {});
  }, []);

  const fetchData = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({ limit: "50" });
    if (agingFilter) {
      params.set("aging", agingFilter);
    } else if (filter === "OVERDUE") {
      params.set("overdue", "true");
    } else if (filter !== "ALL") {
      params.set("status", filter);
    }
    if (debouncedSearch.length >= 2) params.set("search", debouncedSearch);
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    if (billedToFilter !== "ALL") params.set("billedTo", billedToFilter);

    fetch(`/api/bills?${params}`)
      .then((r) => r.json())
      .then((res) => { if (res.success) setBills(res.data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [filter, agingFilter, debouncedSearch, dateFrom, dateTo, billedToFilter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const fetchWithTimeout = async (url: string, options?: RequestInit, timeoutMs = 20000) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      return res;
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") throw new Error("Request timed out — Zoho may be slow, try again");
      throw e;
    } finally { clearTimeout(timer); }
  };

  const handleFetchBills = async () => {
    setFetchStep("fetching");
    setFetchError("");
    setFetchProgress("Connecting to Zoho...");
    try {
      const initRes = await fetchWithTimeout("/api/zoho/trigger-pull", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step: "init" }),
      }).then(r => r.json());
      if (!initRes.success) throw new Error(initRes.error || "Init failed");
      const pullId = initRes.data.pullId;
      setFetchPullId(pullId);

      const searchTerm = billSearch.trim();
      let fromDate: string;
      if (searchTerm) {
        fromDate = "";
      } else if (fetchDays === -1 && fetchCustomFrom) {
        fromDate = fetchCustomFrom;
      } else {
        const fromDateObj = new Date();
        fromDateObj.setDate(fromDateObj.getDate() - fetchDays);
        fromDate = fromDateObj.toISOString().slice(0, 10);
      }
      const label = searchTerm ? `"${searchTerm}"` : fetchDays === -1 ? "custom range" : `last ${fetchDays} days`;
      setFetchProgress(searchTerm ? `Searching ${label} in Zoho...` : `Pulling bills (${label})...`);
      const billRes = await fetchWithTimeout("/api/zoho/trigger-pull", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          step: "bills", pullId,
          ...(searchTerm ? { searchText: searchTerm } : { fromDate }),
        }),
      }, 60000).then(r => r.json());
      if (!billRes.success) throw new Error(billRes.error || "Bills fetch failed");

      const src = billRes.data.source === "inventory" ? "Zoho Inventory" : billRes.data.source === "pos" ? "Zakya" : "Zoho Books";
      const billsFound = billRes.data.billsNew || 0;
      setFetchProgress(`Found ${billsFound} new bills from ${src}, saving...`);

      const finalizeRes = await fetchWithTimeout("/api/zoho/trigger-pull", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          step: "finalize", pullId,
          billsNew: billRes.data.billsNew, apiCalls: billRes.data.apiCalls,
          allErrors: billRes.data.errors || [],
        }),
      }).then(r => r.json());
      if (!finalizeRes.success) {
        console.warn("Finalize failed:", finalizeRes.error);
      }

      setFetchProgress("Loading preview...");
      const previewRes = await fetchWithTimeout(`/api/zoho/pull-review?pullId=${pullId}`).then(r => r.json());
      if (!previewRes.success) throw new Error(previewRes.error || "Failed to load preview");
      const billItems = (previewRes.data.previews || []).filter(
        (p: ZohoBillPreview & { entityType: string; status: string }) => p.entityType === "bill" && p.status === "PENDING"
      );
      setBillPreviews(billItems);
      setSelectedBills(new Set(billItems.map((b: ZohoBillPreview) => b.id)));
      setFetchStep(billItems.length > 0 ? "selecting" : "idle");
      const billErrors = billRes.data.errors || [];
      if (billItems.length === 0) {
        const errDetail = billErrors.length > 0 ? `: ${billErrors.join("; ")}` : "";
        const debugInfo = billsFound > 0 ? ` (${billsFound} found from API but 0 in preview — check finalize)` : "";
        setFetchError(`No new bills found (${src})${errDetail}${debugInfo}`);
      } else if (billErrors.length > 0) {
        setFetchError(`Warnings: ${billErrors.join("; ")}`);
      }
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : "Fetch failed");
      setFetchStep("idle");
    } finally {
      setFetchProgress("");
    }
  };

  const toggleBill = (id: string) => {
    setSelectedBills(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleImportSelected = async () => {
    if (selectedBills.size === 0) return;
    setFetchStep("importing");
    try {
      const res = await fetch("/api/zoho/pull-review/approve", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pullId: fetchPullId, action: "approve",
          entityType: "bill", previewIds: Array.from(selectedBills),
          source: "accounting",
        }),
      }).then(r => r.json());
      if (!res.success) throw new Error(res.error || "Import failed");
      const imported = res.data?.bills || 0;
      const errors = res.data?.errors || [];
      setFetchStep("idle");
      setBillPreviews([]);
      setSelectedBills(new Set());
      fetchData();
      if (errors.length > 0) {
        setFetchError(`Imported ${imported} bill(s). Warnings: ${errors.join("; ")}`);
      }
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : "Import failed");
      setFetchStep("selecting");
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h1 className="text-lg font-bold text-slate-900">Vendor Bills</h1>
        <div className="flex items-center gap-2">
          {canFetchBills && (
            <div className="flex items-center gap-1">
              <input
                type="text" placeholder="Bill no..." value={billSearch}
                onChange={(e) => setBillSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleFetchBills()}
                className="w-20 px-2 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-400"
              />
              {billSearch.trim() ? (
                <button onClick={handleFetchBills} disabled={fetchStep === "fetching" || fetchStep === "importing"}
                  className="flex items-center gap-1.5 bg-slate-900 text-white px-3 py-2 rounded-lg text-xs font-medium disabled:opacity-50">
                  {fetchStep === "fetching" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Cloud className="h-3.5 w-3.5" />}
                  Search
                </button>
              ) : (
                <button onClick={() => setFetchStep("pickDate")} disabled={fetchStep === "fetching" || fetchStep === "importing"}
                  className="flex items-center gap-1.5 bg-slate-900 text-white px-3 py-2 rounded-lg text-xs font-medium disabled:opacity-50">
                  {fetchStep === "fetching" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Cloud className="h-3.5 w-3.5" />}
                  {fetchStep === "fetching" ? "Fetching..." : "Fetch Bills"}
                </button>
              )}
            </div>
          )}
          <ExportButtons
            onExcel={() => exportToExcel(bills as unknown as Record<string, unknown>[], BILL_COLUMNS, "vendor-bills")}
            onPDF={() => exportToPDF("Vendor Bills", bills as unknown as Record<string, unknown>[], BILL_COLUMNS, "vendor-bills")}
          />
        </div>
      </div>

      {/* Date Picker for Fetch */}
      {fetchStep === "pickDate" && (
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 mb-2">
          <p className="text-xs font-medium text-slate-700 mb-2">Fetch bills created in Zoho within:</p>
          <div className="flex flex-wrap gap-2 mb-3">
            {[
              { label: "3 days", value: 3 },
              { label: "7 days", value: 7 },
              { label: "14 days", value: 14 },
              { label: "30 days", value: 30 },
              { label: "Custom", value: -1 },
            ].map((opt) => (
              <button key={opt.value} onClick={() => setFetchDays(opt.value)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                  fetchDays === opt.value
                    ? "bg-slate-900 text-white border-slate-900"
                    : "bg-white text-slate-600 border-slate-300 hover:border-slate-400"
                }`}>
                {opt.label}
              </button>
            ))}
          </div>
          {fetchDays === -1 && (
            <div className="flex gap-2 mb-3">
              <div>
                <label className="text-[10px] text-slate-500 block mb-0.5">From</label>
                <input type="date" value={fetchCustomFrom} onChange={(e) => setFetchCustomFrom(e.target.value)}
                  className="px-2 py-1.5 text-xs border border-slate-300 rounded-lg" />
              </div>
            </div>
          )}
          <div className="flex gap-2">
            <button onClick={handleFetchBills} disabled={fetchDays === -1 && !fetchCustomFrom}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-900 text-white disabled:opacity-50">
              <Cloud className="h-3.5 w-3.5" /> Fetch
            </button>
            <button onClick={() => setFetchStep("idle")}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-white text-slate-500 border border-slate-300">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Progress Banner */}
      {fetchStep === "fetching" && fetchProgress && (
        <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-lg p-2.5 mb-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-600 shrink-0" />
          <span className="text-xs text-blue-700 font-medium">{fetchProgress}</span>
        </div>
      )}

      {/* Fetch Error */}
      {fetchError && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-2.5 mb-2 text-xs text-amber-700">
          {fetchError}
          <button onClick={() => setFetchError("")} className="ml-2 underline">dismiss</button>
        </div>
      )}

      {/* Bill Selection Panel */}
      {fetchStep === "selecting" && billPreviews.length > 0 && (
        <Card className="mb-3 border-blue-200 bg-blue-50/50">
          <CardContent className="p-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-blue-800">
                {billPreviews.length} new bill{billPreviews.length !== 1 ? "s" : ""} from Zoho (Apr 1 onwards)
              </p>
              <div className="flex gap-2">
                <button onClick={() => { setFetchStep("idle"); setBillPreviews([]); }}
                  className="text-xs text-slate-500 underline">Cancel</button>
                <button onClick={handleImportSelected} disabled={selectedBills.size === 0}
                  className="flex items-center gap-1 bg-blue-600 text-white px-3 py-1.5 rounded-md text-xs font-medium disabled:opacity-50">
                  <Download className="h-3 w-3" /> Import {selectedBills.size}
                </button>
              </div>
            </div>
            <div className="space-y-1.5 max-h-64 overflow-y-auto">
              {billPreviews.map((bill) => (
                <label key={bill.id}
                  className={`flex items-start gap-2 p-2 rounded-lg cursor-pointer transition-colors ${
                    selectedBills.has(bill.id) ? "bg-blue-100 border border-blue-300" : "bg-white border border-slate-200"
                  }`}>
                  <input type="checkbox" checked={selectedBills.has(bill.id)}
                    onChange={() => toggleBill(bill.id)} className="mt-0.5 rounded" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-slate-900">{bill.data.billNumber}</span>
                      <span className="text-xs font-semibold text-slate-700">{formatCurrency(bill.data.total)}</span>
                    </div>
                    <p className="text-[10px] text-slate-600">{bill.data.vendorName}</p>
                    <p className="text-[10px] text-slate-400">
                      {new Date(bill.data.date).toLocaleDateString("en-IN")} | Due: {new Date(bill.data.dueDate).toLocaleDateString("en-IN")}
                    </p>
                    {bill.data.lineItems.length > 0 && (
                      <p className="text-[10px] text-slate-400 mt-0.5">
                        {bill.data.lineItems.slice(0, 2).map(li => `${li.name} x${li.quantity}`).join(" | ")}
                        {bill.data.lineItems.length > 2 && ` +${bill.data.lineItems.length - 2}`}
                      </p>
                    )}
                  </div>
                </label>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Importing indicator */}
      {fetchStep === "importing" && (
        <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-lg p-3 mb-3">
          <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
          <span className="text-xs text-blue-700">Importing {selectedBills.size} bills...</span>
        </div>
      )}

      {/* Aging Bucket Cards */}
      {aging && (
        <div className="mb-3">
          <div className="flex items-center gap-2 mb-2">
            <Clock className="h-4 w-4 text-slate-500" />
            <span className="text-xs font-semibold text-slate-700">Payables Aging</span>
            <span className="text-xs text-slate-400">Total: {formatCurrency(aging.totalOutstanding)}</span>
            {agingFilter && (
              <button onClick={() => setAgingFilter(null)} className="ml-auto text-[10px] text-blue-600 underline">Clear</button>
            )}
          </div>
          <div className="grid grid-cols-4 gap-2">
            {[
              { key: "current", label: "Current", data: aging.buckets.current, color: "text-green-600", bg: "bg-green-50 border-green-200" },
              { key: "0-30", label: "1-30d", data: aging.buckets.days30, color: "text-yellow-600", bg: "bg-yellow-50 border-yellow-200" },
              { key: "30-60", label: "31-60d", data: aging.buckets.days60, color: "text-orange-600", bg: "bg-orange-50 border-orange-200" },
              { key: "60+", label: "60d+", data: aging.buckets.days90plus, color: "text-red-600", bg: "bg-red-50 border-red-200" },
            ].map((bucket) => (
              <button
                key={bucket.key}
                onClick={() => setAgingFilter(agingFilter === bucket.key ? null : bucket.key)}
                className={`p-2 rounded-lg border text-left transition-all min-h-[44px] ${
                  agingFilter === bucket.key ? `${bucket.bg} ring-2 ring-offset-1 ring-slate-400` : "bg-white border-slate-200 hover:border-slate-300"
                }`}
              >
                <p className="text-[11px] font-medium text-slate-600">{bucket.label}</p>
                <p className={`text-xl font-bold tabular-nums leading-none mt-0.5 ${bucket.color}`}>{bucket.data.count}</p>
                <p className="text-[10px] text-slate-500 tabular-nums truncate mt-0.5">{formatCurrency(bucket.data.amount)}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* CD Deadline Warnings */}
      {aging && aging.cdWarnings.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-2.5 mb-3">
          <div className="flex items-center gap-1.5 mb-1.5">
            <Zap className="h-3.5 w-3.5 text-amber-600" />
            <span className="text-xs font-semibold text-amber-800">Cash Discount Deadlines</span>
          </div>
          <div className="space-y-1">
            {aging.cdWarnings.slice(0, 5).map((w) => (
              <Link key={w.billId} href={`/bills/${w.billId}`}
                className="flex items-center justify-between text-xs hover:bg-amber-100 rounded px-1 py-0.5 transition-colors">
                <span className="text-slate-700 truncate">{w.vendorName}</span>
                <span className={`shrink-0 font-medium tabular-nums ${w.daysLeft <= 0 ? "text-red-600" : w.daysLeft <= 3 ? "text-orange-600" : "text-amber-600"}`}>
                  {w.daysLeft <= 0 ? `Expired ${Math.abs(w.daysLeft)}d ago` : `${w.daysLeft}d left`} · {w.cdPercentage}% · {formatCurrency(w.balance)}
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="relative mb-3">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <Input
          placeholder="Search bill no or vendor..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      <FilterSheet
        className="mb-3"
        dateValue={dateFilter}
        onDateChange={(key, from, to) => { setDateFilter(key); setDateFrom(from); setDateTo(to); }}
        groups={[
          {
            label: "Status",
            value: filter,
            defaultValue: "ALL",
            options: STATUS_FILTERS.map((s) => ({ key: s, label: s === "ALL" ? "All" : s.replace(/_/g, " ") })),
            onChange: (key) => setFilter(key),
          },
          {
            label: "Location",
            value: billedToFilter,
            defaultValue: "ALL",
            options: [
              { key: "ALL", label: "All Locations" },
              { key: "HUB", label: "Hub" },
              { key: "CENTRE", label: "Centre" },
            ],
            onChange: (key) => setBilledToFilter(key as "ALL" | "HUB" | "CENTRE"),
          },
        ]}
      />

      {loading ? (
        <SkeletonList count={6} type="card" />
      ) : (
        <>
        <DesktopTable
          className="hidden lg:block"
          rows={bills}
          rowKey={(bill) => bill.id}
          rowHref={(bill) => `/bills/${bill.id}`}
          emptyText="No bills found"
          columns={[
            { header: "Vendor", cell: (bill) => {
              const due = new Date(bill.billDate); due.setDate(due.getDate() + (bill.vendor.paymentTermDays || 30));
              const isOverdue = due < new Date() && bill.amount - bill.paidAmount > 0;
              return <div className="flex items-center gap-1.5">{isOverdue && <AlertTriangle className="h-3.5 w-3.5 text-red-500 shrink-0" />}<span className="font-medium text-slate-900">{bill.vendor.name}</span></div>;
            } },
            { header: "Bill No", cell: (bill) => <span className="text-slate-500">{bill.billNo}</span> },
            { header: "Due", cell: (bill) => { const due = new Date(bill.billDate); due.setDate(due.getDate() + (bill.vendor.paymentTermDays || 30)); return due.toLocaleDateString("en-IN"); }, className: "whitespace-nowrap text-slate-500" },
            { header: "Amount", cell: (bill) => <span className="tabular-nums">{formatCurrency(bill.amount)}</span>, className: "text-right whitespace-nowrap" },
            { header: "Paid", cell: (bill) => <span className="tabular-nums text-green-600">{formatCurrency(bill.paidAmount)}</span>, className: "text-right whitespace-nowrap" },
            { header: "Balance", cell: (bill) => { const r = bill.amount - bill.paidAmount; return <span className={`tabular-nums font-semibold ${r > 0 ? "text-red-600" : "text-green-600"}`}>{formatCurrency(r)}</span>; }, className: "text-right whitespace-nowrap" },
            { header: "Status", cell: (bill) => {
              const due = new Date(bill.billDate); due.setDate(due.getDate() + (bill.vendor.paymentTermDays || 30));
              const isOverdue = due < new Date() && bill.amount - bill.paidAmount > 0;
              return <Badge variant={bill.status === "PAID" ? "success" : isOverdue ? "danger" : "warning"} className="text-[10px]">{isOverdue ? "OVERDUE" : bill.status.replace(/_/g, " ")}</Badge>;
            } },
          ]}
        />
        <div className="space-y-2 lg:hidden">
          {bills.map((bill) => {
            const remaining = bill.amount - bill.paidAmount;
            // Overdue based on billDate + vendor payment terms from app
            const appDueDate = new Date(bill.billDate);
            appDueDate.setDate(appDueDate.getDate() + (bill.vendor.paymentTermDays || 30));
            const isOverdue = appDueDate < new Date() && remaining > 0;
            const overdueDays = Math.floor((Date.now() - appDueDate.getTime()) / (1000 * 60 * 60 * 24));
            const accent = isOverdue
              ? "border-l-red-500"
              : bill.status === "PAID"
              ? "border-l-green-500"
              : bill.status === "PARTIALLY_PAID" || bill.status === "PENDING"
              ? "border-l-amber-400"
              : "border-l-slate-200";
            return (
              <Link
                key={bill.id}
                href={`/bills/${bill.id}`}
                className={`block rounded-xl border border-slate-200 border-l-4 ${accent} bg-white shadow-sm transition-colors active:bg-slate-50 focus-ring`}
              >
                <div className="p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        {isOverdue && <AlertTriangle className="h-3.5 w-3.5 text-red-500 shrink-0" />}
                        <p className="text-sm font-semibold text-slate-900 truncate">{bill.vendor.name}</p>
                      </div>
                      <p className="text-xs text-slate-500 tabular-nums truncate mt-0.5">
                        {bill.billNo} · Due {appDueDate.toLocaleDateString("en-IN")}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className={`text-sm font-bold tabular-nums ${remaining > 0 ? "text-red-600" : "text-green-600"}`}>
                        {formatCurrency(remaining)}
                      </p>
                      <Badge variant={bill.status === "PAID" ? "success" : isOverdue ? "danger" : "warning"} className="mt-1">
                        {isOverdue ? "OVERDUE" : bill.status.replace(/_/g, " ")}
                      </Badge>
                    </div>
                  </div>
                  {isOverdue && (
                    <p className="mt-1.5 text-xs font-semibold text-red-600 tabular-nums">{overdueDays}d overdue</p>
                  )}
                  {bill.paidAmount > 0 && remaining > 0 && (
                    <div className="mt-2">
                      <div className="w-full bg-slate-200 rounded-full h-1.5">
                        <div
                          className="bg-green-500 h-1.5 rounded-full"
                          style={{ width: `${Math.min(100, (bill.paidAmount / bill.amount) * 100)}%` }}
                        />
                      </div>
                      <p className="text-[11px] text-slate-400 tabular-nums mt-0.5">
                        Paid {formatCurrency(bill.paidAmount)} of {formatCurrency(bill.amount)}
                      </p>
                    </div>
                  )}
                </div>
              </Link>
            );
          })}

          {bills.length === 0 && (
            <div className="text-center py-12">
              <FileText className="h-8 w-8 text-slate-300 mx-auto mb-2" />
              <p className="text-sm text-slate-400">No bills found</p>
            </div>
          )}
        </div>

          {/* Totals — shown on all sizes */}
          {bills.length > 0 && (
            <Card className="bg-slate-50 mt-3">
              <CardContent className="p-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-500 tabular-nums">{bills.length} bill{bills.length !== 1 ? "s" : ""}</span>
                  <div className="flex gap-4">
                    <div className="text-right">
                      <p className="text-[11px] text-slate-500">Total</p>
                      <p className="text-sm font-bold text-slate-900 tabular-nums">{formatCurrency(bills.reduce((s, b) => s + b.amount, 0))}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[11px] text-slate-500">Paid</p>
                      <p className="text-sm font-bold text-green-600 tabular-nums">{formatCurrency(bills.reduce((s, b) => s + b.paidAmount, 0))}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[11px] text-slate-500">Balance</p>
                      <p className="text-sm font-bold text-red-600 tabular-nums">{formatCurrency(bills.reduce((s, b) => s + (b.amount - b.paidAmount), 0))}</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
