"use client";

import { ArrowRight, Loader2, AlertTriangle, FileText, ChevronDown } from "lucide-react";
import type { TransferDocType } from "@prisma/client";
import { Card, CardContent } from "@/components/ui/card";
import type { StoreOption } from "@/hooks/use-sites";
import { DIRECTION_LABEL, DIRECTION_MODES, docTypeForLane, kindsForMode, type DirectionMode } from "@/lib/transfers/mode";

/**
 * The route of a transfer — plan 0310-bin-delete-multi-category-rules-and-transfer-directions,
 * Part D (R7, Q6, Q7) and R8–R9.
 *
 * Four directions by the kind of warehouse at each end. On screen a FLOOR warehouse is called a
 * **Hub** (owner, 3 Oct 2026, R9) — wording only; the stored kind stays FLOOR.
 *
 * Each side is ONE list of every warehouse of the kind its direction needs, across all stores,
 * grouped under its store (R8): Hub → Godown lists every hub on the left and every godown on the
 * right. The source warehouse is never offered as the destination. A side with exactly one
 * possible warehouse picks it; otherwise nothing is pre-selected.
 *
 * The document follows the two STORES, not the direction (Q7): different stores carry a tax
 * invoice, one store a delivery challan. The helpers are `src/lib/transfers/mode.ts`'s — the
 * same ones the create route checks the body with.
 */

export type { DirectionMode };
export { DIRECTION_LABEL };
export const DIRECTIONS = DIRECTION_MODES;

/** What a warehouse kind is called on the transfer screens (R9). */
export const KIND_WORD = { FLOOR: "hub", GODOWN: "godown" } as const;

export function docLabel(docType: TransferDocType): string {
  return docType === "TAX_INVOICE" ? "Tax invoice" : "Delivery challan";
}

type Kind = "FLOOR" | "GODOWN";

/** A warehouse with the store it belongs to — what each side's list shows. */
export interface RouteWarehouse {
  id: string;
  name: string;
  kind: Kind;
  storeId: string;
  storeName: string;
}

export interface RoutePicks {
  mode: DirectionMode;
  fromWarehouseId: string;
  toWarehouseId: string;
}

export interface ResolvedRoute {
  /** Every warehouse of the source kind, in store order. */
  fromOptions: RouteWarehouse[];
  /** Every warehouse of the destination kind, minus the chosen source. */
  toOptions: RouteWarehouse[];
  fromWarehouse: RouteWarehouse | null;
  toWarehouse: RouteWarehouse | null;
  /** Null until both warehouses are known. */
  docType: TransferDocType | null;
}

/** Every active warehouse with its store's name, in the order `/api/stores` returns them. */
function allWarehouses(stores: StoreOption[]): RouteWarehouse[] {
  return stores.flatMap((s) =>
    s.warehouses.map((w) => ({ id: w.id, name: w.name, kind: w.kind, storeId: s.id, storeName: s.name }))
  );
}

/**
 * Everything the screen and the submit need, derived from what was picked. A pick that no longer
 * fits (the direction changed) is ignored rather than cleared in an effect, and a side with
 * exactly one fitting warehouse resolves to it.
 */
