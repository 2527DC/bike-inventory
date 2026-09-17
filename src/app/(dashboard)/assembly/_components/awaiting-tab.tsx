"use client";

import { useEffect, useState } from "react";
import { ArrowLeftRight, Loader2, MapPin, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";
import { AssignModal } from "./assign-modal";
import { LevelChip, StarChip } from "./chips";
import { UnitFilterBar } from "./unit-filter-bar";
import { useUnitList, type UnitFilters } from "./use-unit-list";
import { deliveryDayLabel, type AssemblyData, type Mechanic, type PendingUnit } from "./types";

const log = createLogger("assembly:awaiting");

/** The server's per-request ceiling for one Assign (R9). */
const MAX_ASSIGN = 500;

interface AwaitingTabProps {
  mechanics: Mechanic[];
  /** From `?productId=` / `?warehouseId=` — the condition page links here with them. */
  initialProductId: string;
  initialWarehouseId: string;
  /** The user changed a filter — the page drops the seeded params from the address. */
  onFiltersChanged: () => void;
  onAssigned: (message: string) => void;
}

/**
 * Awaiting Assignment (R8, R9, R20). Every unassembled, assemblable unit with no open task —
 * ★ units first, filtered and sorted on the server, 100 a page, with multi-select and a
 * "Select all N matching" that reaches units not yet loaded.
 */
export function AwaitingTab({ mechanics, initialProductId, initialWarehouseId, onFiltersChanged, onAssigned }: AwaitingTabProps) {
  const list = useUnitList("pending", { productId: initialProductId, warehouseId: initialWarehouseId });
  const { filters, units, total, starredTotal, loading, error } = list;

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectingAll, setSelectingAll] = useState(false);
  const [selectNotice, setSelectNotice] = useState("");
  const [assignIds, setAssignIds] = useState<string[] | null>(null);
  const [swapUnit, setSwapUnit] = useState<PendingUnit | null>(null);

  function changeFilters(next: UnitFilters) {
    list.setFilters(next);
    setSelected(new Set());
    setSelectNotice("");
    onFiltersChanged();
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < MAX_ASSIGN) next.add(id);
      return next;
    });
  }

  const allLoadedSelected = units.length > 0 && units.every((u) => selected.has(u.id));

  function toggleLoaded() {
    setSelected((prev) => {
      if (allLoadedSelected) return new Set([...prev].filter((id) => !units.some((u) => u.id === id)));
      const next = new Set(prev);
      for (const u of units) if (next.size < MAX_ASSIGN) next.add(u.id);
      return next;
    });
  }

  async function selectAllMatching() {
    setSelectingAll(true);
    setSelectNotice("");
    const data = await list.fetchAllIds();
    setSelectingAll(false);
    if (!data) return;
    const ids = data.pendingIds.slice(0, MAX_ASSIGN);
    setSelected(new Set(ids));
    if (data.pendingIds.length > MAX_ASSIGN || data.truncated) {
      setSelectNotice(`Selected the first ${MAX_ASSIGN} — one Assign takes at most ${MAX_ASSIGN}. Narrow the filter for the rest.`);
    }
    log.debug("selected all matching", { count: ids.length });
  }

  const selectedLoaded = units.filter((u) => selected.has(u.id));

  return (
    <div role="tabpanel" className="space-y-3 pb-20">
      <div>
        <h2 className="text-sm font-bold text-slate-900">Unassembled Inventory Awaiting Assignment</h2>
        <p className="text-[11px] text-slate-500">
          Received or put-away bicycles ready to be assigned to workshop mechanics. ★ bicycles are held for a priority delivery.
        </p>
      </div>

      <UnitFilterBar filters={filters} options={list.options} selectedProduct={list.selectedProduct} onChange={changeFilters} />

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
        <span>
          {loading && units.length === 0 ? (
            <span className="inline-flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" /> Loading…
            </span>
          ) : (
            <>
              {total} bicycle{total === 1 ? "" : "s"}
              {starredTotal > 0 ? ` · ${starredTotal} ★` : ""}
              {units.length < total ? ` · showing ${units.length}` : ""}
            </>
          )}
        </span>
        {units.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-lg px-2 font-semibold text-slate-700 hover:bg-slate-100">
              <input type="checkbox" checked={allLoadedSelected} onChange={toggleLoaded} className="h-5 w-5 accent-indigo-600" />
              Select shown
            </label>
            {total > units.length && (
              <Button
                variant="outline"
                size="sm"
                disabled={selectingAll}
                onClick={selectAllMatching}
                className="min-h-[44px] gap-1 text-xs"
              >
                {selectingAll && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Select all {total} matching
              </Button>
            )}
          </div>
        )}
      </div>

      {selectNotice && <div className="rounded-lg bg-amber-50 p-2.5 text-xs text-amber-800 ring-1 ring-amber-200">{selectNotice}</div>}
      {error && (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-700">
          <span>{error}</span>
          <Button size="sm" variant="outline" onClick={list.reload} className="min-h-[36px] text-xs">
            Retry
          </Button>
        </div>
      )}

      {loading && units.length === 0 ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-xl bg-slate-100" />
          ))}
        </div>
      ) : units.length === 0 && !error ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-white p-6 text-center text-xs text-slate-400">
          {filters.q || filters.productId || filters.brandId || filters.warehouseId || filters.binId
            ? "No bicycle matches these filters."
            : "No bicycles awaiting assignment. All inventory is either assigned or completed."}
        </div>
      ) : (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
          {units.map((unit) => (
            <li key={unit.id} className={`flex items-start gap-2 p-3 ${unit.reservedFor ? "bg-amber-50/50" : ""}`}>
              <label className="-m-1 flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center">
                <input
                  type="checkbox"
                  checked={selected.has(unit.id)}
                  onChange={() => toggle(unit.id)}
                  aria-label={`Select ${unit.unitCode}`}
                  className="h-5 w-5 accent-indigo-600"
                />
              </label>
              <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 space-y-0.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-bold text-indigo-600">{unit.unitCode}</span>
                    <StarChip reservedFor={unit.reservedFor} />
                    <LevelChip level={unit.product.assemblyLevel} />
                  </div>
                  <p className="truncate text-sm font-semibold text-slate-900">{unit.product.name}</p>
                  <p className="text-[11px] text-slate-500">
                    <span className="font-mono">{unit.product.sku}</span> · {unit.product.brand.name}
                  </p>
                  <p className="flex flex-wrap items-center gap-x-2 text-[11px] text-slate-500">
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="h-3 w-3 text-slate-400" />
                      {unit.warehouse.name}
                      {unit.bin ? ` · Bin ${unit.bin.code}` : " · no bin"}
                    </span>
                    {unit.frameNumber && <span className="font-mono">Frame #{unit.frameNumber}</span>}
                  </p>
                  {unit.reservedFor && (
                    <p className="text-[11px] font-semibold text-amber-800">
                      For {unit.reservedFor.invoiceNo} · delivery {deliveryDayLabel(unit.reservedFor.scheduledDate)}
                    </p>
                  )}
                </div>

                <div className="flex shrink-0 gap-2 self-start sm:self-auto">
                  {unit.reservedFor && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setSwapUnit(unit)}
                      className="min-h-[44px] gap-1 border-amber-300 text-xs font-semibold text-amber-800 hover:bg-amber-50"
                    >
                      <ArrowLeftRight className="h-3.5 w-3.5" />
                      Swap
                    </Button>
                  )}
                  <Button
                    size="sm"
                    onClick={() => setAssignIds([unit.id])}
                    className="min-h-[44px] gap-1 bg-indigo-600 text-xs font-semibold text-white hover:bg-indigo-700"
                  >
                    <Plus className="h-3 w-3" />
                    Assign
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {list.hasMore && (
        <div className="flex justify-center">
          <Button variant="outline" size="sm" disabled={loading} onClick={list.loadMore} className="min-h-[44px] gap-1.5 text-xs">
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Load more ({total - units.length} left)
          </Button>
        </div>
      )}

      {/* Bulk bar — sits above the mobile bottom nav. */}
      {selected.size > 0 && (
        <div className="fixed inset-x-0 bottom-20 z-40 px-4 lg:bottom-4">
          <div className="mx-auto flex max-w-xl items-center justify-between gap-2 rounded-2xl bg-slate-900 p-2 pl-4 text-white shadow-lg">
            <span className="text-sm font-semibold">{selected.size} selected</span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setSelected(new Set());
                  setSelectNotice("");
                }}
                aria-label="Clear selection"
                className="flex h-11 w-11 items-center justify-center rounded-xl text-slate-300 hover:bg-slate-800"
              >
                <X className="h-5 w-5" />
              </button>
              <Button onClick={() => setAssignIds([...selected])} className="min-h-[44px] gap-1 bg-indigo-500 font-bold text-white hover:bg-indigo-400">
                <Plus className="h-4 w-4" />
                Assign {selected.size}
              </Button>
            </div>
          </div>
        </div>
      )}

      {assignIds && (
        <AssignModal
          unitIds={assignIds}
          units={assignIds.length === 1 ? units.filter((u) => u.id === assignIds[0]) : selectedLoaded}
          mechanics={mechanics}
          onClose={() => setAssignIds(null)}
          onAssigned={(message) => {
            setAssignIds(null);
            setSelected(new Set());
            setSelectNotice("");
            list.reload();
            onAssigned(message);
          }}
        />
      )}

      {swapUnit?.reservedFor && (
        <SwapSheet
          unit={swapUnit}
          onClose={() => setSwapUnit(null)}
          onSwapped={(message) => {
            setSwapUnit(null);
            list.reload();
            onAssigned(message);
          }}
        />
      )}
    </div>
  );
}

