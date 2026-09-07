"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { useBottomNav } from "@/lib/use-bottom-nav";
import { moduleIcon } from "@/lib/module-icons";

// Mobile bottom nav. Home and More are always present; the tabs between them are the ones an
// admin pinned for THIS user on their edit page, in the admin's order, intersected with what
// their role still grants — see src/lib/use-bottom-nav.ts for the whole rule. Nothing pinned
// means no bar at all (owner decision, 7 Sep 2026), which is why the same hook also tells the
// dashboard layout to stop reserving the bar's height.

export function BottomNav() {
  const pathname = usePathname();
  const { tabs: pinned, hasNav } = useBottomNav();

  const tabs = [
    { key: "home", href: "/", label: "Home", icon: LayoutDashboard },
    ...pinned.map((t) => ({
      key: t.key,
      href: t.href,
      label: t.label,
      icon: moduleIcon(t.icon),
    })),
    { key: "more", href: "/more", label: "More", icon: MoreHorizontal },
  ];

  // No bar when nothing is pinned — and none while the grants are still loading either
  // (`hasNav` is false in that window). This replaces the old 5-cell skeleton on purpose: a
  // skeleton flashes a bar that then vanishes, for exactly the users who turn out to have
  // none. Users who DO have tabs get one small layout shift when the store resolves, once
  // per session, which is the cheaper of the two.
  if (!hasNav) return null;

  function isActive(href: string) {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  }

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-slate-200 safe-bottom">
      <div className="flex items-center justify-around h-16 max-w-lg mx-auto px-2">
        {tabs.map((tab) => {
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