export function resolveRoute(stores: StoreOption[], picks: RoutePicks): ResolvedRoute {
  const kinds = kindsForMode(picks.mode);
  const all = allWarehouses(stores);

  const fromOptions = all.filter((w) => w.kind === kinds.from);
  const fromWarehouse =
    fromOptions.find((w) => w.id === picks.fromWarehouseId) ?? (fromOptions.length === 1 ? fromOptions[0] : null);

  const toOptions = all.filter((w) => w.kind === kinds.to && w.id !== fromWarehouse?.id);
  const toWarehouse =
    toOptions.find((w) => w.id === picks.toWarehouseId) ?? (toOptions.length === 1 ? toOptions[0] : null);

  return {
    fromOptions,
    toOptions,
    fromWarehouse,
    toWarehouse,
    docType: fromWarehouse && toWarehouse ? docTypeForLane(fromWarehouse, toWarehouse) : null,
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
  onFromWarehouseChange: (warehouseId: string) => void;
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

/** The options of one list, grouped under each store's name. */
function groupByStore(options: RouteWarehouse[]): { storeId: string; storeName: string; items: RouteWarehouse[] }[] {
  const groups: { storeId: string; storeName: string; items: RouteWarehouse[] }[] = [];
  for (const w of options) {
    const g = groups.find((x) => x.storeId === w.storeId);
    if (g) g.items.push(w);
    else groups.push({ storeId: w.storeId, storeName: w.storeName, items: [w] });
  }
  return groups;
}

/** One side of the route: every warehouse of its kind, grouped by store. */
function Side({
  side,
  kind,
  options,
  warehouse,
  noneMessage,
  disabled,
  onChange,
}: {
  side: "from" | "to";
  kind: Kind;
  options: RouteWarehouse[];
  warehouse: RouteWarehouse | null;
  noneMessage: string;
  disabled: boolean;
  onChange: (id: string) => void;
}) {
  const word = KIND_WORD[kind];
  const id = `${side}-warehouse-select`;
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
        {side === "to" && <ArrowRight className="h-3.5 w-3.5 text-indigo-500" />}
        {side === "from" ? `From (${word})` : `To (${word})`}
      </label>

      {options.length === 0 ? (
        <p className="flex items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <span>{noneMessage}</span>
        </p>
      ) : (
        <div className="relative">
          <select
            id={id}
            value={warehouse?.id ?? ""}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
            className={selectClass}
          >
            <option value="">{`Select ${side === "from" ? "source" : "destination"} ${word}…`}</option>
            {groupByStore(options).map((g) => (
              <optgroup key={g.storeId} label={g.storeName}>
                {g.items.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name} — {w.storeName}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400">
            <ChevronDown className="h-4 w-4" />
          </div>
        </div>
      )}

      {warehouse && (
        <div
          className={`mt-2 flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${
            kind === "GODOWN"
              ? "border-purple-200 bg-purple-50 text-purple-900 dark:border-purple-800 dark:bg-purple-950/30 dark:text-purple-200"
              : "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200"
          }`}
        >
          <span className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider">{word}</span>
          <span className="truncate font-medium">
            {side === "from" ? "Departs" : "Arrives"}: {warehouse.name} · {warehouse.storeName}
          </span>
        </div>
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
  onFromWarehouseChange,
  onToWarehouseChange,
}: Props) {
  const kinds = kindsForMode(picks.mode);
  const listReady = !loading && !error && stores.length > 0;
  const fromWord = KIND_WORD[kinds.from];
  const toWord = KIND_WORD[kinds.to];

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
              kind={kinds.from}
              options={route.fromOptions}
              warehouse={route.fromWarehouse}
              noneMessage={`No store has an active ${fromWord}, so nothing can leave from one.`}
              disabled={disabled}
              onChange={onFromWarehouseChange}
            />
            <Side
              side="to"
              kind={kinds.to}
              options={route.toOptions}
              warehouse={route.toWarehouse}
              noneMessage={
                kinds.from === kinds.to
                  ? `There is no other ${toWord} to send to.`
                  : `No store has an active ${toWord}.`
              }
              disabled={disabled}
              onChange={onToWarehouseChange}
            />
          </div>
        )}

        {/* Q7: the document follows the two stores. */}
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900/50">
          <FileText className="mt-0.5 h-4 w-4 shrink-0 text-indigo-600 dark:text-indigo-400" />
          <p className="text-xs text-slate-600 dark:text-slate-300">
            {route.docType === null ? (
              <>Choose both sides to see which document travels with this transfer.</>
            ) : route.docType === "TAX_INVOICE" ? (
              <>
                <span className="font-semibold text-slate-900 dark:text-white">Tax invoice required</span> — the stock
                moves between two stores. Raise it in Zoho Books and attach the PDF below.
              </>
            ) : (
              <>
                <span className="font-semibold text-slate-900 dark:text-white">Delivery challan required</span> — the
                stock stays inside {route.fromWarehouse?.storeName}. Attach the challan, or a photo of the signed copy,
                below.
              </>
            )}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
