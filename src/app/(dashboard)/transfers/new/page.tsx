"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { usePermissions } from "@/lib/use-permissions";
import { ArrowLeft, ArrowRight, Search, Plus, Trash2, Package, Loader2, FileText, AlertTriangle } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { ActionConfirmation } from "@/components/ui/action-confirmation";
import { useWarehouses, type WarehouseOption } from "@/hooks/use-sites";
import { apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";

const log = createLogger("transfers:new");

interface Product {
  id: string;
  name: string;
  sku: string;
  currentStock: number;
}

interface TransferItem {
  product: Product;
  quantity: number;
}

/**
 * `-v2` because the draft SHAPE changed, not for a version number's sake.
 *
 * A v1 draft holds `fromWarehouseId`/`toWarehouseId` on every item and no route at all. Read
 * back into this page it would restore a list of products with no lane and silently drop the
 * part the person chose. Changing the key orphans those drafts instead, which is the honest
 * outcome — sessionStorage, so at worst somebody re-picks two warehouses once.
 */
const STORAGE_KEY = "transfer-order-draft-v2";

interface DraftData {
  items: TransferItem[];
  notes: string;
  fromWarehouseId: string;
  toWarehouseId: string;
}

function saveDraft(d: DraftData) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(d));
  } catch { /* ignore */ }
}

function loadDraft(): DraftData | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as DraftData;
  } catch { return null; }
}

function clearDraft() {
  try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}

/**
 * What document this route will require, worked out in the browser.
 *
 * A MIRROR of `src/lib/transfers/policy.ts`, deliberately duplicated rather than imported —
 * that module imports `WarehouseRef` from a server module. The server is the authority and
 * refuses on its own derivation; this exists only so the person is told BEFORE they spend two
 * minutes building a list, which is the whole point of showing it up front.
 *
 * Keep the two in step. They disagree only in what they do about a missing GSTIN: the server
 * returns a 400, this returns a banner.
 */
function previewPolicy(from: WarehouseOption | null, to: WarehouseOption | null):
  | { kind: "none" }
  | { kind: "challan"; reason: string }
  | { kind: "invoice"; reason: string }
  | { kind: "blocked"; message: string } {
  if (!from || !to || from.id === to.id) return { kind: "none" };

  if (from.storeId === to.storeId) {
    return { kind: "challan", reason: "Within one store — a delivery challan covers it." };
  }

  const f = from.store.gstin?.trim() || null;
  const t = to.store.gstin?.trim() || null;
  if (!f || !t) {
    const missing = [!f ? from.store.name : null, !t ? to.store.name : null].filter(Boolean).join(" and ");
    return {
      kind: "blocked",
      message: `Set the GSTIN for ${missing} on /stores before transferring between stores.`,
    };
  }
  if (f.toUpperCase() === t.toUpperCase()) {
    return { kind: "challan", reason: "Both stores share one GSTIN — a delivery challan covers it." };
  }
  return {
    kind: "invoice",
    reason: "Different GSTINs, so this movement is a supply. Raise the tax invoice in Zoho Books and attach it before dispatch.",
  };
}

