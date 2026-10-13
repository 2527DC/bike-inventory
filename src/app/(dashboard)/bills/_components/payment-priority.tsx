"use client";

// The "Pay first" tab on /bills — plan 1210 credit notes and payables, Part 7.3–7.4
// (R10, R11, R12; D8, Q6, Q7).
//
// Reads GET /api/bills/priority, which already sorts the bills into tiers (CD claimable first,
// then past due >45, 31–45, 1–30, due within 7 days, the rest) and computes every number with
// the shared IST day rule. This component only filters by age (Q6 = a: days since the bill
// date) and lays the tiers out: cards on a phone, a DesktopTable per tier from 1024 px.
//
// Nothing here polls: the list loads when the tab opens and when the store chip changes.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CheckCircle2, FileSpreadsheet, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { SkeletonList } from "@/components/ui/skeleton";
import { DesktopTable, type Column } from "@/components/desktop-table";
import { exportToExcel, type ExportColumn } from "@/lib/export";
import { apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";
import { usePermissions } from "@/lib/use-permissions";
import {
  StoreChip,
  ageText,
  dueText,
  formatCurrency,
  formatDay,
  storeFilterOptions,
  storeQueryValue,
  type BillStore,
  type StoreFilter,
  type StoreOption,
} from "./shared";

const log = createLogger("bills:priority");

type Tier = "cd" | "pastDueOver45" | "pastDue31to45" | "pastDue1to30" | "dueSoon" | "later" | "onHold";

export interface PriorityBill {
  id: string;
  billNo: string;
  status: string;
  billDate: string;
  dueDate: string;
  vendor: { id: string; name: string; code: string };
  store: BillStore;
  amount: number;
  paidAmount: number;
  openAmount: number;
  daysSinceBill: number;
  /** ≤ 0 = not due yet; 0 = due today. Against the stored due date (Q5). */
  daysPastDue: number;
  cd: {
    percentage: number;
    termsDays: number;
    deadline: string;
    daysLeft: number;
    amount: number;
    claimable: boolean;
  } | null;
  /** Open credit of this supplier that Apply credit would accept on this bill. */
  openCredit: number;
  coveredByCredit: boolean;
  itcAtRisk: boolean;
  tier: Tier;
}

interface Total {
  count: number;
  amount: number;
}

interface PriorityResponse {
  asOf: string;
  bills: PriorityBill[];
  onHold: PriorityBill[];
  totals: {
    all: Total;
    onHold: Total;
    over30: Total;
    over45: Total;
    cdClaimable: number;
    itcAtRisk: Total;
    openCredit: number;
  };
  truncated: boolean;
  notice: string | null;
}

const TIERS: Array<{ key: Tier; label: string; hint?: string; tone: string }> = [
  { key: "cd", label: "Cash discount still claimable", hint: "Soonest deadline first — paying these earns money", tone: "text-green-700" },
  { key: "pastDueOver45", label: "More than 45 days past due", tone: "text-red-700" },
  { key: "pastDue31to45", label: "31–45 days past due", tone: "text-red-600" },
  { key: "pastDue1to30", label: "1–30 days past due", tone: "text-orange-600" },
  { key: "dueSoon", label: "Due in the next 7 days", tone: "text-amber-700" },
  { key: "later", label: "Due later", tone: "text-slate-600" },
];
const TIER_LABEL: Record<Tier, string> = {
  ...(Object.fromEntries(TIERS.map((t) => [t.key, t.label])) as Record<Exclude<Tier, "onHold">, string>),
  onHold: "On hold — disputed",
};

type AgeFilter = "all" | "over30" | "over45";
const AGE_CHIPS: Array<{ key: AgeFilter; label: string }> = [
  { key: "all", label: "All ages" },
  { key: "over30", label: ">30 days old" },
  { key: "over45", label: ">45 days old" },
];

const sumOpen = (list: PriorityBill[]) => list.reduce((s, b) => s + b.openAmount, 0);

function cdText(cd: NonNullable<PriorityBill["cd"]>) {
  const left = cd.daysLeft === 0 ? "last day" : `${cd.daysLeft} day${cd.daysLeft === 1 ? "" : "s"} left`;
  return `${cd.percentage}% · ${formatCurrency(cd.amount)} · ${left}`;
}

const ITC_TITLE = "Input tax credit must be reversed if this bill is not paid within 180 days of its date";

function Badges({ bill }: { bill: PriorityBill }) {
  const showCd = bill.cd?.claimable;
  if (!showCd && !bill.coveredByCredit && !bill.itcAtRisk) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {showCd && bill.cd && (
        <Badge variant="success" className="text-[11px] tabular-nums">
          CD {cdText(bill.cd)}
        </Badge>
      )}
      {bill.coveredByCredit && (
        <Badge variant="info" className="text-[11px]">
          Use credit first
        </Badge>
      )}
      {bill.itcAtRisk && (
        <Badge variant="danger" className="text-[11px]" title={ITC_TITLE}>
          ITC at risk
        </Badge>
      )}
    </div>
  );
}

