"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Trash2, AlertTriangle } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";

const log = createLogger("purchase-orders:new");

interface VendorOption { id: string; name: string; code: string; }
// costPrice is OPTIONAL and that is not laziness: api/products/search selects it only for a
// caller holding cost_price.view, so for everyone else the key is genuinely absent. Declaring
// it `number` was how this screen ended up rendering ₹NaN in five places — the type said the
// value was always there, so nothing forced anyone to handle its absence.
interface ProductOption { id: string; name: string; sku: string; costPrice?: number; gstRate?: number; }
/** The shape POST /api/purchase-orders sends beside a 409. See lib/purchase-orders/duplicates.ts. */
interface PoConflict {
  poId: string;
  poNumber: string;
  status: string;
  productIds: string[];
  productNames: string[];
}

/** One product as POST /api/purchase-orders/prepare returns it. */
interface PreparedItem {
  productId: string;
  sku: string;
  name: string;
  quantity: number;
  gstRate: number;
  /** Absent when the caller lacks cost_price.view — see P9's ₹0 rule. */
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

interface POLineItem { productId: string; productName: string; sku: string; quantity: number; unitPrice: number; gstRate: number; }

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount);
}

export default function NewPurchaseOrderPage() {
  const router = useRouter();
  const [vendors, setVendors] = useState<VendorOption[]>([]);
  const [vendorId, setVendorId] = useState("");
  const [expectedDate, setExpectedDate] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<POLineItem[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [conflicts, setConflicts] = useState<PoConflict[] | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [prepared, setPrepared] = useState<PrepareResponse | null>(null);

  // Product search
  const [productSearch, setProductSearch] = useState("");
  const [productResults, setProductResults] = useState<ProductOption[]>([]);

  useEffect(() => {
    fetch("/api/vendors?limit=100")
      .then((r) => r.json())
      .then((res) => { if (res.success) setVendors(res.data); })
      .catch(() => {});
  }, []);

  // Pick up pre-selected items from /reorder.
  //
  // TWO SHAPES. v2 is `{ v: 2, items: [{ productId, quantity }] }`; v1 was a bare array
  // carrying name, sku, unitPrice and brandName. Both are handled because a session that
  // started before this deploy can still be holding a v1 payload — and the failure mode is
  // nasty: the old code called `.map()` on the parsed value, so a v2 object threw a
  // TypeError, the `catch { /* ignore */ }` swallowed it, and `removeItem` was never reached.
  // The key then stayed wedged and every later visit to this screen threw again.
  //
  // The key is removed FIRST, before anything can throw, so a malformed payload can never
  // wedge the screen the way it could before.
  useEffect(() => {
    const stored = sessionStorage.getItem("reorder-po-items");
    if (!stored) return;
    sessionStorage.removeItem("reorder-po-items");

    const productIds: string[] = [];
    const quantities: Record<string, number> = {};
    try {
      const parsed: unknown = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        // v1
        for (const it of parsed as Array<{ productId?: string; quantity?: number }>) {
          if (!it?.productId) continue;
          productIds.push(it.productId);
          quantities[it.productId] = it.quantity ?? 1;
        }
      } else if (parsed && typeof parsed === "object" && "items" in parsed) {
        for (const it of (parsed as { items: Array<{ productId?: string; quantity?: number }> }).items ?? []) {
          if (!it?.productId) continue;
          productIds.push(it.productId);
          quantities[it.productId] = it.quantity ?? 1;
        }
      }
    } catch (e) {
      log.error("could not read the reorder handoff", { message: e instanceof Error ? e.message : String(e) });
      setError("Could not read the products carried over from Reorder. Add them here instead.");
      return;
    }

    if (productIds.length === 0) return;

    // The server fills in price, GST and vendor. The handoff deliberately carries none of
    // them: v1 sent a costPrice the API withholds without cost_price.view (so it arrived
    // undefined and rendered ₹NaN) and the consumer hardcoded gstRate to 0, which is why
    // every PO raised from /reorder until now has carried 0% GST.
    setPreparing(true);
    apiTry<PrepareResponse>("/api/purchase-orders/prepare", {
      method: "POST",
      json: { productIds, quantities },
    })
      .then(({ data, error: err }) => {
        if (!data) {
          setError(err ?? "Could not prepare the purchase order");
          return;
        }
        setPrepared(data);
      })
      .finally(() => setPreparing(false));
  }, []);

  useEffect(() => {
    // Clears stale results when the query drops below two characters. Deriving it instead
    // would leave the previous query's matches on screen while the box reads one character.
    //
    // No eslint-disable here any more: react-hooks/set-state-in-effect reported this in P9 and
    // does not now. The React Compiler lint bails out of components it cannot fully analyse,
    // so whether this line is flagged depends on unrelated edits elsewhere in the file. Do not
    // read its silence as approval, and do not be surprised if it comes back.
    if (productSearch.length < 2) { setProductResults([]); return; }
    // apiTry, not .json(): an expired session answers 307 -> /login -> HTML with status 200,
    // so the old .catch(() => {}) turned a dead session into "no products match".
    apiTry<ProductOption[]>(`/api/products/search?q=${encodeURIComponent(productSearch)}`).then(
      ({ data }) => setProductResults(data ?? [])
    );
  }, [productSearch]);

  function addItem(product: ProductOption) {
    if (items.find((i) => i.productId === product.id)) return;
    setItems([...items, {
      productId: product.id, productName: product.name, sku: product.sku,
      // ?? 0 rather than ||, so a genuine zero cost stays zero instead of being replaced.
      // A missing cost means "this person cannot see cost prices" — the line opens at 0 and
      // they type the price, which is the same thing they did before this screen worked.
      quantity: 1, unitPrice: product.costPrice ?? 0, gstRate: product.gstRate ?? 0,
    }]);
    setProductSearch("");
    setProductResults([]);
  }

  function updateItem(index: number, field: string, value: number) {
    setItems(items.map((item, i) => i === index ? { ...item, [field]: value } : item));
  }

  function removeItem(index: number) {
    setItems(items.filter((_, i) => i !== index));
  }

  const subtotal = items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0);
  const gstTotal = items.reduce((sum, i) => sum + i.quantity * i.unitPrice * (i.gstRate / 100), 0);

  /**
   * Load one prepared vendor group into the form.
   *
   * P10a fills ONE vendor at a time. The plan's per-vendor sections with a single
   * "Create all (N)" are the next commit; until then a mixed selection is offered as a
   * choice rather than silently truncated to whichever vendor happened to be first.
   */
  function loadGroup(g: PreparedGroup) {
    setVendorId(g.vendorId);
    setItems(
      g.items.map((it) => ({
        productId: it.productId,
        productName: it.name,
        sku: it.sku,
        quantity: it.quantity,
        // ?? 0 leaves the rate box empty and required, rather than inventing a price for
        // someone who is not allowed to see cost.
        unitPrice: it.costPrice ?? 0,
        // The product's real GST. The old handoff hardcoded 0 here, which is why every PO
        // raised from /reorder so far has carried 0% GST.
        gstRate: it.gstRate,
      }))
    );
    setError("");
    setConflicts(null);
  }

  // One vendor: just load it. Several: leave the choice on screen.
  useEffect(() => {
    if (prepared && prepared.groups.length === 1 && items.length === 0) {
      loadGroup(prepared.groups[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prepared]);

  /** Lines with no rate. The server refuses the whole PO if any survives to it. */
  const unpricedLines = items.filter((i) => !(i.unitPrice > 0));

  async function submit(submitForApproval: boolean) {
    if (!vendorId || items.length === 0 || unpricedLines.length > 0) return;

    setSubmitting(true);
    setError("");
    setConflicts(null);

    // apiTry rather than raw fetch: the 409 carries a conflicts array beside its message, and
    // the old `const data = await res.json()` path flattened the whole envelope to one string
    // and never looked at res.status, so that array was dropped on the floor.
    const { data, error: err, errorData, status } = await apiTry<{ id: string }>(
      "/api/purchase-orders",
      {
        method: "POST",
        json: {
          vendorId,
          expectedDate,
          notes,
          submit: submitForApproval,
          items: items.map(({ productId, quantity, unitPrice, gstRate }) => ({ productId, quantity, unitPrice, gstRate })),
        },
      }
    );
    setSubmitting(false);

    if (data) {
      router.push("/purchase-orders");
      return;
    }

    if (status === 409 && errorData && typeof errorData === "object" && "conflicts" in errorData) {
      setConflicts((errorData as { conflicts: PoConflict[] }).conflicts);
      setError("");
      return;
    }
    setError(err ?? "Something went wrong");
  }

  /** Drop every line already on an open PO, so the rest can be ordered. */
  function removeConflictingLines() {
    const clashing = new Set((conflicts ?? []).flatMap((c) => c.productIds));
    setItems((prev) => prev.filter((i) => !clashing.has(i.productId)));
    setConflicts(null);
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <Link href="/purchase-orders" className="p-2 -ml-2 rounded-lg hover:bg-slate-100 focus-ring" aria-label="Back">
          <ArrowLeft className="h-5 w-5 text-slate-600" />
        </Link>
        <h1 className="text-lg font-bold text-slate-900 truncate">New Purchase Order</h1>
      </div>

      {preparing && (
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 mb-4 text-sm text-slate-600">
          Working out who supplies these products…
        </div>
      )}

      {/* Several vendors in one selection. P10a asks which to order first; the per-vendor
          sections with one "Create all" are the next commit. Offered as a choice rather than
          silently truncated, because losing lines from an order nobody was told about is the
          worst of the available behaviours. */}
      {prepared && prepared.groups.length > 1 && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
          <p className="text-sm font-semibold text-blue-900">
            These products come from {prepared.groups.length} vendors
          </p>
          <p className="text-xs text-blue-700 mt-0.5">
            A purchase order goes to one vendor. Order them one at a time.
          </p>
          <div className="mt-2 space-y-1.5">
            {prepared.groups.map((g) => (
              <button
                key={g.vendorId}
                type="button"
                onClick={() => loadGroup(g)}
                className={`w-full text-left min-h-[44px] px-3 py-2 rounded-lg border text-xs ${
                  vendorId === g.vendorId ? "bg-blue-600 text-white border-blue-600" : "bg-white border-blue-200 text-blue-900"
                }`}
              >
                <span className="font-semibold">{g.vendorName}</span>
                <span className={vendorId === g.vendorId ? "text-blue-100" : "text-blue-500"}>
                  {" "}· {g.items.length} item{g.items.length === 1 ? "" : "s"} · {g.sourceLabel}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Products carried over that nobody supplies. They are named rather than dropped —
          a shorter order than the one selected, with no explanation, is how stock quietly
          fails to arrive. */}
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
              <li key={u.productId} className="text-xs text-amber-800 break-words">
                {u.sku} — {u.name}
              </li>
            ))}
            {prepared.unresolved.length > 6 && (
              <li className="text-xs text-amber-600">and {prepared.unresolved.length - 6} more</li>
            )}
          </ul>
        </div>
      )}

      {error && <div className="bg-red-50 text-red-700 text-sm p-3 rounded-lg mb-4">{error}</div>}

      {/* The duplicate-PO refusal. A flat red sentence would leave the buyer to find the
          existing PO themselves; this names it, links to it, and offers the one action that
          gets the rest of the order through. */}
      {conflicts && conflicts.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-amber-900">
                Already on an open purchase order
              </p>
              <div className="mt-2 space-y-2">
                {conflicts.map((c) => (
                  <div key={c.poId} className="text-xs text-amber-800">
                    <Link href={`/purchase-orders/${c.poId}`} className="font-semibold underline tabular-nums">
                      {c.poNumber}
                    </Link>
                    <span className="text-amber-600"> · {c.status.replace(/_/g, " ").toLowerCase()}</span>
                    <p className="mt-0.5 break-words">{c.productNames.join(", ")}</p>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap gap-2 mt-3">
                <button
                  type="button"
                  onClick={removeConflictingLines}
                  className="min-h-[44px] px-3 rounded-lg bg-amber-600 text-white text-xs font-medium"
                >
                  Remove those lines and continue
                </button>
                <button
                  type="button"
                  onClick={() => setConflicts(null)}
                  className="min-h-[44px] px-3 rounded-lg border border-amber-300 text-amber-800 text-xs font-medium"
                >
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* No onSubmit: there are two destinations now (submit for approval, or save a draft),
          so the buttons say which one rather than the form deciding. */}
      <form onSubmit={(e) => e.preventDefault()} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Vendor *</label>
          <select
            value={vendorId}
            onChange={(e) => setVendorId(e.target.value)}
            className="flex h-10 min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
          >
            <option value="">Select vendor...</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>{v.name} ({v.code})</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Expected Delivery</label>
          <Input type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} className="min-h-[44px]" />
        </div>

        {/* Add Products */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Add Products *</label>
          <div className="relative">
            <Input
              placeholder="Search product by name or SKU..."
              value={productSearch}
              onChange={(e) => setProductSearch(e.target.value)}
              className="min-h-[44px]"
            />
            {productResults.length > 0 && (
              <div className="absolute top-full left-0 right-0 z-10 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                {productResults.map((p) => (
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

        {/* Line Items */}
        {items.length > 0 && (
          <div className="space-y-2">
            {items.map((item, index) => (
              <Card key={item.productId}>
                <CardContent className="p-3">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <p className="text-sm font-medium text-slate-900">{item.productName}</p>
                      <p className="text-xs text-slate-500">{item.sku}</p>
                    </div>
                    <button type="button" onClick={() => removeItem(index)} className="p-1 text-red-400 hover:text-red-600">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 mb-0.5">Qty</label>
                      <Input
                        type="number"
                        inputMode="numeric"
                        value={item.quantity}
                        onChange={(e) => updateItem(index, "quantity", parseInt(e.target.value) || 0)}
                        min="1"
                        className="text-sm min-h-[44px] tabular-nums"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 mb-0.5">
                        Unit Price <span className="text-red-500">*</span>
                      </label>
                      {/* EMPTY, not a literal 0, when the rate is unknown. api/products/search
                          withholds costPrice from anyone without cost_price.view, so for those
                          users this box used to render "0" — a number nobody typed, which then
                          became the rate on a purchase order emailed to the vendor. An empty
                          required box asks the question instead of answering it wrongly. */}
                      <Input
                        type="number"
                        inputMode="decimal"
                        required
                        min="0.01"
                        step="0.01"
                        value={item.unitPrice > 0 ? item.unitPrice : ""}
                        placeholder="Rate"
                        onChange={(e) => updateItem(index, "unitPrice", parseFloat(e.target.value) || 0)}
                        aria-invalid={!(item.unitPrice > 0)}
                        className={`text-sm min-h-[44px] tabular-nums ${
                          item.unitPrice > 0 ? "" : "border-amber-400 bg-amber-50"
                        }`}
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 mb-0.5">GST %</label>
                      <Input
                        type="number"
                        inputMode="decimal"
                        value={item.gstRate}
                        onChange={(e) => updateItem(index, "gstRate", parseFloat(e.target.value) || 0)}
                        className="text-sm min-h-[44px] tabular-nums"
                      />
                    </div>
                  </div>
                  <p className="text-xs text-right text-slate-500 mt-1 tabular-nums">
                    Line: {formatCurrency(item.quantity * item.unitPrice * (1 + item.gstRate / 100))}
                  </p>
                </CardContent>
              </Card>
            ))}

            {/* Totals */}
            <Card className="bg-slate-50">
              <CardContent className="p-3 space-y-1">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">Subtotal</span>
                  <span className="text-slate-700 tabular-nums">{formatCurrency(subtotal)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">GST</span>
                  <span className="text-slate-700 tabular-nums">{formatCurrency(gstTotal)}</span>
                </div>
                <div className="flex justify-between text-sm font-bold border-t pt-1">
                  <span className="text-slate-900">Grand Total</span>
                  <span className="text-slate-900 tabular-nums">{formatCurrency(subtotal + gstTotal)}</span>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
          <textarea
            placeholder="Any notes for this PO..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="flex w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900"
          />
        </div>

        <div>
          {unpricedLines.length > 0 && (
            <p className="text-xs text-amber-600 mb-2">
              {unpricedLines.length === 1 ? "One line has" : `${unpricedLines.length} lines have`} no rate.
              Enter a unit price — a purchase order cannot go to a vendor with a ₹0 line.
            </p>
          )}
          <div className="flex flex-col sm:flex-row gap-2">
          <Button type="button" onClick={() => void submit(true)} size="lg" disabled={!vendorId || items.length === 0 || submitting || unpricedLines.length > 0} className="flex-1 min-h-[48px] bg-green-600 hover:bg-green-700 text-white">
            {submitting ? "Creating..." : "Submit for approval"}
          </Button>
          <Button type="button" variant="outline" onClick={() => void submit(false)} size="lg" disabled={!vendorId || items.length === 0 || submitting || unpricedLines.length > 0} className="flex-1 min-h-[48px]">
            Save draft
          </Button>
          </div>
          {(!vendorId || items.length === 0) && !submitting && (
            <p className="text-xs text-slate-500 mt-1.5 text-center">
              {!vendorId ? "Select a vendor to continue" : "Add at least one product to continue"}
            </p>
          )}
        </div>
      </form>
    </div>
  );
}
