"use client";

// The /stock list at ≥ 1024 px — plan 2109-stock-list-table-and-compact-cards, R1/R3–R6, Q1a/Q2a.
// One row per product. Every fact and action the old card showed is here (R5); the labels,
// colours and sort keys come from `stock-row.tsx` so this table and the phone card cannot drift.
// Render-only: the page owns the data, the sort state and every action.

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowDown, ArrowUp, CheckSquare, EyeOff, MapPin, RefreshCw, RotateCcw, Square, Wrench,
} from "lucide-react";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { isPlaceholderBrand, isPlaceholderCategory } from "@/lib/import-placeholders";
import { assemblyLevelLabel } from "@/lib/assembly-level";
import { createLogger } from "@/lib/logger";
import {
  formatInr, hasUnits, stockAccent, stockBadge, stockColor,
  type StockProduct, type StockRowContext, type StockSort, type StockSortKey,
} from "./stock-row";

const log = createLogger("stock:table");

/**
 * A row action. Takes the click event so the caller can stopPropagation — the row itself
 * navigates on click, and without that a Deactivate would also open the product.
 * Exported so the phone card may share the same look.
 */
export function StockRowButton({
  label, onClick, children, tone = "text-slate-600", disabled,
}: {
  label: string;
  onClick: (e: React.MouseEvent) => void;
  children: React.ReactNode;
  tone?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`min-h-[32px] min-w-[32px] inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 focus-ring ${tone}`}
    >
      {children}
    </button>
  );
}

function SortHeader({
  label, sortKey, sort, onSort, className,
}: {
  label: string;
  sortKey: StockSortKey;
  sort: StockSort;
  onSort: (key: StockSortKey) => void;
  className?: string;
}) {
  const active = sort.sortBy === sortKey;
  const ariaSort = active ? (sort.sortOrder === "asc" ? "ascending" : "descending") : "none";
  const alignRight = className?.includes("text-right");
  return (
    <TableHead aria-sort={ariaSort} className={className}>
      <button
        type="button"
        onClick={() => {
          log.debug("sort header clicked", { sortKey, wasActive: active, sortOrder: sort.sortOrder });
          onSort(sortKey);
        }}
        className={`inline-flex items-center gap-1 uppercase tracking-wider hover:text-slate-900 focus-ring rounded ${
          active ? "text-slate-900" : ""
        } ${alignRight ? "flex-row-reverse" : ""}`}
      >
        {label}
        {active && (sort.sortOrder === "asc"
          ? <ArrowUp className="h-3 w-3" aria-hidden />
          : <ArrowDown className="h-3 w-3" aria-hidden />)}
      </button>
    </TableHead>
  );
}

