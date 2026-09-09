"use client";

import Link from "next/link";
import { AlertTriangle, Store, Warehouse } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

/**
 * One card for one place that holds stock — a warehouse on /stock/by-bin, a store on
 * /stock/by-store. Lifted from by-bin's inline markup (plan 0909-stock-store-and-warehouse-
 * scoping, B2) so the two listing screens share one dialect instead of two copies.
 *
 * `warehouses` is present only at store level: it prints the per-warehouse split under the
 * units ("Floor 3 · Godown 5"), which is R1 — both scopes — on one screen.
 */
export interface LocationCardData {
  key: string;
  label: string;
  kind: "Warehouse" | "Store";
  totalStock: number;
  totalValue: number;
  productCount: number;
  lowStockCount: number;
  outOfStockCount: number;
  warehouses?: Array<{ code: string; name: string; kind?: "FLOOR" | "GODOWN"; units: number }>;
}

export function formatINR(n: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
}

export function LocationCard({ loc, href }: { loc: LocationCardData; href: string }) {
  const isWarehouse = loc.kind === "Warehouse";
  return (
    <Link href={href} className="block">
      <Card className="hover:border-slate-300 transition-colors">
        <CardContent className="p-4">
          <div className="flex items-center gap-3 mb-3">
            <div className={`h-10 w-10 rounded-xl flex items-center justify-center ${isWarehouse ? "bg-amber-100 text-amber-700" : "bg-blue-100 text-blue-700"}`}>
              {isWarehouse ? <Warehouse className="h-5 w-5" /> : <Store className="h-5 w-5" />}
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
          {loc.warehouses && loc.warehouses.length > 0 && (
            <p className="text-[11px] text-slate-500 -mt-1.5 mb-2.5">
              {loc.warehouses.map((w) => `${w.name} ${w.units.toLocaleString("en-IN")}`).join(" · ")}
            </p>
          )}
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
  );
}
