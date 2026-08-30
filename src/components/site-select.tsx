"use client";

import { useEffect, useState } from "react";
import { Building2 } from "lucide-react";
import { apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";

const log = createLogger("site-select");

interface WarehouseOption {
  id: string;
  code: string;
  name: string;
  sortOrder: number;
}

interface StoreOption {
  id: string;
  code: string;
  name: string;
  warehouses: WarehouseOption[];
}

interface SiteSelectProps {
  storeId: string | null;
  warehouseId: string | null;
  onChange: (next: { storeId: string | null; warehouseId: string | null }) => void;
  disabled?: boolean;
}

const SELECT_CLASS =
  "flex min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus-ring disabled:opacity-60";

/**
 * Store + Warehouse pickers, used by /team/new and /team/[id]. One component so the two
 * screens cannot drift on the rules below.
 *
 * Reads GET /api/stores, which nests each store's warehouses — one request, no second call
 * when the store changes.
 *
 * **This filtering is cosmetic.** The API re-validates the pair and rejects a warehouse that
 * belongs to a different store (src/lib/site-assignment.ts). Never treat this as the gate.
 */
export function SiteSelect({ storeId, warehouseId, onChange, disabled }: SiteSelectProps) {
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error: err } = await apiTry<StoreOption[]>("/api/stores");
      if (cancelled) return;
      if (err) {
        // Never swallowed. An empty dropdown with no explanation reads as "no warehouses
        // exist", which is the single most confusing way this can fail.
        log.error("could not load stores", { message: err });
        setError(err);
      } else {
        setStores(data ?? []);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedStore = stores.find((s) => s.id === storeId) || null;
  const warehouses = selectedStore?.warehouses ?? [];

  function handleStore(nextStoreId: string) {
    const id = nextStoreId || null;
    // Changing the store MUST clear the warehouse. Keeping it would leave a warehouse
    // belonging to the previous site, which the API rejects on save — better to drop it here
    // than to let someone submit a pair that cannot be stored.
    onChange({ storeId: id, warehouseId: null });
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Store</label>
        <select
          value={storeId ?? ""}
          onChange={(e) => handleStore(e.target.value)}
          disabled={disabled || loading || Boolean(error)}
          className={SELECT_CLASS}
        >
          <option value="">{loading ? "Loading…" : "Not assigned"}</option>
          {stores.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Warehouse</label>
        <select
          value={warehouseId ?? ""}
          onChange={(e) => onChange({ storeId, warehouseId: e.target.value || null })}
          disabled={disabled || loading || Boolean(error) || !storeId}
          className={SELECT_CLASS}
        >
          <option value="">
            {!storeId ? "Select a store first" : "Not assigned"}
          </option>
          {warehouses.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
      </div>

      <p className="sm:col-span-2 flex items-start gap-1.5 text-xs text-slate-500">
        <Building2 className="h-3.5 w-3.5 shrink-0 mt-0.5" />
        <span>
          {error ? (
            <span className="text-red-600">Could not load stores — {error}</span>
          ) : (
            // Said plainly on the screen, because "assigned to BCH" reads like a restriction
            // and is not one. See the plan's Phase 3, "Not in scope".
            <>Where this person works. This is a record, not a restriction — it does not limit
            what they can see or do.</>
          )}
        </span>
      </p>
    </div>
  );
}