export function StockTable({
  products, ctx, sort, onSort,
}: {
  products: StockProduct[];
  ctx: StockRowContext;
  sort: StockSort;
  onSort: (key: StockSortKey) => void;
}) {
  const router = useRouter();
  const showActions = !ctx.selectMode && (ctx.mayReorder || ctx.mayAssemblyLevel || ctx.mayDeactivate);

  function openRow(p: StockProduct) {
    if (ctx.selectMode) {
      ctx.onToggleSelect(p.id);
      return;
    }
    router.push(ctx.hrefFor(p));
  }

  function action(e: React.MouseEvent, run: () => void) {
    e.preventDefault();
    e.stopPropagation();
    run();
  }

  // Not the Table primitive: its `overflow-x-auto` box would always be the sticky header's scroll
  // parent, so the header would never stick against the page. The wrapper below clips only where
  // the columns cannot fit (below 1280 px).
  return (
    // Between 1024 and 1279 px the content area beside the 240 px sidebar is ~720 px, too narrow
    // for every column. There the table scrolls sideways INSIDE its own box (the page never does),
    // at the cost of the sticky header. From 1280 px the box stops clipping and the header sticks.
    <div className="w-full overflow-x-auto xl:overflow-visible rounded-xl border border-slate-200 bg-white shadow-sm">
      <table className="w-full caption-bottom text-sm">
        <TableHeader className="sticky top-0 z-10">
          <TableRow className="hover:bg-transparent">
            {ctx.selectMode && <TableHead className="w-10"><span className="sr-only">Select</span></TableHead>}
            <SortHeader label="Product" sortKey="name" sort={sort} onSort={onSort} />
            <TableHead>Brand · Category</TableHead>
            <TableHead>Bin</TableHead>
            <SortHeader label="Price" sortKey="sellingPrice" sort={sort} onSort={onSort} className="text-right" />
            {ctx.showCost && (
              <SortHeader label="Cost" sortKey="costPrice" sort={sort} onSort={onSort} className="text-right" />
            )}
            <TableHead className="text-right" title="Assembled / Unassembled units">A / U</TableHead>
            <SortHeader label="Stock" sortKey="currentStock" sort={sort} onSort={onSort} className="text-right" />
            {showActions && <TableHead className="text-right"><span className="sr-only">Actions</span></TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {products.map((p) => {
            const badge = stockBadge(p);
            const selected = ctx.selectedIds.has(p.id);
            const busy = ctx.busyId === p.id;
            const accent = `border-l-4 ${stockAccent(p)}`;
            return (
              <TableRow
                key={p.id}
                onClick={() => openRow(p)}
                aria-selected={ctx.selectMode ? selected : undefined}
                className={`cursor-pointer ${selected && ctx.selectMode ? "bg-blue-50/40 hover:bg-blue-50/60" : ""}`}
              >
                {ctx.selectMode && (
                  <TableCell className={`py-2 ${accent}`}>
                    {selected
                      ? <CheckSquare className="h-5 w-5 text-blue-600" aria-label="Selected" />
                      : <Square className="h-5 w-5 text-slate-300" aria-label="Not selected" />}
                  </TableCell>
                )}

                {/* Product: name (2 lines max, full name on hover), SKU, then reorder + assembly
                    level folded underneath (Q1a) — each only when set, as on the old card. */}
                <TableCell className={`py-2 min-w-[14rem] max-w-[22rem] ${ctx.selectMode ? "" : accent}`}>
                  {ctx.selectMode ? (
                    <p className="text-sm font-semibold text-slate-900 line-clamp-2 break-words" title={p.name}>
                      {p.name}
                    </p>
                  ) : (
                    <Link
                      href={ctx.hrefFor(p)}
                      onClick={(e) => e.stopPropagation()}
                      className="text-sm font-semibold text-slate-900 line-clamp-2 break-words hover:underline focus-ring rounded"
                      title={p.name}
                    >
                      {p.name}
                    </Link>
                  )}
                  <div className="flex items-center gap-2 flex-wrap text-[11px] text-slate-400 tabular-nums mt-0.5">
                    <span>{p.sku}</span>
                    {p.reorderLevel > 0 && (
                      <span>
                        Reorder @ {p.reorderLevel}
                        {p.reorderQty > 0 ? ` · order ${p.reorderQty}` : ""}
                      </span>
                    )}
                    {p.assemblyLevel && (
                      <span className="inline-flex items-center gap-0.5 text-slate-500">
                        <Wrench className="h-3 w-3" aria-hidden /> Assembly {assemblyLevelLabel(p.assemblyLevel)}
                      </span>
                    )}
                  </div>
                </TableCell>

                {/* A placeholder is the ABSENCE of a brand/category — muted italic, never a pill. */}
                <TableCell className="py-2 max-w-[11rem]">
                  <div className="flex flex-col items-start gap-0.5">
                  {p.brand ? (
                    isPlaceholderBrand(p.brand.name) ? (
                      <span className="text-xs italic text-slate-400">{p.brand.name}</span>
                    ) : (
                      <span className="inline-block max-w-full truncate rounded-full bg-blue-50 px-1.5 py-0.5 text-[11px] font-medium text-blue-700" title={p.brand.name}>
                        {p.brand.name}
                      </span>
                    )
                  ) : (
                    <span className="text-slate-300">—</span>
                  )}
                  {p.category ? (
                    isPlaceholderCategory(p.category.name) ? (
                      <span className="text-xs italic text-slate-400">{p.category.name}</span>
                    ) : (
                      <span className="inline-block max-w-full truncate rounded-full bg-violet-50 px-1.5 py-0.5 text-[11px] font-medium text-violet-700" title={p.category.name}>
                        {p.category.name}
                      </span>
                    )
                  ) : null}
                  </div>
                </TableCell>

                <TableCell className="py-2 max-w-[9rem]">
                  {p.bin ? (
                    <span className="flex items-center gap-0.5 text-xs text-slate-600" title={`${p.bin.code} — ${p.bin.location}`}>
                      <MapPin className="h-3 w-3 shrink-0 text-slate-400" aria-hidden />
                      <span className="truncate">{p.bin.code}</span>
                    </span>
                  ) : (
                    <span className="text-slate-300">—</span>
                  )}
                </TableCell>

                {/* Selling price is safe for everyone; MRP struck through only when it differs. */}
                <TableCell className="py-2 text-right tabular-nums whitespace-nowrap">
                  <div className="text-sm font-semibold text-slate-900">{formatInr(p.sellingPrice)}</div>
                  {p.mrp > 0 && p.mrp !== p.sellingPrice && (
                    <div className="text-[11px] text-slate-400 line-through">{formatInr(p.mrp)}</div>
                  )}
                </TableCell>

                {/* Cost: only for `cost_price` holders (the API omits the field for anyone else),
                    and only when > 0, so a missing cost never reads as ₹0. */}
                {ctx.showCost && (
                  <TableCell className="py-2 text-right tabular-nums whitespace-nowrap text-xs text-slate-500">
                    {(p.costPrice ?? 0) > 0 ? formatInr(p.costPrice ?? 0) : <span className="text-slate-300">—</span>}
                  </TableCell>
                )}

                {/* Assembled / Unassembled, from the live units — only when there are any, so a
                    product with no unit codes does not print "0 / 0" as if none were built. */}
                <TableCell className="py-2 text-right tabular-nums whitespace-nowrap text-xs">
                  {hasUnits(p) ? (
                    <div title={`Assembled ${p.assembledUnits} · Unassembled ${p.unassembledUnits}${p.noAssemblyUnits > 0 ? ` · No assembly ${p.noAssemblyUnits}` : ""}`}>
                      <span className="text-emerald-700">{p.assembledUnits}</span>
                      <span className="text-slate-400"> / </span>
                      <span className="text-amber-700">{p.unassembledUnits}</span>
                      {p.noAssemblyUnits > 0 && (
                        <div className="text-[11px] text-slate-500">NA {p.noAssemblyUnits}</div>
                      )}
                    </div>
                  ) : (
                    <span className="text-slate-300">—</span>
                  )}
                </TableCell>

                <TableCell className="py-2 text-right whitespace-nowrap">
                  <div className="flex items-center justify-end gap-2">
                    <span className={`text-lg font-bold tabular-nums ${stockColor(p)}`}>{p.currentStock}</span>
                    <Badge variant={badge.variant} className="text-[10px] px-2">{badge.label}</Badge>
                  </div>
                </TableCell>

                {/* Hidden in select mode: the whole row is a checkbox target there. */}
                {showActions && (
                  <TableCell className="py-2 text-right whitespace-nowrap">
                    <div className="flex gap-1 justify-end">
                      {ctx.mayReorder && (
                        <StockRowButton
                          label={`Reorder settings for ${p.name}`}
                          tone="text-blue-600"
                          disabled={busy}
                          onClick={(e) => action(e, () => ctx.onReorder(p))}
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                        </StockRowButton>
                      )}
                      {ctx.mayAssemblyLevel && (
                        <StockRowButton
                          label={`Assembly level for ${p.name}`}
                          tone={p.assemblyLevel ? "text-slate-700" : "text-amber-600"}
                          disabled={busy}
                          onClick={(e) => action(e, () => ctx.onAssemblyLevel(p))}
                        >
                          <Wrench className="h-3.5 w-3.5" />
                        </StockRowButton>
                      )}
                      {ctx.mayDeactivate && p.status === "ACTIVE" && (
                        <StockRowButton
                          label={`Deactivate ${p.name}`}
                          disabled={busy}
                          onClick={(e) => action(e, () => ctx.onSetStatus(p, "INACTIVE"))}
                        >
                          <EyeOff className="h-3.5 w-3.5" />
                        </StockRowButton>
                      )}
                      {ctx.mayDeactivate && p.status === "INACTIVE" && (
                        <StockRowButton
                          label={`Restore ${p.name}`}
                          tone="text-green-600"
                          disabled={busy}
                          onClick={(e) => action(e, () => ctx.onSetStatus(p, "ACTIVE"))}
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                        </StockRowButton>
                      )}
                    </div>
                  </TableCell>
                )}
              </TableRow>
            );
          })}
        </TableBody>
      </table>
    </div>
  );
}
