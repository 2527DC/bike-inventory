"use client";

import { useEffect, useState } from "react";
import { apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";
import type { TransferBinOptions } from "@/lib/transfers/bin-options";

const log = createLogger("transfers:bin-options");

export type { TransferBinOptions };

interface Loaded {
  key: string;
  data: TransferBinOptions | null;
  error: string | null;
}

/**
 * The bins every line of a transfer can name — plan 0310, Part C (2209 Phase 1).
 *
 * Re-fetched whenever the route or the set of products changes. Nothing is set synchronously in
 * the effect (react-hooks/set-state-in-effect): "loading" is DERIVED from the request key not
 * matching the last answer, not a flag flipped before the call.
 *
 * While a new product's options load, the previous answer stays usable for the lines it covers —
 * but only on the SAME route: bins from another warehouse are never shown under a new one.
 */
export function useTransferBinOptions(fromWarehouseId: string | null, toWarehouseId: string | null, productIds: string[]) {
  const lane = fromWarehouseId && toWarehouseId ? `${fromWarehouseId}|${toWarehouseId}` : "";
  const ids = [...new Set(productIds)].sort().join(",");
  const key = lane && ids ? `${lane}|${ids}` : "";

  const [loaded, setLoaded] = useState<Loaded>({ key: "", data: null, error: null });

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    (async () => {
      const [from, to, products] = key.split("|");
      const started = Date.now();
      const { data, error } = await apiTry<TransferBinOptions>(
        `/api/transfer-orders/bin-options?fromWarehouseId=${encodeURIComponent(from)}&toWarehouseId=${encodeURIComponent(to)}&productIds=${encodeURIComponent(products)}`
      );
      if (cancelled) return;
      if (error) log.error("bin options failed", { fromWarehouseId: from, toWarehouseId: to, message: error });
      else log.debug("bin options loaded", { products: products.split(",").length, ms: Date.now() - started });
      setLoaded({ key, data, error });
    })();
    return () => {
      cancelled = true;
    };
  }, [key]);

  const sameLane = Boolean(lane) && loaded.key.startsWith(`${lane}|`);
  return {
    options: sameLane ? loaded.data : null,
    loading: Boolean(key) && loaded.key !== key,
    error: loaded.key === key ? loaded.error : null,
  };
}
