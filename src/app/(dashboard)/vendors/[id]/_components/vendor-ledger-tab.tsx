"use client";

// The supplier ledger, as a screen — plan 1210 credit notes and payables, Part 6.3.
// Used by the vendor page's Ledger tab and by /accounts/vendor-ledger (with `exportable`), so
// the two screens cannot drift apart.
//
// Every number comes from GET /api/vendors/[id]/ledger (src/lib/payables/ledger.ts). The
// running balance is computed by the server over the supplier's WHOLE history; this screen
// only appends older pages under the newer ones, so "Load more" never makes the balance jump.
//
// D9 on screen: a credit note is one tinted line on its own date. Where it was applied ("applied
// to 4567") is printed under it and never becomes a line of its own.

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, IndianRupee, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { SkeletonList } from "@/components/ui/skeleton";
import { ExportButtons } from "@/components/export-buttons";
import { apiTry } from "@/lib/api-client";
import { exportToExcel, exportToPDF, type ExportColumn } from "@/lib/export";
import { createLogger } from "@/lib/logger";
import type { LedgerEntry, VendorLedger } from "@/lib/payables/ledger";

const log = createLogger("vendors:ledger");

const PAGE_SIZE = 50;

/** "all" = every store; "none" = rows with no store; otherwise a Store id. */
type StoreFilter = string;
type StoreOption = { id: string; code: string; name: string };

const KIND_LABEL: Record<LedgerEntry["kind"], string> = {
  BILL: "Bill",
  CREDIT: "Credit note",
  REFUND: "Credit refund",
  PAYMENT: "Payment",
};

const ROW_TINT: Record<LedgerEntry["kind"], string> = {
  BILL: "",
  CREDIT: "bg-purple-50/70",
  REFUND: "bg-amber-50/70",
  PAYMENT: "bg-green-50/40",
};

// Three amount columns that fit ₹1 crore at 375 px: plain Indian-grouped numbers (the header
// says what they are), 11 px on a phone.
const GRID = "grid grid-cols-[minmax(0,1fr)_4.25rem_4.25rem_4.75rem] sm:grid-cols-[minmax(0,1fr)_7rem_7rem_7.5rem] gap-x-1.5";

function inr(n: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
}

function num(n: number) {
  return n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

function shortDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit", timeZone: "Asia/Kolkata" });
}

function ledgerUrl(vendorId: string, filter: StoreFilter, extra: Record<string, string>) {
  const qs = new URLSearchParams(extra);
  if (filter !== "all") qs.set("storeId", filter);
  return `/api/vendors/${vendorId}/ledger?${qs.toString()}`;
}

