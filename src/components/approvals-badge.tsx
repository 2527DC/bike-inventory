"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ClipboardCheck } from "lucide-react";
import { apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";

const log = createLogger("approvals:badge");

/**
 * The Requests count in the top bar (plan 1709-priority-build-and-stock-flow, P17).
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
 */
export function ApprovalsBadge({ className = "" }: { className?: string }) {
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
