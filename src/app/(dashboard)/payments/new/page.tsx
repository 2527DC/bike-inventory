"use client";

// Record a vendor payment (plan 1210 credit notes, Part 5 — R13; X6, X7, X12).
//
//   - Every call goes through apiFetch / apiTry: an expired session answers with the login page,
//     which raw `.json()` turned into "Unexpected token '<'" (CLAUDE.md, X12).
//   - One payment pays ONE store's bills (Q9). When a vendor's open bills span stores, chips pick
//     the store first and only that store's bills are listed — two stores cannot be ticked. The
//     API re-checks with storeIdForPayment().
//   - No bill ticked = an advance, which the API now accepts (X7) with a store picked here; the
//     picker auto-selects when there is exactly one active store.
//   - No credit field and no CD field (Q1 = b with D18; Q4 = a). A credit note is applied on the
//     bill, so the open credit with this vendor is shown with a link to the bill(s), before paying.
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Camera, Loader2, CheckCircle2, X, Receipt } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ErrorBanner } from "@/components/ui/error-banner";
import { apiFetch, apiTry } from "@/lib/api-client";
import { getTodayIST } from "@/lib/services/timezone";
import { createLogger } from "@/lib/logger";

const log = createLogger("payments:new");

interface VendorOption { id: string; name: string; code: string; }

// Rows of GET /api/bills. The store is read defensively (`storeId` or `store.id`): an older list
// response without it reads as "store not set", and the API refuses a mixed payment either way.
interface BillRow {
  id: string; billNo: string; amount: number; paidAmount: number; status: string;
  billDate: string; dueDate: string;
  storeId?: string | null; store?: { id: string; name: string } | null;
}
interface BillOption {
  id: string; billNo: string; amount: number; paidAmount: number; status: string;
  billDate: string; dueDate: string; storeId: string | null; storeName: string | null;
}
interface StoreOption { id: string; name: string; }
interface OpenCredits {
  credits: Array<{ id: string; status: string; open: number; storeId: string | null }>;
}

interface ScreenshotResult {
  amount?: number; paymentMode?: string; referenceNo?: string; paymentDate?: string;
  vendorId?: string; vendorName?: string | null; matchedVendorName?: string | null;
  bankName?: string | null; payerName?: string | null; notes?: string;
}

const PAYMENT_MODES = ["CASH", "CHEQUE", "NEFT", "RTGS", "UPI"];
const OPEN_BILL_STATUSES = ["PENDING", "PARTIALLY_PAID", "OVERDUE"] as const;
/** The chip key for bills with no store. */
const NO_STORE = "none";

const round2 = (n: number) => Math.round(n * 100) / 100;

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount);
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

// Fuzzy match: check if beneficiary name partially matches vendor name
function fuzzyMatchVendor(beneficiary: string, vendors: VendorOption[]): VendorOption | null {
  if (!beneficiary) return null;
  const lower = beneficiary.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (lower.length < 3) return null;

  // Exact substring match
  const exactMatch = vendors.find((v) =>
    v.name.toLowerCase().includes(lower) || lower.includes(v.name.toLowerCase().replace(/[^a-z0-9]/g, ""))
  );
  if (exactMatch) return exactMatch;

  // Partial word match (3+ char segments)
  const words = beneficiary.toLowerCase().split(/\s+/).filter((w) => w.length >= 3);
  for (const word of words) {
    const match = vendors.find((v) => v.name.toLowerCase().includes(word));
    if (match) return match;
  }

  return null;
}

const groupOf = (b: { storeId: string | null }) => b.storeId ?? NO_STORE;

