"use client";

// The phone layout of a /stock product (plan 2109-stock-list-table-and-compact-cards, R2, R3,
// R5, R6, Q3a). Three lines — name + stock; brand · category · bin + status; price · A / U + ⋮ —
// plus a fourth muted line only when a reorder or assembly level is set. Every label, colour and
// action comes from the shared contract in ./stock-row so this card and the PC table cannot drift.

import { useEffect, useId, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import Link from "next/link";
import { CheckSquare, EyeOff, MoreVertical, RefreshCw, RotateCcw, Square, Wrench } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { isPlaceholderBrand, isPlaceholderCategory } from "@/lib/import-placeholders";
import { assemblyLevelLabel } from "@/lib/assembly-level";
import { createLogger } from "@/lib/logger";
import {
  formatInr,
  hasUnits,
  stockAccent,
  stockBadge,
  stockColor,
  type StockProduct,
  type StockRowContext,
} from "./stock-row";

const log = createLogger("stock:card");

/** Stop the click reaching the card's Link (navigation) or the select-mode div (toggle). */
function swallow(e: ReactMouseEvent) {
  e.preventDefault();
  e.stopPropagation();
}

interface MenuItem {
  key: string;
  label: string;
  icon: ReactNode;
  tone: string;
  run: () => void;
}

function ActionsMenu({ product: p, ctx }: { product: StockProduct; ctx: StockRowContext }) {
  const [menuOpen, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const busy = ctx.busyId === p.id;
  // A row being saved never shows its menu — derived here rather than closed from an effect.
  const open = menuOpen && !busy;

  const items: MenuItem[] = [];
  if (ctx.mayReorder) {
    items.push({
      key: "reorder",
      label: "Reorder settings",
      icon: <RefreshCw className="h-4 w-4" />,
      tone: "text-blue-700",
      run: () => ctx.onReorder(p),
    });
  }
  if (ctx.mayAssemblyLevel) {
    items.push({
      key: "assembly",
      label: "Assembly level",
      icon: <Wrench className="h-4 w-4" />,
      tone: p.assemblyLevel ? "text-slate-700" : "text-amber-700",
      run: () => ctx.onAssemblyLevel(p),
    });
  }
  if (ctx.mayDeactivate && p.status === "ACTIVE") {
    items.push({
      key: "deactivate",
      label: "Deactivate",
      icon: <EyeOff className="h-4 w-4" />,
      tone: "text-slate-700",
      run: () => ctx.onSetStatus(p, "INACTIVE"),
    });
  }
  if (ctx.mayDeactivate && p.status === "INACTIVE") {
    items.push({
      key: "restore",
      label: "Restore",
      icon: <RotateCcw className="h-4 w-4" />,
      tone: "text-green-700",
      run: () => ctx.onSetStatus(p, "ACTIVE"),
    });
  }

  // Close on a press anywhere outside the menu, and on Escape (focus goes back to ⋮).
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // Hidden in select mode (the whole card is a checkbox target) and when nothing is permitted.
  if (ctx.selectMode || items.length === 0) return null;

  return (
    <div ref={wrapRef} className="relative shrink-0" onClick={swallow}>
      <button
        ref={buttonRef}
        type="button"
        aria-label={`Actions for ${p.name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={busy}
        onClick={(e) => {
          swallow(e);
          setOpen((v) => !v);
        }}
        className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 active:bg-slate-200 disabled:opacity-40"
      >
        <MoreVertical className="h-4 w-4" />
      </button>
      {open && (
        // Right-aligned to the ⋮ button, which sits at the card's right edge, so the panel grows
        // leftwards and stays inside a 360 px viewport. z-20 lifts it over the cards below.
        <div
          id={menuId}
          role="menu"
          aria-label={`Actions for ${p.name}`}
          className="absolute right-0 top-full z-20 mt-1 w-48 max-w-[calc(100vw-2rem)] rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
        >
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              disabled={busy}
              onClick={(e) => {
                swallow(e);
                setOpen(false);
                log.debug("card action", { action: item.key, productId: p.id });
                item.run();
              }}
              className={`flex min-h-[40px] w-full items-center gap-2 px-3 text-left text-sm hover:bg-slate-50 active:bg-slate-100 disabled:opacity-40 ${item.tone}`}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Brand / category: a tinted chip for a real value, muted italic for a placeholder (absence). */
function TaxonomyChip({ name, placeholder, tint }: { name: string; placeholder: boolean; tint: string }) {
  if (placeholder) {
    return <span className="max-w-[40%] truncate text-[11px] italic text-slate-400">{name}</span>;
  }
  return (
    <span className={`max-w-[40%] truncate rounded-full px-1.5 py-0.5 text-[11px] font-medium ${tint}`} title={name}>
      {name}
    </span>
  );
}

export function StockCard({ product: p, ctx }: { product: StockProduct; ctx: StockRowContext }) {
  const badge = stockBadge(p);
  const isSelected = ctx.selectedIds.has(p.id);
  const cost = p.costPrice ?? 0;

  const levelParts: string[] = [];
  if (p.reorderLevel > 0) {
    levelParts.push(`Reorder @ ${p.reorderLevel}${p.reorderQty > 0 ? ` · order ${p.reorderQty}` : ""}`);
  }
  if (p.assemblyLevel) levelParts.push(`Assembly ${assemblyLevelLabel(p.assemblyLevel)}`);

  const content = (
    <Card
      className={`border-l-4 ${stockAccent(p)} mb-1.5 transition-colors ${
        ctx.selectMode && isSelected ? "border-blue-400 bg-blue-50/30" : "hover:border-slate-300 active:bg-slate-50"
      }`}
    >
      <CardContent className="flex items-start gap-2.5 p-3">
        {ctx.selectMode && (
          <div className="shrink-0 pt-0.5">
            {isSelected ? (
              <CheckSquare className="h-5 w-5 text-blue-600" />
            ) : (
              <Square className="h-5 w-5 text-slate-300" />
            )}
          </div>
        )}

        <div className="min-w-0 flex-1 space-y-1">
          {/* Line 1 — name · stock. Zoho names run long; clamp to two lines, full name on hover. */}
          <div className="flex items-start justify-between gap-3">
            <p className="line-clamp-2 min-w-0 break-words text-sm font-semibold text-slate-900" title={p.name}>
              {p.name}
            </p>
            <p className={`shrink-0 text-xl font-bold leading-none tabular-nums ${stockColor(p)}`}>{p.currentStock}</p>
          </div>

          {/* Line 2 — SKU · brand · category · bin · status badge. The SKU is kept because the old
              card showed it (R5: nothing lost) and staff search by it. */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
              <span className="shrink-0 text-[11px] text-slate-400 tabular-nums">{p.sku}</span>
              {p.brand && (
                <TaxonomyChip
                  name={p.brand.name}
                  placeholder={isPlaceholderBrand(p.brand.name)}
                  tint="bg-blue-50 text-blue-700"
                />
              )}
              {p.category && (
                <TaxonomyChip
                  name={p.category.name}
                  placeholder={isPlaceholderCategory(p.category.name)}
                  tint="bg-violet-50 text-violet-700"
                />
              )}
              {p.bin && (
                <span
                  className="min-w-0 truncate text-[11px] text-slate-500 tabular-nums"
                  title={`${p.bin.code} — ${p.bin.location}`}
                >
                  · {p.bin.code}
                </span>
              )}
              {p.status === "INACTIVE" && (
                <span className="shrink-0 text-[11px] italic text-slate-400">· Inactive</span>
              )}
            </div>
            <Badge variant={badge.variant} className="shrink-0 px-2 text-[10px]">
              {badge.label}
            </Badge>
          </div>

          {/* Line 3 — price (MRP struck, cost only with cost_price.view) · A / U · ⋮. */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-0.5 tabular-nums">
              <span className="text-sm font-semibold text-slate-900">{formatInr(p.sellingPrice)}</span>
              {p.mrp > 0 && p.mrp !== p.sellingPrice && (
                <span className="text-[11px] text-slate-400 line-through">{formatInr(p.mrp)}</span>
              )}
              {ctx.showCost && cost > 0 && (
                <span className="text-[11px] text-slate-500">cost {formatInr(cost)}</span>
              )}
              {hasUnits(p) && (
                <span className="text-[11px]">
                  <span className="text-emerald-700" title="Assembled">A {p.assembledUnits}</span>
                  <span className="text-slate-300"> / </span>
                  <span className="text-amber-700" title="Unassembled">U {p.unassembledUnits}</span>
                  {p.noAssemblyUnits > 0 && (
                    <span className="text-slate-500" title="No assembly"> · NA {p.noAssemblyUnits}</span>
                  )}
                </span>
              )}
            </div>
            <ActionsMenu product={p} ctx={ctx} />
          </div>

          {/* Optional line 4 — only when a level is set (0 / null mean "not chosen"). */}
          {levelParts.length > 0 && (
            <p className="truncate text-[11px] text-slate-400 tabular-nums" title={levelParts.join(" · ")}>
              {levelParts.join(" · ")}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );

  if (ctx.selectMode) {
    return (
      <div
        role="checkbox"
        aria-checked={isSelected}
        tabIndex={0}
        onClick={() => ctx.onToggleSelect(p.id)}
        onKeyDown={(e) => {
          if (e.key === " " || e.key === "Enter") {
            e.preventDefault();
            ctx.onToggleSelect(p.id);
          }
        }}
        className="cursor-pointer"
      >
        {content}
      </div>
    );
  }

  return (
    <Link href={ctx.hrefFor(p)} className="block">
      {content}
    </Link>
  );
}
