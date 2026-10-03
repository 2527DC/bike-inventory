"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { usePermissions } from "@/lib/use-permissions";
import { ArrowLeft, Search, Plus, Loader2 } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ActionConfirmation } from "@/components/ui/action-confirmation";
import { useStores } from "@/hooks/use-sites";
import { apiTry } from "@/lib/api-client";
import { compressImageFull } from "@/lib/media-compress";
import { uploadMedia } from "@/lib/media-upload";
import { createLogger } from "@/lib/logger";
import type { TransferDocType } from "@prisma/client";
import { kindsForMode } from "@/lib/transfers/mode";
import {
  RoutePicker,
  DIRECTIONS,
  DIRECTION_LABEL,
  KIND_WORD,
  docLabel,
  resolveRoute,
  type DirectionMode,
  type RoutePicks,
} from "./_components/route-picker";
import { DocumentPicker } from "./_components/document-picker";
import { ItemList, type Product, type TransferItem } from "./_components/item-list";
import { resolveLineBins, type LineBins } from "../_components/line-bin-pickers";
import { useTransferBinOptions } from "../_components/use-bin-options";

const log = createLogger("transfers:new");

/**
 * `-v4` because the draft SHAPE changed, not for a version number's sake.
 *
 * A v3 draft holds a store-based mode ("STORE_TO_STORE") and lines without bins or keys. Read
 * back into this page it would restore a direction that no longer exists. Changing the key
 * orphans those drafts instead — sessionStorage, so at worst somebody re-picks a route once.
 *
 * The file is NOT in the draft. A `File` does not survive JSON, and a draft that claimed to
 * hold a document it could not produce would be worse than one that asks again.
 */
const STORAGE_KEY = "transfer-order-draft-v4";

interface DraftData extends RoutePicks {
  items: TransferItem[];
  notes: string;
}

