"use client";

// /expenses/new — simplified direct expense entry flow.
//
// Stepped flow: amount → category → payment mode (UPI / Cash) → receipt photo (optional).
// Direct submission: records a single expense directly without review or batching steps.
// Description is removed from the form; the selected category name is saved automatically.
import { useCallback, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { usePermissions } from "@/lib/use-permissions";
import { usePermissionStore } from "@/stores/permissions";
import { apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";
import { ErrorBanner } from "@/components/ui/error-banner";
import { BatchBar } from "./_components/batch-bar";
import { StepShell } from "./_components/step-shell";
import { AmountStep } from "./_components/amount-step";
import { CategoryStep } from "./_components/category-step";
import { PaymentModeStep } from "./_components/payment-mode-step";
import { PhotoStep } from "./_components/photo-step";
import {
  CATEGORY_LABELS,
  EMPTY_DRAFT,
  ENTRY_STEPS,
  parseAmount,
  todayLocal,
  type Draft,
  type Step,
} from "./_components/types";

const log = createLogger("expenses:entry");

const STEP_TITLES: Record<Step, string> = {
  amount: "Amount",
  category: "Category",
  paymentMode: "Payment mode",
  photo: "Receipt photo",
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
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [step, setStepState] = useState<Step>("amount");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const go = useCallback((next: Step) => {
    log.debug("step", { step: next });
    setStepState(next);
  }, []);

  const entryIndex = ENTRY_STEPS.indexOf(step);

  function leave() {
    router.push("/expenses");
  }

  function nextEntryStep() {
    if (entryIndex < 0) return;
    if (entryIndex < ENTRY_STEPS.length - 1) {
      go(ENTRY_STEPS[entryIndex + 1]);
    } else {
      submit();
    }
  }

  function back() {
    if (entryIndex > 0) {
      go(ENTRY_STEPS[entryIndex - 1]);
      return;
    }
    leave();
  }

  async function submit() {
    if (submitting) return;
    const amount = parseAmount(draft.amount);
    if (amount === null || !draft.category) {
      setError("Please specify the amount and category.");
      return;
    }

    setSubmitting(true);
    setError("");

    const description = draft.category ? CATEGORY_LABELS[draft.category].label : "Expense";

    const { error: submitError, isAuth, status } = await apiTry<{ id: string }>(
      "/api/expenses",
      {
        method: "POST",
        json: {
          date,
          amount,
          category: draft.category,
          description,
          paymentMode: draft.paymentMode,
          receiptUrl: draft.receiptUrl ?? undefined,
        },
      }
    );

    if (submitError) {
      log.error("submit failed", { status, isAuth, message: submitError });
      setSubmitting(false);
      if (isAuth) {
        router.push("/login");
        return;
      }
      setError(submitError);
      return;
    }

    log.info("expense recorded successfully");
    router.push("/expenses");
    router.refresh();
  }

  if (sessionStatus === "loading" || permissionsLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-6 w-6 border-2 border-slate-900 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!canAccess) {
    return (
      <div className="text-center py-12">
        <p className="text-sm font-medium text-red-600">Access Denied</p>
        <p className="text-xs text-slate-500 mt-1">You do not have permission to record expenses.</p>
      </div>
    );
  }

  const subtitle = `Step ${entryIndex + 1} of ${ENTRY_STEPS.length}`;
  const badge = `${entryIndex + 1}/${ENTRY_STEPS.length}`;

  return (
    <div>
      <BatchBar date={date} onDateChange={setDate} payer={payer} />

      <StepShell
        title={STEP_TITLES[step]}
        subtitle={subtitle}
        onBack={back}
        badge={badge}
      >
        {error && <ErrorBanner message={error} onDismiss={() => setError("")} />}

        {step === "amount" && (
          <AmountStep
            value={draft.amount}
            onChange={(amount) => setDraft((d) => ({ ...d, amount }))}
            onNext={nextEntryStep}
          />
        )}
        {step === "category" && (
          <CategoryStep
            value={draft.category}
            onChange={(category) => setDraft((d) => ({ ...d, category }))}
            onNext={nextEntryStep}
          />
        )}
        {step === "paymentMode" && (
          <PaymentModeStep
            value={draft.paymentMode}
            onChange={(paymentMode) => setDraft((d) => ({ ...d, paymentMode }))}
            onNext={nextEntryStep}
          />
        )}
        {step === "photo" && (
          <PhotoStep
            value={draft.receiptUrl}
            onChange={(receiptUrl) => setDraft((d) => ({ ...d, receiptUrl }))}
            onSubmit={submit}
            submitting={submitting}
          />
        )}
      </StepShell>
    </div>
  );
}
