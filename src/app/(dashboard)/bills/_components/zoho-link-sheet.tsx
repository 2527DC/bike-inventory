"use client";

// ─── Link bills to Zoho (plan 1210 credit notes, Part 1.4) ──────────────────────────────────
//
// For bills that are in the app but carry no Zoho bill id. Dry run first — it writes nothing and
// reports what would happen — then Apply. Each press sends batches ONE AFTER ANOTHER (the next
// starts when the previous answers) until the server's cursor comes back empty. One click starts
// it; nothing runs on a timer.
//
// Apply writes the Zoho link, the store from a linked Zoho location, and the part of the paid
// amount that is credit notes. It NEVER changes a paid amount — the server guarantees that, this
// screen only says so.

import { useState } from "react";
import { Link2, Loader2, CheckCircle2, ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/error-banner";
import { usePermissions } from "@/lib/use-permissions";
import { apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";

const log = createLogger("bills:zoho-link");

interface ListItem {
  billId: string;
  billNo: string;
  vendorName: string;
  reason?: string;
}
interface DriftItem extends ListItem {
  here: number;
  zoho: number;
}

/** One batch's answer from POST /api/bills/zoho-link. */
interface BatchReport {
  mode: "dry-run" | "apply";
  processed: number;
  remaining?: number;
  matched: number;
  /** Matched and passed every check — what Apply links (dry run), or tried to (apply). */
  linkable: number;
  linked: number;
  storesSet: number;
  applicationsWritten: number;
  withLocation: number;
  withoutLocation: number;
  items: {
    notFound: ListItem[];
    ambiguous: ListItem[];
    vendorNotLinked: ListItem[];
    checkByHand: ListItem[];
    failed: ListItem[];
    drift: DriftItem[];
  };
  cursor: string | null;
}

/** The whole run, every batch added up. */
type RunReport = Omit<BatchReport, "cursor" | "mode" | "remaining">;

const EMPTY: RunReport = {
  processed: 0,
  matched: 0,
  linkable: 0,
  linked: 0,
  storesSet: 0,
  applicationsWritten: 0,
  withLocation: 0,
  withoutLocation: 0,
  items: { notFound: [], ambiguous: [], vendorNotLinked: [], checkByHand: [], failed: [], drift: [] },
};

function merge(a: RunReport, b: BatchReport): RunReport {
  return {
    processed: a.processed + b.processed,
    matched: a.matched + b.matched,
    linkable: a.linkable + b.linkable,
    linked: a.linked + b.linked,
    storesSet: a.storesSet + b.storesSet,
    applicationsWritten: a.applicationsWritten + b.applicationsWritten,
    withLocation: a.withLocation + b.withLocation,
    withoutLocation: a.withoutLocation + b.withoutLocation,
    items: {
      notFound: [...a.items.notFound, ...b.items.notFound],
      ambiguous: [...a.items.ambiguous, ...b.items.ambiguous],
      vendorNotLinked: [...a.items.vendorNotLinked, ...b.items.vendorNotLinked],
      checkByHand: [...a.items.checkByHand, ...b.items.checkByHand],
      failed: [...a.items.failed, ...b.items.failed],
      drift: [...a.items.drift, ...b.items.drift],
    },
  };
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(amount);
}

type Phase = "closed" | "intro" | "running" | "report" | "applied";

export interface ZohoLinkSheetProps {
  /** Called after Apply linked at least one bill, so /bills can reload. */
  onDone?: () => void;
  className?: string;
}

export function ZohoLinkSheet({ onDone, className }: ZohoLinkSheetProps) {
  const { canApprove, loading: permsLoading } = usePermissions();

  const [phase, setPhase] = useState<Phase>("closed");
  const [mode, setMode] = useState<"dry-run" | "apply">("dry-run");
  const [progress, setProgress] = useState<{ processed: number; remaining?: number }>({ processed: 0 });
  const [report, setReport] = useState<RunReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Cosmetic only — the route re-checks zoho.approve.
  if (permsLoading || !canApprove("zoho")) return null;

  const running = phase === "running";

  function close() {
    if (running) return;
    setPhase("closed");
    setReport(null);
    setError(null);
    setProgress({ processed: 0 });
  }

  async function run(which: "dry-run" | "apply") {
    setMode(which);
    setPhase("running");
    setError(null);
    setProgress({ processed: 0 });

    let acc: RunReport = EMPTY;
    let cursor: string | undefined;
    let remaining: number | undefined;
    // Sequential on purpose: the next batch starts when this one has answered.
    for (;;) {
      const { data, error: err } = await apiTry<BatchReport>("/api/bills/zoho-link", {
        method: "POST",
        json: { mode: which, ...(cursor ? { cursor } : {}), batch: 20 },
        timeoutMs: 60_000,
      });
      if (err || !data) {
        log.warn("zoho link batch failed", { mode: which, processed: acc.processed, message: err ?? "empty response" });
        setError(
          acc.processed > 0
            ? `Stopped after ${acc.processed} bill${acc.processed === 1 ? "" : "s"}: ${err ?? "no answer"}. ${which === "apply" ? "What was linked stays linked; run Apply again to continue." : "Run the dry run again."}`
            : err ?? "The server did not answer.",
        );
        setReport(acc.processed > 0 ? acc : null);
        setPhase(acc.processed > 0 ? (which === "apply" ? "applied" : "report") : "intro");
        if (which === "apply" && acc.linked > 0) onDone?.();
        return;
      }
      acc = merge(acc, data);
      if (typeof data.remaining === "number") remaining = data.remaining;
      setProgress({ processed: acc.processed, remaining });
      if (!data.cursor) break;
      if (data.cursor === cursor) {
        // A cursor that does not move would loop for ever. Stop and say so.
        log.warn("zoho link made no progress", { mode: which, cursor });
        setError("Linking stopped making progress. Run it again; if it repeats, report it.");
        break;
      }
      cursor = data.cursor;
    }

    log.info("zoho link run finished", {
      mode: which,
      processed: acc.processed,
      matched: acc.matched,
      linked: acc.linked,
      notFound: acc.items.notFound.length,
      ambiguous: acc.items.ambiguous.length,
      checkByHand: acc.items.checkByHand.length,
      failed: acc.items.failed.length,
    });
    setReport(acc);
    setPhase(which === "apply" ? "applied" : "report");
    if (which === "apply" && acc.linked > 0) onDone?.();
  }

  const matchedTotal = report ? report.withLocation + report.withoutLocation : 0;

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        aria-label="Link bills to Zoho"
        className={`min-h-[44px] shrink-0 whitespace-nowrap ${className ?? ""}`}
        onClick={() => setPhase("intro")}
      >
        <Link2 className="mr-1 h-3.5 w-3.5" />
        <span className="hidden sm:inline">Link bills to&nbsp;</span>Zoho
      </Button>

      {phase !== "closed" && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Link bills to Zoho">
          <button
            type="button"
            aria-label="Close"
            onClick={close}
            disabled={running}
            className="absolute inset-0 bg-black/40 disabled:cursor-wait"
          />
          <div className="absolute bottom-0 left-0 right-0 flex justify-center">
            <div className="flex max-h-[85vh] w-full max-w-md flex-col rounded-t-2xl bg-white shadow-xl">
              <div className="shrink-0 border-b border-slate-200 px-4 pb-3 pt-4">
                <h2 className="text-base font-semibold text-slate-900">Link bills to Zoho</h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  {phase === "intro" && "For bills here that have no Zoho bill id yet."}
                  {phase === "running" && (mode === "apply" ? "Applying — do not close this." : "Dry run — nothing is being changed.")}
                  {phase === "report" && "Dry run finished — nothing was changed."}
                  {phase === "applied" && "Apply finished."}
                </p>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
                {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

                {phase === "intro" && (
                  <div className="space-y-2 text-sm text-slate-700">
                    <p>
                      Each bill is looked up in Zoho Books by its supplier and number. Start with a <b>dry run</b>: it
                      changes nothing and shows what would be linked.
                    </p>
                    <p className="text-xs text-slate-500">
                      Apply then saves the Zoho link, the store (when the bill&apos;s Zoho location is linked on
                      /stores) and how much of each bill was settled by credit notes before it was imported. It
                      never changes a bill&apos;s paid amount.
                    </p>
                  </div>
                )}

                {phase === "running" && (
                  <div className="flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3">
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin text-blue-600" />
                    <span className="text-xs font-medium text-blue-700 tabular-nums">
                      Checked {progress.processed}
                      {typeof progress.remaining === "number" ? ` of ${progress.remaining}` : ""} bill
                      {progress.processed === 1 ? "" : "s"}…
                    </span>
                  </div>
                )}

                {(phase === "report" || phase === "applied") && report && (
                  <div className="space-y-3">
                    {report.processed === 0 && !error ? (
                      <div className="py-6 text-center">
                        <CheckCircle2 className="mx-auto mb-2 h-8 w-8 text-green-500" />
                        <p className="text-sm font-medium text-slate-700">No bills need linking</p>
                        <p className="mt-1 text-xs text-slate-500">
                          Every bill here is already linked to Zoho, or there are none.
                        </p>
                      </div>
                    ) : (
                      <>
                        <div className="grid grid-cols-3 gap-2 text-center">
                          <Stat label="Checked" value={report.processed} />
                          <Stat label={phase === "applied" ? "Linked" : "Will link"} value={phase === "applied" ? report.linked : report.linkable} tone="text-green-600" />
                          <Stat label="Not found" value={report.items.notFound.length} tone={report.items.notFound.length ? "text-amber-600" : undefined} />
                          <Stat label="Ambiguous" value={report.items.ambiguous.length} tone={report.items.ambiguous.length ? "text-amber-600" : undefined} />
                          <Stat label="Check by hand" value={report.items.checkByHand.length} tone={report.items.checkByHand.length ? "text-amber-600" : undefined} />
                          <Stat label="Failed" value={report.items.failed.length} tone={report.items.failed.length ? "text-red-600" : undefined} />
                        </div>

                        <ul className="space-y-1 text-xs text-slate-600 tabular-nums">
                          <li>Supplier not linked to Zoho: {report.items.vendorNotLinked.length}</li>
                          {matchedTotal > 0 && (
                            <li>
                              Bills carrying a Zoho location: {report.withLocation} of {matchedTotal} (
                              {Math.round((report.withLocation / matchedTotal) * 100)}%)
                            </li>
                          )}
                          <li>Stores {phase === "applied" ? "set" : "to set"} from the Zoho location: {report.storesSet}</li>
                          {phase === "applied" && <li>Credit applications recorded: {report.applicationsWritten}</li>}
                          <li>
                            Balance differs from Zoho: {report.items.drift.length}
                            {report.items.drift.length > 0 && " (reported only — payments recorded here are not in Zoho yet)"}
                          </li>
                        </ul>

                        <ItemList title="Not found in Zoho" items={report.items.notFound} />
                        <ItemList title="Ambiguous" items={report.items.ambiguous} />
                        <ItemList title="Check by hand" items={report.items.checkByHand} />
                        <ItemList title="Supplier not linked to Zoho" items={report.items.vendorNotLinked} />
                        <ItemList title="Failed" items={report.items.failed} />
                        <ItemList
                          title="Balance differs from Zoho"
                          items={report.items.drift.map((d) => ({
                            ...d,
                            reason: `Here ${formatCurrency(d.here)} open · Zoho ${formatCurrency(d.zoho)}`,
                          }))}
                        />

                        {phase === "applied" && report.linked > 0 && (
                          <p className="rounded-lg border border-blue-200 bg-blue-50 p-2.5 text-xs text-blue-800">
                            Next: on Bills, press <b>Fetch credit notes</b> with <b>This financial year</b>, so credits
                            applied after each bill was imported are counted too.
                          </p>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>

              <div className="shrink-0 border-t border-slate-200 bg-white px-4 py-3">
                {phase === "intro" && (
                  <div className="flex gap-2">
                    <Button variant="outline" className="min-h-[44px] flex-1" onClick={close}>
                      Cancel
                    </Button>
                    <Button className="min-h-[44px] flex-1" onClick={() => void run("dry-run")}>
                      Dry run
                    </Button>
                  </div>
                )}
                {phase === "running" && (
                  <Button className="min-h-[44px] w-full" disabled>
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                    {mode === "apply" ? "Applying…" : "Checking…"}
                  </Button>
                )}
                {phase === "report" && report && (
                  <div className="flex gap-2">
                    <Button variant="outline" className="min-h-[44px] flex-1" onClick={close}>
                      Close
                    </Button>
                    <Button
                      className="min-h-[44px] flex-1 bg-blue-600 hover:bg-blue-700"
                      onClick={() => void run("apply")}
                      disabled={report.linkable === 0}
                    >
                      Apply
                    </Button>
                  </div>
                )}
                {phase === "applied" && (
                  <Button className="min-h-[44px] w-full" onClick={close}>
                    Done
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 p-2">
      <p className="text-[11px] text-slate-500">{label}</p>
      <p className={`text-lg font-bold tabular-nums ${tone ?? "text-slate-800"}`}>{value}</p>
    </div>
  );
}

function ItemList({ title, items }: { title: string; items: ListItem[] }) {
  const [open, setOpen] = useState(false);
  if (items.length === 0) return null;
  const shown = items.slice(0, 50);
  return (
    <section>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-[44px] w-full items-center gap-1.5 text-left text-xs font-semibold text-slate-700 tabular-nums"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        {title} ({items.length})
      </button>
      {open && (
        <ul className="space-y-1 pl-5">
          {shown.map((i) => (
            <li key={`${title}-${i.billId}`} className="text-xs text-slate-600">
              <span className="font-medium text-slate-800">{i.billNo}</span> · {i.vendorName}
              {i.reason && <span className="block text-[11px] text-slate-500">{i.reason}</span>}
            </li>
          ))}
          {items.length > shown.length && (
            <li className="text-[11px] text-slate-500 tabular-nums">…and {items.length - shown.length} more</li>
          )}
        </ul>
      )}
    </section>
  );
}
