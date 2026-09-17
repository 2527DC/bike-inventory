"use client";

import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import type { AssemblyData, FilterOptions, SortKey } from "./types";
import type { UnitFilters } from "./use-unit-list";

interface UnitFilterBarProps {
  filters: UnitFilters;
  options: FilterOptions | null;
  selectedProduct: AssemblyData["selectedProduct"];
  /** Any change; the caller clears a selection and any seeded URL params. */
  onChange: (next: UnitFilters) => void;
  showSort?: boolean;
}

const selectClass = "min-h-[44px] w-full rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-700";

/** Model search · brand · location · bin · sort (R9). Two columns on a phone, one row on desktop. */
export function UnitFilterBar({ filters, options, selectedProduct, onChange, showSort = true }: UnitFilterBarProps) {
  const set = (patch: Partial<UnitFilters>) => onChange({ ...filters, ...patch });
  const bins = (options?.bins ?? []).filter((b) => !filters.warehouseId || b.warehouseId === filters.warehouseId);

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-[minmax(0,2fr)_repeat(4,minmax(0,1fr))]">
        <div className="relative col-span-2 lg:col-span-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            placeholder="Search model, unit, frame no., SKU, bin…"
            value={filters.q}
            onChange={(e) => set({ q: e.target.value })}
            className="min-h-[44px] pl-9 pr-9 text-sm"
            aria-label="Search bicycles"
          />
          {filters.q && (
            <button
              type="button"
              onClick={() => set({ q: "" })}
              className="absolute right-1 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center text-slate-400 hover:text-slate-600"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <select aria-label="Brand" value={filters.brandId} onChange={(e) => set({ brandId: e.target.value })} className={selectClass}>
          <option value="">All brands</option>
          {options?.brands.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Location"
          value={filters.warehouseId}
          onChange={(e) => set({ warehouseId: e.target.value, binId: "" })}
          className={selectClass}
        >
          <option value="">All locations</option>
          {options?.warehouses.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
        <select aria-label="Bin" value={filters.binId} onChange={(e) => set({ binId: e.target.value })} className={selectClass}>
          <option value="">All bins</option>
          {bins.map((b) => (
            <option key={b.id} value={b.id}>
              {b.code} · {b.name}
            </option>
          ))}
        </select>
        {showSort && (
          <select aria-label="Sort" value={filters.sort} onChange={(e) => set({ sort: e.target.value as SortKey })} className={selectClass}>
            <option value="delivery">Sort: delivery day</option>
            <option value="received">Sort: received date</option>
            <option value="model">Sort: model</option>
          </select>
        )}
      </div>

      {filters.productId && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex min-h-[36px] items-center gap-1 rounded-full bg-indigo-50 py-1 pl-3 pr-1 text-xs font-semibold text-indigo-800 ring-1 ring-indigo-100">
            Model: {selectedProduct ? selectedProduct.name : "selected product"}
            <button
              type="button"
              onClick={() => set({ productId: "" })}
              aria-label="Clear model filter"
              className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-indigo-100"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </span>
        </div>
      )}
    </div>
  );
}
