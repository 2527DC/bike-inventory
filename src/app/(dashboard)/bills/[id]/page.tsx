"use client";

// One vendor bill. Plan 1210 credit notes:
//   - the due date is the bill's stored dueDate (Q5 = a) — what the supplier's invoice says — not
//     bill date + the vendor's CURRENT terms, which re-aged old bills whenever terms changed (X5)
//   - the header balance comes from vendorBalance(), the one formula (Part 6.1)
//   - "Credit notes applied": each application marked here / in Zoho, Remove on the ones made
//     here (bills.edit); Apply credit when the vendor has open credit and money is left
//     (bills.create) — Part 4, D18, D19
//   - the store, with a picker for bills.edit (Part 2.4)
// Every call goes through apiTry (X12). Loads on mount, after an action, and on Retry only.
import { useState, useEffect, useCallback, use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, CreditCard, Phone, MessageSquare, Receipt, Trash2, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SkeletonList } from "@/components/ui/skeleton";
import { ErrorBanner } from "@/components/ui/error-banner";
import { ApplyCreditSheet, removeCreditApplication } from "@/components/apply-credit-sheet";
import { usePermissions } from "@/lib/use-permissions";
import { apiTry } from "@/lib/api-client";
import { getTodayIST } from "@/lib/services/timezone";
import { createLogger } from "@/lib/logger";

const log = createLogger("bills:detail");

interface CreditApplication {
  id: string;
  source: "ZOHO" | "APP";
  amount: number;
  appliedDate: string;
  note: string | null;
  appliedBy: string | null;
  credit: { id: string; creditNoteNo: string; referenceNo: string | null } | null;
}

interface BillDetail {
  id: string;
  billNo: string;
  vendorId: string;
  amount: number;
  paidAmount: number;
  creditAppliedAmount: number;
  status: string;
  billDate: string;
  dueDate: string;
  lastFollowedUp?: string;
  nextFollowUpDate?: string;
  followUpNotes?: string;
  notes?: string;
  storeId: string | null;
  store: { id: string; code: string; name: string } | null;
  vendor: { id: string; name: string; code: string; phone?: string | null; whatsappNumber?: string | null };
  vendorBalance: number | null;
  payments: Array<{
    id: string;
    amount: number;
    cdDiscountAmount?: number;
    paymentMode: string;
    paymentDate: string;
    referenceNo?: string | null;
    recordedBy?: { name: string } | null;
  }>;
  creditApplications: CreditApplication[];
  openCredits: Array<{ id: string; open: number }>;
  openCreditTotal: number;
}

interface CdEligibility {
  eligible: boolean;
  reason?: string;
  cdPercentage?: number;
  daysRemaining?: number;
  discountAmount?: number;
}

