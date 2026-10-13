"use client";

// "Settled by credit note" on an issue — plan 1210 credit notes and payables, Part 9 (Q13 = a).
//
// A shortage or damage found at the door is usually settled weeks later by a credit note the
// supplier sends and the accountant types into Zoho Books. A person picks that credit here; it is
// NEVER matched automatically — one credit often covers several issues, or carries GST the issue
// did not, so an amount match would be wrong as often as right.
//
// The list is this brand's credit notes from GET /api/vendors/[id]/credits?status=all, with the
// ones applied to the issue's own bill first. The page owns the save (PUT /api/vendor-issues/[id],
// guard vendor_issues.edit) and the "Mark resolved" step it offers afterwards.

import { useState } from "react";
import Link from "next/link";
import { FileMinus2, Loader2 } from "lucide-react";
import { apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";

const log = createLogger("vendor-issues:credit-link");

export interface LinkedCredit {
  id: string;
  vendorId: string;
  creditNoteNo: string;
  referenceNo?: string | null;
  creditDate: string;
  amount: number;
  status: string;
}

/** The fields of GET /api/vendors/[id]/credits this picker reads. */
interface CreditOption {
  id: string;
  creditNoteNo: string;
  referenceNo: string | null;
  creditDate: string;
  status: "OPEN" | "CLOSED" | "VOID";
  amount: number;
  open: number;
  applications: Array<{ billId: string | null; billNo: string | null }>;
  issues?: Array<{ id: string; issueNo: string }>;
}

function inr(n: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
}

function shortDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit", timeZone: "Asia/Kolkata" });
}

