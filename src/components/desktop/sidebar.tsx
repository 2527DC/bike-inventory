"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bike, LogOut } from "lucide-react";
import { signOut, useSession } from "next-auth/react";
import { cn } from "@/lib/utils";
import { desktopHref } from "@/lib/nav-config";
import { usePermissions, clearPermissionCache } from "@/lib/use-permissions";
import { moduleIcon } from "@/lib/module-icons";
import type { GrantedModule } from "@/stores/permissions";

// The /desktop shell's sidebar. Same data source as the responsive sidebar — the `modules`
// table filtered by `view` — but every href is prefixed for the desktop route tree.
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

  const groups: { title: string; items: GrantedModule[] }[] = [];
  for (const m of modules) {
    if (!m.route) continue;
    const title = m.group || "Other";
    let g = groups.find((x) => x.title === title);
    if (!g) groups.push((g = { title, items: [] }));
    g.items.push(m);
  }

  function isActive(href: string) {
    const dHref = desktopHref(href);
    if (dHref === "/desktop") return pathname === "/desktop";
    return pathname.startsWith(dHref);
  }

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

      <nav className="flex-1 overflow-y-auto py-3 px-3">
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
                return (
                  <Link
                    key={item.key}
                    href={desktopHref(item.route!)}
                    className={linkClass(isActive(item.route!))}
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
