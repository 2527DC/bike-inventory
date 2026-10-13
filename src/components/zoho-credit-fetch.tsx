"use client";

// ─── Fetch credit notes from Zoho Books ──────────────────────────────────────────────────────
//
// ONE component, two kinds (plan 1210 credit notes, Parts 3.5 and 8.3):
//   kind="vendorcredit"  supplier credit notes → VendorCredit       (mounted on /bills)
//   kind="creditnote"    customer credit notes → CustomerCreditNote (mounted on /receivables)
//
// Same pull → preview → approve flow as Fetch Bills, run in this order, one click each:
//   init → vendorcredits | creditnotes → finalize → pull-review → (person ticks) → approve
//
// The window means "changed in Zoho since", not "dated between": a credit created OR changed in
// the window is caught, including an old credit applied to a bill this week. Credit notes are
// entered in Zoho; nothing here creates one (D3). No timer, no polling — a person presses Fetch.

import { useState } from "react";
import { Cloud, Download, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SkeletonList } from "@/components/ui/skeleton";
import { ErrorBanner } from "@/components/ui/error-banner";
import { usePermissions } from "@/lib/use-permissions";
import { apiFetch, apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";

const log = createLogger("zoho:credit-fetch");

type Kind = "vendorcredit" | "creditnote";

const CONFIG: Record<
  Kind,
  { step: "vendorcredits" | "creditnotes"; countKey: "vendorCreditsNew" | "creditNotesNew"; title: string; party: string }
> = {
  vendorcredit: {
    step: "vendorcredits",
    countKey: "vendorCreditsNew",
    title: "Supplier credit notes from Zoho",
    party: "Supplier",
  },
  creditnote: {
    step: "creditnotes",
    countKey: "creditNotesNew",
    title: "Customer credit notes from Zoho",
    party: "Customer",
  },
};

/** The window chips. "This financial year" asks for 400 days; the server clamps it to 1 April. */
const WINDOWS: Array<{ key: string; label: string; days?: number }> = [
  { key: "3", label: "3 days", days: 3 },
  { key: "7", label: "7 days", days: 7 },
  { key: "14", label: "14 days", days: 14 },
  { key: "30", label: "30 days", days: 30 },
  { key: "fy", label: "This financial year", days: 400 },
  { key: "custom", label: "Custom" },
];

/** A preview row as GET /api/zoho/pull-review returns it. */
interface CreditPreview {
  id: string;
  zohoId: string;
  entityType: string;
  status: string;
  /** new | update | void — set by the fetch step. */
  action: string;
  data: {
    creditNumber?: string;
    creditNoteNumber?: string;
    referenceNumber?: string | null;
    vendorName?: string;
    customerName?: string;
    date?: string;
    total?: number;
    balance?: number;
    status?: string;
  };
}

/** The credit step's answer (api/zoho/trigger-pull, step vendorcredits | creditnotes). */
interface StepResult {
  fetched: number;
  found: number;
  counts: { new: number; updated: number; voided: number };
  skipped: { counts: { alreadyImported: number; draft: number; void: number } };
  window: { from: string; to: string; clampedToFy: boolean; mode: string } | null;
  apiCalls: number;
  errors: string[];
}

/** The approve route's answer, the fields this screen reads. */
interface ApproveResult {
  vendorCredits?: number;
  creditNotes?: number;
  skipped?: number;
  errors?: string[];
  notices?: string[];
}

interface ImportOutcome {
  imported: number;
  skipped: number;
  errors: string[];
  notices: string[];
}

type Step = "idle" | "pick" | "fetching" | "selecting" | "importing" | "done";

/** Approve this many at a time: each note is one Zoho read and one transaction. */
const CHUNK = 20;

export interface ZohoCreditFetchProps {
  kind: Kind;
  /** Called after an import wrote something, so the host can reload its list. */
  onImported?: () => void;
  /** Open the sheet on mount (e.g. `/bills?fetch=credits`). It only opens it — nothing is fetched. */
  defaultOpen?: boolean;
  className?: string;
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(amount);
}

function formatDate(value?: string) {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export function ZohoCreditFetch({ kind, onImported, defaultOpen, className }: ZohoCreditFetchProps) {
  const cfg = CONFIG[kind];
  const { canFetch, canApprove, loading: permsLoading } = usePermissions();

  const [step, setStep] = useState<Step>(defaultOpen ? "pick" : "idle");
  const [windowKey, setWindowKey] = useState("30");
  const [customFrom, setCustomFrom] = useState("");
  const [search, setSearch] = useState("");
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pullId, setPullId] = useState("");
  const [summary, setSummary] = useState<StepResult | null>(null);
  const [rows, setRows] = useState<CreditPreview[]>([]);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null);

  // Cosmetic only — trigger-pull re-checks zoho.fetch and approve re-checks zoho.approve.
  if (permsLoading || !canFetch("zoho")) return null;
  const mayImport = canApprove("zoho");

  const busy = step === "fetching" || step === "importing";
  const open = step !== "idle";
  const tickedCount = rows.filter((r) => ticked.has(r.id)).length;

  function close() {
    if (busy) return;
    setStep("idle");
    setError(null);
    setRows([]);
    setTicked(new Set());
    setSummary(null);
    setOutcome(null);
    setProgress("");
  }

  function fail(where: string, message: string) {
    // The API's own sentence goes to the screen — including Zoho's missing credit-note permission.
    log.warn(`${where} failed`, { kind, pullId: pullId || undefined, message });
    setError(message);
  }

  async function runFetch() {
    const term = search.trim();
    const choice = WINDOWS.find((w) => w.key === windowKey);
    // No local date arithmetic: the server resolves the window in IST and reports what it used.
    const windowBody: Record<string, unknown> = term
      ? { searchText: term }
      : windowKey === "custom"
        ? { fromDate: customFrom || undefined }
        : { days: choice?.days ?? 30 };

    setStep("fetching");
    setError(null);
    setRows([]);
    setTicked(new Set());
    setSummary(null);
    setOutcome(null);
    setProgress("Connecting to Zoho…");

    const init = await apiTry<{ pullId: string }>("/api/zoho/trigger-pull", {
      method: "POST",
      json: { step: "init" },
      timeoutMs: 20_000,
    });
    if (init.error || !init.data) {
      fail("init", init.error ?? "Zoho did not start a pull.");
      setStep("pick");
      return;
    }
    const id = init.data.pullId;
    setPullId(id);

    setProgress(term ? `Searching Zoho for "${term}"…` : "Reading credit notes from Zoho Books…");
    const res = await apiTry<StepResult>("/api/zoho/trigger-pull", {
      method: "POST",
      json: { step: cfg.step, pullId: id, ...windowBody },
      timeoutMs: 60_000,
    });
    if (res.error || !res.data) {
      fail(cfg.step, res.error ?? "Zoho returned nothing.");
      setStep("pick");
      return;
    }
    const found = res.data;

    setProgress("Saving the pull…");
    const fin = await apiTry("/api/zoho/trigger-pull", {
      method: "POST",
      json: {
        step: "finalize",
        pullId: id,
        [cfg.countKey]: found.found,
        apiCalls: found.apiCalls,
        allErrors: found.errors ?? [],
      },
      timeoutMs: 20_000,
    });
    // Not fatal: approve creates the pull log itself when finalize did not.
    if (fin.error) log.warn("finalize failed", { kind, pullId: id, message: fin.error });

    setProgress("Loading what changed…");
    const review = await apiTry<{ previews: CreditPreview[] }>(
      `/api/zoho/pull-review?pullId=${encodeURIComponent(id)}`,
      { timeoutMs: 20_000 },
    );
    if (review.error || !review.data) {
      fail("pull-review", review.error ?? "Could not load the preview.");
      setStep("pick");
      return;
    }
    const pending = (review.data.previews ?? []).filter((p) => p.entityType === kind && p.status === "PENDING");
    log.info("credit fetch loaded", {
      kind, pullId: id, fetched: found.fetched, previews: pending.length, ...found.counts,
    });
    setSummary(found);
    setRows(pending);
    // All ticked (Part 3.5): every row is something that changed in Zoho.
    setTicked(new Set(pending.map((p) => p.id)));
    setProgress("");
    setStep("selecting");
  }

  async function runImport() {
    const ids = rows.filter((r) => ticked.has(r.id)).map((r) => r.id);
    if (ids.length === 0 || !pullId) return;
    setStep("importing");
    setError(null);

    const acc: ImportOutcome = { imported: 0, skipped: 0, errors: [], notices: [] };
    const done = new Set<string>();
    try {
      for (let i = 0; i < ids.length; i += CHUNK) {
        const slice = ids.slice(i, i + CHUNK);
        setProgress(
          ids.length > CHUNK
            ? `Importing ${i + 1}–${Math.min(i + CHUNK, ids.length)} of ${ids.length}…`
            : `Importing ${ids.length} credit note${ids.length === 1 ? "" : "s"}…`,
        );
        const r = await apiFetch<ApproveResult>("/api/zoho/pull-review/approve", {
          method: "POST",
          json: { pullId, action: "approve", entityType: kind, previewIds: slice },
          timeoutMs: 60_000,
        });
        acc.imported += (kind === "vendorcredit" ? r.vendorCredits : r.creditNotes) ?? 0;
        acc.skipped += r.skipped ?? 0;
        acc.errors.push(...(r.errors ?? []));
        acc.notices.push(...(r.notices ?? []));
        for (const s of slice) done.add(s);
      }
      log.info("credit import finished", {
        kind, pullId, imported: acc.imported, skipped: acc.skipped, errors: acc.errors.length, notices: acc.notices.length,
      });
      setOutcome(acc);
      setProgress("");
      setStep("done");
      if (acc.imported > 0) onImported?.();
    } catch (e) {
      const message = e instanceof Error ? e.message : "Import failed";
      fail("import", done.size > 0 ? `${done.size} imported, then: ${message}` : message);
      // Keep only what did not go in, so pressing Import again cannot repeat a chunk.
      setRows((prev) => prev.filter((r) => !done.has(r.id)));
      setProgress("");
      setStep("selecting");
      if (done.size > 0) onImported?.();
    }
  }

  function toggle(id: string) {
    setTicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const windowLabel = summary?.window
    ? summary.window.mode === "search"
      ? `matching "${search.trim()}"`
      : `changed since ${formatDate(summary.window.from)}`
    : search.trim()
      ? `matching "${search.trim()}"`
      : "";

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        aria-label="Fetch credit notes"
        className={`min-h-[44px] shrink-0 whitespace-nowrap ${className ?? ""}`}
        onClick={() => setStep("pick")}
        disabled={busy}
      >
        {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Cloud className="mr-1 h-3.5 w-3.5" />}
        <span className="hidden sm:inline">Fetch&nbsp;</span>credit notes
      </Button>

      {open && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={cfg.title}>
          <button
            type="button"
            aria-label="Close"
            onClick={close}
            disabled={busy}
            className="absolute inset-0 bg-black/40 disabled:cursor-wait"
          />

          <div className="absolute bottom-0 left-0 right-0 flex justify-center">
            <div className="flex max-h-[85vh] w-full max-w-md flex-col rounded-t-2xl bg-white shadow-xl">
              {/* Header */}
              <div className="shrink-0 border-b border-slate-200 px-4 pb-3 pt-4">
                <h2 className="text-base font-semibold text-slate-900">{cfg.title}</h2>
                <p className="mt-0.5 text-xs text-slate-500 tabular-nums">
                  {step === "pick" && "Credit notes are entered in Zoho Books. Pick how far back to look for changes."}
                  {step === "fetching" && (progress || "Working…")}
                  {(step === "selecting" || step === "importing") && summary &&
                    `${summary.fetched} in Zoho ${windowLabel} · ${summary.counts.new} new · ${summary.counts.updated} changed · ${summary.counts.voided} void`}
                  {step === "done" && "Import finished"}
                </p>
              </div>

              {/* Body */}
              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
                {error && (
                  <ErrorBanner
                    message={error}
                    type={typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "error"}
                    onRetry={step === "pick" ? () => void runFetch() : undefined}
                    onDismiss={() => setError(null)}
                  />
                )}

                {step === "pick" && (
                  <div className="space-y-3">
                    <div>
                      <p className="mb-1.5 text-xs font-medium text-slate-700">Changed in Zoho within:</p>
                      <div className="flex flex-wrap gap-2">
                        {WINDOWS.map((w) => (
                          <button
                            key={w.key}
                            type="button"
                            onClick={() => setWindowKey(w.key)}
                            aria-pressed={windowKey === w.key}
                            className={`min-h-[44px] rounded-lg border px-3 text-xs font-medium transition-colors ${
                              windowKey === w.key
                                ? "border-slate-900 bg-slate-900 text-white"
                                : "border-slate-300 bg-white text-slate-600"
                            }`}
                          >
                            {w.label}
                          </button>
                        ))}
                      </div>
                      {windowKey === "fy" && (
                        <p className="mt-1.5 text-[11px] text-slate-500">
                          From 1 April. Use this the first time, so credits applied to older bills are counted.
                        </p>
                      )}
                    </div>
                    {windowKey === "custom" && (
                      <label className="block">
                        <span className="mb-0.5 block text-[11px] text-slate-500">Changed since</span>
                        <input
                          type="date"
                          value={customFrom}
                          onChange={(e) => setCustomFrom(e.target.value)}
                          className="min-h-[44px] w-full rounded-lg border border-slate-300 px-3 text-sm"
                        />
                      </label>
                    )}
                    <label className="block">
                      <span className="mb-0.5 block text-[11px] text-slate-500">
                        Or find one credit note by number (ignores the dates)
                      </span>
                      <input
                        type="text"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && void runFetch()}
                        placeholder="e.g. DN-00012"
                        className="min-h-[44px] w-full rounded-lg border border-slate-300 px-3 text-sm"
                      />
                    </label>
                  </div>
                )}

                {step === "fetching" && <SkeletonList count={4} type="card" />}

                {step === "selecting" && rows.length === 0 && summary && (
                  <div className="py-8 text-center">
                    <CheckCircle2 className="mx-auto mb-2 h-8 w-8 text-green-500" />
                    <p className="text-sm font-medium text-slate-700">Nothing to import</p>
                    <p className="mt-1 text-xs text-slate-500 tabular-nums">
                      {summary.fetched === 0
                        ? `Zoho has no credit notes ${windowLabel}.`
                        : [
                            summary.skipped.counts.alreadyImported > 0 && `${summary.skipped.counts.alreadyImported} already up to date`,
                            summary.skipped.counts.draft > 0 && `${summary.skipped.counts.draft} still draft in Zoho`,
                            summary.skipped.counts.void > 0 && `${summary.skipped.counts.void} void and never imported`,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                    </p>
                  </div>
                )}

                {(step === "selecting" || step === "importing") && rows.length > 0 && (
                  <div>
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-700 tabular-nums">
                        To import ({rows.length})
                      </p>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          setTicked(tickedCount === rows.length ? new Set() : new Set(rows.map((r) => r.id)))
                        }
                        className="min-h-[44px] px-1 text-xs font-medium text-blue-600 underline disabled:opacity-50"
                      >
                        {tickedCount === rows.length ? "Clear all" : "Select all"}
                      </button>
                    </div>
                    {summary && (summary.skipped.counts.alreadyImported > 0 || summary.skipped.counts.draft > 0) && (
                      <p className="mb-2 text-[11px] text-slate-500 tabular-nums">
                        Not shown: {summary.skipped.counts.alreadyImported} already up to date
                        {summary.skipped.counts.draft > 0 ? ` · ${summary.skipped.counts.draft} still draft in Zoho` : ""}
                      </p>
                    )}
                    <ul className="space-y-1.5">
                      {rows.map((r) => {
                        const on = ticked.has(r.id);
                        const number = r.data.creditNumber ?? r.data.creditNoteNumber ?? r.zohoId;
                        const party = r.data.vendorName ?? r.data.customerName ?? "";
                        return (
                          <li key={r.id}>
                            <label
                              className={`flex min-h-[44px] cursor-pointer items-start gap-2.5 rounded-lg border p-2.5 transition-colors ${
                                on ? "border-blue-300 bg-blue-50" : "border-slate-200 bg-white"
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={on}
                                disabled={busy}
                                onChange={() => toggle(r.id)}
                                className="mt-0.5 h-4 w-4 shrink-0 rounded"
                              />
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="flex min-w-0 items-center gap-1.5">
                                    <span className="truncate text-sm font-medium text-slate-900">{number}</span>
                                    <ActionBadge action={r.action} />
                                  </span>
                                  <span className="shrink-0 text-sm font-semibold text-slate-800 tabular-nums">
                                    {formatCurrency(Number(r.data.total) || 0)}
                                  </span>
                                </div>
                                <p className="truncate text-xs text-slate-600">
                                  {cfg.party}: {party || "—"}
                                </p>
                                <p className="text-[11px] text-slate-500 tabular-nums">
                                  {formatDate(r.data.date)} · Open {formatCurrency(Number(r.data.balance) || 0)}
                                  {r.data.referenceNumber ? ` · Ref ${r.data.referenceNumber}` : ""}
                                </p>
                              </div>
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}

                {step === "importing" && (
                  <div className="mt-3 flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3">
                    <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                    <span className="text-xs font-medium text-blue-700">{progress || "Importing…"} Do not close this.</span>
                  </div>
                )}

                {step === "done" && outcome && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <Stat label="Imported" value={outcome.imported} tone="text-green-600" />
                      <Stat label="Skipped" value={outcome.skipped} tone="text-slate-700" />
                      <Stat label="Failed" value={outcome.errors.length} tone={outcome.errors.length ? "text-red-600" : "text-slate-700"} />
                    </div>
                    {outcome.notices.length > 0 && (
                      <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5">
                        <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-amber-800">
                          <AlertTriangle className="h-3.5 w-3.5" /> Worth knowing
                        </p>
                        <ul className="space-y-1">
                          {outcome.notices.map((n, i) => (
                            <li key={i} className="text-xs text-amber-800">{n}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {outcome.errors.length > 0 && (
                      <div className="rounded-lg border border-red-200 bg-red-50 p-2.5">
                        <p className="mb-1 text-xs font-semibold text-red-700">Not imported — fetch again to retry</p>
                        <ul className="space-y-1">
                          {outcome.errors.map((m, i) => (
                            <li key={i} className="text-xs text-red-700">{m}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="shrink-0 border-t border-slate-200 bg-white px-4 py-3">
                {step === "pick" && (
                  <div className="flex gap-2">
                    <Button variant="outline" className="min-h-[44px] flex-1" onClick={close}>
                      Cancel
                    </Button>
                    <Button
                      className="min-h-[44px] flex-1"
                      onClick={() => void runFetch()}
                      disabled={!search.trim() && windowKey === "custom" && !customFrom}
                    >
                      <Cloud className="mr-1.5 h-4 w-4" /> Fetch
                    </Button>
                  </div>
                )}
                {step === "fetching" && (
                  <Button className="min-h-[44px] w-full" disabled>
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Fetching…
                  </Button>
                )}
                {(step === "selecting" || step === "importing") && (
                  <>
                    <div className="flex gap-2">
                      <Button variant="outline" className="min-h-[44px] flex-1" onClick={close} disabled={busy}>
                        {rows.length === 0 ? "Close" : "Cancel"}
                      </Button>
                      {rows.length > 0 && (
                        <Button
                          className="min-h-[44px] flex-1 bg-blue-600 hover:bg-blue-700"
                          onClick={() => void runImport()}
                          disabled={busy || tickedCount === 0 || !mayImport}
                        >
                          {step === "importing" ? (
                            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                          ) : (
                            <Download className="mr-1.5 h-4 w-4" />
                          )}
                          Import {tickedCount}
                        </Button>
                      )}
                    </div>
                    {!mayImport && rows.length > 0 && (
                      <p className="mt-1.5 text-center text-[11px] text-slate-500">
                        Importing needs the Zoho approve permission — ask someone who has it.
                      </p>
                    )}
                  </>
                )}
                {step === "done" && (
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

/** New / Updated / Void (Part 3.5). */
function ActionBadge({ action }: { action: string }) {
  if (action === "void") return <Badge variant="danger" className="shrink-0 text-[10px]">Void</Badge>;
  if (action === "update") return <Badge variant="warning" className="shrink-0 text-[10px]">Updated</Badge>;
  return <Badge variant="info" className="shrink-0 text-[10px]">New</Badge>;
}

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-lg border border-slate-200 p-2">
      <p className="text-[11px] text-slate-500">{label}</p>
      <p className={`text-xl font-bold tabular-nums ${tone}`}>{value}</p>
    </div>
  );
}
