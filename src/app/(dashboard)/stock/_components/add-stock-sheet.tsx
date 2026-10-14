"use client";

import { useState, useEffect, useRef } from "react";
import { X, Loader2, AlertTriangle, PackagePlus, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";

// ─── Add stock directly from /stock (plan 1410-stock-quick-add, Part B) ──────────────────
//
// The owner's ask (14 Oct 2026): "GT lock has 599, add 5" — without a stock audit (R2). The
// sheet shows the product's OWN bin, read-only (owner, 14 Oct, plan §7: "it must show the
// product related bin not all bin … only readable"; the route decides it — the rule's bin, else
// the home bin), asks a quantity and a reason, and only asks "assembled or not" where the
// answer means something (R3, R4, Q2, Q3). A product with no bin cannot take stock here at all
// ("no bin means there can't be add stock"): the sheet says why and offers no Add.
//
//   - a normal bin, product with unit codes → Assembled __ + Not assembled __ (Q3);
//   - a non-assemblable bin → one Quantity, no question (R4);
//   - a product with no unit codes yet → one Quantity, added without codes (Q2).
//
// Everything it checks, POST /api/products/[id]/add-stock checks again — this is the
// cosmetic half. Same overlay shape as reorder-sheet.tsx: a bottom sheet on a phone, a centred
// card from `sm:`, Escape closes, focus returns to the row button that opened it.

const log = createLogger("stock:add-sheet");

/** The row the sheet was opened from — only what the header needs before the context loads. */
export interface AddStockTarget {
  id: string;
  name: string;
  sku: string;
}

interface AddStockBin {
  id: string;
  code: string;
  name: string;
  nonAssemblable: boolean;
  warehouseId: string;
  warehouseName: string;
}

/** GET /api/products/[id]/add-stock. */
interface AddStockContext {
  product: { id: string; name: string; sku: string; currentStock: number; binId: string | null; status: string };
  /** The product has unit codes somewhere — only then are new units coded and split. */
  tracked: boolean;
  /** Stock beyond the product's live units. */
  withoutCodes: number;
  /** THE bin these go into (src/lib/stock/add-stock-bin.ts), or null — then no Add stock. */
  bin: AddStockBin | null;
  /** "home" = the product's home bin; "rule" = a home-bin rule's bin (the rule wins). */
  binSource: "home" | "rule" | null;
  /** The rule's label when a rule placed it, e.g. "Category Rule". */
  binRule: string | null;
  /** Why there is no bin, in words the person can act on. */
  noBinReason: string | null;
}

/** POST /api/products/[id]/add-stock — 201, or 200 with `duplicate: true` for a repeat. */
export interface AddStockResult {
  productId: string;
  added: number;
  newStock: number;
  codes: number;
  duplicate: boolean;
  binCode: string;
  warehouseName: string;
}

/** What the page is told after an add: the result, plus the name it shows in its line. */
export interface AddStockDone extends AddStockResult {
  productName: string;
}

interface Props {
  open: boolean;
  product: AddStockTarget | null;
  onClose: () => void;
  onAdded: (done: AddStockDone) => void;
}

// The route's limits (quickAddStockSchema, src/lib/validations.ts) — mirrored so the button
// can say what is wrong before a round trip; the route stays the judge.
const MAX_QTY = 5000;
const REASON_MIN = 3;
const REASON_MAX = 300;
const REASON_EXAMPLES = ["Found in godown", "Customer return", "Count correction"];

const n = (v: number) => v.toLocaleString("en-IN");

/** Keep digits only, no leading zeros. Five digits, so "over 5,000" can still be said. */
function digits(v: string) {
  return v.replace(/\D/g, "").replace(/^0+(?=\d)/, "").slice(0, 5);
}

function toInt(v: string) {
  return v === "" ? 0 : Number(v);
}

/**
 * One id per submission, so a double tap or a retry adds once (the route dedupes on it).
 * `crypto.randomUUID` exists only in a secure context (https, localhost); on plain http over the
 * shop's LAN it is missing, so the same RFC 4122 v4 layout is built from getRandomValues.
 */
function newRequestId(): string {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === "function") return c.randomUUID();
  const b = new Uint8Array(16);
  c.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function binTitle(b: AddStockBin) {
  return !b.name || b.name === b.code ? b.code : `${b.code} — ${b.name}`;
}

export function AddStockSheet({ open, product, onClose, onAdded }: Props) {
  const [ctx, setCtx] = useState<AddStockContext | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadNonce, setLoadNonce] = useState(0);

  // In a split, these are the two figures. With one Quantity box, `unassembled` is that box
  // and `assembled` stays empty — the route takes an uncoded or no-assembly add that way.
  const [assembled, setAssembled] = useState("");
  const [unassembled, setUnassembled] = useState("");
  const [reason, setReason] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [timedOut, setTimedOut] = useState(false);

  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<Element | null>(null);
  const requestIdRef = useRef<string | null>(null);
  // Read by the keyboard listener, which is attached once per opening — so a re-render of the
  // page (a new `onClose` every time) or the busy flag flipping does not re-run the focus logic.
  const submittingRef = useRef(false);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    submittingRef.current = submitting;
    onCloseRef.current = onClose;
  });

  // Reset whenever the sheet opens for a product. Done during render (React's "adjusting state
  // when a prop changes", as assembly-level-sheet.tsx does), not in an effect, so the previous
  // product's figures are never painted for a frame.
  const productId = product?.id ?? null;
  const resetKey = open && productId ? productId : null;
  const [lastResetKey, setLastResetKey] = useState<string | null>(null);
  if (resetKey !== lastResetKey) {
    setLastResetKey(resetKey);
    if (resetKey) {
      setCtx(null);
      setLoading(true);
      setLoadError(null);
      setAssembled("");
      setUnassembled("");
      setReason("");
      setSubmitting(false);
      setSubmitError(null);
      setTimedOut(false);
    }
  }

  // One request id per opening, reused by every retry of it (the route's dedupe key).
  useEffect(() => {
    if (!open || !productId) return;
    requestIdRef.current = newRequestId();
  }, [open, productId]);

  // The context: the product, whether it has unit codes, and its one bin (or why it has none).
  useEffect(() => {
    if (!open || !productId) return;
    let cancelled = false;
    const started = Date.now();
    void apiTry<AddStockContext>(`/api/products/${productId}/add-stock`).then((res) => {
      if (cancelled) return;
      if (res.data) {
        setCtx(res.data);
        log.debug("add-stock context loaded", {
          productId,
          tracked: res.data.tracked,
          binId: res.data.bin?.id ?? null,
          binSource: res.data.binSource,
          ms: Date.now() - started,
        });
      } else {
        log.error("add-stock context failed", { productId, status: res.status, message: res.error });
        setLoadError(res.error || "Could not load this product");
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [open, productId, loadNonce]);

  // Escape, scroll lock, focus in and focus back — once per opening.
  useEffect(() => {
    if (!open) return;
    triggerRef.current = document.activeElement;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submittingRef.current) onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    // The panel, not a field: focusing an input would open the phone keyboard over the sheet.
    panelRef.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      (triggerRef.current as HTMLElement | null)?.focus?.();
    };
  }, [open]);

  if (!open || !product) return null;

  const bin = ctx?.bin ?? null;
  const tracked = ctx?.tracked ?? false;
  // The split is asked only where it means something: units get codes AND the bin builds.
  const split = tracked && !(bin?.nonAssemblable ?? false);
  const a = split ? toInt(assembled) : 0;
  const u = toInt(unassembled);
  const qty = a + u;
  const qtyOk = qty >= 1 && qty <= MAX_QTY;
  const inactive = ctx ? ctx.product.status !== "ACTIVE" : false;

  // The first thing standing between the person and Add, said in words.
  const problem = !ctx
    ? null
    : inactive
      ? `${ctx.product.name} is not active — restore it before adding stock`
      : !bin
        ? "No bin — stock cannot be added to this product"
        : qty < 1
            ? "Enter how many to add"
            : qty > MAX_QTY
              ? `At most ${n(MAX_QTY)} at a time`
              : reason.trim().length < REASON_MIN
                ? "Say why stock is being added (at least 3 characters)"
                : null;
  const canSubmit = Boolean(ctx) && !problem && !submitting && !loading;

  const preview =
    ctx && bin && qtyOk
      ? `${n(ctx.product.currentStock)} → ${n(ctx.product.currentStock + qty)} in ${bin.warehouseName} · bin ${bin.code} · ${
          tracked ? `${n(qty)} new unit code${qty === 1 ? "" : "s"}` : "no codes"
        }`
      : null;

  function retryLoad() {
    setLoadError(null);
    setLoading(true);
    setLoadNonce((v) => v + 1);
  }

  async function handleAdd() {
    if (!ctx || !bin || !product || !canSubmit) return;
    const requestId = requestIdRef.current ?? newRequestId();
    requestIdRef.current = requestId;
    setSubmitting(true);
    setSubmitError(null);
    setTimedOut(false);

    const body = {
      binId: bin.id,
      assembled: split ? a : 0,
      unassembled: split ? u : qty,
      reason: reason.trim(),
      requestId,
    };
    log.debug("add-stock submit", { productId: product.id, binId: bin.id, qty, split, tracked });
    // 45 s: the route's transaction may take up to 30. A timeout is safe to retry — the same
    // request id makes the second tap answer the first one's result instead of adding again.
    const res = await apiTry<AddStockResult>(`/api/products/${product.id}/add-stock`, {
      method: "POST",
      json: body,
      timeoutMs: 45_000,
    });
    setSubmitting(false);

    if (!res.data) {
      const context = { productId: product.id, binId: bin.id, qty, status: res.status, message: res.error };
      // 4xx is the route refusing with a sentence (rule bin, inactive, no permission) — shown as
      // sent. Anything else is a fault.
      if (res.status && res.status >= 400 && res.status < 500) log.warn("add-stock refused", context);
      else log.error("add-stock failed", { ...context, timedOut: res.isTimeout });
      setSubmitError(res.error || "Could not add the stock");
      setTimedOut(res.isTimeout);
      return;
    }

    if (res.data.duplicate) {
      log.info("add-stock answered by an earlier request", { productId: product.id, newStock: res.data.newStock });
    } else {
      log.info("stock added", {
        productId: product.id, binId: bin.id, added: res.data.added, newStock: res.data.newStock, codes: res.data.codes,
      });
    }
    onAdded({ ...res.data, productName: ctx.product.name });
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/40 sm:p-4"
      onClick={() => !submitting && onClose()}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-stock-title"
        className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl max-h-[88vh] flex flex-col outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between p-4 border-b border-slate-100 shrink-0">
          <div className="pr-3 min-w-0">
            <h2 id="add-stock-title" className="text-base font-bold text-slate-900 flex items-center gap-1.5">
              <PackagePlus className="h-4 w-4 text-emerald-600" aria-hidden /> Add stock
            </h2>
            <p className="text-xs text-slate-500 mt-0.5 truncate" title={`${product.name} · ${product.sku}`}>
              {product.name} · {product.sku}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            aria-label="Close"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center -mr-2 -mt-2 text-slate-400 hover:text-slate-600 disabled:opacity-50 focus-ring rounded-lg"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form
          className="flex flex-col min-h-0"
          aria-busy={submitting}
          onSubmit={(e) => {
            e.preventDefault();
            void handleAdd();
          }}
        >
          <div className="p-4 space-y-4 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-10" role="status">
                <Loader2 className="h-5 w-5 animate-spin text-slate-400" aria-hidden />
                <span className="text-sm text-slate-500">Loading bin and stock…</span>
              </div>
            ) : loadError ? (
              <div className="space-y-3">
                <div className="flex items-start gap-2 p-3 rounded-lg border border-red-200 bg-red-50" role="alert">
                  <AlertTriangle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" aria-hidden />
                  <p className="text-xs text-red-700 break-words">{loadError}</p>
                </div>
                <Button type="button" variant="outline" onClick={retryLoad} className="w-full min-h-[44px]">
                  <RotateCcw className="h-4 w-4 mr-1.5" aria-hidden /> Try again
                </Button>
              </div>
            ) : ctx ? (
              <>
                {/* Where the product stands now. */}
                <div className="flex items-baseline justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2.5">
                  <span className="text-xs text-slate-500">Current stock</span>
                  <span className="text-right tabular-nums">
                    <span className="text-lg font-bold text-slate-900">{n(ctx.product.currentStock)}</span>
                    {ctx.withoutCodes > 0 && (
                      <span className="block text-[11px] text-slate-500">{n(ctx.withoutCodes)} without codes</span>
                    )}
                  </span>
                </div>

                {inactive && (
                  <div className="flex items-start gap-2 p-3 rounded-lg border border-amber-200 bg-amber-50">
                    <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" aria-hidden />
                    <p className="text-xs text-amber-800">
                      {ctx.product.name} is not active. Restore it on Stock before adding stock.
                    </p>
                  </div>
                )}

                {/* Bin — the product's own, READ-ONLY (owner, 14 Oct 2026). The route decided it and
                    refuses any other; with none, Add stock does not happen. */}
                <div>
                  <p id="add-stock-bin-label" className="text-xs font-medium text-slate-700">Bin</p>
                  {bin ? (
                    <div
                      aria-labelledby="add-stock-bin-label"
                      className="mt-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5"
                    >
                      <p className="text-sm font-semibold text-slate-900 break-words">{binTitle(bin)}</p>
                      <p className="mt-0.5 text-[11px] text-slate-500 break-words">
                        {bin.warehouseName}
                        {bin.nonAssemblable ? " · no assembly" : ""}
                        {" · "}
                        {ctx.binSource === "rule" ? `set by ${ctx.binRule ?? "a home-bin rule"}` : "home bin"}
                      </p>
                      {!ctx.product.binId && (
                        <p className="mt-1 text-[11px] text-slate-500">
                          This product has no home bin yet — {bin.code} becomes its home bin.
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="mt-1 flex items-start gap-2 p-3 rounded-lg border border-amber-200 bg-amber-50" role="alert">
                      <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" aria-hidden />
                      <p className="text-xs text-amber-800 break-words">
                        {ctx.noBinReason ?? `${ctx.product.name} has no bin — stock cannot be added to it.`}
                      </p>
                    </div>
                  )}
                </div>

                {/* Nothing to fill in without a bin — the add cannot happen. */}
                {bin && (
                  <>
                    {/* Quantity — split only where the answer means something (R3, R4, Q2, Q3). */}
                    {split ? (
                      <fieldset disabled={submitting || inactive} className="min-w-0">
                        <legend className="text-xs font-medium text-slate-700">Quantity</legend>
                        <div className="mt-1 grid grid-cols-2 gap-2">
                          <div>
                            <label htmlFor="add-stock-assembled" className="text-[11px] text-slate-500">Assembled</label>
                            <Input
                              id="add-stock-assembled"
                              inputMode="numeric"
                              pattern="[0-9]*"
                              autoComplete="off"
                              placeholder="0"
                              value={assembled}
                              onChange={(e) => {
                                setAssembled(digits(e.target.value));
                                setSubmitError(null);
                              }}
                              className="mt-0.5 h-11 text-base sm:text-sm tabular-nums"
                            />
                          </div>
                          <div>
                            <label htmlFor="add-stock-unassembled" className="text-[11px] text-slate-500">Not assembled</label>
                            <Input
                              id="add-stock-unassembled"
                              inputMode="numeric"
                              pattern="[0-9]*"
                              autoComplete="off"
                              placeholder="0"
                              value={unassembled}
                              onChange={(e) => {
                                setUnassembled(digits(e.target.value));
                                setSubmitError(null);
                              }}
                              className="mt-0.5 h-11 text-base sm:text-sm tabular-nums"
                            />
                          </div>
                        </div>
                        <p className="mt-1.5 text-[11px] text-slate-500">
                          <span className="font-semibold text-slate-700 tabular-nums">Total {n(qty)}</span>
                          {" · "}Not-assembled units go to the assembly queue.
                        </p>
                      </fieldset>
                    ) : (
                      <div>
                        <label htmlFor="add-stock-qty" className="text-xs font-medium text-slate-700">Quantity</label>
                        <Input
                          id="add-stock-qty"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          autoComplete="off"
                          placeholder="0"
                          value={unassembled}
                          disabled={submitting || inactive}
                          onChange={(e) => {
                            setUnassembled(digits(e.target.value));
                            setSubmitError(null);
                          }}
                          className="mt-1 h-11 text-base sm:text-sm tabular-nums"
                        />
                        {!tracked ? (
                          <p className="mt-1.5 text-[11px] text-slate-500">
                            This product has no unit codes yet — it is added to the count without codes.
                            Give codes to the whole bin with a stock audit.
                          </p>
                        ) : bin?.nonAssemblable ? (
                          <p className="mt-1.5 text-[11px] text-slate-500">
                            This bin&apos;s items are never assembled — no question to answer.
                          </p>
                        ) : null}
                      </div>
                    )}

                    {/* Reason — required; it is the only record of why the count moved. */}
                    <div>
                      <label htmlFor="add-stock-reason" className="text-xs font-medium text-slate-700">Reason</label>
                      <Input
                        id="add-stock-reason"
                        value={reason}
                        maxLength={REASON_MAX}
                        autoComplete="off"
                        placeholder="e.g. found in godown"
                        disabled={submitting || inactive}
                        onChange={(e) => setReason(e.target.value)}
                        className="mt-1 h-11 text-base sm:text-sm"
                      />
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {REASON_EXAMPLES.map((r) => (
                          <button
                            key={r}
                            type="button"
                            disabled={submitting || inactive}
                            onClick={() => setReason(r)}
                            className={`min-h-[44px] px-3 rounded-full border text-xs font-medium transition-colors focus-ring disabled:opacity-50 ${
                              reason === r
                                ? "border-slate-900 bg-slate-900 text-white"
                                : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                            }`}
                          >
                            {r}
                          </button>
                        ))}
                      </div>
                      {reason.length > REASON_MAX - 50 && (
                        <p className="mt-1 text-[11px] text-slate-400 tabular-nums">{reason.length}/{REASON_MAX}</p>
                      )}
                    </div>

                    {preview && (
                      <p
                        className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800 tabular-nums break-words"
                        aria-live="polite"
                      >
                        {preview}
                      </p>
                    )}
                  </>
                )}

                {submitError && (
                  <div className="flex items-start gap-2 p-3 rounded-lg border border-red-200 bg-red-50" role="alert">
                    <AlertTriangle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" aria-hidden />
                    <div className="min-w-0">
                      <p className="text-xs text-red-700 break-words">{submitError}</p>
                      {timedOut && (
                        <p className="text-[11px] text-red-600 mt-1">
                          Tap Add again — it will not add twice.
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </>
            ) : null}
          </div>

          <div className="p-4 border-t border-slate-100 shrink-0 pb-safe space-y-2">
            {problem && !submitError && <p className="text-[11px] text-slate-500">{problem}</p>}
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={onClose} disabled={submitting} className="flex-1 min-h-[44px]">
                Cancel
              </Button>
              <Button type="submit" disabled={!canSubmit} className="flex-1 min-h-[44px]">
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    <span className="sr-only">Adding…</span>
                  </>
                ) : qtyOk ? (
                  `Add ${n(qty)}`
                ) : (
                  "Add"
                )}
              </Button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

export default AddStockSheet;
