"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { ArrowLeft, AlertTriangle, Package, Store, Warehouse, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface LocationStock {
  key: string;
  label: string;
  site: "BCH" | "BCC";
  kind: "Warehouse" | "Store";
  totalStock: number;
  totalValue: number;
  productCount: number;
  lowStockCount: number;
  outOfStockCount: number;
}

const SITE_NAMES: Record<string, string> = {
  BCH: "Bharath Cycle Hub",
  BCC: "Bharath Cycle Centre",
};

function formatINR(n: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
}

export default function StockByLocationPage() {
  const [locations, setLocations] = useState<LocationStock[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/stock/by-bin")
      .then((r) => r.json())
      .then((res) => { if (res.success && res.data?.locations) setLocations(res.data.locations); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const totalStock = locations.reduce((s, l) => s + l.totalStock, 0);
  const totalValue = locations.reduce((s, l) => s + l.totalValue, 0);

  // Group locations by site, preserving order.
  const sites: { site: string; locs: LocationStock[] }[] = [];
  for (const loc of locations) {
    let group = sites.find((s) => s.site === loc.site);
    if (!group) { group = { site: loc.site, locs: [] }; sites.push(group); }
    group.locs.push(loc);
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-3">
        <Link href="/stock" className="p-1">
          <ArrowLeft className="h-5 w-5 text-slate-600" />
        </Link>
        <div className="flex-1">
          <h1 className="text-lg font-bold text-slate-900">Stock by Location</h1>
          <p className="text-xs text-slate-500">
            {totalStock.toLocaleString("en-IN")} units | {formatINR(totalValue)}
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 gap-2">
          <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
          <span className="text-sm text-slate-400">Loading...</span>
        </div>
      ) : locations.length === 0 ? (
        <div className="text-center py-12">
          <Package className="h-10 w-10 text-slate-300 mx-auto mb-2" />
          <p className="text-sm text-slate-400">No stock data</p>
        </div>
      ) : (
        <div className="space-y-5">
          {sites.map((group) => (
            <div key={group.site}>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                {SITE_NAMES[group.site] || group.site}
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                {group.locs.map((loc) => (
                  <Link key={loc.key} href={`/stock/by-location/${loc.key}`} className="block">
                    <Card className="hover:border-slate-300 transition-colors">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-3 mb-3">
                        <div className={`h-10 w-10 rounded-xl flex items-center justify-center ${loc.kind === "Warehouse" ? "bg-amber-100 text-amber-700" : "bg-blue-100 text-blue-700"}`}>
                          {loc.kind === "Warehouse" ? <Warehouse className="h-5 w-5" /> : <Store className="h-5 w-5" />}
                        </div>
                        <div className="flex-1">
                          <p className="text-base font-semibold text-slate-900">{loc.label}</p>
                          <p className="text-xs text-slate-500">{loc.productCount.toLocaleString("en-IN")} products in stock</p>
                        </div>
                        <div className="text-right">
                          <p className="text-lg font-bold text-slate-800">{loc.totalStock.toLocaleString("en-IN")}</p>
                          <p className="text-[10px] text-slate-400">units</p>
                        </div>
                      </div>
                      <div className="flex items-center justify-between border-t border-slate-100 pt-2.5">
                        <span className="text-xs text-slate-500">Stock value</span>
                        <span className="text-sm font-semibold text-slate-700">{formatINR(loc.totalValue)}</span>
                      </div>
                      {(loc.lowStockCount > 0 || loc.outOfStockCount > 0) && (
                        <div className="flex items-center gap-2 mt-2">
                          {loc.lowStockCount > 0 && (
                            <Badge variant="warning" className="text-[10px]">
                              <AlertTriangle className="h-2.5 w-2.5 mr-0.5" />
                              {loc.lowStockCount} low
                            </Badge>
                          )}
                          {loc.outOfStockCount > 0 && (
                            <Badge variant="danger" className="text-[10px]">{loc.outOfStockCount} out of stock</Badge>
                          )}
                        </div>
                      )}
                      <p className="text-[11px] font-medium text-blue-600 mt-2">View stock by brand →</p>
                    </CardContent>
                    </Card>
                  </Link>
                ))}
              </div>
            </div>
          ))}
          <p className="text-[11px] text-slate-400 text-center pt-1">
            Move stock between locations using Transfers. Counts set each location&apos;s true quantity.
          </p>
        </div>
      )}
    </div>
  );
}
