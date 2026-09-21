"use client";

import { useState } from "react";
import { Loader2, MessageSquare, Phone } from "lucide-react";

import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";

const log = createLogger("vendors:contact");

/** The five contact fields that live on the Vendor row. */
export interface VendorContactFields {
  contactPerson?: string | null;
  contactDesignation?: string | null;
  phone?: string | null;
  email?: string | null;
  whatsappNumber?: string | null;
}

interface Props {
  vendorId: string;
  contact: VendorContactFields;
  canEdit: boolean;
  /** Cleared fields come back as undefined, matching the `Vendor` type in src/types. */
  onSaved: (patch: { [K in keyof VendorContactFields]?: string }) => void;
}

const FIELDS: Array<{ key: keyof VendorContactFields; label: string; type: string; placeholder: string }> = [
  { key: "contactPerson", label: "Contact person", type: "text", placeholder: "Name" },
  { key: "contactDesignation", label: "Designation", type: "text", placeholder: "e.g. Sales manager" },
  { key: "phone", label: "Phone", type: "tel", placeholder: "Mobile or landline" },
  { key: "email", label: "Email", type: "email", placeholder: "orders@vendor.com" },
  { key: "whatsappNumber", label: "WhatsApp", type: "tel", placeholder: "WhatsApp number" },
];

/**
 * The vendor's ONE contact (plan 2109 R28, Q17a, owner 21 Sep 2026).
 *
 * It replaces the VendorContact list (add / delete, several per vendor) that used to sit on this
 * screen. Every field is a column on `Vendor` and is saved with the ordinary vendor update
 * (PUT /api/vendors/[id]) — one request for the whole block. `/api/vendors/[id]/contacts` is no
 * longer called; the table is dropped in a later release (rule 7).
 *
 * Email lives here too: it used to be its own editable row, added because P12 emails the PO to
 * this address and an address entered at creation could otherwise never be corrected.
 */
export function VendorContact({ vendorId, contact, canEdit, onSaved }: Props) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Record<keyof VendorContactFields, string>>(toForm(contact));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function toForm(c: VendorContactFields): Record<keyof VendorContactFields, string> {
    return {
      contactPerson: c.contactPerson ?? "",
      contactDesignation: c.contactDesignation ?? "",
      phone: c.phone ?? "",
      email: c.email ?? "",
      whatsappNumber: c.whatsappNumber ?? "",
    };
  }

  async function save() {
    setSaving(true);
    setError("");
    const json = {
      contactPerson: form.contactPerson.trim(),
      contactDesignation: form.contactDesignation.trim(),
      phone: form.phone.trim(),
      email: form.email.trim(),
      whatsappNumber: form.whatsappNumber.trim(),
    };
    try {
      await apiFetch(`/api/vendors/${vendorId}`, { method: "PUT", json });
      onSaved({
        contactPerson: json.contactPerson || undefined,
        contactDesignation: json.contactDesignation || undefined,
        phone: json.phone || undefined,
        email: json.email || undefined,
        whatsappNumber: json.whatsappNumber || undefined,
      });
      setEditing(false);
    } catch (e) {
      log.warn("save contact failed", { vendorId, error: e instanceof Error ? e.message : String(e) });
      setError(e instanceof Error ? e.message : "Could not save the contact");
    } finally {
      setSaving(false);
    }
  }

  const wa = contact.whatsappNumber || contact.phone;

  if (editing) {
    return (
      <div>
        <p className="text-xs text-slate-500 mb-1">Contact</p>
        <div className="space-y-2 bg-slate-50 rounded-lg p-2.5">
          {FIELDS.map((f) => (
            <label key={f.key} className="block">
              <span className="text-[11px] text-slate-500">{f.label}</span>
              <input
                type={f.type}
                inputMode={f.type === "tel" ? "tel" : undefined}
                value={form[f.key]}
                onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                placeholder={f.placeholder}
                className="flex min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
              />
            </label>
          ))}
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex gap-2">
            <Button onClick={save} disabled={saving} className="flex-1 min-h-[44px]">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save contact"}
            </Button>
            <Button
              variant="outline"
              onClick={() => { setEditing(false); setError(""); }}
              disabled={saving}
              className="min-h-[44px]"
            >
              Cancel
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const empty = !contact.contactPerson && !contact.phone && !contact.email && !contact.whatsappNumber;

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <p className="text-xs text-slate-500">Contact</p>
        {canEdit && (
          <button
            onClick={() => { setForm(toForm(contact)); setEditing(true); }}
            className="text-xs text-blue-600 min-h-[32px] px-1"
          >
            Edit
          </button>
        )}
      </div>
      {empty ? (
        <p className="text-xs text-slate-400">No contact yet.</p>
      ) : (
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0 space-y-0.5">
            <p className="text-sm text-slate-700">
              {contact.contactPerson || <span className="text-slate-400">No name</span>}
              {contact.contactDesignation && (
                <span className="text-xs text-slate-400"> ({contact.contactDesignation})</span>
              )}
            </p>
            {contact.phone && <p className="text-xs text-slate-500">Phone {contact.phone}</p>}
            {contact.whatsappNumber && contact.whatsappNumber !== contact.phone && (
              <p className="text-xs text-slate-500">WhatsApp {contact.whatsappNumber}</p>
            )}
            <p className="text-xs text-slate-500 break-all">
              {contact.email || <span className="text-slate-400">No email</span>}
            </p>
          </div>
          {contact.phone && (
            <a href={`tel:${contact.phone}`} className="p-1.5 text-slate-500 hover:bg-slate-100 rounded-full" title="Call">
              <Phone className="h-4 w-4" />
            </a>
          )}
          {wa && (
            <a
              href={`https://wa.me/91${wa.replace(/\D/g, "").slice(-10)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="p-1.5 text-green-600 hover:bg-green-50 rounded-full"
              title="WhatsApp"
            >
              <MessageSquare className="h-4 w-4" />
            </a>
          )}
        </div>
      )}
    </div>
  );
}
