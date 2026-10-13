"use client";

// The suspense register (plan 1210-bank-accounts-and-suspense, R6–R10, §3 D3): every bank line
// nobody could explain yet, across all accounts, with who is chasing it and for how long.
// Filters: Open (default) / Closed / All, one account (`?account=<id>` pre-selects — the weekly
// tile links here), and "Assigned to me". Tap a card for its sheet.
//
// Loads when the page opens and when a person changes a filter or acts — never on a timer.
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Inbox } from "lucide-react";
import { ErrorBanner } from "@/components/ui/error-banner";
import { SkeletonList } from "@/components/ui/skeleton";
import { Pagination } from "@/components/ui/pagination";
import { usePermissions } from "@/lib/use-permissions";
import { apiFetchEnvelope, apiTry, ApiError, type PageMeta } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";
import { accountChipLabel, type BankAccountRow } from "../bank-accounts/_components/types";
import { SuspenseCard } from "./_components/suspense-card";
import { CaseSheet } from "./_components/case-sheet";
import type { StatusFilter, SuspenseRow } from "./_components/types";

const log = createLogger("accounts:suspense");

const PAGE_SIZE = 25;

const STATUS_CHIPS: { key: StatusFilter; label: string }[] = [
  { key: "open", label: "Open" },
  { key: "closed", label: "Closed" },
  { key: "all", label: "All" },
];

/**
 * `useSearchParams` in a Client Component must sit under a Suspense boundary, or the production
 * build fails prerendering this page (node_modules/next/dist/docs/01-app/03-api-reference/
 * 04-functions/use-search-params.md).
 */
export default function SuspensePage() {
  return (
    <Suspense fallback={<SkeletonList count={5} type="card" />}>
      <SuspenseScreen />
    </Suspense>
  );
}

