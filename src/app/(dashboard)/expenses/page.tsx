"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { Paperclip, Plus, Receipt, Search } from "lucide-react";
import { type DateRangeKey } from "@/components/date-filter";
import { FilterSheet } from "@/components/filter-sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { ErrorBanner } from "@/components/ui/error-banner";
import { DesktopTable } from "@/components/desktop-table";
import { usePermissions } from "@/lib/use-permissions";
import { SkeletonList } from "@/components/ui/skeleton";
import { apiTry } from "@/lib/api-client";

interface ExpenseItem {
  id: string;
  date: string;
  amount: number;
  category: string;
  description: string;
  paidBy: string;
  paymentMode: string;
  /** The receipt photo, when one was attached at entry. */
  receiptUrl?: string | null;
  recordedBy: { name: string };
}

/** A paperclip that opens the receipt photo; nothing when the row has none. */
function ReceiptLink({ url, className = "" }: { url?: string | null; className?: string }) {
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      aria-label="View receipt photo"
      title="View receipt photo"
      className={`inline-flex items-center justify-center rounded-md text-blue-600 hover:bg-blue-50 ${className}`}
    >
      <Paperclip className="h-4 w-4" />
    </a>
  );
}

const CATEGORY_FILTERS = ["ALL", "DELIVERY", "TRANSPORT", "SHOP_MAINTENANCE", "UTILITIES", "SALARY_ADVANCE", "FOOD_TEA", "STATIONERY", "MISCELLANEOUS"];

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount);
}

const CATEGORY_COLORS: Record<string, string> = {
  DELIVERY: "bg-blue-100 text-blue-700",
  TRANSPORT: "bg-purple-100 text-purple-700",
  SHOP_MAINTENANCE: "bg-orange-100 text-orange-700",
  UTILITIES: "bg-cyan-100 text-cyan-700",
  SALARY_ADVANCE: "bg-pink-100 text-pink-700",
  FOOD_TEA: "bg-amber-100 text-amber-700",
  STATIONERY: "bg-indigo-100 text-indigo-700",
  MISCELLANEOUS: "bg-slate-100 text-slate-700",
};

