"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X, LayoutDashboard, MoreHorizontal, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePermissions } from "@/lib/use-permissions";
import { moduleIcon } from "@/lib/module-icons";
import type { GrantedModule } from "@/stores/permissions";

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

/** A group heading plus the granted, linkable modules under it. */
interface MenuGroup {
  title: string;
  items: GrantedModule[];
}

/**
 * Group the granted modules exactly as /more does (src/app/(dashboard)/more/page.tsx:69-78):
 * skip anything without a route, bucket by `group`, and keep the store's order — which is
 * `Module.sortOrder`, so the drawer, the sidebar and /more all list things in one order.
 *
 * Sub-modules are NOT nested here the way the desktop sidebar nests them. A child carries the
 * same `group` as its parent, so it lands in the right bucket anyway, and a flat list is the
 * point of a rescue menu: every reachable page one tap away, no disclosure to fight with.
 */
function groupModules(modules: GrantedModule[]): MenuGroup[] {
  const groups: MenuGroup[] = [];
  for (const m of modules) {
    if (!m.route) continue; // permission-only modules have no page to link to
    const title = m.group || "Other";
    let g = groups.find((x) => x.title === title);
    if (!g) groups.push((g = { title, items: [] }));
    g.items.push(m);
  }
  return groups;
}

export function HeaderMenu({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
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
      if (e.key === "Escape") setOpen(false);
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

  // Every link closes itself on click, but a hardware/gesture back also changes the route —
  // without this the drawer would stay open on top of the page the user just went back to.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  function isActive(href: string) {
    if (href === "/") return pathname === "/";
    return pathname === href || pathname.startsWith(href + "/");
  }

  const groups = groupModules(modules);

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
                      {group.items.length}
                    </span>
                  </div>
                  {group.items.map((item) => {
                    const Icon = moduleIcon(item.icon);
                    const active = isActive(item.route!);
                    return (
                      <Link
                        key={item.key}
                        href={item.route!}
                        onClick={() => setOpen(false)}
                        className={cn(
                          "flex items-center gap-3 px-3 py-2.5 min-h-[44px] rounded-lg hover:bg-slate-50 transition-colors focus-ring",
                          active ? "bg-slate-100 text-slate-900 font-semibold" : "text-slate-700"
                        )}
                      >
                        <Icon className="h-4 w-4 text-slate-500 shrink-0" />
                        <span className="flex-1 text-sm truncate">{item.label}</span>
                        <ChevronRight className="h-4 w-4 text-slate-300 shrink-0" />
                      </Link>
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