interface StoreOption {
  id: string;
  name: string;
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount);
}
const inr2 = (n: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(n);
const dateIN = (d: string) => new Date(d).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" });

export default function BillDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { canEdit, canCreate } = usePermissions();
  const mayEdit = canEdit("bills");
  const mayApply = canCreate("bills");

  const [bill, setBill] = useState<BillDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [cdInfo, setCdInfo] = useState<CdEligibility | null>(null);
  const [stores, setStores] = useState<StoreOption[] | null>(null);
  const [applyOpen, setApplyOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(
    () =>
      apiTry<BillDetail>(`/api/bills/${id}`).then(({ data, error, status, isAuth }) => {
        if (error || !data) {
          log.warn("bill failed to load", { billId: id, status, message: error });
          if (isAuth) {
            router.push("/login");
            return;
          }
          if (status === 404) setNotFound(true);
          else setLoadError(error ?? "Could not load this bill.");
        } else {
          setBill(data);
          setLoadError(null);
        }
        setLoading(false);
      }),
    [id, router]
  );

  useEffect(() => {
    void load();
    // CD status is a hint beside the bill; its failure is logged, not shown.
    void apiTry<CdEligibility>(`/api/bills/${id}/cd-eligibility`).then(({ data, error }) => {
      if (data) setCdInfo(data);
      else log.warn("cd eligibility failed to load", { billId: id, message: error });
    });
  }, [id, load]);

  // The store list, only for someone who can set the store.
  useEffect(() => {
    if (!mayEdit || stores !== null) return;
    void apiTry<StoreOption[]>("/api/stores").then(({ data, error }) => {
      if (error || !data) {
        log.warn("stores failed to load", { message: error });
        setStores([]);
        return;
      }
      setStores(data.map((s) => ({ id: s.id, name: s.name })));
    });
  }, [mayEdit, stores]);

  function retry() {
    setLoading(true);
    setLoadError(null);
    void load();
  }

  async function saveStore(storeId: string) {
    if (!storeId || !bill || storeId === bill.storeId) return;
    setBusy("store");
    setActionError(null);
    const { error, status } = await apiTry(`/api/bills/${bill.id}`, { method: "PUT", json: { storeId } });
    setBusy(null);
    if (error) {
      log.warn("bill store not saved", { billId: bill.id, status, message: error });
      setActionError(error);
      return;
    }
    log.info("bill store set", { billId: bill.id, storeId });
    void load();
  }

  async function removeApplication(a: CreditApplication) {
    if (!bill) return;
    if (!confirm(`Remove ${inr2(a.amount)} of ${a.credit?.creditNoteNo ?? "this credit"} from bill ${bill.billNo}? The bill and the credit go back by exactly that amount.`)) return;
    setBusy(a.id);
    setActionError(null);
    const res = await removeCreditApplication(a.id);
    setBusy(null);
    if (!res.ok) setActionError(res.error);
    void load();
  }

  if (loading) {
    return (
      <div className="pt-2">
        <SkeletonList count={5} type="card" />
      </div>
    );
  }

  if (notFound || (!bill && !loadError)) {
    return (
      <div className="text-center py-12">
        <p className="text-sm text-slate-400">Bill not found</p>
        <Link href="/bills" className="text-sm text-blue-600 hover:underline mt-2 inline-block">
          Back to Bills
        </Link>
      </div>
    );
  }

  if (!bill) {
    return (
      <div className="pt-2">
        <ErrorBanner message={loadError ?? "Could not load this bill."} onRetry={retry} />
        <Link href="/bills" className="text-sm text-blue-600 hover:underline">Back to Bills</Link>
      </div>
    );
  }

  const remaining = Math.max(0, bill.amount - bill.paidAmount);
  // The stored due date (Q5 = a). Compared as IST calendar days: due today is not overdue.
  const dueDay = new Date(new Date(bill.dueDate).getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
  const isOverdue = dueDay < getTodayIST() && remaining > 0.01 && bill.status !== "DISPUTED";
  const paidPercent = bill.amount > 0 ? Math.min(100, (bill.paidAmount / bill.amount) * 100) : 0;
  const here = bill.creditApplications.filter((a) => a.source === "APP");
  const inZoho = bill.creditApplications.filter((a) => a.source === "ZOHO");
  const canApplyCredit = mayApply && remaining > 0.01 && bill.status !== "DISPUTED" && bill.openCreditTotal > 0.01;

  const whatsappLink = bill.vendor.whatsappNumber
    ? `https://wa.me/91${bill.vendor.whatsappNumber.replace(/\D/g, "").slice(-10)}?text=${encodeURIComponent(
        `Reminder: Bill ${bill.billNo} for ${formatCurrency(remaining)} is ${isOverdue ? "overdue" : "pending"}. Due: ${dateIN(bill.dueDate)}. Please arrange payment. Thank you.`
      )}`
    : null;

  const statusLabel = bill.status === "DISPUTED" ? "DISPUTED" : isOverdue ? "OVERDUE" : bill.status.replace(/_/g, " ");
  const statusVariant = bill.status === "PAID" ? "success" : bill.status === "DISPUTED" || isOverdue ? "danger" : "warning";

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <Link href="/bills" className="p-2 -ml-2 rounded-lg hover:bg-slate-100 focus-ring" aria-label="Back">
          <ArrowLeft className="h-5 w-5 text-slate-600" />
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-bold text-slate-900 tabular-nums truncate">{bill.billNo}</h1>
          <Link href={`/vendors/${bill.vendorId}`} className="text-xs text-slate-500 truncate block hover:underline">
            {bill.vendor.name}
          </Link>
          {bill.vendorBalance !== null && (
            <p className={`text-xs font-medium tabular-nums ${bill.vendorBalance > 0 ? "text-red-600" : "text-green-600"}`}>
              Owed to vendor: {formatCurrency(bill.vendorBalance)}
            </p>
          )}
        </div>
        <Badge variant={statusVariant}>{statusLabel}</Badge>
      </div>

      {actionError && <ErrorBanner message={actionError} onDismiss={() => setActionError(null)} />}

      {/* CD Status */}
      {cdInfo && cdInfo.eligible && (
        <div className="mb-3 rounded-lg border border-green-200 bg-green-50 px-3 py-2 flex items-center justify-between">
          <span className="text-xs font-medium text-green-800 tabular-nums">
            CD: {cdInfo.cdPercentage}% ({cdInfo.daysRemaining}d left)
          </span>
          <span className="text-xs text-green-600 tabular-nums">
            Save {formatCurrency(cdInfo.discountAmount || 0)}
          </span>
        </div>
      )}
      {cdInfo && !cdInfo.eligible && !cdInfo.reason && (
        <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
          <span className="text-xs text-slate-500">CD Expired</span>
        </div>
      )}

      {/* Amount Card */}
      <Card className={`mb-4 ${isOverdue ? "border-red-200 bg-red-50/50" : ""}`}>
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-slate-500">Total Amount</span>
            <span className="text-lg font-bold text-slate-900 tabular-nums">{formatCurrency(bill.amount)}</span>
          </div>
          <div className="w-full bg-slate-200 rounded-full h-2 mb-2">
            <div className="bg-green-500 h-2 rounded-full transition-all" style={{ width: `${paidPercent}%` }} />
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-green-600 tabular-nums">
              Settled: {formatCurrency(bill.paidAmount)}
              {bill.creditAppliedAmount > 0.01 && (
                <span className="text-slate-500"> (incl. {formatCurrency(bill.creditAppliedAmount)} credit)</span>
              )}
            </span>
            <span className={`tabular-nums ${remaining > 0.01 ? "text-red-600 font-medium" : "text-green-600"}`}>
              {remaining > 0.01 ? `Due: ${formatCurrency(remaining)}` : "Fully Paid"}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Actions */}
      {(remaining > 0.01 || canApplyCredit) && (
        <div className="mb-4 space-y-2">
          {remaining > 0.01 && (
            <div className="flex gap-2">
              <Link href={`/payments/new?vendorId=${bill.vendorId}&billId=${bill.id}`} className="flex-1">
                <Button className="w-full min-h-[48px] rounded-lg font-medium bg-green-600 hover:bg-green-700 text-white">
                  <CreditCard className="h-4 w-4 mr-1.5" /> Record Payment
                </Button>
              </Link>
              {whatsappLink && (
                <a href={whatsappLink} target="_blank" rel="noopener noreferrer" aria-label="Send WhatsApp reminder">
                  <Button variant="outline" className="min-h-[48px] min-w-[48px] rounded-lg text-green-600 border-green-300">
                    <MessageSquare className="h-4 w-4" />
                  </Button>
                </a>
              )}
              {bill.vendor.phone && (
                <a href={`tel:${bill.vendor.phone}`} aria-label="Call vendor">
                  <Button variant="outline" className="min-h-[48px] min-w-[48px] rounded-lg">
                    <Phone className="h-4 w-4" />
                  </Button>
                </a>
              )}
            </div>
          )}
          {canApplyCredit && (
            <Button
              variant="outline"
              onClick={() => setApplyOpen(true)}
              className="w-full min-h-[48px] rounded-lg text-blue-700 border-blue-200"
            >
              <Receipt className="h-4 w-4 mr-1.5 shrink-0" />
              <span className="truncate">Apply credit · {formatCurrency(bill.openCreditTotal)} open with this vendor</span>
            </Button>
          )}
        </div>
      )}

      {/* Bill Info */}
      <Card className="mb-4">
        <CardContent className="p-3 grid grid-cols-2 gap-3 text-sm">
          <div>
            <span className="text-slate-500">Bill Date</span>
            <p className="font-semibold tabular-nums">{dateIN(bill.billDate)}</p>
          </div>
          <div>
            <span className="text-slate-500">Due Date</span>
            <p className={`font-semibold tabular-nums ${isOverdue ? "text-red-600" : ""}`}>{dateIN(bill.dueDate)}</p>
            <p className="text-[11px] text-slate-400">as on the bill</p>
          </div>
          <div className="col-span-2">
            <span className="text-slate-500">Store</span>
            <StoreField bill={bill} stores={stores} mayEdit={mayEdit} busy={busy === "store"} onSave={(s) => void saveStore(s)} />
          </div>
        </CardContent>
      </Card>

      {/* Credit notes applied (Part 4) */}
      {bill.creditApplications.length > 0 && (
        <>
          <h2 className="text-sm font-semibold text-slate-900 mb-2">
            Credit notes applied <span className="text-slate-500 font-normal tabular-nums">({inr2(bill.creditAppliedAmount)})</span>
          </h2>
          <Card className="mb-4">
            <CardContent className="p-3 space-y-2">
              {here.length > 0 && (
                <AppliedList
                  title="Applied here"
                  rows={here}
                  vendorId={bill.vendorId}
                  mayRemove={mayEdit}
                  busy={busy}
                  onRemove={(a) => void removeApplication(a)}
                />
              )}
              {inZoho.length > 0 && (
                <AppliedList title="Applied in Zoho" rows={inZoho} vendorId={bill.vendorId} mayRemove={false} busy={busy} onRemove={() => {}} />
              )}
              {here.length > 0 && (
                <p className="text-[11px] text-slate-500">
                  Credits applied here are not in Zoho Books — apply them there too so both books agree.
                </p>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* Payment History */}
      <h2 className="text-sm font-semibold text-slate-900 mb-2">Payments ({bill.payments.length})</h2>
      <div className="space-y-2">
        {bill.payments.map((p) => (
          <Card key={p.id} className="mb-2">
            <CardContent className="p-3 flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-green-700 tabular-nums">
                  {formatCurrency(p.amount)}
                  {p.cdDiscountAmount !== undefined && p.cdDiscountAmount > 0 && (
                    <span className="text-xs text-green-500 ml-1 tabular-nums">
                      + {formatCurrency(p.cdDiscountAmount)} CD
                    </span>
                  )}
                </p>
                <p className="text-xs text-slate-500 tabular-nums">
                  {p.paymentMode} | {dateIN(p.paymentDate)}
                  {p.referenceNo ? ` | Ref: ${p.referenceNo}` : ""}
                  {p.recordedBy?.name ? ` | by ${p.recordedBy.name}` : ""}
                </p>
              </div>
            </CardContent>
          </Card>
        ))}
        {bill.payments.length === 0 && (
          <p className="text-sm text-slate-400 text-center py-4">No payments recorded</p>
        )}
      </div>

      <ApplyCreditSheet
        open={applyOpen}
        onClose={() => setApplyOpen(false)}
        vendorId={bill.vendorId}
        bill={{ id: bill.id, billNo: bill.billNo, remaining, storeId: bill.storeId, storeName: bill.store?.name ?? null }}
        onApplied={() => void load()}
        onStale={() => void load()}
      />
    </div>
  );
}

function StoreField({
  bill,
  stores,
  mayEdit,
  busy,
  onSave,
}: {
  bill: BillDetail;
  stores: StoreOption[] | null;
  mayEdit: boolean;
  busy: boolean;
  onSave: (storeId: string) => void;
}) {
  if (!mayEdit || stores === null || stores.length === 0) {
    return bill.store ? (
      <p className="font-semibold">{bill.store.name}</p>
    ) : (
      <p className="text-amber-700 text-sm">Store not set</p>
    );
  }
  // One store and none set: nothing to choose, so one tap sets it.
  if (!bill.store && stores.length === 1) {
    return (
      <button
        type="button"
        disabled={busy}
        onClick={() => onSave(stores[0].id)}
        className="mt-1 min-h-[44px] w-full rounded-lg border border-amber-200 bg-amber-50 px-3 text-xs font-medium text-amber-800 disabled:opacity-60"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin inline" /> : `Store not set — set to ${stores[0].name}`}
      </button>
    );
  }
  return (
    <select
      aria-label="Store"
      value={bill.storeId ?? ""}
      disabled={busy}
      onChange={(e) => onSave(e.target.value)}
      className="mt-1 w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-2 text-sm disabled:opacity-60"
    >
      {!bill.storeId && (
        <option value="" disabled>
          Store not set — pick one…
        </option>
      )}
      {stores.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name}
        </option>
      ))}
    </select>
  );
}

