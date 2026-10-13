"use client";

// Apply credit — use part of a vendor credit note against one bill of the same vendor (plan 1210
// credit notes, Part 4, 13 Oct 2026: Q1 = b, D18, D19).
//
// Opened from either side, and picks the other:
//   from a credit (the vendor's Credits tab)  → pick an open bill of the same vendor, same store
//                                               when both stores are known
//   from a bill (/bills/[id])                 → pick one of the vendor's open credits that fit
//                                               this bill's store
// The amount is pre-filled with the largest allowed — the smaller of the credit's open amount and
// the bill's remaining amount — and capped there. Apply is disabled while busy. The API re-checks
// everything; a 409 means someone else moved the same credit or bill first, so the options are
// re-read and the parent is told to reload.
//
// Applied HERE only: Zoho Books is not told (Q1 = b), and the sheet says so.
//
// Layout follows src/components/reorder-sheet.tsx: a bottom sheet on a phone, a centred card from
// `sm:`, Escape closes, focus returns to the button that opened it.
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { X, Loader2, AlertTriangle, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";

const log = createLogger("vendors:credit-apply");

const round2 = (n: number) => Math.round(n * 100) / 100;
const inr = (n: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(n);
const shortDate = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "2-digit" }) : "";

/** The credit side, when the sheet is opened from a credit. */
export interface ApplyCreditCredit {
  id: string;
  creditNoteNo: string;
  referenceNo?: string | null;
  open: number;
  storeId: string | null;
  storeName?: string | null;
}

/** The bill side, when the sheet is opened from a bill. */
export interface ApplyCreditBill {
  id: string;
  billNo: string;
  remaining: number;
  storeId: string | null;
  storeName?: string | null;
}

/** What POST /api/vendor-credits/[id]/apply answers. */
export interface ApplyCreditResult {
  applicationId: string;
  credit: { id: string; creditNoteNo: string; open: number };
  bill: { id: string; billNo: string; remaining: number; status: string };
  amount: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  vendorId: string;
  /** Set when opened from a credit; the sheet then picks a bill. */
  credit?: ApplyCreditCredit | null;
  /** Set when opened from a bill; the sheet then picks a credit. */
  bill?: ApplyCreditBill | null;
  onApplied: (result: ApplyCreditResult) => void;
  /** Called after a 409 — the credit or bill changed under us — so the parent reloads. */
  onStale?: () => void;
}

/** One thing to pick: a bill (credit mode) or a credit (bill mode). */
interface Option {
  id: string;
  label: string;
  sub: string;
  /** Bill remaining, or credit open. */
  left: number;
  storeId: string | null;
  storeName: string | null;
}

// Rows of GET /api/bills. `storeId` / `store` are read defensively: the list route carries the
// store chip since plan 1210 Part 2.4, and a missing store reads as "not known" — the apply route
// refuses a store mismatch on its own either way.
interface BillListRow {
  id: string;
  billNo: string;
  amount: number;
  paidAmount: number;
  status: string;
  billDate: string;
  dueDate: string;
  storeId?: string | null;
  store?: { id: string; name: string } | null;
}

interface BillDetailForCredits {
  amount: number;
  paidAmount: number;
  status: string;
  openCredits: Array<{
    id: string;
    creditNoteNo: string;
    referenceNo: string | null;
    creditDate: string;
    open: number;
    storeId: string | null;
    storeName: string | null;
  }>;
}

const OPEN_BILL_STATUSES = ["PENDING", "PARTIALLY_PAID", "OVERDUE"] as const;

