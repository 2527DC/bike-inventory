"use client";

import { ArrowRight, Loader2, AlertTriangle, FileText, ChevronDown } from "lucide-react";
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

/** The chip treatment for mode tabs */
function chipClass(active: boolean): string {
  return `min-h-[44px] w-full rounded-xl px-3 py-2 text-sm font-semibold transition-all focus-ring disabled:opacity-50 shadow-sm ${
    active
      ? "bg-indigo-600 text-white shadow-indigo-200 dark:shadow-none"
      : "bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
  }`;
}

function ListState({ loading, error, empty }: { loading: boolean; error: string | null; empty: string }) {
  if (loading) {
    return (
      <p className="flex items-center gap-2 text-xs text-slate-500 min-h-[44px]">
        <Loader2 className="h-4 w-4 animate-spin text-indigo-500" /> Loading stores…
      </p>
    );
  }
  if (error) return <p className="text-xs text-red-600 min-h-[44px]">Could not load stores: {error}</p>;
  return <p className="text-xs text-slate-500 min-h-[44px]">{empty}</p>;
}

/**
 * RoutePicker: Accessible dropdown selects for source and destination.
 *
 * Left side: Dropdown select to choose the source store. Shows and resolves the shop-floor
 * warehouse tagged [FLOOR].
 *
 * Right side:
 * - Store → Store: Dropdown select to choose the destination store. Shows and resolves the
 *   destination store's shop-floor warehouse tagged [FLOOR].
 * - Store → Warehouse: Dropdown select listing warehouses, specifically highlighting and
 *   tagging warehouses having the [GROUND / GODOWN] storage tag.
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
  const toStore = destinationStores.find((s) => s.id === toStoreId) ?? null;
  const toFloor = sourceFloor(toStore);

  // Flatten all warehouses across all stores with store metadata
  const allWarehouses = stores.flatMap((s) =>
    s.warehouses.map((w) => ({
      ...w,
      storeId: s.id,
      storeName: s.name,
    }))
  );

  // Eligible destination warehouses: exclude the source store's floor (cannot transfer to itself)
  const eligibleWarehouses = allWarehouses.filter((w) => w.id !== floor?.id);
  const godownWarehouses = eligibleWarehouses.filter((w) => w.kind === "GODOWN");
  const otherWarehouses = eligibleWarehouses.filter((w) => w.kind !== "GODOWN");

  const selectedWarehouse = eligibleWarehouses.find((w) => w.id === toWarehouseId) ?? null;

  const listReady = !loading && !error && stores.length > 0;

  function handleFromChange(newStoreId: string) {
    onFromChange(newStoreId);
    // If the destination store matches the new source, clear it
    if (toStoreId === newStoreId) {
      onToStoreChange("");
    }
  }

  return (
    <Card className="mb-4 border-slate-200 dark:border-slate-800 shadow-sm">
      <CardContent className="p-3 sm:p-5">
        <p className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">Transfer Route</p>
        <div className="flex gap-2 mb-4" role="group" aria-label="Transfer mode">
          <button
            type="button"
            onClick={() => onModeChange("STORE_TO_STORE")}
            disabled={disabled}
            aria-pressed={mode === "STORE_TO_STORE"}
            className={`flex-1 ${chipClass(mode === "STORE_TO_STORE")}`}
          >
            Store → Store (Floor to Floor)
          </button>
          <button
            type="button"
            onClick={() => onModeChange("STORE_TO_WAREHOUSE")}
            disabled={disabled}
            aria-pressed={mode === "STORE_TO_WAREHOUSE"}
            className={`flex-1 ${chipClass(mode === "STORE_TO_WAREHOUSE")}`}
          >
            Store → Warehouse (Storage / Godown)
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Source: From Store */}
          <div>
            <label
              htmlFor="from-store-select"
              className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
            >
              From Store (Source Floor)
            </label>
            {!listReady ? (
              <ListState loading={loading} error={error} empty="No active stores." />
            ) : (
              <div className="relative">
                <select
                  id="from-store-select"
                  value={fromStoreId}
                  onChange={(e) => handleFromChange(e.target.value)}
                  disabled={disabled}
                  className="w-full min-h-[44px] appearance-none rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 pr-10 text-sm font-medium text-slate-900 shadow-sm transition focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                >
                  <option value="">Select source store...</option>
                  {stores.map((s) => {
                    const floorWh = s.warehouses.find((w) => w.kind === "FLOOR");
                    return (
                      <option key={s.id} value={s.id}>
                        {s.name} {floorWh ? `— ${floorWh.name} [FLOOR]` : "(No Floor Warehouse)"}
                      </option>
                    );
                  })}
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400">
                  <ChevronDown className="h-4 w-4" />
                </div>
              </div>
            )}

            {/* Visual Source Tag and Details */}
            {fromStore && floor && (
              <div className="mt-2 flex items-center gap-2 rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 dark:bg-emerald-950/30 dark:border-emerald-800 text-xs">
                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-emerald-100 text-emerald-800 border border-emerald-300 dark:bg-emerald-900 dark:text-emerald-200 dark:border-emerald-700">
                  FLOOR TAG
                </span>
                <span className="text-emerald-900 dark:text-emerald-200 font-medium truncate">
                  Departs: {floor.name} ({fromStore.name})
                </span>
              </div>
            )}
            {fromStore && !floor && (
              <p className="flex items-start gap-1.5 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-2 mt-2 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-600" />
                <span>{fromStore.name} has no shop-floor warehouse, so stock cannot leave from it.</span>
              </p>
            )}
          </div>

          {/* Destination: To Store or To Warehouse */}
          <div>
            <label
              htmlFor="to-destination-select"
              className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
            >
              <ArrowRight className="h-3.5 w-3.5 text-indigo-500" />
              {mode === "STORE_TO_STORE" ? "To Store (Destination Floor)" : "To Warehouse (Godown / Ground Storage)"}
            </label>

            {!listReady ? (
              <ListState loading={loading} error={error} empty="No active stores." />
            ) : mode === "STORE_TO_STORE" ? (
              destinationStores.length === 0 ? (
                <p className="text-xs text-slate-500 min-h-[44px] flex items-center">No other store to send to.</p>
              ) : (
                <div className="relative">
                  <select
                    id="to-destination-select"
                    value={toStoreId}
                    onChange={(e) => onToStoreChange(e.target.value)}
                    disabled={disabled}
                    className="w-full min-h-[44px] appearance-none rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 pr-10 text-sm font-medium text-slate-900 shadow-sm transition focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                  >
                    <option value="">Select destination store...</option>
                    {destinationStores.map((s) => {
                      const destFloor = s.warehouses.find((w) => w.kind === "FLOOR");
                      return (
                        <option key={s.id} value={s.id}>
                          {s.name} {destFloor ? `— ${destFloor.name} [FLOOR]` : "(No Floor Warehouse)"}
                        </option>
                      );
                    })}
                  </select>
                  <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400">
                    <ChevronDown className="h-4 w-4" />
                  </div>
                </div>
              )
            ) : (
              /* Mode: STORE_TO_WAREHOUSE */
              godownWarehouses.length === 0 && otherWarehouses.length === 0 ? (
                <p className="text-xs text-slate-500 min-h-[44px] flex items-center">No other warehouse to send to.</p>
              ) : (
                <div className="relative">
                  <select
                    id="to-destination-select"
                    value={toWarehouseId}
                    onChange={(e) => onToWarehouseChange(e.target.value)}
                    disabled={disabled}
                    className="w-full min-h-[44px] appearance-none rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 pr-10 text-sm font-medium text-slate-900 shadow-sm transition focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                  >
                    <option value="">Select destination warehouse...</option>
                    {godownWarehouses.length > 0 && (
                      <optgroup label="Ground / Godown Warehouses (Storage)">
                        {godownWarehouses.map((w) => (
                          <option key={w.id} value={w.id}>
                            {w.storeName} — {w.name} [GROUND / GODOWN]
                          </option>
                        ))}
                      </optgroup>
                    )}
                    {otherWarehouses.length > 0 && (
                      <optgroup label="Other Warehouses">
                        {otherWarehouses.map((w) => (
                          <option key={w.id} value={w.id}>
                            {w.storeName} — {w.name} [{w.kind}]
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                  <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400">
                    <ChevronDown className="h-4 w-4" />
                  </div>
                </div>
              )
            )}

            {/* Visual Destination Tag and Details */}
            {mode === "STORE_TO_STORE" && toStore && toFloor && (
              <div className="mt-2 flex items-center gap-2 rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 dark:bg-emerald-950/30 dark:border-emerald-800 text-xs">
                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-emerald-100 text-emerald-800 border border-emerald-300 dark:bg-emerald-900 dark:text-emerald-200 dark:border-emerald-700">
                  FLOOR TAG
                </span>
                <span className="text-emerald-900 dark:text-emerald-200 font-medium truncate">
                  Arrives: {toFloor.name} ({toStore.name})
                </span>
              </div>
            )}
            {mode === "STORE_TO_STORE" && toStore && !toFloor && (
              <p className="flex items-start gap-1.5 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-2 mt-2 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-600" />
                <span>{toStore.name} has no shop-floor warehouse, so stock cannot arrive at it.</span>
              </p>
            )}

            {mode === "STORE_TO_WAREHOUSE" && selectedWarehouse && (
              <div
                className={`mt-2 flex items-center gap-2 rounded-lg px-3 py-2 text-xs border ${
                  selectedWarehouse.kind === "GODOWN"
                    ? "bg-purple-50 border-purple-200 text-purple-900 dark:bg-purple-950/30 dark:border-purple-800 dark:text-purple-200"
                    : "bg-emerald-50 border-emerald-200 text-emerald-900 dark:bg-emerald-950/30 dark:border-emerald-800 dark:text-emerald-200"
                }`}
              >
                <span
                  className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${
                    selectedWarehouse.kind === "GODOWN"
                      ? "bg-purple-100 text-purple-800 border-purple-300 dark:bg-purple-900 dark:text-purple-200 dark:border-purple-700"
                      : "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-900 dark:text-emerald-200 dark:border-emerald-700"
                  }`}
                >
                  {selectedWarehouse.kind === "GODOWN" ? "GROUND / GODOWN TAG" : "FLOOR TAG"}
                </span>
                <span className="font-medium truncate">
                  Arrives: {selectedWarehouse.storeName} • {selectedWarehouse.name}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Document Requirement Banner */}
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900/50">
          <FileText className="h-4 w-4 text-indigo-600 dark:text-indigo-400 shrink-0 mt-0.5" />
          <p className="text-xs text-slate-600 dark:text-slate-300">
            <span className="font-semibold text-slate-900 dark:text-white">{docLabelForMode(mode)} required.</span>{" "}
            {mode === "STORE_TO_STORE"
              ? "Raise the tax invoice in Zoho Books and attach the PDF below."
              : "Attach the delivery challan, or a photo of the signed copy, below."}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
