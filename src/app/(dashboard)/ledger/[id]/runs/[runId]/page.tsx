"use client";

// /ledger/[vendorId]/runs/[runId] — the review page for one AI run, any task (plan
// 1310-ledger-prompted-import-without-file-storage, Parts C and D; R4, R5). Nothing reaches the
// ledger until a person approves here; the accept route re-checks the permission and the
// tie-out. Loads once — a run still reading shows a Refresh button, never a timer.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useCallback, useEffect, useState } from "react";
import { ShieldAlert } from "lucide-react";
import { SkeletonList } from "@/components/ui/skeleton";
import { usePermissions } from "@/lib/use-permissions";
import { ClaimsReview } from "./_components/claims-review";
import { ReviewHeader } from "./_components/review-header";
import { loadRun } from "./_components/review-api";
import { fmtWhen, type ReviewRun } from "./_components/review-types";
import { RunActions } from "./_components/run-actions";
import { StatementReview } from "./_components/statement-review";
import { Understood } from "./_components/understood";
import "../../ledger.css";
import "./_components/review.css";

/** A read is cut off at 60 s (the routes' maxDuration); past this it has stopped, not slowed. */
const STOPPED_AFTER_MS = 3 * 60_000;

/**
 * The module whose Create accepting or discarding this run needs — moduleForRun in
 * src/lib/brand-ledger/import-access.ts, which is server-only. Cosmetic here; the API decides.
 */
function writeModule(run: ReviewRun): "brand_ledger" | "brand_ledger_gaps" {
  if (run.task === "STATEMENT_ROWS") return "brand_ledger";
  if (run.task === "PROMPTED_IMPORT") return run.proposals?.kind === "claims" ? "brand_ledger_gaps" : "brand_ledger";
  return "brand_ledger_gaps";
}

export default function RunReviewPage({ params }: { params: Promise<{ id: string; runId: string }> }) {
  const { id, runId } = use(params);
  // Keyed: a re-run navigates to a new run id, and none of this run's edits may carry over.
  return <RunReview key={runId} vendorId={id} runId={runId} />;
}

