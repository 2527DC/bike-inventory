"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  Brain, ShoppingCart, TrendingUp, AlertTriangle, BarChart3,
  ArrowUp, ArrowDown, Minus, Package, Clock,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SkeletonList } from "@/components/ui/skeleton";

type Tab = "insights" | "reorder" | "forecast" | "alerts";

interface Insight { type: string; title: string; severity: string; value: number; }
interface ReorderItem {
  product: { id: string; sku: string; name: string; type: string; category?: string; brand?: string };
  currentStock: number; avgDailySales: number; reorderPoint: number;
  daysUntilStockout: number; suggestedQty: number; vendorName: string | null;
}
interface ForecastItem {
  product: { id: string; sku: string; name: string; type: string; category?: string };
  currentStock: number; sales30: number; sales60: number; sales90: number;
  classification: string; trend: string; projectedMonthlyDemand: number; monthsOfStockLeft: number;
}
interface AlertItem {
  product: { id: string; sku: string; name: string; type: string; category?: string };
  currentStock: number; deficit: number; daysUntilStockout: number;
  priorityScore: number; priority: string;
}

const SEVERITY_MAP: Record<string, "success" | "warning" | "danger" | "info"> = {
  success: "success", warning: "warning", danger: "danger", info: "info",
};
const CLASS_MAP: Record<string, "success" | "warning" | "danger" | "info"> = {
  FAST: "success", MEDIUM: "info", SLOW: "warning", DEAD: "danger",
};
const PRIORITY_MAP: Record<string, "danger" | "warning" | "info" | "success"> = {
  CRITICAL: "danger", HIGH: "warning", MEDIUM: "info", LOW: "success",
};
const TREND_ICON: Record<string, typeof ArrowUp> = {
  INCREASING: ArrowUp, DECREASING: ArrowDown, STABLE: Minus,
};

