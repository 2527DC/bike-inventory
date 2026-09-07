"use client";

import { useSession } from "next-auth/react";
import { HeaderMenu } from "@/components/header-menu";

// Mobile top bar. Rendered only below `lg` (the dashboard layout wraps it in `lg:hidden`);
// on desktop the sidebar carries branding, the user and the navigation.
//
// The menu button is not decoration. The bottom tab bar is per-user now and renders nothing
// when an admin has pinned nothing, so on a phone this header is the ONLY navigation that is
// always present — see src/components/header-menu.tsx for the full reasoning.
export function Header() {
  const { data: session } = useSession();
  const userName = session?.user?.name || "User";
  const initials = userName
    .split(" ")
    .map((n: string) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <header className="sticky top-0 z-40 bg-white border-b border-slate-200 safe-top">
      <div className="flex items-center justify-between h-14 px-4 max-w-lg mx-auto">
        <div className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.jpg" alt="BCH OPS" className="h-8 w-8 rounded-lg object-cover" />
          <span className="text-base font-bold text-slate-900">
            BCH OPS
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-slate-500 hidden min-[400px]:block">
            {userName}
          </span>
          <div className="h-8 w-8 rounded-full bg-slate-200 flex items-center justify-center">
            <span className="text-xs font-semibold text-slate-600">
              {initials}
            </span>
          </div>
          <HeaderMenu />
        </div>
      </div>
    </header>
  );
}
