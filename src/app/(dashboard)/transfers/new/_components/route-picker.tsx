"use client";

import { ArrowRight, Loader2, AlertTriangle, FileText, ChevronDown } from "lucide-react";
import type { TransferDocType } from "@prisma/client";
import { Card, CardContent } from "@/components/ui/card";
import type { StoreOption } from "@/hooks/use-sites";
import { DIRECTION_LABEL, DIRECTION_MODES, docTypeForLane, kindsForMode, type DirectionMode } from "@/lib/transfers/mode";

/**
 * The route of a transfer — plan 0310-bin-delete-multi-category-rules-and-transfer-directions,
 * Part D (R7, Q6, Q7, Q12).
 *
 * Four directions by the kind of warehouse at each end: Floor → Godown, Godown → Floor,
 * Floor → Floor, Godown → Godown. Each side picks a STORE (any store — the same one included),
 * then that store's warehouse of the kind the direction needs: chosen for you when there is one,
 * a select when there are several, and a plain message when there is none (Q12).
 *
 * The document follows the two STORES, not the direction (Q7): different stores carry a tax
 * invoice, one store a delivery challan. The helpers are `src/lib/transfers/mode.ts`'s — the
 * same ones the create route checks the body with.
 */

export type { DirectionMode };
export { DIRECTION_LABEL };
export const DIRECTIONS = DIRECTION_MODES;

const KIND_WORD = { FLOOR: "floor", GODOWN: "godown" } as const;

export function docLabel(docType: TransferDocType): string {
  return docType === "TAX_INVOICE" ? "Tax invoice" : "Delivery challan";
}

type WarehouseOption = StoreOption["warehouses"][number];

export interface RoutePicks {
  mode: DirectionMode;
  fromStoreId: string;
  fromWarehouseId: string;
  toStoreId: string;
  toWarehouseId: string;
}

export interface ResolvedRoute {
  fromStore: StoreOption | null;
  toStore: StoreOption | null;
  /** The source store's warehouses of the source kind. */
  fromOptions: WarehouseOption[];
  /** The destination store's warehouses of the destination kind, minus the source warehouse. */
  toOptions: WarehouseOption[];
  fromWarehouse: WarehouseOption | null;
  toWarehouse: WarehouseOption | null;
  /** Null until both stores are chosen. */
  docType: TransferDocType | null;
}

/**
 * Everything the screen and the submit need, derived from what was picked. A pick that no longer
 * fits (the direction changed, the store changed) is ignored rather than cleared in an effect,
 * and a side with exactly one fitting warehouse resolves to it.
 */
export function resolveRoute(stores: StoreOption[], picks: RoutePicks): ResolvedRoute {
  const kinds = kindsForMode(picks.mode);
  const fromStore = stores.find((s) => s.id === picks.fromStoreId) ?? null;
  const toStore = stores.find((s) => s.id === picks.toStoreId) ?? null;

  const fromOptions = fromStore?.warehouses.filter((w) => w.kind === kinds.from) ?? [];
  const fromWarehouse =
    fromOptions.find((w) => w.id === picks.fromWarehouseId) ?? (fromOptions.length === 1 ? fromOptions[0] : null);

  const toOptions = (toStore?.warehouses.filter((w) => w.kind === kinds.to) ?? []).filter(
    (w) => w.id !== fromWarehouse?.id
  );
  const toWarehouse =
    toOptions.find((w) => w.id === picks.toWarehouseId) ?? (toOptions.length === 1 ? toOptions[0] : null);

  return {
    fromStore,
    toStore,
    fromOptions,
    toOptions,
    fromWarehouse,
    toWarehouse,
    docType: fromStore && toStore ? docTypeForLane({ storeId: fromStore.id }, { storeId: toStore.id }) : null,
  };
}

interface Props {
  stores: StoreOption[];
  loading: boolean;
  error: string | null;
  picks: RoutePicks;
  route: ResolvedRoute;
  /** True while the order is being submitted — every control here goes inert. */
  disabled: boolean;
  onModeChange: (mode: DirectionMode) => void;
  onFromStoreChange: (storeId: string) => void;
  onFromWarehouseChange: (warehouseId: string) => void;
  onToStoreChange: (storeId: string) => void;
  onToWarehouseChange: (warehouseId: string) => void;
}

function chipClass(active: boolean): string {
  return `min-h-[44px] w-full rounded-xl px-3 py-2 text-sm font-semibold transition-all focus-ring disabled:opacity-50 shadow-sm ${
    active
      ? "bg-indigo-600 text-white shadow-indigo-200 dark:shadow-none"
      : "bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
  }`;
}

const selectClass =
  "w-full min-h-[44px] appearance-none rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 pr-10 text-sm font-medium text-slate-900 shadow-sm transition focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-white";

function ListState({ loading, error }: { loading: boolean; error: string | null }) {
  if (loading) {
    return (
      <p className="flex min-h-[44px] items-center gap-2 text-xs text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin text-indigo-500" /> Loading stores…
      </p>
    );
  }
  if (error) return <p className="min-h-[44px] text-xs text-red-600">Could not load stores: {error}</p>;
  return <p className="min-h-[44px] text-xs text-slate-500">No active stores.</p>;
}

function Select({
  id,
  value,
  onChange,
  disabled,
  children,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="relative">
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} className={selectClass}>
        {children}
      </select>
      <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400">
        <ChevronDown className="h-4 w-4" />
      </div>
    </div>
  );
}

