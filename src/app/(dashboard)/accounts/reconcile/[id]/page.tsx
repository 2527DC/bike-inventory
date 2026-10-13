"use client";

// /accounts/reconcile/[id] — work one bank statement's lines (plan 1210-bank-accounts-and-suspense,
// §3 C3, Part F). This file fetches, filters and lists; each line, panel and sheet lives in
// _components/. Buttons follow usePermissions() — cosmetic only, the API re-checks every action.
//
// Filters: To review (processedAt null — AI-suggested lines included) · Suspense · Recorded ·
// Skipped · All. `?txn=<id>` (the suspense screen links here) opens that line's filter, scrolls
// to it and rings it. Every call goes through apiTry; a refused action shows the API's sentence
// under the line it belongs to. Nothing polls: the list reloads after each action.
import { Suspense, use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CheckSquare, Square } from "lucide-react";
import { SkeletonList } from "@/components/ui/skeleton";
import { ErrorBanner } from "@/components/ui/error-banner";
import { apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";
import { usePermissions } from "@/lib/use-permissions";
import { ReconcileProvider, type ReconcileCtx } from "./_components/context";
import { StatementHeader } from "./_components/statement-header";
import { LineList } from "./_components/line-list";
import { NoticeToast } from "./_components/notice-toast";
import { BulkBar, type BulkBody } from "./_components/bulk-bar";
import { ParkSheet } from "./_components/park-sheet";
import { resetVendors } from "./_components/use-vendors";
import {
  FILTERS, bulkSentence, inr, lineState,
  type BankTxn, type BulkResult, type FilterKey, type ReviewBody, type Statement,
} from "./_components/types";

const log = createLogger("accounts:reconcile");

const DONE: Record<ReviewBody["action"], string> = {
  confirm_payment: "Payment recorded.",
  confirm_expense: "Expense recorded.",
  link_payment: "Linked to the payment — nothing new was recorded.",
  link_expense: "Linked to the expense — nothing new was recorded.",
  ignore: "Skipped.",
  flag: "Parked in suspense.",
};

/** `useSearchParams` must sit under a Suspense boundary, or the production build fails prerendering. */
export default function ReconcilePage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<SkeletonList count={6} type="card" />}>
      <ReconcileScreen params={params} />
    </Suspense>
  );
}

