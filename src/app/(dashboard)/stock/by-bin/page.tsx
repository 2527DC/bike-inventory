"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { ArrowLeft, Package, Loader2, ChevronDown, Barcode } from "lucide-react";
import { apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";
import { LocationCard, formatINR, type LocationCardData } from "../_components/location-card";

const log = createLogger("stock:by-bin");

/** One product in one bin holding more than the live units of it there (plan 1410, Q2). */
interface UncodedLine {
  productId: string;
  productName: string;
  sku: string;
  binId: string;
  binCode: string;
  binQty: number;
  liveUnits: number;
  withoutCodes: number;
}

interface LocationStock extends LocationCardData {
  site: "BCH" | "BCC";
  /** Units in this warehouse's bins with no unit code, and over how many product-bin lines. */
  withoutCodes: number;
  withoutCodesLines: number;
  /** The largest of those lines — the API sends at most 100 per warehouse. */
  withoutCodesTop: UncodedLine[];
}

const SITE_NAMES: Record<string, string> = {
  BCH: "Bharath Cycle Hub",
  BCC: "Bharath Cycle Centre",
};

const n = (v: number) => v.toLocaleString("en-IN");

export default function StockByLocationPage() {
  const [locations, setLocations] = useState<LocationStock[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Which warehouses' "without codes" lists are open. Closed by default: a godown imported
  // before unit codes existed can list a hundred lines.
  const [openUncoded, setOpenUncoded] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await apiTry<{ locations?: LocationStock[] }>("/api/stock/by-bin");
      if (cancelled) return;
      if (res.data) {
        const locs = res.data.locations ?? [];
        setLocations(locs);
        log.debug("stock by location loaded", {
          locations: locs.length,
          withUncoded: locs.filter((l) => (l.withoutCodes ?? 0) > 0).length,
        });
      } else {
        log.error("stock by location failed to load", { reason: res.error, status: res.status });
        setError(res.error);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  function toggleUncoded(key: string) {
    setOpenUncoded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      log.debug("without-codes list toggled", { location: key, open: next.has(key) });
      return next;
    });
  }

  const totalStock = locations.reduce((s, l) => s + l.totalStock, 0);
  const totalValue = locations.reduce((s, l) => s + l.totalValue, 0);
  const totalWithoutCodes = locations.reduce((s, l) => s + (l.withoutCodes ?? 0), 0);
  const uncodedLocations = locations.filter((l) => (l.withoutCodes ?? 0) > 0);

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
            {n(totalStock)} units | {formatINR(totalValue)}
            {totalWithoutCodes > 0 && (
              <span className="text-amber-700"> | {n(totalWithoutCodes)} without codes</span>
            )}
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
                  <div key={loc.key}>
                    <LocationCard loc={loc} href={`/stock/by-location/${loc.key}`} />
                    {(loc.withoutCodes ?? 0) > 0 && (
                      <p className="mt-1 px-1 text-[11px] text-amber-700">
                        {n(loc.withoutCodes)} without codes — listed below
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}

          {/* Stock without unit codes, per product per bin (plan 1410-stock-quick-add, Q2). A
              product with no codes keeps the typed-in bin count, so its items are on the shelf
              but cannot be scanned. A stock audit of the bin gives every one a code. */}
          {uncodedLocations.length > 0 && (
            <section aria-labelledby="uncoded-heading" className="space-y-2">
              <div>
                <h2 id="uncoded-heading" className="text-sm font-semibold text-slate-900 flex items-center gap-1.5">
                  <Barcode className="h-4 w-4 text-amber-600" aria-hidden /> Stock without unit codes
                </h2>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Counted into a bin without unit codes — typed in before codes existed, or added on
                  Stock for a product that has none yet. A stock audit of the bin gives every item a code.
                </p>
              </div>

              {uncodedLocations.map((loc) => {
                const open = openUncoded.has(loc.key);
                const listId = `uncoded-${loc.key}`;
                const top = loc.withoutCodesTop ?? [];
                return (
                  <div key={loc.key} className="rounded-xl border border-slate-200 bg-white">
                    <button
                      type="button"
                      onClick={() => toggleUncoded(loc.key)}
                      aria-expanded={open}
                      aria-controls={listId}
                      className="w-full min-h-[44px] flex items-center justify-between gap-2 px-3 py-2 text-left focus-ring rounded-xl"
                    >
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-slate-900 truncate">{loc.label}</span>
                        <span className="block text-[11px] text-slate-500">
                          {n(loc.withoutCodes)} without codes in {n(loc.withoutCodesLines)} product
                          {loc.withoutCodesLines === 1 ? "" : "s"} by bin
                        </span>
                      </span>
                      <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
                    </button>

                    {open && (
                      <div id={listId} className="border-t border-slate-100">
                        <ul className="divide-y divide-slate-100">
                          {top.map((line) => (
                            <li key={`${line.binId}:${line.productId}`}>
                              <Link
                                href={`/stock/${line.productId}`}
                                className="flex items-start justify-between gap-3 px-3 py-2.5 min-h-[44px] hover:bg-slate-50 focus-ring"
                              >
                                <span className="min-w-0">
                                  <span className="block text-sm text-slate-900 line-clamp-2 break-words" title={line.productName}>
                                    {line.productName}
                                  </span>
                                  <span className="block text-[11px] text-slate-400 tabular-nums">
                                    {line.sku} · bin {line.binCode}
                                  </span>
                                </span>
                                <span className="shrink-0 text-right tabular-nums">
                                  <span className="block text-sm font-semibold text-amber-700">
                                    {n(line.withoutCodes)} without codes
                                  </span>
                                  {line.liveUnits > 0 && (
                                    <span className="block text-[11px] text-slate-500">
                                      of {n(line.binQty)} in bin · {n(line.liveUnits)} coded
                                    </span>
                                  )}
                                </span>
                              </Link>
                            </li>
                          ))}
                        </ul>
                        {loc.withoutCodesLines > top.length && (
                          <p className="px-3 py-2 text-[11px] text-slate-500 border-t border-slate-100">
                            Showing the {n(top.length)} largest of {n(loc.withoutCodesLines)}.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </section>
          )}

          <p className="text-[11px] text-slate-400 text-center pt-1">
            Move stock between locations using Transfers. Counts set each location&apos;s true quantity.
            A floor that reads 0 has not been counted yet.
          </p>
        </div>
      )}
    </div>
  );
}
