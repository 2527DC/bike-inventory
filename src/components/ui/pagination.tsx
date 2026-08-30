import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface PaginationProps {
  page: number;
  totalPages: number;
  total: number;
  /** Rows on the current page, so the "showing X-Y of Z" line is honest on the last page. */
  count: number;
  limit: number;
  onPageChange: (page: number) => void;
  className?: string;
}

/**
 * Page numbers with ellipses, never more than 7 slots wide.
 *
 * Always shows the first and last page, the current page and one either side. Everything
 * skipped collapses into a single "…". Returning the numbers rather than rendering them keeps
 * the arithmetic testable by eye.
 */
function pageWindow(page: number, totalPages: number): Array<number | "gap"> {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);

  const out: Array<number | "gap"> = [1];
  const from = Math.max(2, page - 1);
  const to = Math.min(totalPages - 1, page + 1);

  if (from > 2) out.push("gap");
  for (let i = from; i <= to; i++) out.push(i);
  if (to < totalPages - 1) out.push("gap");

  out.push(totalPages);
  return out;
}

export function Pagination({
  page,
  totalPages,
  total,
  count,
  limit,
  onPageChange,
  className,
}: PaginationProps) {
  // One page of results needs no controls, but the count line is still worth showing.
  const first = total === 0 ? 0 : (page - 1) * limit + 1;
  const last = (page - 1) * limit + count;

  return (
    <div
      className={cn(
        "flex flex-col sm:flex-row items-center justify-between gap-2 mt-3",
        className
      )}
    >
      <p className="text-[11px] text-slate-500 tabular-nums">
        {total === 0 ? "No results" : `Showing ${first}–${last} of ${total}`}
      </p>

      {totalPages > 1 && (
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 1}
            aria-label="Previous page"
            className="min-h-[36px] min-w-[36px] inline-flex items-center justify-center rounded-lg border border-slate-200 text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50 focus-ring"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>

          {pageWindow(page, totalPages).map((p, i) =>
            p === "gap" ? (
              <span key={`gap-${i}`} className="px-1.5 text-xs text-slate-400 select-none">
                …
              </span>
            ) : (
              <button
                key={p}
                type="button"
                onClick={() => onPageChange(p)}
                aria-current={p === page ? "page" : undefined}
                className={cn(
                  "min-h-[36px] min-w-[36px] inline-flex items-center justify-center rounded-lg border text-xs tabular-nums focus-ring",
                  p === page
                    ? "border-blue-600 bg-blue-600 text-white font-semibold"
                    : "border-slate-200 text-slate-600 hover:bg-slate-50"
                )}
              >
                {p}
              </button>
            )
          )}

          <button
            type="button"
            onClick={() => onPageChange(page + 1)}
            disabled={page >= totalPages}
            aria-label="Next page"
            className="min-h-[36px] min-w-[36px] inline-flex items-center justify-center rounded-lg border border-slate-200 text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50 focus-ring"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}