export default function NewPaymentPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const presetBillId = searchParams.get("billId") || "";
  const presetVendorId = searchParams.get("vendorId") || "";
  const beneficiaryParam = searchParams.get("beneficiary") || "";
  const fileRef = useRef<HTMLInputElement>(null);

  const [vendors, setVendors] = useState<VendorOption[]>([]);
  const [vendorsError, setVendorsError] = useState<string | null>(null);
  const [bills, setBills] = useState<BillOption[]>([]);
  const [billsLoading, setBillsLoading] = useState(false);
  const [billsError, setBillsError] = useState<string | null>(null);
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [openCredits, setOpenCredits] = useState<OpenCredits["credits"]>([]);
  const [vendorId, setVendorId] = useState(presetVendorId);
  // When a vendor's open bills span stores: whose bills this payment pays (Q9).
  const [billGroup, setBillGroup] = useState<string | null>(null);
  // For an advance (no bill ticked): the store it is paid from.
  const [advanceStoreId, setAdvanceStoreId] = useState("");
  // Multi-bill: allocations map (billId → allocated amount)
  const [billAllocations, setBillAllocations] = useState<Map<string, number>>(new Map());
  const [amount, setAmount] = useState("");
  const [paymentMode, setPaymentMode] = useState("CASH");
  const [paymentDate, setPaymentDate] = useState(getTodayIST());
  const [referenceNo, setReferenceNo] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // AI Screenshot state
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<{
    vendorName: string | null;
    matchedVendorName: string | null;
    bankName: string | null;
    payerName: string | null;
  } | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // Vendors + stores, once. Then try to match the beneficiary from the URL.
  useEffect(() => {
    void apiTry<VendorOption[]>("/api/vendors?limit=500").then(({ data, error: err }) => {
      if (err || !data) {
        log.warn("vendors failed to load", { message: err });
        setVendorsError(err ?? "Could not load vendors.");
        return;
      }
      setVendors(data);
      if (!presetVendorId && beneficiaryParam) {
        const match = fuzzyMatchVendor(beneficiaryParam, data);
        if (match) setVendorId(match.id);
      }
    });
    void apiTry<StoreOption[]>("/api/stores").then(({ data, error: err }) => {
      if (err || !data) {
        log.warn("stores failed to load", { message: err });
        return;
      }
      setStores(data.map((s) => ({ id: s.id, name: s.name })));
      // One store: nothing to choose (the expense form does the same).
      if (data.length === 1) setAdvanceStoreId(data[0].id);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // FIFO auto-allocation: allocate to the oldest due bills first
  const autoAllocate = useCallback((totalAmount: number, billList: BillOption[]) => {
    const newAllocations = new Map<string, number>();
    let remaining = totalAmount;

    for (const bill of billList) {
      if (remaining <= 0) break;
      const billDue = round2(bill.amount - bill.paidAmount);
      if (billDue <= 0) continue;
      const alloc = Math.min(remaining, billDue);
      newAllocations.set(bill.id, round2(alloc));
      remaining = round2(remaining - alloc);
    }

    setBillAllocations(newAllocations);
  }, []);

  // Open bills of the vendor, oldest due first. Returns the list so a caller can re-allocate.
  const loadBills = useCallback(async (forVendor: string): Promise<BillOption[]> => {
    setBillsLoading(true);
    setBillsError(null);
    const results = await Promise.all(
      OPEN_BILL_STATUSES.map((s) =>
        apiTry<BillRow[]>(`/api/bills?vendorId=${encodeURIComponent(forVendor)}&status=${s}&limit=200`)
      )
    );
    setBillsLoading(false);
    const failed = results.find((r) => r.error);
    if (failed) {
      log.warn("bills failed to load", { vendorId: forVendor, status: failed.status, message: failed.error });
      setBillsError(failed.error ?? "Could not load this vendor's bills.");
      setBills([]);
      return [];
    }
    const list: BillOption[] = results
      .flatMap((r) => r.data ?? [])
      .map((b) => ({
        id: b.id, billNo: b.billNo, amount: b.amount, paidAmount: b.paidAmount, status: b.status,
        billDate: b.billDate, dueDate: b.dueDate,
        storeId: b.storeId ?? b.store?.id ?? null, storeName: b.store?.name ?? null,
      }))
      .filter((b) => round2(b.amount - b.paidAmount) > 0.01)
      .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());
    setBills(list);
    return list;
  }, []);

  // Bills and open credit when the vendor changes.
  useEffect(() => {
    if (!vendorId) return;
    void loadBills(vendorId).then((list) => {
      // A bill to pay was named in the URL: tick it, in its store's group.
      const bill = presetBillId ? list.find((b) => b.id === presetBillId) : undefined;
      if (bill) {
        const remaining = round2(bill.amount - bill.paidAmount);
        setBillGroup(groupOf(bill));
        setBillAllocations(new Map([[bill.id, remaining]]));
        setAmount(String(remaining));
      } else {
        setBillGroup(list.length ? groupOf(list[0]) : null);
      }
    });
    // Open credit is a hint — a 403 (no Vendors › View) simply hides it.
    void apiTry<OpenCredits>(`/api/vendors/${vendorId}/credits?status=open`).then(({ data, error: err, status }) => {
      if (err || !data) {
        log.warn("open credit failed to load", { vendorId, status, message: err });
        setOpenCredits([]);
        return;
      }
      setOpenCredits(data.credits);
    });
  }, [vendorId, loadBills]); // eslint-disable-line react-hooks/exhaustive-deps

  // Store groups among the open bills. One group → no chips.
  const groups = useMemo(() => {
    const m = new Map<string, { key: string; name: string; count: number }>();
    for (const b of bills) {
      const key = groupOf(b);
      const g = m.get(key) ?? {
        key,
        name: key === NO_STORE ? "Store not set" : b.storeName ?? stores.find((s) => s.id === key)?.name ?? "Store",
        count: 0,
      };
      g.count++;
      m.set(key, g);
    }
    return [...m.values()];
  }, [bills, stores]);
  const activeGroup = billGroup && groups.some((g) => g.key === billGroup) ? billGroup : groups[0]?.key ?? null;
  const visibleBills = useMemo(
    () => (activeGroup ? bills.filter((b) => groupOf(b) === activeGroup) : []),
    [bills, activeGroup]
  );

  const handleAmountChange = (val: string) => {
    setAmount(val);
    const num = parseFloat(val);
    if (!isNaN(num) && num > 0 && visibleBills.length > 0) {
      autoAllocate(num, visibleBills);
    } else {
      setBillAllocations(new Map());
    }
  };

  const selectGroup = (key: string) => {
    if (key === activeGroup) return;
    setBillGroup(key);
    setBillAllocations(new Map());
    setAmount("");
    setError("");
  };

  // Toggle a specific bill selection
  const toggleBill = (billId: string) => {
    const bill = bills.find((b) => b.id === billId);
    if (!bill) return;
    const newAllocations = new Map(billAllocations);
    if (newAllocations.has(billId)) {
      newAllocations.delete(billId);
    } else {
      // Defensive: only the active store's bills are listed, but never let two stores be ticked.
      const ticked = bills.filter((b) => newAllocations.has(b.id));
      if (ticked.some((b) => groupOf(b) !== groupOf(bill))) {
        setError("One payment pays one store's bills. Pay each store's bills separately.");
        return;
      }
      newAllocations.set(billId, round2(bill.amount - bill.paidAmount));
    }
    // Recalculate total amount from allocations
    const total = round2(Array.from(newAllocations.values()).reduce((s, a) => s + a, 0));
    setAmount(total > 0 ? String(total) : "");
    setBillAllocations(newAllocations);
  };

  const totalAllocated = round2(Array.from(billAllocations.values()).reduce((s, a) => s + a, 0));
  const totalDue = round2(visibleBills.reduce((s, b) => s + (b.amount - b.paidAmount), 0));
  const amountNum = parseFloat(amount);
  const isAdvance = billAllocations.size === 0;
  const unallocated = !isAdvance && amountNum > 0 ? round2(amountNum - totalAllocated) : 0;

  // The payment's store: the ticked bills' store, or the one picked for an advance.
  const paymentStoreId = isAdvance ? advanceStoreId || null : activeGroup && activeGroup !== NO_STORE ? activeGroup : null;
  const paymentStoreName = paymentStoreId ? stores.find((s) => s.id === paymentStoreId)?.name ?? groups.find((g) => g.key === paymentStoreId)?.name ?? null : null;

  // Open credit that could reduce what is paid: the payment's store, or credits with no store.
  const creditOpen = round2(
    openCredits
      .filter((c) => c.status === "OPEN" && c.open > 0.01 && (!paymentStoreId || !c.storeId || c.storeId === paymentStoreId))
      .reduce((s, c) => s + c.open, 0)
  );
  const tickedBills = bills.filter((b) => billAllocations.has(b.id));

  const blockReason = !vendorId
    ? "Select a vendor to continue"
    : !(amountNum > 0)
      ? "Enter an amount to continue"
      : Math.abs(unallocated) > 0.01
        ? unallocated > 0
          ? `${formatCurrency(unallocated)} more than the ticked bills take. Lower the amount, or untick every bill to record it all as an advance.`
          : "The amount is less than the ticked bills take. Untick a bill or raise the amount."
        : isAdvance && !advanceStoreId
          ? "Pick the store this advance is paid from"
          : null;

  // AI Screenshot handler
  const handleScreenshot = async (file: File) => {
    setScanning(true);
    setError("");
    setScanResult(null);
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);

    try {
      const formData = new FormData();
      formData.append("file", file);
      const { data: d, error: err } = await apiTry<ScreenshotResult>("/api/payments/parse-screenshot", {
        method: "POST",
        body: formData,
        timeoutMs: 60_000,
      });
      if (err || !d) {
        log.warn("screenshot scan failed", { message: err });
        setError(err || "Failed to scan screenshot");
        return;
      }

      if (d.amount) setAmount(String(d.amount));
      if (d.paymentMode && PAYMENT_MODES.includes(d.paymentMode.toUpperCase())) {
        setPaymentMode(d.paymentMode.toUpperCase());
      } else if (d.paymentMode === "IMPS") {
        setPaymentMode("NEFT");
      }
      if (d.referenceNo) setReferenceNo(d.referenceNo);
      if (d.paymentDate) setPaymentDate(d.paymentDate);

      // Vendor matching: API match > client-side fuzzy match
      const scannedVendorId = d.vendorId
        ? d.vendorId
        : d.vendorName && vendors.length > 0
          ? fuzzyMatchVendor(d.vendorName, vendors)?.id
          : undefined;
      if (scannedVendorId && scannedVendorId !== vendorId) {
        setVendorId(scannedVendorId);
        setBillAllocations(new Map());
      }

      const extraNotes: string[] = [];
      if (d.notes) extraNotes.push(d.notes);
      if (d.bankName) extraNotes.push(`Bank: ${d.bankName}`);
      if (d.payerName) extraNotes.push(`Paid by: ${d.payerName}`);
      if (extraNotes.length > 0) setNotes(extraNotes.join(" | "));

      setScanResult({
        vendorName: d.vendorName ?? null,
        matchedVendorName: d.matchedVendorName || (d.vendorId ? vendors.find((v) => v.id === d.vendorId)?.name || null : null),
        bankName: d.bankName ?? null,
        payerName: d.payerName ?? null,
      });

      // Auto-allocate after amount is set (same vendor's bills are already loaded)
      if (d.amount && (!scannedVendorId || scannedVendorId === vendorId) && visibleBills.length > 0) {
        autoAllocate(d.amount, visibleBills);
      }
    } finally {
      setScanning(false);
    }
  };

  const clearScan = () => {
    setScanResult(null);
    setPreviewUrl(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (blockReason || submitting) return;

    setSubmitting(true);
    setError("");

    const allocArray = Array.from(billAllocations.entries())
      .filter(([, amt]) => amt > 0)
      .map(([bId, amt]) => ({ billId: bId, amount: round2(amt) }));

    try {
      await apiFetch("/api/payments", {
        method: "POST",
        json: {
          vendorId,
          billAllocations: allocArray.length > 0 ? allocArray : undefined,
          amount: round2(amountNum),
          paymentMode,
          paymentDate,
          referenceNo: referenceNo || undefined,
          notes: notes || undefined,
          // Only an advance carries a store; a bill payment's store is its bills' (the API derives it).
          ...(allocArray.length === 0 && advanceStoreId ? { storeId: advanceStoreId } : {}),
        },
      });
      log.info("payment recorded", { vendorId, bills: allocArray.length, advance: allocArray.length === 0 });
      router.push("/accounts");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something went wrong";
      const status = (err as { status?: number }).status;
      log.warn("payment not recorded", { vendorId, status, message });
      setError(message);
      // A bill changed under us (409): re-read the bills and re-allocate the same amount.
      if (status === 409 && vendorId) {
        const fresh = await loadBills(vendorId);
        const freshVisible = activeGroup ? fresh.filter((b) => groupOf(b) === activeGroup) : [];
        if (amountNum > 0 && freshVisible.length > 0) autoAllocate(amountNum, freshVisible);
        else setBillAllocations(new Map());
      }
    } finally {
      setSubmitting(false);
    }
  }

  const vendorName = vendors.find((v) => v.id === vendorId)?.name ?? "this vendor";

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <Link href="/accounts" className="p-2 -ml-2 rounded-lg hover:bg-slate-100 focus-ring" aria-label="Back">
          <ArrowLeft className="h-5 w-5 text-slate-600" />
        </Link>
        <h1 className="text-lg font-bold text-slate-900 truncate">Record Payment</h1>
      </div>

      {/* AI Screenshot Upload */}
      <div className="mb-4">
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
          onChange={(e) => { const file = e.target.files?.[0]; if (file) void handleScreenshot(file); }} />

        {!scanResult && !scanning && (
          <button type="button" onClick={() => fileRef.current?.click()}
            className="w-full flex items-center justify-center gap-2 py-3 min-h-[44px] rounded-xl border-2 border-dashed border-blue-300 bg-blue-50 text-blue-700 text-sm font-medium hover:bg-blue-100 transition-colors">
            <Camera className="h-5 w-5" /> Upload Payment Screenshot
          </button>
        )}

        {scanning && (
          <div className="w-full flex flex-col items-center gap-2 py-4 rounded-xl border-2 border-blue-200 bg-blue-50">
            {previewUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={previewUrl} alt="Payment" className="h-24 rounded-lg object-contain mb-1" />
            )}
            <div className="flex items-center gap-2 text-blue-700">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm font-medium">Scanning with AI...</span>
            </div>
          </div>
        )}

        {scanResult && (
          <div className="rounded-xl border border-green-200 bg-green-50 p-3">
            <div className="flex items-start justify-between mb-2">
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                <span className="text-sm font-medium text-green-800">Details Extracted</span>
              </div>
              <button type="button" onClick={clearScan} aria-label="Clear scan" className="min-h-[32px] min-w-[32px] flex items-center justify-center hover:bg-green-100 rounded">
                <X className="h-3.5 w-3.5 text-green-600" />
              </button>
            </div>
            {previewUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={previewUrl} alt="Payment" className="h-16 rounded-lg object-contain mb-2" />
            )}
            <div className="space-y-0.5 text-xs text-green-700">
              {scanResult.matchedVendorName && (
                <p>Vendor matched: <span className="font-medium">{scanResult.matchedVendorName}</span></p>
              )}
              {!scanResult.matchedVendorName && scanResult.vendorName && (
                <p>Beneficiary: <span className="font-medium">{scanResult.vendorName}</span> <span className="text-amber-600">(no match)</span></p>
              )}
              {scanResult.bankName && <p>Bank: {scanResult.bankName}</p>}
            </div>
          </div>
        )}
      </div>

      {error && <div role="alert" className="bg-red-50 text-red-700 text-sm p-3 rounded-lg mb-4">{error}</div>}
      {vendorsError && <ErrorBanner message={vendorsError} />}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="pay-vendor" className="block text-sm font-medium text-slate-700 mb-1">Vendor *</label>
          <select id="pay-vendor" value={vendorId}
            onChange={(e) => {
              setVendorId(e.target.value);
              setBills([]);
              setOpenCredits([]);
              setBillGroup(null);
              setBillAllocations(new Map());
              setAmount("");
              setError("");
            }}
            className="flex h-10 min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900">
            <option value="">Select vendor...</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>{v.name} ({v.code})</option>
            ))}
          </select>
        </div>

        {/* Open credit with this vendor: applied on the bill, not paid in cash (D18). */}
        {vendorId && creditOpen > 0.01 && (
          <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2">
            <p className="text-xs text-blue-800 flex items-start gap-1.5">
              <Receipt className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span>
                <span className="font-semibold tabular-nums">{formatCurrency(creditOpen)}</span> open credit with this vendor — apply it on the bill before paying.
              </span>
            </p>
            <div className="flex flex-wrap gap-x-3 mt-1 pl-5">
              {tickedBills.length > 0 ? (
                <>
                  {tickedBills.slice(0, 3).map((b) => (
                    <Link key={b.id} href={`/bills/${b.id}`} className="min-h-[32px] inline-flex items-center text-xs font-medium text-blue-700 underline tabular-nums">
                      Bill {b.billNo}
                    </Link>
                  ))}
                  {tickedBills.length > 3 && <span className="text-xs text-blue-700 self-center">+{tickedBills.length - 3} more</span>}
                </>
              ) : (
                <Link href={`/vendors/${vendorId}`} className="min-h-[32px] inline-flex items-center text-xs font-medium text-blue-700 underline">
                  See the vendor&rsquo;s credit notes
                </Link>
              )}
            </div>
          </div>
        )}

        <div>
          <label htmlFor="pay-amount" className="block text-sm font-medium text-slate-700 mb-1">Amount *</label>
          <Input id="pay-amount" type="number" inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => handleAmountChange(e.target.value)}
            min="0.01" step="0.01" className="text-lg min-h-[44px] tabular-nums" />
          {vendorId && visibleBills.length > 0 && (
            <p className="text-xs text-slate-500 mt-1 tabular-nums">
              Total due: {formatCurrency(totalDue)}
              {totalAllocated > 0 && <span className="text-green-600 ml-1">| Allocating: {formatCurrency(totalAllocated)}</span>}
            </p>
          )}
        </div>

        {vendorId && billsLoading && (
          <div className="space-y-1.5" aria-busy="true">
            {[0, 1].map((i) => <div key={i} className="h-12 rounded-lg bg-slate-100 animate-pulse" />)}
          </div>
        )}
        {vendorId && billsError && !billsLoading && (
          <ErrorBanner message={billsError} onRetry={() => void loadBills(vendorId)} />
        )}

        {/* One store per payment: choose whose bills, when the vendor's bills span stores. */}
        {vendorId && !billsLoading && groups.length > 1 && (
          <div>
            <p className="block text-sm font-medium text-slate-700 mb-1">Pay bills of</p>
            <div role="radiogroup" aria-label="Store" className="flex flex-wrap gap-2">
              {groups.map((g) => (
                <button key={g.key} type="button" role="radio" aria-checked={activeGroup === g.key} onClick={() => selectGroup(g.key)}
                  className={`min-h-[44px] px-3 rounded-full text-xs font-medium transition-colors ${
                    activeGroup === g.key ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}>
                  {g.name} <span className="tabular-nums opacity-80">· {g.count}</span>
                </button>
              ))}
            </div>
            <p className="text-[11px] text-slate-500 mt-1">One payment pays one store&rsquo;s bills.</p>
          </div>
        )}

        {/* Multi-bill allocation (FIFO auto-selected) */}
        {vendorId && !billsLoading && visibleBills.length > 0 && (
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Bills to settle <span className="text-xs text-slate-400 font-normal">(oldest first, auto-selected)</span>
            </label>
            <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 max-h-56 overflow-y-auto">
              {visibleBills.map((b) => {
                const due = round2(b.amount - b.paidAmount);
                const allocated = billAllocations.get(b.id) || 0;
                const isSelected = allocated > 0;
                // The bill's stored due date (Q5 = a), compared as IST calendar days.
                const dueDay = new Date(new Date(b.dueDate).getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
                const isOverdue = dueDay < getTodayIST();
                return (
                  <label key={b.id}
                    className={`flex items-center gap-2.5 px-3 py-2 min-h-[44px] cursor-pointer transition-colors ${
                      isSelected ? "bg-blue-50" : "hover:bg-slate-50"
                    }`}>
                    <input type="checkbox" checked={isSelected} onChange={() => toggleBill(b.id)}
                      className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-medium text-slate-900 tabular-nums">{b.billNo}</span>
                        {isOverdue && <span className="text-[11px] text-red-600 font-medium">OVERDUE</span>}
                      </div>
                      <p className="text-[11px] text-slate-500 tabular-nums">
                        Due: {formatDate(b.dueDate)} | Billed: {formatDate(b.billDate)}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xs font-semibold text-slate-700 tabular-nums">{formatCurrency(due)}</p>
                      {isSelected && allocated < due && (
                        <p className="text-[11px] text-blue-600 tabular-nums">Paying: {formatCurrency(allocated)}</p>
                      )}
                      {isSelected && allocated >= due && (
                        <p className="text-[11px] text-green-600">Full</p>
                      )}
                    </div>
                  </label>
                );
              })}
            </div>
          </div>
        )}

        {/* The store the payment is booked to */}
        {vendorId && !billsLoading && (
          isAdvance ? (
            amountNum > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 space-y-2">
                <p className="text-xs text-amber-800">
                  No bill ticked — this is recorded as an advance to {vendorName}
                  {paymentStoreName ? ` for ${paymentStoreName}` : ""}.
                </p>
                {stores.length > 1 && (
                  <select aria-label="Store this advance is paid from" value={advanceStoreId}
                    onChange={(e) => setAdvanceStoreId(e.target.value)}
                    className="w-full min-h-[44px] rounded-lg border border-amber-300 bg-white px-3 text-sm">
                    <option value="">Pick the store…</option>
                    {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                )}
                {stores.length === 0 && (
                  <p className="text-[11px] text-amber-800">No store is set up, so an advance cannot be recorded. Tick a bill instead.</p>
                )}
              </div>
            )
          ) : (
            <p className="text-xs text-slate-500">
              Store: <span className="font-medium text-slate-700">{paymentStoreName ?? "not set on these bills"}</span>
              {paymentStoreName ? " (from the ticked bills)" : ""}
            </p>
          )
        )}

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Payment Mode *</label>
          <div className="flex flex-wrap gap-2">
            {PAYMENT_MODES.map((mode) => (
              <button key={mode} type="button" onClick={() => setPaymentMode(mode)}
                className={`min-h-[44px] px-3 rounded-full text-xs font-medium transition-colors ${
                  paymentMode === mode ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}>
                {mode}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label htmlFor="pay-date" className="block text-sm font-medium text-slate-700 mb-1">Payment Date *</label>
          <Input id="pay-date" type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} className="min-h-[44px] tabular-nums" />
        </div>

        <div>
          <label htmlFor="pay-ref" className="block text-sm font-medium text-slate-700 mb-1">Reference No</label>
          <Input id="pay-ref" placeholder="Cheque/UTR/Transaction No" value={referenceNo} onChange={(e) => setReferenceNo(e.target.value)} className="min-h-[44px]" />
        </div>

        <div>
          <label htmlFor="pay-notes" className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
          <textarea id="pay-notes" placeholder="Any notes..." value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
            className="flex w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900" />
        </div>

        <div>
          <Button type="submit" size="lg" disabled={Boolean(blockReason) || submitting} className="w-full min-h-[48px] bg-green-600 hover:bg-green-700 text-white">
            {submitting ? "Recording..." : billAllocations.size > 1
              ? `Record Payment (${billAllocations.size} bills)`
              : isAdvance && amountNum > 0 ? "Record Advance" : "Record Payment"}
          </Button>
          {blockReason && !submitting && (
            <p className="text-xs text-slate-500 mt-1.5 text-center">{blockReason}</p>
          )}
        </div>
      </form>
    </div>
  );
}
