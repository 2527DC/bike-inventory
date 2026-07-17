"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { ArrowLeft, TrendingUp, TrendingDown, Truck, Package } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { SkeletonList } from "@/components/ui/skeleton";

interface StockValueData {
  totalItems: number;
  totalProducts: number;
  totalCostValue: number;
  totalSellingValue: number;
  totalMrpValue: number;
  totalInTransitQty: number;
  totalInTransitValue: number;
  totalOutwardQty: number;
  totalOutwardValue: number;
  effectiveCostValue: number;
  effectiveQty: number;
  breakdown: Array<{
    name: string; count: number; qty: number;
    costValue: number; sellingValue: number; mrpValue: number;
    inTransitQty: number; inTransitValue: number;
    outwardQty: number; outwardValue: number;
  }>;
}

function fmt(amount: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount);
}

const TABS = [
  { key: "category", label: "By Category" },
  { key: "brand", label: "By Brand" },
  { key: "type", label: "By Type" },
];

export default function StockValuePage() {
  const [data, setData] = useState<StockValueData | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("category");

  useEffect(() => {
    setLoading(true);
    fetch(`/api/reports/stock-value?groupBy=${tab}`)
      .then((r) => r.json())
      .then((res) => { if (res.success) setData(res.data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [tab]);

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <Link href="/reports" aria-label="Back" className="p-2 -ml-2 rounded-lg hover:bg-slate-100 focus-ring"><ArrowLeft className="h-5 w-5 text-slate-600" /></Link>
        <h1 className="text-lg font-bold text-slate-900">Stock Value</h1>
      </div>

      {/* Effective Stock Value — the main number */}
      {data && (
        <Card className="bg-indigo-50 border-indigo-200 mb-3">
          <CardContent className="p-4">
            <p className="text-xs text-indigo-600 font-medium mb-1">Effective Stock Value</p>
            <p className="text-2xl font-bold text-indigo-800 tabular-nums">{fmt(data.effectiveCostValue)}</p>
            <p className="text-[11px] text-indigo-500 mt-1 tabular-nums">
              {data.effectiveQty.toLocaleString("en-IN")} units (current + in-transit − outward pending)
            </p>
          </CardContent>
        </Card>
      )}

      {/* Formula breakdown */}
      {data && (
        <div className="space-y-1.5 mb-4">
          {/* Current Stock */}
          <Card>
            <CardContent className="p-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Package className="h-4 w-4 text-blue-500" />
                <div>
                  <p className="text-xs font-medium text-slate-700">Current Stock</p>
                  <p className="text-[11px] text-slate-400 tabular-nums">{data.totalItems.toLocaleString("en-IN")} units</p>
                </div>
              </div>
              <p className="text-sm font-bold text-blue-700 tabular-nums">{fmt(data.totalCostValue)}</p>
            </CardContent>
          </Card>

          {/* + In Transit */}
          <Card className="bg-amber-50/50 border-amber-200">
            <CardContent className="p-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-amber-500" />
                <div>
                  <p className="text-xs font-medium text-amber-700">+ In Transit (Inbound)</p>
                  <p className="text-[11px] text-amber-500 tabular-nums">{data.totalInTransitQty.toLocaleString("en-IN")} units arriving</p>
                </div>
              </div>
              <p className="text-sm font-bold text-amber-700 tabular-nums">+ {fmt(data.totalInTransitValue)}</p>
            </CardContent>
          </Card>

          {/* − Outward Pending */}
          <Card className="bg-red-50/50 border-red-200">
            <CardContent className="p-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <TrendingDown className="h-4 w-4 text-red-500" />
                <div>
                  <p className="text-xs font-medium text-red-700">− Outward Pending (Deliveries)</p>
                  <p className="text-[11px] text-red-500 tabular-nums">{data.totalOutwardQty.toLocaleString("en-IN")} units to dispatch</p>
                </div>
              </div>
              <p className="text-sm font-bold text-red-700 tabular-nums">− {fmt(data.totalOutwardValue)}</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Selling vs MRP */}
      {data && (
        <div className="grid grid-cols-2 gap-2 mb-4">
          <Card className="bg-green-50 border-green-200"><CardContent className="p-3">
            <p className="text-[11px] text-green-600">Selling Value</p>
            <p className="text-xl font-bold text-green-700 tabular-nums">{fmt(data.totalSellingValue)}</p>
          </CardContent></Card>
          <Card className="bg-purple-50 border-purple-200"><CardContent className="p-3">
            <p className="text-[11px] text-purple-600">MRP Value</p>
            <p className="text-xl font-bold text-purple-700 tabular-nums">{fmt(data.totalMrpValue)}</p>
          </CardContent></Card>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-4 bg-slate-100 rounded-lg p-1">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex-1 text-xs font-medium py-2 rounded-md transition-colors focus-ring ${tab === t.key ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <SkeletonList count={6} type="card" />
      ) : (
        <div className="space-y-2">
          {data?.breakdown.map((group, i) => (
            <Card key={i}>
              <CardContent className="p-3">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-sm font-medium text-slate-900">{group.name}</p>
                  <span className="text-xs text-slate-500 tabular-nums">{group.count} products | {group.qty} units</span>
                </div>
                <div className="flex gap-4 text-xs">
                  <span className="text-blue-600 tabular-nums">Cost: {fmt(group.costValue)}</span>
                  <span className="text-green-600 tabular-nums">Sell: {fmt(group.sellingValue)}</span>
                </div>
                {(group.inTransitQty > 0 || group.outwardQty > 0) && (
                  <div className="flex gap-4 text-[11px] mt-1">
                    {group.inTransitQty > 0 && (
                      <span className="text-amber-600 tabular-nums">+{group.inTransitQty} incoming</span>
                    )}
                    {group.outwardQty > 0 && (
                      <span className="text-red-600 tabular-nums">−{group.outwardQty} outward</span>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
          {data?.breakdown.length === 0 && <p className="text-sm text-slate-400 text-center py-8">No stock data</p>}
        </div>
      )}
    </div>
  );
}
