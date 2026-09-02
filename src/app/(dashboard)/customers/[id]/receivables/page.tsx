"use client";

import { useState, useEffect, useCallback, use } from "react";
import Link from "next/link";
import { ArrowLeft, Phone, MessageCircle, FileText, AlertTriangle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SkeletonList } from "@/components/ui/skeleton";
import { ErrorBanner } from "@/components/ui/error-banner";
import { DesktopTable, type Column } from "@/components/desktop-table";
import { apiTry } from "@/lib/api-client";
import { formatINR } from "@/lib/utils";
import { createLogger } from "@/lib/logger";

const log = createLogger("customers:receivables");

interface Invoice {
  id: string;
  invoiceNo: string;
  amount: number;
  paidAmount: number;
  status: string;
  invoiceDate: string;
  dueDate: string;
}

interface CustomerDetail {
  id: string;
  name: string;
  phone: string;
  whatsapp: string | null;
  type: string;
  isActive: boolean;
  invoices: Invoice[];
  totalOutstanding: number;
  invoicesTruncated: boolean;
  _count: { invoices: number; payments: number };
}

/**
 * Whole days an invoice is past its due date. Both sides are floored to midnight first —
 * comparing raw timestamps makes "due today" read as overdue for the rest of the afternoon.
 */
function daysOverdue(dueDate: string, balance: number) {
  if (balance <= 0) return 0;
  const due = new Date(dueDate);
  due.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.floor((today.getTime() - due.getTime()) / 86_400_000);
  return days > 0 ? days : 0;
}

/**
 * The collection bands from docs/agents/accounting-consultant.md, which set the action:
 * 0–30 a reminder, 30–60 escalate and stop credit, 60+ legal or write-off review. Naming
 * the band is the point — a raw day count leaves the reader doing the arithmetic.
 */
const BANDS = [
  { key: "current", label: "Not yet due", tone: "text-slate-600", chip: "bg-slate-100 text-slate-600" },
  { key: "0-30", label: "1–30 days", tone: "text-amber-600", chip: "bg-amber-100 text-amber-700" },
  { key: "30-60", label: "31–60 days", tone: "text-orange-600", chip: "bg-orange-100 text-orange-700" },
  { key: "60+", label: "60+ days", tone: "text-red-600", chip: "bg-red-100 text-red-700" },
] as const;

type BandKey = (typeof BANDS)[number]["key"];

function bandOf(days: number): BandKey {
  if (days <= 0) return "current";
  if (days <= 30) return "0-30";
  if (days <= 60) return "30-60";
  return "60+";
}

const statusVariant = (s: string) =>
  s === "PAID" ? "success" : s === "OVERDUE" ? "danger" : s === "PARTIALLY_PAID" ? "warning" : "default";

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" });

/**
 * One customer's receivables.
 *
 * ─── WHY THIS EXISTS ─────────────────────────────────────────────────────────────────────
 *
 * /receivables is a flat list of invoices across every customer. It answers "what is
 * outstanding" but not "what does THIS person owe, and how late is it" without searching —
 * and collection is a conversation with a person, not with an invoice. This is the screen
 * you open before making that call, reached from the row on /customers.
 *
 * /receivables keeps the aging buckets across all customers and the Zoho invoice import;
 * this does not duplicate either.
 *
 * ─── ONE REQUEST ─────────────────────────────────────────────────────────────────────────
 *
 * GET /api/customers/[id] returns the customer, a bounded window of invoices oldest-due
 * first, and `totalOutstanding` aggregated server-side over unpaid invoices — the SAME rule
 * the list screen uses, so the figure on the row and the figure here always agree.
 */
