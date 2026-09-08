"use client";

// ─── Fetch brands / categories from Zoho ─────────────────────────────────────
//
// ONE component, mounted twice: /more/brands and /categories are already the same screen
// twice over (categories/page.tsx says so outright), so the Zoho sheet is written once and
// told which master it is looking at.
//
// What it is NOT: it does not reuse the ZohoPullPreview machinery that bills and invoices
// go through. §1 of the plan explains why — brands are a master-data sync, not a
// transactional pull, so there is no pullId, no staged rows and no resume. The preview
// route writes nothing; this sheet holds the whole decision in memory until Import.
//
// The one thing the client cannot decide: ADOPTIONS. Only the ticked `new` ids are sent.
// The server recomputes which local rows get their zohoBrandId/zohoCategoryId filled and
// always applies them (owner decision D3), so a tampered body cannot request a link.

import { useCallback, useState } from "react";
import { Cloud, Download, Loader2, Link2, ChevronDown, ChevronRight, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SkeletonList } from "@/components/ui/skeleton";
import { ErrorBanner } from "@/components/ui/error-banner";
import { ActionConfirmation } from "@/components/ui/action-confirmation";
import { usePermissions } from "@/lib/use-permissions";
import { apiFetch, apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";

const log = createLogger("zoho:taxonomy-sheet");

/** Exactly the shape `GET /api/{brands,categories}/zoho-preview` returns inside `data`. */
interface PreviewRow {
  zohoId: string;
  name: string;
  status: "linked" | "adopt" | "new";
  localId?: string;
  localName?: string;
  vendorLike: boolean;
}

interface PreviewResponse {
  rows: PreviewRow[];
  counts: { linked: number; adopt: number; new: number; total: number };
}

/** What `POST /api/{brands,categories}/zoho-import` answers with. */
interface ImportResult {
  adopted: number;
  created: number;
  skipped: number;
  errors: string[];
}

type Kind = "brand" | "category";

/**
 * Per-kind wiring. The `module` values are the RBAC module keys, not display strings —
 * `brands.fetch` / `categories.fetch` guard the preview routes and `*.create` the imports.
 */
const CONFIG: Record<Kind, { module: string; many: string; base: string }> = {
  brand: { module: "brands", many: "brands", base: "/api/brands" },
  category: { module: "categories", many: "categories", base: "/api/categories" },
};

export interface ZohoTaxonomySheetProps {
  /** Which master this sheet syncs. Decides the routes, the wording and the permission. */
  kind: Kind;
  /** Re-run the host screen's `load()` so the list reflects what was just written. */
  onDone: () => void;
  /** Optional extra classes on the trigger button, for the host's header bar. */
  className?: string;
}

export function ZohoTaxonomySheet({ kind, onDone, className }: ZohoTaxonomySheetProps) {
  const cfg = CONFIG[kind];
  const { canFetch, loading: permsLoading } = usePermissions();

  // idle → fetching → selecting → importing, mirroring inbound/page.tsx:119.
  const [step, setStep] = useState<"idle" | "fetching" | "selecting" | "importing">("idle");
  const [rows, setRows] = useState<PreviewRow[]>([]);
  // A plain Set of Zoho ids. No selection library — inbound/page.tsx:281 does the same.
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [showLinked, setShowLinked] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  const newRows = rows.filter((r) => r.status === "new");
  const adoptRows = rows.filter((r) => r.status === "adopt");
  const linkedRows = rows.filter((r) => r.status === "linked");
  const tickedNew = newRows.filter((r) => ticked.has(r.zohoId)).length;
  // Nothing to do at all: no ticked creations AND no automatic links to apply.
  const nothingToDo = tickedNew === 0 && adoptRows.length === 0;

  const runFetch = useCallback(async () => {
    setStep("fetching");
    setError(null);
    setRows([]);
    setTicked(new Set());
    setShowLinked(false);

    const { data, error: err } = await apiTry<PreviewResponse>(`${cfg.base}/zoho-preview`, {
      // Zoho pages 200 rows at a time and the route walks every page, so a ceiling is the
      // honest thing to set. With none, a dead link leaves the sheet on a skeleton forever.
      timeoutMs: 60_000,
    });

    if (err || !data) {
      log.error("taxonomy preview failed", { kind, message: err ?? "empty response" });
      setError(err ?? "Zoho returned nothing to preview.");
      // Stay OPEN on `selecting` with no rows: the sheet is where the ErrorBanner and its
      // Retry live, and dropping back to `idle` would close it and hide both.
      setStep("selecting");
      return;
    }

    log.info("taxonomy preview loaded", { kind, ...data.counts });
    setRows(data.rows);
    // Everything genuinely new starts ticked (plan §5). Nothing is auto-unticked for being
    // vendor-shaped — owner decision D2 was to see all of them, flagged.
    setTicked(new Set(data.rows.filter((r) => r.status === "new").map((r) => r.zohoId)));
    setStep("selecting");
  }, [cfg.base, kind]);

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
  }

  async function runImport() {
    if (nothingToDo) return;
    setStep("importing");
    setError(null);
    try {
      // Ticked `new` ids ONLY. Adoptions are recomputed server-side.
      const create = newRows.filter((r) => ticked.has(r.zohoId)).map((r) => r.zohoId);
      log.debug("-> POST zoho-import", { kind, create: create.length, adoptExpected: adoptRows.length });

      const res = await apiFetch<ImportResult>(`${cfg.base}/zoho-import`, {
        method: "POST",
        json: { create },
        timeoutMs: 120_000,
      });

      log.info("taxonomy import finished", {
        kind,
        adopted: res.adopted,
        created: res.created,
        skipped: res.skipped,
      });
      close();
      setResult(res);
      onDone();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Import failed";
      log.error("taxonomy import failed", { kind, message: msg });
      setError(msg);
      setStep("selecting");
    }
  }

  // Cosmetic only — every one of the four routes re-checks with requireFeature.
  if (permsLoading || !canFetch(cfg.module)) return null;

  const open = step !== "idle";
  const busy = step === "fetching" || step === "importing";

  return (
    <>
      {/* At 375px the header already carries a back arrow, a title and New. Spelling the
          label out in full there leaves the title ~60px and wraps the subtitle to four
          lines, so the visible words shorten on the narrowest screens while the accessible
          name stays "Fetch from Zoho" at every width. */}
      <Button
        size="sm"
        variant="outline"
        aria-label="Fetch from Zoho"
        className={`min-h-[44px] shrink-0 whitespace-nowrap ${className ?? ""}`}
        onClick={() => void runFetch()}
        disabled={busy}
      >
        {busy ? (
          <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
        ) : (
          <Cloud className="h-3.5 w-3.5 mr-1" />
        )}
        <span className="hidden sm:inline">Fetch from&nbsp;</span>Zoho
      </Button>

      {open && (
        // z-50, deliberately under ActionConfirmation's z-[60] so the result sits on top.
        <div
          className="fixed inset-0 z-50"
          role="dialog"
          aria-modal="true"
          aria-label={`Fetch ${cfg.many} from Zoho`}
        >
          <button
            type="button"
            aria-label="Close"
            onClick={close}
            disabled={busy}
            className="absolute inset-0 bg-black/40 disabled:cursor-wait"
          />

          <div className="absolute bottom-0 left-0 right-0 flex justify-center">
            <div className="flex w-full max-w-md flex-col rounded-t-2xl bg-white shadow-xl max-h-[85vh]">
              {/* Header */}
              <div className="shrink-0 border-b border-slate-200 px-4 pb-3 pt-4">
                <h2 className="text-base font-semibold text-slate-900">
                  Fetch {cfg.many} from Zoho
                </h2>
                <p className="mt-0.5 text-xs text-slate-500 tabular-nums">
                  {step === "fetching"
                    ? "Reading every page from Zoho…"
                    : rows.length > 0
                      ? `${rows.length} in Zoho · ${newRows.length} new · ${adoptRows.length} to link · ${linkedRows.length} already linked`
                      : "Nothing to show yet"}
                </p>
              </div>

              {/* Body */}
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
                  <div className="flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3">
                    <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                    <span className="text-xs font-medium text-blue-700">
                      Writing {cfg.many} — do not close this.
                    </span>
                  </div>
                )}

                {step === "selecting" && !error && rows.length === 0 && (
                  <p className="py-8 text-center text-sm text-slate-500">
                    Zoho returned no {cfg.many}.
                  </p>
                )}

                {step === "selecting" && rows.length > 0 && (
                  <div className="space-y-4">
                    {/* ── New: the only tickable section ─────────────────────── */}
                    <section>
                      <div className="mb-1.5 flex items-center justify-between gap-2">
                        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-700 tabular-nums">
                          New ({newRows.length})
                        </h3>
                        {newRows.length > 0 && (
                          <button
                            type="button"
                            onClick={() =>
                              setTicked(
                                tickedNew === newRows.length
                                  ? new Set()
                                  : new Set(newRows.map((r) => r.zohoId))
                              )
                            }
                            className="min-h-[44px] px-1 text-xs font-medium text-blue-600 underline"
                          >
                            {tickedNew === newRows.length ? "Clear all" : "Select all"}
                          </button>
                        )}
                      </div>
                      {newRows.length === 0 ? (
                        <p className="text-xs text-slate-500">
                          Nothing in Zoho is missing from your {cfg.many}.
                        </p>
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
                                  <span className="min-w-0 flex-1 text-sm text-slate-900">{r.name}</span>
                                  {r.vendorLike && <VendorChip />}
                                </label>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </section>

                    {/* ── Will be linked: informational, never tickable ───────── */}
                    {adoptRows.length > 0 && (
                      <section>
                        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-700 tabular-nums">
                          Will be linked ({adoptRows.length})
                        </h3>
                        <p className="mb-1.5 text-[11px] text-slate-500">
                          These already exist here under the same name. They are matched by name and
                          will be linked automatically — no new rows, nothing renamed.
                        </p>
                        <ul className="space-y-1">
                          {adoptRows.map((r) => (
                            <li
                              key={r.zohoId}
                              className="flex min-h-[44px] items-center gap-2.5 rounded-lg border border-slate-200 bg-slate-50 p-2.5"
                            >
                              <Link2 className="h-4 w-4 shrink-0 text-slate-400" />
                              <span className="min-w-0 flex-1 text-sm text-slate-700">
                                {r.name}
                                {r.localName && r.localName !== r.name && (
                                  <span className="text-slate-400"> → {r.localName}</span>
                                )}
                              </span>
                              {r.vendorLike && <VendorChip />}
                            </li>
                          ))}
                        </ul>
                      </section>
                    )}

                    {/* ── Already linked: count only until asked ──────────────── */}
                    {linkedRows.length > 0 && (
                      <section>
                        <button
                          type="button"
                          onClick={() => setShowLinked((v) => !v)}
                          className="flex min-h-[44px] w-full items-center gap-1.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 tabular-nums"
                        >
                          {showLinked ? (
                            <ChevronDown className="h-3.5 w-3.5" />
                          ) : (
                            <ChevronRight className="h-3.5 w-3.5" />
                          )}
                          Already linked ({linkedRows.length})
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

              {/* Footer */}
              <div className="shrink-0 border-t border-slate-200 bg-white px-4 py-3">
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    className="min-h-[44px] flex-1"
                    onClick={close}
                    disabled={busy}
                  >
                    Cancel
                  </Button>
                  <Button
                    className="min-h-[44px] flex-1 bg-blue-600 hover:bg-blue-700"
                    onClick={() => void runImport()}
                    disabled={busy || step !== "selecting" || nothingToDo}
                  >
                    {step === "importing" ? (
                      <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                    ) : (
                      <Download className="mr-1.5 h-4 w-4" />
                    )}
                    Import {tickedNew + adoptRows.length}
                  </Button>
                </div>
                {step === "selecting" && !nothingToDo && adoptRows.length > 0 && (
                  <p className="mt-1.5 text-center text-[11px] text-slate-500 tabular-nums">
                    {tickedNew} to create · {adoptRows.length} to link
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* The outcome, in the same sheet both host screens already use for delete and merge. */}
      {result && (
        <ActionConfirmation
          open
          onClose={() => setResult(null)}
          type={result.errors.length > 0 ? "warning" : "success"}
          title={result.errors.length > 0 ? "Imported with warnings" : "Imported from Zoho"}
          referenceId={`${result.created + result.adopted} ${cfg.many}`}
          items={[
            { label: "Created", value: String(result.created) },
            { label: "Linked to existing", value: String(result.adopted) },
            { label: "Skipped", value: String(result.skipped) },
          ]}
          details={
            result.errors.length > 0
              ? `${result.errors.length} row${result.errors.length === 1 ? " was" : "s were"} skipped:`
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
                <li className="text-xs text-slate-500 tabular-nums">
                  …and {result.errors.length - 8} more
                </li>
              )}
            </ul>
          )}
        </ActionConfirmation>
      )}
    </>
  );
}

/**
 * A heuristic, shown rather than acted on. The server flags a row whose name matches a
 * Vendor or carries a company suffix; per owner decision D2 nothing is hidden and nothing is
 * auto-unticked, because a brand minted from a vendor name looks real everywhere afterwards.
 */
function VendorChip() {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
      <AlertTriangle className="h-3 w-3" />
      looks like a vendor
    </span>
  );
}
