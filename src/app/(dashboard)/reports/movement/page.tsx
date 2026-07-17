"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { SkeletonList } from "@/components/ui/skeleton";

interface MovementProduct {
  id: string; name: string; sku: string; currentStock: number;
  category: string; inward: number; outward: number;
  monthlyOutward: number; classification: "FAST" | "SLOW" | "DEAD";
}

interface MovementData {
  summary: { fast: number; slow: number; dead: number; totalInward: number; totalOutward: number };
  products: MovementProduct[];
}

const CLASSIFICATION_STYLE: Record<string, string> = {
  FAST: "success",
  SLOW: "warning",
  DEAD: "danger",
};

export default function MovementPage() {
  const [data, setData] = useState<MovementData | null>(null);
  const [loading, setLoading] = useState(true);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().split("T")[0];
  const today = new Date().toISOString().split("T")[0];
  const [dateFrom, setDateFrom] = useState(thirtyDaysAgo);
  const [dateTo, setDateTo] = useState(today);
  const [filter, setFilter] = useState("ALL");

  useEffect(() => {
    setLoading(true);
    fetch(`/api/reports/movement?dateFrom=${dateFrom}&dateTo=${dateTo}`)
      .then((r) => r.json())
      .then((res) => { if (res.success) setData(res.data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [dateFrom, dateTo]);

  const filtered = data?.products.filter((p) => filter === "ALL" || p.classification === filter) || [];

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <Link href="/reports" aria-label="Back" className="p-2 -ml-2 rounded-lg hover:bg-slate-100 focus-ring"><ArrowLeft className="h-5 w-5 text-slate-600" /></Link>
        <h1 className="text-lg font-bold text-slate-900">Movement Analysis</h1>
      </div>

      <div className="grid grid-cols-2 gap-2 mb-3">
        <div>
          <label className="text-xs text-slate-500">From</label>
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-slate-500">To</label>
          <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </div>
      </div>

      {data && (
        <div className="grid grid-cols-3 gap-2 mb-4">
          <Card className="bg-green-50 border-green-200"><CardContent className="p-2 text-center">
            <p className="text-xl font-bold text-green-700 tabular-nums">{data.summary.fast}</p>
            <p className="text-[11px] text-green-600 font-medium">Fast</p>
          </CardContent></Card>
          <Card className="bg-amber-50 border-amber-200"><CardContent className="p-2 text-center">
            <p className="text-xl font-bold text-amber-700 tabular-nums">{data.summary.slow}</p>
            <p className="text-[11px] text-amber-600 font-medium">Slow</p>
          </CardContent></Card>
          <Card className="bg-red-50 border-red-200"><CardContent className="p-2 text-center">
            <p className="text-xl font-bold text-red-700 tabular-nums">{data.summary.dead}</p>
            <p className="text-[11px] text-red-600 font-medium">Dead</p>
          </CardContent></Card>
        </div>
      )}

      <div className="flex gap-2 overflow-x-auto scrollbar-hide mb-3 pb-1">
        {["ALL", "FAST", "SLOW", "DEAD"].map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${filter === f ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"}`}>
            {f === "ALL" ? "All" : f}
          </button>
        ))}
      </div>

      {loading ? (
        <SkeletonList count={6} type="card" />
      ) : (
        <div className="space-y-2">
          {filtered.map((p) => (
            <Card key={p.id} className="mb-2">
              <CardContent className="p-3">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0 mr-2">
                    <p className="text-sm font-medium text-slate-900">{p.name}</p>
                    <p className="text-[11px] text-slate-500 tabular-nums">{p.sku} | {p.category} | Stock: {p.currentStock}</p>
                  </div>
                  <Badge variant={CLASSIFICATION_STYLE[p.classification] as "success" | "warning" | "danger"}>
                    {p.classification}
                  </Badge>
                </div>
                <div className="flex gap-4 mt-1.5 text-xs tabular-nums">
                  <span className="text-blue-600">In: {p.inward}</span>
                  <span className="text-orange-600">Out: {p.outward}</span>
                  <span className="text-slate-500">{p.monthlyOutward}/mo</span>
                </div>
              </CardContent>
            </Card>
          ))}
          {filtered.length === 0 && <p className="text-sm text-slate-400 text-center py-8">No products found</p>}
        </div>
      )}
    </div>
  );
}
