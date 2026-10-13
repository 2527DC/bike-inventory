"use client";

// The actions of one line (plan 1210 bank, C3, D6, Part F).
//
//   Credit, to review   Park in suspense · Skip — plus "matched on Daily Settlement" help.
//   Debit, to review    Confirm (the AI's vendor) · Vendor · Expense · Link · Park · Skip
//   Debit, in suspense  Confirm · Vendor · Expense · Link — recording it closes its case (D1).
//                       No Park or Skip: a parked line closes only through Q5's outcomes.
//   Credit, in suspense nothing here — the Suspense screen, or Daily Settlement.
//
// Confirm / Vendor need bills.create and Expense needs expenses.create on top of bank_recon.edit
// (Q3). Cosmetic: the API re-checks and answers a missing grant with a sentence.
import { useState } from "react";
import { Building2, ChevronDown, ChevronUp, CreditCard, Link2, Loader2, PauseCircle, Receipt, XCircle } from "lucide-react";
import { useReconcile } from "./context";
import { VendorPanel } from "./vendor-panel";
import { ExpensePanel } from "./expense-panel";
import { LinkPanel, evidence } from "./link-panel";
import { inr, lineState, shortDate, type BankTxn, type ReviewBody } from "./types";

type Panel = "vendor" | "expense" | "link" | null;

const BTN = "min-h-11 px-2 flex items-center justify-center gap-1 rounded-lg text-xs font-medium disabled:opacity-50";

function Chevron({ open }: { open: boolean }) {
  return open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />;
}