/**
 * Swap a ★ unit for another of the same model in the same location (Q35 "a person can swap").
 * The swap itself belongs to the priority route (plan 1709 Part C); until it ships the route
 * answers 404 and this says so.
 */
function SwapSheet({ unit, onClose, onSwapped }: { unit: PendingUnit; onClose: () => void; onSwapped: (message: string) => void }) {
  const [candidates, setCandidates] = useState<PendingUnit[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [swapError, setSwapError] = useState("");
  const [swapping, setSwapping] = useState<string | null>(null);

  // Unheld units of the same model in the same location. State is set only after the await.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const p = new URLSearchParams({ only: "pending", productId: unit.product.id, warehouseId: unit.warehouse.id, reserved: "0" });
      const { data, error, status } = await apiTry<AssemblyData>(`/api/assembly/tasks?${p.toString()}`);
      if (cancelled) return;
      if (error || !data) {
        log.error("swap candidates load failed", { unitId: unit.id, status });
        setLoadError(error || "Could not load other bicycles");
        return;
      }
      setCandidates(data.pendingUnits.filter((u) => u.id !== unit.id));
    })();
    return () => {
      cancelled = true;
    };
  }, [unit.id, unit.product.id, unit.warehouse.id]);

  async function swapTo(toUnit: PendingUnit) {
    const deliveryId = unit.reservedFor!.deliveryId;
    setSwapping(toUnit.id);
    setSwapError("");
    const { error, status } = await apiTry(`/api/deliveries/${deliveryId}/priority/swap`, {
      method: "POST",
      json: { fromUnitId: unit.id, toUnitId: toUnit.id },
    });
    setSwapping(null);
    if (error) {
      // A missing route answers with an HTML 404 — the swap has not shipped yet (Part C).
      const notShipped = status === 404 && error.startsWith("Unexpected 404");
      log.error("swap failed", { deliveryId, fromUnitId: unit.id, toUnitId: toUnit.id, status, notShipped });
      setSwapError(notShipped ? "Swapping is not available yet — it arrives with the priority delivery update." : error);
      return;
    }
    log.info("priority unit swapped", { deliveryId, fromUnitId: unit.id, toUnitId: toUnit.id });
    onSwapped(`${toUnit.unitCode} now held for ${unit.reservedFor!.invoiceNo} instead of ${unit.unitCode}.`);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-xs sm:items-center sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="swap-title"
        className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-4 shadow-xl sm:rounded-2xl sm:p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 id="swap-title" className="text-sm font-bold text-slate-900">
            Swap <span className="font-mono text-indigo-600">{unit.unitCode}</span>
          </h3>
          <button type="button" onClick={onClose} aria-label="Close" className="-mr-2 flex h-11 w-11 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100">
            <X className="h-5 w-5" />
          </button>
        </div>
        <p className="mt-0.5 text-xs text-slate-500">
          Hold another {unit.product.name} in {unit.warehouse.name} for {unit.reservedFor?.invoiceNo} instead.
        </p>

        {swapError && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-700">{swapError}</div>}

        <div className="mt-3">
          {loadError ? (
            <p className="text-xs text-red-600">{loadError}</p>
          ) : candidates === null ? (
            <div className="space-y-2">
              {[1, 2].map((i) => (
                <div key={i} className="h-12 animate-pulse rounded-xl bg-slate-100" />
              ))}
            </div>
          ) : candidates.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-200 p-4 text-center text-xs text-slate-400">
              No other unheld {unit.product.name} awaiting assembly here.
            </p>
          ) : (
            <ul className="space-y-2">
              {candidates.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    disabled={swapping !== null}
                    onClick={() => swapTo(c)}
                    className="flex min-h-[52px] w-full items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 text-left text-xs hover:border-indigo-300 hover:bg-indigo-50 disabled:opacity-60"
                  >
                    <span>
                      <span className="font-mono font-bold text-indigo-600">{c.unitCode}</span>
                      <span className="ml-2 text-slate-500">{c.bin ? `Bin ${c.bin.code}` : "no bin"}</span>
                    </span>
                    {swapping === c.id ? <Loader2 className="h-4 w-4 animate-spin text-indigo-600" /> : <ArrowLeftRight className="h-4 w-4 text-slate-400" />}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
