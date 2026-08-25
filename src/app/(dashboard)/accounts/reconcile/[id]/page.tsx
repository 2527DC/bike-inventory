"use client";

import { useState, useEffect, use, useCallback, useMemo } from "react";
import Link from "next/link";
import {
  ArrowLeft, CheckCircle2, XCircle, Building2,
  Loader2, CreditCard, Receipt, ChevronDown, ChevronUp, CheckSquare, Square, Layers,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface BankTxn {
  id: string;
  date: string;
  description: string;
  reference: string | null;
  amount: number;
  type: "CREDIT" | "DEBIT";
  balance: number | null;
  matchStatus: string;
  flagReason: string | null;
  suggestedCategory: string | null;
  confidence: number | null;
  suggestedVendor: { id: string; name: string } | null;
  suggestedBill: { id: string; billNo: string; amount: number; paidAmount: number } | null;
  confirmedVendorId: string | null;
  confirmedPaymentId: string | null;
  confirmedExpenseId: string | null;
  processedAt: string | null;
}

interface Statement {
  id: string;
  bank: string;
  fileName: string;
  fromDate: string | null;
  toDate: string | null;
  totalCredits: number;
  totalDebits: number;
  txnCount: number;
  matchedCount: number;
  flaggedCount: number;
  uploadedBy: { name: string };
  transactions: BankTxn[];
}

interface Vendor { id: string; name: string; code: string; }
interface PendingBill { id: string; billNo: string; amount: number; paidAmount: number; vendorId: string; }

function formatCurrency(n: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
}

type FilterKey = "ALL" | "UNMATCHED" | "MATCHED" | "FLAGGED" | "EXPENSE" | "IGNORED";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "ALL", label: "All" },
  { key: "UNMATCHED", label: "Pending" },
  { key: "MATCHED", label: "Matched" },
  { key: "FLAGGED", label: "Flagged" },
  { key: "EXPENSE", label: "Expenses" },
  { key: "IGNORED", label: "Ignored" },
];

const EXPENSE_CATEGORIES = [
  { key: "EXPENSE_SALARY", label: "Salary / Advance" },
  { key: "EXPENSE_RENT", label: "Rent / Maintenance" },
  { key: "EXPENSE_UTILITY", label: "Utility Bills" },
  { key: "EXPENSE_DELIVERY", label: "Delivery / Transport" },
  { key: "EXPENSE_TRANSPORT", label: "Transport" },
  { key: "EXPENSE_OTHER", label: "Other / Misc" },
];

// Group transactions by flag reason or category for clubbing
function groupTransactions(txns: BankTxn[]): { label: string; txns: BankTxn[] }[] {
  const groups: Record<string, BankTxn[]> = {};
  const ungrouped: BankTxn[] = [];

  for (const t of txns) {
    const key = t.flagReason || t.suggestedCategory || "";
    if (key && !t.processedAt) {
      if (!groups[key]) groups[key] = [];
      groups[key].push(t);
    } else {
      ungrouped.push(t);
    }
  }

  const result: { label: string; txns: BankTxn[] }[] = [];
  // Groups with 2+ items get clubbed together
  for (const [label, items] of Object.entries(groups)) {
    if (items.length >= 2) {
      result.push({ label, txns: items });
    } else {
      ungrouped.push(...items);
    }
  }
  // Ungrouped items as individual entries
  for (const t of ungrouped) {
    result.push({ label: "", txns: [t] });
  }

  // Sort: groups first (by count desc), then individuals by date desc
  result.sort((a, b) => {
    if (a.txns.length > 1 && b.txns.length <= 1) return -1;
    if (a.txns.length <= 1 && b.txns.length > 1) return 1;
    if (a.txns.length > 1 && b.txns.length > 1) return b.txns.length - a.txns.length;
    return new Date(b.txns[0].date).getTime() - new Date(a.txns[0].date).getTime();
  });

  return result;
}

