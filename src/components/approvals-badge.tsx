"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ClipboardCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";

const log = createLogger("approvals:badge");

/**
 * The Requests count (plan 1709-priority-build-and-stock-flow, P17).
 *
 * It reads the SAME endpoint the Requests page does, with `?count=1`, so the number and the list
 * can never disagree — and because that endpoint is built from the records, the badge cannot go
 * stale the way an inbox row would.
 *
 * ─── IT DOES NOT POLL ─────────────────────────────────────────────────────────────────────
 *
 * The count is read once per navigation (`pathname` is the dependency) and never on a timer.
 * This application has no background timers anywhere — CLAUDE.md, "There are no scheduled jobs"
 * — and an approvals badge is exactly the sort of thing that grows a `setInterval` "just for
 * five seconds". Push is what tells somebody a request has arrived; this is what tells them how
 * many are left, the next time they move.
 *
 * Nothing renders at zero, and nothing renders for somebody who approves nothing: the endpoint
 * counts only the sections their grants cover, so it answers 0 for them and the bar stays clean.
 * That is also why neither component below checks a permission — there is no `approvals` module
 * to check, and the count IS the permission filter.
 */
function usePendingApprovalCount(): number {
  const pathname = usePathname();
  const [count, setCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await apiTry<{ total: number }>("/api/approvals/pending?count=1");
      if (cancelled) return;
      if (error) {
        // A badge is not worth an error banner — log it and show nothing.
        log.debug("approvals count unavailable", { message: error });
        setCount(0);
        return;
      }
      setCount(data?.total ?? 0);
    })();
    return () => { cancelled = true; };
  }, [pathname]);

  return count;
}

/** The icon-and-pill form, for the mobile top bar. */
export function ApprovalsBadge({ className = "" }: { className?: string }) {
  const count = usePendingApprovalCount();

  if (count <= 0) return null;

  return (
    <Link
      href="/approvals"
      aria-label={`${count} request${count === 1 ? "" : "s"} waiting for your approval`}
      className={`relative inline-flex h-9 w-9 items-center justify-center rounded-lg hover:bg-slate-100 focus-ring ${className}`}
    >
      <ClipboardCheck className="h-5 w-5 text-slate-600" />
      <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 text-white text-[10px] font-semibold tabular-nums flex items-center justify-center">
        {count > 99 ? "99+" : count}
      </span>
    </Link>
  );
}

/**
 * The full-width row form, for the desktop sidebar (plan 1709, Part G).
 *
 * The sidebar is built entirely from the `modules` table, and `/approvals` is deliberately NOT a
 * module — R22 says the doer/approver split is expressed by `approve` on the four existing
 * modules, and inventing an `approvals` module would put a fifth grant in front of a page whose
 * whole job is to gate itself. So this row is hardcoded above the module tree and, like the
 * mobile badge, renders only when the permission-filtered count is above zero. Nobody sees a
 * Requests link that would open an empty page.
 */
export function ApprovalsNavLink({ className = "" }: { className?: string }) {
  const pathname = usePathname();
  const count = usePendingApprovalCount();

  if (count <= 0) return null;

  const active = pathname === "/approvals" || pathname.startsWith("/approvals/");

  return (
    <Link
      href="/approvals"
      aria-label={`Requests — ${count} waiting for your approval`}
      className={cn(
        "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
        active ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
        className
      )}
    >
      <ClipboardCheck className="h-4.5 w-4.5 shrink-0" />
      <span className="truncate">Requests</span>
      <span
        className={cn(
          "ml-auto min-w-[20px] h-[18px] px-1.5 rounded-full text-[10px] font-semibold tabular-nums flex items-center justify-center",
          active ? "bg-white text-slate-900" : "bg-red-600 text-white"
        )}
      >
        {count > 99 ? "99+" : count}
      </span>
    </Link>
  );
}
