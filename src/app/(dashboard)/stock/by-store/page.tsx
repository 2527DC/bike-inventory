"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { ArrowLeft, Package, Loader2 } from "lucide-react";
import { apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";
import { LocationCard, formatINR, type LocationCardData } from "../_components/location-card";

const log = createLogger("stock:by-store");

/**
 * Stock by Store — one card per store, each the sum of that store's warehouses, with the
 * per-warehouse split printed under the units. Tapping a store opens the existing
 * /stock/by-location/<STORE_CODE> drill-in, which already resolves a store and sums it.
 * Plan 0909-stock-store-and-warehouse-scoping, Part B (R4).
 */
export default function StockByStorePage() {
  const [stores, setStores] = useState<LocationCardData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await apiTry<{ locations: LocationCardData[] }>("/api/stock/by-store");
      if (cancelled) return;
      if (res.data) {
        setStores(res.data.locations);
      } else {
        log.error("stock by store failed to load", { reason: res.error, status: res.status });
        setError(res.error);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const totalStock = stores.reduce((s, l) => s + l.totalStock, 0);
  const totalValue = stores.reduce((s, l) => s + l.totalValue, 0);

  return (
    <div>
      <div className="flex items-center gap-3 mb-3">
        <Link href="/stock" className="p-1" aria-label="Back to stock">
          <ArrowLeft className="h-5 w-5 text-slate-600" />
        </Link>
        <div className="flex-1">
          <h1 className="text-lg font-bold text-slate-900">Stock by Store</h1>
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
      ) : error ? (
        <div className="text-center py-12">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      ) : stores.length === 0 ? (
        <div className="text-center py-12">
          <Package className="h-10 w-10 text-slate-300 mx-auto mb-2" />
          <p className="text-sm text-slate-400">No stores</p>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2">
            {stores.map((store) => (
              <LocationCard key={store.key} loc={store} href={`/stock/by-location/${store.key}`} />
            ))}
          </div>
          <p className="text-[11px] text-slate-400 text-center pt-1">
            A store&apos;s number is the sum of its locations. Open By Location to see each one.
          </p>
        </div>
      )}
    </div>
  );
}
