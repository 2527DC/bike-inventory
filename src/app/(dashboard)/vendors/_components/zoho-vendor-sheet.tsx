"use client";

// ─── Import vendors from Zoho ─────────────────────────────────────────────────
//
// Plan 2409-zoho-vendor-sync, Part A. Same shape as the Zoho brand / category sheet
// (src/components/zoho-taxonomy-sheet.tsx): the preview route writes nothing, this sheet holds
// the choice in memory, and Import sends only ticked ids. What differs: each new vendor costs
// a Zoho detail read, so the import runs in batches of BATCH and shows progress between them
// rather than one long request.

import { useCallback, useState } from "react";
import { Cloud, Download, Loader2, ChevronDown, ChevronRight, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SkeletonList } from "@/components/ui/skeleton";
import { ErrorBanner } from "@/components/ui/error-banner";
import { ActionConfirmation } from "@/components/ui/action-confirmation";
import { usePermissions } from "@/lib/use-permissions";
import { apiFetch, apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";

const log = createLogger("vendors:zoho-sheet");

/** Must not exceed MAX_BATCH in api/vendors/zoho-import. */
const BATCH = 20;

interface PreviewRow {
  zohoId: string;
  name: string;
  gstin: string | null;
  city: string | null;
  status: "linked" | "new" | "clash";
  localId?: string;
  localName?: string;
}

interface PreviewResponse {
  rows: PreviewRow[];
  counts: { linked: number; new: number; clash: number; total: number };
}

interface BatchResult {
  created: number;
  skipped: number;
  errors: string[];
}

export function ZohoVendorSheet({ onDone }: { onDone: () => void }) {
  const { canCreate, loading: permsLoading } = usePermissions();

  const [step, setStep] = useState<"idle" | "fetching" | "selecting" | "importing">("idle");
  const [rows, setRows] = useState<PreviewRow[]>([]);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [showLinked, setShowLinked] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState<BatchResult | null>(null);

  const newRows = rows.filter((r) => r.status === "new");
  const clashRows = rows.filter((r) => r.status === "clash");
  const linkedRows = rows.filter((r) => r.status === "linked");
  const tickedNew = newRows.filter((r) => ticked.has(r.zohoId)).length;

  const runFetch = useCallback(async () => {
    setStep("fetching");
    setError(null);
    setRows([]);
    setTicked(new Set());
    setShowLinked(false);

    const { data, error: err } = await apiTry<PreviewResponse>("/api/vendors/zoho-preview", { timeoutMs: 60_000 });
    if (err || !data) {
      log.error("vendor preview failed", { message: err ?? "empty response" });
      setError(err ?? "Zoho returned nothing to preview.");
      setStep("selecting");
      return;
    }
    log.info("vendor preview loaded", data.counts);
    setRows(data.rows);
    setTicked(new Set(data.rows.filter((r) => r.status === "new").map((r) => r.zohoId)));
    setStep("selecting");
  }, []);

  function toggle(zohoId: string) {
    setTicked((prev) => {
      const next = new Set(prev);
      if (next.has(zohoId)) next.delete(zohoId);
      else next.add(zohoId);
      return next;
    });
  }

  function close() {
    setStep("idle");
    setRows([]);
    setTicked(new Set());
    setError(null);
    setProgress({ done: 0, total: 0 });
  }

  async function runImport() {
    const ids = newRows.filter((r) => ticked.has(r.zohoId)).map((r) => r.zohoId);
    if (ids.length === 0) return;
    setStep("importing");
    setError(null);
    setProgress({ done: 0, total: ids.length });

    const total: BatchResult = { created: 0, skipped: 0, errors: [] };
    try {
      for (let i = 0; i < ids.length; i += BATCH) {
        const batch = ids.slice(i, i + BATCH);
        log.debug("-> POST vendors/zoho-import", { from: i, size: batch.length });
        const res = await apiFetch<BatchResult>("/api/vendors/zoho-import", {
          method: "POST",
          json: { ids: batch },
          timeoutMs: 90_000,
        });
        total.created += res.created;
        total.skipped += res.skipped;
        total.errors.push(...res.errors);
        setProgress({ done: Math.min(i + batch.length, ids.length), total: ids.length });
      }
      log.info("vendor import finished", { created: total.created, skipped: total.skipped });
      close();
      setResult(total);
      onDone();
    } catch (e) {
      // Batches already written stay written — a re-run skips them as "already here".
      const msg = e instanceof Error ? e.message : "Import failed";
      log.error("vendor import failed", { message: msg, created: total.created });
      setError(
        total.created > 0
          ? `${msg} — ${total.created} vendor(s) were imported before this. Fetch again to continue with the rest.`
          : msg
      );
      setStep("selecting");
      if (total.created > 0) onDone();
    }
  }

  // Cosmetic only — both routes re-check vendors.create.
  if (permsLoading || !canCreate("vendors")) return null;

  const open = step !== "idle";
  const busy = step === "fetching" || step === "importing";
  const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        aria-label="Import vendors from Zoho"
        className="min-h-[44px] shrink-0 whitespace-nowrap"
        onClick={() => void runFetch()}
        disabled={busy}
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Cloud className="h-3.5 w-3.5 mr-1" />}
        <span className="hidden sm:inline">Import from&nbsp;</span>Zoho
      </Button>

      {open && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Import vendors from Zoho">
          <button
            type="button"
            aria-label="Close"
            onClick={close}
            disabled={busy}
            className="absolute inset-0 bg-black/40 disabled:cursor-wait"
          />
          <div className="absolute bottom-0 left-0 right-0 flex justify-center">
            <div className="flex w-full max-w-md flex-col rounded-t-2xl bg-white shadow-xl max-h-[85vh]">
              <div className="shrink-0 border-b border-slate-200 px-4 pb-3 pt-4">
                <h2 className="text-base font-semibold text-slate-900">Import vendors from Zoho</h2>
                <p className="mt-0.5 text-xs text-slate-500 tabular-nums">
                  {step === "fetching"
                    ? "Reading every vendor from Zoho…"
                    : rows.length > 0
                      ? `${rows.length} in Zoho · ${newRows.length} new · ${linkedRows.length} already here · ${clashRows.length} name clash`
                      : "Nothing to show yet"}
                </p>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
                {error && (
                  <ErrorBanner
                    message={error}
                    type={typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "error"}
                    onRetry={() => void runFetch()}
                    onDismiss={() => setError(null)}
                  />
                )}

                {step === "fetching" && <SkeletonList count={5} type="card" />}

                {step === "importing" && (
                  <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
                    <div className="flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                      <span className="text-xs font-medium text-blue-700 tabular-nums">
                        Importing {progress.done} of {progress.total} — do not close this.
                      </span>
                    </div>
                    <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-blue-100">
                      <div className="h-full bg-blue-600 transition-all" style={{ width: `${pct}%` }} />
                    </div>
                    <p className="mt-1.5 text-[11px] text-blue-700">
                      Each vendor&apos;s full details are read from Zoho, about 20 every 15 seconds.
                    </p>
                  </div>
                )}

                {step === "selecting" && !error && rows.length === 0 && (
                  <p className="py-8 text-center text-sm text-slate-500">Zoho returned no vendors.</p>
                )}

                {step === "selecting" && rows.length > 0 && (
                  <div className="space-y-4">
                    <section>
                      <div className="mb-1.5 flex items-center justify-between gap-2">
                        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-700 tabular-nums">
                          New ({newRows.length})
                        </h3>
                        {newRows.length > 0 && (
                          <button
                            type="button"
                            onClick={() =>
                              setTicked(tickedNew === newRows.length ? new Set() : new Set(newRows.map((r) => r.zohoId)))
                            }
                            className="min-h-[44px] px-1 text-xs font-medium text-blue-600 underline"
                          >
                            {tickedNew === newRows.length ? "Clear all" : "Select all"}
                          </button>
                        )}
                      </div>
                      {newRows.length === 0 ? (
                        <p className="text-xs text-slate-500">Every Zoho vendor is already here.</p>
                      ) : (
                        <ul className="space-y-1">
                          {newRows.map((r) => {
                            const on = ticked.has(r.zohoId);
                            return (
                              <li key={r.zohoId}>
                                <label
                                  className={`flex min-h-[44px] cursor-pointer items-center gap-2.5 rounded-lg border p-2.5 transition-colors ${
                                    on ? "border-blue-300 bg-blue-50" : "border-slate-200 bg-white"
                                  }`}
                                >
                                  <input
                                    type="checkbox"
                                    checked={on}
                                    onChange={() => toggle(r.zohoId)}
                                    className="h-4 w-4 shrink-0 rounded"
                                  />
                                  <span className="min-w-0 flex-1">
                                    <span className="block truncate text-sm text-slate-900">{r.name}</span>
                                    <span className="block truncate text-[11px] text-slate-500">
                                      {[r.gstin, r.city].filter(Boolean).join(" · ") || "No GSTIN in Zoho"}
                                    </span>
                                  </span>
                                </label>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </section>

                    {clashRows.length > 0 && (
                      <section>
                        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-700 tabular-nums">
                          Name clash ({clashRows.length})
                        </h3>
                        <p className="mb-1.5 text-[11px] text-slate-500">
                          A vendor with this name is already here but is not this Zoho vendor. Not imported —
                          rename one side, then fetch again.
                        </p>
                        <ul className="space-y-1">
                          {clashRows.map((r) => (
                            <li
                              key={r.zohoId}
                              className="flex min-h-[44px] items-center gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-2.5"
                            >
                              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
                              <span className="min-w-0 flex-1 truncate text-sm text-amber-900">{r.name}</span>
                            </li>
                          ))}
                        </ul>
                      </section>
                    )}

                    {linkedRows.length > 0 && (
                      <section>
                        <button
                          type="button"
                          onClick={() => setShowLinked((v) => !v)}
                          className="flex min-h-[44px] w-full items-center gap-1.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 tabular-nums"
                        >
                          {showLinked ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                          Already here ({linkedRows.length})
                        </button>
                        {showLinked && (
                          <ul className="mt-1 space-y-0.5 pl-5">
                            {linkedRows.map((r) => (
                              <li key={r.zohoId} className="text-xs text-slate-500">
                                {r.name}
                              </li>
                            ))}
                          </ul>
                        )}
                      </section>
                    )}
                  </div>
                )}
              </div>

              <div className="shrink-0 border-t border-slate-200 bg-white px-4 py-3">
                <div className="flex items-center gap-2">
                  <Button variant="outline" className="min-h-[44px] flex-1" onClick={close} disabled={busy}>
                    Cancel
                  </Button>
                  <Button
                    className="min-h-[44px] flex-1 bg-blue-600 hover:bg-blue-700"
                    onClick={() => void runImport()}
                    disabled={busy || step !== "selecting" || tickedNew === 0}
                  >
                    {step === "importing" ? (
                      <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                    ) : (
                      <Download className="mr-1.5 h-4 w-4" />
                    )}
                    Import {tickedNew}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {result && (
        <ActionConfirmation
          open
          onClose={() => setResult(null)}
          type={result.errors.length > 0 ? "warning" : "success"}
          title={result.errors.length > 0 ? "Imported with warnings" : "Imported from Zoho"}
          referenceId={`${result.created} vendors`}
          items={[
            { label: "Created", value: String(result.created) },
            { label: "Skipped", value: String(result.skipped) },
          ]}
          details={
            result.errors.length > 0
              ? `${result.errors.length} vendor${result.errors.length === 1 ? " was" : "s were"} skipped:`
              : undefined
          }
        >
          {result.errors.length > 0 && (
            <ul className="max-h-40 space-y-1 overflow-y-auto">
              {result.errors.slice(0, 8).map((e, i) => (
                <li key={i} className="text-xs text-amber-700">
                  {e}
                </li>
              ))}
              {result.errors.length > 8 && (
                <li className="text-xs text-slate-500 tabular-nums">…and {result.errors.length - 8} more</li>
              )}
            </ul>
          )}
        </ActionConfirmation>
      )}
    </>
  );
}