function AppliedList({
  title,
  rows,
  vendorId,
  mayRemove,
  busy,
  onRemove,
}: {
  title: string;
  rows: CreditApplication[];
  vendorId: string;
  mayRemove: boolean;
  busy: string | null;
  onRemove: (a: CreditApplication) => void;
}) {
  return (
    <div>
      <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wide">{title}</p>
      <ul className="divide-y divide-slate-100">
        {rows.map((a) => (
          <li key={a.id} className="flex items-center gap-2 py-1">
            <div className="flex-1 min-w-0">
              <p className="text-xs text-slate-800 tabular-nums">
                <Link href={`/vendors/${vendorId}`} className="text-blue-600 hover:underline">
                  {a.credit?.creditNoteNo ?? "Credit not in the app"}
                </Link>{" "}
                · <span className="font-medium">{inr2(a.amount)}</span> · {dateIN(a.appliedDate)}
              </p>
              {(a.appliedBy || a.note || a.credit?.referenceNo) && (
                <p className="text-[11px] text-slate-500 break-words">
                  {[a.credit?.referenceNo ? `supplier ref ${a.credit.referenceNo}` : null, a.appliedBy ? `by ${a.appliedBy}` : null, a.note]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              )}
            </div>
            {mayRemove && a.source === "APP" && (
              <button
                type="button"
                onClick={() => onRemove(a)}
                disabled={busy === a.id}
                aria-label={`Remove ${inr2(a.amount)} of ${a.credit?.creditNoteNo ?? "credit"}`}
                className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg text-red-600 hover:bg-red-50 disabled:opacity-50"
              >
                {busy === a.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