function ReconcileScreen({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const txnParam = useSearchParams().get("txn");
  const { canEdit, canCreate } = usePermissions();

  const [statement, setStatement] = useState<Statement | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [filter, setFilter] = useState<FilterKey>("REVIEW");
  const [busyTxn, setBusyTxn] = useState("");
  const [lastError, setLastError] = useState<ReconcileCtx["lastError"]>(null);
  const [notice, setNotice] = useState<{ text: string; warn: boolean } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkError, setBulkError] = useState("");
  const [parkTxn, setParkTxn] = useState<BankTxn | null>(null);
  const jumpedRef = useRef(false);
  const scrolledRef = useRef(false);

  // State is set only in the promise callback, so the mount effect never sets state synchronously.
  const load = useCallback(() => {
    void apiTry<Statement>(`/api/bank-statements/${id}/review`).then(({ data, error, status }) => {
      if (error || !data) {
        log.error("statement load failed", { statementId: id, status, message: error });
        setLoadError(error ?? "Could not load the statement.");
      } else {
        setLoadError("");
        setStatement(data);
        // `?txn=`: open the filter that line sits in — once, so later reloads keep the person's choice.
        if (txnParam && !jumpedRef.current) {
          jumpedRef.current = true;
          const line = data.transactions.find((t) => t.id === txnParam);
          if (line) setFilter(lineState(line));
        }
      }
      setLoading(false);
    });
  }, [id, txnParam]);

  useEffect(() => {
    resetVendors();
    load();
  }, [load]);

  useEffect(() => {
    if (!txnParam || scrolledRef.current || !statement) return;
    const el = document.getElementById(`txn-${txnParam}`);
    if (!el) return;
    scrolledRef.current = true;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [txnParam, statement, filter]);

  const run = useCallback(
    async (txnId: string, body: ReviewBody) => {
      setBusyTxn(txnId);
      setLastError(null);
      setNotice(null);
      const { error, status } = await apiTry(`/api/bank-statements/${id}/review`, { method: "POST", json: { txnId, ...body } });
      setBusyTxn("");
      if (error) {
        log.error("reconcile action failed", { statementId: id, txnId, action: body.action, status, message: error });
        setLastError({ txnId, message: error });
        if (status === 409) load(); // handled elsewhere meanwhile — show what actually happened
        return false;
      }
      setNotice({ text: DONE[body.action], warn: false });
      load();
      return true;
    },
    [id, load]
  );

  const lines = useMemo(() => statement?.transactions ?? [], [statement]);
  // Only lines still to review can be ticked; a reload may have decided some meanwhile.
  const selectedLines = useMemo(() => lines.filter((t) => selected.has(t.id) && lineState(t) === "REVIEW"), [lines, selected]);

  async function runBulk(body: BulkBody) {
    const txnIds = selectedLines.map((t) => t.id);
    setBulkBusy(true);
    setBulkError("");
    setNotice(null);
    const { data, error, status } = await apiTry<BulkResult>(`/api/bank-statements/${id}/review`, {
      method: "POST",
      json: { txnIds, ...body },
    });
    setBulkBusy(false);
    if (error || !data) {
      log.error("reconcile bulk action failed", { statementId: id, action: body.action, count: txnIds.length, status, message: error });
      setBulkError(error ?? "That did not go through. Try again.");
      return;
    }
    setSelected(new Set());
    setNotice({ text: bulkSentence(data), warn: data.refused.length > 0 });
    load();
  }

  const closePark = useCallback(() => setParkTxn(null), []);
  const edit = canEdit("bank_recon");
  const ctx: ReconcileCtx = {
    statementId: id,
    perms: { edit, payment: edit && canCreate("bills"), expense: edit && canCreate("expenses") },
    busyTxn,
    bulkMode: selectedLines.length > 0,
    selected,
    toggleSelect: (txnId) =>
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(txnId)) next.delete(txnId);
        else next.add(txnId);
        return next;
      }),
    selectMany: (txnIds, on) =>
      setSelected((prev) => {
        const next = new Set(prev);
        for (const t of txnIds) {
          if (on) next.add(t);
          else next.delete(t);
        }
        return next;
      }),
    run,
    lastError,
    openPark: (txn) => {
      setLastError(null);
      setParkTxn(txn);
    },
    expenseStores: statement?.expenseStores ?? [],
    // The statement account's store, pre-selected on Expense when it is an active store.
    defaultStoreId:
      statement?.bankAccount?.storeId && statement.expenseStores.some((s) => s.id === statement.bankAccount?.storeId)
        ? statement.bankAccount.storeId
        : "",
    highlightId: txnParam,
  };

  const counts = useMemo(() => {
    const c: Record<FilterKey, number> = { REVIEW: 0, SUSPENSE: 0, RECORDED: 0, SKIPPED: 0, ALL: lines.length };
    for (const t of lines) c[lineState(t)]++;
    return c;
  }, [lines]);
  const filtered = useMemo(() => (filter === "ALL" ? lines : lines.filter((t) => lineState(t) === filter)), [lines, filter]);
  const tickable = edit ? filtered.filter((t) => lineState(t) === "REVIEW") : [];
  const allTicked = tickable.length > 0 && tickable.every((t) => selected.has(t.id));

  if (loading) return <SkeletonList count={6} type="card" />;

  if (!statement) {
    return (
      <div className="text-center py-12 px-4">
        <p className={`text-sm ${loadError ? "text-red-600" : "text-slate-500"}`}>{loadError || "Statement not found"}</p>
        <div className="flex justify-center gap-2 mt-3">
          <button type="button" onClick={load} className="min-h-11 px-4 rounded-lg border border-slate-300 text-sm">Retry</button>
          <Link href="/accounts/bank-upload" className="min-h-11 px-4 rounded-lg border border-slate-300 text-sm flex items-center">Back</Link>
        </div>
      </div>
    );
  }

  return (
    <ReconcileProvider value={ctx}>
      <div className={selectedLines.length > 0 ? "pb-80" : "pb-24"}>
        {loadError && <ErrorBanner message={`Could not refresh: ${loadError}`} onRetry={load} />}
        <StatementHeader statement={statement} toReview={counts.REVIEW} />

        <div className="flex gap-1.5 overflow-x-auto scrollbar-hide mb-3 pb-1" role="tablist" aria-label="Show lines">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              role="tab"
              aria-selected={filter === f.key}
              onClick={() => {
                setFilter(f.key);
                setSelected(new Set());
              }}
              className={`shrink-0 min-h-11 px-3 rounded-full text-xs font-medium ${filter === f.key ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"}`}
            >
              {f.label}
              {counts[f.key] > 0 ? ` (${counts[f.key]})` : ""}
            </button>
          ))}
        </div>

        {tickable.length > 0 && (
          <div className="flex items-center justify-between mb-2">
            <button
              type="button"
              onClick={() => setSelected(allTicked ? new Set() : new Set(tickable.map((t) => t.id)))}
              className="min-h-11 flex items-center gap-1.5 text-xs text-slate-600"
            >
              {allTicked ? <CheckSquare className="h-4 w-4 text-blue-600" /> : <Square className="h-4 w-4" />}
              Select all to review ({tickable.length})
            </button>
            {selectedLines.length > 0 && (
              <p className="text-[11px] text-blue-600 font-medium">
                {selectedLines.length} · {inr(selectedLines.reduce((s, t) => s + t.amount, 0))}
              </p>
            )}
          </div>
        )}

        <LineList lines={filtered} filter={filter} />
      </div>

      {selectedLines.length > 0 && (
        <BulkBar lines={selectedLines} busy={bulkBusy} error={bulkError} onRun={runBulk} onClear={() => setSelected(new Set())} />
      )}

      {notice && selectedLines.length === 0 && (
        <NoticeToast text={notice.text} warn={notice.warn} onDismiss={() => setNotice(null)} />
      )}

      {parkTxn && (
        <ParkSheet
          txn={parkTxn}
          onClose={closePark}
          onParked={() => {
            setNotice({ text: DONE.flag, warn: false });
            load();
          }}
          onStale={load}
        />
      )}
    </ReconcileProvider>
  );
}
