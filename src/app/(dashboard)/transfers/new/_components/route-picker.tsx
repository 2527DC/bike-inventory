"use client";

import { ArrowRight, Loader2, AlertTriangle, FileText } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { StoreOption } from "@/hooks/use-sites";

/**
 * Chosen on the form, not derived. Store → Store carries a tax invoice; Store → Warehouse
 * carries a delivery challan. A store's tax registration is deliberately NOT consulted anywhere
 * on this screen (plan 0909-transfer-mode-and-document-attachment, Q2, owner's answer 9 Sep 2026).
 */
export type TransferMode = "STORE_TO_STORE" | "STORE_TO_WAREHOUSE";

export function docLabelForMode(mode: TransferMode): string {
  return mode === "STORE_TO_STORE" ? "Tax invoice" : "Delivery challan";
}

/**
 * The warehouse a store resolves to as a SOURCE — a browser mirror of the server's
 * `resolveStoreWarehouse`: the first `FLOOR` warehouse by sortOrder, then name. The list from
 * `/api/stores` already arrives in that order, so the first FLOOR row is the answer.
 */
export function sourceFloor(store: StoreOption | null): StoreOption["warehouses"][number] | null {
  return store?.warehouses.find((w) => w.kind === "FLOOR") ?? null;
}

interface Props {
  stores: StoreOption[];
  loading: boolean;
  error: string | null;
  mode: TransferMode;
  fromStoreId: string;
  toStoreId: string;
  toWarehouseId: string;
  /** True while the order is being submitted — every control here goes inert. */
  disabled: boolean;
  onModeChange: (mode: TransferMode) => void;
  onFromChange: (storeId: string) => void;
  onToStoreChange: (storeId: string) => void;
  onToWarehouseChange: (warehouseId: string) => void;
}

/** The chip treatment `/stock-audit/new` uses, so this looks like the rest of the app. */
function chipClass(active: boolean): string {
  return `min-h-[44px] w-full rounded-lg px-2 text-sm font-medium transition-colors focus-ring disabled:opacity-50 ${
    active ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"
  }`;
}

function ListState({ loading, error, empty }: { loading: boolean; error: string | null; empty: string }) {
  if (loading) {
    return (
      <p className="flex items-center gap-2 text-xs text-slate-500 min-h-[44px]">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading stores…
      </p>
    );
  }
  if (error) return <p className="text-xs text-red-600 min-h-[44px]">Could not load stores: {error}</p>;
  return <p className="text-xs text-slate-500 min-h-[44px]">{empty}</p>;
}

/**
 * Mode buttons plus the two panels. Stacked cards on a phone, two columns from `sm:` (Q9).
 *
 * The left panel is always stores. The right is stores in Store → Store (minus the source) and
 * EVERY active warehouse grouped under its store in Store → Warehouse (Q7) — minus the source's
 * floor, so a transfer cannot go to itself. The source store's godown stays listed: floor → godown
 * is a legitimate movement.
 */
export function RoutePicker({
  stores,
  loading,
  error,
  mode,
  fromStoreId,
  toStoreId,
  toWarehouseId,
  disabled,
  onModeChange,
  onFromChange,
  onToStoreChange,
  onToWarehouseChange,
}: Props) {
  const fromStore = stores.find((s) => s.id === fromStoreId) ?? null;
  const floor = sourceFloor(fromStore);

  const destinationStores = stores.filter((s) => s.id !== fromStoreId);
  const warehouseGroups = stores
    .map((s) => ({ store: s, warehouses: s.warehouses.filter((w) => w.id !== floor?.id) }))
    .filter((g) => g.warehouses.length > 0);

  const listReady = !loading && !error && stores.length > 0;

  return (
    <Card className="mb-4 border-purple-100">
      <CardContent className="p-3">
        <p className="text-xs font-semibold text-slate-700 mb-2">Transfer</p>
        <div className="flex gap-2 mb-3" role="group" aria-label="Transfer mode">
          <button
            type="button"
            onClick={() => onModeChange("STORE_TO_STORE")}
            disabled={disabled}
            aria-pressed={mode === "STORE_TO_STORE"}
            className={`flex-1 ${chipClass(mode === "STORE_TO_STORE")}`}
          >
            Store → Store
          </button>
          <button
            type="button"
            onClick={() => onModeChange("STORE_TO_WAREHOUSE")}
            disabled={disabled}
            aria-pressed={mode === "STORE_TO_WAREHOUSE"}
            className={`flex-1 ${chipClass(mode === "STORE_TO_WAREHOUSE")}`}
          >
            Store → Warehouse
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* Source */}
          <div>
            <p className="text-xs text-slate-500 mb-1.5">From store</p>
            {!listReady ? (
              <ListState loading={loading} error={error} empty="No active stores." />
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {stores.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => onFromChange(s.id)}
                    disabled={disabled}
                    aria-pressed={fromStoreId === s.id}
                    className={chipClass(fromStoreId === s.id)}
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            )}
            {fromStore && floor && (
              <p className="text-[11px] text-slate-500 mt-1.5">
                Stock leaves from {fromStore.name}&apos;s floor ({floor.name}).
              </p>
            )}
            {fromStore && !floor && (
              <p className="flex items-start gap-1.5 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-1 mt-1.5">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span>{fromStore.name} has no shop-floor warehouse, so stock cannot leave from it.</span>
              </p>
            )}
          </div>

          {/* Destination */}
          <div>
            <p className="flex items-center gap-1 text-xs text-slate-500 mb-1.5">
              <ArrowRight className="h-3.5 w-3.5 text-purple-500" />
              {mode === "STORE_TO_STORE" ? "To store" : "To warehouse"}
            </p>
            {!listReady ? (
              <ListState loading={loading} error={error} empty="No active stores." />
            ) : mode === "STORE_TO_STORE" ? (
              destinationStores.length === 0 ? (
                <p className="text-xs text-slate-500 min-h-[44px]">No other store to send to.</p>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {destinationStores.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => onToStoreChange(s.id)}
                      disabled={disabled}
                      aria-pressed={toStoreId === s.id}
                      className={chipClass(toStoreId === s.id)}
                    >
                      {s.name}
                    </button>
                  ))}
                </div>
              )
            ) : warehouseGroups.length === 0 ? (
              <p className="text-xs text-slate-500 min-h-[44px]">No other warehouse to send to.</p>
            ) : (
              <div className="space-y-2">
                {warehouseGroups.map((g) => (
                  <div key={g.store.id}>
                    <p className="text-[11px] font-medium text-slate-400 uppercase tracking-wide mb-1">{g.store.name}</p>
                    <div className="grid grid-cols-2 gap-2">
                      {g.warehouses.map((w) => (
                        <button
                          key={w.id}
                          type="button"
                          onClick={() => onToWarehouseChange(w.id)}
                          disabled={disabled}
                          aria-pressed={toWarehouseId === w.id}
                          className={chipClass(toWarehouseId === w.id)}
                        >
                          {w.name}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Which document the mode requires — stated up front, because a tax invoice is raised
            in Zoho Books by a person and takes a few minutes. Decided by the mode alone. */}
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2.5">
          <FileText className="h-4 w-4 text-slate-500 shrink-0 mt-0.5" />
          <p className="text-xs text-slate-600">
            <span className="font-semibold">{docLabelForMode(mode)} required.</span>{" "}
            {mode === "STORE_TO_STORE"
              ? "Raise the tax invoice in Zoho Books and attach the PDF below."
              : "Attach the delivery challan, or a photo of the signed copy, below."}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