function RunReview({ vendorId, runId }: { vendorId: string; runId: string }) {
  const router = useRouter();
  const { canCreate, loading: permsLoading } = usePermissions();
  const [run, setRun] = useState<ReviewRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stoppedMinutes, setStoppedMinutes] = useState<number | null>(null);

  // A promise chain, not an async body: state is set in the callback (react-hooks/set-state-in-effect).
  const load = useCallback(
    () =>
      loadRun(runId).then((r) => {
        if ("error" in r) {
          setError(r.error);
        } else {
          const age = Date.now() - Date.parse(r.run.createdAt);
          setStoppedMinutes(r.run.status === "RUNNING" && age > STOPPED_AFTER_MS ? Math.floor(age / 60_000) : null);
          setRun(r.run);
          setError(null);
        }
        setLoading(false);
        setRefreshing(false);
      }),
    [runId]
  );

  useEffect(() => {
    void load();
  }, [load]);

  const reload = () => {
    setRefreshing(true);
    void load();
  };

  if (loading) return <SkeletonList count={4} type="card" />;

  if (!run) {
    return (
      <div className="text-center py-12">
        <ShieldAlert className="h-12 w-12 text-slate-300 mx-auto mb-3" />
        <p className="text-sm text-slate-500">{error || "This run was not found"}</p>
        <div className="mt-3 flex justify-center gap-3">
          <button type="button" className="min-h-[44px] px-4 text-sm font-semibold text-blue-600" disabled={refreshing} onClick={reload}>
            {refreshing ? "Trying…" : "Try again"}
          </button>
          <Link href={`/ledger/${vendorId}`} className="min-h-[44px] px-4 inline-flex items-center text-sm text-blue-600">
            Back to the ledger
          </Link>
        </div>
      </div>
    );
  }

  const ledgerHref = `/ledger/${run.vendorId}`;
  const canWrite = canCreate(writeModule(run));
  const canRerun = canCreate("brand_ledger") || canCreate("brand_ledger_gaps");
  const kind = run.proposals?.kind ?? null;
  const done = run.status === "DONE";
  const editable = done && canWrite;
  // Duplicates are judged only while a run waits for review: once accepted, its own rows are
  // on the ledger and would all read as "already there".
  const shown: ReviewRun = done ? run : { ...run, existing: undefined };
  const approveBar = editable && (kind === "statement" || kind === "claims");

  const approved = (added: number) =>
    router.push(`${ledgerHref}?imported=${added}&as=${kind === "claims" ? "claims" : "rows"}`);
  const discarded = () => router.push(`${ledgerHref}?discarded=1`);

  return (
    <div className="bch-ledger">
      <header className="hdr">
        <Link className="back" href={ledgerHref}>‹ Ledger</Link>
        <h1>Review</h1>
      </header>

      {run.vendorId !== vendorId && (
        <div className="alert">
          This run belongs to another vendor&apos;s ledger. <Link href={`${ledgerHref}/runs/${run.id}`}>Open it there</Link>.
        </div>
      )}
      {error && <div className="rv-bad" style={{ marginBottom: 10 }}>{error}</div>}

      <ReviewHeader run={run} />

      {run.status === "RUNNING" && (
        <div className="card">
          <h3>Still reading — refresh in a moment</h3>
          <p className="rv-muted">A read takes up to a minute. Nothing here updates on its own.</p>
          {stoppedMinutes !== null && (
            <div className="rv-warn">
              It has been reading for {stoppedMinutes} minutes, longer than a read can take — it has most likely stopped. Discard it and
              re-run, or upload the file again.
            </div>
          )}
          <button type="button" className="iconbtn primary rv-btn" style={{ marginTop: 10 }} disabled={refreshing} onClick={reload}>
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      )}

      {run.status === "FAILED" && <div className="alert">The read failed: {run.error || "no reason was recorded."}</div>}

      {run.status === "ACCEPTED" && (
        <div className="card">
          <div className="rv-ok">Added to the ledger{run.acceptedAt ? ` on ${fmtWhen(run.acceptedAt)}` : ""}</div>
          <p className="rv-muted" style={{ marginTop: 8 }}>
            Below is what was proposed. The ledger holds what was approved, with any edits made at review.
          </p>
          <Link className="iconbtn rv-btn" style={{ marginTop: 8 }} href={ledgerHref}>Open the ledger</Link>
        </div>
      )}

      {run.status === "DISCARDED" && (
        <div className="card">
          <div className="rv-muted" style={{ color: "var(--ink)", fontWeight: 600 }}>Discarded — nothing from this run reached the ledger.</div>
        </div>
      )}

      {run.proposals && <Understood proposals={run.proposals} />}

      {done && !permsLoading && !canWrite && kind !== "not_ledger" && (
        <div className="rv-warn" style={{ marginBottom: 10 }}>
          You can look at this run. Adding it needs Create on {writeModule(run) === "brand_ledger" ? "Brand Ledgers" : "Ledger Claims"}.
        </div>
      )}

      {/* Keyed on the status too: a reload that finds the run accepted elsewhere drops the edits. */}
      {kind === "statement" && (
        <StatementReview key={run.status} run={shown} editable={editable} onApproved={approved} onDiscarded={discarded} onReload={reload} />
      )}
      {kind === "claims" && (
        <ClaimsReview key={run.status} run={shown} editable={editable} onApproved={approved} onDiscarded={discarded} onReload={reload} />
      )}
      {done && !run.proposals && <div className="card"><div className="empty">This run produced nothing to review.</div></div>}

      <RunActions
        run={run}
        canRerun={canRerun}
        canDiscard={canWrite}
        showDiscard={!approveBar && (run.status !== "RUNNING" || stoppedMinutes !== null)}
        onDiscarded={discarded}
        onReload={reload}
      />
    </div>
  );
}
