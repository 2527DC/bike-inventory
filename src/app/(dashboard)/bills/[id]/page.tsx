"use client";

import { useState, useEffect, use } from "react";
import Link from "next/link";
import { ArrowLeft, CreditCard, Phone, MessageSquare } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SkeletonList } from "@/components/ui/skeleton";

interface BillDetail {
  id: string;
  billNo: string;
  vendorId: string;
  amount: number;
  paidAmount: number;
  status: string;
  billDate: string;
  dueDate: string;
  lastFollowedUp?: string;
  nextFollowUpDate?: string;
  followUpNotes?: string;
  notes?: string;
  vendor: { name: string; code: string; phone?: string; whatsappNumber?: string; paymentTermDays?: number };
  vendorBalance?: number;
  payments: Array<{
    id: string;
    amount: number;
    cdDiscountAmount?: number;
    paymentMode: string;
    paymentDate: string;
    referenceNo?: string;
  }>;
}

interface CdEligibility {
  eligible: boolean;
  reason?: string;
  cdPercentage?: number;
  daysRemaining?: number;
  discountAmount?: number;
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount);
}

export default function BillDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [bill, setBill] = useState<BillDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [cdInfo, setCdInfo] = useState<CdEligibility | null>(null);

  useEffect(() => {
    fetch(`/api/bills/${id}`)
      .then((r) => r.json())
      .then((res) => {
        if (res.success) {
          setBill(res.data);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));

    // Fetch CD eligibility
    fetch(`/api/bills/${id}/cd-eligibility`)
      .then((r) => r.json())
      .then((res) => {
        if (res.success) setCdInfo(res.data);
      })
      .catch(() => {});
  }, [id]);

  if (loading) {
    return (
      <div className="pt-2">
        <SkeletonList count={5} type="card" />
      </div>
    );
  }

  if (!bill) return (
    <div className="text-center py-12">
      <p className="text-sm text-slate-400">Bill not found</p>
      <Link href="/bills" className="text-sm text-blue-600 hover:underline mt-2 inline-block">
        Back to Bills
      </Link>
    </div>
  );

  const remaining = bill.amount - bill.paidAmount;
  // Calculate due date from billDate + vendor payment terms (app controls overdue)
  const appDueDate = new Date(bill.billDate);
  appDueDate.setDate(appDueDate.getDate() + (bill.vendor.paymentTermDays || 30));
  const isOverdue = appDueDate < new Date() && remaining > 0;
  const paidPercent = Math.min(100, (bill.paidAmount / bill.amount) * 100);

  const whatsappLink = bill.vendor.whatsappNumber
    ? `https://wa.me/91${bill.vendor.whatsappNumber.replace(/\D/g, "").slice(-10)}?text=${encodeURIComponent(
        `Reminder: Bill ${bill.billNo} for ${formatCurrency(remaining)} is ${isOverdue ? "overdue" : "pending"}. Due: ${appDueDate.toLocaleDateString("en-IN")}. Please arrange payment. Thank you.`
      )}`
    : null;

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <Link href="/bills" className="p-2 -ml-2 rounded-lg hover:bg-slate-100 focus-ring" aria-label="Back">
          <ArrowLeft className="h-5 w-5 text-slate-600" />
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-bold text-slate-900 tabular-nums truncate">{bill.billNo}</h1>
          <p className="text-xs text-slate-500 truncate">{bill.vendor.name}</p>
          {bill.vendorBalance !== undefined && (
            <p className={`text-xs font-medium tabular-nums ${bill.vendorBalance > 0 ? "text-red-600" : "text-green-600"}`}>
              Balance: {formatCurrency(bill.vendorBalance)}
            </p>
          )}
        </div>
        <Badge variant={bill.status === "PAID" ? "success" : isOverdue ? "danger" : "warning"}>
          {isOverdue ? "OVERDUE" : bill.status.replace(/_/g, " ")}
        </Badge>
      </div>

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
            <span className="text-green-600 tabular-nums">Paid: {formatCurrency(bill.paidAmount)}</span>
            <span className={`tabular-nums ${remaining > 0 ? "text-red-600 font-medium" : "text-green-600"}`}>
              {remaining > 0 ? `Due: ${formatCurrency(remaining)}` : "Fully Paid"}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Actions */}
      {remaining > 0 && (
        <div className="flex gap-2 mb-4">
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

      {/* Bill Info */}
      <Card className="mb-4">
        <CardContent className="p-3 grid grid-cols-2 gap-2 text-sm">
          <div>
            <span className="text-slate-500">Bill Date</span>
            <p className="font-semibold tabular-nums">{new Date(bill.billDate).toLocaleDateString("en-IN")}</p>
          </div>
          <div>
            <span className="text-slate-500">Due Date</span>
            <p className={`font-semibold tabular-nums ${isOverdue ? "text-red-600" : ""}`}>{appDueDate.toLocaleDateString("en-IN")}</p>
            <p className="text-[11px] text-slate-400 tabular-nums">{bill.vendor.paymentTermDays || 30} day terms</p>
          </div>
        </CardContent>
      </Card>

      {/* Payment History */}
      <h2 className="text-sm font-semibold text-slate-900 mb-2">Payments ({bill.payments.length})</h2>
      <div className="space-y-2">
        {bill.payments.map((p) => (
          <Card key={p.id} className="mb-2">
            <CardContent className="p-3 flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-green-700 tabular-nums">
                  {formatCurrency(p.amount)}
                  {p.cdDiscountAmount && p.cdDiscountAmount > 0 && (
                    <span className="text-xs text-green-500 ml-1 tabular-nums">
                      + {formatCurrency(p.cdDiscountAmount)} CD
                    </span>
                  )}
                </p>
                <p className="text-xs text-slate-500 tabular-nums">
                  {p.paymentMode} | {new Date(p.paymentDate).toLocaleDateString("en-IN")}
                  {p.referenceNo ? ` | Ref: ${p.referenceNo}` : ""}
                </p>
              </div>
            </CardContent>
          </Card>
        ))}
        {bill.payments.length === 0 && (
          <p className="text-sm text-slate-400 text-center py-4">No payments recorded</p>
        )}
      </div>
    </div>
  );
}
