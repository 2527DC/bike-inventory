"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import {
  Building2,
  FileText,
  AlertTriangle,
  CreditCard,
  IndianRupee,
  Receipt,
  ShoppingCart,
  ChevronRight,
  HandCoins,
  AlertCircle,
  Plus,
  FileSpreadsheet,
  BookOpen,
  Calculator,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { SkeletonDashboard } from "@/components/ui/skeleton";
import { ErrorBanner } from "@/components/ui/error-banner";
import { usePermissions } from "@/lib/use-permissions";
import { apiFetch } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";

const log = createLogger("accounts:hub");

interface AccountsSummary {
  stats: {
    totalVendors: number;
    activeVendors: number;
    pendingBills: number;
    overdueBills: number;
    outstandingPayable: number;
    totalPaid30d: number;
    totalExpenses30d: number;
    pendingPOs: number;
    outstandingReceivable?: number;
    pendingReceivables?: number;
  };
  recentPayments: Array<{
    id: string;
    amount: number;
    paymentDate: string;
    vendor: { name: string };
    bill?: { billNo: string } | null;
  }>;
  overdueBillsList: Array<{
    id: string;
    billNo: string;
    amount: number;
    paidAmount: number;
    dueDate: string;
    vendor: { name: string };
  }>;
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount);
}

