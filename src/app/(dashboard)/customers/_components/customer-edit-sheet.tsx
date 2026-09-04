"use client";

import { useEffect, useRef, useState } from "react";
import { X, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";

const log = createLogger("customers:form");

/** The subset of a customer row this form reads and writes. */
export interface CustomerDraft {
  id: string;
  name: string;
  phone: string;
  whatsapp: string | null;
  email: string | null;
  address: string | null;
  type: string;
}

interface CustomerEditSheetProps {
  /** The customer being edited. Never null — the parent only mounts this with a row. */
  editing: CustomerDraft;
  open: boolean;
  onClose: () => void;
  /** Called after a successful save, so the list can reload. */
  onSaved: (message: string) => void;
}

const TYPES = [
  { key: "WALK_IN", label: "Walk-in" },
  { key: "REGULAR", label: "Regular" },
  { key: "DEALER", label: "Dealer" },
];

/** What the server accepts: last 10 digits, everything else stripped (customerSchema). */
function normalisePhone(raw: string) {
  return raw.replace(/\D/g, "").slice(-10);
}

/**
 * Edit a customer.
 *
 * ─── EDIT ONLY, BY DESIGN ────────────────────────────────────────────────────────────────
 *
 * There is no "add customer" any more. A customer row appears when a Zoho invoice is
 * imported or a service job is opened; both resolve on `phone`, which is the identity. A
 * hand-typed customer was a second way to create the same person under a mistyped number.
 *
 * `POST /api/customers` still exists and is still create-or-find — the Zoho invoice import
 * depends on it. What is gone is the UI that let a person call it.
 *
 * ─── BOTTOM SHEET ON A PHONE, DIALOG ON A DESKTOP ────────────────────────────────────────
 *
 * `items-end sm:items-center` with `rounded-t-2xl sm:rounded-2xl`, matching the modals
 * already in /vendor-issues and /deliveries. A centered dialog on a 375px screen puts the
 * fields under the thumb's reach; a sheet rising from the bottom of a monitor looks broken.
 *
 * ─── PHONE IS THE IDENTITY, SO THE COLLISION IS THE INTERESTING CASE ─────────────────────
 *
 * `Customer.phone` is `@unique`; it is what the counter and the workshop both resolve to.
 * Changing a number to one that is already taken answers 409 by name, which is surfaced in
 * the error banner rather than swallowed.
 */
export function CustomerEditSheet({ editing, open, onClose, onSaved }: CustomerEditSheetProps) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [type, setType] = useState("WALK_IN");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const panelRef = useRef<HTMLDivElement>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  // Reload the fields whenever the sheet opens. Keyed on `open` as well as `editing` so
  // that closing a half-typed create and reopening it starts clean rather than resuming a
  // draft the user already walked away from.
  useEffect(() => {
    if (!open) return;
    setName(editing.name);
    setPhone(editing.phone);
    setWhatsapp(editing.whatsapp ?? "");
    setEmail(editing.email ?? "");
    setAddress(editing.address ?? "");
    setType(editing.type);
    setError(null);
  }, [open, editing]);

  // Esc closes, focus lands on the first field, and the page behind stops scrolling.
  // Without the scroll lock a phone scrolls the list under the sheet as you swipe the form.
  useEffect(() => {
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !saving) onClose();
    };
    document.addEventListener("keydown", onKey);
    firstFieldRef.current?.focus();

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, saving, onClose]);

  if (!open) return null;

  const cleanPhone = normalisePhone(phone);
  const phoneValid = cleanPhone.length === 10;
  const canSave = name.trim().length > 0 && phoneValid && !saving;

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    setError(null);

    // Empty strings, not undefined: on an edit, clearing a field must actually clear it.
    // `undefined` is how the update schema spells "leave this alone", so sending it here
    // would make an erased WhatsApp number silently come back.
    const payload = {
      name: name.trim(),
      phone: cleanPhone,
      whatsapp: normalisePhone(whatsapp),
      email: email.trim(),
      address: address.trim(),
      type,
    };

    try {
      await apiFetch(`/api/customers/${editing.id}`, { method: "PUT", json: payload });
      log.info("customer saved", { customerId: editing.id });
      onSaved(`${payload.name} updated`);
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not save the customer";
      setError(msg);
      log.error("customer save failed", { customerId: editing.id, message: msg });
    } finally {
      setSaving(false);
    }
  }

  const field = "block text-[10px] font-medium text-slate-500 uppercase tracking-wide mb-1";

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/40 sm:p-4"
      onClick={() => !saving && onClose()}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Edit customer"
        className="bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl max-h-[88vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between p-4 border-b border-slate-100 shrink-0">
          <div className="pr-3">
            <h2 className="text-base font-bold text-slate-900">Edit customer</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              The phone number is the customer&apos;s identity — the counter and the workshop
              both resolve to it.
            </p>
          </div>
          <button
            onClick={() => !saving && onClose()}
            aria-label="Close"
            className="p-1.5 rounded-full hover:bg-slate-100 shrink-0 focus-ring"
          >
            <X className="h-5 w-5 text-slate-500" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5">
              <p className="text-xs text-red-700">{error}</p>
            </div>
          )}

          <div>
            <label htmlFor="cust-name" className={field}>Name</label>
            <Input
              id="cust-name"
              ref={firstFieldRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ravi Kumar"
              maxLength={200}
            />
          </div>

          <div>
            <label htmlFor="cust-phone" className={field}>Phone</label>
            <Input
              id="cust-phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="9876543210"
              inputMode="tel"
              className="tabular-nums"
            />
            {/* Only once something has been typed — an untouched field is not an error. */}
            {phone.length > 0 && !phoneValid && (
              <p className="text-[11px] text-red-600 mt-1">
                Needs 10 digits — {cleanPhone.length} so far.
              </p>
            )}
          </div>

          <div>
            <label htmlFor="cust-whatsapp" className={field}>
              WhatsApp <span className="normal-case tracking-normal text-slate-400">— if different</span>
            </label>
            <Input
              id="cust-whatsapp"
              value={whatsapp}
              onChange={(e) => setWhatsapp(e.target.value)}
              placeholder="Leave blank to use the phone number"
              inputMode="tel"
              className="tabular-nums"
            />
          </div>

          <div>
            <label htmlFor="cust-email" className={field}>Email</label>
            <Input
              id="cust-email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="optional"
              inputMode="email"
            />
          </div>

          <div>
            <label htmlFor="cust-address" className={field}>Address</label>
            <Input
              id="cust-address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="optional"
            />
          </div>

          <div>
            <span className={field}>Type</span>
            <div className="flex gap-1.5 flex-wrap">
              {TYPES.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setType(t.key)}
                  aria-pressed={type === t.key}
                  className={`min-h-[40px] px-3.5 rounded-full text-xs font-medium transition-colors focus-ring ${
                    type === t.key ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex gap-2 p-4 border-t border-slate-100 shrink-0">
          <Button variant="outline" onClick={onClose} disabled={saving} className="flex-1 min-h-[44px]">
            Cancel
          </Button>
          {/* Disabled while saving — a double tap on a create is a duplicate customer. */}
          <Button onClick={handleSave} disabled={!canSave} className="flex-1 min-h-[44px]">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : editing ? "Save" : "Add customer"}
          </Button>
        </div>
      </div>
    </div>
  );
}
