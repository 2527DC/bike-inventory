"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowDownCircle, ArrowUpCircle, CreditCard, Receipt, ArrowRightLeft, MessageCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { SkeletonDashboard } from "@/components/ui/skeleton";

interface DailyData {
  date: string;
  inwards: { count: number; totalQty: number };
  outwards: { count: number; totalQty: number };
  payments: { count: number; totalAmount: number };
  expenses: { count: number; totalAmount: number };
  transfers: number;
  recentTransactions: Array<{
    id: string; type: string; quantity: number; createdAt: string;
    product: { name: string; sku: string };
    user: { name: string };
  }>;
}

function fmt(amount: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount);
}

export default function DailyReportPage() {
  const [data, setData] = useState<DailyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/reports/daily?date=${date}`)
      .then((r) => r.json())
      .then((res) => { if (res.success) setData(res.data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [date]);

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <Link href="/reports" aria-label="Back" className="p-2 -ml-2 rounded-lg hover:bg-slate-100 focus-ring"><ArrowLeft className="h-5 w-5 text-slate-600" /></Link>
        <h1 className="text-lg font-bold text-slate-900">Daily Activity</h1>
      </div>

      <div className="mb-4">
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>

      {loading ? (
        <SkeletonDashboard />
      ) : data && (
        <>
          <div className="grid grid-cols-2 gap-2 mb-4">
            <Card className="bg-blue-50 border-blue-200">
              <CardContent className="p-3">
                <div className="flex items-center gap-2 mb-1">
                  <ArrowDownCircle className="h-4 w-4 text-blue-600" />
                  <span className="text-[11px] text-blue-600 font-medium">Inwards</span>
                </div>
                <p className="text-xl font-bold text-blue-700 tabular-nums">{data.inwards.totalQty} <span className="text-sm font-semibold">units</span></p>
                <p className="text-[11px] text-blue-500 tabular-nums">{data.inwards.count} transactions</p>
              </CardContent>
            </Card>

            <Card className="bg-orange-50 border-orange-200">
              <CardContent className="p-3">
                <div className="flex items-center gap-2 mb-1">
                  <ArrowUpCircle className="h-4 w-4 text-orange-600" />
                  <span className="text-[11px] text-orange-600 font-medium">Outwards</span>
                </div>
                <p className="text-xl font-bold text-orange-700 tabular-nums">{data.outwards.totalQty} <span className="text-sm font-semibold">units</span></p>
                <p className="text-[11px] text-orange-500 tabular-nums">{data.outwards.count} transactions</p>
              </CardContent>
            </Card>

            <Card className="bg-green-50 border-green-200">
              <CardContent className="p-3">
                <div className="flex items-center gap-2 mb-1">
                  <CreditCard className="h-4 w-4 text-green-600" />
                  <span className="text-[11px] text-green-600 font-medium">Payments</span>
                </div>
                <p className="text-xl font-bold text-green-700 tabular-nums">{fmt(data.payments.totalAmount)}</p>
                <p className="text-[11px] text-green-500 tabular-nums">{data.payments.count} payments</p>
              </CardContent>
            </Card>

            <Card className="bg-red-50 border-red-200">
              <CardContent className="p-3">
                <div className="flex items-center gap-2 mb-1">
                  <Receipt className="h-4 w-4 text-red-600" />
                  <span className="text-[11px] text-red-600 font-medium">Expenses</span>
                </div>
                <p className="text-xl font-bold text-red-700 tabular-nums">{fmt(data.expenses.totalAmount)}</p>
                <p className="text-[11px] text-red-500 tabular-nums">{data.expenses.count} entries</p>
              </CardContent>
            </Card>
          </div>

          {/* Transfers */}
          {data.transfers > 0 && (
            <Card className="mb-4 bg-purple-50 border-purple-200">
              <CardContent className="p-3">
                <div className="flex items-center gap-2">
                  <ArrowRightLeft className="h-4 w-4 text-purple-600" />
                  <span className="text-[11px] text-purple-600 font-medium">Transfers</span>
                  <span className="text-xl font-bold text-purple-700 ml-auto tabular-nums">{data.transfers}</span>
                  <span className="text-[11px] text-purple-500">completed</span>
                </div>
              </CardContent>
            </Card>
          )}

          {/* WhatsApp Share */}
          <button
            onClick={() => {
              const d = new Date(data.date).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
              const msg = `*BCH Daily Report — ${d}*\n\nInwards: ${data.inwards.totalQty} items (${data.inwards.count} entries)\nOutwards: ${data.outwards.totalQty} items (${data.outwards.count} entries)\nPayments: ${fmt(data.payments.totalAmount)} (${data.payments.count})\nExpenses: ${fmt(data.expenses.totalAmount)} (${data.expenses.count})${data.transfers > 0 ? `\nTransfers: ${data.transfers} completed` : ""}\n\n— Sent from BCH App`;
              window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, "_blank");
            }}
            className="w-full flex items-center justify-center gap-2 bg-green-600 text-white py-2.5 rounded-lg text-sm font-medium mb-4"
          >
            <MessageCircle className="h-4 w-4" /> Share to WhatsApp
          </button>

          {data.recentTransactions.length > 0 && (
            <>
              <h2 className="text-sm font-semibold text-slate-900 mb-2">Transactions</h2>
              <div className="space-y-2">
                {data.recentTransactions.map((t) => (
                  <Card key={t.id} className="mb-2">
                    <CardContent className="p-3 flex items-center justify-between">
                      <div className="min-w-0 mr-2">
                        <p className="text-sm font-medium text-slate-900 truncate">{t.product.name}</p>
                        <p className="text-[11px] text-slate-500 tabular-nums">{t.product.sku} | By: {t.user.name}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-base font-bold text-slate-900 tabular-nums">{t.quantity}</p>
                        <Badge variant={t.type === "INWARD" ? "info" : "warning"}>{t.type}</Badge>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
