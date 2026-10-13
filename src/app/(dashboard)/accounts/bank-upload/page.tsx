"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Landmark, Plus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { SkeletonList } from "@/components/ui/skeleton";
import { ErrorBanner } from "@/components/ui/error-banner";
import { usePermissions } from "@/lib/use-permissions";
import { apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";
import { UploadCard } from "./_components/upload-card";
import { UploadError, UploadSuccess } from "./_components/upload-messages";
import { PastUploads } from "./_components/past-uploads";
import { AssignSection } from "./_components/assign-section";
import {
  successSentence,
  type BankAccountRow, type Diagnostics, type StatementRow, type UploadResult, type UploadStep,
} from "./_components/types";

const log = createLogger("accounts:bank-upload");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The diagnostics a refused upload carries in `data.diagnostics` (apiTry's errorData). */
function readDiagnostics(errorData: unknown): Diagnostics | null {
  if (!errorData || typeof errorData !== "object" || !("diagnostics" in errorData)) return null;
  const d = (errorData as { diagnostics?: unknown }).diagnostics;
  return d && typeof d === "object" ? (d as Diagnostics) : null;
}

/**
 * Upload a bank statement for one of the bank accounts, and see how far each upload has got
 * (plan 1210-bank-accounts-and-suspense, §3 B6).
 *
 * `useSearchParams` (for `?account=<id>`, which the weekly tile links with) must sit under a
 * Suspense boundary, or the production build fails prerendering the page.
 */
export default function BankUploadPage() {
  return (
    <Suspense fallback={<SkeletonList count={4} type="card" />}>
      <BankUploadScreen />
    </Suspense>
  );
}

function BankUploadScreen() {
  const wanted = useSearchParams().get("account");
  const { canView, canCreate, canEdit, loading: permsLoading } = usePermissions();
  const mayView = canView("bank_recon");
  const mayUpload = canCreate("bank_recon");
  const mayAssign = canEdit("bank_recon");
  // Nothing is fetched until the grants are known — a request sent earlier is refused for a
  // person who may well hold the permission.
  const enabled = !permsLoading && mayView;

  // ── The accounts (active only) — the chips, and the Assign selects. ──
  const [accounts, setAccounts] = useState<BankAccountRow[]>([]);
  const [accountsError, setAccountsError] = useState<string | null>(null);
  const [accountsKey, setAccountsKey] = useState(0);
  const [accountsLoadedFor, setAccountsLoadedFor] = useState<number | null>(null);
  const accountsLoading = accountsLoadedFor !== accountsKey;

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    apiTry<BankAccountRow[]>("/api/bank-accounts").then(({ data, error, status }) => {
      if (cancelled) return;
      if (error || !data) {
        log.error("accounts load failed", { status, message: error });
        setAccountsError(error || "Could not load the bank accounts.");
        setAccounts([]);
      } else {
        setAccountsError(null);
        setAccounts(data);
      }
      setAccountsLoadedFor(accountsKey);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, accountsKey]);

  // The chosen account: a tap wins; else ?account=<id>; else the only account there is.
  const [picked, setPicked] = useState<string | null>(null);
  const selectedId = useMemo(() => {
    if (picked && accounts.some((a) => a.id === picked)) return picked;
    if (wanted && accounts.some((a) => a.id === wanted)) return wanted;
    return accounts.length === 1 ? accounts[0].id : null;
  }, [picked, wanted, accounts]);
  const selected = accounts.find((a) => a.id === selectedId) ?? null;
  const wantedMissing = !!wanted && !accountsLoading && !accountsError && !accounts.some((a) => a.id === wanted);

  const [periodFrom, setPeriodFrom] = useState("");
  const [periodTo, setPeriodTo] = useState("");

  // ── Past uploads — follow the chosen account unless "All accounts". ──
  const [showAll, setShowAll] = useState(false);
  const listAccountId = selected && !showAll ? selected.id : null;
  const [listKey, setListKey] = useState(0);
  const listRequest = `${listAccountId ?? "all"}|${listKey}`;
  const [statements, setStatements] = useState<StatementRow[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [listLoadedFor, setListLoadedFor] = useState<string | null>(null);
  const listLoading = listLoadedFor !== listRequest;

  useEffect(() => {
    // After the accounts, so the list follows the default selection without a wasted fetch.
    if (!enabled || accountsLoading) return;
    let cancelled = false;
    const qs = new URLSearchParams({ take: "50" });
    if (listAccountId) qs.set("bankAccountId", listAccountId);
    apiTry<StatementRow[]>(`/api/bank-statements?${qs}`).then(({ data, error, status }) => {
      if (cancelled) return;
      if (error || !data) {
        log.error("statements load failed", { status, bankAccountId: listAccountId, message: error });
        setListError(error || "Could not load past uploads.");
        setStatements([]);
      } else {
        setListError(null);
        setStatements(data);
      }
      setListLoadedFor(listRequest);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, accountsLoading, listAccountId, listRequest]);

  // ── Statements from before accounts existed (Q7) — only for someone who can assign them. ──
  const [unassigned, setUnassigned] = useState<StatementRow[]>([]);
  const [unassignedError, setUnassignedError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !mayAssign) return;
    let cancelled = false;
    apiTry<StatementRow[]>(`/api/bank-statements?unassigned=1&take=200`).then(({ data, error, status }) => {
      if (cancelled) return;
      if (error || !data) {
        log.error("unassigned statements load failed", { status, message: error });
        setUnassignedError(error || "Could not load the statements waiting for an account.");
        setUnassigned([]);
      } else {
        setUnassignedError(null);
        setUnassigned(data);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, mayAssign, listKey]);

  // End of the latest period already on file for the chosen account — offers "start the next day".
  const lastEnded = useMemo(() => {
    if (!selected) return null;
    const ends = statements
      .filter((s) => s.bankAccount?.id === selected.id && s.toDate)
      .map((s) => (s.toDate as string).slice(0, 10))
      .sort();
    return ends.length ? ends[ends.length - 1] : null;
  }, [statements, selected]);

  // ── The upload ──
  const [uploading, setUploading] = useState(false);
  const [step, setStep] = useState<UploadStep>("idle");
  const [error, setError] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);
  const [success, setSuccess] = useState<{ message: string; statementId: string | null } | null>(null);

  async function handleUpload(file: File) {
    if (!selected || !periodFrom || !periodTo || uploading) return;
    setUploading(true);
    setError(null);
    setSuccess(null);
    setDiagnostics(null);
    setStep("reading");

    const form = new FormData();
    form.append("file", file);
    form.append("bankAccountId", selected.id);
    form.append("periodFrom", periodFrom);
    form.append("periodTo", periodTo);

    await sleep(400);
    setStep("parsing");
    const { data, error: err, errorData, status } = await apiTry<UploadResult>("/api/bank-statements", {
      method: "POST",
      body: form,
    });

    if (err || !data) {
      // The server's sentence as it came — "already uploaded", "outside the period", "too long".
      log.error("upload failed", { bankAccountId: selected.id, status, message: err });
      setStep("error");
      setError(err || "Upload failed");
      setDiagnostics(readDiagnostics(errorData));
      setUploading(false);
      return;
    }

    setStep("matching");
    await sleep(300);
    setStep("done");
    log.info("statement uploaded", {
      statementId: data.id,
      bankAccountId: data.bankAccountId,
      lines: data.txnCount,
      duplicatesSkipped: data.duplicatesSkipped,
    });
    setSuccess({ message: successSentence(data), statementId: data.id });
    // The next statement has its own dates; "Start <day>" offers the one after this period.
    setPeriodFrom("");
    setPeriodTo("");
    setUploading(false);
    setListKey((k) => k + 1);
  }

  function handleAssigned(message: string) {
    setSuccess({ message, statementId: null });
    setError(null);
    setListKey((k) => k + 1);
  }

  if (!permsLoading && !mayView) {
    return (
      <div>
        <Header />
        <p className="text-sm text-slate-500 py-8 text-center">
          You do not have access to bank statements. Ask an admin for View on Bank Reconciliation.
        </p>
      </div>
    );
  }

  return (
    <div>
      <Header />

      {accountsError && (
        <ErrorBanner
          message={accountsError}
          onRetry={() => setAccountsKey((k) => k + 1)}
        />
      )}

      {mayUpload &&
        (accountsLoading ? (
          <div className="mb-4"><SkeletonList count={1} type="card" /></div>
        ) : accounts.length === 0 && !accountsError ? (
          <Card className="mb-4 border-dashed border-2 border-slate-300">
            <CardContent className="p-5 text-center">
              <Landmark className="h-8 w-8 text-slate-300 mx-auto mb-2" />
              <p className="text-sm font-medium text-slate-700">No bank accounts yet</p>
              <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                Every upload names its account, so HDFC Hub can be told from HDFC Centre. Add the accounts first.
              </p>
              <Link
                href="/accounts/bank-accounts"
                className="mt-3 inline-flex items-center gap-1 min-h-[44px] px-4 rounded-lg bg-blue-600 text-white text-sm font-medium focus-ring"
              >
                <Plus className="h-4 w-4" />Add bank accounts
              </Link>
            </CardContent>
          </Card>
        ) : accounts.length > 0 ? (
          <>
            {wantedMissing && (
              <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-2">
                The account in the link is retired or no longer exists — pick one below.
              </p>
            )}
            <UploadCard
              accounts={accounts}
              selectedId={selectedId}
              onSelect={(id) => {
                setPicked(id);
                setShowAll(false);
              }}
              periodFrom={periodFrom}
              periodTo={periodTo}
              onPeriodFrom={setPeriodFrom}
              onPeriodTo={setPeriodTo}
              lastEnded={lastEnded}
              uploading={uploading}
              step={step}
              onFile={(f) => void handleUpload(f)}
            />
          </>
        ) : null)}

      {error && (
        <UploadError
          message={error}
          diagnostics={diagnostics}
          onDismiss={() => {
            setError(null);
            setDiagnostics(null);
            setStep("idle");
          }}
        />
      )}
      {success && (
        <UploadSuccess
          message={success.message}
          statementId={success.statementId}
          onDismiss={() => {
            setSuccess(null);
            setStep("idle");
          }}
        />
      )}

      {mayAssign && unassignedError && (
        <ErrorBanner message={unassignedError} onRetry={() => setListKey((k) => k + 1)} />
      )}
      {mayAssign && !accountsLoading && (
        <AssignSection statements={unassigned} accounts={accounts} onAssigned={handleAssigned} />
      )}

      <PastUploads
        statements={statements}
        loading={listLoading}
        error={listError}
        onRetry={() => setListKey((k) => k + 1)}
        account={selected}
        showAll={showAll}
        onShowAll={setShowAll}
      />
    </div>
  );
}

function Header() {
  return (
    <div className="flex items-center justify-between gap-2 mb-4">
      <div className="flex items-center gap-2 min-w-0">
        <Link
          href="/accounts"
          aria-label="Back to Accounts"
          className="min-h-[44px] min-w-[44px] -ml-2 inline-flex items-center justify-center rounded-lg focus-ring"
        >
          <ArrowLeft className="h-5 w-5 text-slate-600" />
        </Link>
        <h1 className="text-lg font-bold text-slate-900">Bank statements</h1>
      </div>
      <Link
        href="/accounts/bank-accounts"
        className="inline-flex items-center gap-1 min-h-[44px] px-2 text-xs text-blue-600 focus-ring rounded"
      >
        <Landmark className="h-3.5 w-3.5" />Accounts
      </Link>
    </div>
  );
}
