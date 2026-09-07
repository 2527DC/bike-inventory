"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";
import {
  VendorSection,
  formatCurrency,
  type Section,
  type POLineItem,
  type PoConflict,
  type VendorOption,
} from "./_components/vendor-section";

const log = createLogger("purchase-orders:new");

interface ProductOption {
  id: string;
  name: string;
  sku: string;
  /** Absent for a caller without cost_price.view — declaring it `number` is what produced ₹NaN. */
  costPrice?: number;
  gstRate?: number;
}

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

const toLine = (it: PreparedItem): POLineItem => ({
  productId: it.productId,
  productName: it.name,
  sku: it.sku,
  quantity: it.quantity,
  // ?? 0 leaves the rate box empty and required rather than inventing a price for somebody
  // who is not permitted to see cost.
  unitPrice: it.costPrice ?? 0,
  // The product's real GST. The v1 handoff hardcoded 0, which is why every purchase order
  // raised from /reorder before P10 carried 0% GST.
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

  const [productSearch, setProductSearch] = useState("");
  const [productResults, setProductResults] = useState<ProductOption[]>([]);

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

  useEffect(() => {
    if (productSearch.length < 2) return;
    apiTry<ProductOption[]>(`/api/products/search?q=${encodeURIComponent(productSearch)}`).then(({ data }) =>
      setProductResults(data ?? [])
    );
  }, [productSearch]);

  // Derived rather than cleared in the effect. The previous version called setProductResults([])
  // synchronously inside the effect body to drop stale matches; deriving the visible list from
  // the query length does the same job with no cascading render and no stale window.
  const visibleResults = productSearch.length >= 2 ? productResults : [];

  const patch = useCallback((key: string, next: Partial<Section>) => {
    setSections((prev) => prev.map((s) => (s.key === key ? { ...s, ...next } : s)));
  }, []);

  /** Products go into the manual section — the derived ones are what the resolver decided. */
  function addItem(product: ProductOption) {
    const manual = sections.find((s) => s.key === MANUAL_KEY);
    if (!manual) return;
    if (manual.items.some((i) => i.productId === product.id)) return;
    patch(MANUAL_KEY, {
      items: [
        ...manual.items,
        {
          productId: product.id,
          productName: product.name,
          sku: product.sku,
          quantity: 1,
          unitPrice: product.costPrice ?? 0,
          gstRate: product.gstRate ?? 0,
        },
      ],
    });
    setProductSearch("");
    setProductResults([]);
  }

  /** Create ONE vendor's order. Returns true when a purchase order now exists. */
  const submitSection = useCallback(
    async (key: string, submitForApproval: boolean): Promise<boolean> => {
      const s = sections.find((x) => x.key === key);
      if (!s || s.status === "created") return false;
      if (!s.vendorId || s.items.length === 0 || s.items.some((i) => !(i.unitPrice > 0))) return false;

      patch(key, { status: "running", error: null, conflicts: null });

      const { data, error, errorData, status } = await apiTry<{ id: string; poNumber: string }>(
        "/api/purchase-orders",
        {
          method: "POST",
          json: {
            vendorId: s.vendorId,
            expectedDate,
            notes,
            submit: submitForApproval,
            items: s.items.map(({ productId, quantity, unitPrice, gstRate }) => ({ productId, quantity, unitPrice, gstRate })),
          },
        }
      );

      if (data) {
        patch(key, { status: "created", poId: data.id, poNumber: data.poNumber, error: null, conflicts: null });
        log.info("purchase order created", { vendorId: s.vendorId, poNumber: data.poNumber });
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
    [sections, expectedDate, notes, patch]
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

  function removeConflictingLines(key: string) {
    const s = sections.find((x) => x.key === key);
    if (!s?.conflicts) return;
    const clashing = new Set(s.conflicts.flatMap((c) => c.productIds));
    patch(key, { items: s.items.filter((i) => !clashing.has(i.productId)), conflicts: null, status: "idle" });
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
            {/* The product search belongs to the manual section only: a derived section's lines
                are what the resolver decided, and adding to it by hand would put a product on
                a vendor that does not supply it — which the server would then refuse. */}
            {s.key === MANUAL_KEY && (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Add Products <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <Input
                    placeholder="Search product by name or SKU..."
                    value={productSearch}
                    onChange={(e) => setProductSearch(e.target.value)}
                    className="min-h-[44px]"
                  />
                  {visibleResults.length > 0 && (
                    <div className="absolute top-full left-0 right-0 z-10 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                      {visibleResults.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => addItem(p)}
                          className="w-full text-left px-3 py-2.5 hover:bg-slate-50 border-b border-slate-100 last:border-0"
                        >
                          <p className="text-sm font-medium text-slate-900">{p.name}</p>
                          <p className="text-xs text-slate-500">
                            {p.sku}
                            {p.costPrice !== undefined ? ` | Cost: ${formatCurrency(p.costPrice)}` : ""}
                          </p>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </VendorSection>
        ))}

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
            <ul className="mt-2 space-y-1">
              {created.map((s) => (
                <li key={s.key} className="text-xs text-green-800">
                  <Link href={`/purchase-orders/${s.poId}`} className="font-semibold underline tabular-nums">
                    {s.poNumber}
                  </Link>
                  {" · "}{s.vendorName ?? vendors.find((v) => v.id === s.vendorId)?.name ?? "Vendor"}
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