export function VendorLedgerTab({ vendorId, exportable = false }: { vendorId: string; exportable?: boolean }) {
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [filter, setFilter] = useState<StoreFilter>("all");
  const [meta, setMeta] = useState<VendorLedger | null>(null);
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportNote, setExportNote] = useState<string | null>(null);
  // A response for a store chip the person has already left is dropped, not rendered.
  const requestSeq = useRef(0);

  // Store chips come from the Store table — never a fixed list of codes.
  useEffect(() => {
    apiTry<StoreOption[]>("/api/stores").then(({ data, error: err }) => {
      if (err || !data) {
        log.warn("stores failed to load for ledger chips", { vendorId, error: err });
        return;
      }
      setStores(data.map((s) => ({ id: s.id, code: s.code, name: s.name })));
    });
  }, [vendorId]);

  const loadFirst = useCallback(() => {
    const seq = ++requestSeq.current;
    return apiTry<VendorLedger>(ledgerUrl(vendorId, filter, { page: "1", pageSize: String(PAGE_SIZE) })).then(
      ({ data, error: err }) => {
        if (seq !== requestSeq.current) return;
        if (err || !data) {
          log.warn("ledger failed to load", { vendorId, storeId: filter, error: err });
          setError(err || "Could not load the ledger");
          setMeta(null);
          setEntries([]);
        } else {
          setMeta(data);
          setEntries(data.entries);
          setError(null);
        }
        setLoading(false);
      },
    );
  }, [vendorId, filter]);

  useEffect(() => {
    void loadFirst();
  }, [loadFirst]);

  function pickStore(next: StoreFilter) {
    if (next === filter) return;
    setLoading(true);
    setMoreError(null);
    setExportNote(null);
    setFilter(next);
  }

  function retry() {
    setLoading(true);
    setError(null);
    void loadFirst();
  }

  async function loadMore() {
    if (!meta || loadingMore) return;
    const seq = requestSeq.current;
    setLoadingMore(true);
    setMoreError(null);
    const { data, error: err } = await apiTry<VendorLedger>(
      ledgerUrl(vendorId, filter, { page: String(meta.page + 1), pageSize: String(meta.pageSize) }),
    );
    if (seq !== requestSeq.current) return;
    if (err || !data) {
      log.warn("ledger page failed to load", { vendorId, storeId: filter, page: meta.page + 1, error: err });
      setMoreError(err || "Could not load more lines");
    } else {
      setMeta(data);
      // A line recorded between two pages shifts the offsets by one; never show it twice.
      setEntries((prev) => {
        const seen = new Set(prev.map((e) => e.id));
        return [...prev, ...data.entries.filter((e) => !seen.has(e.id))];
      });
    }
    setLoadingMore(false);
  }

  async function runExport(kind: "excel" | "pdf") {
    if (exporting) return;
    setExporting(true);
    setExportNote(null);
    const { data, error: err } = await apiTry<VendorLedger>(ledgerUrl(vendorId, filter, { all: "1" }), { timeoutMs: 60_000 });
    if (err || !data) {
      log.warn("ledger export failed to load", { vendorId, storeId: filter, error: err });
      setExportNote(err || "Could not load the ledger for export");
      setExporting(false);
      return;
    }
    try {
      const rows = exportRows(data, stores);
      const storeName = data.store ? ` (${data.store.name})` : "";
      const file = `ledger-${data.vendor.code}${data.store ? `-${data.store.code ?? "not-set"}` : ""}`;
      if (kind === "excel") await exportToExcel(rows, EXPORT_COLUMNS, file);
      else await exportToPDF(`Supplier ledger: ${data.vendor.name}${storeName}`, rows, EXPORT_COLUMNS, file);
      if (data.truncated) {
        setExportNote(`Only the newest ${data.entries.length.toLocaleString("en-IN")} of ${data.totalEntries.toLocaleString("en-IN")} lines were exported.`);
      }
    } catch (e) {
      log.warn("ledger export failed", { vendorId, kind, error: e instanceof Error ? e.message : String(e) });
      setExportNote("The export file could not be created. Try again.");
    }
    setExporting(false);
  }

  const storeName = (id: string | null) => (id ? stores.find((s) => s.id === id)?.name ?? "Store" : "Not set");
  const hasMore = meta ? entries.length < meta.totalEntries : false;
  const chips: Array<{ key: StoreFilter; label: string }> = [
    { key: "all", label: "All stores" },
    ...stores.map((s) => ({ key: s.id, label: s.name })),
    { key: "none", label: "Store not set" },
  ];

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <div className="flex gap-1.5 overflow-x-auto flex-1 -mx-1 px-1 pb-1" role="tablist" aria-label="Store">
          {chips.map((c) => (
            <button
              key={c.key}
              role="tab"
              aria-selected={filter === c.key}
              onClick={() => pickStore(c.key)}
              className={`shrink-0 min-h-[44px] px-3 rounded-full text-xs font-medium border transition-colors ${
                filter === c.key ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-200 hover:border-slate-300"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
        {exportable && meta && (
          <div className="shrink-0 flex items-center gap-1.5">
            {exporting && <Loader2 className="h-4 w-4 animate-spin text-slate-400" aria-label="Preparing export" />}
            <ExportButtons onExcel={() => void runExport("excel")} onPDF={() => void runExport("pdf")} />
          </div>
        )}
      </div>
      {exportNote && <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2 mb-3">{exportNote}</p>}

      {loading ? (
        <SkeletonList count={5} type="transaction" />
      ) : error || !meta ? (
        <div className="text-center py-8">
          <p className="text-sm text-red-600 mb-2">{error || "Could not load the ledger"}</p>
          <button onClick={retry} className="min-h-[44px] px-4 rounded-lg border border-slate-300 text-sm font-medium text-slate-700 hover:bg-slate-50">
            Retry
          </button>
        </div>
      ) : (
        <>
          <LedgerSummary meta={meta} />

          {meta.overSettledBills.length > 0 && (
            <Card className="bg-red-50 border-red-200 mb-3">
              <CardContent className="p-3">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-red-700 mb-1">
                  <AlertTriangle className="h-3.5 w-3.5" /> Settled for more than the bill amount — a CD or credit counted twice?
                </p>
                {meta.overSettledBills.map((b) => (
                  <Link key={b.id} href={`/bills/${b.id}`} className="block text-xs text-red-700 underline py-1">
                    Bill {b.billNo}: {inr(b.paidAmount)} settled on {inr(b.amount)} — {inr(b.over)} over
                  </Link>
                ))}
              </CardContent>
            </Card>
          )}

          <div className="border rounded-lg overflow-hidden">
            <div className={`${GRID} bg-slate-100 px-2 py-1.5 text-[11px] font-semibold text-slate-600`}>
              <div>Date · Particulars</div>
              <div className="text-right">Debit ₹</div>
              <div className="text-right">Credit ₹</div>
              <div className="text-right">Balance ₹</div>
            </div>

            {entries.map((e) => (
              <LedgerRow key={e.id} entry={e} storeLabel={filter === "all" ? storeName(e.storeId) : null} />
            ))}

            {!hasMore && meta.store === null && (
              <div className={`${GRID} px-2 py-2 border-t border-slate-200 bg-slate-50 text-xs`}>
                <div className="min-w-0">
                  <p className="font-medium text-slate-700">Opening balance</p>
                  <p className="text-[11px] text-slate-500">1 Apr 2026</p>
                </div>
                <div />
                <div />
                <div className="text-right font-semibold tabular-nums whitespace-nowrap text-[11px] sm:text-xs text-slate-700">{num(meta.opening)}</div>
              </div>
            )}

            {entries.length === 0 && (
              <div className="text-center py-8 border-t border-slate-100">
                <IndianRupee className="h-6 w-6 text-slate-300 mx-auto mb-1" />
                <p className="text-xs text-slate-400">
                  {meta.store ? `No bills, payments or credit notes for ${meta.store.name}` : "No bills, payments or credit notes yet"}
                </p>
              </div>
            )}
          </div>

          <div className="mt-3 text-center">
            <p className="text-[11px] text-slate-400 mb-2">
              {entries.length.toLocaleString("en-IN")} of {meta.totalEntries.toLocaleString("en-IN")} lines, newest first
            </p>
            {moreError && <p className="text-xs text-red-600 mb-2">{moreError}</p>}
            {hasMore && (
              <button
                onClick={() => void loadMore()}
                disabled={loadingMore}
                className="min-h-[44px] w-full sm:w-auto px-6 rounded-lg border border-slate-300 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 inline-flex items-center justify-center gap-2"
              >
                {loadingMore && <Loader2 className="h-4 w-4 animate-spin" />}
                {moreError ? "Try again" : "Load older lines"}
              </button>
            )}
          </div>
          <p className="text-[11px] text-slate-400 mt-3">
            A credit note lowers the balance once, on its own date. Applying it to a bill only links the two — it is never subtracted again.
          </p>
        </>
      )}
    </div>
  );
}

function LedgerSummary({ meta }: { meta: VendorLedger }) {
  const owe = meta.closing;
  return (
    <div className="mb-3 space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <Card className="bg-slate-50">
          <CardContent className="p-3">
            <p className="text-[11px] text-slate-500">{meta.store ? `Opening (${meta.store.name})` : "Opening (1 Apr 2026)"}</p>
            <p className="text-sm font-bold text-slate-700 tabular-nums">{inr(meta.opening)}</p>
          </CardContent>
        </Card>
        <Card className={owe > 0.5 ? "bg-red-50 border-red-200" : owe < -0.5 ? "bg-green-50 border-green-200" : ""}>
          <CardContent className="p-3">
            <p className="text-[11px] text-slate-500">{owe < -0.5 ? "Supplier owes us" : "Balance we owe"}</p>
            <p className={`text-sm font-bold tabular-nums ${owe > 0.5 ? "text-red-700" : owe < -0.5 ? "text-green-700" : "text-slate-700"}`}>
              {inr(Math.abs(owe))}
            </p>
          </CardContent>
        </Card>
      </div>
      {meta.openingNote && <p className="text-[11px] text-slate-500">{meta.openingNote}</p>}
      <div className="grid grid-cols-3 sm:grid-cols-5 gap-x-2 gap-y-1 text-[11px] text-slate-500">
        <p>Bills <span className="block text-xs font-semibold text-slate-800 tabular-nums">{inr(meta.totals.bills)}</span></p>
        <p>Paid <span className="block text-xs font-semibold text-slate-800 tabular-nums">{inr(meta.totals.payments)}</span></p>
        <p>CD <span className="block text-xs font-semibold text-slate-800 tabular-nums">{inr(meta.totals.cd)}</span></p>
        <p>Credit notes <span className="block text-xs font-semibold text-purple-700 tabular-nums">{inr(meta.totals.credits)}</span></p>
        <p>Refunds <span className="block text-xs font-semibold text-amber-700 tabular-nums">{inr(meta.totals.refunds)}</span></p>
      </div>
    </div>
  );
}

function LedgerRow({ entry: e, storeLabel }: { entry: LedgerEntry; storeLabel: string | null }) {
  const href = e.kind === "BILL" ? `/bills/${e.id}` : e.kind === "PAYMENT" && e.billId ? `/bills/${e.billId}` : null;
  const title = href ? (
    <Link href={href} className="text-slate-900 hover:underline">{e.description}</Link>
  ) : (
    <span className="text-slate-900">{e.description}</span>
  );
  const sub = [shortDate(e.date), KIND_LABEL[e.kind], e.kind === "PAYMENT" && e.reference !== e.mode ? e.reference : null, storeLabel].filter(Boolean).join(" · ");

  return (
    <div className={`${GRID} px-2 py-2 border-t border-slate-100 text-xs ${ROW_TINT[e.kind]}`}>
      <div className="min-w-0">
        <p className="break-words">
          {e.kind === "REFUND" && (
            <span className="inline-block mr-1 px-1.5 rounded bg-amber-100 text-amber-800 text-[10px] font-semibold align-middle">REFUND</span>
          )}
          {e.kind === "CREDIT" && (
            <span className="inline-block mr-1 px-1.5 rounded bg-purple-100 text-purple-800 text-[10px] font-semibold align-middle">CREDIT NOTE</span>
          )}
          {title}
        </p>
        <p className="text-[11px] text-slate-500 tabular-nums">{sub}</p>
        {e.kind === "CREDIT" && <CreditApplications entry={e} />}
      </div>
      <div className="text-right tabular-nums whitespace-nowrap text-[11px] sm:text-xs text-red-600">{e.debit > 0 ? num(e.debit) : ""}</div>
      <div className="text-right tabular-nums whitespace-nowrap text-[11px] sm:text-xs text-green-700">{e.credit > 0 ? num(e.credit) : ""}</div>
      <div className="text-right tabular-nums whitespace-nowrap text-[11px] sm:text-xs font-medium text-slate-800">{num(e.balance)}</div>
    </div>
  );
}

function CreditApplications({ entry: e }: { entry: LedgerEntry }) {
  const open = e.open ?? 0;
  return (
    <div className="mt-0.5 space-y-0.5 text-[11px]">
      {e.appliedTo.length === 0 ? (
        <p className="text-purple-700">Not applied to a bill yet</p>
      ) : (
        e.appliedTo.map((a) => (
          <p key={a.applicationId} className="text-purple-700">
            Applied to{" "}
            {a.billId ? (
              <Link href={`/bills/${a.billId}`} className="underline">bill {a.billNo ?? "—"}</Link>
            ) : (
              <span>a bill not in the app yet</span>
            )}{" "}
            · {inr(a.amount)} · {shortDate(a.date)} · {a.source === "APP" ? "here" : "in Zoho"}
          </p>
        ))
      )}
      {open > 0.01 && <p className="text-slate-500">{inr(open)} still open</p>}
      {open < -0.01 && <p className="text-red-600 font-medium">Applied {inr(-open)} more than its total</p>}
    </div>
  );
}

const EXPORT_COLUMNS: ExportColumn[] = [
  { header: "Date", key: "date" },
  { header: "Type", key: "type" },
  { header: "Reference", key: "reference" },
  { header: "Particulars", key: "particulars" },
  { header: "Store", key: "store" },
  { header: "Debit", key: "debit" },
  { header: "Credit", key: "credit" },
  { header: "Balance", key: "balance" },
  { header: "Applied to", key: "appliedTo" },
];

/** Oldest first, as a printed ledger reads; the opening line only on the all-stores view. */
function exportRows(data: VendorLedger, stores: StoreOption[]): Record<string, unknown>[] {
  const storeName = (id: string | null) => (id ? stores.find((s) => s.id === id)?.name ?? "" : "Not set");
  const rows: Record<string, unknown>[] = [];
  if (data.store === null && !data.truncated) {
    rows.push({ date: "01/04/2026", type: "Opening", reference: "FY 2026-27", particulars: "Opening balance", store: "", debit: "", credit: "", balance: data.opening, appliedTo: "" });
  }
  for (const e of [...data.entries].reverse()) {
    rows.push({
      date: new Date(e.date).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" }),
      type: KIND_LABEL[e.kind],
      reference: e.reference,
      particulars: e.description,
      store: storeName(e.storeId),
      debit: e.debit > 0 ? e.debit : "",
      credit: e.credit > 0 ? e.credit : "",
      balance: e.balance,
      appliedTo: e.appliedTo
        .map((a) => `${a.billNo ?? "bill not in app"} ${a.amount} (${a.source === "APP" ? "here" : "Zoho"})`)
        .join("; "),
    });
  }
  return rows;
}
