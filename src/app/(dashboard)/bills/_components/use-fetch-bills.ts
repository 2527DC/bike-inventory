"use client";

// The Fetch Bills flow on /bills: init → bills → finalize → pull-review, then approve the
// ticked previews. Moved out of page.tsx (622 lines) for plan 1210 credit notes and payables.
//
// What changed while moving it:
//   - apiFetch / apiTry instead of `fetch(...).then(r => r.json())` (X12). An expired session or
//     a gateway's HTML page now reads as what it is, not "Unexpected token '<'".
//   - "These bills are for: <store>" (Part 2.2): sent as `storeId` with the approve. The import
//     uses it for bills whose Zoho location is not linked to a store; one store → picked for you.
//   - A preview the bills step marks `action: "existing"` (a bill already in /bills, Part 1.3) is
//     shown unticked — importing it only links it to Zoho.

import { useCallback, useState } from "react";
import { apiFetch, apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";
import type { StoreOption } from "./shared";

const log = createLogger("bills:fetch");

export interface ZohoBillPreview {
  id: string;
  zohoId: string;
  action?: string;
  entityType?: string;
  status?: string;
  data: {
    billNumber: string;
    vendorName: string;
    date: string;
    dueDate: string;
    total: number;
    balance: number;
    status: string;
    locationName?: string | null;
    lineItems?: Array<{ name: string; sku: string; quantity: number; rate: number; itemTotal: number }>;
  };
}

interface BillsStepResult {
  source?: string;
  billsNew?: number;
  apiCalls?: number;
  errors?: string[];
}

interface ApproveResult {
  bills?: number;
  errors?: string[];
}

export type FetchStep = "idle" | "pickDate" | "fetching" | "selecting" | "importing";

/** "" = not chosen yet; "none" = leave the store unset; otherwise a Store id. */
export type ImportStore = string;

const isExisting = (p: ZohoBillPreview) => p.action === "existing";

export function useFetchBills({ stores, onImported }: { stores: StoreOption[]; onImported: () => void }) {
  const [step, setStep] = useState<FetchStep>("idle");
  const [progress, setProgress] = useState("");
  const [previews, setPreviews] = useState<ZohoBillPreview[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pullId, setPullId] = useState("");
  const [search, setSearch] = useState("");
  const [days, setDays] = useState<number>(7);
  const [customFrom, setCustomFrom] = useState("");
  // CREATED in an earlier fix — this screen had only a From input, so a custom range always ran to today.
  const [customTo, setCustomTo] = useState("");
  const [importStoreChoice, setImportStore] = useState<ImportStore>("");
  // Until someone picks: one store → it is the answer. Never a hard-coded store code.
  const importStore: ImportStore = importStoreChoice !== "" ? importStoreChoice : stores.length === 1 ? stores[0].id : "";

  const run = useCallback(async () => {
    setStep("fetching");
    setError("");
    setNotice("");
    setProgress("Connecting to Zoho...");
    try {
      const init = await apiFetch<{ pullId: string }>("/api/zoho/trigger-pull", {
        method: "POST",
        json: { step: "init" },
        timeoutMs: 20_000,
      });
      const id = init.pullId;
      setPullId(id);

      const searchTerm = search.trim();
      // No local date arithmetic (root cause #5): the server resolves the window in IST.
      const windowBody = searchTerm
        ? { searchText: searchTerm }
        : days === -1
          ? { fromDate: customFrom || undefined, toDate: customTo || undefined }
          : { days };

      const label = searchTerm ? `"${searchTerm}"` : days === -1 ? "custom range" : `last ${days} days`;
      setProgress(searchTerm ? `Searching ${label} in Zoho...` : `Pulling bills (${label})...`);
      const billRes = await apiFetch<BillsStepResult>("/api/zoho/trigger-pull", {
        method: "POST",
        json: { step: "bills", pullId: id, ...windowBody },
        timeoutMs: 60_000,
      });

      const src = billRes.source === "inventory" ? "Zoho Inventory" : billRes.source === "pos" ? "Zakya" : "Zoho Books";
      const billsFound = billRes.billsNew || 0;
      setProgress(`Found ${billsFound} new bills from ${src}, saving...`);

      // Finalize only writes the pull log; a failure is worth a warning, not a stop.
      const fin = await apiTry("/api/zoho/trigger-pull", {
        method: "POST",
        json: {
          step: "finalize",
          pullId: id,
          billsNew: billRes.billsNew,
          apiCalls: billRes.apiCalls,
          allErrors: billRes.errors || [],
        },
        timeoutMs: 20_000,
      });
      if (fin.error) log.warn("finalize failed", { pullId: id, error: fin.error });

      setProgress("Loading preview...");
      const review = await apiFetch<{ previews?: ZohoBillPreview[] }>(
        `/api/zoho/pull-review?pullId=${encodeURIComponent(id)}`,
        { timeoutMs: 20_000 }
      );
      const items = (review.previews || []).filter((p) => p.entityType === "bill" && p.status === "PENDING");
      setPreviews(items);
      // New bills ticked; ones already in /bills left for a person to tick.
      setSelected(new Set(items.filter((p) => !isExisting(p)).map((p) => p.id)));
      setStep(items.length > 0 ? "selecting" : "idle");

      const billErrors = billRes.errors || [];
      if (items.length === 0) {
        const detail = billErrors.length > 0 ? `: ${billErrors.join("; ")}` : "";
        const debug = billsFound > 0 ? ` (${billsFound} found from API but 0 in preview — check finalize)` : "";
        setError(`No new bills found (${src})${detail}${debug}`);
      } else if (billErrors.length > 0) {
        setError(`Warnings: ${billErrors.join("; ")}`);
      }
      log.info("bills fetched for review", { pullId: id, previews: items.length, source: billRes.source });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Fetch failed";
      log.warn("fetch bills failed", { error: message });
      setError(message);
      setStep("idle");
    } finally {
      setProgress("");
    }
  }, [search, days, customFrom, customTo]);

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const importSelected = useCallback(async () => {
    if (selected.size === 0 || importStore === "") return;
    setStep("importing");
    setError("");
    try {
      const res = await apiFetch<ApproveResult>("/api/zoho/pull-review/approve", {
        method: "POST",
        json: {
          pullId,
          action: "approve",
          entityType: "bill",
          previewIds: Array.from(selected),
          source: "accounting",
          ...(importStore !== "none" && { storeId: importStore }),
        },
        // Approve reads each bill's detail from Zoho; a large batch can take a while.
        timeoutMs: 180_000,
      });
      const imported = res?.bills || 0;
      const errors = res?.errors || [];
      setStep("idle");
      setPreviews([]);
      setSelected(new Set());
      onImported();
      log.info("bills imported", { pullId, imported, warnings: errors.length });
      if (errors.length > 0) setError(`Imported ${imported} bill(s). Warnings: ${errors.join("; ")}`);
      else setNotice(`Imported ${imported} bill${imported === 1 ? "" : "s"}.`);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Import failed";
      log.warn("bill import failed", { pullId, error: message });
      setError(message);
      setStep("selecting");
    }
  }, [selected, importStore, pullId, onImported]);

  const cancel = useCallback(() => {
    setStep("idle");
    setPreviews([]);
    setSelected(new Set());
  }, []);

  return {
    step,
    setStep,
    progress,
    previews,
    selected,
    toggle,
    error,
    clearError: () => setError(""),
    notice,
    clearNotice: () => setNotice(""),
    search,
    setSearch,
    days,
    setDays,
    customFrom,
    setCustomFrom,
    customTo,
    setCustomTo,
    importStore,
    setImportStore,
    run,
    importSelected,
    cancel,
    isExisting,
  };
}

export type FetchBillsState = ReturnType<typeof useFetchBills>;
