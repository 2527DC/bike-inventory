"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, AlertTriangle, CheckCircle2, Download, Loader2 } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";
import type { ExtractionView, SheetLine } from "@/lib/po-extraction/types";
import {
  VendorSection,
  type Section,
  type POLineItem,
  type PoConflict,
  type VendorOption,
} from "./_components/vendor-section";
import { SheetImport } from "./_components/sheet-import";

const log = createLogger("purchase-orders:new");

/** sessionStorage key for the open sheet extraction, so a refresh reloads it (plan 0909, Q6 a). */
const EXTRACTION_KEY = "po-extraction-id";

interface PreparedItem {
  productId: string;
  sku: string;
  name: string;
  quantity: number;
  gstRate: number;
  costPrice?: number;
}

interface PreparedGroup {
  vendorId: string;
  vendorName: string;
  source: string;
  sourceLabel: string;
  items: PreparedItem[];
}

interface PrepareResponse {
  groups: PreparedGroup[];
  unresolved: Array<PreparedItem & { reason: string }>;
  missing: string[];
  canSeeCost: boolean;
}

const MANUAL_KEY = "manual";

/**
 * A /reorder handoff item → a line. This is the ONE path that still carries a productId: the
 * things ticked on /reorder are catalogue products by definition, and the order should stay
 * linked to them. The sheet flow never sets it (R3, D2).
 */
const toLine = (it: PreparedItem): POLineItem => ({
  key: it.productId,
  productId: it.productId,
  name: it.name,
  quantity: it.quantity,
  // ?? 0 leaves the rate box empty and required rather than inventing a price for somebody
  // who is not permitted to see cost.
  unitPrice: it.costPrice ?? 0,
  gstRate: it.gstRate,
});

const emptyManualSection = (): Section => ({
  key: MANUAL_KEY,
  vendorId: "",
  vendorName: null,
  sourceLabel: null,
  items: [],
  status: "idle",
  error: null,
  conflicts: null,
});

/** The duplicate rule keys on the normalised name; match the same way when removing lines. */
const normName = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Raise purchase orders.
 *
 * ─── ONE SCREEN, N ORDERS ────────────────────────────────────────────────────────────────
 *
 * A purchase order goes to one vendor. A person reordering does not think in vendors — they
 * tick what is low — so a selection routinely spans several, and this screen renders one
 * section per vendor rather than forcing the choice or silently picking one.
 *
 * Each section is a SEPARATE write that can fail on its own: the duplicate rule can refuse
 * vendor B seconds after vendor A's order was created. Nothing rolls back, and nothing should
 * — a real purchase order exists at that point. So "Create all" runs them in order, records an
 * outcome per vendor, and the screen STAYS PUT afterwards. Navigating away on success is what
 * would destroy the only report of what actually happened.
 *
 * ─── WHERE THE LINES COME FROM (plan 0909-po-sheet-ai-extraction, R3) ────────────────────
 *
 * The manual section takes its lines from the vendor's uploaded sheet and nowhere else. There
 * is no product search on this screen: a line is the item name the sheet said, with Qty, Unit
 * Price and GST % typed here. The only lines that carry a catalogue product are the ones
 * handed over from /reorder, which are products by definition.
 */
