"use client";

// The ⋮ menu at the end of a /stock row (owner, 14 Oct 2026: "three dots, on pressing it we get
// the related actions"). It replaces the row of icon-only buttons — Add stock, Reorder, Assembly
// level, Deactivate / Restore — which said nothing without a hover and took a column of their own.
//
// PORTALLED AND FIXED, deliberately. The table scrolls inside its own box (`overflow-auto`,
// stock-table.tsx), so a dropdown positioned inside the cell would be clipped by that box — the
// last rows' menus would open into nothing. The menu is drawn on document.body at the trigger's
// screen position instead, and closes when its row actually moves (a scroll) or on a resize,
// rather than drifting away from it.
//
// A React portal still bubbles React events to the ROW, and the row navigates on click — so the
// trigger and the menu both stop propagation, or choosing "Deactivate" would also open the product.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MoreVertical } from "lucide-react";
import { createLogger } from "@/lib/logger";

const log = createLogger("stock:row-menu");

export interface StockRowMenuItem {
  /** Stable key, also what the debug log records. */
  key: string;
  label: string;
  icon: React.ReactNode;
  /** Text colour of the item, e.g. "text-emerald-700". */
  tone?: string;
  onSelect: () => void;
}

const MENU_WIDTH = 208; // px — w-52
const GAP = 4;
const EDGE = 8;

export function StockRowMenu({
  productId, productName, items, disabled,
}: {
  productId: string;
  productName: string;
  items: StockRowMenuItem[];
  /** The row is being saved — the ⋮ button is disabled. Choosing an item closes the menu before
   *  its action runs, so a row only turns busy with its menu already shut. */
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  /** Where the trigger was when the menu was placed — a scroll closes only if it moved. */
  const anchorRef = useRef<{ top: number; left: number } | null>(null);

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    setPos(null);
    anchorRef.current = null;
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  // Below the trigger, right edges aligned; above it when there is no room below. Measured after
  // render so the real menu height decides the flip, then clamped inside the viewport.
  useLayoutEffect(() => {
    if (!open || !triggerRef.current || !menuRef.current) return;
    const t = triggerRef.current.getBoundingClientRect();
    anchorRef.current = { top: t.top, left: t.left };
    const h = menuRef.current.offsetHeight;
    const below = t.bottom + GAP;
    const top = below + h > window.innerHeight - EDGE ? Math.max(EDGE, t.top - GAP - h) : below;
    const left = Math.min(Math.max(EDGE, t.right - MENU_WIDTH), window.innerWidth - MENU_WIDTH - EDGE);
    setPos({ top, left });
  }, [open]);

  // Once placed, focus moves to the first item, so a keyboard user can act at once.
  useEffect(() => {
    if (!open || !pos) return;
    menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
  }, [open, pos]);

  // Outside press, Escape, Tab, a resize, or a scroll that MOVES the row (the table box included —
  // capture phase). "Moves" matters: the scroll that brings a button into view as it is tapped
  // is delivered only after the menu has opened, and closing on it shut the menu at once.
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close(true);
      } else if (e.key === "Tab") {
        close(false);
      }
    };
    const onScroll = () => {
      const a = anchorRef.current;
      const t = triggerRef.current?.getBoundingClientRect();
      if (!a || !t) return;
      if (Math.abs(t.top - a.top) > 2 || Math.abs(t.left - a.left) > 2) close(false);
    };
    const onResize = () => close(false);
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open, close]);

  function onMenuKeyDown(e: React.KeyboardEvent) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const list = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
    if (list.length === 0) return;
    const i = list.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      e.key === "Home" ? 0
      : e.key === "End" ? list.length - 1
      : e.key === "ArrowDown" ? (i + 1) % list.length
      : (i - 1 + list.length) % list.length;
    list[next]?.focus();
  }

  if (items.length === 0) return null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-label={`Actions for ${productName}`}
        title="Actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (open) {
            close(false);
            return;
          }
          log.debug("row menu opened", { productId, items: items.length });
          setOpen(true);
        }}
        className="min-h-[36px] min-w-[36px] inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40 focus-ring"
      >
        <MoreVertical className="h-4 w-4" aria-hidden />
      </button>

      {open && createPortal(
        <div
          ref={menuRef}
          role="menu"
          aria-label={`Actions for ${productName}`}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={onMenuKeyDown}
          // Hidden until measured, so it never flashes at the wrong place for one frame.
          style={{ top: pos?.top ?? 0, left: pos?.left ?? 0, width: MENU_WIDTH, visibility: pos ? "visible" : "hidden" }}
          className="fixed z-[70] rounded-xl border border-slate-200 bg-white py-1 shadow-lg"
        >
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                log.debug("row menu action", { productId, action: item.key });
                close(false);
                item.onSelect();
              }}
              className={`flex w-full items-center gap-2.5 px-3 min-h-[40px] text-left text-sm hover:bg-slate-50 focus:bg-slate-50 focus:outline-none ${item.tone ?? "text-slate-700"}`}
            >
              <span className="shrink-0" aria-hidden>{item.icon}</span>
              <span className="truncate">{item.label}</span>
            </button>
          ))}
        </div>,
        document.body
      )}
    </>
  );
}