export function LineActions({ txn }: { txn: BankTxn }) {
  const { perms, busyTxn, run, openPark, expenseStores, defaultStoreId, lastError } = useReconcile();
  const [panel, setPanel] = useState<Panel>(null);
  // Part F: recording as NEW a line that looks already recorded asks once — "link it instead?"
  const [pendingNew, setPendingNew] = useState<ReviewBody | null>(null);
  const [askedOnce, setAskedOnce] = useState(false);

  const busy = busyTxn === txn.id;
  const parked = lineState(txn) === "SUSPENSE";
  const hint = txn.alreadyRecorded;
  const error = lastError?.txnId === txn.id ? lastError.message : "";

  const toggle = (p: Panel) => setPanel((cur) => (cur === p ? null : p));
  const act = (body: ReviewBody) => void run(txn.id, body);
  const link = (kind: "payment" | "expense", recordId: string) =>
    act(kind === "payment" ? { action: "link_payment", paymentId: recordId } : { action: "link_expense", expenseId: recordId });
  const recordNew = (body: ReviewBody) => {
    if (hint && !askedOnce) setPendingNew(body);
    else act(body);
  };
  const spin = <Loader2 className="h-3.5 w-3.5 animate-spin" />;

  if (txn.type === "CREDIT") {
    if (parked) {
      return (
        <p className="text-[11px] text-slate-500 mt-2">
          A parked credit closes on the Suspense screen, or when it is matched on Daily Settlement.
        </p>
      );
    }
    return (
      <div className="mt-2 space-y-1.5">
        <p className="text-[11px] text-slate-500">Card, UPI, finance and cash deposits are matched on Daily Settlement.</p>
        <div className="grid grid-cols-2 gap-1.5">
          <button type="button" onClick={() => openPark(txn)} disabled={busy} className={`${BTN} bg-amber-100 text-amber-800`}>
            <PauseCircle className="h-3.5 w-3.5" /> Park in suspense
          </button>
          <button type="button" onClick={() => act({ action: "ignore" })} disabled={busy} className={`${BTN} bg-slate-200 text-slate-600`}>
            {busy ? spin : <XCircle className="h-3.5 w-3.5" />} Skip
          </button>
        </div>
        {error && <p className="text-[11px] text-red-600">{error}</p>}
      </div>
    );
  }

  const aiVendor = txn.suggestedVendor;
  // The AI's bill only when it is that vendor's — the API refuses a bill of another vendor.
  const aiBillId = txn.suggestedBill && txn.suggestedBill.vendorId === aiVendor?.id ? txn.suggestedBill.id : undefined;

  return (
    <div className="mt-2 space-y-2">
      {hint && !pendingNew && (
        <div className="bg-sky-50 border border-sky-200 rounded-lg p-2 flex items-center gap-2">
          <div className="flex-1 min-w-0 text-[11px] text-sky-900">
            <p className="font-medium">Already recorded?</p>
            <p className="line-clamp-2">
              {hint.label} {inr(hint.amount, 2)} on {shortDate(hint.date)} — {evidence(hint)}
            </p>
          </div>
          <button type="button" onClick={() => link(hint.kind, hint.id)} disabled={busy} className={`${BTN} shrink-0 px-3 bg-sky-600 text-white`}>
            {busy ? spin : <Link2 className="h-3.5 w-3.5" />} Link
          </button>
        </div>
      )}

      {pendingNew && hint && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-2 space-y-1.5" role="alertdialog" aria-label="Already recorded?">
          <p className="text-xs text-amber-900">
            This looks already recorded — link it instead? ({hint.label} {inr(hint.amount, 2)} on {shortDate(hint.date)})
          </p>
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setPendingNew(null);
                link(hint.kind, hint.id);
              }}
              className={`${BTN} bg-sky-600 text-white`}
            >
              <Link2 className="h-3.5 w-3.5" /> Link it
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                const body = pendingNew;
                setPendingNew(null);
                setAskedOnce(true);
                act(body);
              }}
              className={`${BTN} bg-white border border-slate-300 text-slate-700`}
            >
              Record as new
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-3 gap-1.5">
        {aiVendor && perms.payment && (
          <button
            type="button"
            onClick={() => recordNew({ action: "confirm_payment", vendorId: aiVendor.id, billId: aiBillId })}
            disabled={busy}
            className={`${BTN} bg-green-600 text-white`}
          >
            {busy ? spin : <CreditCard className="h-3.5 w-3.5" />} Confirm
          </button>
        )}
        {perms.payment && (
          <button type="button" onClick={() => toggle("vendor")} disabled={busy} aria-expanded={panel === "vendor"} className={`${BTN} bg-blue-100 text-blue-700`}>
            <Building2 className="h-3.5 w-3.5" /> Vendor <Chevron open={panel === "vendor"} />
          </button>
        )}
        {perms.expense && (
          <button type="button" onClick={() => toggle("expense")} disabled={busy} aria-expanded={panel === "expense"} className={`${BTN} bg-purple-600 text-white`}>
            <Receipt className="h-3.5 w-3.5" /> Expense <Chevron open={panel === "expense"} />
          </button>
        )}
        <button type="button" onClick={() => toggle("link")} disabled={busy} aria-expanded={panel === "link"} className={`${BTN} bg-sky-100 text-sky-800`}>
          <Link2 className="h-3.5 w-3.5" /> Link <Chevron open={panel === "link"} />
        </button>
        {!parked && (
          <button type="button" onClick={() => openPark(txn)} disabled={busy} className={`${BTN} bg-amber-100 text-amber-800`}>
            <PauseCircle className="h-3.5 w-3.5" /> Park
          </button>
        )}
        {!parked && (
          <button type="button" onClick={() => act({ action: "ignore" })} disabled={busy} className={`${BTN} bg-slate-200 text-slate-600`}>
            {busy ? spin : <XCircle className="h-3.5 w-3.5" />} Skip
          </button>
        )}
      </div>

      {panel === "vendor" && (
        <VendorPanel txn={txn} busy={busy} onRecord={(vendorId, billId) => recordNew({ action: "confirm_payment", vendorId, billId })} />
      )}
      {panel === "expense" && (
        <ExpensePanel
          stores={expenseStores}
          defaultStoreId={defaultStoreId}
          suggestedCategory={txn.suggestedCategory}
          busy={busy}
          onPick={(category, storeId) => recordNew({ action: "confirm_expense", category, storeId })}
        />
      )}
      {panel === "link" && <LinkPanel txn={txn} busy={busy} onLink={link} />}

      {error && <p className="text-[11px] text-red-600">{error}</p>}
      {parked && <p className="text-[11px] text-slate-500">Recording or linking this line closes its suspense case.</p>}
      {!perms.payment && !perms.expense && (
        <p className="text-[11px] text-slate-500">
          Recording a new payment or expense needs Bills or Expenses create permission — you can still{" "}
          {parked ? "link it" : "link, park or skip it"}.
        </p>
      )}
    </div>
  );
}
