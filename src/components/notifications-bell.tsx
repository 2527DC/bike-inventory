"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell } from "lucide-react";
import { cn } from "@/lib/utils";
import { useInboxStore } from "@/stores/inbox";

/**
 * The header bell (plan 2309, Part D, Q16/Q19). Always shown — unlike the Requests badge, the
 * inbox is for everyone — with a red count only when something is unread. It opens
 * /notifications.
 *
 * It only READS the shared count. Fetching is done once, by useInboxSync() in the dashboard
 * layout, so the phone header and the laptop bar (both mounted, one hidden by CSS) never fire
 * two requests.
 */
export function NotificationsBell({ className = "" }: { className?: string }) {
  const pathname = usePathname();
  const unread = useInboxStore((s) => s.unread);
  const active = pathname === "/notifications";

  return (
    <Link
      href="/notifications"
      aria-label={unread > 0 ? `Notifications — ${unread} unread` : "Notifications"}
      className={cn(
        "relative inline-flex h-9 w-9 items-center justify-center rounded-lg hover:bg-slate-100 focus-ring",
        active && "bg-slate-100",
        className
      )}
    >
      <Bell className="h-5 w-5 text-slate-600" />
      {unread > 0 && (
        <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 text-white text-[10px] font-semibold tabular-nums flex items-center justify-center">
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </Link>
  );
}