export default function NewTransferOrderPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const { canApprove } = usePermissions();
  const isAutoApproved = canApprove("transfers");

  const { warehouses, loading: warehousesLoading } = useWarehouses();

  // What the person actually PICKED. Empty means "has not chosen" — the effective route is
  // derived below rather than written into state by an effect, which is what keeps this file
  // free of a cascading render on every warehouse load.
  const [chosenFrom, setChosenFrom] = useState("");
  const [chosenTo, setChosenTo] = useState("");
  const [items, setItems] = useState<TransferItem[]>([]);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<{
    type: "success" | "warning";
    title: string;
    referenceId: string;
    items: Array<{ label: string; value: string }>;
    details: string;
  } | null>(null);

  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<Product[]>([]);
  const [searching, setSearching] = useState(false);

  // The EFFECTIVE route: what was picked, or the first sensible pair. Derived during render,
  // so there is no effect writing a default into state and no render where the selects are
  // blank while the list is already loaded. The destination also self-corrects when it would
  // collide with the source, which is why `chooseFrom` no longer has to fix it up by hand.
  const fromWarehouseId = chosenFrom || warehouses[0]?.id || "";
  const toWarehouseId =
    chosenTo && chosenTo !== fromWarehouseId
      ? chosenTo
      : (warehouses.find((w) => w.id !== fromWarehouseId)?.id ?? "");

  useEffect(() => {
    const draft = loadDraft();
    if (!draft) return;
    if (draft.items?.length > 0) setItems(draft.items);
    if (draft.notes) setNotes(draft.notes);
    if (draft.fromWarehouseId) setChosenFrom(draft.fromWarehouseId);
    if (draft.toWarehouseId) setChosenTo(draft.toWarehouseId);
    // Restoring a draft is the one setState-in-an-effect this file keeps. It cannot move into
    // a useState initialiser: those run during render, including the server render, where
    // sessionStorage does not exist — and a client that started with the draft while the
    // server started without it is a hydration mismatch. Mount-only, so it cascades once.
  }, []);

  useEffect(() => {
    if (items.length > 0 || notes || fromWarehouseId || toWarehouseId) {
      saveDraft({ items, notes, fromWarehouseId, toWarehouseId });
    }
  }, [items, notes, fromWarehouseId, toWarehouseId]);

  useEffect(() => {
    if (search.length < 1) return;
    // Everything is inside the timeout, so the effect body itself sets no state. The spinner
    // therefore covers the request rather than the debounce — which also stops it flickering
    // on every keystroke.
    const timer = setTimeout(async () => {
      setSearching(true);
      const { data, error: err } = await apiTry<Product[]>(
        `/api/products?search=${encodeURIComponent(search)}&limit=10`
      );
      if (err) log.warn("product search failed", { message: err });
      setSearchResults(data ?? []);
      setSearching(false);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Stale matches are hidden by DERIVING the visible list from the query, rather than clearing
  // the state in the effect above. Same behaviour, no cascading render — the fix P10b applied
  // to the reorder screen for exactly this pattern.
  const visibleResults = search.length >= 1 ? searchResults : [];

  const fromWh = useMemo(
    () => warehouses.find((w) => w.id === fromWarehouseId) ?? null,
    [warehouses, fromWarehouseId]
  );
  const toWh = useMemo(
    () => warehouses.find((w) => w.id === toWarehouseId) ?? null,
    [warehouses, toWarehouseId]
  );
  const policy = useMemo(() => previewPolicy(fromWh, toWh), [fromWh, toWh]);

  function addItem(product: Product) {
    if (items.some((i) => i.product.id === product.id)) {
      setError(`${product.name} is already in the list`);
      setTimeout(() => setError(""), 2000);
      return;
    }
    setItems((prev) => [...prev, { product, quantity: 1 }]);
    setSearch("");
    setSearchResults([]);
  }

  function setQuantity(index: number, quantity: number) {
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, quantity } : item)));
  }

  function removeItem(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  function chooseFrom(id: string) {
    setChosenFrom(id);
    // No destination fix-up needed: `toWarehouseId` above already falls back to another
    // warehouse whenever the choice would collide with the new source.
  }

  const routeChosen = Boolean(fromWarehouseId && toWarehouseId && fromWarehouseId !== toWarehouseId);
  const isValid =
    routeChosen &&
    policy.kind !== "blocked" &&
    items.length > 0 &&
    items.every((i) => i.quantity > 0 && i.quantity <= i.product.currentStock);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isValid) return;

    setSubmitting(true);
    setError("");

    const { data, error: err } = await apiTry<{ orderNo?: string; status?: string }>(
      "/api/transfer-orders",
      {
        method: "POST",
        json: {
          fromWarehouseId,
          toWarehouseId,
          items: items.map((i) => ({ productId: i.product.id, quantity: i.quantity })),
          notes: notes || undefined,
        },
      }
    );

    setSubmitting(false);

    if (!data) {
      log.warn("transfer create failed", { message: err });
      setError(err ?? "Failed to create transfer order.");
      return;
    }

    clearDraft();
    const approved = data.status === "APPROVED";
    setReceipt({
      type: approved ? "success" : "warning",
      title: approved ? "Transfer Approved" : "Transfer Submitted",
      referenceId: data.orderNo || "Transfer",
      items: [
        { label: "Route", value: `${fromWh?.name ?? "—"} → ${toWh?.name ?? "—"}` },
        ...items.map((i) => ({
          label: i.product.name.length > 28 ? i.product.name.slice(0, 28) + "…" : i.product.name,
          value: `×${i.quantity}`,
        })),
      ],
      // The copy is explicit that nothing has moved. Under the old flow an approved transfer
      // HAD moved the stock, and saying so when it has not is how a shop floor ends up
      // looking for goods that are still in the other building.
      details: approved
        ? "Approved — nothing has moved yet. Attach the document and dispatch it when the van leaves."
        : "Pending approval. Screenshot and share on the WhatsApp group for verification.",
    });
  }

  const selectClass =
    "w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-600";

  return (
    <div className="pb-32">
      <div className="flex items-center gap-3 mb-4">
        <Link href="/transfers" className="p-2 -ml-2 rounded-lg hover:bg-slate-100 focus-ring" aria-label="Back">
          <ArrowLeft className="h-5 w-5 text-slate-600" />
        </Link>
        <div className="min-w-0">
          <h1 className="text-lg font-bold text-slate-900 truncate">New Transfer Order</h1>
          <p className="text-xs text-slate-500">
            {isAutoApproved ? "Approved on creation — dispatch separately" : "Will need approval"}
          </p>
        </div>
      </div>

      {/* ── Route ─────────────────────────────────────────────────────────────────────────
          ONE route for the whole order, not one per line. An order is dispatched and received
          as a single thing — one van, one document, one e-way bill — so a per-line lane made
          "where is this going" a question with several answers. */}
      <Card className="mb-4 border-purple-100">
        <CardContent className="p-3">
          <p className="text-xs font-semibold text-slate-700 mb-2">Route</p>
          <div className="flex items-center gap-2">
            <div className="flex-1 min-w-0">
              <label className="text-xs text-slate-500 mb-0.5 block" htmlFor="from-wh">From</label>
              <select id="from-wh" value={fromWarehouseId} onChange={(e) => chooseFrom(e.target.value)} className={selectClass}>
                {warehousesLoading && <option value="">Loading warehouses…</option>}
                {!warehousesLoading && warehouses.length === 0 && <option value="">No warehouses</option>}
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>{w.store.name} · {w.name}</option>
                ))}
              </select>
            </div>
            <ArrowRight className="h-4 w-4 text-purple-500 shrink-0 mt-6" />
            <div className="flex-1 min-w-0">
              <label className="text-xs text-slate-500 mb-0.5 block" htmlFor="to-wh">To</label>
              <select id="to-wh" value={toWarehouseId} onChange={(e) => setChosenTo(e.target.value)} className={selectClass}>
                {warehousesLoading && <option value="">Loading warehouses…</option>}
                {warehouses.filter((w) => w.id !== fromWarehouseId).map((w) => (
                  <option key={w.id} value={w.id}>{w.store.name} · {w.name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* The derived document, shown BEFORE the list is built. Finding out at dispatch
              that a tax invoice was needed is finding out too late — the invoice is raised in
              Zoho, which takes a person and a few minutes. */}
          {policy.kind === "blocked" && (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5">
              <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-800">
                {policy.message}{" "}
                <Link href="/stores" className="font-semibold underline">Open /stores</Link>
              </p>
            </div>
          )}
          {policy.kind === "invoice" && (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 p-2.5">
              <FileText className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" />
              <p className="text-xs text-blue-800">
                <span className="font-semibold">Inter-store → tax invoice required.</span> {policy.reason}
              </p>
            </div>
          )}
          {policy.kind === "challan" && (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2.5">
              <FileText className="h-4 w-4 text-slate-500 shrink-0 mt-0.5" />
              <p className="text-xs text-slate-600">
                <span className="font-semibold">Delivery challan required.</span> {policy.reason}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Search & Add Items */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="product-search">Search & Add Items</label>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input
            id="product-search"
            placeholder="Search product name or SKU..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 min-h-[44px]"
          />
          {searching && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 animate-spin" />}

          {visibleResults.length > 0 && (
            <div className="absolute top-full left-0 right-0 z-20 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-56 overflow-y-auto">
              {visibleResults.map((p) => (
                <button key={p.id} type="button" onClick={() => addItem(p)}
                  className="w-full text-left px-3 py-2.5 hover:bg-purple-50 border-b border-slate-100 last:border-0 flex items-center justify-between focus-ring">
                  <div>
                    <p className="text-sm font-medium text-slate-900">{p.name}</p>
                    <p className="text-xs text-slate-500 tabular-nums">{p.sku} | Stock: {p.currentStock}</p>
                  </div>
                  <Plus className="h-4 w-4 text-purple-500 shrink-0" />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Items — product and quantity only. The lane lives on the Route card above. */}
      {items.length === 0 ? (
        <div className="text-center py-8 border-2 border-dashed border-slate-200 rounded-lg mb-4">
          <Package className="h-8 w-8 text-slate-300 mx-auto mb-2" />
          <p className="text-sm text-slate-400">Search and add items to transfer</p>
        </div>
      ) : (
        <div className="space-y-3 mb-4">
          <p className="text-xs font-medium text-slate-500">{items.length} item{items.length !== 1 ? "s" : ""} to transfer</p>
          {items.map((item, index) => (
            <Card key={item.product.id} className="border-purple-100">
              <CardContent className="p-3">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex-1 min-w-0 mr-2">
                    <p className="text-sm font-medium text-slate-900">{item.product.name}</p>
                    <p className="text-xs text-slate-500 tabular-nums">{item.product.sku} | Stock: {item.product.currentStock}</p>
                  </div>
                  <button type="button" onClick={() => removeItem(index)} aria-label={`Remove ${item.product.name}`}
                    className="p-1.5 rounded-lg hover:bg-red-50 text-red-400 hover:text-red-600 focus-ring">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>

                <label className="text-xs text-slate-500 mb-0.5 block">Qty</label>
                <div className="flex items-center gap-2">
                  <button type="button"
                    onClick={() => setQuantity(index, Math.max(1, item.quantity - 1))}
                    disabled={item.quantity <= 1}
                    aria-label="Decrease quantity"
                    className="h-11 w-11 rounded-lg border border-slate-300 bg-white text-slate-700 text-lg font-bold flex items-center justify-center disabled:opacity-30 focus-ring">
                    −
                  </button>
                  <span className="h-11 min-w-[3rem] rounded-lg border border-slate-200 bg-slate-50 flex items-center justify-center text-sm font-semibold text-slate-900 tabular-nums">
                    {item.quantity}
                  </span>
                  <button type="button"
                    onClick={() => setQuantity(index, Math.min(item.product.currentStock, item.quantity + 1))}
                    disabled={item.quantity >= item.product.currentStock}
                    aria-label="Increase quantity"
                    className="h-11 w-11 rounded-lg border border-purple-300 bg-purple-50 text-purple-700 text-lg font-bold flex items-center justify-center disabled:opacity-30 focus-ring">
                    +
                  </button>
                  <span className="text-[11px] text-slate-400 tabular-nums">/ {item.product.currentStock}</span>
                </div>
                {item.quantity > item.product.currentStock && (
                  <p className="text-xs text-red-600 mt-1">Exceeds available stock</p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <div className="mb-4">
        <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="transfer-notes">Notes (optional)</label>
        <textarea id="transfer-notes" placeholder="Reason for transfer..." value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
          className="flex w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-600" />
      </div>

      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

      <div className="fixed above-nav left-0 right-0 bg-white border-t border-slate-200 p-4 pb-safe z-50">
        {!isValid && !submitting && (
          <p className="text-xs text-slate-500 mb-2 text-center">
            {policy.kind === "blocked"
              ? "Set the missing GSTIN before raising this transfer."
              : !routeChosen
                ? "Choose a source and destination."
                : items.length === 0
                  ? "Add at least one item to transfer."
                  : "Set a valid quantity for each item."}
          </p>
        )}
        <Button type="button" size="lg" disabled={!isValid || submitting} onClick={handleSubmit}
          className="w-full min-h-[48px] bg-green-600 hover:bg-green-700">
          {submitting ? (
            <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Creating...</>
          ) : (
            `${isAutoApproved ? "Create" : "Submit"} transfer · ${items.length} item${items.length !== 1 ? "s" : ""}`
          )}
        </Button>
      </div>

      <ActionConfirmation
        open={!!receipt}
        onClose={() => { setReceipt(null); router.push("/transfers"); }}
        type={receipt?.type || "success"}
        title={receipt?.title || ""}
        referenceId={receipt?.referenceId || ""}
        performedBy={(session?.user as { name?: string })?.name}
        items={receipt?.items}
        details={receipt?.details}
      />
    </div>
  );
}
