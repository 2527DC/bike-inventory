"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Camera, Loader2, CheckCircle2, X } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface VendorOption { id: string; name: string; code: string; }
interface BillOption { id: string; billNo: string; amount: number; paidAmount: number; vendorId: string; billDate: string; dueDate: string; }

const PAYMENT_MODES = ["CASH", "CHEQUE", "NEFT", "RTGS", "UPI"];

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

export default function NewPaymentPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const presetBillId = searchParams.get("billId") || "";
  const presetVendorId = searchParams.get("vendorId") || "";
  const beneficiaryParam = searchParams.get("beneficiary") || "";
  const fileRef = useRef<HTMLInputElement>(null);

  const [vendors, setVendors] = useState<VendorOption[]>([]);
  const [bills, setBills] = useState<BillOption[]>([]);
  const [vendorId, setVendorId] = useState(presetVendorId);
  // Multi-bill: allocations map (billId → allocated amount)
  const [billAllocations, setBillAllocations] = useState<Map<string, number>>(new Map());
  const [amount, setAmount] = useState("");
  const [paymentMode, setPaymentMode] = useState("CASH");
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().split("T")[0]);
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

  // Load vendors + try to match beneficiary
  useEffect(() => {
    fetch("/api/vendors?limit=100")
      .then((r) => r.json())
      .then((res) => {
        if (res.success) {
          setVendors(res.data);
          // Try fuzzy match from beneficiary URL param
          if (!presetVendorId && beneficiaryParam) {
            const match = fuzzyMatchVendor(beneficiaryParam, res.data);
            if (match) setVendorId(match.id);
          }
        }
      })
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Load bills when vendor changes (sorted by dueDate asc — oldest first)
  useEffect(() => {
    if (!vendorId) { setBills([]); setBillAllocations(new Map()); return; }
    Promise.all([
      fetch(`/api/bills?vendorId=${vendorId}&status=PENDING&limit=50`).then((r) => r.json()),
      fetch(`/api/bills?vendorId=${vendorId}&status=PARTIALLY_PAID&limit=50`).then((r) => r.json()),
    ]).then(([pendingRes, partialRes]) => {
      const allBills: BillOption[] = [
        ...(pendingRes.success ? pendingRes.data : []),
        ...(partialRes.success ? partialRes.data : []),
      ];
      // Sort by dueDate ascending (oldest first)
      allBills.sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());
      setBills(allBills);

      // If preset billId, auto-select it and set amount
      if (presetBillId) {
        const bill = allBills.find((b) => b.id === presetBillId);
        if (bill) {
          const remaining = bill.amount - bill.paidAmount;
          setBillAllocations(new Map([[bill.id, remaining]]));
          setAmount(String(remaining));
        }
      }
    }).catch(() => {});
  }, [vendorId]); // eslint-disable-line react-hooks/exhaustive-deps

  // FIFO auto-allocation: when amount changes, allocate to oldest bills first
  const autoAllocate = useCallback((totalAmount: number, billList: BillOption[]) => {
    const newAllocations = new Map<string, number>();
    let remaining = totalAmount;

    for (const bill of billList) {
      if (remaining <= 0) break;
      const billDue = bill.amount - bill.paidAmount;
      if (billDue <= 0) continue;
      const alloc = Math.min(remaining, billDue);
      newAllocations.set(bill.id, Math.round(alloc * 100) / 100);
      remaining -= alloc;
    }

    setBillAllocations(newAllocations);
  }, []);

  const handleAmountChange = (val: string) => {
    setAmount(val);
    const num = parseFloat(val);
    if (!isNaN(num) && num > 0 && bills.length > 0) {
      autoAllocate(num, bills);
    } else {
      setBillAllocations(new Map());
    }
  };

  // Toggle a specific bill selection
  const toggleBill = (billId: string) => {
    const bill = bills.find((b) => b.id === billId);
    if (!bill) return;
    const newAllocations = new Map(billAllocations);
    if (newAllocations.has(billId)) {
      newAllocations.delete(billId);
    } else {
      newAllocations.set(billId, bill.amount - bill.paidAmount);
    }
    // Recalculate total amount from allocations
    const total = Array.from(newAllocations.values()).reduce((s, a) => s + a, 0);
    setAmount(String(Math.round(total)));
    setBillAllocations(newAllocations);
  };

  const totalAllocated = Array.from(billAllocations.values()).reduce((s, a) => s + a, 0);
  const totalDue = bills.reduce((s, b) => s + (b.amount - b.paidAmount), 0);

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
      const res = await fetch("/api/payments/parse-screenshot", { method: "POST", body: formData });
      const data = await res.json();

      if (!data.success) { setError(data.error || "Failed to scan screenshot"); return; }

      const d = data.data;
      if (d.amount) setAmount(String(d.amount));
      if (d.paymentMode && PAYMENT_MODES.includes(d.paymentMode.toUpperCase())) {
        setPaymentMode(d.paymentMode.toUpperCase());
      } else if (d.paymentMode === "IMPS") {
        setPaymentMode("NEFT");
      }
      if (d.referenceNo) setReferenceNo(d.referenceNo);
      if (d.paymentDate) setPaymentDate(d.paymentDate);

      // Vendor matching: API match > client-side fuzzy match
      if (d.vendorId) {
        setVendorId(d.vendorId);
      } else if (d.vendorName && vendors.length > 0) {
        const fuzzy = fuzzyMatchVendor(d.vendorName, vendors);
        if (fuzzy) setVendorId(fuzzy.id);
      }

      const extraNotes: string[] = [];
      if (d.notes) extraNotes.push(d.notes);
      if (d.bankName) extraNotes.push(`Bank: ${d.bankName}`);
      if (d.payerName) extraNotes.push(`Paid by: ${d.payerName}`);
      if (extraNotes.length > 0) setNotes(extraNotes.join(" | "));

      setScanResult({
        vendorName: d.vendorName,
        matchedVendorName: d.matchedVendorName || (d.vendorId ? vendors.find(v => v.id === d.vendorId)?.name || null : null),
        bankName: d.bankName,
        payerName: d.payerName,
      });

      // Auto-allocate after amount is set
      if (d.amount && bills.length > 0) {
        autoAllocate(d.amount, bills);
      }
    } catch {
      setError("Failed to scan screenshot. Please try again.");
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
    if (!vendorId || !amount || !paymentDate) return;

    const payAmount = parseFloat(amount);

    setSubmitting(true);
    setError("");

    try {
      const allocArray = Array.from(billAllocations.entries())
        .filter(([, amt]) => amt > 0)
        .map(([bId, amt]) => ({ billId: bId, amount: amt }));

      const res = await fetch("/api/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vendorId,
          billAllocations: allocArray.length > 0 ? allocArray : undefined,
          amount: payAmount,
          paymentMode,
          paymentDate,
          referenceNo,
          notes,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Failed to record payment");
      router.push("/accounts");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

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
          onChange={(e) => { const file = e.target.files?.[0]; if (file) handleScreenshot(file); }} />

        {!scanResult && !scanning && (
          <button type="button" onClick={() => fileRef.current?.click()}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-dashed border-blue-300 bg-blue-50 text-blue-700 text-sm font-medium hover:bg-blue-100 transition-colors">
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
              <button onClick={clearScan} className="p-0.5 hover:bg-green-100 rounded">
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

      {error && <div className="bg-red-50 text-red-700 text-sm p-3 rounded-lg mb-4">{error}</div>}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Vendor *</label>
          <select value={vendorId}
            onChange={(e) => { setVendorId(e.target.value); setBillAllocations(new Map()); setAmount(""); }}
            className="flex h-10 min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900">
            <option value="">Select vendor...</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>{v.name} ({v.code})</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Amount *</label>
          <Input type="number" inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => handleAmountChange(e.target.value)}
            min="0.01" step="0.01" className="text-lg min-h-[44px] tabular-nums" />
          {vendorId && bills.length > 0 && (
            <p className="text-xs text-slate-500 mt-1 tabular-nums">
              Total due: {formatCurrency(totalDue)}
              {totalAllocated > 0 && <span className="text-green-600 ml-1">| Allocating: {formatCurrency(totalAllocated)}</span>}
            </p>
          )}
        </div>

        {/* Multi-bill allocation (FIFO auto-selected) */}
        {vendorId && bills.length > 0 && (
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Bills to settle <span className="text-xs text-slate-400 font-normal">(oldest first, auto-selected)</span>
            </label>
            <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 max-h-56 overflow-y-auto">
              {bills.map((b) => {
                const due = b.amount - b.paidAmount;
                const allocated = billAllocations.get(b.id) || 0;
                const isSelected = allocated > 0;
                const isOverdue = new Date(b.dueDate) < new Date();
                return (
                  <label key={b.id}
                    className={`flex items-center gap-2.5 px-3 py-2 cursor-pointer transition-colors ${
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
            {billAllocations.size === 0 && parseFloat(amount) > 0 && (
              <p className="text-[11px] text-amber-600 mt-1">No bills selected — payment will be recorded as advance</p>
            )}
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Payment Mode *</label>
          <div className="flex flex-wrap gap-2">
            {PAYMENT_MODES.map((mode) => (
              <button key={mode} type="button" onClick={() => setPaymentMode(mode)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                  paymentMode === mode ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}>
                {mode}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Payment Date *</label>
          <Input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} className="min-h-[44px] tabular-nums" />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Reference No</label>
          <Input placeholder="Cheque/UTR/Transaction No" value={referenceNo} onChange={(e) => setReferenceNo(e.target.value)} className="min-h-[44px]" />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
          <textarea placeholder="Any notes..." value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
            className="flex w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900" />
        </div>

        <div>
          <Button type="submit" size="lg" disabled={!vendorId || !amount || submitting} className="w-full min-h-[48px] bg-green-600 hover:bg-green-700 text-white">
            {submitting ? "Recording..." : billAllocations.size > 1
              ? `Record Payment (${billAllocations.size} bills)`
              : "Record Payment"}
          </Button>
          {(!vendorId || !amount) && !submitting && (
            <p className="text-xs text-slate-500 mt-1.5 text-center">
              {!vendorId ? "Select a vendor to continue" : "Enter an amount to continue"}
            </p>
          )}
        </div>
      </form>
    </div>
  );
}