export default function ExpensesPage() {
  const { status: sessionStatus } = useSession();
  const { canView } = usePermissions();
  const canAccess = canView("expenses");

  const [expenses, setExpenses] = useState<ExpenseItem[]>([]);
  const [filter, setFilter] = useState("ALL");
  const [totalAmount, setTotalAmount] = useState(0);
  const [searchText, setSearchText] = useState("");
  const [dateFilter, setDateFilter] = useState<DateRangeKey>("all");
  const [dateFrom, setDateFrom] = useState<string | undefined>();
  const [dateTo, setDateTo] = useState<string | undefined>();
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  // `loading` is derived, not set: the list is loading whenever the filters (or a retry) name
  // a request whose answer has not landed yet. Keeps every setState inside the response
  // callback, where the react-hooks lint wants it, instead of at the top of the effect.
  const requestKey = `${filter}|${dateFrom ?? ""}|${dateTo ?? ""}|${reloadKey}`;
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const loading = loadedFor !== requestKey;

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ limit: "50" });
    if (filter !== "ALL") params.set("category", filter);
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);

    // apiTry, not fetch().json(): an expired session answers with the login page as HTML and
    // status 200, which res.json() turns into "Unexpected token '<'" (CLAUDE.md).
    apiTry<ExpenseItem[]>(`/api/expenses?${params}`).then(({ data, error }) => {
      if (cancelled) return;
      if (error || !data) {
        setLoadError(error || "Failed to load expenses");
        setExpenses([]);
        setTotalAmount(0);
      } else {
        setLoadError(null);
        setExpenses(data);
        setTotalAmount(data.reduce((sum, e) => sum + e.amount, 0));
      }
      setLoadedFor(requestKey);
    });
    return () => {
      cancelled = true;
    };
  }, [filter, dateFrom, dateTo, requestKey]);

  if (sessionStatus === "loading") {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-6 w-6 border-2 border-slate-900 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!canAccess) {
    return (
      <div className="text-center py-12">
        <p className="text-sm font-medium text-red-600">Access Denied</p>
        <p className="text-xs text-slate-500 mt-1">You do not have permission to view expenses.</p>
      </div>
    );
  }

  const visibleExpenses = expenses.filter((exp) => {
    if (!searchText) return true;
    const q = searchText.toLowerCase();
    return exp.description.toLowerCase().includes(q) || exp.paidBy.toLowerCase().includes(q);
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h1 className="text-lg font-bold text-slate-900">Expenses</h1>
        <Link href="/expenses/new">
          <Button size="sm" className="bg-blue-600 hover:bg-blue-700">
            <Plus className="h-4 w-4 mr-1" /> Add
          </Button>
        </Link>
      </div>

      {/* Search */}
      <div className="relative mb-3">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <Input
          placeholder="Search description, paid by..."
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Total */}
      {expenses.length > 0 && (
        <Card className="bg-slate-50 mb-3">
          <CardContent className="p-3 flex items-center justify-between">
            <span className="text-sm text-slate-500">Total shown</span>
            <span className="text-xl font-bold text-slate-900 tabular-nums">{formatCurrency(totalAmount)}</span>
          </CardContent>
        </Card>
      )}

      <FilterSheet
        className="mb-4"
        dateValue={dateFilter}
        onDateChange={(key, from, to) => { setDateFilter(key); setDateFrom(from); setDateTo(to); }}
        groups={[{
          label: "Category",
          value: filter,
          defaultValue: "ALL",
          options: CATEGORY_FILTERS.map((c) => ({ key: c, label: c === "ALL" ? "All" : c.replace(/_/g, " ") })),
          onChange: (key) => setFilter(key),
        }]}
      />

      {loadError && !loading && (
        <ErrorBanner message={loadError} onRetry={() => setReloadKey((k) => k + 1)} />
      )}

      {loading ? (
        <SkeletonList count={6} type="card" />
      ) : (
        <>
        <DesktopTable
          className="hidden lg:block"
          rows={visibleExpenses}
          rowKey={(exp) => exp.id}
          emptyText="No expenses found"
          columns={[
            { header: "Description", cell: (exp) => <span className="font-medium text-slate-900">{exp.description}</span> },
            { header: "Date", cell: (exp) => new Date(exp.date).toLocaleDateString("en-IN"), className: "whitespace-nowrap text-slate-500" },
            { header: "Paid By", cell: (exp) => exp.paidBy },
            { header: "Mode", cell: (exp) => <span className="text-slate-500">{exp.paymentMode}</span> },
            { header: "Category", cell: (exp) => <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${CATEGORY_COLORS[exp.category] || "bg-slate-100 text-slate-700"}`}>{exp.category.replace(/_/g, " ")}</span> },
            { header: "Receipt", cell: (exp) => <ReceiptLink url={exp.receiptUrl} className="h-8 w-8" />, className: "text-center" },
            { header: "Amount", cell: (exp) => <span className="font-semibold text-slate-900 tabular-nums">{formatCurrency(exp.amount)}</span>, className: "text-right whitespace-nowrap" },
          ]}
        />
        <div className="space-y-2 lg:hidden">
          {visibleExpenses.map((exp) => (
            <div
              key={exp.id}
              className="block rounded-xl border border-slate-200 border-l-4 border-l-slate-200 bg-white shadow-sm"
            >
              <div className="p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-900 truncate">{exp.description}</p>
                    <p className="text-xs text-slate-500 tabular-nums mt-0.5 truncate">
                      {new Date(exp.date).toLocaleDateString("en-IN")} · {exp.paidBy} · {exp.paymentMode}
                    </p>
                    <span className={`inline-block mt-1.5 text-[11px] font-medium px-2 py-0.5 rounded-full ${CATEGORY_COLORS[exp.category] || "bg-slate-100 text-slate-700"}`}>
                      {exp.category.replace(/_/g, " ")}
                    </span>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <p className="text-sm font-bold text-slate-900 tabular-nums">{formatCurrency(exp.amount)}</p>
                    <ReceiptLink url={exp.receiptUrl} className="h-11 w-11 -mr-2 -mb-2" />
                  </div>
                </div>
              </div>
            </div>
          ))}

          {expenses.length === 0 && (
            <div className="text-center py-12">
              <Receipt className="h-8 w-8 text-slate-300 mx-auto mb-2" />
              <p className="text-sm text-slate-400">No expenses found</p>
            </div>
          )}
        </div>
        </>
      )}
    </div>
  );
}