function SuspenseScreen() {
  const searchParams = useSearchParams();
  const { canView, canEdit, canApprove, loading: permsLoading } = usePermissions();
  const canAccess = canView("bank_recon");
  // Nothing is fetched until the grants are known: a request sent before then is refused for a
  // user who may well hold the permission.
  const enabled = !permsLoading && canAccess;

  const [status, setStatus] = useState<StatusFilter>("open");
  const [accountId, setAccountId] = useState(() => searchParams.get("account") ?? "");
  const [mine, setMine] = useState(false);
  const [page, setPage] = useState(1);

  const [rows, setRows] = useState<SuspenseRow[]>([]);
  const [pagination, setPagination] = useState<PageMeta | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  const [accounts, setAccounts] = useState<BankAccountRow[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);

  const query = new URLSearchParams({
    status,
    page: String(page),
    limit: String(PAGE_SIZE),
    ...(accountId ? { bankAccountId: accountId } : {}),
    ...(mine ? { assignee: "me" } : {}),
  }).toString();
  // `loading` is derived (the expenses-page pattern): the list is loading whenever the filters
  // (or a reload) name a request whose answer has not landed yet.
  const requestKey = `${query}|${reloadKey}`;
  const loading = loadedFor !== requestKey;

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const key = `${query}|${reloadKey}`;
    apiFetchEnvelope<SuspenseRow[]>(`/api/bank-suspense?${query}`)
      .then((env) => {
        if (cancelled) return;
        setLoadError(null);
        setRows(env.data ?? []);
        setPagination(env.pagination ?? null);
        log.debug("suspense list loaded", { rows: env.data?.length ?? 0, total: env.pagination?.total ?? null });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const message = e instanceof Error ? e.message : "Could not load the suspense list";
        log.error("suspense list failed", { status: e instanceof ApiError ? e.status : undefined, message });
        setLoadError(message);
        setRows([]);
        setPagination(null);
      })
      .finally(() => {
        if (!cancelled) setLoadedFor(key);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, query, reloadKey]);

  // The account select. Retired accounts are included: a closed case can sit on one. If the list
  // cannot be read, the select offers "All accounts" only — the register itself still works.
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    apiTry<BankAccountRow[]>("/api/bank-accounts?includeInactive=1").then(({ data, error, status: st }) => {
      if (cancelled) return;
      if (error || !Array.isArray(data)) {
        log.warn("bank account list unavailable; account filter limited", { status: st, message: error });
        return;
      }
      setAccounts(data);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);
  // The sheet reports every change; the list re-reads once, when the sheet closes, rather than
  // behind the sheet after each note.
  const sheetChanged = useRef(false);
  const markChanged = useCallback(() => {
    sheetChanged.current = true;
  }, []);
  const closeSheet = useCallback(() => {
    setOpenId(null);
    if (sheetChanged.current) {
      sheetChanged.current = false;
      setReloadKey((k) => k + 1);
    }
  }, []);

  if (permsLoading) {
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
        <p className="text-xs text-slate-500 mt-1">You do not have permission to view bank reconciliation.</p>
      </div>
    );
  }

  const selectedMissing = accountId && !accounts.some((a) => a.id === accountId);
  const narrowed = accountId !== "" || mine;
  const emptyText = narrowed
    ? "Nothing matches these filters"
    : status === "closed"
      ? "No closed cases yet"
      : "Nothing in suspense";

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Link href="/accounts" aria-label="Back to Accounts"
          className="min-h-[44px] min-w-[44px] -ml-2 flex items-center justify-center text-slate-500 hover:text-slate-800 focus-ring rounded">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="min-w-0">
          <h1 className="text-lg font-bold text-slate-900">Suspense</h1>
          <p className="text-[11px] text-slate-500">Bank lines nobody could explain yet</p>
        </div>
      </div>

      <div className="flex gap-2 mb-2 overflow-x-auto scrollbar-hide pb-1" role="group" aria-label="Status">
        {STATUS_CHIPS.map((c) => (
          <button key={c.key} type="button" aria-pressed={status === c.key}
            onClick={() => { setStatus(c.key); setPage(1); }}
            className={`shrink-0 min-h-[44px] px-4 rounded-full text-xs font-medium transition-colors focus-ring ${
              status === c.key ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}>
            {c.label}
          </button>
        ))}
        <button type="button" aria-pressed={mine} onClick={() => { setMine((m) => !m); setPage(1); }}
          className={`shrink-0 min-h-[44px] px-4 rounded-full text-xs font-medium transition-colors focus-ring ${
            mine ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
          }`}>
          Assigned to me
        </button>
      </div>

      <div className="mb-3">
        <label htmlFor="suspense-account" className="sr-only">Bank account</label>
        <select id="suspense-account" value={accountId}
          onChange={(e) => { setAccountId(e.target.value); setPage(1); }}
          className="w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="">All accounts</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {accountChipLabel(a)}
              {a.isActive ? "" : " (retired)"}
            </option>
          ))}
          {selectedMissing && <option value={accountId}>The account from the link</option>}
        </select>
      </div>

      {loadError && <ErrorBanner message={loadError} onRetry={reload} />}

      {loading ? (
        <SkeletonList count={5} type="card" />
      ) : !loadError && rows.length === 0 ? (
        <div className="text-center py-12">
          <Inbox className="h-8 w-8 mx-auto text-slate-300" aria-hidden="true" />
          <p className="text-sm font-medium text-slate-600 mt-2">{emptyText}</p>
          {status === "open" && !narrowed && (
            <p className="text-xs text-slate-400 mt-1">Lines are parked from a statement on the reconcile screen.</p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <SuspenseCard key={r.id} row={r} onOpen={setOpenId} />
          ))}
        </div>
      )}

      {!loading && pagination && pagination.total > 0 && (
        <Pagination page={pagination.page} totalPages={pagination.totalPages} total={pagination.total}
          count={rows.length} limit={pagination.limit} onPageChange={setPage} />
      )}

      <CaseSheet caseId={openId} canEdit={canEdit("bank_recon")} canApprove={canApprove("bank_recon")}
        onClose={closeSheet} onChanged={markChanged} />
    </div>
  );
}
