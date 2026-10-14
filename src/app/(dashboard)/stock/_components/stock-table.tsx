"use client";

// The /stock list — plan 2109-stock-list-table-and-compact-cards, R1/R3–R6, Q1a/Q2a. Since 14 Oct
// 2026 (owner) it is the ONLY layout, at every width: the phone cards are gone, the table scrolls
// inside its own box, and the page pages through 100 rows at a time instead of "Load more".
// One row per product; labels, colours and sort keys come from `stock-row.tsx`.
// Render-only: the page owns the data, the sort state, the page number and every action.

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowDown, ArrowUp, CheckSquare, EyeOff, MapPin, PackagePlus, RefreshCw, RotateCcw, Square, Wrench,
} from "lucide-react";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { isPlaceholderBrand, isPlaceholderCategory } from "@/lib/import-placeholders";
import { assemblyLevelLabel } from "@/lib/assembly-level";
import { createLogger } from "@/lib/logger";
import {
  formatInr, hasUnits, stockAccent, stockBadge, stockColor, withoutCodes,
  type StockProduct, type StockRowContext, type StockSort, type StockSortKey,
} from "./stock-row";
import { StockRowMenu, type StockRowMenuItem } from "./stock-row-menu";

const log = createLogger("stock:table");

/**
 * The actions this person may take on this row, in the order the ⋮ menu lists them. Each grant
 * is checked here exactly as the buttons that came before checked it — the routes re-check.
 */
function rowActions(p: StockProduct, ctx: StockRowContext): StockRowMenuItem[] {
  const items: StockRowMenuItem[] = [];
  // Add stock directly, without a stock audit (plan 1410, R2). Active rows only — the route
  // refuses an inactive product.
  if (ctx.mayAddStock && p.status === "ACTIVE") {
    items.push({ key: "add-stock", label: "Add stock", tone: "text-emerald-700", icon: <PackagePlus className="h-4 w-4" />, onSelect: () => ctx.onAddStock(p) });
  }
  if (ctx.mayReorder) {
    items.push({ key: "reorder", label: "Reorder settings", tone: "text-blue-700", icon: <RefreshCw className="h-4 w-4" />, onSelect: () => ctx.onReorder(p) });
  }
  if (ctx.mayAssemblyLevel) {
    items.push({
      key: "assembly-level",
      label: p.assemblyLevel ? "Assembly level" : "Set assembly level",
      tone: p.assemblyLevel ? "text-slate-700" : "text-amber-700",
      icon: <Wrench className="h-4 w-4" />,
      onSelect: () => ctx.onAssemblyLevel(p),
    });
  }
  if (ctx.mayDeactivate && p.status === "ACTIVE") {
    items.push({ key: "deactivate", label: "Deactivate", tone: "text-slate-700", icon: <EyeOff className="h-4 w-4" />, onSelect: () => ctx.onSetStatus(p, "INACTIVE") });
  }
  if (ctx.mayDeactivate && p.status === "INACTIVE") {
    items.push({ key: "restore", label: "Restore", tone: "text-green-700", icon: <RotateCcw className="h-4 w-4" />, onSelect: () => ctx.onSetStatus(p, "ACTIVE") });
  }
  return items;
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
  const showActions =
    !ctx.selectMode && (ctx.mayAddStock || ctx.mayReorder || ctx.mayAssemblyLevel || ctx.mayDeactivate);

  function openRow(p: StockProduct) {
    if (ctx.selectMode) {
      ctx.onToggleSelect(p.id);
      return;
    }
    router.push(ctx.hrefFor(p));
  }

  // The table scrolls INSIDE its own box, both ways, at every width — the page itself never
  // scrolls sideways (14 Oct 2026: at ≥ 1280 px the box used to stop clipping, and the row
  // actions ran off the right edge of the screen). Because this box is the scroll parent, the
  // header sticks to the top of the box, which max-h keeps on screen; one page is 100 rows.
  // min-w keeps the columns readable on a phone — narrower than that, the box scrolls sideways.
  return (
    <div className="w-full max-w-full overflow-auto max-h-[70vh] overscroll-contain rounded-xl border border-slate-200 bg-white shadow-sm">
      <table className="w-full min-w-[60rem] caption-bottom text-sm">
        <TableHeader className="sticky top-0 z-10 shadow-[0_1px_0_0_rgb(226_232_240)]">
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
            const uncoded = withoutCodes(p);
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
                  {/* Stock beyond the live units has no unit code (plan 1410, Q2) — added without
                      codes, or never given any. A stock audit of the bin gives them codes. */}
                  {uncoded > 0 && (
                    <div
                      className="text-[11px] text-slate-500 tabular-nums"
                      title="These items are counted but have no unit codes yet. A stock audit of the bin gives them codes."
                    >
                      {uncoded.toLocaleString("en-IN")} without codes
                    </div>
                  )}
                </TableCell>

                {/* Hidden in select mode: the whole row is a checkbox target there. One ⋮ button
                    opens the row's actions (owner, 14 Oct 2026) — see stock-row-menu.tsx. */}
                {showActions && (
                  <TableCell className="py-2 text-right whitespace-nowrap w-12">
                    <StockRowMenu productId={p.id} productName={p.name} items={rowActions(p, ctx)} disabled={busy} />
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