export default function NewPurchaseOrderPage() {
  const router = useRouter();
  const [vendors, setVendors] = useState<VendorOption[]>([]);
  const [expectedDate, setExpectedDate] = useState("");
  const [notes, setNotes] = useState("");
  const [sections, setSections] = useState<Section[]>([emptyManualSection()]);
  const [preparing, setPreparing] = useState(false);
  const [prepared, setPrepared] = useState<PrepareResponse | null>(null);
  const [runningAll, setRunningAll] = useState(false);
  const [pageError, setPageError] = useState("");

  // ─── the sheet import ─────────────────────────────────────────────────────────────────
  // The rows live on the server; the page holds the loaded view and its id goes into
  // sessionStorage so a refresh reloads it instead of paying for the AI read again.
  const [extraction, setExtraction] = useState<ExtractionView | null>(null);

  useEffect(() => {
    let id: string | null = null;
    try {
      id = sessionStorage.getItem(EXTRACTION_KEY);
    } catch (e) {
      log.warn("sessionStorage unavailable", { message: e instanceof Error ? e.message : String(e) });
      return;
    }
    if (!id) return;
    apiTry<ExtractionView>(`/api/purchase-orders/extract/${encodeURIComponent(id)}`).then(({ data, error, status }) => {
      if (data) {
        log.debug("extraction reloaded", { extractionId: data.id, stage: data.stage, items: data.items.length });
        setExtraction(data);
        // The upload belongs to one vendor (Q11); put the manual section back on it.
        setSections((prev) => prev.map((s) => (s.key === MANUAL_KEY && !s.vendorId ? { ...s, vendorId: data.vendorId } : s)));
        return;
      }
      // 404: it was consumed or discarded in another tab. Forget it rather than nag.
      if (status === 404) {
        try {
          sessionStorage.removeItem(EXTRACTION_KEY);
        } catch (e) {
          log.warn("could not clear the extraction id", { message: e instanceof Error ? e.message : String(e) });
        }
        return;
      }
      log.error("extraction reload failed", { extractionId: id, message: error });
      setPageError(error ?? "Could not reload the uploaded sheet. Upload it again.");
    });
  }, []);

  useEffect(() => {
    try {
      if (extraction) sessionStorage.setItem(EXTRACTION_KEY, extraction.id);
      else sessionStorage.removeItem(EXTRACTION_KEY);
    } catch (e) {
      log.warn("could not persist the extraction id", { message: e instanceof Error ? e.message : String(e) });
    }
  }, [extraction]);

  useEffect(() => {
    // limit=500 is what parseSearchParams clamps to; asking for more silently gets 500.
    apiTry<VendorOption[]>("/api/vendors?limit=500").then(({ data, error }) => {
      if (data) setVendors(data);
      else log.warn("vendor list unavailable", { message: error });
    });
  }, []);

  // ─── the handoff from /reorder ────────────────────────────────────────────────────────
  //
  // TWO SHAPES. v2 is `{ v: 2, items: [{ productId, quantity }] }`; v1 was a bare array that
  // also carried name, sku, unitPrice and brandName. Both are read, because a session that
  // began before this deploy can still hold a v1 payload.
  //
  // The key is removed FIRST, before anything can throw. The old consumer called `.map()` on
  // the parsed value, so a v2 object threw a TypeError, the `catch { /* ignore */ }` swallowed
  // it, and `removeItem` was never reached — leaving the key wedged so every later visit threw
  // again.
  useEffect(() => {
    const stored = sessionStorage.getItem("reorder-po-items");
    if (!stored) return;
    sessionStorage.removeItem("reorder-po-items");

    const productIds: string[] = [];
    const quantities: Record<string, number> = {};
    try {
      const parsed: unknown = JSON.parse(stored);
      const list = Array.isArray(parsed)
        ? (parsed as Array<{ productId?: string; quantity?: number }>)
        : ((parsed as { items?: Array<{ productId?: string; quantity?: number }> })?.items ?? []);
      for (const it of list) {
        if (!it?.productId) continue;
        productIds.push(it.productId);
        quantities[it.productId] = it.quantity ?? 1;
      }
    } catch (e) {
      log.error("could not read the reorder handoff", { message: e instanceof Error ? e.message : String(e) });
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPageError("Could not read the products carried over from Reorder. Add them here instead.");
      return;
    }

    if (productIds.length === 0) return;

    setPreparing(true);
    apiTry<PrepareResponse>("/api/purchase-orders/prepare", { method: "POST", json: { productIds, quantities } })
      .then(({ data, error }) => {
        if (!data) {
          setPageError(error ?? "Could not work out who supplies these products");
          return;
        }
        setPrepared(data);
        // One section per vendor, in the order the resolver returned them. The manual section
        // is dropped: this run came from a selection, and an empty extra card would read as a
        // sixth order somebody forgot to fill in.
        if (data.groups.length > 0) {
          setSections(
            data.groups.map((g) => ({
              key: g.vendorId,
              vendorId: g.vendorId,
              vendorName: g.vendorName,
              sourceLabel: g.sourceLabel,
              items: g.items.map(toLine),
              status: "idle" as const,
              error: null,
              conflicts: null,
            }))
          );
        }
      })
      .finally(() => setPreparing(false));
  }, []);

  const patch = useCallback((key: string, next: Partial<Section>) => {
    setSections((prev) => prev.map((s) => (s.key === key ? { ...s, ...next } : s)));
  }, []);

  /**
   * The ticked review rows become the manual section's lines (R8). Merged, not replaced: a
   * line already on the section keeps the qty and rate somebody typed, so a second "Use
   * selected" adds the newly ticked rows without undoing edits to the first batch. Deduped
   * on `key` — the extraction item id — so a row used twice is one line.
   */
  function useSelectedLines(lines: SheetLine[]) {
    const manual = sections.find((s) => s.key === MANUAL_KEY);
    if (!manual) return;
    const have = new Set(manual.items.map((i) => i.key));
    const seen = new Set<string>();
    const fresh: POLineItem[] = [];
    for (const l of lines) {
      if (have.has(l.key) || seen.has(l.key)) continue;
      seen.add(l.key);
      fresh.push({ key: l.key, name: l.name, quantity: l.quantity, unitPrice: l.unitPrice, gstRate: l.gstRate });
    }
    log.debug("selected rows used", { offered: lines.length, added: fresh.length, alreadyPresent: lines.length - fresh.length });
    patch(MANUAL_KEY, { items: [...manual.items, ...fresh] });
  }

  /** Create ONE vendor's order. Returns true when a purchase order now exists. */
  const submitSection = useCallback(
    async (key: string, submitForApproval: boolean): Promise<boolean> => {
      const s = sections.find((x) => x.key === key);
      if (!s || s.status === "created") return false;
      if (!s.vendorId || s.items.length === 0 || s.items.some((i) => !(i.unitPrice > 0))) return false;

      patch(key, { status: "running", error: null, conflicts: null });

      const { data, error, errorData, status } = await apiTry<{ id: string; poNumber: string; status: string }>(
        "/api/purchase-orders",
        {
          method: "POST",
          json: {
            vendorId: s.vendorId,
            expectedDate,
            notes,
            submit: submitForApproval,
            // The open extraction, if this order came out of one: the server deletes it (and
            // the uploaded file) once the PO exists — nothing from the upload outlives it (R9).
            ...(key === MANUAL_KEY && extraction && extraction.vendorId === s.vendorId ? { extractionId: extraction.id } : {}),
            // A line is a name plus what was typed. productId travels only on /reorder lines.
            items: s.items.map(({ name, quantity, unitPrice, gstRate, productId }) => ({
              name,
              quantity,
              unitPrice,
              gstRate,
              ...(productId ? { productId } : {}),
            })),
          },
        }
      );

      if (data) {
        patch(key, { status: "created", poId: data.id, poNumber: data.poNumber, error: null, conflicts: null });
        log.info("purchase order created", { vendorId: s.vendorId, poNumber: data.poNumber, lines: s.items.length });
        if (key === MANUAL_KEY && extraction) {
          log.debug("extraction consumed by purchase order", { extractionId: extraction.id, poNumber: data.poNumber });
          setExtraction(null);
        }
        return true;
      }

      // 409 carries the clashing purchase orders; 400 from the vendor check carries the
      // mismatched products. Both are refusals a person can act on, so neither is flattened
      // to a red sentence.
      if (status === 409 && errorData && typeof errorData === "object" && "conflicts" in errorData) {
        patch(key, { status: "failed", conflicts: (errorData as { conflicts: PoConflict[] }).conflicts, error: null });
        return false;
      }
      patch(key, { status: "failed", error: error ?? "Could not create this purchase order", conflicts: null });
      return false;
    },
    [sections, expectedDate, notes, patch, extraction]
  );

  /**
   * Create every outstanding section, one after another.
   *
   * SEQUENTIAL on purpose. Each create takes a per-vendor advisory lock and re-reads open
   * orders for that vendor; firing them together would serialise in the database anyway, and
   * a failure in the middle of a parallel run is much harder to report honestly.
   */
  async function createAll(submitForApproval: boolean) {
    setRunningAll(true);
    setPageError("");
    const pending = sections.filter((s) => s.status !== "created" && s.vendorId && s.items.length > 0);
    for (const s of pending) {
      await submitSection(s.key, submitForApproval);
    }
    setRunningAll(false);
  }

  /** Drop the lines the 409 named — by name for sheet lines, by product id for /reorder ones. */
  function removeConflictingLines(key: string) {
    const s = sections.find((x) => x.key === key);
    if (!s?.conflicts) return;
    const clashingNames = new Set(s.conflicts.flatMap((c) => c.names ?? c.productNames ?? []).map(normName));
    const clashingIds = new Set(s.conflicts.flatMap((c) => c.productIds ?? []));
    patch(key, {
      items: s.items.filter((i) => !clashingNames.has(normName(i.name)) && !(i.productId && clashingIds.has(i.productId))),
      conflicts: null,
      status: "idle",
    });
  }

  const creatable = sections.filter((s) => s.status !== "created" && s.vendorId && s.items.length > 0);
  const created = sections.filter((s) => s.status === "created");
  const anyBlocked = creatable.some((s) => s.items.some((i) => !(i.unitPrice > 0)));
  const allDone = sections.length > 0 && created.length === sections.filter((s) => s.items.length > 0).length;

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <Link href="/purchase-orders" className="p-2 -ml-2 rounded-lg hover:bg-slate-100 focus-ring" aria-label="Back">
          <ArrowLeft className="h-5 w-5 text-slate-600" />
        </Link>
        <h1 className="text-lg font-bold text-slate-900 truncate">
          {sections.length > 1 ? `New Purchase Orders (${sections.length})` : "New Purchase Order"}
        </h1>
      </div>

      {pageError && (
        <div className="bg-red-50 text-red-700 text-sm p-3 rounded-lg mb-4">{pageError}</div>
      )}

      {preparing && (
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 mb-4 text-sm text-slate-600 flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Working out who supplies these products…
        </div>
      )}

      {sections.length > 1 && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
          <p className="text-sm font-semibold text-blue-900">
            {sections.length} vendors, {sections.length} purchase orders
          </p>
          <p className="text-xs text-blue-700 mt-0.5">
            An order goes to one vendor, so these are created separately. Each one succeeds or
            fails on its own — nothing is undone if a later one is refused.
          </p>
        </div>
      )}

      {/* Carried-over products nobody supplies. Named rather than dropped: a shorter order
          than the one selected, with no explanation, is how stock quietly fails to arrive. */}
      {prepared && prepared.unresolved.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">
          <p className="text-sm font-semibold text-amber-900">
            {prepared.unresolved.length} product{prepared.unresolved.length === 1 ? " has" : "s have"} no vendor
          </p>
          <p className="text-xs text-amber-700 mt-0.5">
            Not included. Set a reorder vendor on them, or link the brand to a vendor on the
            vendor&apos;s page.
          </p>
          <ul className="mt-2 space-y-0.5">
            {prepared.unresolved.slice(0, 6).map((u) => (
              <li key={u.productId} className="text-xs text-amber-800 break-words">{u.sku} — {u.name}</li>
            ))}
            {prepared.unresolved.length > 6 && (
              <li className="text-xs text-amber-600">and {prepared.unresolved.length - 6} more</li>
            )}
          </ul>
        </div>
      )}

      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Expected Delivery</label>
            <Input type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} className="min-h-[44px]" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
            <Input
              placeholder="Any notes for these POs..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="min-h-[44px]"
            />
          </div>
        </div>
        {sections.length > 1 && (
          <p className="text-[11px] text-slate-400 -mt-2">
            The expected date and notes apply to every order below.
          </p>
        )}

        {sections.map((s) => (
          <VendorSection
            key={s.key}
            section={s}
            vendors={s.key === MANUAL_KEY ? vendors : undefined}
            onVendorChange={(vendorId) => patch(s.key, { vendorId, error: null, conflicts: null })}
            onItemsChange={(items) => patch(s.key, { items })}
            onSubmit={(forApproval) => void submitSection(s.key, forApproval)}
            onDismissConflicts={() => patch(s.key, { conflicts: null, status: "idle" })}
            onRemoveConflictingLines={() => removeConflictingLines(s.key)}
            busy={runningAll}
          >
            {/* The sheet upload belongs to the manual section only: a derived section's lines
                are what the /reorder resolver decided. It needs a vendor first (Q11): the file
                is that vendor's sheet, and the order is raised against them. */}
            {s.key === MANUAL_KEY && (
              <div className="space-y-2">
                <label className="block text-sm font-medium text-slate-700">
                  Items <span className="text-red-500">*</span>
                </label>
                {s.vendorId ? (
                  <SheetImport
                    vendorId={s.vendorId}
                    vendorName={vendors.find((v) => v.id === s.vendorId)?.name ?? null}
                    extraction={extraction}
                    onExtractionChange={setExtraction}
                    onUseSelected={useSelectedLines}
                    disabled={runningAll || s.status === "running"}
                  />
                ) : (
                  <p className="text-[11px] text-slate-500">Choose the vendor first, then upload their sheet.</p>
                )}
              </div>
            )}
          </VendorSection>
        ))}

        {/* The step people cannot guess (plan 0909, §5.4): the PDF is not sent from here. */}
        <p className="text-[11px] text-slate-500">
          After a purchase order is approved, its PDF is emailed to the vendor from the order&apos;s own page.
        </p>

        {/* One button for the whole run, only when there is more than one order to make. */}
        {creatable.length > 1 && (
          <div className="sticky bottom-2">
            <div className="rounded-xl border border-slate-200 bg-white shadow-lg p-3 space-y-2">
              {anyBlocked && (
                <p className="text-xs text-amber-600 text-center">
                  Some lines have no rate. Fill them in, or create the ready vendors one at a time.
                </p>
              )}
              <div className="flex flex-col sm:flex-row gap-2">
                <Button
                  type="button"
                  onClick={() => void createAll(true)}
                  disabled={runningAll || anyBlocked}
                  className="flex-1 min-h-[48px] bg-green-600 hover:bg-green-700 text-white"
                >
                  {runningAll ? <Loader2 className="h-4 w-4 animate-spin" /> : `Create all (${creatable.length})`}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void createAll(false)}
                  disabled={runningAll || anyBlocked}
                  className="flex-1 min-h-[48px]"
                >
                  Save all as drafts
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* The report. Shown instead of navigating away, because after a partial run this is
            the only record of which vendors got an order and which did not. */}
        {created.length > 0 && (
          <div className="rounded-xl border border-green-200 bg-green-50 p-3">
            <p className="text-sm font-semibold text-green-900 flex items-center gap-1.5">
              <CheckCircle2 className="h-4 w-4" />
              {created.length} purchase order{created.length === 1 ? "" : "s"} created
            </p>
            <ul className="mt-2 space-y-1.5">
              {created.map((s) => (
                <li key={s.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-green-800">
                  <span>
                    <span className="font-semibold tabular-nums">{s.poNumber}</span>
                    {" · "}{s.vendorName ?? vendors.find((v) => v.id === s.vendorId)?.name ?? "Vendor"}
                  </span>
                  {/* The PDF is one click away from the moment the order exists (R10, Q8 a);
                      the API serves any status under purchase_orders.view. */}
                  <a
                    href={`/api/purchase-orders/${s.poId}/pdf`}
                    download
                    className="inline-flex items-center gap-1 min-h-[44px] font-semibold underline"
                  >
                    <Download className="h-3.5 w-3.5" /> Download PDF
                  </a>
                  <Link href={`/purchase-orders/${s.poId}`} className="inline-flex items-center min-h-[44px] font-semibold underline">
                    Open
                  </Link>
                </li>
              ))}
            </ul>
            {sections.some((s) => s.status === "failed") && (
              <p className="mt-2 text-xs text-amber-800 flex items-start gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                Some vendors were not created. The orders above already exist and are not undone.
              </p>
            )}
            <Button
              type="button"
              variant="outline"
              onClick={() => router.push("/purchase-orders")}
              className="mt-3 min-h-[44px] w-full"
            >
              {allDone ? "Done — go to Purchase Orders" : "Leave the rest and go to Purchase Orders"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
