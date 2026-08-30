"use client";

import { useEffect, useState } from "react";
import { apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";

const log = createLogger("use-sites");

export interface WarehouseOption {
  id: string;
  code: string;
  name: string;
  sortOrder: number;
  storeId: string;
  store: { id: string; code: string; name: string };
}

export interface StoreOption {
  id: string;
  code: string;
  name: string;
  warehouses: Array<{ id: string; code: string; name: string; sortOrder: number }>;
}

/**
 * The warehouse list, for every picker that used to map over STOCK_LOCATIONS.
 *
 * That constant was four hardcoded entries. Warehouses are rows now, so the set has to come
 * from the server — which also means every one of these pickers is ASYNC where it used to be
 * synchronous. `loading` exists so a screen can render a disabled select instead of an empty
 * one; an empty dropdown with no explanation reads as "no warehouses exist".
 *
 * GET /api/warehouses is requireAuth-only by design, so this works for every signed-in user
 * regardless of whether they can administer the hierarchy.
 */
export function useWarehouses() {
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error: err } = await apiTry<WarehouseOption[]>("/api/warehouses");
      if (cancelled) return;
      if (err) {
        log.error("could not load warehouses", { message: err });
        setError(err);
      } else {
        setWarehouses(data ?? []);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  return { warehouses, loading, error };
}

/** Stores with their warehouses nested. Used where the picker groups by site. */
export function useStores() {
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error: err } = await apiTry<StoreOption[]>("/api/stores");
      if (cancelled) return;
      if (err) {
        log.error("could not load stores", { message: err });
        setError(err);
      } else {
        setStores(data ?? []);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  return { stores, loading, error };
}