export default function AccountsPage() {
  const { status: sessionStatus } = useSession();
  const { canView } = usePermissions();
  // This hub has its own module now, so it is no longer gated on `bills.view`. Cosmetic
  // either way — /api/accounts/summary re-checks `accounts.view`.
  const canAccess = canView("accounts");

  const [data, setData] = useState<AccountsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // apiFetch, not fetch().then(r => r.json()). An expired session answers 307 -> /login,
    // which returns HTML with status 200, so `res.ok` and `res.success` both miss it and
    // the raw .json() failed with `Unexpected token '<'`. The old handler then swallowed
    // that in a bare `.catch(() => {})` and rendered an empty dashboard as if the numbers
    // were genuinely zero — a silent wrong answer on a financial screen.
    apiFetch<AccountsSummary>("/api/accounts/summary")
      .then((summary) => {
        setData(summary);
        log.debug("accounts summary loaded", {
          overdue: summary.overdueBillsList?.length ?? 0,
          recentPayments: summary.recentPayments?.length ?? 0,
        });
      })
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : "Could not load the accounts summary";
        log.error("accounts summary failed", { message: msg });
        setError(msg);
      })
      .finally(() => setLoading(false));
  }, []);

  if (sessionStatus === "loading" || loading) {
    return (
      <div>
        <div className="mb-4">
          <div className="h-5 w-28 rounded bg-slate-200 animate-pulse" />
        </div>
        <SkeletonDashboard />
      </div>
    );
  }

  if (!canAccess) {
    return (
      <div className="text-center py-12">
        <p className="text-sm font-medium text-red-600">Access Denied</p>
        <p className="text-xs text-slate-500 mt-1">You do not have permission to view accounts.</p>
      </div>
    );
  }

  const s = data?.stats;

  const quickLinks = [
    { label: "Vendor Ledger", href: "/accounts/vendor-ledger", icon: BookOpen },
    { label: "Bank Statement", href: "/accounts/bank-upload", icon: FileSpreadsheet },
    { label: "Vendors", href: "/vendors", icon: Building2, count: s?.activeVendors },
    { label: "Bills", href: "/bills", icon: FileText, count: s?.pendingBills },
    { label: "Purchase Orders", href: "/purchase-orders", icon: ShoppingCart, count: s?.pendingPOs },
    { label: "Expenses", href: "/expenses", icon: Receipt },
    { label: "Daily Settlement", href: "/accounts/settlement", icon: Calculator },
  ];

  const todayLabel = new Date().toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-lg font-bold text-slate-900">Accounts</h1>
        <p className="text-[11px] text-slate-500 tabular-nums">{todayLabel}</p>
      </div>

      {/* Say the numbers are missing rather than rendering zeros. On a payables screen a
          silent ₹0 reads as "nothing is owed", which is the opposite of "we could not ask". */}
      {error && (
        <div className="mb-4">
          <ErrorBanner message={error} />
        </div>
      )}

      {/* Quick Actions */}
      <div className="flex gap-2 mb-4 overflow-x-auto scrollbar-hide pb-1">
        <Link href="/payments/new" className="shrink-0">
          <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-blue-600 text-white">
            <CreditCard className="h-4 w-4" />
            <span className="text-xs font-semibold">Record Payment</span>
          </div>
        </Link>
        <Link href="/receivables/new" className="shrink-0">
          <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-green-600 text-white">
            <Plus className="h-4 w-4" />
            <span className="text-xs font-semibold">New Invoice</span>
          </div>
        </Link>
        <Link href="/vendor-issues/new" className="shrink-0">
          <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-orange-600 text-white">
            <AlertCircle className="h-4 w-4" />
            <span className="text-xs font-semibold">Log Issue</span>
          </div>
        </Link>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-2 mb-4">
        <Link href="/bills" className="focus-ring rounded-xl">
          <Card className="bg-red-50 border-red-200 h-full transition-colors active:bg-red-100">
            <CardContent className="p-3">
              <div className="flex items-center gap-1.5 mb-1">
                <IndianRupee className="h-4 w-4 text-red-600 shrink-0" />
                <span className="text-[11px] text-red-600 font-medium">Vendor Payable</span>
              </div>
              <p className="text-xl font-bold text-red-700 tabular-nums">
                {formatCurrency(s?.outstandingPayable || 0)}
              </p>
            </CardContent>
          </Card>
        </Link>

        <Link href="/receivables" className="focus-ring rounded-xl">
          <Card className="bg-blue-50 border-blue-200 h-full transition-colors active:bg-blue-100">
            <CardContent className="p-3">
              <div className="flex items-center gap-1.5 mb-1">
                <HandCoins className="h-4 w-4 text-blue-600 shrink-0" />
                <span className="text-[11px] text-blue-600 font-medium">Receivable</span>
              </div>
              <p className="text-xl font-bold text-blue-700 tabular-nums">
                {s?.pendingReceivables || 0} <span className="text-sm font-semibold">pending</span>
              </p>
            </CardContent>
          </Card>
        </Link>

        <Link href="/bills" className="focus-ring rounded-xl">
          <Card className="bg-amber-50 border-amber-200 h-full transition-colors active:bg-amber-100">
            <CardContent className="p-3">
              <div className="flex items-center gap-1.5 mb-1">
                <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                <span className="text-[11px] text-amber-600 font-medium">Overdue</span>
              </div>
              <p className="text-xl font-bold text-amber-700 tabular-nums">
                {s?.overdueBills || 0} <span className="text-sm font-semibold">bills</span>
              </p>
            </CardContent>
          </Card>
        </Link>

        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-1.5 mb-1">
              <CreditCard className="h-4 w-4 text-green-600 shrink-0" />
              <span className="text-[11px] text-slate-500 font-medium">Paid (30d)</span>
            </div>
            <p className="text-xl font-bold text-green-700 tabular-nums">
              {formatCurrency(s?.totalPaid30d || 0)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Quick Links */}
      <div className="space-y-1 mb-4">
        {quickLinks.map((link) => {
          const Icon = link.icon;
          return (
            <Link key={link.href} href={link.href}>
              <div className="flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-slate-50 transition-colors">
                <Icon className="h-5 w-5 text-slate-500" />
                <span className="flex-1 text-sm font-medium text-slate-700">{link.label}</span>
                {link.count !== undefined && (
                  <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full tabular-nums">{link.count}</span>
                )}
                <ChevronRight className="h-4 w-4 text-slate-400" />
              </div>
            </Link>
          );
        })}
      </div>

      {/* Overdue Bills */}
      {data?.overdueBillsList && data.overdueBillsList.length > 0 && (
        <div className="mb-4">
          <h2 className="text-sm font-semibold text-slate-900 mb-2">Overdue Bills</h2>
          <div className="space-y-2">
            {data.overdueBillsList.map((bill) => (
              <Link key={bill.id} href={`/bills/${bill.id}`}>
                <Card className="border-red-200 hover:border-red-300 mb-2">
                  <CardContent className="p-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-slate-900">{bill.vendor.name}</p>
                        <p className="text-xs text-slate-500 tabular-nums">{bill.billNo} | Due: {new Date(bill.dueDate).toLocaleDateString("en-IN")}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-bold text-red-600 tabular-nums">
                          {formatCurrency(bill.amount - bill.paidAmount)}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Recent Payments */}
      {data?.recentPayments && data.recentPayments.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-slate-900 mb-2">Recent Payments</h2>
          <div className="space-y-2">
            {data.recentPayments.map((payment) => (
              <Card key={payment.id} className="mb-2">
                <CardContent className="p-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-slate-900">{payment.vendor.name}</p>
                      <p className="text-xs text-slate-500 tabular-nums">
                        {payment.bill?.billNo || "Advance"} | {new Date(payment.paymentDate).toLocaleDateString("en-IN")}
                      </p>
                    </div>
                    <p className="text-sm font-bold text-green-600 tabular-nums">{formatCurrency(payment.amount)}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
