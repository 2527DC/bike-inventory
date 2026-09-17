"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bike, ChevronRight, LogOut } from "lucide-react";
import { signOut, useSession } from "next-auth/react";
import { cn } from "@/lib/utils";
import { desktopHref } from "@/lib/nav-config";
import { usePermissions, clearPermissionCache } from "@/lib/use-permissions";
import { moduleIcon } from "@/lib/module-icons";
import { useScrollShadows } from "@/lib/use-scroll-shadows";
import { buildNavTree, showDividerBefore } from "@/lib/nav-tree";

// The /desktop shell's sidebar. Same data source and the same tree as the responsive sidebar
// (src/lib/nav-tree.ts) — a routeless parent only toggles its children, `dividerBefore` draws a
// line — but every href is prefixed for the desktop route tree.
export function Sidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const { modules, role, loading } = usePermissions();

  const userName = session?.user?.name || "User";
  const initials = userName
    .split(" ")
    .map((n: string) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const groups = buildNavTree(modules);

  function isActive(href: string) {
    const dHref = desktopHref(href);
    if (dHref === "/desktop") return pathname === "/desktop";
    return pathname.startsWith(dHref);
  }

  // Explicit open/closed choices; a section with no choice follows the route (open when one of
  // its children is the current page). Not persisted — this shell is a secondary surface.
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const isOpen = (key: string, children: { route: string | null }[]) =>
    overrides[key] ?? children.some((c) => !!c.route && isActive(c.route));

  // See src/lib/use-scroll-shadows.ts — the granted-module list runs well past the fold.
  const { ref: navRef, atTop, atBottom, onScroll } = useScrollShadows<HTMLElement>([
    modules.length,
  ]);

  const activeRef = useRef<HTMLAnchorElement | null>(null);
  // A ref, not state: this is a one-shot latch on a DOM side effect and must not re-render.
  const didScrollToActive = useRef(false);
  useEffect(() => {
    if (didScrollToActive.current || !activeRef.current) return;
    activeRef.current.scrollIntoView({ block: "nearest" });
    didScrollToActive.current = true;
  }, [modules.length]);

  const linkClass = (active: boolean) =>
    cn(
      "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
      active ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
    );

  return (
    <aside className="w-60 h-screen bg-white border-r border-slate-200 flex flex-col shrink-0">
      <div className="flex items-center gap-2.5 px-5 h-16 border-b border-slate-100">
        <div className="bg-slate-900 rounded-lg p-1.5">
          <Bike className="h-5 w-5 text-white" />
        </div>
        <span className="text-base font-bold text-slate-900">BCH OPS</span>
      </div>

      {/* min-h-0 lets the nav shrink instead of shoving the footer off the h-screen aside. */}
      <div className="relative flex-1 min-h-0">
        {!atTop && (
          <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-5 bg-gradient-to-b from-white to-transparent" />
        )}

        <nav
          ref={navRef}
          onScroll={onScroll}
          className="h-full overflow-y-auto overscroll-contain scrollbar-thin py-3 px-3"
        >
        {loading && (
          <div className="space-y-2 px-1 py-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-9 rounded-lg bg-slate-100 animate-pulse" />
            ))}
          </div>
        )}

        {!loading && groups.length === 0 && (
          <p className="px-3 py-4 text-xs text-slate-400">
            No modules assigned. Ask an admin to grant your role access.
          </p>
        )}

        {groups.map((group) => (
          <div key={group.title} className="mt-4 first:mt-0">
            <p className="px-3 mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
              {group.title}
            </p>
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const Icon = moduleIcon(item.icon);
                const hasChildren = item.children.length > 0;
                const open = hasChildren && isOpen(item.key, item.children);
                const selfActive = !!item.route && isActive(item.route);
                return (
                  <div key={item.key}>
                    {item.route ? (
                      <div className="flex items-center gap-0.5">
                        <Link
                          ref={selfActive ? activeRef : undefined}
                          href={desktopHref(item.route)}
                          className={cn(linkClass(selfActive), "flex-1 min-w-0")}
                        >
                          <Icon className="h-4.5 w-4.5 shrink-0" />
                          <span className="truncate">{item.label}</span>
                        </Link>
                        {hasChildren && (
                          <button
                            type="button"
                            onClick={() => setOverrides((p) => ({ ...p, [item.key]: !open }))}
                            aria-expanded={open}
                            aria-label={`${open ? "Collapse" : "Expand"} ${item.label}`}
                            className="shrink-0 w-7 h-9 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-900 transition-colors"
                          >
                            <ChevronRight className={cn("h-4 w-4 transition-transform", open && "rotate-90")} />
                          </button>
                        )}
                      </div>
                    ) : (
                      // Routeless parent (R28): nowhere to go, so the whole row only toggles.
                      <button
                        type="button"
                        onClick={() => setOverrides((p) => ({ ...p, [item.key]: !open }))}
                        aria-expanded={open}
                        className={cn(linkClass(false), "w-full text-left")}
                      >
                        <Icon className="h-4.5 w-4.5 shrink-0" />
                        <span className="truncate">{item.label}</span>
                        <ChevronRight
                          className={cn("ml-auto h-4 w-4 shrink-0 text-slate-400 transition-transform", open && "rotate-90")}
                        />
                      </button>
                    )}

                    {open && (
                      <div role="group" className="mt-0.5 ml-4 space-y-0.5 border-l border-slate-100 pl-2">
                        {item.children.map((child, i) => {
                          const ChildIcon = moduleIcon(child.icon);
                          const childActive = isActive(child.route!);
                          return (
                            <div key={child.key}>
                              {showDividerBefore(item.children, i) && (
                                <div role="separator" className="my-1.5 mx-2 border-t border-slate-200" />
                              )}
                              <Link
                                ref={childActive ? activeRef : undefined}
                                href={desktopHref(child.route!)}
                                className={linkClass(childActive)}
                              >
                                <ChildIcon className="h-4 w-4 shrink-0" />
                                <span className="truncate">{child.label}</span>
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
          </div>
        ))}
        </nav>

        {!atBottom && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-5 bg-gradient-to-t from-white to-transparent" />
        )}
      </div>

      <div className="border-t border-slate-200 px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-full bg-slate-200 flex items-center justify-center shrink-0">
            <span className="text-xs font-semibold text-slate-600">{initials}</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-slate-900 truncate">{userName}</p>
            <p className="text-[11px] text-slate-400 truncate">{role?.name || ""}</p>
          </div>
          <button
            onClick={() => {
              clearPermissionCache();
              signOut({ callbackUrl: "/login" });
            }}
            className="text-slate-400 hover:text-red-500 transition-colors"
            title="Sign out"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}
