"use client";

// /expenses/new — simplified direct expense entry flow.
//
// Stepped flow: amount → category → who paid → payment mode (UPI / Cash) → receipt photo
// (optional) and Submit. The date and the store sit in the bar above the steps.
// Direct submission: records a single expense directly without review or batching steps.
// Description is removed from the form; the selected category name is saved automatically.
// Every expense names its store and who paid (plan 1210-expense-store-department-and-payer,
// R2 / R3); the stores and staff come from GET /api/expenses/options, loaded once.
import { useCallback, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { usePermissions } from "@/lib/use-permissions";
import { apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";
import { ErrorBanner } from "@/components/ui/error-banner";
import { BatchBar } from "./_components/batch-bar";
import { StepShell } from "./_components/step-shell";
import { AmountStep } from "./_components/amount-step";
import { CategoryStep } from "./_components/category-step";
import { PayerStep } from "./_components/payer-step";
import { PaymentModeStep } from "./_components/payment-mode-step";
import { PhotoStep } from "./_components/photo-step";
import { useExpenseOptions } from "./_components/use-expense-options";
import {
  CATEGORY_LABELS,
  EMPTY_DRAFT,
  ENTRY_STEPS,
  defaultStoreId,
  missingBeforeSubmit,
  parseAmount,
  payerBody,
  todayLocal,
  type Draft,
  type Step,
} from "./_components/types";

const log = createLogger("expenses:entry");

const STEP_TITLES: Record<Step, string> = {
  amount: "Amount",
  category: "Category",
  payer: "Who paid?",
  paymentMode: "Payment mode",
  photo: "Receipt photo",
};

export default function NewExpensePage() {
  const { status: sessionStatus } = useSession();
  const { canCreate, loading: permissionsLoading } = usePermissions();
  const canAccess = canCreate("expenses");
  const router = useRouter();
  const { options, loading: optionsLoading, error: optionsError, retry } = useExpenseOptions(
    !permissionsLoading && canAccess
  );

  const [date, setDate] = useState(todayLocal);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  // Only a tap sets this. Until then the store is the default the options imply (E5), derived
  // rather than copied into state so a Retry that brings different stores cannot leave it stale.
  const [pickedStoreId, setPickedStoreId] = useState<string | null>(null);
  const [step, setStepState] = useState<Step>("amount");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const go = useCallback((next: Step) => {
    log.debug("step", { step: next });
    setStepState(next);
  }, []);

  const entryIndex = ENTRY_STEPS.indexOf(step);

  const stores = options?.stores ?? [];
  const storeId =
    pickedStoreId && stores.some((s) => s.id === pickedStoreId)
      ? pickedStoreId
      : options
        ? defaultStoreId(options)
        : null;
  const payer = payerBody(draft.payer);
  const missing = missingBeforeSubmit({ storeCount: stores.length, storeId, payerReady: payer !== null });

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
    // The photo step disables Submit while this is set; checked again so no path skips it.
    if (missing || !storeId || !payer) {
      setError(missing ?? "Pick the store and who paid.");
      return;
    }

    setSubmitting(true);
    setError("");

    const description = draft.category ? CATEGORY_LABELS[draft.category].label : "Expense";

    const { data, error: submitError, isAuth, status } = await apiTry<{ id: string }>(
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
          storeId,
          payer,
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

    // Ids and the kind only — a typed payer is a person's name and never goes to the log.
    log.info("expense recorded successfully", { expenseId: data?.id, storeId, payerKind: payer.kind });
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

  // The stores and staff list decide the top bar and step 3, so the form waits for them.
  if (optionsLoading) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-12">
        <div className="h-6 w-6 border-2 border-slate-900 border-t-transparent rounded-full animate-spin" />
        <p className="text-xs text-slate-500">Loading stores and staff…</p>
      </div>
    );
  }

  if (!options) {
    return (
      <div className="max-w-lg mx-auto py-6">
        <ErrorBanner message={optionsError || "Could not load the stores and staff list."} onRetry={retry} />
        <button
          type="button"
          onClick={leave}
          className="min-h-[44px] px-2 text-sm font-medium text-blue-600 hover:underline"
        >
          Back to expenses
        </button>
      </div>
    );
  }

  const subtitle = `Step ${entryIndex + 1} of ${ENTRY_STEPS.length}`;
  const badge = `${entryIndex + 1}/${ENTRY_STEPS.length}`;

  return (
    <div>
      <BatchBar
        date={date}
        onDateChange={setDate}
        stores={stores}
        storeId={storeId}
        onStoreChange={setPickedStoreId}
        disabled={submitting}
      />

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
        {step === "payer" && (
          <PayerStep
            me={options.me}
            users={options.users}
            recentPayers={options.recentPayers}
            value={draft.payer}
            onChange={(payer) => setDraft((d) => ({ ...d, payer }))}
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
            missing={missing}
          />
        )}
      </StepShell>
    </div>
  );
}
