"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePermissions } from "@/lib/use-permissions";
import { moduleIcon } from "@/lib/module-icons";

// Mobile bottom nav. Home and More are always present; the tabs between them are the user's
// highest-priority granted modules (by the module table's sortOrder), so the nav reflects
// permissions rather than a hardcoded per-role list.
const MAX_MIDDLE_TABS = 3;

export function BottomNav() {
  const pathname = usePathname();
  const { modules, loading } = usePermissions();

  // Roots only. Sub-modules (Staff LMS > Learning, Product Learning, Rank) are reached
  // through their parent — without this filter a learner's phone tabs become
  // "Learning / Product Learning / Rank" with no Staff LMS entry at all: three siblings
  // and no parent. The module's own in-page tab bar carries its sections on mobile.
  const middle = modules
    .filter((m) => !m.parent && m.route && m.route !== "/")
    .slice(0, MAX_MIDDLE_TABS);

  const tabs = [
    { key: "home", href: "/", label: "Home", icon: LayoutDashboard },
    ...middle.map((m) => ({
      key: m.key,
      href: m.route!,
      label: m.label,
      icon: moduleIcon(m.icon),
    })),
    { key: "more", href: "/more", label: "More", icon: MoreHorizontal },
  ];

  function isActive(href: string) {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  }

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-slate-200 safe-bottom">
      <div className="flex items-center justify-around h-16 max-w-lg mx-auto px-2">
        {loading
          ? Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-1">
                <div className="h-5 w-5 rounded bg-slate-100 animate-pulse" />
                <div className="h-2 w-8 rounded bg-slate-100 animate-pulse" />
              </div>
            ))
          : tabs.map((tab) => {
              const active = isActive(tab.href);
              const Icon = tab.icon;

              return (
                <Link
                  key={tab.key}
                  href={tab.href}
                  className={cn(
                    "flex flex-col items-center justify-center flex-1 h-full min-w-[44px] gap-0.5 transition-colors",
                    { "text-slate-900": active, "text-slate-400": !active }
                  )}
                >
                  <Icon className={cn("h-5 w-5", { "stroke-[2.5px]": active })} />
                  <span
                    className={cn("text-[10px] font-medium truncate max-w-[64px]", {
                      "font-semibold": active,
                    })}
                  >
                    {tab.label}
                  </span>
                  {active && (
                    <div className="absolute top-0 w-8 h-0.5 bg-slate-900 rounded-full" />
                  )}
                </Link>
              );
            })}
      </div>
    </nav>
  );
}