/** The credit line under a bill (R11): "apply it on the bill" — Apply credit is on /bills/[id]. */
function CreditHint({ bill }: { bill: PriorityBill }) {
  if (bill.openCredit <= 0) return null;
  return (
    <Link
      href={`/bills/${bill.id}`}
      onClick={(e) => e.stopPropagation()}
      className="block text-xs text-blue-700 underline-offset-2 hover:underline"
    >
      {bill.coveredByCredit
        ? `Apply credit on the bill — ${formatCurrency(bill.openCredit)} open with this supplier`
        : `${formatCurrency(bill.openCredit)} open credit with this supplier — apply it on the bill`}
    </Link>
  );
}

function PayButton({ bill, compact = false }: { bill: PriorityBill; compact?: boolean }) {
  return (
    <Link
      href={`/payments/new?billId=${encodeURIComponent(bill.id)}&vendorId=${encodeURIComponent(bill.vendor.id)}`}
      onClick={(e) => e.stopPropagation()}
      className={`inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg bg-slate-900 font-medium text-white active:bg-slate-700 focus-ring ${
        compact ? "px-3 text-xs" : "px-5 text-sm"
      }`}
    >
      Pay
    </Link>
  );
}

function PriorityCard({ bill, canPay }: { bill: PriorityBill; canPay: boolean }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <Link href={`/bills/${bill.id}`} className="min-w-0 flex-1 focus-ring rounded">
          <p className="truncate text-sm font-semibold text-slate-900">{bill.vendor.name}</p>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
            <StoreChip store={bill.store} />
            <span className="tabular-nums">
              {bill.billNo} · due {formatDay(bill.dueDate)}
            </span>
          </div>
        </Link>
        <p className="shrink-0 text-base font-bold tabular-nums text-slate-900">{formatCurrency(bill.openAmount)}</p>
      </div>
      <p className={`mt-1.5 text-xs font-medium tabular-nums ${bill.daysPastDue > 0 ? "text-red-600" : "text-slate-600"}`}>
        {ageText(bill.daysSinceBill)} · {dueText(bill.daysPastDue)}
      </p>
      <div className="mt-2 flex items-end justify-between gap-2">
        <div className="min-w-0 flex-1 space-y-1.5">
          <Badges bill={bill} />
          <CreditHint bill={bill} />
        </div>
        {canPay && <PayButton bill={bill} />}
      </div>
    </div>
  );
}

function tierColumns(canPay: boolean): Column<PriorityBill>[] {
  const cols: Column<PriorityBill>[] = [
    {
      header: "Supplier",
      cell: (b) => (
        <div className="min-w-0">
          <p className="font-medium text-slate-900">{b.vendor.name}</p>
          <StoreChip store={b.store} className="mt-0.5" />
        </div>
      ),
    },
    { header: "Bill", cell: (b) => <span className="tabular-nums text-slate-500">{b.billNo}</span> },
    { header: "Bill date", cell: (b) => formatDay(b.billDate), className: "whitespace-nowrap text-slate-500" },
    { header: "Due", cell: (b) => formatDay(b.dueDate), className: "whitespace-nowrap text-slate-500" },
    {
      header: "Age",
      cell: (b) => (
        <div className="whitespace-nowrap tabular-nums">
          <p className="text-slate-700">{ageText(b.daysSinceBill)}</p>
          <p className={`text-xs ${b.daysPastDue > 0 ? "text-red-600" : "text-slate-500"}`}>{dueText(b.daysPastDue)}</p>
        </div>
      ),
    },
    {
      header: "Open",
      cell: (b) => <span className="font-semibold tabular-nums text-slate-900">{formatCurrency(b.openAmount)}</span>,
      className: "text-right whitespace-nowrap",
    },
    {
      header: "CD / credit",
      cell: (b) => (
        <div className="space-y-1">
          <Badges bill={b} />
          <CreditHint bill={b} />
        </div>
      ),
    },
  ];
  if (canPay) cols.push({ header: "", cell: (b) => <PayButton bill={b} compact />, className: "w-20 text-right" });
  return cols;
}