export function SettledByCredit({
  issueId,
  vendorId,
  billId,
  billNo,
  linked,
  canEdit,
  canOfferResolve,
  onSave,
  onOfferResolve,
}: {
  issueId: string;
  vendorId: string;
  billId: string | null;
  billNo: string | null;
  linked: LinkedCredit | null;
  canEdit: boolean;
  /** True while the issue is OPEN or IN PROGRESS — the only states "Mark resolved" makes sense from. */
  canOfferResolve: boolean;
  /** Saves the link (null unlinks). Resolves to an error sentence, or null on success. */
  onSave: (vendorCreditId: string | null) => Promise<string | null>;
  /** Opens the page's resolution form, pre-filled. The person still confirms it. */
  onOfferResolve: (resolutionText: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [credits, setCredits] = useState<CreditOption[] | null>(null);
  const [loadingList, setLoadingList] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [choice, setChoice] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [justLinked, setJustLinked] = useState<CreditOption | null>(null);

  const foreign = linked !== null && linked.vendorId !== vendorId;

  async function loadCredits() {
    setLoadingList(true);
    setListError(null);
    const { data, error } = await apiTry<{ credits: CreditOption[] }>(`/api/vendors/${vendorId}/credits?status=all`);
    if (error || !data) {
      log.warn("credit notes failed to load for issue", { issueId, vendorId, error });
      setListError(error || "Could not load this brand's credit notes");
    } else {
      setCredits(data.credits);
    }
    setLoadingList(false);
  }

  function openPicker() {
    setEditing(true);
    setSaveError(null);
    setJustLinked(null);
    setChoice(linked && !foreign ? linked.id : "");
    if (!credits) void loadCredits();
  }

  async function save(vendorCreditId: string | null) {
    if (saving) return;
    setSaving(true);
    setSaveError(null);
    const err = await onSave(vendorCreditId);
    setSaving(false);
    if (err) {
      setSaveError(err);
      return;
    }
    setEditing(false);
    setJustLinked(vendorCreditId ? credits?.find((c) => c.id === vendorCreditId) ?? null : null);
  }

  const appliedToBill = (c: CreditOption) => billId !== null && c.applications.some((a) => a.billId === billId);
  const usable = (credits ?? []).filter((c) => c.status !== "VOID");
  const onBill = usable.filter(appliedToBill);
  const others = usable.filter((c) => !appliedToBill(c));
  const label = (c: CreditOption) => {
    const parts = [c.creditNoteNo, inr(c.amount), shortDate(c.creditDate)];
    if (c.referenceNo) parts.push(`ref ${c.referenceNo}`);
    parts.push(c.status === "CLOSED" ? "fully used" : `${inr(Math.max(0, c.open))} open`);
    const settles = (c.issues ?? []).filter((i) => i.id !== issueId).map((i) => i.issueNo);
    if (settles.length) parts.push(`also settles ${settles.join(", ")}`);
    return parts.join(" · ");
  };

  return (
    <div>
      <div className="flex items-center gap-2">
        <span className="text-xs text-slate-500">Settled by credit note:</span>
        {canEdit && !editing && (
          <button onClick={openPicker} className="min-h-[44px] px-1 text-xs font-medium text-blue-600 hover:underline">
            {linked ? "Change" : "Link credit note"}
          </button>
        )}
      </div>

      {!editing && (
        linked ? (
          <p className="text-sm text-slate-900 flex items-center gap-1.5">
            <FileMinus2 className="h-4 w-4 text-purple-600 shrink-0" />
            <Link href={`/vendors/${linked.vendorId}`} className="text-blue-600 hover:underline tabular-nums">
              {linked.creditNoteNo}
            </Link>
            <span className="text-slate-500 tabular-nums">
              · {inr(linked.amount)} · {shortDate(linked.creditDate)}
              {linked.status === "VOID" ? " · void in Zoho" : ""}
            </span>
          </p>
        ) : (
          <p className="text-sm text-slate-400">Not linked</p>
        )
      )}

      {!editing && foreign && (
        <p className="mt-1 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">
          This credit note belongs to another brand — the issue&apos;s brand was changed after it was linked. Change or unlink it.
        </p>
      )}

      {justLinked && canOfferResolve && !editing && (
        <div className="mt-2 rounded-lg border border-green-200 bg-green-50 p-2.5">
          <p className="text-xs text-green-800 mb-2">Linked. Does this credit note settle the issue?</p>
          <button
            onClick={() => {
              onOfferResolve(`Settled by credit note ${justLinked.creditNoteNo} (${inr(justLinked.amount)}, ${shortDate(justLinked.creditDate)}).`);
              setJustLinked(null);
            }}
            className="min-h-[44px] w-full rounded-lg bg-green-600 text-white text-sm font-medium hover:bg-green-700"
          >
            Mark resolved
          </button>
        </div>
      )}

      {editing && (
        <div className="mt-2 space-y-2">
          {loadingList ? (
            <p className="flex items-center gap-2 text-xs text-slate-500 py-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading this brand&apos;s credit notes…
            </p>
          ) : listError ? (
            <div className="text-xs text-red-600">
              {listError}{" "}
              <button onClick={() => void loadCredits()} className="min-h-[44px] px-1 underline font-medium">Retry</button>
            </div>
          ) : usable.length === 0 ? (
            <p className="text-xs text-slate-500">
              No credit notes from this brand yet. Credit notes are entered in Zoho Books and fetched on{" "}
              <Link href="/bills?fetch=credits" className="text-blue-600 underline">Bills</Link>.
            </p>
          ) : (
            <select
              value={choice}
              onChange={(e) => setChoice(e.target.value)}
              aria-label="Credit note that settles this issue"
              className="w-full min-h-[44px] px-2 rounded-lg border border-slate-300 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/40"
            >
              <option value="">Pick a credit note…</option>
              {onBill.length > 0 && (
                <optgroup label={`Applied to bill ${billNo ?? ""}`.trim()}>
                  {onBill.map((c) => <option key={c.id} value={c.id}>{label(c)}</option>)}
                </optgroup>
              )}
              {others.length > 0 && (
                <optgroup label={onBill.length > 0 ? "Other credit notes" : "Credit notes"}>
                  {others.map((c) => <option key={c.id} value={c.id}>{label(c)}</option>)}
                </optgroup>
              )}
            </select>
          )}
          {saveError && <p className="text-xs text-red-600">{saveError}</p>}
          <div className="flex gap-2">
            <button
              onClick={() => void save(choice)}
              disabled={saving || !choice || (linked !== null && choice === linked.id)}
              className="flex-1 min-h-[44px] rounded-lg bg-blue-600 text-white text-sm font-medium disabled:opacity-50 inline-flex items-center justify-center gap-1.5"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Save
            </button>
            {linked && (
              <button
                onClick={() => void save(null)}
                disabled={saving}
                className="flex-1 min-h-[44px] rounded-lg border border-red-200 text-sm font-medium text-red-600 disabled:opacity-50"
              >
                Unlink
              </button>
            )}
            <button
              onClick={() => setEditing(false)}
              disabled={saving}
              className="flex-1 min-h-[44px] rounded-lg border border-slate-200 text-sm font-medium text-slate-600"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