export default function AIPage() {
  const [tab, setTab] = useState<Tab>("insights");
  const [insights, setInsights] = useState<Insight[]>([]);
  const [reorder, setReorder] = useState<ReorderItem[]>([]);
  const [forecast, setForecast] = useState<ForecastItem[]>([]);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const endpoint = tab === "insights" ? "/api/ai/dashboard-insights"
      : tab === "reorder" ? "/api/ai/reorder-suggestions"
      : tab === "forecast" ? "/api/ai/demand-forecast"
      : "/api/ai/low-stock-alerts";

    fetch(endpoint)
      .then((r) => r.json())
      .then((res) => {
        if (res.success) {
          if (tab === "insights") setInsights(res.data);
          else if (tab === "reorder") setReorder(res.data);
          else if (tab === "forecast") setForecast(res.data);
          else setAlerts(res.data);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [tab]);

  const TABS: { key: Tab; label: string; icon: typeof Brain }[] = [
    { key: "insights", label: "Overview", icon: BarChart3 },
    { key: "reorder", label: "Reorder", icon: ShoppingCart },
    { key: "forecast", label: "Forecast", icon: TrendingUp },
    { key: "alerts", label: "Alerts", icon: AlertTriangle },
  ];

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <Brain className="h-5 w-5 text-purple-600" />
        <h1 className="text-lg font-bold text-slate-900">AI Insights</h1>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-100 rounded-lg p-1 mb-4">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-md text-xs font-medium transition-colors focus-ring ${
                tab === t.key ? "bg-white shadow-sm text-slate-900" : "text-slate-500"
              }`}>
              <Icon className="h-3.5 w-3.5" />{t.label}
            </button>
          );
        })}
      </div>

      {loading ? (
        <SkeletonList count={6} type="card" />
      ) : (
        <>
          {/* Insights Tab */}
          {tab === "insights" && (
            insights.length === 0 ? (
              <div className="text-center py-12">
                <BarChart3 className="h-10 w-10 text-slate-300 mx-auto mb-2" />
                <p className="text-sm text-slate-500">No insights available yet</p>
                <p className="text-xs text-slate-400 mt-1">Add products and record transactions to generate insights</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {insights.map((item) => (
                  <Card key={item.type} className={item.severity === "danger" ? "border-red-200 bg-red-50" : item.severity === "warning" ? "border-yellow-200 bg-yellow-50" : ""}>
                    <CardContent className="p-3">
                      <Badge variant={SEVERITY_MAP[item.severity] || "info"} className="text-[11px] mb-1">{item.type.replace("_", " ")}</Badge>
                      <p className="text-xs text-slate-700 leading-tight">{item.title}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )
          )}

          {/* Reorder Tab */}
          {tab === "reorder" && (
            reorder.length === 0 ? (
              <div className="text-center py-12">
                <ShoppingCart className="h-10 w-10 text-green-300 mx-auto mb-2" />
                <p className="text-sm text-slate-500">All stock levels are healthy</p>
              </div>
            ) : (
              <div className="space-y-2">
                {reorder.map((item) => (
                  <Link key={item.product.id} href={`/stock/${item.product.id}`}>
                    <Card className={item.daysUntilStockout < 7 ? "border-red-200" : ""}>
                      <CardContent className="p-3">
                        <div className="flex items-start justify-between mb-1">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold text-slate-900">{item.product.name}</p>
                            <p className="text-[11px] text-slate-500">{item.product.sku} | {item.product.category}</p>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <Clock className="h-3 w-3 text-slate-400" />
                            <span className={`text-xs font-bold tabular-nums ${item.daysUntilStockout < 7 ? "text-red-600" : "text-slate-600"}`}>
                              {item.daysUntilStockout}d
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 text-[11px] text-slate-500">
                          <span>Stock: <b className="text-slate-700 tabular-nums">{item.currentStock}</b></span>
                          <span>Reorder at: <b className="tabular-nums">{item.reorderPoint}</b></span>
                          <span>Order: <b className="text-blue-600 tabular-nums">{item.suggestedQty}</b></span>
                        </div>
                        {item.vendorName && <p className="text-[11px] text-slate-400 mt-1">Vendor: {item.vendorName}</p>}
                      </CardContent>
                    </Card>
                  </Link>
                ))}
              </div>
            )
          )}

          {/* Forecast Tab */}
          {tab === "forecast" && (
            <div className="space-y-2">
              {forecast.length === 0 ? (
                <div className="text-center py-12">
                  <TrendingUp className="h-10 w-10 text-slate-300 mx-auto mb-2" />
                  <p className="text-sm text-slate-500">No forecast data yet</p>
                </div>
              ) : forecast.map((item) => {
                const TrendIcon = TREND_ICON[item.trend] || Minus;
                return (
                  <Card key={item.product.id}>
                    <CardContent className="p-3">
                      <div className="flex items-start justify-between mb-1">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-slate-900">{item.product.name}</p>
                          <p className="text-[11px] text-slate-500">{item.product.sku}</p>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Badge variant={CLASS_MAP[item.classification] || "info"} className="text-[11px]">{item.classification}</Badge>
                          <TrendIcon className={`h-3.5 w-3.5 ${item.trend === "INCREASING" ? "text-green-500" : item.trend === "DECREASING" ? "text-red-500" : "text-slate-400"}`} />
                        </div>
                      </div>
                      <div className="flex items-center gap-3 text-[11px] text-slate-500">
                        <span>30d: <b className="tabular-nums">{item.sales30}</b></span>
                        <span>60d: <b className="tabular-nums">{item.sales60}</b></span>
                        <span>90d: <b className="tabular-nums">{item.sales90}</b></span>
                        <span>Stock: <b className="tabular-nums">{item.monthsOfStockLeft < 999 ? `${item.monthsOfStockLeft}mo` : "--"}</b></span>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}

          {/* Alerts Tab */}
          {tab === "alerts" && (
            alerts.length === 0 ? (
              <div className="text-center py-12">
                <Package className="h-10 w-10 text-green-300 mx-auto mb-2" />
                <p className="text-sm text-slate-500">No low stock alerts</p>
              </div>
            ) : (
              <div className="space-y-2">
                {alerts.map((item) => (
                  <Link key={item.product.id} href={`/stock/${item.product.id}`}>
                    <Card className={item.priority === "CRITICAL" ? "border-red-300 bg-red-50" : item.priority === "HIGH" ? "border-yellow-200 bg-yellow-50" : ""}>
                      <CardContent className="p-3">
                        <div className="flex items-start justify-between mb-1">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold text-slate-900">{item.product.name}</p>
                            <p className="text-[11px] text-slate-500">{item.product.sku} | {item.product.category}</p>
                          </div>
                          <Badge variant={PRIORITY_MAP[item.priority] || "info"} className="text-[11px]">{item.priority}</Badge>
                        </div>
                        <div className="flex items-center gap-3 text-[11px] text-slate-500">
                          <span>Stock: <b className="text-red-600 tabular-nums">{item.currentStock}</b></span>
                          <span>Deficit: <b className="tabular-nums">{item.deficit}</b></span>
                          <span>Stockout in: <b className="tabular-nums">{item.daysUntilStockout < 999 ? `${item.daysUntilStockout}d` : "--"}</b></span>
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                ))}
              </div>
            )
          )}
        </>
      )}
    </div>
  );
}