/** One side of the route: a store, then its warehouse of the needed kind. */
function Side({
  side,
  stores,
  storeId,
  store,
  kind,
  options,
  warehouse,
  noneMessage,
  disabled,
  onStoreChange,
  onWarehouseChange,
}: {
  side: "from" | "to";
  stores: StoreOption[];
  storeId: string;
  store: StoreOption | null;
  kind: "FLOOR" | "GODOWN";
  options: WarehouseOption[];
  warehouse: WarehouseOption | null;
  noneMessage: string;
  disabled: boolean;
  onStoreChange: (id: string) => void;
  onWarehouseChange: (id: string) => void;
}) {
  const word = KIND_WORD[kind];
  return (
    <div>
      <label
        htmlFor={`${side}-store-select`}
        className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300"
      >
        {side === "to" && <ArrowRight className="h-3.5 w-3.5 text-indigo-500" />}
        {side === "from" ? `From (${word})` : `To (${word})`}
      </label>
      <Select id={`${side}-store-select`} value={storeId} onChange={onStoreChange} disabled={disabled}>
        <option value="">{side === "from" ? "Select source store…" : "Select destination store…"}</option>
        {stores.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </Select>

      {store && options.length > 1 && (
        <div className="mt-2">
          <label htmlFor={`${side}-warehouse-select`} className="sr-only">
            {side === "from" ? "Source" : "Destination"} {word}
          </label>
          <Select
            id={`${side}-warehouse-select`}
            value={warehouse?.id ?? ""}
            onChange={onWarehouseChange}
            disabled={disabled}
          >
            <option value="">Choose the {word}…</option>
            {options.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </Select>
        </div>
      )}

      {store && warehouse && (
        <div
          className={`mt-2 flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${
            kind === "GODOWN"
              ? "border-purple-200 bg-purple-50 text-purple-900 dark:border-purple-800 dark:bg-purple-950/30 dark:text-purple-200"
              : "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200"
          }`}
        >
          <span className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider">{word}</span>
          <span className="truncate font-medium">
            {side === "from" ? "Departs" : "Arrives"}: {warehouse.name} ({store.name})
          </span>
        </div>
      )}

      {store && options.length === 0 && (
        <p className="mt-2 flex items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <span>{noneMessage}</span>
        </p>
      )}
    </div>
  );
}

export function RoutePicker({
  stores,
  loading,
  error,
  picks,
  route,
  disabled,
  onModeChange,
  onFromStoreChange,
  onFromWarehouseChange,
  onToStoreChange,
  onToWarehouseChange,
}: Props) {
  const kinds = kindsForMode(picks.mode);
  const listReady = !loading && !error && stores.length > 0;
  const sameStore = route.fromStore && route.toStore && route.fromStore.id === route.toStore.id;

  return (
    <Card className="mb-4 border-slate-200 shadow-sm dark:border-slate-800">
      <CardContent className="p-3 sm:p-5">
        <p className="mb-2 text-xs font-semibold text-slate-700 dark:text-slate-300">Transfer direction</p>
        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4" role="group" aria-label="Transfer direction">
          {DIRECTIONS.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => onModeChange(m)}
              disabled={disabled}
              aria-pressed={picks.mode === m}
              className={chipClass(picks.mode === m)}
            >
              {DIRECTION_LABEL[m]}
            </button>
          ))}
        </div>

        {!listReady ? (
          <ListState loading={loading} error={error} />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Side
              side="from"
              stores={stores}
              storeId={picks.fromStoreId}
              store={route.fromStore}
              kind={kinds.from}
              options={route.fromOptions}
              warehouse={route.fromWarehouse}
              noneMessage={`${route.fromStore?.name ?? "This store"} has no ${KIND_WORD[kinds.from]}, so stock cannot leave from one.`}
              disabled={disabled}
              onStoreChange={onFromStoreChange}
              onWarehouseChange={onFromWarehouseChange}
            />
            <Side
              side="to"
              stores={stores}
              storeId={picks.toStoreId}
              store={route.toStore}
              kind={kinds.to}
              options={route.toOptions}
              warehouse={route.toWarehouse}
              noneMessage={
                sameStore && kinds.from === kinds.to
                  ? `${route.toStore?.name} has no other ${KIND_WORD[kinds.to]} to send to. Choose another store.`
                  : `${route.toStore?.name ?? "This store"} has no ${KIND_WORD[kinds.to]}.`
              }
              disabled={disabled}
              onStoreChange={onToStoreChange}
              onWarehouseChange={onToWarehouseChange}
            />
          </div>
        )}

        {/* Q7: the document follows the two stores. */}
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900/50">
          <FileText className="mt-0.5 h-4 w-4 shrink-0 text-indigo-600 dark:text-indigo-400" />
          <p className="text-xs text-slate-600 dark:text-slate-300">
            {route.docType === null ? (
              <>Choose both stores to see which document travels with this transfer.</>
            ) : route.docType === "TAX_INVOICE" ? (
              <>
                <span className="font-semibold text-slate-900 dark:text-white">Tax invoice required</span> — the stock
                moves between two stores. Raise it in Zoho Books and attach the PDF below.
              </>
            ) : (
              <>
                <span className="font-semibold text-slate-900 dark:text-white">Delivery challan required</span> — the
                stock stays inside {route.fromStore?.name}. Attach the challan, or a photo of the signed copy, below.
              </>
            )}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
