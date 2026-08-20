"use client";

import { use, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const GAP_TYPES: [string, string][] = [
  ["DISCOUNT_PENDING", "Discount promised, not credited"],
  ["CREDIT_NOTE_PENDING", "Credit note promised, not issued"],
  ["SHORT_CREDIT", "Credited, but less than agreed"],
  ["DISPUTE", "Disputed amount"],
  ["RECONCILIATION_DIFFERENCE", "Our books disagree with theirs"],
  ["DOCUMENTATION_GAP", "Missing paperwork"],
  ["BALANCE_UNCONFIRMED", "Closing balance not agreed"],
  ["SCHEME_ENTITLEMENT", "Scheme / incentive entitlement"],
  ["COMMITMENT_PENDING", "Commitment not honoured"],
  ["OPERATIONAL_WARRANTY", "Warranty / operational"],
  ["INVOICE_DISCREPANCY", "Invoice wrong"],
  ["REIMBURSEMENT_PENDING", "Reimbursement owed"],
];

// The tier decides how hard a claim can be pressed, so it is asked for up front rather than
// discovered halfway through a negotiation.
const TIERS: [string, string][] = [
  ["FIRM", "Firm — provable in writing"],
  ["LEVERAGE", "Leverage — use in negotiation, not provable"],
  ["VERIFY", "Verify — need a document before claiming"],
  ["CONDITIONAL", "Conditional — only raise if contested"],
];

export default function NewGapPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();

  const [title, setTitle] = useState("");
  const [gapType, setGapType] = useState("DISCOUNT_PENDING");
  const [tier, setTier] = useState("");
  const [amount, setAmount] = useState("");
  const [amountNote, setAmountNote] = useState("");
  const [promisedBy, setPromisedBy] = useState("");
  const [promisedOn, setPromisedOn] = useState("");
  const [evidenceText, setEvidenceText] = useState("");
  const [action, setAction] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/ledger/vendors/${id}/gaps`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          gapType,
          tier: tier || null,
          amount: amount ? Number(amount) : null,
          amountNote: amountNote || undefined,
          promisedBy: promisedBy || undefined,
          promisedOn: promisedOn || undefined,
          evidenceText: evidenceText || undefined,
          action: action || undefined,
        }),
      }).then((r) => r.json());

      if (res.success) router.push(`/ledger/${id}`);
      else setError(res.error || "Could not save");
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <Link
          href={`/ledger/${id}`}
          aria-label="Back"
          className="p-2 -ml-2 rounded-lg hover:bg-slate-100 focus-ring"
        >
          <ArrowLeft className="h-5 w-5 text-slate-600" />
        </Link>
        <h1 className="text-lg font-bold text-slate-900">New claim</h1>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">What is owed *</label>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Billing incentive balance ₹1,200/bike on 82 bikes"
            autoFocus
            className="min-h-[44px]"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Kind *</label>
          <select
            value={gapType}
            onChange={(e) => setGapType(e.target.value)}
            className="flex min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus-ring"
          >
            {GAP_TYPES.map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            How hard can this be pressed?
          </label>
          <select
            value={tier}
            onChange={(e) => setTier(e.target.value)}
            className="flex min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus-ring"
          >
            <option value="">Not classified yet</option>
            {TIERS.map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Amount</label>
            <Input
              type="number"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="84000"
              className="min-h-[44px] tabular-nums"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Or describe it</label>
            <Input
              value={amountNote}
              onChange={(e) => setAmountNote(e.target.value)}
              placeholder="10,300 claimed / 9,900 itemised"
              className="min-h-[44px]"
            />
          </div>
        </div>
        <p className="-mt-2 text-[11px] text-slate-500">
          Leave the amount blank when it genuinely is not one number. The text field keeps the
          ambiguity instead of inventing a figure.
        </p>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Promised by</label>
            <Input
              value={promisedBy}
              onChange={(e) => setPromisedBy(e.target.value)}
              placeholder="Prashant"
              className="min-h-[44px]"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">On</label>
            <Input
              type="date"
              value={promisedOn}
              onChange={(e) => setPromisedOn(e.target.value)}
              className="min-h-[44px]"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Evidence</label>
          <textarea
            value={evidenceText}
            onChange={(e) => setEvidenceText(e.target.value)}
            rows={3}
            placeholder="Approved on WhatsApp 05-May-26; ₹14,400 NEFT received 18-Dec-25 ref IN42535254368383"
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus-ring"
          />
          {!evidenceText && (
            <p className="mt-1 flex items-center gap-1 text-[11px] text-amber-700">
              <AlertTriangle className="h-3 w-3 shrink-0" />
              A claim with nothing behind it cannot be pressed. Record where it was promised.
            </p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Next step</label>
          <Input
            value={action}
            onChange={(e) => setAction(e.target.value)}
            placeholder="Chase CN document; confirm all 82 bikes qualify"
            className="min-h-[44px]"
          />
        </div>

        <Button
          type="submit"
          size="lg"
          disabled={!title.trim() || saving}
          className="w-full min-h-[48px] bg-emerald-600 hover:bg-emerald-700 focus-ring"
        >
          {saving ? "Saving..." : "Raise claim"}
        </Button>
      </form>
    </div>
  );
}