const EXPORT_COLUMNS: ExportColumn[] = [
  { header: "Priority", key: "tier", format: (v) => TIER_LABEL[v as Tier] ?? String(v) },
  { header: "Supplier", key: "vendor.name" },
  { header: "Store", key: "store.name", format: (v) => (v ? String(v) : "Not set") },
  { header: "Bill No", key: "billNo" },
  { header: "Bill Date", key: "billDate", format: (v) => formatDay(String(v)) },
  { header: "Due Date", key: "dueDate", format: (v) => formatDay(String(v)) },
  { header: "Days Old", key: "daysSinceBill" },
  { header: "Days Past Due", key: "daysPastDue", format: (v) => String(Math.max(0, Number(v))) },
  { header: "Open Amount", key: "openAmount" },
  { header: "CD %", key: "cd.percentage", format: (v) => (v == null ? "" : String(v)) },
  { header: "CD Amount", key: "cd.amount", format: (_v, row) => ((row.cd as PriorityBill["cd"])?.claimable ? String((row.cd as NonNullable<PriorityBill["cd"]>).amount) : "") },
  { header: "CD Deadline", key: "cd.deadline", format: (v) => (v ? formatDay(String(v)) : "") },
  { header: "CD Days Left", key: "cd.daysLeft", format: (_v, row) => ((row.cd as PriorityBill["cd"])?.claimable ? String((row.cd as NonNullable<PriorityBill["cd"]>).daysLeft) : "") },
  { header: "Open Credit", key: "openCredit" },
  { header: "Use Credit First", key: "coveredByCredit", format: (v) => (v ? "Yes" : "") },
  { header: "ITC At Risk", key: "itcAtRisk", format: (v) => (v ? "Yes" : "") },
];

interface PaymentPriorityProps {
  stores: StoreOption[];
  storeFilter: StoreFilter;
  onStoreFilterChange: (filter: StoreFilter) => void;
  /** Bumped by the page after an import or a Zoho link, so the list reloads. */
  refreshKey?: number;
}

