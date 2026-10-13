"use client";

// The vendor's Credits tab (plan 1210 credit notes, Part 4 — R1, R2, R11; 13 Oct: Q1 = b, D17–D19).
//
// Credit notes are not typed here (D3): they are entered in Zoho Books and fetched on /bills. This
// lists every credit (GET /api/vendors/[id]/credits — not the 10 the vendor route used to carry),
// with what is open, where each was applied ("here" or "in Zoho"), refunds, and the issues it
// settles. Apply credit (bills.create) opens the shared sheet from the credit's side; Remove
// (bills.edit) takes back an application made here. An over-applied credit — applied here and in
// Zoho for more than its total — is shown in red and never filtered away (D17).
//
// Mounted by vendors/[id]/page.tsx in its Credits tab. `onChanged` lets the page refresh figures
// that an apply or a remove moves (outstanding, ledger). Loads on mount and on Retry only.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowDownToLine, Loader2, Receipt, Trash2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SkeletonList } from "@/components/ui/skeleton";
import { ErrorBanner } from "@/components/ui/error-banner";
import { ApplyCreditSheet, removeCreditApplication, type ApplyCreditCredit } from "@/components/apply-credit-sheet";
import { usePermissions } from "@/lib/use-permissions";
import { apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";

const log = createLogger("vendors:credits");

const inr = (n: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(n);
const shortDate = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "";

interface CreditApplicationRow {
  id: string;
  source: "ZOHO" | "APP";
  amount: number;
  appliedDate: string;
  note: string | null;
  billId: string | null;
  billNo: string | null;
  appliedBy: string | null;
}

interface CreditRow {
  id: string;
  creditNoteNo: string;
  referenceNo: string | null;
  creditDate: string;
  reason: string | null;
  status: "OPEN" | "CLOSED" | "VOID";
  storeId: string | null;
  store: { id: string; code: string; name: string } | null;
  amount: number;
  applied: number;
  appliedHere: number;
  appliedInZoho: number;
  refunded: number;
  open: number;
  overApplied: boolean;
  overAppliedBy: number;
  applications: CreditApplicationRow[];
  refunds: Array<{ id: string; refundDate: string; amount: number; refundMode: string | null; referenceNo: string | null }>;
  issues: Array<{ id: string; issueNo: string; status: string }>;
}

interface CreditsResponse {
  credits: CreditRow[];
  totals: { openAmount: number; openCount: number; overAppliedCount: number; allCount: number; count: number };
}

interface StoreOption {
  id: string;
  name: string;
}

const STATUS_BADGE: Record<CreditRow["status"], { label: string; variant: "info" | "default" | "danger" }> = {
  OPEN: { label: "Open", variant: "info" },
  CLOSED: { label: "Closed", variant: "default" },
  VOID: { label: "Void", variant: "danger" },
};

export function VendorCredits({ vendorId, onChanged }: { vendorId: string; onChanged?: () => void }) {
  const { canEdit, canCreate, canFetch } = usePermissions();
  const mayEdit = canEdit("bills");
  const mayApply = canCreate("bills");

  const [filter, setFilter] = useState<"open" | "all">("open");
  const [data, setData] = useState<CreditsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stores, setStores] = useState<StoreOption[] | null>(null);
  const [applyFor, setApplyFor] = useState<ApplyCreditCredit | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(
    () =>
      apiTry<CreditsResponse>(`/api/vendors/${vendorId}/credits?status=${filter}`).then(({ data: res, error: err, status }) => {
        if (err || !res) {
          log.warn("credits failed to load", { vendorId, filter, status, message: err });
          setError(err ?? "Could not load credit notes.");
        } else {
          setData(res);
          setError(null);
          // An open Apply sheet follows the credit's fresh open amount (after a 409 reload).
          setApplyFor((cur) => {
            const fresh = cur ? res.credits.find((c) => c.id === cur.id) : undefined;
            return cur && fresh ? { ...cur, open: fresh.open, storeId: fresh.storeId, storeName: fresh.store?.name ?? null } : cur;
          });
        }
        setLoading(false);
      }),
    [vendorId, filter]
  );

  useEffect(() => {
    void load();
  }, [load]);

  // The store list is needed only to set a store on a credit that has none.
  const needsStores = mayEdit && Boolean(data?.credits.some((c) => !c.storeId && c.status !== "VOID"));
  useEffect(() => {
    if (!needsStores || stores !== null) return;
    void apiTry<StoreOption[]>("/api/stores").then(({ data: res, error: err }) => {
      if (err || !res) {
        log.warn("stores failed to load", { message: err });
        setStores([]);
        return;
      }
      setStores(res.map((s) => ({ id: s.id, name: s.name })));
    });
  }, [needsStores, stores]);

  function reload() {
    setLoading(true);
    setError(null);
    void load();
  }

  function changed() {
    void load();
    onChanged?.();
  }

  async function setStore(credit: CreditRow, storeId: string) {
    if (!storeId) return;
    setBusyId(credit.id);
    setActionError(null);
    const { error: err, status } = await apiTry(`/api/vendor-credits/${credit.id}`, { method: "PUT", json: { storeId } });
    setBusyId(null);
    if (err) {
      log.warn("credit store not saved", { vendorCreditId: credit.id, status, message: err });
      setActionError(err);
      return;
    }
    log.info("credit store set", { vendorCreditId: credit.id, storeId });
    changed();
  }

  async function remove(credit: CreditRow, a: CreditApplicationRow) {
    const what = `${inr(a.amount)} of ${credit.creditNoteNo}${a.billNo ? ` from bill ${a.billNo}` : ""}`;
    if (!confirm(`Remove ${what}? The bill and the credit go back by exactly that amount.`)) return;
    setBusyId(a.id);
    setActionError(null);
    const res = await removeCreditApplication(a.id);
    setBusyId(null);
    if (!res.ok) {
      setActionError(res.error);
      if (res.status === 404 || res.status === 409) void load();
      return;
    }
    changed();
  }

  const totals = data?.totals;
  const credits = data?.credits ?? [];

  return (
    <div>
      {/* Strip: what is open, and where credit notes come from. */}
      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 mb-3 flex flex-wrap items-center gap-x-2 gap-y-1">
        <Receipt className="h-4 w-4 text-slate-400 shrink-0" />
        <p className="text-xs text-slate-700 flex-1 min-w-0">
          {totals ? (
            <>
              Open credit <span className="font-semibold tabular-nums">{inr(totals.openAmount)}</span> across{" "}
              <span className="tabular-nums">{totals.openCount}</span> note{totals.openCount === 1 ? "" : "s"}
            </>
          ) : (
            "Open credit"
          )}
          <span className="text-slate-500"> · credit notes are entered in Zoho Books</span>
        </p>
        {canFetch("zoho") && (
          <Link
            href="/bills?fetch=credits"
            className="inline-flex items-center gap-1 min-h-[44px] px-2 text-xs font-medium text-blue-600 hover:text-blue-700"
          >
            <ArrowDownToLine className="h-3.5 w-3.5" /> Fetch credit notes
          </Link>
        )}
      </div>

      {/* Open / All */}
      <div role="tablist" aria-label="Which credit notes" className="flex gap-2 mb-3">
        {(["open", "all"] as const).map((f) => (
          <button
            key={f}
            type="button"
            role="tab"
            aria-selected={filter === f}
            onClick={() => {
              if (f === filter) return;
              setLoading(true);
              setFilter(f);
            }}
            className={`min-h-[44px] px-4 rounded-full text-xs font-medium transition-colors ${
              filter === f ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            {f === "open" ? "Open" : "All"}
            {totals && (
              <span className="ml-1 tabular-nums opacity-80">
                {f === "open" ? totals.openCount + totals.overAppliedCount : totals.allCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {actionError && <ErrorBanner message={actionError} onDismiss={() => setActionError(null)} />}
      {error && <ErrorBanner message={error} onRetry={reload} />}

      {loading && !data ? (
        <SkeletonList count={3} type="card" />
      ) : credits.length === 0 && !error ? (
        <div className="text-center py-10 px-4">
          <Receipt className="h-10 w-10 text-slate-300 mx-auto mb-2" />
          <p className="text-sm text-slate-600">
            {filter === "open" ? "No open credit notes." : "No credit notes for this vendor yet."}
          </p>
          <p className="text-xs text-slate-500 mt-1">
            Credit notes are entered in Zoho Books and fetched on Bills with <span className="font-medium">Fetch credit notes</span>.
          </p>
          {filter === "open" && totals && totals.allCount > 0 && (
            <button
              type="button"
              onClick={() => {
                setLoading(true);
                setFilter("all");
              }}
              className="mt-2 min-h-[44px] px-3 text-xs font-medium text-blue-600"
            >
              Show all {totals.allCount}
            </button>
          )}
        </div>
      ) : (
        <div className={`space-y-2 ${loading ? "opacity-60" : ""}`} aria-busy={loading}>
          {credits.map((c) => (
            <CreditCard
              key={c.id}
              credit={c}
              stores={stores}
              mayEdit={mayEdit}
              mayApply={mayApply}
              busyId={busyId}
              onSetStore={(storeId) => void setStore(c, storeId)}
              onRemove={(a) => void remove(c, a)}
              onApply={() =>
                setApplyFor({
                  id: c.id,
                  creditNoteNo: c.creditNoteNo,
                  referenceNo: c.referenceNo,
                  open: c.open,
                  storeId: c.storeId,
                  storeName: c.store?.name ?? null,
                })
              }
            />
          ))}
        </div>
      )}

      <ApplyCreditSheet
        open={applyFor !== null}
        onClose={() => setApplyFor(null)}
        vendorId={vendorId}
        credit={applyFor}
        onApplied={() => changed()}
        onStale={() => changed()}
      />
    </div>
  );
}

function CreditCard({
  credit: c,
  stores,
  mayEdit,
  mayApply,
  busyId,
  onSetStore,
  onRemove,
  onApply,
}: {
  credit: CreditRow;
  stores: StoreOption[] | null;
  mayEdit: boolean;
  mayApply: boolean;
  busyId: string | null;
  onSetStore: (storeId: string) => void;
  onRemove: (a: CreditApplicationRow) => void;
  onApply: () => void;
}) {
  const here = c.applications.filter((a) => a.source === "APP");
  const inZoho = c.applications.filter((a) => a.source === "ZOHO");
  const badge = STATUS_BADGE[c.status];
  const canApplyThis = mayApply && c.status === "OPEN" && c.open > 0.01;

  return (
    <Card className={c.overApplied ? "border-red-300" : c.status === "VOID" ? "opacity-70" : ""}>
      <CardContent className="p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-900 tabular-nums break-words">{c.creditNoteNo}</p>
            <p className="text-[11px] text-slate-500 tabular-nums">
              {shortDate(c.creditDate)}
              {c.referenceNo ? ` · supplier ref ${c.referenceNo}` : ""}
            </p>
            {c.reason && <p className="text-[11px] text-slate-500 break-words">{c.reason}</p>}
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            <Badge variant={badge.variant}>{badge.label}</Badge>
            {c.store && <Badge variant="default" className="text-[10px]">{c.store.name}</Badge>}
          </div>
        </div>

        {!c.store && c.status !== "VOID" && (
          <StorePicker credit={c} stores={stores} mayEdit={mayEdit} busy={busyId === c.id} onSetStore={onSetStore} />
        )}

        {c.overApplied && (
          <div role="alert" className="mt-2 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-2.5 py-2">
            <AlertTriangle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
            <p className="text-xs text-red-700 tabular-nums">
              Applied {inr(c.overAppliedBy)} more than its total — {inr(c.appliedHere)} here, {inr(c.appliedInZoho)} in Zoho. Remove one.
            </p>
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 mt-2 text-center">
          {[
            { label: "Total", value: c.amount, cls: "text-slate-900" },
            { label: "Applied", value: c.applied, cls: "text-slate-700" },
            { label: "Refunded", value: c.refunded, cls: "text-slate-700" },
            { label: "Open", value: c.open, cls: c.overApplied ? "text-red-600" : c.open > 0.01 ? "text-green-700" : "text-slate-500" },
          ].map((x) => (
            <div key={x.label} className="rounded-md bg-slate-50 px-1 py-1.5 min-w-0">
              <p className="text-[10px] text-slate-500">{x.label}</p>
              <p className={`text-xs font-semibold tabular-nums truncate ${x.cls}`}>{inr(x.value)}</p>
            </div>
          ))}
        </div>

        {here.length > 0 && (
          <ApplicationList title="Applied here" rows={here} mayRemove={mayEdit} busyId={busyId} onRemove={onRemove} />
        )}
        {inZoho.length > 0 && <ApplicationList title="Applied in Zoho" rows={inZoho} mayRemove={false} busyId={busyId} onRemove={onRemove} />}

        {c.refunds.length > 0 && (
          <div className="mt-2">
            <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wide">Refunded</p>
            {c.refunds.map((r) => (
              <p key={r.id} className="text-xs text-slate-700 tabular-nums">
                {inr(r.amount)} · {shortDate(r.refundDate)}
                {r.refundMode ? ` · ${r.refundMode}` : ""}
                {r.referenceNo ? ` · ref ${r.referenceNo}` : ""}
              </p>
            ))}
          </div>
        )}

        {c.issues.length > 0 && (
          <p className="mt-2 text-xs text-slate-600">
            Settles{" "}
            {c.issues.map((i, n) => (
              <span key={i.id}>
                {n > 0 && ", "}
                <Link href={`/vendor-issues/${i.id}`} className="text-blue-600 hover:underline tabular-nums">{i.issueNo}</Link>
              </span>
            ))}
          </p>
        )}

        {canApplyThis && (
          <Button variant="outline" onClick={onApply} className="w-full mt-2 min-h-[44px] text-blue-700 border-blue-200">
            Apply credit
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function StorePicker({
  credit,
  stores,
  mayEdit,
  busy,
  onSetStore,
}: {
  credit: CreditRow;
  stores: StoreOption[] | null;
  mayEdit: boolean;
  busy: boolean;
  onSetStore: (storeId: string) => void;
}) {
  if (!mayEdit) return <p className="mt-1 text-[11px] text-amber-700">Store not set</p>;
  if (stores === null) return <p className="mt-1 text-[11px] text-slate-400">Store not set · loading stores…</p>;
  if (stores.length === 0) return <p className="mt-1 text-[11px] text-amber-700">Store not set — no store to pick.</p>;
  // One store: nothing to choose, so one tap sets it (the expense form auto-selects the same way).
  if (stores.length === 1) {
    return (
      <button
        type="button"
        disabled={busy}
        onClick={() => onSetStore(stores[0].id)}
        className="mt-2 min-h-[44px] w-full rounded-lg border border-amber-200 bg-amber-50 px-3 text-xs font-medium text-amber-800 disabled:opacity-60"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin inline" /> : `Store not set — set to ${stores[0].name}`}
      </button>
    );
  }
  return (
    <label className="mt-2 flex items-center gap-2">
      <span className="text-[11px] text-amber-700 shrink-0">Store not set</span>
      <select
        aria-label={`Store for ${credit.creditNoteNo}`}
        disabled={busy}
        defaultValue=""
        onChange={(e) => onSetStore(e.target.value)}
        className="flex-1 min-h-[44px] rounded-lg border border-slate-300 bg-white px-2 text-sm disabled:opacity-60"
      >
        <option value="" disabled>
          Pick the store…
        </option>
        {stores.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function ApplicationList({
  title,
  rows,
  mayRemove,
  busyId,
  onRemove,
}: {
  title: string;
  rows: CreditApplicationRow[];
  mayRemove: boolean;
  busyId: string | null;
  onRemove: (a: CreditApplicationRow) => void;
}) {
  return (
    <div className="mt-2">
      <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wide">{title}</p>
      <ul className="divide-y divide-slate-100">
        {rows.map((a) => (
          <li key={a.id} className="flex items-center gap-2 py-1">
            <div className="flex-1 min-w-0">
              <p className="text-xs text-slate-800 tabular-nums">
                {a.billId ? (
                  <Link href={`/bills/${a.billId}`} className="text-blue-600 hover:underline">Bill {a.billNo}</Link>
                ) : (
                  <span className="text-slate-500">A Zoho bill not in the app yet</span>
                )}{" "}
                · <span className="font-medium">{inr(a.amount)}</span> · {shortDate(a.appliedDate)}
              </p>
              {(a.appliedBy || a.note) && (
                <p className="text-[11px] text-slate-500 break-words">
                  {a.appliedBy ? `by ${a.appliedBy}` : ""}
                  {a.appliedBy && a.note ? " · " : ""}
                  {a.note ?? ""}
                </p>
              )}
            </div>
            {mayRemove && a.source === "APP" && (
              <button
                type="button"
                onClick={() => onRemove(a)}
                disabled={busyId === a.id}
                aria-label={`Remove ${inr(a.amount)} applied to bill ${a.billNo ?? ""}`}
                className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg text-red-600 hover:bg-red-50 disabled:opacity-50"
              >
                {busyId === a.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default VendorCredits;
