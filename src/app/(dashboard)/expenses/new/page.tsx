"use client";

// /expenses/new — the stepped expense entry flow (0909-expense-multi-entry-flow-plan, Part C).
//
// One field per screen, in the owner's order: amount → category → description → payment mode
// → photo. Several expenses are built up in client state and committed by ONE Submit from the
// review screen, as a single call to POST /api/expenses/batch. Nothing is written per step.
//
// The date is shared by the batch and defaults to today (R2). The payer is the signed-in user,
// shown but never typed (D2) — the server stamps it, so the payload does not carry it at all.
import { useCallback, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { usePermissions } from "@/lib/use-permissions";
import { usePermissionStore } from "@/stores/permissions";
import { apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";
import { BatchBar } from "./_components/batch-bar";
import { StepShell } from "./_components/step-shell";
import { AmountStep } from "./_components/amount-step";
import { CategoryStep } from "./_components/category-step";
import { DescriptionStep } from "./_components/description-step";
import { PaymentModeStep } from "./_components/payment-mode-step";
import { PhotoStep } from "./_components/photo-step";
import { NextStep } from "./_components/next-step";
import { ReviewStep } from "./_components/review-step";
import {
  EMPTY_DRAFT, ENTRY_STEPS, draftFromRow, newRowKey, parseAmount, rowFromDraft, todayLocal,
  type Draft, type ExpenseRow, type Step,
} from "./_components/types";

const log = createLogger("expenses:entry");

const STEP_TITLES: Record<Step, string> = {
  amount: "Amount",
  category: "Category",
  description: "Description",
  paymentMode: "Payment mode",
  photo: "Receipt photo",
  next: "Added",
  review: "Review",
};

export default function NewExpensePage() {
  const { data: session, status: sessionStatus } = useSession();
  const { canCreate, loading: permissionsLoading } = usePermissions();
  const storeUser = usePermissionStore((s) => s.user);
  const canAccess = canCreate("expenses");
  const router = useRouter();

  // The session carries the name on the web; the permission store carries it for both web and
  // the bearer-token path. Either is the same person.
  const payer = session?.user?.name || storeUser?.name || "";

  const [date, setDate] = useState(todayLocal);
  const [rows, setRows] = useState<ExpenseRow[]>([]);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [step, setStepState] = useState<Step>("amount");
  /** The row picked from review that the stepper is currently reloading (Q5). */
  const [editingKey, setEditingKey] = useState<string | null>(null);
  /** True when "Add another" was pressed on the review screen, so completion returns there. */
  const [returnToReview, setReturnToReview] = useState(false);
  const [lastAdded, setLastAdded] = useState<ExpenseRow | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const go = useCallback((next: Step, rowCount: number) => {
    log.debug("step", { step: next, rowCount });
    setStepState(next);
  }, []);

  const editing = editingKey !== null;
  const entryIndex = ENTRY_STEPS.indexOf(step);

  function leave() {
    if (rows.length > 0 && !window.confirm(`Discard ${rows.length === 1 ? "1 unsaved expense" : `${rows.length} unsaved expenses`}?`)) return;
    router.push("/expenses");
  }

  function startFresh(nextRows: ExpenseRow[], toReview: boolean) {
    setDraft(EMPTY_DRAFT);
    setEditingKey(null);
    setReturnToReview(toReview);
    go("amount", nextRows.length);
  }

  /** The current draft is complete: file it into the batch and decide where to go next. */
  function commitDraft() {
    const key = editingKey ?? newRowKey();
    const row = rowFromDraft(draft, key);
    if (!row) {
      // Forward buttons are disabled until each step is valid, so this is a defensive branch:
      // it names the first step that is not, rather than silently doing nothing.
      const firstInvalid: Step =
        parseAmount(draft.amount) === null ? "amount" : !draft.category ? "category" : "description";
      log.warn("draft incomplete at commit", { step: firstInvalid, rowCount: rows.length });
      go(firstInvalid, rows.length);
      return;
    }

    if (editingKey) {
      const nextRows = rows.map((r) => (r.key === editingKey ? row : r));
      setRows(nextRows);
      setEditingKey(null);
      setDraft(EMPTY_DRAFT);
      go("review", nextRows.length);
      return;
    }

    const nextRows = [...rows, row];
    setRows(nextRows);
    setLastAdded(row);
    setDraft(EMPTY_DRAFT);
    if (returnToReview) {
      setReturnToReview(false);
      go("review", nextRows.length);
    } else {
      go("next", nextRows.length);
    }
  }

  function nextEntryStep() {
    if (entryIndex < 0) return;
    if (entryIndex < ENTRY_STEPS.length - 1) go(ENTRY_STEPS[entryIndex + 1], rows.length);
    else commitDraft();
  }

  function back() {
    if (step === "review") {
      leave();
      return;
    }
    if (step === "next") {
      go("review", rows.length);
      return;
    }
    if (entryIndex > 0) {
      go(ENTRY_STEPS[entryIndex - 1], rows.length);
      return;
    }
    // On the amount step. Abandon the draft (or the edit) and go back to wherever the person
    // came from: the review screen if the batch has rows, otherwise out of the flow.
    if (editing || returnToReview || rows.length > 0) {
      setDraft(EMPTY_DRAFT);
      setEditingKey(null);
      setReturnToReview(false);
      go("review", rows.length);
      return;
    }
    leave();
  }

  function editRow(key: string) {
    const row = rows.find((r) => r.key === key);
    if (!row) return;
    setDraft(draftFromRow(row));
    setEditingKey(key);
    setReturnToReview(false);
    go("amount", rows.length);
  }

  function removeRow(key: string) {
    const nextRows = rows.filter((r) => r.key !== key);
    setRows(nextRows);
    if (nextRows.length === 0) startFresh(nextRows, false);
  }

  async function submit() {
    if (rows.length === 0 || submitting) return;
    setSubmitting(true);
    setError("");
    const { error: submitError, isAuth, status } = await apiTry<{ count: number; total: number; ids: string[] }>(
      "/api/expenses/batch",
      {
        method: "POST",
        json: {
          date,
          expenses: rows.map((r) => ({
            amount: r.amount,
            category: r.category,
            description: r.description,
            paymentMode: r.paymentMode,
            receiptUrl: r.receiptUrl ?? undefined,
          })),
        },
      }
    );
    if (submitError) {
      log.error("submit failed", { rowCount: rows.length, status, isAuth });
      setSubmitting(false);
      if (isAuth) {
        router.push("/login");
        return;
      }
      setError(submitError);
      return;
    }
    log.info("batch submitted", { rowCount: rows.length });
    router.push("/expenses");
  }

  if (sessionStatus === "loading" || permissionsLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-6 w-6 border-2 border-slate-900 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Cosmetic gate only — POST /api/expenses/batch re-checks the same grant (access rule 5).
  if (!canAccess) {
    return (
      <div className="text-center py-12">
        <p className="text-sm font-medium text-red-600">Access Denied</p>
        <p className="text-xs text-slate-500 mt-1">You do not have permission to record expenses.</p>
      </div>
    );
  }

  const subtitle =
    entryIndex >= 0
      ? `Step ${entryIndex + 1} of ${ENTRY_STEPS.length}${editing ? " · editing" : ""}`
      : step === "next"
        ? "Add another, or review the batch"
        : "Check every line before submitting";

  return (
    <div>
      {step !== "next" && step !== "review" && (
        <BatchBar date={date} onDateChange={setDate} payer={payer} />
      )}

      <StepShell title={STEP_TITLES[step]} subtitle={subtitle} onBack={back} rowCount={rows.length} editing={editing}>
        {step === "amount" && (
          <AmountStep value={draft.amount} onChange={(amount) => setDraft((d) => ({ ...d, amount }))} onNext={nextEntryStep} />
        )}
        {step === "category" && (
          <CategoryStep value={draft.category} onChange={(category) => setDraft((d) => ({ ...d, category }))} onNext={nextEntryStep} />
        )}
        {step === "description" && (
          <DescriptionStep value={draft.description} onChange={(description) => setDraft((d) => ({ ...d, description }))} onNext={nextEntryStep} />
        )}
        {step === "paymentMode" && (
          <PaymentModeStep value={draft.paymentMode} onChange={(paymentMode) => setDraft((d) => ({ ...d, paymentMode }))} onNext={nextEntryStep} />
        )}
        {step === "photo" && (
          <PhotoStep value={draft.receiptUrl} onChange={(receiptUrl) => setDraft((d) => ({ ...d, receiptUrl }))} onNext={nextEntryStep} editing={editing} />
        )}
        {step === "next" && lastAdded && (
          <NextStep
            added={lastAdded}
            rows={rows}
            onAddAnother={() => startFresh(rows, false)}
            onReview={() => go("review", rows.length)}
          />
        )}
        {step === "review" && (
          <ReviewStep
            rows={rows}
            date={date}
            payer={payer}
            submitting={submitting}
            error={error}
            onEdit={editRow}
            onRemove={removeRow}
            onAddAnother={() => startFresh(rows, true)}
            onSubmit={submit}
            onDismissError={() => setError("")}
          />
        )}
      </StepShell>
    </div>
  );
}
