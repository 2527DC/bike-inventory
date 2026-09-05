"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ClipboardCheck, AlertTriangle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { apiTry } from "@/lib/api-client";
import { usePermissions } from "@/lib/use-permissions";
import { createLogger } from "@/lib/logger";

const log = createLogger("dashboard:my-stock-audits");

/**
 * "Your stock audits" on the dashboard (R2).
 *
 * ─── WHY THIS EXISTS ──────────────────────────────────────────────────────────────────────
 *
 * An audit was assigned to somebody and then went nowhere: nothing told the assignee it was
 * waiting, so it sat at PENDING until it was overdue and somebody asked in person. The
 * counter had to know to go to /stock-audit and look. This is the missing prompt.
 *
 * Two lists, deliberately separate, because they are two different jobs:
 *
 *   "Your stock audits"    PENDING + IN_PROGRESS assigned to ME — work I have to do.
 *   "Awaiting your approval"  COMPLETED, for approvers — work someone else finished.
 *
 * The first uses `?mine=1`, which forces "assigned to me" EVEN FOR APPROVERS. Without that
 * flag the API widens the query for anyone holding `stock_audit.approve`, so an owner would
 * see the whole team's audits under a heading that says "yours".
 */

interface AuditRow {
  id: string;
  countNo: string | null;
  title: string;
  status: string;
  dueDate: string;
  totalItems: number;
  countedItems: number;
  assignedTo: { name: string };
  scopeLabel: string;
}

function isOverdue(due: string, status: string) {
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  return ["PENDING", "IN_PROGRESS"].includes(status) && new Date(due) < midnight;
}

function AuditList({ rows, showAssignee }: { rows: AuditRow[]; showAssignee?: boolean }) {
  return (
    <div className="space-y-1.5">
      {rows.map((a) => {
        const overdue = isOverdue(a.dueDate, a.status);
        const progress = a.totalItems > 0 ? Math.round((a.countedItems / a.totalItems) * 100) : 0;
        return (
          <Link
            key={a.id}
            href={`/stock-audit/${a.id}`}
            className={`block rounded-lg border border-slate-200 border-l-4 ${
              overdue ? "border-l-red-500" : a.status === "IN_PROGRESS" ? "border-l-blue-400" : "border-l-amber-400"
            } bg-white p-2.5 active:bg-slate-50 focus-ring`}
          >
            <div className="flex items-center gap-1.5 flex-wrap">
              <p className="text-sm font-semibold text-slate-900 truncate flex-1 min-w-0">{a.title}</p>
              {overdue && (
                <Badge variant="danger" className="shrink-0 flex items-center gap-0.5 text-[10px] px-1.5 py-0.5">
                  <AlertTriangle className="h-2.5 w-2.5" /> Overdue
                </Badge>
              )}
            </div>
            <p className="text-[11px] text-slate-500 tabular-nums">
              {a.scopeLabel}
              {showAssignee ? ` · ${a.assignedTo.name}` : ""}
              {` · due ${new Date(a.dueDate).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`}
              {a.totalItems > 0 ? ` · ${a.countedItems}/${a.totalItems} counted (${progress}%)` : ""}
            </p>
          </Link>
        );
      })}
    </div>
  );
}

export function MyStockAudits() {
  const { canApprove } = usePermissions();
  const mayApprove = canApprove("stock_audit");

  const [mine, setMine] = useState<AuditRow[]>([]);
  const [toApprove, setToApprove] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [minePage, approvePage] = await Promise.all([
        apiTry<AuditRow[]>("/api/stock-counts?mine=1&status=PENDING,IN_PROGRESS&limit=5"),
        mayApprove
          ? apiTry<AuditRow[]>("/api/stock-counts?status=COMPLETED&limit=5")
          : Promise.resolve({ data: [] as AuditRow[], error: null, isAuth: false, isTimeout: false }),
      ]);
      if (cancelled) return;
      if (minePage.error) log.error("could not load my stock audits", { message: minePage.error });
      if (approvePage.error) log.error("could not load audits awaiting approval", { message: approvePage.error });
      setMine(minePage.data ?? []);
      setToApprove(approvePage.data ?? []);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [mayApprove]);

  // Nothing to do is the common case, and an empty card every day is noise the eye learns to
  // skip. The widget renders only when it has something to ask of you.
  if (loading || (mine.length === 0 && toApprove.length === 0)) return null;

  return (
    <div className="space-y-2 mb-3">
      {mine.length > 0 && (
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-1.5 mb-2">
              <ClipboardCheck className="h-4 w-4 text-slate-500" />
              <p className="text-sm font-semibold text-slate-900">Your stock audits</p>
              <Badge variant="info" className="text-[10px] tabular-nums">{mine.length}</Badge>
            </div>
            <AuditList rows={mine} />
          </CardContent>
        </Card>
      )}

      {toApprove.length > 0 && (
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-1.5 mb-2">
              <ClipboardCheck className="h-4 w-4 text-slate-500" />
              <p className="text-sm font-semibold text-slate-900">Awaiting your approval</p>
              <Badge variant="success" className="text-[10px] tabular-nums">{toApprove.length}</Badge>
            </div>
            {/* Someone else counted these, so their name is the useful column. */}
            <AuditList rows={toApprove} showAssignee />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
