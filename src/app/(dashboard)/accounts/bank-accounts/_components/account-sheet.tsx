"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";
import { BANK_CODES, BANK_LABELS, type BankAccountRow, type BankCode, type StoreOption } from "./types";

const log = createLogger("accounts:bank-accounts");

interface AccountSheetProps {
  /** The account being edited, or null to add one. */
  editing: BankAccountRow | null;
  /** Active stores from /api/stores; null while loading. */
  stores: StoreOption[] | null;
  storesError: string | null;
  onClose: () => void;
  /** After a successful save, with a sentence for the page. */
  onSaved: (message: string) => void;
}

/**
 * Add or edit a bank account (plan 1210-bank-accounts-and-suspense, §3 B3). Shown only to holders
 * of Bank Reconciliation › Approve — cosmetic: POST / PATCH /api/bank-accounts re-check (Q8).
 *
 * Store, last four digits, Zoho id and "reconcile from" are optional (owner, 13 Oct 2026): the
 * digits and Zoho ids are not known yet, and HDFC Centre / ICICI / Dhanlaxmi have no store until
 * one is set up. A blank field is sent as null, so clearing it on an edit really clears it.
 *
 * A bottom sheet on a phone, a centred dialog from `sm` (the customer-edit-sheet pattern).
 */
export function AccountSheet({ editing, stores, storesError, onClose, onSaved }: AccountSheetProps) {
  const [name, setName] = useState(editing?.name ?? "");
  const [bank, setBank] = useState<BankCode>(editing?.bank ?? "HDFC");
  const [last4, setLast4] = useState(editing?.accountLast4 ?? "");
  const [storeId, setStoreId] = useState(editing?.storeId ?? "");
  const [reconcileFrom, setReconcileFrom] = useState(editing?.reconcileFrom ?? "");
  const [zohoId, setZohoId] = useState(editing?.zohoAccountId ?? "");
  const [sortOrder, setSortOrder] = useState(String(editing?.sortOrder ?? 0));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  // Once, on open: focus the name and stop the page behind from scrolling. Separate from the Esc
  // handler below, so a parent re-render (the store list arriving) never pulls focus mid-typing.
  useEffect(() => {
    firstFieldRef.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  // Esc closes — but not mid-save: the answer still has to land somewhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !saving) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [saving, onClose]);

  const nameOk = name.trim().length >= 2 && name.trim().length <= 60;
  const last4Ok = last4 === "" || /^\d{4}$/.test(last4);
  const sortOk = sortOrder === "" || (/^\d{1,3}$/.test(sortOrder));
  const canSave = nameOk && last4Ok && sortOk && !saving;

  // The account's own store may be retired and so missing from /api/stores — keep it selectable.
  const storeOptions: StoreOption[] = [...(stores ?? [])];
  if (editing?.store && !storeOptions.some((s) => s.id === editing.store!.id)) storeOptions.push(editing.store);

  async function save() {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    const payload = {
      name: name.trim(),
      bank,
      accountLast4: last4 || null,
      storeId: storeId || null,
      zohoAccountId: zohoId.trim() || null,
      reconcileFrom: reconcileFrom || null,
      sortOrder: sortOrder === "" ? 0 : Number(sortOrder),
    };
    const { data, error: err, status } = await apiTry<BankAccountRow>(
      editing ? `/api/bank-accounts/${encodeURIComponent(editing.id)}` : "/api/bank-accounts",
      { method: editing ? "PATCH" : "POST", json: payload }
    );
    if (err || !data) {
      log.error(editing ? "account update failed" : "account create failed", {
        bankAccountId: editing?.id,
        status,
        message: err,
      });
      setError(err || "The account could not be saved.");
      setSaving(false);
      return;
    }
    log.info(editing ? "account updated" : "account created", { bankAccountId: data.id });
    onSaved(editing ? `${data.name} saved` : `${data.name} added`);
  }

  const field = "block text-[10px] font-medium text-slate-500 uppercase tracking-wide mb-1";
  const help = "text-[11px] text-slate-500 mt-1";

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/40 sm:p-4"
      onClick={() => !saving && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={editing ? `Edit ${editing.name}` : "Add a bank account"}
        className="bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between p-4 border-b border-slate-100 shrink-0">
          <div className="pr-3">
            <h2 className="text-base font-bold text-slate-900">{editing ? `Edit ${editing.name}` : "Add a bank account"}</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Every statement upload names one of these, so HDFC Hub can be told from HDFC Centre.
            </p>
          </div>
          <button
            type="button"
            onClick={() => !saving && onClose()}
            aria-label="Close"
            className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-full hover:bg-slate-100 shrink-0 focus-ring"
          >
            <X className="h-5 w-5 text-slate-500" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {error && (
            <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5">
              <p className="text-xs text-red-700">{error}</p>
            </div>
          )}

          <div>
            <label htmlFor="ba-name" className={field}>Name</label>
            <Input
              id="ba-name"
              ref={firstFieldRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="HDFC Hub"
              maxLength={60}
            />
            {name.length > 0 && !nameOk && <p className="text-[11px] text-red-600 mt-1">At least 2 characters.</p>}
          </div>

          <div>
            <span className={field}>Bank</span>
            <div className="flex gap-1.5 flex-wrap" role="group" aria-label="Bank">
              {BANK_CODES.map((b) => (
                <button
                  key={b}
                  type="button"
                  onClick={() => setBank(b)}
                  aria-pressed={bank === b}
                  className={`min-h-[44px] px-4 rounded-full text-xs font-medium transition-colors focus-ring ${
                    bank === b ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"
                  }`}
                >
                  {BANK_LABELS[b]}
                </button>
              ))}
            </div>
            <p className={help}>Chooses how the statement file is read.</p>
          </div>

          <div>
            <label htmlFor="ba-last4" className={field}>
              Last 4 digits <span className="normal-case tracking-normal text-slate-400">— optional</span>
            </label>
            <Input
              id="ba-last4"
              value={last4}
              onChange={(e) => setLast4(e.target.value.replace(/\D/g, "").slice(0, 4))}
              placeholder="1234"
              inputMode="numeric"
              className="tabular-nums"
            />
            {!last4Ok && <p className="text-[11px] text-red-600 mt-1">Exactly 4 digits, or leave blank.</p>}
            <p className={help}>Only the last four — never the full account number.</p>
          </div>

          <div>
            <label htmlFor="ba-store" className={field}>
              Store <span className="normal-case tracking-normal text-slate-400">— optional</span>
            </label>
            <select
              id="ba-store"
              value={storeId}
              onChange={(e) => setStoreId(e.target.value)}
              disabled={stores === null && !storesError}
              className="w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus-ring disabled:opacity-60"
            >
              <option value="">No store yet</option>
              {storeOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.code})
                </option>
              ))}
            </select>
            {stores === null && !storesError && <p className={help}>Loading stores…</p>}
            {storesError && (
              <p className="text-[11px] text-amber-700 mt-1">
                Stores could not be loaded ({storesError}). Save without one and pick it later.
              </p>
            )}
          </div>

          <div>
            <label htmlFor="ba-from" className={field}>
              Reconcile from <span className="normal-case tracking-normal text-slate-400">— optional</span>
            </label>
            <Input id="ba-from" type="date" value={reconcileFrom} onChange={(e) => setReconcileFrom(e.target.value)} />
            <p className={help}>Lines dated before this day are not counted on the weekly reconciliation tile.</p>
          </div>

          <div>
            <label htmlFor="ba-zoho" className={field}>
              Zoho Books account id <span className="normal-case tracking-normal text-slate-400">— optional</span>
            </label>
            <Input
              id="ba-zoho"
              value={zohoId}
              onChange={(e) => setZohoId(e.target.value)}
              placeholder="Leave blank if not known"
              maxLength={40}
              className="tabular-nums"
            />
            <p className={help}>The bank account&apos;s id in Zoho Books, used when payments are sent there.</p>
          </div>

          <div>
            <label htmlFor="ba-sort" className={field}>Order on screens</label>
            <Input
              id="ba-sort"
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value.replace(/\D/g, "").slice(0, 3))}
              inputMode="numeric"
              className="tabular-nums w-24"
            />
            <p className={help}>Lower comes first. Accounts with the same number sort by name.</p>
          </div>
        </div>

        <div className="flex gap-2 p-4 border-t border-slate-100 shrink-0">
          <Button variant="outline" onClick={onClose} disabled={saving} className="flex-1 min-h-[44px]">
            Cancel
          </Button>
          {/* Disabled while saving — a double tap on Add would try the same name twice. */}
          <Button onClick={() => void save()} disabled={!canSave} className="flex-1 min-h-[44px]">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : editing ? "Save" : "Add account"}
          </Button>
        </div>
      </div>
    </div>
  );
}
