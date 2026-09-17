"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X, LayoutDashboard, MoreHorizontal, ChevronRight, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePermissions } from "@/lib/use-permissions";
import { moduleIcon } from "@/lib/module-icons";
import { buildNavTree, showDividerBefore, type NavGroup } from "@/lib/nav-tree";

// The tree is the one every menu renderer shares (src/lib/nav-tree.ts): children sit indented
// under their parent, a ROUTELESS parent such as Stock management is a toggle only (R28), and a
// `dividerBefore` child gets a line above it (P5). Same order as the sidebar and /more.

// ─── The mobile header's own way into the app ────────────────────────────────
//
// WHY THIS EXISTS. The bottom tab bar is now per-user: an admin pins the tabs, and a user with
// nothing pinned gets NO bar at all (src/components/bottom-nav.tsx). Until this file the mobile
// header was a logo, a name and an avatar — no links anywhere — and the desktop sidebar is
// `hidden lg:flex`. So an unpinned user on a phone landed on `/` with no menu and no More
// button, including the admin who was configuring it, with no route back to /team.
//
// This drawer makes navigation independent of the bar existing. It is a safety net, not a
// second navigation system: it lists exactly the modules the store already resolved for the
// sidebar and the /more page, by the same rules.
//
// NOT A SECURITY BOUNDARY. `modules` is what the user may VIEW, resolved server-side per
// request; hiding an entry here only tidies the menu. Every route re-checks its own grant.

/** Links reachable in a group: routed roots plus every (routed) child. */
function linkCount(group: NavGroup): number {
  return group.items.reduce((n, item) => n + (item.route ? 1 : 0) + item.children.length, 0);
}

