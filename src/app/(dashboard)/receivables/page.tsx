"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { FileText, AlertTriangle, Search, Plus, Cloud, Loader2, Download, Clock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useDebounce } from "@/hooks/use-debounce";
import { type DateRangeKey } from "@/components/date-filter";
import { FilterSheet } from "@/components/filter-sheet";
import { usePermissions } from "@/lib/use-permissions";
import { apiFetch, apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";

const log = createLogger("receivables");

interface InvoiceItem {
  id: string;
  invoiceNo: string;
  amount: number;
  paidAmount: number;
  status: string;
  invoiceDate: string;
  dueDate: string;
  customer: { name: string; phone?: string };
}

interface ZohoInvoicePreview {
  id: string;
  zohoId: string;
  data: {
    invoiceNumber: string;
    customerName: string;
    phone: string;
    date: string;
    total: number;
    balance: number;
    status: string;
    salesPerson: string;
    lineItems: Array<{ name: string; sku: string; quantity: number; rate: number; itemTotal: number }>;
  };
}

const STATUS_FILTERS = ["ALL", "OVERDUE", "PENDING", "PARTIALLY_PAID", "PAID"];

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount);
}

export default function ReceivablesPage() {
  const { canFetch: canFetchCheck } = usePermissions();
  // Customers › Fetch — the tick the pull routes check for `module: "customers"` (plan
  // 1410-per-module-fetch-permissions). It imports too: the import runs on the server now (Q1),
  // so `customers.create` is no longer needed for it.
  const canFetch = canFetchCheck("customers");

  const [invoices, setInvoices] = useState<InvoiceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("ALL");
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search);

  // Fetch Invoices state
  const [fetchStep, setFetchStep] = useState<"idle" | "pickDate" | "fetching" | "selecting" | "importing">("idle");
  const [invoicePreviews, setInvoicePreviews] = useState<ZohoInvoicePreview[]>([]);
  const [selectedInvoices, setSelectedInvoices] = useState<Set<string>>(new Set());
  const [fetchError, setFetchError] = useState("");
  const [fetchPullId, setFetchPullId] = useState("");
  const [fetchProgress, setFetchProgress] = useState("");
  const [fetchDays, setFetchDays] = useState<number>(30);
  const [fetchCustomFrom, setFetchCustomFrom] = useState("");
  const [fetchCustomTo, setFetchCustomTo] = useState("");
  const [dateFilter, setDateFilter] = useState<DateRangeKey>("all");
  const [dateFrom, setDateFrom] = useState<string | undefined>();
  const [dateTo, setDateTo] = useState<string | undefined>();

  // Aging data
  const [aging, setAging] = useState<{ buckets: { current: { count: number; amount: number }; days30: { count: number; amount: number }; days60: { count: number; amount: number }; days90plus: { count: number; amount: number } }; totalOutstanding: number; totalCount: number } | null>(null);
  const [agingFilter, setAgingFilter] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/customer-invoices/aging-summary")
      .then((r) => r.json())
      .then((res) => { if (res.success) setAging(res.data); })
      .catch(() => {});
  }, []);

  // Summary stats
  const totalOutstanding = aging?.totalOutstanding ?? invoices.reduce((sum, inv) => sum + Math.max(0, inv.amount - inv.paidAmount), 0);

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

    fetch(`/api/customer-invoices?${params}`)
      .then((r) => r.json())
      .then((res) => { if (res.success) setInvoices(res.data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [filter, agingFilter, debouncedSearch, dateFrom, dateTo]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleFetchInvoices = async () => {
    setFetchStep("fetching");
    setFetchError("");
    setFetchProgress("Connecting to Zoho...");
    try {
      // Step 1: Init. apiFetch, not fetch().then(r => r.json()) — an expired session answers
      // HTML, and the server's own sentence ("Zoho is not connected — …") is what is shown.
      const init = await apiFetch<{ pullId: string; sources?: { pos?: string; books?: string } }>(
        "/api/zoho/trigger-pull",
        { method: "POST", json: { module: "customers", step: "init" }, timeoutMs: 20_000 }
      );
      const pullId = init.pullId;
      setFetchPullId(pullId);

      // Check if POS or Books is connected for invoices
      const sources = init.sources || {};
      if (sources.pos === "skipped" && sources.books === "skipped") {
        throw new Error("Neither Zakya POS nor Zoho Books is connected. Go to Settings > Zoho to connect.");
      }

      // Step 2: Pull invoices with date range.
      //
      // No local date arithmetic (root cause #5): `new Date()` + `toISOString()` on an IST
      // browser rolls back a day before 05:30 IST, so the range chips asked Zoho for the
      // wrong days. And `fetchCustomTo` — which this screen has ALWAYS collected, with a real
      // input on the form — was never put in the body, so a custom To date did nothing at
      // all. Both are fixed by letting the server resolve the window.
      const windowBody =
        fetchDays === -1
          ? { fromDate: fetchCustomFrom || undefined, toDate: fetchCustomTo || undefined }
          : { days: fetchDays };
      const label = fetchDays === -1 ? "custom range" : `last ${fetchDays} days`;
      setFetchProgress(`Pulling unpaid invoices (${label})...`);
      const inv = await apiFetch<{ source?: string; invoicesNew?: number; apiCalls?: number; errors?: string[] }>(
        "/api/zoho/trigger-pull",
        { method: "POST", json: { module: "customers", step: "invoices", pullId, ...windowBody }, timeoutMs: 60_000 }
      );

      const finalize = (invoicesNew: number, apiCalls: number) =>
        apiTry("/api/zoho/trigger-pull", {
          method: "POST",
          json: { module: "customers", step: "finalize", pullId, invoicesNew, apiCalls, allErrors: inv.errors || [] },
          timeoutMs: 20_000,
        }).then((r) => { if (r.error) log.warn("finalize failed", { pullId, error: r.error }); });

      // Check if source was skipped
      if (inv.source === "skipped") {
        await finalize(0, 0);
        throw new Error(inv.errors?.[0] || "No invoice source connected");
      }

      // Step 3: Finalize
      const found = inv.invoicesNew || 0;
      setFetchProgress(`Found ${found} invoice${found !== 1 ? "s" : ""}. Finalizing...`);
      await finalize(inv.invoicesNew || 0, inv.apiCalls || 0);

      // Step 4: Load previews — filter for unpaid invoices
      setFetchProgress("Loading preview...");
      const preview = await apiFetch<{ previews?: (ZohoInvoicePreview & { entityType: string; status: string })[] }>(
        `/api/zoho/pull-review?module=customers&pullId=${encodeURIComponent(pullId)}`,
        { timeoutMs: 20_000 }
      );
      const invPreviews = (preview.previews || []).filter(
        (p) => p.entityType === "invoice" && p.status === "PENDING" && p.data.balance > 0
      );
      setInvoicePreviews(invPreviews);
      setSelectedInvoices(new Set(invPreviews.map((p) => p.id)));
      setFetchStep(invPreviews.length > 0 ? "selecting" : "idle");
      if (invPreviews.length === 0) setFetchError(`No unpaid invoices found (${label})`);
    } catch (e) {
      log.error("invoice fetch failed", { error: e instanceof Error ? e.message : String(e) });
      setFetchError(e instanceof Error ? e.message : "Fetch failed");
      setFetchStep("idle");
    } finally {
      setFetchProgress("");
    }
  };

  const toggleInvoice = (id: string) => {
    setSelectedInvoices(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleImportSelected = async () => {
    if (selectedInvoices.size === 0) return;
    setFetchStep("importing");
    try {
      // ONE call. The server finds or creates each customer by phone and writes the customer
      // invoice once (plan 1410-per-module-fetch-permissions, Q1) — this screen used to do
      // both itself, three requests per invoice, through two customers.create routes.
      // As before, the same approve also creates each invoice's delivery (Q2: "as today").
      const res = await apiFetch<{
        errors?: string[];
        receivables?: { created: number; existing: number; customersCreated: number };
      }>("/api/zoho/pull-review/approve", {
        method: "POST",
        json: { module: "customers", pullId: fetchPullId, action: "approve", previewIds: Array.from(selectedInvoices) },
        timeoutMs: 60_000,
      });
      const created = res?.receivables?.created ?? 0;
      const errors = res?.errors || [];
      log.info("invoices imported", { pullId: fetchPullId, created, existing: res?.receivables?.existing ?? 0, errors: errors.length });

      setFetchStep("idle");
      setInvoicePreviews([]);
      setSelectedInvoices(new Set());
      fetchData();
      if (errors.length > 0) {
        setFetchError(`Imported ${created} invoice(s). Not imported: ${errors.join("; ")}`);
      }
    } catch (e) {
      log.error("invoice import failed", { pullId: fetchPullId, error: e instanceof Error ? e.message : String(e) });
      setFetchError(e instanceof Error ? e.message : "Import failed");
      setFetchStep("selecting");
    }
  };

  return (
    <div className="pb-24">
      <div className="flex items-center justify-between mb-3">
        <h1 className="text-lg font-bold text-slate-900">Receivables</h1>
        {canFetch && fetchStep !== "pickDate" && (
          <button onClick={() => setFetchStep("pickDate")}
            disabled={fetchStep === "fetching" || fetchStep === "importing"}
            className="flex items-center gap-1.5 bg-slate-900 text-white px-3 py-2 rounded-lg text-xs font-medium disabled:opacity-50">
            {fetchStep === "fetching" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Cloud className="h-3.5 w-3.5" />}
            {fetchStep === "fetching" ? "Fetching..." : "Fetch Receivables"}
          </button>
        )}
      </div>

      {/* Fetch Date Picker */}
      {fetchStep === "pickDate" && (
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 mb-2">
          <p className="text-xs font-medium text-slate-700 mb-2">Fetch receivables from Zoho within:</p>
          <div className="flex flex-wrap gap-2 mb-3">
            {[
              { label: "7 days", value: 7 },
              { label: "14 days", value: 14 },
              { label: "30 days", value: 30 },
              { label: "90 days", value: 90 },
              { label: "Custom", value: -1 },
            ].map((opt) => (
              <button
                key={opt.value}
                onClick={() => setFetchDays(opt.value)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                  fetchDays === opt.value
                    ? "bg-slate-900 text-white border-slate-900"
                    : "bg-white text-slate-600 border-slate-300 hover:border-slate-400"
                }`}
              >
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
              <div>
                <label className="text-[10px] text-slate-500 block mb-0.5">To (optional)</label>
                <input type="date" value={fetchCustomTo} onChange={(e) => setFetchCustomTo(e.target.value)}
                  className="px-2 py-1.5 text-xs border border-slate-300 rounded-lg" />
              </div>
            </div>
          )}
          <div className="flex gap-2">
            <button
              onClick={handleFetchInvoices}
              className="flex items-center gap-1.5 bg-slate-900 text-white px-3 py-1.5 rounded-lg text-xs font-medium"
            >
              <Cloud className="h-3.5 w-3.5" /> Fetch
            </button>
            <button
              onClick={() => setFetchStep("idle")}
              className="px-3 py-1.5 text-xs text-slate-500 border border-slate-300 rounded-lg"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Fetch Progress */}
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

      {/* Invoice Selection Panel */}
      {fetchStep === "selecting" && invoicePreviews.length > 0 && (
        <Card className="mb-3 border-blue-200 bg-blue-50/50">
          <CardContent className="p-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-blue-800">
                {invoicePreviews.length} unpaid invoice{invoicePreviews.length !== 1 ? "s" : ""} from Zoho
              </p>
              <div className="flex gap-2">
                <button onClick={() => { setFetchStep("idle"); setInvoicePreviews([]); }}
                  className="text-xs text-slate-500 underline">Cancel</button>
                <button onClick={handleImportSelected} disabled={selectedInvoices.size === 0}
                  className="flex items-center gap-1 bg-blue-600 text-white px-3 py-1.5 rounded-md text-xs font-medium disabled:opacity-50">
                  <Download className="h-3 w-3" /> Import {selectedInvoices.size}
                </button>
              </div>
            </div>
            <div className="space-y-1.5 max-h-64 overflow-y-auto">
              {invoicePreviews.map((inv) => (
                <label key={inv.id}
                  className={`flex items-start gap-2 p-2 rounded-lg cursor-pointer transition-colors ${
                    selectedInvoices.has(inv.id) ? "bg-blue-100 border border-blue-300" : "bg-white border border-slate-200"
                  }`}>
                  <input type="checkbox" checked={selectedInvoices.has(inv.id)}
                    onChange={() => toggleInvoice(inv.id)} className="mt-0.5 rounded" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-slate-900">{inv.data.invoiceNumber}</span>
                      <span className="text-xs font-semibold text-red-600">Due: {formatCurrency(inv.data.balance)}</span>
                    </div>
                    <p className="text-[10px] text-slate-600">{inv.data.customerName}</p>
                    <p className="text-[10px] text-slate-400">Total: {formatCurrency(inv.data.total)} | {new Date(inv.data.date).toLocaleDateString("en-IN")}</p>
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
          <span className="text-xs text-blue-700">Importing {selectedInvoices.size} invoices as receivables...</span>
        </div>
      )}

      {/* Aging Bucket Cards */}
      {aging && (
        <div className="mb-4">
          <div className="flex items-center gap-2 mb-2">
            <Clock className="h-4 w-4 text-slate-500" />
            <span className="text-xs font-semibold text-slate-700">Aging Summary</span>
            <span className="text-xs text-slate-400">Total: {formatCurrency(totalOutstanding)}</span>
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
                className={`p-2 rounded-lg border text-left transition-all ${
                  agingFilter === bucket.key ? `${bucket.bg} ring-2 ring-offset-1 ring-slate-400` : "bg-white border-slate-200 hover:border-slate-300"
                }`}
              >
                <p className="text-[10px] text-slate-500">{bucket.label}</p>
                <p className={`text-sm font-bold ${bucket.color}`}>{bucket.data.count}</p>
                <p className="text-[10px] text-slate-500 truncate">{formatCurrency(bucket.data.amount)}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Search */}
      <div className="relative mb-3">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <Input
          placeholder="Search invoice or customer..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Filters */}
      <FilterSheet
        className="mb-4"
        dateValue={dateFilter}
        onDateChange={(key, from, to) => { setDateFilter(key); setDateFrom(from); setDateTo(to); }}
        groups={[{
          label: "Status",
          value: filter,
          defaultValue: "ALL",
          options: STATUS_FILTERS.map((s) => ({ key: s, label: s === "ALL" ? "All" : s.replace(/_/g, " ") })),
          onChange: (key) => setFilter(key),
        }]}
      />

      {/* Invoice List */}
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="p-3 border border-slate-100 rounded-lg animate-pulse">
              <div className="flex items-start justify-between">
                <div className="flex-1 space-y-1.5">
                  <div className="h-4 bg-slate-200 rounded w-3/4" />
                  <div className="h-3 bg-slate-200 rounded w-1/2" />
                </div>
                <div className="text-right space-y-1.5">
                  <div className="h-4 bg-slate-200 rounded w-16 ml-auto" />
                  <div className="h-5 w-14 bg-slate-200 rounded-full ml-auto" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {invoices.map((inv) => {
            const remaining = inv.amount - inv.paidAmount;
            const isOverdue = new Date(inv.dueDate) < new Date() && remaining > 0;
            return (
              <Link key={inv.id} href={`/receivables/${inv.id}`}>
                <Card className={`hover:border-slate-300 transition-colors mb-2 ${isOverdue ? "border-red-200 bg-red-50/30" : ""}`}>
                  <CardContent className="p-3">
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0 mr-3">
                        <div className="flex items-center gap-2">
                          {isOverdue && <AlertTriangle className="h-3.5 w-3.5 text-red-500 shrink-0" />}
                          <p className="text-sm font-medium text-slate-900">{inv.customer.name}</p>
                        </div>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {inv.invoiceNo} | Due: {new Date(inv.dueDate).toLocaleDateString("en-IN")}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className={`text-sm font-bold ${remaining > 0 ? "text-red-600" : "text-green-600"}`}>
                          {formatCurrency(remaining)}
                        </p>
                        <Badge variant={inv.status === "PAID" ? "success" : isOverdue ? "danger" : "warning"} className="text-[10px]">
                          {isOverdue ? "OVERDUE" : inv.status.replace(/_/g, " ")}
                        </Badge>
                      </div>
                    </div>
                    {inv.paidAmount > 0 && remaining > 0 && (
                      <div className="mt-2">
                        <div className="w-full bg-slate-200 rounded-full h-1.5">
                          <div
                            className="bg-green-500 h-1.5 rounded-full"
                            style={{ width: `${Math.min(100, (inv.paidAmount / inv.amount) * 100)}%` }}
                          />
                        </div>
                        <p className="text-[10px] text-slate-400 mt-0.5">
                          Paid {formatCurrency(inv.paidAmount)} of {formatCurrency(inv.amount)}
                        </p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </Link>
            );
          })}

          {invoices.length === 0 && (
            <div className="text-center py-12">
              <FileText className="h-8 w-8 text-slate-300 mx-auto mb-2" />
              <p className="text-sm text-slate-400">No invoices found</p>
            </div>
          )}
        </div>
      )}

      {/* Floating Action Button */}
      <Link
        href="/receivables/new"
        className="fixed above-nav right-4 bg-blue-600 hover:bg-blue-700 text-white rounded-full p-3.5 shadow-lg z-50"
      >
        <Plus className="h-5 w-5" />
      </Link>
    </div>
  );
}
