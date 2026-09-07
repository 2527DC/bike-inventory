"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { Plus, ClipboardCheck, AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ActionConfirmation } from "@/components/ui/action-confirmation";
import { FilterSheet } from "@/components/filter-sheet";
import { usePermissions } from "@/lib/use-permissions";
import { SkeletonList } from "@/components/ui/skeleton";
import { ErrorBanner } from "@/components/ui/error-banner";
import { apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";

const log = createLogger("stock-audit");

interface StockCountItem {
  id: string;
  countNo: string | null;
  title: string;
  status: string;
  dueDate: string;
  completedAt: string | null;
  createdAt: string;
  notes: string | null;
  totalItems: number;
  countedItems: number;
  assignedTo: { name: string };
  /** Built by the API so every screen words the three scope states identically (section 5.1). */
  scopeLabel: string;
}

const STATUS_STYLE: Record<string, string> = {
  PENDING: "warning",
  IN_PROGRESS: "info",
  COMPLETED: "success",
  APPROVED: "success",
  REJECTED: "danger",
};

export default function StockAuditPage() {
  const { canCreate: canCreateCheck } = usePermissions();
  const canCreate = canCreateCheck("stock_audit");
  const [counts, setCounts] = useState<StockCountItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [filter, setFilter] = useState("ALL");
  const [confirmation, setConfirmation] = useState<{
    type: "success" | "warning" | "error" | "info";
    title: string;
    referenceId: string;
    items?: Array<{ label: string; value: string }>;
    details?: string;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Inside the async function, not in the effect body: calling setState synchronously
    // during an effect triggers a cascading render, which react-hooks/set-state-in-effect
    // flags as an error. (It was an error here before this change too.)
    (async () => {
      setLoading(true);
      setLoadError("");
      const q = filter !== "ALL" ? `?status=${filter}` : "";
      // apiTry, not raw fetch (CLAUDE.md). The old `.catch(() => {})` swallowed everything,
      // so an expired session left the page reading "No stock audits found" — which says
      // "you have none" when it means "you are signed out".
      const { data, error } = await apiTry<StockCountItem[]>(`/api/stock-counts${q}`);
      if (cancelled) return;
      if (error) {
        log.error("could not load stock audits", { message: error });
        setLoadError(error);
      } else {
        setCounts(data ?? []);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [filter]);

  // Sort: overdue first, then by created date desc
  const sortedCounts = useMemo(() => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return [...counts].sort((a, b) => {
      const aOverdue = ["PENDING", "IN_PROGRESS"].includes(a.status) && new Date(a.dueDate) < now;
      const bOverdue = ["PENDING", "IN_PROGRESS"].includes(b.status) && new Date(b.dueDate) < now;
      if (aOverdue && !bOverdue) return -1;
      if (!aOverdue && bOverdue) return 1;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }, [counts]);

  const isOverdue = (c: StockCountItem) => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return ["PENDING", "IN_PROGRESS"].includes(c.status) && new Date(c.dueDate) < now;
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-bold text-slate-900">Stock Audit</h1>
        <div className="flex gap-2">
          {canCreate && (
            <Link href="/stock-audit/brand-count"
              className="flex items-center gap-1.5 bg-blue-600 text-white px-3 py-2.5 rounded-lg text-xs font-medium">
              Brand Count
            </Link>
          )}
          {canCreate && (
            <Link href="/stock-audit/new"
              className="flex items-center gap-1.5 bg-slate-900 text-white px-3 py-2.5 rounded-lg text-xs font-medium">
              <Plus className="h-3.5 w-3.5" /> New Audit
            </Link>
          )}
        </div>
      </div>

      <FilterSheet
        className="mb-3"
        groups={[{
          label: "Status",
          value: filter,
          defaultValue: "ALL",
          options: [
            { key: "ALL", label: "All" },
            { key: "PENDING", label: "Pending" },
            { key: "IN_PROGRESS", label: "In Progress" },
            { key: "COMPLETED", label: "Completed" },
            { key: "APPROVED", label: "Approved" },
            { key: "REJECTED", label: "Rejected" },
          ],
          onChange: (key) => setFilter(key),
        }]}
      />

      {loadError && (
        <ErrorBanner
          message={loadError}
          onRetry={() => setFilter((f) => f)}
          onDismiss={() => setLoadError("")}
        />
      )}

      {loading ? (
        <SkeletonList count={6} type="card" />
      ) : loadError ? null : sortedCounts.length === 0 ? (
        <div className="text-center py-12">
          <ClipboardCheck className="h-10 w-10 text-slate-300 mx-auto mb-2" />
          <p className="text-sm text-slate-400">No stock audits found</p>
        </div>
      ) : (
        <div className="space-y-2">
          {sortedCounts.map((c) => {
            const progress = c.totalItems > 0 ? Math.round((c.countedItems / c.totalItems) * 100) : 0;
            const overdue = isOverdue(c);
            const accent = overdue || c.status === "REJECTED"
              ? "border-l-red-500"
              : c.status === "PENDING"
              ? "border-l-amber-400"
              : c.status === "IN_PROGRESS"
              ? "border-l-blue-400"
              : c.status === "COMPLETED" || c.status === "APPROVED"
              ? "border-l-green-500"
              : "border-l-slate-200";
            return (
              <Link
                key={c.id}
                href={`/stock-audit/${c.id}`}
                className={`block rounded-xl border border-slate-200 border-l-4 ${accent} bg-white shadow-sm transition-colors active:bg-slate-50 focus-ring`}
              >
                <div className="p-3">
                  <div className="flex items-start justify-between mb-1">
                    <div className="flex-1 min-w-0 mr-2">
                      <div className="flex items-center gap-1.5">
                        {c.countNo && <span className="text-xs font-mono text-slate-400 tabular-nums shrink-0">{c.countNo}</span>}
                        <p className="text-sm font-semibold text-slate-900 truncate">{c.title}</p>
                        {overdue && (
                          <Badge variant="danger" className="shrink-0 flex items-center gap-0.5 text-xs px-1.5 py-0.5">
                            <AlertTriangle className="h-2.5 w-2.5" /> Overdue
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-slate-500">
                        Assigned: {c.assignedTo.name} <span className="tabular-nums">| Due: {new Date(c.dueDate).toLocaleDateString("en-IN")}</span>
                        {/* WHERE. A list of audits that does not say which store or
                            warehouse each one covers cannot be acted on. */}
                        {c.scopeLabel && <span> | {c.scopeLabel}</span>}
                      </p>
                    </div>
                    <Badge variant={STATUS_STYLE[c.status] as "warning" | "info" | "success" | "danger"}>
                      {c.status === "IN_PROGRESS" ? "In Progress" : c.status.charAt(0) + c.status.slice(1).toLowerCase()}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2 mt-2">
                    <div className="flex-1 bg-slate-200 rounded-full h-1.5">
                      <div
                        className={`h-1.5 rounded-full transition-all ${
                          progress === 100 ? "bg-green-500" : progress > 0 ? "bg-blue-500" : "bg-slate-300"
                        }`}
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                    <span className="text-lg font-bold text-slate-700 tabular-nums shrink-0">
                      {c.countedItems}/{c.totalItems}
                    </span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      <ActionConfirmation
        open={!!confirmation}
        onClose={() => setConfirmation(null)}
        type={confirmation?.type || "success"}
        title={confirmation?.title || ""}
        referenceId={confirmation?.referenceId || ""}
        items={confirmation?.items}
        details={confirmation?.details}
      />
    </div>
  );
}
