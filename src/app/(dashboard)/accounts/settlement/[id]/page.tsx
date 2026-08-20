"use client";

import { useState, useEffect, use } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { ArrowLeft, CheckCircle, Banknote, CreditCard, Smartphone, Building2, Search, X, FileText, ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { usePermissions } from "@/lib/use-permissions";

interface SettlementMatch {
  id: string;
  paymentMode: string;
  expectedAmount: number;
  matchedAmount: number;
  variance: number;
  isMatched: boolean;
  notes: string | null;
  bankTxn: { id: string; description: string; amount: number; date: string; reference: string | null } | null;
}

interface Settlement {
  id: string;
  date: string;
  status: string;
  totalCash: number;
  totalCard: number;
  totalUpi: number;
  totalFinance: number;
  totalCredit: number;
  grandTotal: number;
  matchedAmount: number;
  unmatchedAmount: number;
  cashCounted: number | null;
  cashVariance: number | null;
  cashVerifiedAt: string | null;
  cashIn: number;
  cashOut: number;
  cashOutReason: string | null;
  cashVerifiedBy: { name: string } | null;
  notes: string | null;
  sessions: Array<{
    id: string;
    zakyaSessionId: string;
    sessionDate: string;
    totalSales: number;
    cashSales: number;
    cardSales: number;
    upiSales: number;
    financeSales: number;
    creditSales: number;
    cashIn: number;
    cashOut: number;
    cashRefunds: number;
    expectedCash: number;
    countedCash: number | null;
    cashDiscrepancy: number;
    invoiceCount: number;
    registerName: string | null;
    cashierName: string | null;
  }>;
  matches: SettlementMatch[];
}

interface BankTxn {
  id: string;
  description: string;
  amount: number;
  date: string;
  reference: string | null;
  matchStatus: string;
}

interface ZohoPayment {
  payment_id: string;
  date: string;
  amount: number;
  payment_mode: string;
  customer_name: string;
  reference_number: string;
  account_name: string;
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount);
}

const MODE_ICONS: Record<string, typeof CreditCard> = {
  CARD: CreditCard,
  UPI: Smartphone,
  FINANCE: Building2,
  CASH_DEPOSIT: Banknote,
  CREDIT: FileText,
};

const MODE_LABELS: Record<string, string> = {
  CARD: "ICICI BANK / HDFC",
  UPI: "UPI",
  FINANCE: "BAJAJ / Finance",
  CASH_DEPOSIT: "Cash",
  CREDIT: "Credit Sale",
};

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  PENDING: { bg: "bg-slate-100", text: "text-slate-700", label: "Pending" },
  CASH_VERIFIED: { bg: "bg-amber-100", text: "text-amber-700", label: "Cash Verified" },
  PARTIALLY_MATCHED: { bg: "bg-blue-100", text: "text-blue-700", label: "Partially Matched" },
  FULLY_MATCHED: { bg: "bg-green-100", text: "text-green-700", label: "Fully Matched" },
  DISCREPANCY: { bg: "bg-red-100", text: "text-red-700", label: "Discrepancy" },
};

