"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut, LayoutDashboard } from "lucide-react";
import { signOut, useSession } from "next-auth/react";
import { cn } from "@/lib/utils";
import { usePermissions } from "@/lib/use-permissions";
import { clearPermissionCache } from "@/lib/use-permissions";
import { moduleIcon } from "@/lib/module-icons";
import { useScrollShadows } from "@/lib/use-scroll-shadows";
import type { GrantedModule } from "@/stores/permissions";

interface AppSidebarProps {
  className?: string;
}

// Desktop sidebar. Every entry comes from the `modules` table filtered by the user's `view`
// permission — there is no hardcoded per-role tab list any more. Seeding a new module makes it
// appear here for whoever holds its view grant, with no change to this file.
export function AppSidebar({ className }: AppSidebarProps) {
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

  // Group modules by their `group` column, preserving the sortOrder the API returned.
  const groups: { title: string; items: GrantedModule[] }[] = [];
  for (const m of modules) {
    if (!m.route) continue; // permission-only modules (e.g. cost_price) have no page
    const title = m.group || "Other";
    let g = groups.find((x) => x.title === title);
    if (!g) groups.push((g = { title, items: [] }));
    g.items.push(m);
  }

  function isActive(href: string) {
    if (href === "/") return pathname === "/";
    return pathname === href || pathname.startsWith(href + "/");
  }

  // Fade edges telling the user the list is cut off. Keyed on the module count so the
  // measurement re-runs once the permission fetch replaces the skeleton.
  const { ref: navRef, atTop, atBottom, onScroll } = useScrollShadows<HTMLElement>([
    modules.length,
  ]);

  // Bring the current page's entry into view on load. Without this, landing directly on a
  // deep route (/analytics, /services/*) leaves the sidebar scrolled to the top with the
  // active item off-screen, so the nav gives no clue where you are.
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
      "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
      active ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
    );

  return (
    <aside
      className={cn(
        "w-60 h-screen sticky top-0 bg-white border-r border-slate-200 flex-col shrink-0",
        className
      )}
    >
      <div className="flex items-center gap-2.5 px-5 h-16 border-b border-slate-100 shrink-0">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.jpg" alt="BCH OPS" className="h-9 w-9 rounded-lg object-cover" />
        <span className="text-base font-bold text-slate-900">BCH OPS</span>
      </div>

      {/* `min-h-0` is what lets the nav shrink below its content height instead of pushing the
          footer past the bottom of the h-screen aside; `relative` anchors the fade edges. */}
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
              <div key={i} className="h-8 rounded-lg bg-slate-100 animate-pulse" />
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
                const Icon = moduleIcon(item.icon) ?? LayoutDashboard;
                const active = isActive(item.route!);
                return (
                  <Link
                    key={item.key}
                    ref={active ? activeRef : undefined}
                    href={item.route!}
                    className={linkClass(active)}
                  >
                    <Icon className="h-4.5 w-4.5 shrink-0" />
                    {item.label}
                  </Link>
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

      <div className="border-t border-slate-200 px-4 py-3 shrink-0">
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