export default function CustomerReceivablesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  // Next 16: route params arrive as a promise and are unwrapped with `use()`.
  const { id } = use(params);

  const [customer, setCustomer] = useState<CustomerDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await apiTry<CustomerDetail>(`/api/customers/${id}`);
    if (data) setCustomer(data);
    if (err) {
      setError(err);
      log.error("failed to load customer receivables", { customerId: id, message: err });
    }
    setLoading(false);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const invoices = customer?.invoices ?? [];
  const open = invoices.filter((i) => i.amount - i.paidAmount > 0);

  // Aging over the OPEN invoices only. A paid invoice has no age worth reporting.
  const byBand = new Map<BandKey, { count: number; amount: number }>();
  for (const inv of open) {
    const balance = inv.amount - inv.paidAmount;
    const key = bandOf(daysOverdue(inv.dueDate, balance));
    const cur = byBand.get(key) ?? { count: 0, amount: 0 };
    byBand.set(key, { count: cur.count + 1, amount: cur.amount + balance });
  }

  const worst = [...BANDS].reverse().find((b) => b.key !== "current" && byBand.has(b.key));

  const columns: Column<Invoice>[] = [
    {
      header: "Invoice",
      cell: (i) => <span className="font-medium text-slate-900">{i.invoiceNo}</span>,
    },
    {
      header: "Raised",
      className: "tabular-nums text-slate-500",
      cell: (i) => fmtDate(i.invoiceDate),
    },
    {
      header: "Due",
      className: "tabular-nums",
      cell: (i) => {
        const days = daysOverdue(i.dueDate, i.amount - i.paidAmount);
        const band = BANDS.find((b) => b.key === bandOf(days))!;
        return (
          <div>
            <span className="text-slate-700">{fmtDate(i.dueDate)}</span>
            {days > 0 && (
              <span className={`ml-2 text-[11px] font-medium ${band.tone}`}>
                {days}d late
              </span>
            )}
          </div>
        );
      },
    },
    {
      header: "Amount",
      className: "text-right tabular-nums text-slate-600",
      cell: (i) => formatINR(i.amount),
    },
    {
      header: "Paid",
      className: "text-right tabular-nums text-slate-500",
      cell: (i) => formatINR(i.paidAmount),
    },
    {
      header: "Balance",
      className: "text-right tabular-nums",
      cell: (i) => {
        const balance = i.amount - i.paidAmount;
        return (
          <span className={`font-bold ${balance > 0 ? "text-red-600" : balance < 0 ? "text-green-600" : "text-slate-300"}`}>
            {balance < 0 ? `${formatINR(Math.abs(balance))} cr` : formatINR(balance)}
          </span>
        );
      },
    },
    {
      header: "Status",
      cell: (i) => (
        <Badge variant={statusVariant(i.status)} className="text-[10px]">
          {i.status.replace("_", " ").toLowerCase()}
        </Badge>
      ),
    },
  ];

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Link
          href="/customers"
          aria-label="Back to customers"
          className="p-2 -ml-2 rounded-lg hover:bg-slate-100 focus-ring"
        >
          <ArrowLeft className="h-5 w-5 text-slate-600" />
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-bold text-slate-900 truncate">
            {loading ? "…" : customer?.name ?? "Customer"}
          </h1>
          <p className="text-[11px] text-slate-500">Receivables</p>
        </div>
      </div>

      {error && <ErrorBanner message={error} onRetry={load} onDismiss={() => setError(null)} />}

      {loading ? (
        <SkeletonList />
      ) : !customer ? (
        <div className="text-center py-12">
          <FileText className="h-8 w-8 text-slate-300 mx-auto mb-2" />
          <p className="text-sm text-slate-500">That customer could not be loaded.</p>
        </div>
      ) : (
        <>
          {/* ── Who, and how much ─────────────────────────────────────────────────── */}
          <Card className="mb-3">
            <CardContent className="p-3 flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <div className="flex items-center gap-3 flex-wrap">
                  <a
                    href={`tel:${customer.phone}`}
                    className="flex items-center gap-1 text-sm text-slate-700 tabular-nums hover:text-slate-900 focus-ring rounded"
                  >
                    <Phone className="h-3.5 w-3.5" />{customer.phone}
                  </a>
                  {customer.whatsapp && customer.whatsapp !== customer.phone && (
                    <span className="flex items-center gap-1 text-xs text-slate-400 tabular-nums">
                      <MessageCircle className="h-3.5 w-3.5" />{customer.whatsapp}
                    </span>
                  )}
                  <Badge variant="default" className="text-[10px]">
                    {customer.type.replace("_", "-").toLowerCase()}
                  </Badge>
                </div>
                <p className="text-[11px] text-slate-400 mt-1 tabular-nums">
                  {customer._count.invoices} invoice{customer._count.invoices === 1 ? "" : "s"}
                  {" · "}
                  {customer._count.payments} payment{customer._count.payments === 1 ? "" : "s"}
                </p>
              </div>

              <div className="text-right">
                <p
                  className={`text-xl font-bold tabular-nums ${
                    customer.totalOutstanding > 0
                      ? "text-red-600"
                      : customer.totalOutstanding < 0
                        ? "text-green-600"
                        : "text-slate-300"
                  }`}
                >
                  {customer.totalOutstanding < 0
                    ? `${formatINR(Math.abs(customer.totalOutstanding))} cr`
                    : formatINR(customer.totalOutstanding)}
                </p>
                <p className="text-[10px] text-slate-400">
                  {customer.totalOutstanding < 0 ? "in credit" : "outstanding"}
                </p>
              </div>
            </CardContent>
          </Card>

          {/* A negative balance means they have paid more than they owe. The accounting rule
              is to issue a credit note, so it is stated rather than left as a green number
              someone has to interpret. */}
          {customer.totalOutstanding < 0 && (
            <div className="mb-3 rounded-xl border border-green-200 bg-green-50 px-3 py-2.5 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-green-700 shrink-0 mt-0.5" />
              <p className="text-xs text-green-800">
                This customer has overpaid. Reconcile the payment against an invoice, or issue
                a credit note — an overpayment sitting on the ledger is not a collection.
              </p>
            </div>
          )}

          {/* ── Aging, only when something is actually open ────────────────────────── */}
          {open.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 mb-3">
              {BANDS.map((b) => {
                const cell = byBand.get(b.key);
                return (
                  <Card key={b.key} className={cell ? "" : "opacity-50"}>
                    <CardContent className="p-2.5">
                      <p className="text-[10px] font-medium text-slate-400 uppercase tracking-wide">
                        {b.label}
                      </p>
                      <p className={`text-sm font-bold tabular-nums ${cell ? b.tone : "text-slate-300"}`}>
                        {formatINR(cell?.amount ?? 0)}
                      </p>
                      <p className="text-[10px] text-slate-400 tabular-nums">
                        {cell?.count ?? 0} invoice{(cell?.count ?? 0) === 1 ? "" : "s"}
                      </p>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}

          {/* The action the band implies, said once, for the worst band in play. */}
          {worst && (
            <div className={`mb-3 rounded-xl px-3 py-2.5 text-xs ${worst.chip}`}>
              {worst.key === "0-30" && "Overdue up to 30 days — send a payment reminder on WhatsApp or call."}
              {worst.key === "30-60" && "Overdue past 30 days — escalate to the sales manager and stop further credit."}
              {worst.key === "60+" && "Overdue past 60 days — flag for legal or write-off review. Check the payment was not received and left unrecorded first."}
            </div>
          )}

          {/* ── The invoices ──────────────────────────────────────────────────────── */}
          {invoices.length === 0 ? (
            <div className="text-center py-12">
              <FileText className="h-8 w-8 text-slate-300 mx-auto mb-2" />
              <p className="text-sm text-slate-500">No invoices for this customer yet.</p>
            </div>
          ) : (
            <>
              <DesktopTable
                className="hidden lg:block"
                columns={columns}
                rows={invoices}
                rowKey={(i) => i.id}
              />

              <div className="space-y-1.5 lg:hidden">
                {invoices.map((i) => {
                  const balance = i.amount - i.paidAmount;
                  const days = daysOverdue(i.dueDate, balance);
                  const band = BANDS.find((b) => b.key === bandOf(days))!;
                  return (
                    <Card key={i.id}>
                      <CardContent className="p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <p className="text-sm font-semibold text-slate-900">{i.invoiceNo}</p>
                              <Badge variant={statusVariant(i.status)} className="text-[10px]">
                                {i.status.replace("_", " ").toLowerCase()}
                              </Badge>
                            </div>
                            <p className="text-[11px] text-slate-400 mt-0.5 tabular-nums">
                              Raised {fmtDate(i.invoiceDate)} · due {fmtDate(i.dueDate)}
                            </p>
                            {days > 0 && (
                              <p className={`text-[11px] font-medium mt-0.5 ${band.tone}`}>
                                {days} day{days === 1 ? "" : "s"} late · {band.label}
                              </p>
                            )}
                          </div>
                          <div className="text-right shrink-0">
                            <p
                              className={`text-sm font-bold tabular-nums ${
                                balance > 0 ? "text-red-600" : balance < 0 ? "text-green-600" : "text-slate-300"
                              }`}
                            >
                              {balance < 0 ? `${formatINR(Math.abs(balance))} cr` : formatINR(balance)}
                            </p>
                            <p className="text-[10px] text-slate-400 tabular-nums">
                              of {formatINR(i.amount)}
                            </p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </>
          )}

          {/* The API caps the window. Say so rather than let a dealer's list end silently. */}
          {customer.invoicesTruncated && (
            <p className="text-[11px] text-slate-500 mt-3">
              Showing the {invoices.length} oldest-due of {customer._count.invoices} invoices.
              The outstanding total above covers all of them.{" "}
              <Link href="/receivables" className="underline hover:text-slate-800">
                Open the full receivables list
              </Link>
              .
            </p>
          )}
        </>
      )}
    </div>
  );
}