export function ApplyCreditSheet({ open, onClose, vendorId, credit, bill, onApplied, onStale }: Props) {
  const mode: "pick-bill" | "pick-credit" = credit ? "pick-bill" : "pick-credit";

  const [options, setOptions] = useState<Option[]>([]);
  const [hiddenOtherStore, setHiddenOtherStore] = useState(0);
  const [fixedLeft, setFixedLeft] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const triggerRef = useRef<Element | null>(null);

  // The fixed side's own amount left: from the parent, refreshed by a bill re-read in bill mode.
  const fixedSideLeft = fixedLeft ?? (credit ? credit.open : bill ? bill.remaining : 0);
  const fixedStoreId = credit ? credit.storeId : bill ? bill.storeId : null;
  const picked = options.find((o) => o.id === pickedId) ?? null;
  const max = picked ? round2(Math.min(picked.left, fixedSideLeft)) : 0;

  const pick = useCallback((o: Option | null, fixed: number) => {
    setPickedId(o?.id ?? null);
    setAmount(o ? String(round2(Math.min(o.left, fixed))) : "");
  }, []);

  // Primitives, not the prop objects: a parent that rebuilds `credit` / `bill` on every render
  // must not make the sheet re-fetch (and reset the pick) on every render.
  const creditId = credit?.id ?? null;
  const creditOpen = credit?.open ?? 0;
  const creditStoreId = credit?.storeId ?? null;
  const billId = bill?.id ?? null;

  const loadOptions = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      if (creditId) {
        // Open bills of this vendor: one request per open status (the list filters one status).
        const results = await Promise.all(
          OPEN_BILL_STATUSES.map((s) =>
            apiTry<BillListRow[]>(`/api/bills?vendorId=${encodeURIComponent(vendorId)}&status=${s}&limit=200`)
          )
        );
        const failed = results.find((r) => r.error);
        if (failed) throw new Error(failed.error ?? "Could not load the bills");
        // Oldest due first — the bill most likely to be paid next.
        const rows = results
          .flatMap((r) => r.data ?? [])
          .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());
        let otherStore = 0;
        const opts: Option[] = [];
        for (const b of rows) {
          const left = round2(b.amount - b.paidAmount);
          if (left <= 0.01) continue;
          const storeId = b.storeId ?? b.store?.id ?? null;
          if (creditStoreId && storeId && storeId !== creditStoreId) {
            otherStore++;
            continue;
          }
          opts.push({
            id: b.id,
            label: `Bill ${b.billNo}`,
            sub: `${shortDate(b.billDate)} · due ${shortDate(b.dueDate)}${b.status === "OVERDUE" ? " · overdue" : ""}`,
            left,
            storeId,
            storeName: b.store?.name ?? null,
          });
        }
        setOptions(opts);
        setHiddenOtherStore(otherStore);
        setFixedLeft(null);
        pick(opts.length === 1 ? opts[0] : null, creditOpen);
      } else if (billId) {
        // The bill re-read gives its fresh remaining AND the credits that fit its store.
        const { data, error: err } = await apiTry<BillDetailForCredits>(`/api/bills/${billId}`);
        if (err || !data) throw new Error(err ?? "Could not load the bill");
        const left = round2(data.amount - data.paidAmount);
        const opts: Option[] = data.openCredits.map((c) => ({
          id: c.id,
          label: c.creditNoteNo,
          sub: [shortDate(c.creditDate), c.referenceNo ? `supplier ref ${c.referenceNo}` : null].filter(Boolean).join(" · "),
          left: c.open,
          storeId: c.storeId,
          storeName: c.storeName,
        }));
        setOptions(opts);
        setHiddenOtherStore(0);
        setFixedLeft(left);
        pick(opts.length === 1 ? opts[0] : null, left);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "Could not load the choices";
      log.warn("apply options failed to load", { vendorId, creditId, billId, message });
      setLoadError(message);
    } finally {
      setLoading(false);
    }
  }, [creditId, creditOpen, creditStoreId, billId, vendorId, pick]);

  // A clean form each time the sheet opens. Kept apart from the load below, so a reload after a
  // 409 does not wipe the sentence that explains it.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setNote("");
  }, [open]);

  // Fresh choices every time the sheet opens — a credit or bill may have moved since.
  useEffect(() => {
    if (open) void loadOptions();
  }, [open, loadOptions]);

  useEffect(() => {
    if (!open) return;
    triggerRef.current = document.activeElement;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      (triggerRef.current as HTMLElement | null)?.focus?.();
    };
  }, [open, busy, onClose]);

  if (!open || (!credit && !bill)) return null;

  const amountNum = Number(amount);
  const amountValid = Number.isFinite(amountNum) && amountNum > 0 && amountNum <= max + 0.001;
  const canApply = Boolean(picked) && amountValid && !busy && !loading;

  async function apply() {
    if (!canApply || !picked) return;
    const applyCreditId = credit ? credit.id : picked.id;
    const applyBillId = bill ? bill.id : picked.id;
    setBusy(true);
    setError(null);
    const { data, error: err, status } = await apiTry<ApplyCreditResult>(`/api/vendor-credits/${applyCreditId}/apply`, {
      method: "POST",
      json: { billId: applyBillId, amount: round2(amountNum), ...(note.trim() ? { note: note.trim() } : {}) },
    });
    setBusy(false);
    if (err || !data) {
      log.warn("apply failed", { creditId: applyCreditId, billId: applyBillId, status, message: err });
      setError(err ?? "Could not apply the credit.");
      if (status === 409) {
        // Someone moved this credit or bill first: re-read the choices, and let the parent reload.
        onStale?.();
        void loadOptions();
      }
      return;
    }
    log.info("credit applied", { applicationId: data.applicationId, creditId: applyCreditId, billId: applyBillId, amount: data.amount });
    onApplied(data);
    onClose();
  }

  const title = credit
    ? `${credit.creditNoteNo} · ${inr(fixedSideLeft)} open`
    : `Bill ${bill!.billNo} · ${inr(fixedSideLeft)} left`;
  const storeNote = fixedStoreId
    ? credit
      ? "Only bills of this credit's store, or with no store set, are listed."
      : "Only credits of this bill's store, or with no store set, are listed."
    : null;

  const label = "block text-[10px] font-medium text-slate-500 uppercase tracking-wide mb-1";

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/40 sm:p-4"
      onClick={() => !busy && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Apply credit"
        className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl max-h-[88vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between p-4 border-b border-slate-100 shrink-0">
          <div className="pr-3 min-w-0">
            <h2 className="text-base font-bold text-slate-900">Apply credit</h2>
            <p className="text-xs text-slate-500 mt-0.5 truncate tabular-nums">{title}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center -mr-2 -mt-2 text-slate-400 hover:text-slate-600 disabled:opacity-50"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-4 space-y-4 overflow-y-auto">
          <div>
            <p className={label}>{mode === "pick-bill" ? "Apply to bill" : "Use credit note"}</p>
            {loading ? (
              <div className="space-y-2" aria-busy="true">
                {[0, 1].map((i) => (
                  <div key={i} className="h-14 rounded-lg bg-slate-100 animate-pulse" />
                ))}
              </div>
            ) : loadError ? (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                <p className="text-xs text-red-700">{loadError}</p>
                <button
                  type="button"
                  onClick={() => void loadOptions()}
                  className="mt-2 min-h-[44px] px-3 rounded-lg text-xs font-medium text-red-700 bg-white border border-red-200"
                >
                  Retry
                </button>
              </div>
            ) : options.length === 0 ? (
              <p className="text-xs text-slate-500 rounded-lg border border-slate-200 bg-slate-50 p-3">
                {mode === "pick-bill" ? (
                  <>No open bill of this vendor to apply it to{hiddenOtherStore > 0 ? ` (${hiddenOtherStore} open bill${hiddenOtherStore === 1 ? " is" : "s are"} another store's)` : ""}.</>
                ) : (
                  <>
                    No open credit with this vendor fits this bill. Credit notes are entered in Zoho Books and fetched on{" "}
                    <Link href="/bills?fetch=credits" className="text-blue-600 underline">Bills</Link>.
                  </>
                )}
              </p>
            ) : (
              <div role="radiogroup" className="space-y-1.5 max-h-60 overflow-y-auto">
                {options.map((o) => {
                  const selected = o.id === pickedId;
                  return (
                    <button
                      key={o.id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      disabled={busy}
                      onClick={() => pick(o, fixedSideLeft)}
                      className={`w-full min-h-[52px] flex items-center gap-2 rounded-lg border px-3 py-2 text-left transition-colors disabled:opacity-60 ${
                        selected ? "border-blue-500 bg-blue-50" : "border-slate-200 bg-white hover:bg-slate-50"
                      }`}
                    >
                      <span
                        className={`h-4 w-4 shrink-0 rounded-full border flex items-center justify-center ${
                          selected ? "border-blue-600 bg-blue-600" : "border-slate-300"
                        }`}
                      >
                        {selected && <Check className="h-3 w-3 text-white" />}
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm font-medium text-slate-900 truncate tabular-nums">{o.label}</span>
                        <span className="block text-[11px] text-slate-500 truncate tabular-nums">
                          {o.sub}
                          {o.storeName ? ` · ${o.storeName}` : ""}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block text-sm font-semibold text-slate-800 tabular-nums">{inr(o.left)}</span>
                        <span className="block text-[10px] text-slate-400">{mode === "pick-bill" ? "left" : "open"}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
            {storeNote && options.length > 0 && <p className="text-[11px] text-slate-400 mt-1">{storeNote}</p>}
          </div>

          {picked && (
            <>
              <div>
                <label className={label} htmlFor="apply-credit-amount">Amount to apply</label>
                <input
                  id="apply-credit-amount"
                  type="number"
                  inputMode="decimal"
                  min={0.01}
                  max={max}
                  step="0.01"
                  value={amount}
                  disabled={busy}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-full min-h-[44px] rounded-lg border border-slate-300 px-3 text-base tabular-nums focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                <div className="flex items-center justify-between mt-1">
                  <p className={`text-[11px] tabular-nums ${amountValid || !amount ? "text-slate-500" : "text-amber-700"}`}>
                    {amountValid || !amount ? `Up to ${inr(max)}` : `Enter more than ₹0 and at most ${inr(max)}`}
                  </p>
                  {Math.abs(amountNum - max) > 0.001 && (
                    <button
                      type="button"
                      onClick={() => setAmount(String(max))}
                      disabled={busy}
                      className="min-h-[32px] px-2 text-[11px] font-medium text-blue-600"
                    >
                      Use {inr(max)}
                    </button>
                  )}
                </div>
              </div>
              <div>
                <label className={label} htmlFor="apply-credit-note">Note (optional)</label>
                <input
                  id="apply-credit-note"
                  type="text"
                  maxLength={500}
                  value={note}
                  disabled={busy}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="e.g. short supply on this bill"
                  className="w-full min-h-[44px] rounded-lg border border-slate-300 px-3 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
            </>
          )}

          <p className="text-[11px] text-slate-500 rounded-lg bg-amber-50 border border-amber-100 px-3 py-2">
            Applied here only — Zoho Books is not told. Apply the same amount in Zoho too, so both books agree.
          </p>

          {error && (
            <div role="alert" className="flex items-start gap-2 p-3 rounded-lg border border-red-200 bg-red-50">
              <AlertTriangle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
              <p className="text-xs text-red-700 break-words">{error}</p>
            </div>
          )}
        </div>

        <div className="flex gap-2 p-4 border-t border-slate-100 shrink-0 pb-safe">
          <Button variant="outline" onClick={onClose} disabled={busy} className="flex-1 min-h-[44px]">
            Cancel
          </Button>
          <Button onClick={() => void apply()} disabled={!canApply} className="flex-1 min-h-[44px] tabular-nums">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : amountValid ? `Apply ${inr(round2(amountNum))}` : "Apply"}
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Remove a credit application made here (DELETE /api/vendor-credits/applications/[id], bills.edit).
 * Shared by the vendor's Credits tab and /bills/[id]. Returns the API's sentence on failure.
 */
export async function removeCreditApplication(applicationId: string): Promise<{ ok: true } | { ok: false; error: string; status?: number }> {
  const { error, status } = await apiTry(`/api/vendor-credits/applications/${applicationId}`, { method: "DELETE" });
  if (error) {
    log.warn("remove failed", { applicationId, status, message: error });
    return { ok: false, error, status };
  }
  log.info("credit application removed", { applicationId });
  return { ok: true };
}

export default ApplyCreditSheet;
