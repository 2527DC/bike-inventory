"use client";

import { useState, useCallback } from "react";
import { apiFetch, apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";
import { Cloud, Download, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { ZohoFetchPanel, type FetchMode } from "./zoho-fetch-panel";
import { ZohoImportResults, type ImportableInvoice } from "./zoho-import-results";

const log = createLogger("deliveries:zoho-import");

// ─── Zoho types (from original page) ───

interface ZohoSearchResult {
  invoiceId: string;
  invoiceNumber: string;
  customerName: string;
  phone: string;
  date: string;
  total: number;
  balance: number;
  status: string;
  alreadyImported: boolean;
  appStatus: string | null;
}

interface ZohoInvoicePreview {
  id: string;
  zohoId: string;
  data: {
    invoiceNumber: string;
    customerName: string;
    phone: string;
    date: string;
    total: number;
    balance: number;
    status: string;
    salesPerson: string;
    lineItems: Array<{
      name: string;
      sku: string;
      quantity: number;
      rate: number;
      itemTotal: number;
    }>;
  };
}

interface ZohoImportFlowProps {
  canFetch: boolean;
  /**
   * zoho.approve. Importing WRITES Delivery rows, so it is a separate grant from fetching —
   * and this prop is new: the component had no import gate at all, only the fetch one, so
   * anyone who could open the panel could also import. Cosmetic, as always: the route
   * re-checks (CLAUDE.md).
   */
  canImport: boolean;
  onImported: () => void;
}

export function ZohoImportFlow({ canFetch, canImport, onImported }: ZohoImportFlowProps) {
  // Was `sheetOpen` + a two-tab bar. The panel is inline now (R1) and the tabs became one
  // segmented toggle, so a single set of banners and result cards serves both modes — the
  // tabs each owned their own copy, which is how a message could sit on the tab you were
  // not looking at.
  const [panelOpen, setPanelOpen] = useState(false);
  const [mode, setMode] = useState<FetchMode>("fetch");

  // ─── Quick Search state ───
  const [invoiceSearch, setInvoiceSearch] = useState("");
  const [searchStep, setSearchStep] = useState<"idle" | "searching" | "results" | "importing">("idle");
  const [searchResults, setSearchResults] = useState<ZohoSearchResult[]>([]);
  const [selectedResults, setSelectedResults] = useState<Set<string>>(new Set());
  const [searchError, setSearchError] = useState("");
  const [searchProgress, setSearchProgress] = useState("");

  // ─── Bulk Fetch state ───
  const [fetchStep, setFetchStep] = useState<"idle" | "fetching" | "results" | "importing">("idle");
  const [invoicePreviews, setInvoicePreviews] = useState<ZohoInvoicePreview[]>([]);
  const [selectedInvoices, setSelectedInvoices] = useState<Set<string>>(new Set());
  const [fetchError, setFetchError] = useState("");
  const [fetchPullId, setFetchPullId] = useState("");
  const [fetchProgress, setFetchProgress] = useState("");
  const [fetchDays, setFetchDays] = useState<number>(7);
  const [fetchCustomFrom, setFetchCustomFrom] = useState("");
  const [fetchCustomTo, setFetchCustomTo] = useState("");
  // Persistent summary of the last fetch — "12 found in Zoho (2 – 4 Sep) · 9 already
  // imported · 1 void · 2 BCC". Survives the result card so the counts stay readable after
  // an import, which is when people actually ask "where did the rest go?".
  const [fetchSummary, setFetchSummary] = useState("");
  const [fetchNotice, setFetchNotice] = useState("");

  // ONE progress string and ONE busy flag for both modes. The old render had four separate
  // near-identical strips.
  const progress = searchProgress || fetchProgress;
  const isBusy =
    searchStep === "searching" || searchStep === "importing" ||
    fetchStep === "fetching" || fetchStep === "importing";

  // ─── Quick Search handlers ───
  const handleQuickSearch = useCallback(async () => {
    const q = invoiceSearch.trim();
    if (!q || q.length < 3) {
      setSearchError("Enter at least 3 characters");
      return;
    }

    setSearchStep("searching");
    setSearchError("");
    setSearchProgress(`Searching Zoho for "${q}"...`);
    try {
      // apiFetch replaces a hand-rolled HTML guard (`text.startsWith("{")`) that could not
      // tell an expired session from a server error — the exact failure api-client exists for.
      const data = await apiFetch<{ results: ZohoSearchResult[] }>("/api/deliveries/search-zoho", {
        method: "POST",
        json: { query: q },
        timeoutMs: 30_000,
      });

      const results: ZohoSearchResult[] = data.results || [];
      setSearchResults(results);

      const newOnes = results.filter((r) => !r.alreadyImported);
      setSelectedResults(new Set(newOnes.map((r) => r.invoiceId)));
      setSearchStep(results.length > 0 ? "results" : "idle");

      if (results.length === 0) {
        setSearchError(`No invoices found for "${q}"`);
      } else if (newOnes.length === 0) {
        setSearchError(
          `Found ${results.length} invoice(s) -- all already imported`
        );
        setSearchStep("results");
      }
    } catch (e) {
      setSearchError(e instanceof Error ? e.message : "Search failed");
      setSearchStep("idle");
    } finally {
      setSearchProgress("");
    }
  }, [invoiceSearch]);

  const handleImportSearchResults = useCallback(async () => {
    if (selectedResults.size === 0) return;
    setSearchStep("importing");
    setSearchError("");
    setSearchProgress(`Importing ${selectedResults.size} invoice(s)...`);
    try {
      const data = await apiFetch<{ imported: number; errors: string[] }>(
        "/api/deliveries/import-zoho",
        {
          method: "POST",
          json: { invoiceIds: Array.from(selectedResults) },
          timeoutMs: 60_000,
        }
      );

      const { imported, errors } = data;
      setSearchStep("idle");
      setSearchResults([]);
      setSelectedResults(new Set());
      setInvoiceSearch("");

      if (errors && errors.length > 0) {
        setSearchError(`Imported ${imported}. Issues: ${errors.join(", ")}`);
      }
      setPanelOpen(false);
      onImported();
    } catch (e) {
      setSearchError(e instanceof Error ? e.message : "Import failed");
      setSearchStep("results");
    } finally {
      setSearchProgress("");
    }
  }, [selectedResults, onImported]);

  // ─── Bulk Fetch handlers ───
  const handleFetchInvoices = useCallback(async () => {
    setFetchStep("fetching");
    setFetchError("");
    setFetchSummary("");
    setFetchNotice("");
    setFetchProgress("Connecting to Zoho…");
    try {
      // apiFetch, not raw fetch (CLAUDE.md). The old form threw
      // `Connection failed (${status})` — a bare number — for every refusal, including the
      // 409 whose body now carries a sentence the user can act on ("Zoho is not connected —
      // connect it on Settings › Integrations"). apiFetch surfaces that message.
      const initData = await apiFetch<{ pullId: string }>("/api/zoho/trigger-pull", {
        method: "POST",
        json: { step: "init" },
        timeoutMs: 20_000,
      });
      const pullId = initData.pullId;
      setFetchPullId(pullId);

      // THE DATE ARITHMETIC IS GONE (root cause #5).
      //
      // This used to build `fromDate` here: `new Date()`, subtract N days, then
      // `.toISOString().slice(0,10)`. The browser is at IST (+5:30), so before 05:30
      // `toISOString()` has already rolled back to yesterday — "3 days" on 3 Sep at 02:00
      // asked Zoho for 30 Aug–2 Sep, an extra day at the front and TODAY'S invoices missing.
      // It also never sent a To date, so `fetchCustomTo` was collected and thrown away.
      //
      // The server resolves the window now, once, in IST, and tells us what it used.
      const windowBody =
        fetchDays === -1
          ? { fromDate: fetchCustomFrom || undefined, toDate: fetchCustomTo || undefined }
          : { days: fetchDays };

      setFetchProgress(
        fetchDays === -1 ? "Pulling invoices (custom range)…" : `Pulling invoices (last ${fetchDays} days)…`
      );
      const invData = await apiFetch<{
        invoicesNew: number;
        apiCalls: number;
        errors: string[];
        window: { from: string; to: string; clampedToFy: boolean } | null;
        fetched: number;
        skipped: { counts: { alreadyImported: number; void?: number; byStore?: Record<string, number> } };
      }>("/api/zoho/trigger-pull", {
        method: "POST",
        json: { step: "invoices", pullId, ...windowBody },
        timeoutMs: 60_000,
      });

      const invFound = invData.invoicesNew || 0;
      const w = invData.window;
      // The label comes from the SERVER's window, not from what we asked for — so what the
      // user reads is what Zoho was actually queried with.
      const rangeLabel = w ? `${w.from} – ${w.to}` : "search";
      const counts = invData.skipped?.counts ?? { alreadyImported: 0 };
      const parts = [`${invData.fetched ?? 0} found in Zoho (${rangeLabel})`];
      if (counts.alreadyImported) parts.push(`${counts.alreadyImported} already imported`);
      if (counts.void) parts.push(`${counts.void} void`);
      for (const [code, n] of Object.entries(counts.byStore ?? {})) {
        if (code !== "unmatchedPrefix") parts.push(`${n} ${code}`);
      }
      if (counts.byStore?.unmatchedPrefix) {
        parts.push(`${counts.byStore.unmatchedPrefix} with no store prefix`);
      }
      setFetchSummary(parts.join(" · "));
      if (w?.clampedToFy) {
        setFetchNotice(`Start date moved to ${w.from} — the financial year does not go back further.`);
      }

      setFetchProgress(`Found ${invFound} invoice${invFound !== 1 ? "s" : ""}. Finalizing…`);
      // Deliberately not awaited into the failure path: finalize only closes the SyncLog row,
      // and the invoices are already staged. A finalize failure is logged, not surfaced.
      await apiTry("/api/zoho/trigger-pull", {
        method: "POST",
        json: {
          step: "finalize",
          pullId,
          invoicesNew: invData.invoicesNew,
          apiCalls: invData.apiCalls,
          allErrors: invData.errors || [],
        },
        timeoutMs: 20_000,
      }).then((r) => {
        if (r.error) log.warn("finalize failed", { pullId, error: r.error });
      });

      setFetchProgress("Loading preview…");
      // EVERY branch sets state now (root cause #3). This was
      // `if (previewRes.success) { … }` with NO else — on a failure the component stayed in
      // "fetching" forever: spinner gone, button disabled, nothing said.
      const previewData = await apiFetch<{ previews: Array<ZohoInvoicePreview & { entityType: string; status: string }> }>(
        `/api/zoho/pull-review?pullId=${pullId}`,
        { timeoutMs: 20_000 }
      );
      const invoices = (previewData.previews || []).filter(
        (p) => p.entityType === "invoice" && p.status === "PENDING"
      );
      setInvoicePreviews(invoices);
      setSelectedInvoices(new Set(invoices.map((inv) => inv.id)));
      setFetchStep(invoices.length > 0 ? "results" : "idle");
      if (invoices.length === 0) {
        setFetchError(
          counts.alreadyImported > 0
            ? `${invData.fetched} invoice${invData.fetched === 1 ? "" : "s"} dated ${rangeLabel}, all already imported.`
            : `Zoho has no invoices dated ${rangeLabel}.`
        );
      }
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : "Fetch failed");
      setFetchStep("idle");
    } finally {
      setFetchProgress("");
    }
  }, [fetchDays, fetchCustomFrom, fetchCustomTo]);

  const handleImportSelected = useCallback(async () => {
    if (selectedInvoices.size === 0) return;
    setFetchStep("importing");
    setFetchError("");

    // IMPORT IN CHUNKS OF 25.
    //
    // The approve route fetches a Zoho invoice DETAIL per record inside a 60-second function.
    // A 120-invoice import therefore dies at maxDuration with a 504 and no body, and the user
    // learns nothing about how many got in. Chunking keeps every request comfortably inside
    // the budget and lets a mid-chunk failure report exactly where it stopped — with the
    // remaining rows STILL SELECTED, so Import can simply be pressed again.
    const CHUNK = 25;
    const ids = Array.from(selectedInvoices);
    const remaining = new Set(selectedInvoices);
    let done = 0;

    try {
      for (let i = 0; i < ids.length; i += CHUNK) {
        const slice = ids.slice(i, i + CHUNK);
        setFetchProgress(
          ids.length > CHUNK
            ? `Importing ${i + 1}–${Math.min(i + CHUNK, ids.length)} of ${ids.length}…`
            : `Importing ${ids.length} invoice${ids.length === 1 ? "" : "s"}…`
        );
        await apiFetch("/api/zoho/pull-review/approve", {
          method: "POST",
          json: {
            pullId: fetchPullId,
            action: "approve",
            entityType: "invoice",
            previewIds: slice,
          },
          timeoutMs: 60_000,
        });
        for (const id of slice) remaining.delete(id);
        done += slice.length;
      }

      setFetchStep("idle");
      setInvoicePreviews([]);
      setSelectedInvoices(new Set());
      setPanelOpen(false);
      onImported();
    } catch (e) {
      // Keep what has NOT been imported selected, so retrying does not re-import the rest.
      setSelectedInvoices(remaining);
      setFetchError(
        done > 0
          ? `Imported ${done} of ${ids.length}. ${e instanceof Error ? e.message : "Import failed"} — press Import again for the rest.`
          : e instanceof Error ? e.message : "Import failed"
      );
      setFetchStep("results");
      if (done > 0) onImported();
    } finally {
      setFetchProgress("");
    }
  }, [selectedInvoices, fetchPullId, onImported]);

  // Convert search results to ImportableInvoice format
  const searchImportable: ImportableInvoice[] = searchResults.map((r) => ({
    id: r.invoiceId,
    invoiceNumber: r.invoiceNumber,
    customerName: r.customerName,
    phone: r.phone,
    date: r.date,
    total: r.total,
    alreadyImported: r.alreadyImported,
    appStatus: r.appStatus,
  }));

  // Convert fetch previews to ImportableInvoice format
  const fetchImportable: ImportableInvoice[] = invoicePreviews.map((inv) => ({
    id: inv.id,
    invoiceNumber: inv.data.invoiceNumber,
    customerName: inv.data.customerName,
    phone: inv.data.phone,
    date: inv.data.date,
    total: inv.data.total,
    alreadyImported: false,
    lineItems: inv.data.lineItems.map((li) => ({
      name: li.name,
      quantity: li.quantity,
    })),
  }));

  const toggleSearchResult = (id: string) => {
    setSelectedResults((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleAllSearch = () => {
    const selectable = searchResults.filter((r) => !r.alreadyImported);
    const allSelected = selectable.every((r) =>
      selectedResults.has(r.invoiceId)
    );
    if (allSelected) {
      setSelectedResults(new Set());
    } else {
      setSelectedResults(new Set(selectable.map((r) => r.invoiceId)));
    }
  };

  const toggleFetchInvoice = (id: string) => {
    setSelectedInvoices((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleAllFetch = () => {
    const allSelected = invoicePreviews.every((inv) =>
      selectedInvoices.has(inv.id)
    );
    if (allSelected) {
      setSelectedInvoices(new Set());
    } else {
      setSelectedInvoices(new Set(invoicePreviews.map((inv) => inv.id)));
    }
  };
  // `panelOpen` replaces `sheetOpen`. Same idea, different consequence: this opens an inline
  // panel that pushes the list down instead of a modal that covers it, so the deliveries you
  // already have stay visible while you decide what to pull (R1).
  const openPanel = () => {
    setPanelOpen(true);
    setSearchError("");
    setFetchError("");
  };

  const closePanel = () => {
    // Never close mid-request: the panel is where progress and errors are reported, and
    // closing it would strand a running fetch with nowhere to say what happened.
    if (isBusy) return;
    setPanelOpen(false);
  };

  if (!canFetch) return null;

  return (
    <>
      {/* Trigger. Stays in the page header row; the panel below is a `w-full` flex item, so
          it wraps onto its own line under the header (hence the header's `flex-wrap`). */}
      {!panelOpen && (
        <button
          onClick={openPanel}
          disabled={isBusy}
          className="flex items-center gap-1 bg-slate-700 text-white px-3 min-h-[44px] rounded-lg text-xs font-medium disabled:opacity-50"
          title="Fetch deliveries from Zoho"
        >
          {isBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Cloud className="h-3.5 w-3.5" />}
          Fetch
        </button>
      )}

      {panelOpen && (
        <ZohoFetchPanel
          mode={mode}
          onModeChange={setMode}
          searchText={invoiceSearch}
          onSearchTextChange={setInvoiceSearch}
          onSearch={handleQuickSearch}
          searching={searchStep === "searching"}
          days={fetchDays}
          onDaysChange={setFetchDays}
          customFrom={fetchCustomFrom}
          onCustomFromChange={setFetchCustomFrom}
          customTo={fetchCustomTo}
          onCustomToChange={setFetchCustomTo}
          onFetch={handleFetchInvoices}
          fetching={fetchStep === "fetching"}
          onCancel={closePanel}
        />
      )}

      {/* ─── Progress ───
          ONE strip for both modes. There used to be four near-identical copies, two of them
          duplicated inside the modal's tabs, which is how a message could end up showing on
          the tab you were not looking at. */}
      {progress && (
        <div className="w-full flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-lg p-2.5 mt-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-600 shrink-0" />
          <span className="text-xs text-blue-700 font-medium">{progress}</span>
        </div>
      )}

      {/* ─── Errors ───
          One banner per mode, rendered at page level rather than once per tab. Retry re-runs
          the request that failed — the old banners only offered "dismiss". */}
      {searchError && (
        <div className="w-full bg-amber-50 border border-amber-200 rounded-lg p-2.5 mt-2 text-xs text-amber-700">
          {searchError}
          <button onClick={() => { setSearchError(""); handleQuickSearch(); }} className="ml-2 underline font-medium">
            retry
          </button>
          <button onClick={() => setSearchError("")} className="ml-2 underline">
            dismiss
          </button>
        </div>
      )}

      {fetchError && (
        <div className="w-full bg-amber-50 border border-amber-200 rounded-lg p-2.5 mt-2 text-xs text-amber-700">
          {fetchError}
          <button onClick={() => { setFetchError(""); handleFetchInvoices(); }} className="ml-2 underline font-medium">
            retry
          </button>
          <button onClick={() => setFetchError("")} className="ml-2 underline">
            dismiss
          </button>
        </div>
      )}

      {/* Where the invoices that are NOT in the result card went. Without this, a fetch that
          finds 12 and shows 3 looks broken; the other 9 were already imported. */}
      {fetchSummary && (
        <div className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 mt-2 text-[11px] text-slate-600">
          {fetchSummary}
        </div>
      )}

      {fetchNotice && (
        <div className="w-full bg-blue-50 border border-blue-200 rounded-lg p-2.5 mt-2 text-[11px] text-blue-700">
          {fetchNotice}
        </div>
      )}

      {/* ─── Results ─── */}
      {searchStep === "results" && searchImportable.length > 0 && (
        <Card className="w-full border-blue-200 bg-blue-50/50 mt-2">
          <CardContent className="p-3">
            <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
              <p className="text-xs font-semibold text-blue-800">
                {searchImportable.length} invoice{searchImportable.length !== 1 ? "s" : ""} found in Zoho
              </p>
              {canImport && selectedResults.size > 0 && (
                <button
                  onClick={handleImportSearchResults}
                  className="flex items-center gap-1 bg-blue-600 text-white px-3 min-h-[36px] rounded-md text-xs font-medium"
                >
                  <Download className="h-3 w-3" /> Import {selectedResults.size}
                </button>
              )}
            </div>
            <ZohoImportResults
              results={searchImportable}
              selected={selectedResults}
              onToggle={toggleSearchResult}
              onSelectAll={toggleAllSearch}
            />
          </CardContent>
        </Card>
      )}

      {fetchStep === "results" && fetchImportable.length > 0 && (
        <Card className="w-full border-blue-200 bg-blue-50/50 mt-2">
          <CardContent className="p-3">
            <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
              <p className="text-xs font-semibold text-blue-800">
                {fetchImportable.length} new invoice{fetchImportable.length !== 1 ? "s" : ""} from Zoho
              </p>
              {canImport && (
                <button
                  onClick={handleImportSelected}
                  disabled={selectedInvoices.size === 0}
                  className="flex items-center gap-1 bg-blue-600 text-white px-3 min-h-[36px] rounded-md text-xs font-medium disabled:opacity-50"
                >
                  <Download className="h-3 w-3" /> Import {selectedInvoices.size}
                </button>
              )}
            </div>
            <ZohoImportResults
              results={fetchImportable}
              selected={selectedInvoices}
              onToggle={toggleFetchInvoice}
              onSelectAll={toggleAllFetch}
            />
          </CardContent>
        </Card>
      )}
    </>
  );
}
