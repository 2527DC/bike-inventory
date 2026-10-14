"use client";

import { useCallback, useEffect, useState } from "react";
import { apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";

const log = createLogger("stock:locations-picker");

/** What a bin, or a location's no-bin stock, holds now: distinct products and items. */
export interface HeldCount {
  products: number;
  items: number;
}

export interface StockBin extends HeldCount {
  id: string;
  code: string;
  name: string;
}

export interface StockLocation extends HeldCount {
  id: string;
  code: string;
  name: string;
  kind: "FLOOR" | "GODOWN";
  noBin: HeldCount;
  /** Bins holding stock first, then the empty ones; by code within each. */
  bins: StockBin[];
}

export interface StockLocationStore {
  id: string;
  code: string;
  name: string;
  warehouses: StockLocation[];
}

/**
 * The Location and Bin pickers on /stock (plan 1410-stock-location-and-bin, B1, B5), from
 * GET /api/stock/locations — guarded by stock.view, so every role that opens /stock can load it,
 * which the admin-only GET /api/bins could not. Loaded on mount; `reload` refreshes the counts
 * when the page is refreshed. A failure is logged and returned as `error`, so the picker can say
 * so instead of rendering an empty list that reads as "no bins exist".
 */
export function useStockLocations() {
  const [stores, setStores] = useState<StockLocationStore[]>([]);
  const [error, setError] = useState<string | null>(null);
  // A counter, so `reload` re-runs the effect. `loading` is DERIVED — "no answer yet for the
  // current request" — rather than set at the top of the effect, which is a synchronous setState
  // in an effect body (react-hooks/set-state-in-effect); purchase-orders/page.tsx does the same.
  const [requestKey, setRequestKey] = useState(0);
  const [loadedKey, setLoadedKey] = useState<number | null>(null);
  const loading = loadedKey === null;

  useEffect(() => {
    let cancelled = false;
    apiTry<{ stores: StockLocationStore[] }>("/api/stock/locations").then(({ data, error: err }) => {
      // A newer reload already replaced this request; its answer must not overwrite that one.
      if (cancelled) return;
      if (err || !data) {
        log.error("could not load locations", { message: err });
        setError(err ?? "Could not load locations");
      } else {
        setError(null);
        setStores(data.stores);
        log.debug("locations loaded", {
          stores: data.stores.length,
          locations: data.stores.reduce((n, s) => n + s.warehouses.length, 0),
        });
      }
      setLoadedKey(requestKey);
    });
    return () => {
      cancelled = true;
    };
  }, [requestKey]);

  // Keeps the current lists on screen while the new counts load, so the pickers do not flicker.
  const reload = useCallback(() => setRequestKey((k) => k + 1), []);

  return { stores, loading, error, reload };
}
