"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SkeletonList } from "@/components/ui/skeleton";

interface ExpenseSummaryData {
  total: number;
  dailyAvg: number;
  totalCount: number;
  categories: Array<{ category: string; amount: number; count: number; percentage: number }>;
}

function fmt(amount: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount);
}

const CATEGORY_COLORS: Record<string, string> = {
  DELIVERY: "border-l-blue-500 bg-blue-50/30",
  TRANSPORT: "border-l-purple-500 bg-purple-50/30",
  SHOP_MAINTENANCE: "border-l-orange-500 bg-orange-50/30",
  UTILITIES: "border-l-cyan-500 bg-cyan-50/30",
  SALARY_ADVANCE: "border-l-pink-500 bg-pink-50/30",
  FOOD_TEA: "border-l-amber-500 bg-amber-50/30",
  STATIONERY: "border-l-indigo-500 bg-indigo-50/30",
  MISCELLANEOUS: "border-l-slate-500 bg-slate-50/30",
};

export default function ExpenseSummaryPage() {
  const [data, setData] = useState<ExpenseSummaryData | null>(null);
  const [loading, setLoading] = useState(true);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().split("T")[0];
  const today = new Date().toISOString().split("T")[0];
  const [dateFrom, setDateFrom] = useState(thirtyDaysAgo);
  const [dateTo, setDateTo] = useState(today);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/reports/expense-summary?dateFrom=${dateFrom}&dateTo=${dateTo}`)
      .then((r) => r.json())
      .then((res) => { if (res.success) setData(res.data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [dateFrom, dateTo]);

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <Link href="/reports" aria-label="Back" className="p-2 -ml-2 rounded-lg hover:bg-slate-100 focus-ring"><ArrowLeft className="h-5 w-5 text-slate-600" /></Link>
        <h1 className="text-lg font-bold text-slate-900">Expense Summary</h1>
      </div>

      <div className="grid grid-cols-2 gap-2 mb-3">
        <div><label className="text-xs text-slate-500">From</label><Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} /></div>
        <div><label className="text-xs text-slate-500">To</label><Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} /></div>
      </div>

      {data && (
        <div className="grid grid-cols-2 gap-2 mb-4">
          <Card className="bg-red-50 border-red-200"><CardContent className="p-3">
            <p className="text-[11px] text-red-600">Total Expenses</p>
            <p className="text-xl font-bold text-red-700 tabular-nums">{fmt(data.total)}</p>
            <p className="text-[11px] text-red-500 tabular-nums">{data.totalCount} entries</p>
          </CardContent></Card>
          <Card><CardContent className="p-3">
            <p className="text-[11px] text-slate-500">Daily Average</p>
            <p className="text-xl font-bold text-slate-900 tabular-nums">{fmt(data.dailyAvg)}</p>
          </CardContent></Card>
        </div>
      )}

      {loading ? (
        <SkeletonList count={6} type="card" />
      ) : (
        <div className="space-y-2">
          {data?.categories.map((cat) => (
            <Card key={cat.category} className={`border-l-4 ${CATEGORY_COLORS[cat.category] || "border-l-slate-500"}`}>
              <CardContent className="p-3">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-sm font-medium text-slate-900">{cat.category.replace(/_/g, " ")}</p>
                  <p className="text-sm font-bold text-slate-900 tabular-nums">{fmt(cat.amount)}</p>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-500 tabular-nums">{cat.count} entries</span>
                  <span className="text-xs text-slate-500 tabular-nums">{cat.percentage}%</span>
                </div>
                <div className="w-full bg-slate-200 rounded-full h-1.5 mt-1.5">
                  <div className="bg-slate-500 h-1.5 rounded-full" style={{ width: `${cat.percentage}%` }} />
                </div>
              </CardContent>
            </Card>
          ))}
          {data?.categories.length === 0 && <p className="text-sm text-slate-400 text-center py-8">No expense data</p>}
        </div>
      )}
    </div>
  );
}