export default function ReconcilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [statement, setStatement] = useState<Statement | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterKey>("UNMATCHED");
  const [processing, setProcessing] = useState<string>("");
  const [bulkProcessing, setBulkProcessing] = useState(false);
  const [actionError, setActionError] = useState("");

  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [pendingBills, setPendingBills] = useState<PendingBill[]>([]);
  const [expandedTxn, setExpandedTxn] = useState<string | null>(null);
  const [selectedVendor, setSelectedVendor] = useState<Record<string, string>>({});
  const [selectedBill, setSelectedBill] = useState<Record<string, string>>({});
  const [vendorSearch, setVendorSearch] = useState<Record<string, string>>({});
  const [expenseTxn, setExpenseTxn] = useState<string | null>(null);

  // Multi-select
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkExpenseOpen, setBulkExpenseOpen] = useState(false);
  const [bulkVendorOpen, setBulkVendorOpen] = useState(false);
  const [bulkVendorId, setBulkVendorId] = useState("");
  const [bulkVendorSearch, setBulkVendorSearch] = useState("");

  // Collapsed groups
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  const fetchData = useCallback(() => {
    setLoading(true);
    fetch(`/api/bank-statements/${id}/review`)
      .then((r) => r.json())
      .then((res) => { if (res.success) setStatement(res.data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    Promise.all([
      fetch("/api/vendors?limit=500").then((r) => r.json()),
      fetch("/api/bills?status=PENDING&limit=500").then((r) => r.json()),
    ]).then(([vRes, bRes]) => {
      if (vRes.success) setVendors(vRes.data || []);
      if (bRes.success) setPendingBills(bRes.data || []);
    }).catch(() => {});
  }, []);

  const handleAction = async (txnId: string, action: string, extra?: Record<string, unknown>) => {
    setProcessing(txnId);
    try {
      const res = await fetch(`/api/bank-statements/${id}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ txnId, action, ...extra }),
      }).then(r => r.json());
      if (res.success) {
        setExpandedTxn(null);
        setExpenseTxn(null);
        fetchData();
      }
    } catch (e) { setActionError(e instanceof Error ? e.message : "Action failed"); } finally { setProcessing(""); }
  };

  const handleBulkAction = async (action: string, extra?: Record<string, unknown>) => {
    if (selected.size === 0) return;
    setBulkProcessing(true);
    try {
      const res = await fetch(`/api/bank-statements/${id}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ txnIds: Array.from(selected), action, ...extra }),
      }).then(r => r.json());
      if (res.success) {
        setSelected(new Set());
        setBulkExpenseOpen(false);
        setBulkVendorOpen(false);
        setBulkVendorId("");
        fetchData();
      }
    } catch (e) { setActionError(e instanceof Error ? e.message : "Bulk action failed"); } finally { setBulkProcessing(false); }
  };

  const handleManualPayment = (txnId: string) => {
    const vendorId = selectedVendor[txnId];
    if (!vendorId) return;
    handleAction(txnId, "confirm_payment", { vendorId, billId: selectedBill[txnId] || undefined });
  };

  const filtered = useMemo(() =>
    statement?.transactions.filter((t) => filter === "ALL" || t.matchStatus === filter) || [],
    [statement, filter]
  );

  const grouped = useMemo(() => groupTransactions(filtered), [filtered]);

  const counts = useMemo(() => ({
    ALL: statement?.transactions.length || 0,
    UNMATCHED: statement?.transactions.filter(t => t.matchStatus === "UNMATCHED").length || 0,
    MATCHED: statement?.transactions.filter(t => t.matchStatus === "MATCHED").length || 0,
    FLAGGED: statement?.transactions.filter(t => t.matchStatus === "FLAGGED").length || 0,
    EXPENSE: statement?.transactions.filter(t => t.matchStatus === "EXPENSE").length || 0,
    IGNORED: statement?.transactions.filter(t => t.matchStatus === "IGNORED").length || 0,
  }), [statement]);

  const getFilteredVendors = (search: string) => {
    const q = search.toLowerCase();
    if (!q) return vendors;
    return vendors.filter((v) => v.name.toLowerCase().includes(q) || v.code.toLowerCase().includes(q));
  };

  const getVendorBills = (vendorId: string) => pendingBills.filter((b) => b.vendorId === vendorId);

  const toggleSelect = (txnId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(txnId)) next.delete(txnId);
      else next.add(txnId);
      return next;
    });
  };

  const toggleGroupSelect = (txns: BankTxn[]) => {
    const actionable = txns.filter((t) => !t.processedAt && t.type === "DEBIT");
    const allSelected = actionable.every((t) => selected.has(t.id));
    setSelected((prev) => {
      const next = new Set(prev);
      for (const t of actionable) {
        if (allSelected) next.delete(t.id);
        else next.add(t.id);
      }
      return next;
    });
  };

  const selectAll = () => {
    const actionable = filtered.filter((t) => !t.processedAt && t.type === "DEBIT");
    const allSelected = actionable.every((t) => selected.has(t.id));
    setSelected(allSelected ? new Set() : new Set(actionable.map((t) => t.id)));
  };

  const toggleGroupCollapse = (label: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  };

  const actionableCount = filtered.filter((t) => !t.processedAt && t.type === "DEBIT").length;
  const selectedTotal = filtered.filter((t) => selected.has(t.id)).reduce((s, t) => s + t.amount, 0);

  if (loading) {
    return <div className="flex items-center justify-center py-12"><div className="h-6 w-6 border-2 border-slate-900 border-t-transparent rounded-full animate-spin" /></div>;
  }

  if (!statement) {
    return <div className="text-center py-12"><p className="text-sm text-slate-400">Statement not found</p><Link href="/accounts/bank-upload" className="text-sm text-blue-600 underline mt-2 inline-block">Back</Link></div>;
  }

  const renderTxnCard = (txn: BankTxn, compact = false) => {
    const isDebit = txn.type === "DEBIT";
    const isProcessing = processing === txn.id;
    const isProcessed = !!txn.processedAt;
    const isExpanded = expandedTxn === txn.id;
    const isChecked = selected.has(txn.id);
    const vendorBills = getVendorBills(selectedVendor[txn.id] || "");

    return (
      <div key={txn.id} className={`${compact ? "py-2 border-b border-slate-100 last:border-0" : ""}`}>
        <div className="flex items-start gap-2">
          {/* Checkbox */}
          {!isProcessed && isDebit && (
            <button onClick={() => toggleSelect(txn.id)} className="mt-1 shrink-0">
              {isChecked
                ? <CheckSquare className="h-4 w-4 text-blue-600" />
                : <Square className="h-4 w-4 text-slate-300" />}
            </button>
          )}

          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between">
              <div className="flex-1 min-w-0 mr-2">
                <p className="text-xs text-slate-500">
                  {new Date(txn.date).toLocaleDateString("en-IN")}
                  {txn.reference && ` | ${txn.reference}`}
                </p>
                <p className={`text-slate-700 mt-0.5 ${compact ? "text-xs truncate" : "text-sm line-clamp-2"}`}>{txn.description}</p>
              </div>
              <div className="text-right shrink-0">
                <p className={`text-sm font-bold ${isDebit ? "text-red-600" : "text-green-600"}`}>
                  {isDebit ? "-" : "+"}{formatCurrency(txn.amount)}
                </p>
                {!compact && txn.balance !== null && (
                  <p className="text-[10px] text-slate-400">Bal: {formatCurrency(txn.balance)}</p>
                )}
              </div>
            </div>

            {/* AI Suggestion (non-compact only) */}
            {!compact && txn.suggestedVendor && txn.matchStatus !== "IGNORED" && (
              <div className="bg-blue-50 rounded-md p-2 mb-2 mt-1 text-[11px]">
                <div className="flex items-center gap-1">
                  <Building2 className="h-3 w-3 text-blue-500" />
                  <span className="font-medium text-blue-800">AI: {txn.suggestedVendor.name}</span>
                  {txn.confidence && <Badge variant="info" className="text-[9px] px-1 py-0">{Math.round(txn.confidence * 100)}%</Badge>}
                </div>
                {txn.suggestedBill && (
                  <p className="text-blue-600 ml-4">Bill {txn.suggestedBill.billNo} — Bal: {formatCurrency(txn.suggestedBill.amount - txn.suggestedBill.paidAmount)}</p>
                )}
              </div>
            )}

            {/* Status */}
            {isProcessed && (
              <div className="flex items-center gap-1 mt-1">
                <CheckCircle2 className="h-3 w-3 text-green-500" />
                <span className="text-[10px] text-green-600">
                  {txn.matchStatus === "MATCHED" ? "Payment recorded" : txn.matchStatus === "EXPENSE" ? "Expense recorded" : txn.matchStatus === "IGNORED" ? "Ignored" : "Processed"}
                </span>
              </div>
            )}

            {/* Individual actions (only when NOT in multi-select mode and not compact) */}
            {!isProcessed && isDebit && selected.size === 0 && !compact && (
              <div className="space-y-2 mt-2">
                <div className="flex gap-1.5 flex-wrap">
                  {txn.suggestedVendor && (
                    <button onClick={() => handleAction(txn.id, "confirm_payment", { vendorId: txn.suggestedVendor!.id, billId: txn.suggestedBill?.id })}
                      disabled={isProcessing} className="flex items-center gap-1 bg-green-600 text-white py-1.5 px-2.5 rounded-md text-[11px] font-medium disabled:opacity-50">
                      {isProcessing ? <Loader2 className="h-3 w-3 animate-spin" /> : <CreditCard className="h-3 w-3" />} Confirm
                    </button>
                  )}
                  <button onClick={() => { setExpandedTxn(isExpanded ? null : txn.id); setExpenseTxn(null); }}
                    className="flex items-center gap-1 bg-blue-100 text-blue-700 px-2.5 py-1.5 rounded-md text-[11px] font-medium">
                    <Building2 className="h-3 w-3" /> Vendor {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  </button>
                  <button onClick={() => { setExpenseTxn(expenseTxn === txn.id ? null : txn.id); setExpandedTxn(null); }}
                    className="flex items-center gap-1 bg-purple-600 text-white px-2.5 py-1.5 rounded-md text-[11px] font-medium">
                    <Receipt className="h-3 w-3" /> Expense {expenseTxn === txn.id ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  </button>
                  <button onClick={() => handleAction(txn.id, "ignore")} disabled={isProcessing}
                    className="flex items-center gap-1 bg-slate-200 text-slate-600 px-2.5 py-1.5 rounded-md text-[11px] font-medium disabled:opacity-50">
                    <XCircle className="h-3 w-3" /> Skip
                  </button>
                </div>

                {expenseTxn === txn.id && (
                  <div className="bg-purple-50 border border-purple-200 rounded-lg p-2.5">
                    <p className="text-[10px] font-medium text-purple-700 mb-1.5">Expense type:</p>
                    <div className="grid grid-cols-2 gap-1.5">
                      {EXPENSE_CATEGORIES.map((cat) => (
                        <button key={cat.key} onClick={() => { setExpenseTxn(null); handleAction(txn.id, "confirm_expense", { category: cat.key }); }}
                          disabled={isProcessing} className="py-1.5 px-2 rounded-lg text-xs font-medium bg-white border border-purple-200 text-purple-700 hover:bg-purple-100 disabled:opacity-50">
                          {cat.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {isExpanded && (
                  <div className="bg-slate-50 border border-slate-200 rounded-lg p-2.5 space-y-2">
                    <p className="text-[10px] font-medium text-slate-600">Select vendor</p>
                    <input type="text" placeholder="Search vendor..." value={vendorSearch[txn.id] || ""}
                      onChange={(e) => setVendorSearch((prev) => ({ ...prev, [txn.id]: e.target.value }))}
                      className="w-full text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white" />
                    <select value={selectedVendor[txn.id] || ""}
                      onChange={(e) => { setSelectedVendor((prev) => ({ ...prev, [txn.id]: e.target.value })); setSelectedBill((prev) => { const n = { ...prev }; delete n[txn.id]; return n; }); }}
                      className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white text-slate-700">
                      <option value="">Select vendor</option>
                      {getFilteredVendors(vendorSearch[txn.id] || "").map((v) => (
                        <option key={v.id} value={v.id}>{v.name} ({v.code})</option>
                      ))}
                    </select>
                    {selectedVendor[txn.id] && vendorBills.length > 0 && (
                      <select value={selectedBill[txn.id] || ""}
                        onChange={(e) => setSelectedBill((prev) => ({ ...prev, [txn.id]: e.target.value }))}
                        className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white text-slate-700">
                        <option value="">No bill (advance)</option>
                        {vendorBills.map((b) => (
                          <option key={b.id} value={b.id}>{b.billNo} — Bal: {formatCurrency(b.amount - b.paidAmount)}</option>
                        ))}
                      </select>
                    )}
                    <button onClick={() => handleManualPayment(txn.id)} disabled={!selectedVendor[txn.id] || isProcessing}
                      className="w-full flex items-center justify-center gap-1.5 bg-green-600 text-white py-2 rounded-lg text-xs font-medium disabled:opacity-50">
                      {isProcessing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CreditCard className="h-3.5 w-3.5" />}
                      Record Payment ({formatCurrency(txn.amount)})
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="pb-20">
      {actionError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-2.5 mb-3 text-xs text-red-700">
          {actionError}
          <button onClick={() => setActionError("")} className="ml-2 underline">dismiss</button>
        </div>
      )}

      <div className="flex items-center gap-3 mb-3">
        <Link href="/accounts/bank-upload" className="p-1"><ArrowLeft className="h-5 w-5 text-slate-600" /></Link>
        <div className="flex-1">
          <h1 className="text-base font-bold text-slate-900">Reconcile</h1>
          <p className="text-[10px] text-slate-500">{statement.bank} | {statement.fileName} | {statement.txnCount} transactions</p>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-1.5 mb-3">
        <Card className="bg-green-50 border-green-200"><CardContent className="p-2 text-center"><p className="text-sm font-bold text-green-700">{formatCurrency(statement.totalCredits)}</p><p className="text-[9px] text-green-600">Credits</p></CardContent></Card>
        <Card className="bg-red-50 border-red-200"><CardContent className="p-2 text-center"><p className="text-sm font-bold text-red-700">{formatCurrency(statement.totalDebits)}</p><p className="text-[9px] text-red-600">Debits</p></CardContent></Card>
        <Card className="bg-blue-50 border-blue-200"><CardContent className="p-2 text-center"><p className="text-sm font-bold text-blue-700">{counts.UNMATCHED}</p><p className="text-[9px] text-blue-600">To Review</p></CardContent></Card>
      </div>

      {/* Filters */}
      <div className="flex gap-1.5 overflow-x-auto scrollbar-hide mb-3 pb-1">
        {FILTERS.map((f) => (
          <button key={f.key} onClick={() => { setFilter(f.key); setSelected(new Set()); }}
            className={`shrink-0 px-2.5 py-1.5 rounded-full text-xs font-medium transition-colors ${filter === f.key ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"}`}>
            {f.label}{counts[f.key] > 0 ? ` (${counts[f.key]})` : ""}
          </button>
        ))}
      </div>

      {/* Select All toggle */}
      {actionableCount > 0 && (
        <div className="flex items-center justify-between mb-2">
          <button onClick={selectAll} className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700">
            {selected.size === actionableCount
              ? <CheckSquare className="h-3.5 w-3.5 text-blue-600" />
              : <Square className="h-3.5 w-3.5" />}
            Select all ({actionableCount})
          </button>
          {selected.size > 0 && (
            <p className="text-[10px] text-blue-600 font-medium">{selected.size} selected — {formatCurrency(selectedTotal)}</p>
          )}
        </div>
      )}

      {/* Grouped Transactions */}
      <div className="space-y-2">
        {grouped.map((group, gi) => {
          if (group.txns.length === 1) {
            // Single transaction — render as card
            const txn = group.txns[0];
            return (
              <Card key={txn.id} className={`${
                txn.matchStatus === "FLAGGED" ? "border-red-200 bg-red-50/30" :
                txn.matchStatus === "MATCHED" ? "border-green-200 bg-green-50/30" :
                txn.matchStatus === "EXPENSE" ? "border-purple-200 bg-purple-50/30" :
                txn.matchStatus === "IGNORED" ? "border-slate-200 opacity-50" : ""
              }`}>
                <CardContent className="p-3">{renderTxnCard(txn)}</CardContent>
              </Card>
            );
          }

          // Grouped transactions
          const isCollapsed = collapsedGroups.has(group.label);
          const groupTotal = group.txns.reduce((s, t) => s + t.amount, 0);
          const actionable = group.txns.filter((t) => !t.processedAt && t.type === "DEBIT");
          const allGroupSelected = actionable.length > 0 && actionable.every((t) => selected.has(t.id));

          return (
            <Card key={`group-${gi}-${group.label}`} className="border-amber-200 bg-amber-50/30">
              <CardContent className="p-0">
                {/* Group Header */}
                <button onClick={() => toggleGroupCollapse(group.label)}
                  className="w-full p-3 flex items-center gap-2 text-left">
                  <Layers className="h-4 w-4 text-amber-600 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-xs font-semibold text-slate-800 truncate">{group.label}</p>
                      <Badge variant="warning" className="text-[9px] shrink-0">{group.txns.length} txns</Badge>
                    </div>
                    <p className="text-[10px] text-slate-500">Total: {formatCurrency(groupTotal)}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {actionable.length > 0 && (
                      <button onClick={(e) => { e.stopPropagation(); toggleGroupSelect(group.txns); }}
                        className="p-1">
                        {allGroupSelected
                          ? <CheckSquare className="h-4 w-4 text-blue-600" />
                          : <Square className="h-4 w-4 text-slate-300" />}
                      </button>
                    )}
                    {isCollapsed ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronUp className="h-4 w-4 text-slate-400" />}
                  </div>
                </button>

                {/* Group Items (collapsible) */}
                {!isCollapsed && (
                  <div className="px-3 pb-3 border-t border-amber-100">
                    {group.txns.map((txn) => renderTxnCard(txn, true))}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}

        {filtered.length === 0 && (
          <div className="text-center py-8">
            <CheckCircle2 className="h-6 w-6 text-slate-300 mx-auto mb-1" />
            <p className="text-xs text-slate-400">{filter === "UNMATCHED" ? "All transactions processed!" : "No transactions in this category"}</p>
          </div>
        )}
      </div>

      {/* Bulk Action Bar (sticky bottom) */}
      {selected.size > 0 && (
        <div className="fixed above-nav left-0 right-0 bg-white border-t border-slate-200 shadow-lg p-3 z-50">
          <div className="max-w-lg mx-auto">
            <p className="text-xs text-slate-600 mb-2 text-center">
              {selected.size} selected — {formatCurrency(selectedTotal)}
            </p>

            {!bulkExpenseOpen && !bulkVendorOpen && (
              <div className="flex gap-2">
                <button onClick={() => { setBulkVendorOpen(true); setBulkExpenseOpen(false); }}
                  className="flex-1 flex items-center justify-center gap-1.5 bg-blue-100 text-blue-700 py-2.5 rounded-lg text-xs font-medium">
                  <Building2 className="h-3.5 w-3.5" /> Vendor
                </button>
                <button onClick={() => { setBulkExpenseOpen(true); setBulkVendorOpen(false); }}
                  className="flex-1 flex items-center justify-center gap-1.5 bg-purple-600 text-white py-2.5 rounded-lg text-xs font-medium">
                  <Receipt className="h-3.5 w-3.5" /> Expense
                </button>
                <button onClick={() => handleBulkAction("ignore")} disabled={bulkProcessing}
                  className="flex-1 flex items-center justify-center gap-1.5 bg-slate-200 text-slate-600 py-2.5 rounded-lg text-xs font-medium disabled:opacity-50">
                  {bulkProcessing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <XCircle className="h-3.5 w-3.5" />} Skip All
                </button>
              </div>
            )}

            {bulkExpenseOpen && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-medium text-purple-700">Expense type for {selected.size} items:</p>
                  <button onClick={() => setBulkExpenseOpen(false)} className="text-[10px] text-slate-500 underline">Cancel</button>
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  {EXPENSE_CATEGORIES.map((cat) => (
                    <button key={cat.key} onClick={() => handleBulkAction("confirm_expense", { category: cat.key })}
                      disabled={bulkProcessing}
                      className="py-2 rounded-lg text-[11px] font-medium bg-purple-50 border border-purple-200 text-purple-700 hover:bg-purple-100 disabled:opacity-50">
                      {bulkProcessing ? "..." : cat.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {bulkVendorOpen && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-medium text-blue-700">Assign vendor to {selected.size} items:</p>
                  <button onClick={() => setBulkVendorOpen(false)} className="text-[10px] text-slate-500 underline">Cancel</button>
                </div>
                <input type="text" placeholder="Search vendor..." value={bulkVendorSearch}
                  onChange={(e) => setBulkVendorSearch(e.target.value)}
                  className="w-full text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white" />
                <select value={bulkVendorId} onChange={(e) => setBulkVendorId(e.target.value)}
                  className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white text-slate-700">
                  <option value="">Select vendor</option>
                  {getFilteredVendors(bulkVendorSearch).map((v) => (
                    <option key={v.id} value={v.id}>{v.name} ({v.code})</option>
                  ))}
                </select>
                <button onClick={() => { if (bulkVendorId) handleBulkAction("confirm_payment", { vendorId: bulkVendorId }); }}
                  disabled={!bulkVendorId || bulkProcessing}
                  className="w-full flex items-center justify-center gap-1.5 bg-green-600 text-white py-2 rounded-lg text-xs font-medium disabled:opacity-50">
                  {bulkProcessing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CreditCard className="h-3.5 w-3.5" />}
                  Record {selected.size} Payments
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