export function HeaderMenu({ className }: { className?: string }) {
  const pathname = usePathname();
  // The drawer remembers the route it was opened on and counts as open only while that is still
  // the route. Every link closes itself on click, but a hardware/gesture back also changes the
  // route — deriving it this way closes the drawer then too, without an effect that sets state.
  const [openedOn, setOpenedOn] = useState<string | null>(null);
  const open = openedOn !== null && openedOn === pathname;
  const setOpen = (next: boolean) => setOpenedOn(next ? pathname : null);
  const { modules, loading } = usePermissions();

  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Esc closes, focus moves into the drawer on open and RETURNS to the menu button on close,
  // and the page behind stops scrolling. Same contract as FilterSheet — a keyboard user who
  // closes the drawer must land back on the control they opened it with, not at the top of the
  // document. The panel itself takes focus rather than the first link, so a screen reader
  // announces the dialog before reading thirty destinations.
  useEffect(() => {
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenedOn(null);
    };
    document.addEventListener("keydown", onKey);
    panelRef.current?.focus();

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      triggerRef.current?.focus();
    };
  }, [open]);

  function isActive(href: string) {
    if (href === "/") return pathname === "/";
    return pathname === href || pathname.startsWith(href + "/");
  }

  const groups = buildNavTree(modules);

  // Explicit expander choices; with none, a routeless parent is open when the current page is
  // one of its children. Not persisted — the drawer is a rescue menu, not a workspace.
  const [expanders, setExpanders] = useState<Record<string, boolean>>({});
  const isExpanded = (key: string, children: { route: string | null }[]) =>
    expanders[key] ?? children.some((c) => !!c.route && isActive(c.route));

  const rowClass = (active: boolean) =>
    cn(
      "flex items-center gap-3 px-3 py-2.5 min-h-[44px] rounded-lg hover:bg-slate-50 transition-colors focus-ring",
      active ? "bg-slate-100 text-slate-900 font-semibold" : "text-slate-700"
    );

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open menu"
        aria-haspopup="dialog"
        aria-expanded={open}
        className={cn(
          "flex items-center justify-center h-9 w-9 rounded-lg text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer focus-ring",
          className
        )}
      >
        <Menu className="h-5 w-5" />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[60] flex justify-end"
          role="dialog"
          aria-modal="true"
          aria-label="Navigation menu"
        >
          {/* Backdrop closes too — a second way out, never the only one. */}
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />

          {/* Slides in from the right, reusing the existing `drawer-in` keyframes (they
              translate from +100%), which is why the trigger sits on the header's right edge:
              the panel arrives from the side it was tapped on. Full height with its own
              scroll — an admin holds ~32 modules, far more than one phone screen. */}
          <div
            ref={panelRef}
            tabIndex={-1}
            className="relative w-[86%] max-w-xs h-full bg-white shadow-xl flex flex-col focus:outline-none drawer-in"
          >
            <div className="flex items-center justify-between px-4 h-14 border-b border-slate-200 shrink-0 safe-top">
              <span className="text-base font-bold text-slate-900">Menu</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 cursor-pointer focus-ring"
                aria-label="Close menu"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <nav className="flex-1 overflow-y-auto px-2 py-3 pb-safe">
              {/* Home and More are fixed points: Home is the landing route every user has, and
                  More is the full menu with the profile card and Sign Out. Linking More from
                  here keeps that page reachable even for the user whose bottom bar — and so
                  whose More tab — never renders. */}
              <Link
                href="/"
                onClick={() => setOpen(false)}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 min-h-[44px] rounded-lg hover:bg-slate-50 transition-colors focus-ring",
                  isActive("/") ? "bg-slate-100 text-slate-900 font-semibold" : "text-slate-700"
                )}
              >
                <LayoutDashboard className="h-4 w-4 text-slate-500 shrink-0" />
                <span className="flex-1 text-sm">Home</span>
              </Link>

              {/* While the grants are still in flight there is nothing honest to list — an
                  empty menu would read as "you have access to nothing", which is a different
                  and more alarming statement. Say it is loading instead. */}
              {loading && groups.length === 0 && (
                <p className="px-3 py-3 text-sm text-slate-400">Loading menu...</p>
              )}

              {!loading && groups.length === 0 && (
                <p className="px-3 py-3 text-sm text-slate-400">
                  No modules are granted to your role yet.
                </p>
              )}

              {groups.map((group) => (
                <div key={group.title} className="mt-4">
                  <div className="flex items-center justify-between px-3 mb-1">
                    <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                      {group.title}
                    </span>
                    <span className="text-[11px] font-medium text-slate-400 tabular-nums">
                      {linkCount(group)}
                    </span>
                  </div>
                  {group.items.map((item) => {
                    const Icon = moduleIcon(item.icon);
                    // A routed parent keeps its children visible beneath it (one tap to any
                    // page). A routeless parent has nowhere to go, so it only toggles (R28).
                    const expander = !item.route;
                    const showChildren = !expander || isExpanded(item.key, item.children);
                    return (
                      <div key={item.key}>
                        {expander ? (
                          <button
                            type="button"
                            onClick={() =>
                              setExpanders((p) => ({ ...p, [item.key]: !showChildren }))
                            }
                            aria-expanded={showChildren}
                            className={cn(rowClass(false), "w-full text-left cursor-pointer")}
                          >
                            <Icon className="h-4 w-4 text-slate-500 shrink-0" />
                            <span className="flex-1 text-sm truncate">{item.label}</span>
                            <ChevronDown
                              className={cn(
                                "h-4 w-4 text-slate-400 shrink-0 transition-transform",
                                !showChildren && "-rotate-90"
                              )}
                            />
                          </button>
                        ) : (
                          <Link
                            href={item.route!}
                            onClick={() => setOpen(false)}
                            className={rowClass(isActive(item.route!))}
                          >
                            <Icon className="h-4 w-4 text-slate-500 shrink-0" />
                            <span className="flex-1 text-sm truncate">{item.label}</span>
                            <ChevronRight className="h-4 w-4 text-slate-300 shrink-0" />
                          </Link>
                        )}

                        {showChildren && item.children.length > 0 && (
                          <div role="group" className="ml-5 border-l border-slate-100 pl-2">
                            {item.children.map((child, i) => {
                              const ChildIcon = moduleIcon(child.icon);
                              return (
                                <div key={child.key}>
                                  {showDividerBefore(item.children, i) && (
                                    <div role="separator" className="my-1 mx-3 border-t border-slate-200" />
                                  )}
                                  <Link
                                    href={child.route!}
                                    onClick={() => setOpen(false)}
                                    className={rowClass(isActive(child.route!))}
                                  >
                                    <ChildIcon className="h-4 w-4 text-slate-500 shrink-0" />
                                    <span className="flex-1 text-sm truncate">{child.label}</span>
                                    <ChevronRight className="h-4 w-4 text-slate-300 shrink-0" />
                                  </Link>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}

              <div className="mt-4 pt-3 border-t border-slate-100">
                <Link
                  href="/more"
                  onClick={() => setOpen(false)}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5 min-h-[44px] rounded-lg hover:bg-slate-50 transition-colors focus-ring",
                    isActive("/more") ? "bg-slate-100 text-slate-900 font-semibold" : "text-slate-700"
                  )}
                >
                  <MoreHorizontal className="h-4 w-4 text-slate-500 shrink-0" />
                  <span className="flex-1 text-sm">More, settings and sign out</span>
                  <ChevronRight className="h-4 w-4 text-slate-300 shrink-0" />
                </Link>
              </div>
            </nav>
          </div>
        </div>
      )}
    </>
  );
}
