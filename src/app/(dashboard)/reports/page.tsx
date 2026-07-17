"use client";

import Link from "next/link";
import { Package, TrendingUp, ShoppingCart, Receipt, Calendar, Percent, ChevronRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

const reports = [
  {
    title: "Stock Value",
    description: "Total inventory value by category, brand, or type",
    href: "/reports/stock-value",
    icon: Package,
    iconBg: "bg-blue-100 text-blue-600",
  },
  {
    title: "Movement Analysis",
    description: "Fast, slow, and dead stock identification",
    href: "/reports/movement",
    icon: TrendingUp,
    iconBg: "bg-green-100 text-green-600",
  },
  {
    title: "Purchase Report",
    description: "Vendor-wise purchase summary",
    href: "/reports/purchase",
    icon: ShoppingCart,
    iconBg: "bg-purple-100 text-purple-600",
  },
  {
    title: "Expense Summary",
    description: "Category-wise expense breakdown",
    href: "/reports/expense-summary",
    icon: Receipt,
    iconBg: "bg-orange-100 text-orange-600",
  },
  {
    title: "CD Discount Summary",
    description: "Cash discount earned, missed, and eligible by vendor",
    href: "/reports/cd-summary",
    icon: Percent,
    iconBg: "bg-teal-100 text-teal-600",
  },
  {
    title: "Daily Activity",
    description: "Today's inwards, outwards, payments, expenses",
    href: "/reports/daily",
    icon: Calendar,
    iconBg: "bg-slate-100 text-slate-600",
  },
];

export default function ReportsPage() {
  return (
    <div>
      <h1 className="text-lg font-bold text-slate-900 mb-3">Reports</h1>

      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-2">
        {reports.map((report) => {
          const Icon = report.icon;
          return (
            <Link key={report.href} href={report.href} className="focus-ring rounded-xl">
              <Card className="rounded-xl border border-slate-200 bg-white shadow-sm hover:shadow-md transition-shadow">
                <CardContent className="p-4 flex items-center gap-3">
                  <div className={`h-10 w-10 rounded-lg ${report.iconBg} flex items-center justify-center shrink-0`}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-900">{report.title}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{report.description}</p>
                  </div>
                  <ChevronRight className="h-5 w-5 text-slate-400 shrink-0" />
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
