"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Landmark, Pencil, Plus, Power, RotateCcw, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SkeletonList } from "@/components/ui/skeleton";
import { ErrorBanner } from "@/components/ui/error-banner";
import { usePermissions } from "@/lib/use-permissions";
import { apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";
import { AccountSheet } from "./_components/account-sheet";
import { BANK_LABELS, dayLabel, type BankAccountRow, type StoreOption } from "./_components/types";

const log = createLogger("accounts:bank-accounts");

/**
 * The bank accounts, as data (plan 1210-bank-accounts-and-suspense, R1, §3 B3). Everyone with
 * Bank Reconciliation › View sees the list; adding, editing and retiring need › Approve (Q8).
 * Those buttons are cosmetic — /api/bank-accounts re-checks every write.
 *
 * Retired accounts stay on the list, dimmed with a badge (the /team pattern): their statements
 * keep their name, and one can be brought back.
 */
export default function BankAccountsPage() {
  const { canView, canApprove, canCreate, loading: permsLoading } = usePermissions();
  const mayView = canView("bank_recon");
  const mayManage = canApprove("bank_recon");
  const mayUpload = canCreate("bank_recon");
  // Nothing is fetched until the grants are known — a request sent earlier is refused for a
  // person who may well hold the permission.
  const enabled = !permsLoading && mayView;

  const [accounts, setAccounts] = useState<BankAccountRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [loadedFor, setLoadedFor] = useState<number | null>(null);
  const loading = loadedFor !== reloadKey;

  const [stores, setStores] = useState<StoreOption[] | null>(null);
  const [storesError, setStoresError] = useState<string | null>(null);

  const [sheet, setSheet] = useState<{ editing: BankAccountRow | null } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    apiTry<BankAccountRow[]>("/api/bank-accounts?includeInactive=1").then(({ data, error, status }) => {
      if (cancelled) return;
      if (error || !data) {
        log.error("accounts load failed", { status, message: error });
        setLoadError(error || "Could not load the bank accounts.");
        setAccounts([]);
      } else {
        setLoadError(null);
        setAccounts(data);
        log.debug("accounts loaded", { count: data.length });
      }
      setLoadedFor(reloadKey);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, reloadKey]);

  // The store picker's list — /api/stores is requireAuth only, so it never empties for lack of a
  // stores grant. Loaded only for someone who can open the sheet.
  useEffect(() => {
    if (!enabled || !mayManage) return;
    let cancelled = false;
    apiTry<StoreOption[]>("/api/stores").then(({ data, error, status }) => {
      if (cancelled) return;
      if (error || !data) {
        log.error("stores load failed", { status, message: error });
        setStoresError(error || "Could not load the stores.");
      } else {
        setStoresError(null);
        setStores(data.map((s) => ({ id: s.id, code: s.code, name: s.name })));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, mayManage]);

  const closeSheet = useCallback(() => setSheet(null), []);

  function handleSaved(message: string) {
    setSheet(null);
    setFlash(message);
    setActionError(null);
    setReloadKey((k) => k + 1);
  }

  async function setActive(a: BankAccountRow, isActive: boolean) {
    if (
      !isActive &&
      !confirm(
        `Retire ${a.name}? It leaves the upload screen and the weekly tile. Its statements keep its name, and you can bring it back later.`
      )
    ) {
      return;
    }
    setBusyId(a.id);
    setActionError(null);
    const { error, status } = await apiTry<BankAccountRow>(`/api/bank-accounts/${encodeURIComponent(a.id)}`, {
      method: "PATCH",
      json: { isActive },
    });
    setBusyId(null);
    if (error) {
      log.error("account active toggle failed", { bankAccountId: a.id, isActive, status, message: error });
      setActionError(error);
      return;
    }
    log.info(isActive ? "account reactivated" : "account retired", { bankAccountId: a.id });
    setFlash(isActive ? `${a.name} is active again` : `${a.name} retired`);
    setReloadKey((k) => k + 1);
  }

  const activeCount = accounts.filter((a) => a.isActive).length;
  const iconBtn =
    "min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-40 focus-ring";

  if (!permsLoading && !mayView) {
    return (
      <div>
        <Header />
        <p className="text-sm text-slate-500 py-8 text-center">
          You do not have access to bank accounts. Ask an admin for View on Bank Reconciliation.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-4">
        <Header subtitle={loading ? undefined : `${activeCount} active`} />
        {mayManage && (
          <Button size="sm" className="min-h-[44px] bg-blue-600 hover:bg-blue-700" onClick={() => setSheet({ editing: null })}>
            <Plus className="h-3.5 w-3.5 mr-1" />Add
          </Button>
        )}
      </div>

      {flash && (
        <div role="status" className="bg-green-50 border border-green-200 rounded-lg p-2.5 mb-3 text-xs text-green-700 flex items-start justify-between gap-2">
          <span>{flash}</span>
          <button type="button" onClick={() => setFlash(null)} className="underline shrink-0">dismiss</button>
        </div>
      )}
      {actionError && <ErrorBanner message={actionError} onDismiss={() => setActionError(null)} />}
      {loadError && <ErrorBanner message={loadError} onRetry={() => setReloadKey((k) => k + 1)} />}

      {loading ? (
        <SkeletonList count={4} type="card" />
      ) : accounts.length === 0 && !loadError ? (
        <div className="text-center py-10 px-4">
          <Landmark className="h-10 w-10 text-slate-300 mx-auto mb-3" />
          <p className="text-sm font-medium text-slate-700">No bank accounts yet</p>
          <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
            Add each account the business banks with — ICICI, HDFC Hub, HDFC Centre and Dhanlaxmi — so every
            statement upload names its account and HDFC Hub can be told from HDFC Centre.
          </p>
          {mayManage ? (
            <Button className="mt-4 min-h-[44px] bg-blue-600 hover:bg-blue-700" onClick={() => setSheet({ editing: null })}>
              <Plus className="h-4 w-4 mr-1" />Add the first account
            </Button>
          ) : (
            <p className="text-xs text-slate-500 mt-3">
              Ask someone with Approve on Bank Reconciliation to add them.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {accounts.map((a) => (
            <Card key={a.id} className={a.isActive ? "" : "opacity-60"}>
              <CardContent className="p-3">
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <p className="text-sm font-semibold text-slate-900 break-words">{a.name}</p>
                      <Badge className="text-[10px]">{BANK_LABELS[a.bank]}</Badge>
                      {!a.isActive && <Badge variant="danger" className="text-[10px]">Retired</Badge>}
                    </div>
                    <p className="text-xs mt-1 tabular-nums">
                      {a.accountLast4 ? (
                        <span className="text-slate-700">••••{a.accountLast4}</span>
                      ) : (
                        <span className="text-slate-400 italic">digits not set</span>
                      )}
                    </p>
                    <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
                      {a.store ? (
                        <span className="text-[11px] text-slate-600">
                          {a.store.name} <span className="text-slate-400">({a.store.code})</span>
                        </span>
                      ) : (
                        <Badge variant="warning" className="text-[10px]">Store not set</Badge>
                      )}
                    </div>
                    {(a.reconcileFrom || a.zohoAccountId) && (
                      <div className="mt-1.5 space-y-0.5 text-[11px] text-slate-500">
                        {a.reconcileFrom && <p>Reconcile from {dayLabel(a.reconcileFrom)}</p>}
                        {a.zohoAccountId && <p className="break-all">Zoho id {a.zohoAccountId}</p>}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col sm:flex-row gap-1 shrink-0">
                    {a.isActive && mayUpload && (
                      <Link
                        href={`/accounts/bank-upload?account=${encodeURIComponent(a.id)}`}
                        aria-label={`Upload a statement for ${a.name}`}
                        className={`${iconBtn} text-blue-600`}
                      >
                        <Upload className="h-4 w-4" />
                      </Link>
                    )}
                    {mayManage && (
                      <>
                        <button
                          type="button"
                          onClick={() => setSheet({ editing: a })}
                          disabled={busyId === a.id}
                          aria-label={`Edit ${a.name}`}
                          className={`${iconBtn} text-slate-600`}
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void setActive(a, !a.isActive)}
                          disabled={busyId === a.id}
                          aria-label={a.isActive ? `Retire ${a.name}` : `Bring ${a.name} back`}
                          className={`${iconBtn} ${a.isActive ? "text-amber-600" : "text-green-600"}`}
                        >
                          {a.isActive ? <Power className="h-4 w-4" /> : <RotateCcw className="h-4 w-4" />}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {sheet && (
        <AccountSheet
          key={sheet.editing?.id ?? "new"}
          editing={sheet.editing}
          stores={stores}
          storesError={storesError}
          onClose={closeSheet}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}

function Header({ subtitle }: { subtitle?: string }) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <Link
        href="/accounts"
        aria-label="Back to Accounts"
        className="min-h-[44px] min-w-[44px] -ml-2 inline-flex items-center justify-center rounded-lg focus-ring"
      >
        <ArrowLeft className="h-5 w-5 text-slate-600" />
      </Link>
      <div className="min-w-0">
        <h1 className="text-lg font-bold text-slate-900">Bank accounts</h1>
        {subtitle && <p className="text-xs text-slate-500 tabular-nums">{subtitle}</p>}
      </div>
    </div>
  );
}