export function PaymentPriority({ stores, storeFilter, onStoreFilterChange, refreshKey = 0 }: PaymentPriorityProps) {
  const { canCreate } = usePermissions();
  const canPay = canCreate("bills");

  const [age, setAge] = useState<AgeFilter>("all");
  const [retryKey, setRetryKey] = useState(0);

  // `loading` is derived, not set: the list is loading whenever the store (or a refresh, or a
  // retry) names a request whose answer has not landed. Every setState stays in the response
  // callback, and a late answer to an older store is dropped by `cancelled`.
  const storeId = storeQueryValue(storeFilter);
  const requestKey = `${storeId ?? ""}|${refreshKey}|${retryKey}`;
  const [loaded, setLoaded] = useState<{ key: string; data: PriorityResponse | null; error: string | null } | null>(null);
  const loading = loaded?.key !== requestKey;
  const data = loaded?.data ?? null;
  const error = loaded?.error ?? null;

  useEffect(() => {
    let cancelled = false;
    const qs = storeId ? `?storeId=${encodeURIComponent(storeId)}` : "";
    void apiTry<PriorityResponse>(`/api/bills/priority${qs}`).then(({ data: body, error: err, status }) => {
      if (cancelled) return;
      if (err) log.warn("pay-first list failed", { error: err, status, storeId });
      setLoaded({ key: requestKey, data: err ? null : body, error: err });
    });
    return () => {
      cancelled = true;
    };
  }, [storeId, requestKey]);

  // Q6 = (a): the >30 / >45 chips cut on days since the bill date.
  const shown = useMemo(() => {
    const bills = data?.bills ?? [];
    if (age === "over30") return bills.filter((b) => b.daysSinceBill > 30);
    if (age === "over45") return bills.filter((b) => b.daysSinceBill > 45);
    return bills;
  }, [data, age]);

  const columns = useMemo(() => tierColumns(canPay), [canPay]);
  const onHold = data?.onHold ?? [];

  const handleExport = () => {
    const rows = [...shown, ...onHold] as unknown as Record<string, unknown>[];
    void exportToExcel(rows, EXPORT_COLUMNS, `pay-first-${String(data?.asOf ?? "").slice(0, 10)}`).catch((e) => {
      log.error("pay-first export failed", { error: e instanceof Error ? e.message : String(e) });
    });
  };

  const chip = (active: boolean) =>
    `shrink-0 min-h-[44px] rounded-lg border px-3 text-xs font-medium transition-colors ${
      active ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-600 hover:border-slate-400"
    }`;

  return (
    <div>
      {/* Filters: age (Q6) and store */}
      <div className="mb-2 flex gap-2 overflow-x-auto pb-1">
        {AGE_CHIPS.map((c) => {
          const count = c.key === "all" ? data?.totals.all.count : data?.totals[c.key].count;
          return (
            <button key={c.key} onClick={() => setAge(c.key)} className={chip(age === c.key)} aria-pressed={age === c.key}>
              {c.label}
              {count !== undefined && <span className="ml-1 tabular-nums opacity-70">{count}</span>}
            </button>
          );
        })}
      </div>
      <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
        {storeFilterOptions(stores).map((o) => (
          <button
            key={o.key}
            onClick={() => onStoreFilterChange(o.key)}
            className={chip(storeFilter === o.key)}
            aria-pressed={storeFilter === o.key}
          >
            {o.label}
          </button>
        ))}
      </div>

      {loading ? (
        <SkeletonList count={6} type="card" />
      ) : error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <p>{error}</p>
          <button
            onClick={() => setRetryKey((k) => k + 1)}
            className="mt-2 inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-red-300 bg-white px-3 text-xs font-medium text-red-700"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Try again
          </button>
        </div>
      ) : !data || (data.bills.length === 0 && onHold.length === 0) ? (
        <div className="py-12 text-center">
          <CheckCircle2 className="mx-auto mb-2 h-8 w-8 text-green-400" />
          <p className="text-sm font-medium text-slate-600">Nothing owed</p>
          <p className="mt-0.5 text-xs text-slate-400">No open supplier bills{storeFilter !== "ALL" ? " for this store" : ""}.</p>
        </div>
      ) : (
        <>
          {/* Summary: what is owed, what CD can still be earned, what credit is unused (R11) */}
          <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-medium uppercase text-slate-500">Owed on {shown.length} bill{shown.length !== 1 ? "s" : ""}</p>
                <p className="text-xl font-bold tabular-nums text-slate-900">{formatCurrency(sumOpen(shown))}</p>
              </div>
              <button
                onClick={handleExport}
                className="inline-flex min-h-[44px] shrink-0 items-center gap-1 rounded-lg bg-green-50 px-3 text-xs font-medium text-green-700 hover:bg-green-100"
              >
                <FileSpreadsheet className="h-3.5 w-3.5" /> Export
              </button>
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs tabular-nums">
              {data.totals.cdClaimable > 0 && (
                <span className="text-green-700">CD still claimable {formatCurrency(data.totals.cdClaimable)}</span>
              )}
              {data.totals.openCredit > 0 && (
                <span className="text-blue-700">Unused credit from these suppliers {formatCurrency(data.totals.openCredit)}</span>
              )}
              {data.totals.itcAtRisk.count > 0 && (
                <span className="text-red-600" title={ITC_TITLE}>
                  ITC at risk on {data.totals.itcAtRisk.count} bill{data.totals.itcAtRisk.count !== 1 ? "s" : ""}
                </span>
              )}
            </div>
          </div>

          {data.notice && (
            <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800">{data.notice}</p>
          )}

          {shown.length === 0 && (
            <p className="py-8 text-center text-sm text-slate-400">
              No open bills {age === "over45" ? "more than 45" : "more than 30"} days old.
            </p>
          )}

          <div className="space-y-5">
            {TIERS.map((t) => {
              const list = shown.filter((b) => b.tier === t.key);
              if (list.length === 0) return null;
              return (
                <TierSection key={t.key} label={t.label} hint={t.hint} tone={t.tone} bills={list} columns={columns} canPay={canPay} />
              );
            })}
            {onHold.length > 0 && (
              <TierSection
                label={TIER_LABEL.onHold}
                hint="Not in the order — settle the dispute first"
                tone="text-slate-500"
                bills={onHold}
                columns={columns}
                canPay={canPay}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}

function TierSection({
  label,
  hint,
  tone,
  bills,
  columns,
  canPay,
}: {
  label: string;
  hint?: string;
  tone: string;
  bills: PriorityBill[];
  columns: Column<PriorityBill>[];
  canPay: boolean;
}) {
  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between gap-2 border-b border-slate-200 pb-1">
        <div className="min-w-0">
          <h2 className={`text-sm font-semibold ${tone}`}>{label}</h2>
          {hint && <p className="text-[11px] text-slate-400">{hint}</p>}
        </div>
        <p className="shrink-0 text-xs tabular-nums text-slate-500">
          {bills.length} · <span className="font-semibold text-slate-800">{formatCurrency(sumOpen(bills))}</span>
        </p>
      </div>
      <DesktopTable
        className="hidden lg:block"
        rows={bills}
        rowKey={(b) => b.id}
        rowHref={(b) => `/bills/${b.id}`}
        columns={columns}
      />
      <div className="space-y-2 lg:hidden">
        {bills.map((b) => (
          <PriorityCard key={b.id} bill={b} canPay={canPay} />
        ))}
      </div>
    </section>
  );
}
