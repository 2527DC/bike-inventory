"use client";

// The one-time line after the review page (plan 1310, Part C/D). Approve sends the person back to
// /ledger/[vendorId]?imported=<n>&as=rows|claims, Discard to ?discarded=1. The line is shown once
// and the params are stripped at once, so a refresh or a shared link does not repeat it.
//
// Uses useSearchParams, so BrandPage renders it under its own <Suspense> boundary
// (node_modules/next/dist/docs/01-app/03-api-reference/04-functions/use-search-params.md).
import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createLogger } from "@/lib/logger";

const log = createLogger("ledger:import-notice");

const PARAMS = ["imported", "as", "discarded"] as const;

interface Notice {
  text: string;
  tone: "added" | "discarded";
  /** Claims land as gaps — offer the way there. */
  toGaps: boolean;
}

function noticeFrom(params: URLSearchParams): Notice | null {
  if (params.get("discarded") === "1") return { text: "Run discarded — nothing was added", tone: "discarded", toGaps: false };
  const raw = params.get("imported");
  const n = raw === null ? NaN : Number(raw);
  if (!Number.isInteger(n) || n < 0) return null;
  const as = params.get("as");
  if (as === "claims") return { text: `Added ${n} claim${n === 1 ? "" : "s"} as gaps`, tone: "added", toGaps: true };
  if (as === "rows") return { text: `Added ${n} row${n === 1 ? "" : "s"} to the ledger`, tone: "added", toGaps: false };
  return null;
}

export function ImportNotice({ onOpenGaps }: { onOpenGaps: () => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // Non-empty only while one of our params is on the URL.
  const query = PARAMS.some((p) => searchParams.has(p)) ? searchParams.toString() : "";

  const [seen, setSeen] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);
  // Derived during render (not in an effect): a new result on the URL replaces the line.
  if (query !== seen) {
    setSeen(query);
    if (query) setNotice(noticeFrom(new URLSearchParams(query)));
  }

  useEffect(() => {
    if (!query) return;
    const next = new URLSearchParams(query);
    const shown = noticeFrom(next);
    if (shown) log.debug("review result shown", { tone: shown.tone, toGaps: shown.toGaps });
    else log.warn("review result params not understood — stripped", { keys: PARAMS.filter((p) => next.has(p)) });
    PARAMS.forEach((p) => next.delete(p));
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [query, pathname, router]);

  if (!notice) return null;
  const discarded = notice.tone === "discarded";
  return (
    <div
      className="result"
      role="status"
      style={{
        display: "flex",
        gap: 8,
        alignItems: "center",
        flexWrap: "wrap",
        margin: "0 0 10px",
        ...(discarded ? { background: "var(--gray-bg)", borderColor: "var(--line)", color: "var(--ink)" } : null),
      }}
    >
      <span style={{ flex: 1, minWidth: 160, fontWeight: 600 }}>
        {discarded ? "" : "✓ "}
        {notice.text}
        {notice.toGaps && (
          <>
            {" — "}
            <button
              type="button"
              onClick={() => {
                onOpenGaps();
                setNotice(null);
              }}
              style={{ font: "inherit", background: "none", border: "none", padding: 0, color: "var(--blue)", fontWeight: 700, textDecoration: "underline", cursor: "pointer" }}
            >
              see the Gaps tab
            </button>
          </>
        )}
      </span>
      <button
        type="button"
        className="iconbtn"
        aria-label="Dismiss"
        style={{ minHeight: 44, minWidth: 44 }}
        onClick={() => setNotice(null)}
      >
        ✕
      </button>
    </div>
  );
}
