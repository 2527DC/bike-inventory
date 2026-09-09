"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { ArrowLeft, Package, Loader2 } from "lucide-react";
import { apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";
import { LocationCard, formatINR, type LocationCardData } from "../_components/location-card";

const log = createLogger("stock:by-bin");

interface LocationStock extends LocationCardData {
  site: "BCH" | "BCC";
}

const SITE_NAMES: Record<string, string> = {
  BCH: "Bharath Cycle Hub",
  BCC: "Bharath Cycle Centre",
};

export default function StockByLocationPage() {
  const [locations, setLocations] = useState<LocationStock[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await apiTry<{ locations?: LocationStock[] }>("/api/stock/by-bin");
      if (cancelled) return;
      if (res.data) {
        setLocations(res.data.locations ?? []);
      } else {
        log.error("stock by location failed to load", { reason: res.error, status: res.status });
        setError(res.error);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
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
        <Link href="/stock" className="p-1" aria-label="Back to stock">
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
      ) : error ? (
        <div className="text-center py-12">
          <p className="text-sm text-red-600">{error}</p>
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
                  <LocationCard key={loc.key} loc={loc} href={`/stock/by-location/${loc.key}`} />
                ))}
              </div>
            </div>
          ))}
          <p className="text-[11px] text-slate-400 text-center pt-1">
            Move stock between locations using Transfers. Counts set each location&apos;s true quantity.
            A floor that reads 0 has not been counted yet.
          </p>
        </div>
      )}
    </div>
  );
}