function newLineKey(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Where the document is uploaded before the order (and its number) exists. */
function newDocumentKey(ext: string): string {
  return `transfers/new/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
}

function saveDraft(d: DraftData) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(d));
  } catch (e) {
    log.debug("draft not saved", { message: e instanceof Error ? e.message : String(e) });
  }
}

function loadDraft(): DraftData | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as DraftData;
  } catch (e) {
    log.warn("draft unreadable, starting empty", { message: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

function clearDraft() {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    log.debug("draft not cleared", { message: e instanceof Error ? e.message : String(e) });
  }
}

interface CreatedOrder {
  id?: string;
  orderNo?: string;
  status?: string;
}

export default function NewTransferOrderPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const { canApprove } = usePermissions();
  const isAutoApproved = canApprove("transfers");

  const { stores, loading: storesLoading, error: storesError } = useStores();

  // Plan 0310, Part D and R8: a direction and two warehouses, each picked from one list of every
  // warehouse of its kind across all stores.
  const [picks, setPicks] = useState<RoutePicks>({
    mode: "GODOWN_TO_FLOOR",
    fromWarehouseId: "",
    toWarehouseId: "",
  });
  const [items, setItems] = useState<TransferItem[]>([]);
  const [notes, setNotes] = useState("");
  // The file AND the document it was attached as. A route change can switch the document (Q7):
  // a challan attached for a same-store move is the wrong paper once the stores differ, so it
  // stops counting (`docFile` below) instead of being cleared in a handler that might be missed.
  const [attached, setAttached] = useState<{ file: File; type: TransferDocType } | null>(null);
  const [docNumber, setDocNumber] = useState("");
  const [docDate, setDocDate] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<{
    type: "success" | "warning";
    title: string;
    referenceId: string;
    items: Array<{ label: string; value: string }>;
    details: string;
    redirectTo: string;
  } | null>(null);

  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<Product[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const draft = loadDraft();
    if (!draft) return;
    // Restoring a draft is the one setState-in-an-effect this file keeps. It cannot move into
    // a useState initialiser: those run during render, including the server render, where
    // sessionStorage does not exist — and a client that started with the draft while the
    // server started without it is a hydration mismatch. Mount-only, so it cascades once.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPicks({
      mode: (DIRECTIONS as readonly string[]).includes(draft.mode) ? draft.mode : "GODOWN_TO_FLOOR",
      fromWarehouseId: draft.fromWarehouseId ?? "",
      toWarehouseId: draft.toWarehouseId ?? "",
    });
    if (draft.items?.length > 0) setItems(draft.items);
    if (draft.notes) setNotes(draft.notes);
  }, []);

  useEffect(() => {
    if (items.length > 0 || notes || picks.fromWarehouseId || picks.toWarehouseId) {
      saveDraft({ ...picks, items, notes });
    }
  }, [picks, items, notes]);

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
  // the state in the effect above. Same behaviour, no cascading render.
  const visibleResults = search.length >= 1 ? searchResults : [];

  // The route, derived during render — `resolveRoute` is also what the picker shows, so the two
  // can never disagree about which warehouse a side resolved to.
  const route = resolveRoute(stores, picks);
  const fromWh = route.fromWarehouse;
  const toWh = route.toWarehouse;
  const routeChosen = Boolean(fromWh && toWh && fromWh.id !== toWh.id);
  const sourceLabel = fromWh ? `${fromWh.storeName} · ${fromWh.name}` : null;
  const destinationLabel = toWh ? `${toWh.storeName} · ${toWh.name}` : null;
  const docFile = attached && attached.type === route.docType ? attached.file : null;

  // The bins every line can name (plan 0310, Part C), and what each line will actually send.
  const { options: binOptions, loading: binsLoading, error: binsError } = useTransferBinOptions(
    fromWh?.id ?? null,
    toWh?.id ?? null,
    items.map((i) => i.product.id)
  );
  const resolved = items.map((i) => resolveLineBins(i.product.id, i, binOptions));
  // A line may take what its from-bin holds less what the OTHER lines on that same bin take.
  const limits = items.map((item, index) => {
    const r = resolved[index];
    if (!r.fromBinId) return item.product.currentStock;
    const others = items.reduce(
      (n, o, j) =>
        j !== index && o.product.id === item.product.id && resolved[j].fromBinId === r.fromBinId ? n + o.quantity : n,
      0
    );
    return Math.max(0, r.fromQty - others);
  });
  const binsChosen = resolved.every((r) => r.fromBinId && r.toBinId);
  const quantitiesValid = items.every((i, index) => i.quantity > 0 && i.quantity <= limits[index]);
  const isValid = routeChosen && items.length > 0 && binsChosen && quantitiesValid && Boolean(docFile);

  function missingHint(): string {
    const kinds = kindsForMode(picks.mode);
    if (!fromWh) {
      return route.fromOptions.length === 0
        ? `No store has an active ${KIND_WORD[kinds.from]} to send from.`
        : `Choose the ${KIND_WORD[kinds.from]} the stock leaves from.`;
    }
    if (!toWh) {
      return route.toOptions.length === 0
        ? `There is no ${KIND_WORD[kinds.to]} to send to.`
        : `Choose the ${KIND_WORD[kinds.to]} the stock goes to.`;
    }
    if (items.length === 0) return "Add at least one item to transfer.";
    if (binsLoading) return "Loading bins…";
    if (binsError) return `Bins could not be loaded: ${binsError}`;
    if (!binsChosen) return "Choose the from-bin and to-bin on every line.";
    if (!quantitiesValid) return "Set a valid quantity for each line.";
    if (!docFile) return `Attach the ${route.docType ? docLabel(route.docType).toLowerCase() : "document"} — it is required.`;
    return "";
  }

  function switchMode(next: DirectionMode) {
    if (next === picks.mode) return;
    log.debug("direction switched", { from: picks.mode, to: next });
    // The warehouses are re-picked for the new kinds. The items stay, and their bins re-resolve
    // against the new warehouses (`resolveLineBins` drops what no longer fits).
    setPicks((p) => ({ ...p, mode: next, fromWarehouseId: "", toWarehouseId: "" }));
  }

  function addItem(product: Product) {
    if (items.some((i) => i.product.id === product.id)) {
      setError(`${product.name} is already in the list — use "+ from another bin" on its line to take more from a different bin`);
      setTimeout(() => setError(""), 3000);
      return;
    }
    setItems((prev) => [...prev, { key: newLineKey(), product, quantity: 1, fromBinId: "", toBinId: "" }]);
    setSearch("");
    setSearchResults([]);
  }

  function setQuantity(index: number, quantity: number) {
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, quantity } : item)));
  }

  function setLineBins(index: number, patch: Partial<LineBins>) {
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  /** Same product, another bin (2209 Q2a): a new line under this one, its from-bin left to choose. */
  function splitLine(index: number) {
    setItems((prev) => {
      const line = prev[index];
      const copy: TransferItem = { key: newLineKey(), product: line.product, quantity: 1, fromBinId: "", toBinId: line.toBinId };
      return [...prev.slice(0, index + 1), copy, ...prev.slice(index + 1)];
    });
  }

  function removeItem(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  /**
   * Submit order: the file goes up FIRST, then the order is created with the returned URL.
   * If the upload fails nothing is created — the document is required, so an order without
   * one would be a record the server has to refuse anyway. Two steps, each logged.
   */
  async function handleSubmit() {
    if (!isValid || !docFile || !fromWh || !toWh || submitting) return;

    setSubmitting(true);
    setError("");

    const itemCount = items.length;
    const ids = { mode: picks.mode, fromWarehouseId: fromWh.id, toWarehouseId: toWh.id, itemCount };

    let url: string;
    try {
      log.debug("submit 1/2: uploading document", { ...ids, bytes: docFile.size, contentType: docFile.type || "unknown" });
      // Images are downscaled and re-encoded; a PDF comes back untouched with ext "pdf".
      const { blob, ext, contentType } = await compressImageFull(docFile);
      const type = contentType || (ext === "pdf" ? "application/pdf" : docFile.type) || "application/octet-stream";
      const key = newDocumentKey(ext);
      url = await uploadMedia(blob, key, type);
      // The key is logged; the URL is not — the presigned form of it is a credential.
      log.debug("submit 1/2: document uploaded", { key, bytes: blob.size, contentType: type });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Upload failed";
      log.error("document upload failed; no order created", { ...ids, message });
      setError(message);
      setSubmitting(false);
      return;
    }

    const document = {
      url,
      ...(docNumber.trim() ? { number: docNumber.trim() } : {}),
      ...(docDate ? { date: docDate } : {}),
    };
    const lines = items.map((i, index) => ({
      productId: i.product.id,
      quantity: i.quantity,
      fromBinId: resolved[index].fromBinId,
      toBinId: resolved[index].toBinId,
    }));
    const body = {
      mode: picks.mode,
      fromWarehouseId: fromWh.id,
      toWarehouseId: toWh.id,
      items: lines,
      notes: notes || undefined,
      document,
    };

    log.debug("submit 2/2: creating order", { ...ids, hasNumber: Boolean(document.number), hasDate: Boolean(document.date) });
    const { data, error: err } = await apiTry<CreatedOrder>("/api/transfer-orders", { method: "POST", json: body });

    setSubmitting(false);

    if (!data) {
      log.error("transfer create failed after the document uploaded", { ...ids, message: err });
      setError(err ?? "Failed to create transfer order.");
      return;
    }

    clearDraft();
    const approved = data.status === "APPROVED";
    log.info("transfer created", { orderId: data.id, orderNo: data.orderNo, mode: picks.mode, itemCount, status: data.status });
    setReceipt({
      type: approved ? "success" : "warning",
      title: approved ? "Transfer Approved" : "Transfer Submitted",
      referenceId: data.orderNo || "Transfer",
      redirectTo: data.id ? `/transfers/${data.id}` : "/transfers",
      items: [
        { label: "Direction", value: DIRECTION_LABEL[picks.mode] },
        { label: "Route", value: `${sourceLabel ?? "—"} → ${destinationLabel ?? "—"}` },
        { label: "Document", value: route.docType ? docLabel(route.docType) : "—" },
        ...items.map((i) => ({
          label: i.product.name.length > 28 ? i.product.name.slice(0, 28) + "…" : i.product.name,
          value: `×${i.quantity}`,
        })),
      ],
      // The copy is explicit that nothing has moved. An approved transfer has NOT moved the
      // stock, and saying so when it has not is how a shop floor ends up looking for goods
      // that are still in the other building.
      details: approved
        ? "Approved — nothing has moved yet. Dispatch it when the van leaves."
        : "Pending approval. Screenshot and share on the WhatsApp group for verification.",
    });
  }

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

      {/* ONE route for the whole order, not one per line. An order is dispatched and received
          as a single thing — one van, one document, one e-way bill. */}
      <RoutePicker
        stores={stores}
        loading={storesLoading}
        error={storesError}
        picks={picks}
        route={route}
        disabled={submitting}
        onModeChange={switchMode}
        onFromWarehouseChange={(id) => setPicks((p) => ({ ...p, fromWarehouseId: id }))}
        onToWarehouseChange={(id) => setPicks((p) => ({ ...p, toWarehouseId: id }))}
      />

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
            disabled={submitting}
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

      {/* Items — product, quantity and the two bins. The lane lives on the route card above. */}
      <ItemList
        items={items}
        limits={limits}
        options={binOptions}
        optionsLoading={binsLoading}
        routeReady={routeChosen}
        sourceName={fromWh?.name}
        destinationName={toWh?.name}
        disabled={submitting}
        onQuantityChange={setQuantity}
        onBinChange={setLineBins}
        onSplit={splitLine}
        onRemove={removeItem}
      />

      <DocumentPicker
        docType={route.docType}
        file={docFile}
        number={docNumber}
        date={docDate}
        disabled={submitting}
        onFileChange={(file) => setAttached(file && route.docType ? { file, type: route.docType } : null)}
        onNumberChange={setDocNumber}
        onDateChange={setDocDate}
      />

      <div className="mb-4">
        <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="transfer-notes">Notes (optional)</label>
        <textarea id="transfer-notes" placeholder="Reason for transfer..." value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
          disabled={submitting}
          className="flex w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-600 disabled:opacity-50" />
      </div>

      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

      <div className="fixed above-nav left-0 right-0 bg-white border-t border-slate-200 p-4 pb-safe z-50">
        {!isValid && !submitting && (
          <p className="text-xs text-slate-500 mb-2 text-center">{missingHint()}</p>
        )}
        <Button type="button" size="lg" disabled={!isValid || submitting} onClick={handleSubmit}
          className="w-full min-h-[48px] bg-green-600 hover:bg-green-700">
          {submitting ? (
            <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Uploading and creating…</>
          ) : (
            `${isAutoApproved ? "Create" : "Submit"} transfer · ${items.length} item${items.length !== 1 ? "s" : ""}`
          )}
        </Button>
      </div>

      <ActionConfirmation
        open={!!receipt}
        onClose={() => { const to = receipt?.redirectTo ?? "/transfers"; setReceipt(null); router.push(to); }}
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