export default function SettlementDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: session } = useSession();
  const role = (session?.user as { role?: string })?.role || "";
  const { canView } = usePermissions();
  const canAccess = canView("bills");

  const [settlement, setSettlement] = useState<Settlement | null>(null);
  const [bankTxns, setBankTxns] = useState<BankTxn[]>([]);
  const [zohoPayments, setZohoPayments] = useState<ZohoPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [cashInput, setCashInput] = useState("");
  const [verifying, setVerifying] = useState(false);

  // Mode breakdown edit
  const [editingBreakdown, setEditingBreakdown] = useState(false);
  const [modeInputs, setModeInputs] = useState({ cash: "", card: "", upi: "", finance: "", credit: "" });
  const [savingBreakdown, setSavingBreakdown] = useState(false);

  // Cash In / Out
  const [cashInInput, setCashInInput] = useState("");
  const [cashOutInput, setCashOutInput] = useState("");
  const [cashOutReason, setCashOutReason] = useState("");
  const [savingCashFlow, setSavingCashFlow] = useState(false);

  // Matching
  const [matchingMode, setMatchingMode] = useState<string | null>(null);
  const [searchTxn, setSearchTxn] = useState("");
  const [matchingTxnId, setMatchingTxnId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const loadData = () => {
    setLoading(true);
    fetch(`/api/pos/settlement/${id}`)
      .then((r) => r.json())
      .then((res) => {
        if (res.success) {
          setSettlement(res.data.settlement);
          setBankTxns(res.data.bankTxns);
          setZohoPayments(res.data.zohoPayments || []);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadData(); }, [id]);

  const verifyCash = async () => {
    if (!cashInput) return;
    setVerifying(true);
    try {
      const res = await fetch(`/api/pos/settlement/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cashCounted: parseFloat(cashInput) }),
      });
      const data = await res.json();
      if (data.success) loadData();
      else setActionError(data.error || "Failed to verify cash");
    } catch { setActionError("Network error"); }
    finally { setVerifying(false); }
  };

  const saveBreakdown = async () => {
    setSavingBreakdown(true);
    try {
      const res = await fetch(`/api/pos/settlement/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          totalCash: parseFloat(modeInputs.cash) || 0,
          totalCard: parseFloat(modeInputs.card) || 0,
          totalUpi: parseFloat(modeInputs.upi) || 0,
          totalFinance: parseFloat(modeInputs.finance) || 0,
          totalCredit: parseFloat(modeInputs.credit) || 0,
        }),
      });
      const data = await res.json();
      if (data.success) { setEditingBreakdown(false); loadData(); }
      else setActionError(data.error || "Failed to save breakdown");
    } catch { setActionError("Network error"); }
    finally { setSavingBreakdown(false); }
  };

  const saveCashFlow = async () => {
    if (!cashOutInput && !cashInInput) return;
    if (cashOutInput && !cashOutReason.trim()) { setActionError("Cash out reason is required"); return; }
    setSavingCashFlow(true);
    try {
      const res = await fetch(`/api/pos/settlement/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(cashInInput ? { cashIn: parseFloat(cashInInput) } : {}),
          ...(cashOutInput ? { cashOut: parseFloat(cashOutInput) } : {}),
          ...(cashOutReason ? { cashOutReason: cashOutReason.trim() } : {}),
        }),
      });
      const data = await res.json();
      if (data.success) { setCashInInput(""); setCashOutInput(""); setCashOutReason(""); loadData(); }
      else setActionError(data.error || "Failed to save cash flow");
    } catch { setActionError("Network error"); }
    finally { setSavingCashFlow(false); }
  };

  const matchTransaction = async (bankTxnId: string, amount: number) => {
    if (!matchingMode) return;
    setMatchingTxnId(bankTxnId);
    try {
      const res = await fetch(`/api/pos/settlement/${id}/match`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentMode: matchingMode, bankTxnId, matchedAmount: amount }),
      });
      const data = await res.json();
      if (data.success) { setMatchingMode(null); setSearchTxn(""); loadData(); }
      else setActionError(data.error || "Failed to match transaction");
    } catch { setActionError("Network error"); }
    finally { setMatchingTxnId(null); }
  };

  const removeMatch = async (matchId: string) => {
    if (!confirm("Remove this match?")) return;
    try {
      const res = await fetch(`/api/pos/settlement/${id}/match`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchId }),
      });
      const data = await res.json();
      if (data.success) loadData();
      else setActionError(data.error || "Failed to remove match");
    } catch { setActionError("Network error"); }
  };

  if (!canAccess) return <div className="text-center py-12"><p className="text-sm font-medium text-red-600">Access Denied</p></div>;

  if (loading || !settlement) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-6 w-6 border-2 border-slate-900 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const st = STATUS_STYLES[settlement.status] || STATUS_STYLES.PENDING;
  const modes = [
    { key: "CARD", amount: settlement.totalCard },
    { key: "UPI", amount: settlement.totalUpi },
    { key: "FINANCE", amount: settlement.totalFinance },
    { key: "CASH_DEPOSIT", amount: settlement.totalCash },
    { key: "CREDIT", amount: settlement.totalCredit },
  ];

  const filteredTxns = bankTxns.filter((t) => {
    if (!searchTxn) return true;
    const q = searchTxn.toLowerCase();
    return t.description.toLowerCase().includes(q) || (t.reference || "").toLowerCase().includes(q);
  });

  return (
    <div>
      {actionError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-2.5 mb-3 text-xs text-red-700 flex items-center justify-between">
          <span>{actionError}</span>
          <button onClick={() => setActionError(null)} className="text-red-400 hover:text-red-600 ml-2 text-sm leading-none">&times;</button>
        </div>
      )}

      <div className="flex items-center gap-2 mb-3">
        <Link href="/accounts/settlement">
          <ArrowLeft className="h-5 w-5 text-slate-500" />
        </Link>
        <div className="flex-1">
          <h1 className="text-lg font-bold text-slate-900">
            {new Date(settlement.date).toLocaleDateString("en-IN", { weekday: "long", day: "2-digit", month: "short", year: "numeric" })}
          </h1>
        </div>
        <Badge className={`${st.bg} ${st.text} text-xs`}>{st.label}</Badge>
      </div>

      {/* Summary */}
      <Card className="mb-3 bg-slate-50">
        <CardContent className="p-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-[10px] text-slate-500 uppercase">Total Sales</p>
              <p className="text-lg font-bold text-slate-900">{formatCurrency(settlement.grandTotal)}</p>
            </div>
            <div>
              <p className="text-[10px] text-slate-500 uppercase">Matched</p>
              <p className="text-lg font-bold text-green-700">{formatCurrency(settlement.matchedAmount)}</p>
            </div>
          </div>
          {settlement.unmatchedAmount > 0 && (
            <p className="text-xs text-amber-600 mt-1">Unmatched: {formatCurrency(settlement.unmatchedAmount)}</p>
          )}
        </CardContent>
      </Card>

      {/* Payment Mode Breakdown */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-slate-900">Payment Breakdown</h2>
          {!editingBreakdown && (
            <button onClick={() => {
              setModeInputs({
                cash: String(settlement.totalCash || ""),
                card: String(settlement.totalCard || ""),
                upi: String(settlement.totalUpi || ""),
                finance: String(settlement.totalFinance || ""),
                credit: String(settlement.totalCredit || ""),
              });
              setEditingBreakdown(true);
            }} className="text-xs text-blue-600">Edit</button>
          )}
        </div>

        {editingBreakdown ? (
          <Card className="mb-2">
            <CardContent className="p-3 space-y-2">
              {[
                { label: "Cash", key: "cash" },
                { label: "Card", key: "card" },
                { label: "UPI", key: "upi" },
                { label: "Finance", key: "finance" },
                { label: "Credit Sale", key: "credit" },
              ].map((m) => (
                <div key={m.key} className="flex items-center gap-2">
                  <span className="text-xs text-slate-600 w-16">{m.label}</span>
                  <Input
                    type="number"
                    value={modeInputs[m.key as keyof typeof modeInputs]}
                    onChange={(e) => setModeInputs({ ...modeInputs, [m.key]: e.target.value })}
                    className="text-sm"
                    placeholder="0"
                  />
                </div>
              ))}
              <div className="flex gap-2 pt-1">
                <Button size="sm" className="bg-blue-600 hover:bg-blue-700" onClick={saveBreakdown} disabled={savingBreakdown}>
                  {savingBreakdown ? "Saving..." : "Save"}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setEditingBreakdown(false)}>Cancel</Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-1.5">
            {modes.map((m) => {
              const Icon = MODE_ICONS[m.key] || CreditCard;
              const label = MODE_LABELS[m.key] || m.key;
              const match = settlement.matches.find((mt) => mt.paymentMode === m.key);
              const isMatching = matchingMode === m.key;

              return (
                <div key={m.key}>
                  <Card className={`${isMatching ? "border-blue-400 bg-blue-50" : ""}`}>
                    <CardContent className="p-3">
                      <div className="flex items-center gap-3">
                        <Icon className="h-4 w-4 text-slate-500 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-900">{label}</p>
                          {match ? (
                            <div className="flex items-center gap-1 mt-0.5">
                              <CheckCircle className="h-3 w-3 text-green-600" />
                              <span className="text-[10px] text-green-600">
                                Matched: {formatCurrency(match.matchedAmount)}
                                {match.variance !== 0 && (
                                  <span className={match.variance > 0 ? " text-green-600" : " text-red-600"}>
                                    {" "}({match.variance > 0 ? "+" : ""}{formatCurrency(match.variance)})
                                  </span>
                                )}
                              </span>
                              <button onClick={() => removeMatch(match.id)} className="ml-1">
                                <X className="h-3 w-3 text-red-400 hover:text-red-600" />
                              </button>
                            </div>
                          ) : m.amount > 0 ? (
                            <button
                              onClick={() => setMatchingMode(isMatching ? null : m.key)}
                              className="text-[10px] text-blue-600 mt-0.5"
                            >
                              {isMatching ? "Cancel matching" : "Match to bank txn"}
                            </button>
                          ) : null}
                        </div>
                        <p className="text-sm font-bold text-slate-900 shrink-0">{formatCurrency(m.amount)}</p>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Bank transaction selector */}
                  {isMatching && (
                    <div className="ml-4 mt-1 mb-2">
                      <div className="relative mb-1.5">
                        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                        <Input
                          placeholder="Search bank transactions..."
                          value={searchTxn}
                          onChange={(e) => setSearchTxn(e.target.value)}
                          className="pl-7 text-xs h-8"
                        />
                      </div>
                      <div className="space-y-1 max-h-48 overflow-y-auto">
                        {filteredTxns.length === 0 ? (
                          <p className="text-[10px] text-slate-400 py-2 text-center">No bank transactions found. Upload a bank statement first.</p>
                        ) : (
                          filteredTxns.map((txn) => (
                            <button
                              key={txn.id}
                              onClick={() => matchTransaction(txn.id, txn.amount)}
                              disabled={matchingTxnId === txn.id}
                              className="w-full text-left px-2 py-1.5 rounded-lg border bg-white hover:bg-blue-50 transition-colors"
                            >
                              <div className="flex items-center justify-between">
                                <div className="min-w-0 flex-1 mr-2">
                                  <p className="text-xs text-slate-700 truncate">{txn.description}</p>
                                  <p className="text-[10px] text-slate-400">
                                    {new Date(txn.date).toLocaleDateString("en-IN")}
                                    {txn.reference && ` | ${txn.reference}`}
                                  </p>
                                </div>
                                <p className="text-xs font-bold text-green-700 shrink-0">{formatCurrency(txn.amount)}</p>
                              </div>
                            </button>
                          ))
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Payments Received (from Zoho Books) */}
      {zohoPayments.length > 0 && (
        <div className="mb-4">
          <h2 className="text-sm font-semibold text-slate-900 mb-2">
            <ArrowDownLeft className="h-3.5 w-3.5 inline mr-1 text-green-600" />
            Payments Received ({zohoPayments.length})
          </h2>
          {/* Summary by mode */}
          {(() => {
            const byMode: Record<string, { count: number; total: number }> = {};
            for (const p of zohoPayments) {
              const mode = p.payment_mode || "Other";
              if (!byMode[mode]) byMode[mode] = { count: 0, total: 0 };
              byMode[mode].count++;
              byMode[mode].total += p.amount;
            }
            return (
              <Card className="mb-2 bg-green-50 border-green-200">
                <CardContent className="p-3">
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    {Object.entries(byMode).map(([mode, data]) => (
                      <div key={mode} className="text-xs">
                        <span className="text-slate-600">{mode}</span>
                        <span className="font-bold text-slate-900 ml-1">{formatCurrency(data.total)}</span>
                        <span className="text-slate-400 ml-0.5">({data.count})</span>
                      </div>
                    ))}
                  </div>
                  <p className="text-[10px] text-green-600 mt-1">
                    Total: {formatCurrency(zohoPayments.reduce((s, p) => s + p.amount, 0))}
                  </p>
                </CardContent>
              </Card>
            );
          })()}
        </div>
      )}

      {/* Cash In / Cash Out */}
      <div className="mb-4">
        <h2 className="text-sm font-semibold text-slate-900 mb-2">Cash In / Cash Out</h2>
        {(settlement.cashIn > 0 || settlement.cashOut > 0) && (
          <Card className="mb-2 bg-slate-50">
            <CardContent className="p-3">
              <div className="flex gap-4">
                {settlement.cashIn > 0 && (
                  <div className="flex items-center gap-1.5">
                    <ArrowDownLeft className="h-3.5 w-3.5 text-green-600" />
                    <div>
                      <p className="text-[10px] text-slate-500">Cash In</p>
                      <p className="text-sm font-bold text-green-700">{formatCurrency(settlement.cashIn)}</p>
                    </div>
                  </div>
                )}
                {settlement.cashOut > 0 && (
                  <div className="flex items-center gap-1.5">
                    <ArrowUpRight className="h-3.5 w-3.5 text-red-600" />
                    <div>
                      <p className="text-[10px] text-slate-500">Cash Out</p>
                      <p className="text-sm font-bold text-red-700">{formatCurrency(settlement.cashOut)}</p>
                      {settlement.cashOutReason && (
                        <p className="text-[10px] text-slate-400">{settlement.cashOutReason}</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}
        <Card>
          <CardContent className="p-3 space-y-2">
            <div className="flex items-center gap-2">
              <ArrowDownLeft className="h-3.5 w-3.5 text-green-600 shrink-0" />
              <span className="text-xs text-slate-600 w-14 shrink-0">Cash In</span>
              <Input
                type="number"
                placeholder="0"
                value={cashInInput}
                onChange={(e) => setCashInInput(e.target.value)}
                className="text-sm"
              />
            </div>
            <div className="flex items-center gap-2">
              <ArrowUpRight className="h-3.5 w-3.5 text-red-600 shrink-0" />
              <span className="text-xs text-slate-600 w-14 shrink-0">Cash Out</span>
              <Input
                type="number"
                placeholder="0"
                value={cashOutInput}
                onChange={(e) => setCashOutInput(e.target.value)}
                className="text-sm"
              />
            </div>
            {cashOutInput && parseFloat(cashOutInput) > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-600 w-[70px] shrink-0 pl-5">Reason *</span>
                <Input
                  type="text"
                  placeholder="Expense reason (required)"
                  value={cashOutReason}
                  onChange={(e) => setCashOutReason(e.target.value)}
                  className="text-sm"
                />
              </div>
            )}
            <Button
              size="sm"
              className="bg-slate-800 hover:bg-slate-900 w-full"
              onClick={saveCashFlow}
              disabled={savingCashFlow || (!cashInInput && !cashOutInput)}
            >
              {savingCashFlow ? "Saving..." : "Save Cash In/Out"}
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Cash Verification */}
      <div className="mb-4">
        <h2 className="text-sm font-semibold text-slate-900 mb-2">Cash Verification</h2>
        {settlement.cashVerifiedAt ? (
          <Card className="bg-green-50 border-green-200">
            <CardContent className="p-3">
              <div className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-green-600" />
                <div>
                  <p className="text-sm font-medium text-green-700">
                    Counted: {formatCurrency(settlement.cashCounted || 0)}
                    {settlement.cashVariance !== null && settlement.cashVariance !== 0 && (
                      <span className={settlement.cashVariance > 0 ? " text-green-600" : " text-red-600"}>
                        {" "}(Variance: {settlement.cashVariance > 0 ? "+" : ""}{formatCurrency(settlement.cashVariance)})
                      </span>
                    )}
                  </p>
                  <p className="text-[10px] text-slate-500">
                    Verified by {settlement.cashVerifiedBy?.name} at {new Date(settlement.cashVerifiedAt).toLocaleTimeString("en-IN")}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-3">
              <p className="text-xs text-slate-500 mb-2">Expected cash: {formatCurrency(settlement.totalCash)}</p>
              <div className="flex gap-2">
                <Input
                  type="number"
                  placeholder="Actual cash counted"
                  value={cashInput}
                  onChange={(e) => setCashInput(e.target.value)}
                  className="text-sm"
                />
                <Button size="sm" className="bg-green-600 hover:bg-green-700 shrink-0" onClick={verifyCash} disabled={verifying || !cashInput}>
                  {verifying ? "..." : "Verify"}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* POS Sessions */}
      <div className="mb-4">
        <h2 className="text-sm font-semibold text-slate-900 mb-2">POS Sessions ({settlement.sessions.length})</h2>
        <div className="space-y-1.5">
          {settlement.sessions.map((s) => {
            const hasBreakdown = s.cashSales > 0 || s.cardSales > 0 || s.upiSales > 0 || s.financeSales > 0;
            return (
              <Card key={s.id}>
                <CardContent className="p-3">
                  <div className="flex items-center justify-between mb-1">
                    <div>
                      <p className="text-sm font-medium text-slate-900">{s.registerName || "POS"}</p>
                      <p className="text-xs text-slate-500">{s.invoiceCount} invoices{s.cashierName ? ` | ${s.cashierName}` : ""}</p>
                    </div>
                    <p className="text-sm font-bold text-slate-900">{formatCurrency(s.totalSales)}</p>
                  </div>
                  {hasBreakdown && (
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-slate-500 mt-1 pt-1 border-t border-slate-100">
                      {s.cashSales > 0 && <span>Cash: {formatCurrency(s.cashSales)}</span>}
                      {s.cardSales > 0 && <span>Card: {formatCurrency(s.cardSales)}</span>}
                      {s.upiSales > 0 && <span>UPI: {formatCurrency(s.upiSales)}</span>}
                      {s.financeSales > 0 && <span>Finance: {formatCurrency(s.financeSales)}</span>}
                      {s.creditSales > 0 && <span>Credit: {formatCurrency(s.creditSales)}</span>}
                    </div>
                  )}
                  {(s.expectedCash > 0 || s.cashOut > 0 || s.cashIn > 0) && (
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-slate-400 mt-0.5">
                      {s.expectedCash > 0 && <span>Expected cash: {formatCurrency(s.expectedCash)}</span>}
                      {s.countedCash !== null && <span>Counted: {formatCurrency(s.countedCash)}</span>}
                      {s.cashIn > 0 && <span>Cash in: {formatCurrency(s.cashIn)}</span>}
                      {s.cashOut > 0 && <span>Cash out: {formatCurrency(s.cashOut)}</span>}
                      {s.cashDiscrepancy !== 0 && (
                        <span className={s.cashDiscrepancy > 0 ? "text-green-600" : "text-red-600"}>
                          Disc: {s.cashDiscrepancy > 0 ? "+" : ""}{formatCurrency(s.cashDiscrepancy)}
                        </span>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
