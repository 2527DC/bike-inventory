"use client";

import { useState, useEffect, use } from "react";
import Link from "next/link";
import { ArrowLeft, CreditCard, Phone, MessageSquare } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { SkeletonList } from "@/components/ui/skeleton";

interface InvoiceDetail {
  id: string;
  invoiceNo: string;
  customerId: string;
  amount: number;
  paidAmount: number;
  status: string;
  invoiceDate: string;
  dueDate: string;
  notes?: string;
  customer: { id: string; name: string; phone?: string; email?: string };
  payments: Array<{
    id: string;
    amount: number;
    paymentMode: string;
    paymentDate: string;
    referenceNo?: string;
    notes?: string;
    recordedBy: { name: string };
  }>;
}

const PAYMENT_MODES = ["CASH", "CHEQUE", "NEFT", "RTGS", "UPI"];

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount);
}

export default function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [loading, setLoading] = useState(true);

  // Payment form state
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [payAmount, setPayAmount] = useState("");
  const [payMode, setPayMode] = useState("CASH");
  const [payDate, setPayDate] = useState(new Date().toISOString().split("T")[0]);
  const [payRef, setPayRef] = useState("");
  const [payNotes, setPayNotes] = useState("");
  const [paySubmitting, setPaySubmitting] = useState(false);
  const [payError, setPayError] = useState("");

  function fetchInvoice() {
    fetch(`/api/customer-invoices/${id}`)
      .then((r) => r.json())
      .then((res) => {
        if (res.success) setInvoice(res.data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    fetchInvoice();
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleRecordPayment(e: React.FormEvent) {
    e.preventDefault();
    if (!invoice || !payAmount || !payDate) return;

    const amt = parseFloat(payAmount);
    const remaining = invoice.amount - invoice.paidAmount;
    if (amt > remaining) {
      setPayError(`Amount exceeds remaining balance of ${formatCurrency(remaining)}`);
      return;
    }

    setPaySubmitting(true);
    setPayError("");

    try {
      const res = await fetch("/api/customer-payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: invoice.customerId,
          invoiceId: invoice.id,
          amount: amt,
          paymentMode: payMode,
          paymentDate: payDate,
          referenceNo: payRef || undefined,
          notes: payNotes || undefined,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Failed to record payment");

      // Reset form and refresh
      setShowPaymentForm(false);
      setPayAmount("");
      setPayMode("CASH");
      setPayDate(new Date().toISOString().split("T")[0]);
      setPayRef("");
      setPayNotes("");
      setLoading(true);
      fetchInvoice();
    } catch (err) {
      setPayError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setPaySubmitting(false);
    }
  }

  if (loading) {
    return <SkeletonList count={5} type="card" />;
  }

  if (!invoice) return (
    <div className="text-center py-12">
      <p className="text-sm text-slate-400">Invoice not found</p>
      <Link href="/receivables" className="text-sm text-blue-600 hover:underline mt-2 inline-block">
        Back to Receivables
      </Link>
    </div>
  );

  const remaining = invoice.amount - invoice.paidAmount;
  const isOverdue = new Date(invoice.dueDate) < new Date() && remaining > 0;
  const paidPercent = Math.min(100, (invoice.paidAmount / invoice.amount) * 100);

  const whatsappLink = invoice.customer.phone
    ? `https://wa.me/91${invoice.customer.phone.replace(/\D/g, "").slice(-10)}?text=${encodeURIComponent(
        `Reminder: Invoice ${invoice.invoiceNo} for ${formatCurrency(remaining)} is ${isOverdue ? "overdue" : "pending"}. Due: ${new Date(invoice.dueDate).toLocaleDateString("en-IN")}. Please arrange payment. Thank you.`
      )}`
    : null;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <Link href="/receivables" className="p-2 -ml-2 rounded-lg hover:bg-slate-100 focus-ring" aria-label="Back">
          <ArrowLeft className="h-5 w-5 text-slate-600" />
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-bold text-slate-900 tabular-nums truncate">{invoice.invoiceNo}</h1>
          <p className="text-xs text-slate-500 truncate">{invoice.customer.name}</p>
        </div>
        <Badge variant={invoice.status === "PAID" ? "success" : isOverdue ? "danger" : "warning"}>
          {isOverdue ? "OVERDUE" : invoice.status.replace(/_/g, " ")}
        </Badge>
      </div>

      {/* Amount Card with Progress */}
      <Card className={`mb-4 ${isOverdue ? "border-red-200 bg-red-50/50" : ""}`}>
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-slate-500">Total Amount</span>
            <span className="text-lg font-bold text-slate-900 tabular-nums">{formatCurrency(invoice.amount)}</span>
          </div>
          <div className="w-full bg-slate-200 rounded-full h-2 mb-2">
            <div className="bg-green-500 h-2 rounded-full transition-all" style={{ width: `${paidPercent}%` }} />
          </div>
          <div className="flex justify-between text-xs tabular-nums">
            <span className="text-green-600">Paid: {formatCurrency(invoice.paidAmount)}</span>
            <span className={remaining > 0 ? "text-red-600 font-medium" : "text-green-600"}>
              {remaining > 0 ? `Due: ${formatCurrency(remaining)}` : "Fully Paid"}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Actions */}
      {remaining > 0 && (
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => setShowPaymentForm(!showPaymentForm)}
            className="flex-1 flex items-center justify-center gap-2 min-h-[48px] rounded-lg font-medium bg-green-600 hover:bg-green-700 text-white focus-ring"
          >
            <CreditCard className="h-4 w-4" /> Record Payment
          </button>
          {whatsappLink && (
            <a href={whatsappLink} target="_blank" rel="noopener noreferrer" aria-label="Send WhatsApp reminder"
              className="flex items-center justify-center min-h-[48px] w-12 rounded-lg border border-green-300 text-green-600 hover:bg-green-50 focus-ring">
              <MessageSquare className="h-4 w-4" />
            </a>
          )}
          {invoice.customer.phone && (
            <a href={`tel:${invoice.customer.phone}`} aria-label="Call customer"
              className="flex items-center justify-center min-h-[48px] w-12 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100 focus-ring">
              <Phone className="h-4 w-4" />
            </a>
          )}
        </div>
      )}

      {/* Invoice Info */}
      <Card className="mb-4">
        <CardContent className="p-3 grid grid-cols-2 gap-2 text-sm">
          <div>
            <span className="text-slate-500">Invoice Date</span>
            <p className="font-semibold tabular-nums">{new Date(invoice.invoiceDate).toLocaleDateString("en-IN")}</p>
          </div>
          <div>
            <span className="text-slate-500">Due Date</span>
            <p className={`font-semibold tabular-nums ${isOverdue ? "text-red-600" : ""}`}>{new Date(invoice.dueDate).toLocaleDateString("en-IN")}</p>
          </div>
        </CardContent>
      </Card>

      {/* Inline Payment Form */}
      {showPaymentForm && remaining > 0 && (
        <Card className="mb-4 border-blue-200">
          <CardContent className="p-3">
            <h3 className="text-sm font-semibold text-slate-900 mb-3">Record Payment</h3>
            {payError && <div className="bg-red-50 text-red-700 text-xs p-2 rounded-lg mb-3">{payError}</div>}
            <form onSubmit={handleRecordPayment} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Amount *</label>
                <Input
                  type="number"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                  min="0.01"
                  step="0.01"
                  className="text-lg tabular-nums"
                />
                <p className="text-xs text-slate-500 mt-1 tabular-nums">Remaining: {formatCurrency(remaining)}</p>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Payment Mode *</label>
                <div className="flex flex-wrap gap-2">
                  {PAYMENT_MODES.map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setPayMode(mode)}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                        payMode === mode ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                      }`}
                    >
                      {mode}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Payment Date *</label>
                <Input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Reference No</label>
                <Input placeholder="Cheque/UTR/Transaction No" value={payRef} onChange={(e) => setPayRef(e.target.value)} />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Notes</label>
                <textarea
                  placeholder="Any notes..."
                  value={payNotes}
                  onChange={(e) => setPayNotes(e.target.value)}
                  rows={2}
                  className="flex w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
              </div>

              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={!payAmount || !payDate || paySubmitting}
                  className="flex-1 flex items-center justify-center min-h-[48px] rounded-lg font-medium bg-green-600 hover:bg-green-700 text-white disabled:opacity-50 focus-ring"
                >
                  {paySubmitting ? "Recording..." : "Submit Payment"}
                </button>
                <button
                  type="button"
                  onClick={() => { setShowPaymentForm(false); setPayError(""); }}
                  className="flex items-center justify-center min-h-[48px] px-4 rounded-lg font-medium bg-slate-100 text-slate-700 hover:bg-slate-200 focus-ring"
                >
                  Cancel
                </button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Payment History */}
      <h2 className="text-sm font-semibold text-slate-900 mb-2">Payments ({invoice.payments.length})</h2>
      <div className="space-y-2">
        {invoice.payments.map((p) => (
          <Card key={p.id} className="mb-2">
            <CardContent className="p-3 flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-green-700 tabular-nums">{formatCurrency(p.amount)}</p>
                <p className="text-xs text-slate-500 tabular-nums">
                  {p.paymentMode} | {new Date(p.paymentDate).toLocaleDateString("en-IN")}
                  {p.referenceNo ? ` | Ref: ${p.referenceNo}` : ""}
                </p>
                {p.notes && <p className="text-xs text-slate-400 mt-0.5">{p.notes}</p>}
              </div>
              <span className="text-[11px] text-slate-400 shrink-0 ml-2">{p.recordedBy.name}</span>
            </CardContent>
          </Card>
        ))}
        {invoice.payments.length === 0 && (
          <p className="text-sm text-slate-400 text-center py-4">No payments recorded</p>
        )}
      </div>
    </div>
  );
}
