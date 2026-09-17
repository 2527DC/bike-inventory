"use client";

import { Loader2, MapPin, PackageCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { UnitFilterBar } from "./unit-filter-bar";
import { useUnitList, type UnitFilters } from "./use-unit-list";

interface NoAssemblyTabProps {
  initialProductId: string;
  initialWarehouseId: string;
  onFiltersChanged: () => void;
}

/**
 * No assembly (R42) — units stamped non-assemblable because they sit (or sat) in a
 * non-assemblable bin. Read-only: they never reach the build line, so there is nothing to assign.
 */
export function NoAssemblyTab({ initialProductId, initialWarehouseId, onFiltersChanged }: NoAssemblyTabProps) {
  const list = useUnitList("no-assembly", { productId: initialProductId, warehouseId: initialWarehouseId });
  const { filters, units, total, loading, error } = list;

  function changeFilters(next: UnitFilters) {
    list.setFilters(next);
    onFiltersChanged();
  }

  return (
    <div role="tabpanel" className="space-y-3">
      <div>
        <h2 className="flex items-center gap-1.5 text-sm font-bold text-slate-900">
          <PackageCheck className="h-4 w-4 text-slate-600" />
          Items that need no assembly
        </h2>
        <p className="text-[11px] text-slate-500">
          Stored in non-assemblable bins, so they never appear on Awaiting Assignment.
        </p>
      </div>

      <UnitFilterBar
        filters={filters}
        options={list.options}
        selectedProduct={list.selectedProduct}
        onChange={changeFilters}
        showSort={false}
      />

      <p className="text-xs text-slate-500">
        {loading && units.length === 0 ? (
          <span className="inline-flex items-center gap-1">
            <Loader2 className="h-3 w-3 animate-spin" /> Loading…
          </span>
        ) : (
          <>
            {total} item{total === 1 ? "" : "s"}
            {units.length < total ? ` · showing ${units.length}` : ""}
          </>
        )}
      </p>

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
            <div key={i} className="h-14 animate-pulse rounded-xl bg-slate-100" />
          ))}
        </div>
      ) : units.length === 0 && !error ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-white p-6 text-center text-xs text-slate-400">
          {filters.q || filters.productId || filters.brandId || filters.warehouseId || filters.binId
            ? "No item matches these filters."
            : "No items are in non-assemblable bins."}
        </div>
      ) : (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
          {units.map((unit) => (
            <li key={unit.id} className="space-y-0.5 p-3">
              <span className="font-mono text-xs font-bold text-indigo-600">{unit.unitCode}</span>
              <p className="truncate text-sm font-semibold text-slate-900">{unit.product.name}</p>
              <p className="text-[11px] text-slate-500">
                <span className="font-mono">{unit.product.sku}</span> · {unit.product.brand.name}
              </p>
              <p className="inline-flex items-center gap-1 text-[11px] text-slate-500">
                <MapPin className="h-3 w-3 text-slate-400" />
                {unit.warehouse.name}
                {unit.bin ? ` · Bin ${unit.bin.code}` : " · no bin"}
              </p>
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
    </div>
  );
}
