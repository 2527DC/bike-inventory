"use client";

import { Lock, Plus } from "lucide-react";
import type { TransferBinOptions } from "./use-bin-options";

/**
 * The From bin and To bin of one transfer line — plan 0310, Part C (2209 Phase 1, Q14).
 *
 * Shared by `/transfers/new` and the Edit items sheet of a returned order, so both offer the same
 * choices the server accepts (`validateTransferItems` reads the same quantities and rule):
 * - From bin: only bins of the source warehouse holding the product, with how many ("L1 · 5").
 *   One such bin is chosen for you.
 * - To bin: LOCKED to the destination's home-bin rule when one matches (as inbound, plan 2109
 *   R34), otherwise any active bin of the destination.
 */

export interface LineBins {
  fromBinId: string;
  toBinId: string;
}

export interface ResolvedLineBins extends LineBins {
  /** How many the chosen from-bin holds; 0 while none is chosen. */
  fromQty: number;
  /** The to-bin is the home-bin rule's and cannot be changed. */
  locked: boolean;
}

/**
 * What a line will actually send: the person's choice where it is still valid on this route, the
 * only bin when there is one, the rule's bin when a rule matches. Derived at render, never stored
 * back — so changing the route quietly drops choices that no longer apply.
 */
export function resolveLineBins(
  productId: string,
  choice: LineBins,
  options: TransferBinOptions | null
): ResolvedLineBins {
  const fromBins = options?.fromBins[productId];
  const fromBinId =
    fromBins?.some((b) => b.id === choice.fromBinId)
      ? choice.fromBinId
      : fromBins?.length === 1
        ? fromBins[0].id
        : "";
  const rule = options?.ruleBins[productId] ?? null;
  const toBinId = rule ? rule.id : options?.toBins.some((b) => b.id === choice.toBinId) ? choice.toBinId : "";
  return {
    fromBinId,
    toBinId,
    fromQty: fromBins?.find((b) => b.id === fromBinId)?.qty ?? 0,
    locked: Boolean(rule),
  };
}

interface Props {
  productId: string;
  /** Stable per line, so two lines of the same product get distinct control ids. */
  lineKey: string;
  choice: LineBins;
  options: TransferBinOptions | null;
  loading: boolean;
  /** Both warehouses of the route are known. Until then there is nothing to list. */
  routeReady: boolean;
  sourceName?: string;
  destinationName?: string;
  disabled: boolean;
  onChange: (patch: Partial<LineBins>) => void;
  /** Add another line of this product, from a different bin (2209 Q2a: split, never spread). */
  onSplit?: () => void;
}

const selectClass =
  "w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-2.5 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none disabled:bg-slate-50 disabled:opacity-70";

export function LineBinPickers({
  productId,
  lineKey,
  choice,
  options,
  loading,
  routeReady,
  sourceName,
  destinationName,
  disabled,
  onChange,
  onSplit,
}: Props) {
  if (!routeReady) {
    return <p className="mt-2 text-[11px] text-slate-400">Choose the route above to pick the bins.</p>;
  }
  const fromBins = options?.fromBins[productId];
  if (!fromBins) {
    return <p className="mt-2 text-[11px] text-slate-400">{loading ? "Loading bins…" : "Bins could not be loaded."}</p>;
  }

  const resolved = resolveLineBins(productId, choice, options);
  const rule = options?.ruleBins[productId] ?? null;
  const toBins = options?.toBins ?? [];

  return (
    <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
      <div>
        <label htmlFor={`from-bin-${lineKey}`} className="mb-0.5 block text-xs text-slate-500">
          From bin{sourceName ? ` · ${sourceName}` : ""}
        </label>
        {fromBins.length === 0 ? (
          <p className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-2 text-xs text-red-700">
            Not in any bin of {sourceName ?? "the source"}. Count it into a bin first, or remove this line.
          </p>
        ) : (
          <select
            id={`from-bin-${lineKey}`}
            value={resolved.fromBinId}
            onChange={(e) => onChange({ fromBinId: e.target.value })}
            disabled={disabled}
            className={selectClass}
          >
            <option value="">Choose the bin it leaves from…</option>
            {fromBins.map((b) => (
              <option key={b.id} value={b.id}>
                {b.code} · {b.qty}
              </option>
            ))}
          </select>
        )}
        {onSplit && fromBins.length > 1 && (
          <button
            type="button"
            onClick={onSplit}
            disabled={disabled}
            className="mt-1 inline-flex min-h-[32px] items-center gap-1 text-[11px] font-medium text-indigo-600 hover:text-indigo-700 disabled:opacity-50"
          >
            <Plus className="h-3 w-3" /> from another bin
          </button>
        )}
      </div>

      <div>
        <label htmlFor={`to-bin-${lineKey}`} className="mb-0.5 block text-xs text-slate-500">
          To bin{destinationName ? ` · ${destinationName}` : ""}
        </label>
        {rule ? (
          <div className="flex min-h-[44px] items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-sm text-slate-700">
            <Lock className="h-3.5 w-3.5 shrink-0 text-slate-400" />
            <span className="font-mono font-semibold">{rule.code}</span>
            <span className="truncate text-[11px] text-slate-500">home-bin rule</span>
          </div>
        ) : toBins.length === 0 ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs text-amber-800">
            {destinationName ?? "The destination"} has no active bins. Add one on Bins first.
          </p>
        ) : (
          <select
            id={`to-bin-${lineKey}`}
            value={resolved.toBinId}
            onChange={(e) => onChange({ toBinId: e.target.value })}
            disabled={disabled}
            className={selectClass}
          >
            <option value="">Choose the bin it goes to…</option>
            {toBins.map((b) => (
              <option key={b.id} value={b.id}>
                {b.code} — {b.name}
                {b.nonAssemblable ? " (no assembly)" : ""}
              </option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
}
