"use client";

import { useState, useEffect, use } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Send, MessageSquare } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SkeletonList } from "@/components/ui/skeleton";

interface PODetail {
  id: string;
  poNumber: string;
  status: string;
  subtotal: number;
  gstTotal: number;
  grandTotal: number;
  orderDate: string;
  expectedDate?: string;
  notes?: string;
  vendor: { name: string; code: string; whatsappNumber?: string; phone?: string };
  items: Array<{
    id: string;
    quantity: number;
    receivedQty: number;
    unitPrice: number;
    gstRate: number;
    amount: number;
    product: { name: string; sku: string; currentStock: number };
  }>;
  createdBy: { name: string };
  approvedBy?: { name: string };
  approvedAt?: string;
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount);
}

export default function PurchaseOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [po, setPo] = useState<PODetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState("");

  useEffect(() => {
    fetch(`/api/purchase-orders/${id}`)
      .then((r) => r.json())
      .then((res) => { if (res.success) setPo(res.data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  async function handleApprove() {
    setActionLoading(true);
    try {
      const res = await fetch(`/api/purchase-orders/${id}/approve`, { method: "POST" });
      const data = await res.json();
      if (data.success) setPo((prev) => prev ? { ...prev, status: "APPROVED" } : prev);
    } catch (e) { setActionError(e instanceof Error ? e.message : "Approve failed"); }
    setActionLoading(false);
  }

  async function handleStatusChange(status: string) {
    setActionLoading(true);
    try {
      const res = await fetch(`/api/purchase-orders/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = await res.json();
      if (data.success) setPo((prev) => prev ? { ...prev, status } : prev);
    } catch (e) { setActionError(e instanceof Error ? e.message : "Status change failed"); }
    setActionLoading(false);
  }

  function getWhatsAppLink() {
    if (!po?.vendor.whatsappNumber) return null;
    const phone = `91${po.vendor.whatsappNumber.replace(/\D/g, "").slice(-10)}`;
    const itemsList = po.items.map((i) => `- ${i.product.name} (${i.product.sku}): ${i.quantity} pcs @ ${formatCurrency(i.unitPrice)}`).join("\n");
    const msg = encodeURIComponent(
      `*Purchase Order: ${po.poNumber}*\n\nDear ${po.vendor.name},\n\nPlease find our order below:\n\n${itemsList}\n\n*Total: ${formatCurrency(po.grandTotal)}*\n${po.expectedDate ? `Expected by: ${new Date(po.expectedDate).toLocaleDateString("en-IN")}` : ""}\n\nPlease confirm.`
    );
    return `https://wa.me/${phone}?text=${msg}`;
  }

  if (loading) {
    return (
      <div className="pt-2">
        <SkeletonList count={5} type="card" />
      </div>
    );
  }

  if (!po) return (
    <div className="text-center py-12">
      <p className="text-sm text-slate-400">PO not found</p>
      <Link href="/purchase-orders" className="text-sm text-blue-600 hover:underline mt-2 inline-block">
        Back to Purchase Orders
      </Link>
    </div>
  );

  const whatsappLink = getWhatsAppLink();

  return (
    <div>
      {actionError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-2.5 mb-3 text-xs text-red-700">
          {actionError}
          <button onClick={() => setActionError("")} className="ml-2 underline">dismiss</button>
        </div>
      )}

      <div className="flex items-center gap-3 mb-4">
        <Link href="/purchase-orders" className="p-2 -ml-2 rounded-lg hover:bg-slate-100 focus-ring" aria-label="Back">
          <ArrowLeft className="h-5 w-5 text-slate-600" />
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-bold text-slate-900 tabular-nums truncate">{po.poNumber}</h1>
          <p className="text-xs text-slate-500 tabular-nums truncate">{po.vendor.name} ({po.vendor.code})</p>
        </div>
        <Badge variant={po.status === "RECEIVED" ? "success" : po.status === "CANCELLED" ? "danger" : "warning"}>
          {po.status.replace(/_/g, " ")}
        </Badge>
      </div>

      {/* Action Buttons */}
      {((po.status === "DRAFT" || po.status === "PENDING_APPROVAL") || po.status === "APPROVED") && (
        <div className="flex gap-2 mb-4">
          {(po.status === "DRAFT" || po.status === "PENDING_APPROVAL") && (
            <Button onClick={handleApprove} disabled={actionLoading} className="flex-1 min-h-[48px] rounded-lg font-medium bg-green-600 text-white hover:bg-green-700">
              <Check className="h-4 w-4 mr-1.5" /> Approve
            </Button>
          )}
          {po.status === "APPROVED" && (
            <>
              <Button onClick={() => handleStatusChange("SENT_TO_VENDOR")} disabled={actionLoading} className="flex-1 min-h-[48px] rounded-lg font-medium">
                <Send className="h-4 w-4 mr-1.5" /> Mark Sent
              </Button>
              {whatsappLink && (
                <a href={whatsappLink} target="_blank" rel="noopener noreferrer" className="flex-1">
                  <Button variant="outline" className="w-full min-h-[48px] rounded-lg font-medium text-green-600 border-green-300">
                    <MessageSquare className="h-4 w-4 mr-1.5" /> Send via WA
                  </Button>
                </a>
              )}
            </>
          )}
        </div>
      )}

      {/* Order Info */}
      <Card className="mb-4">
        <CardContent className="p-3 space-y-2">
          <div className="grid grid-cols-2 gap-y-3 gap-x-2 text-sm">
            <div>
              <span className="text-[11px] text-slate-500">Order Date</span>
              <p className="font-semibold text-slate-900 tabular-nums">{new Date(po.orderDate).toLocaleDateString("en-IN")}</p>
            </div>
            {po.expectedDate && (
              <div>
                <span className="text-[11px] text-slate-500">Expected</span>
                <p className="font-semibold text-slate-900 tabular-nums">{new Date(po.expectedDate).toLocaleDateString("en-IN")}</p>
              </div>
            )}
            <div>
              <span className="text-[11px] text-slate-500">Created By</span>
              <p className="font-semibold text-slate-900">{po.createdBy.name}</p>
            </div>
            {po.approvedBy && (
              <div>
                <span className="text-[11px] text-slate-500">Approved By</span>
                <p className="font-semibold text-slate-900">{po.approvedBy.name}</p>
              </div>
            )}
          </div>
          {po.notes && <p className="text-xs text-slate-500 border-t pt-2">{po.notes}</p>}
        </CardContent>
      </Card>

      {/* Items */}
      <h2 className="text-sm font-semibold text-slate-900 mb-2">Items</h2>
      <div className="space-y-2 mb-4">
        {po.items.map((item) => (
          <Card key={item.id}>
            <CardContent className="p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-900">{item.product.name}</p>
                  <p className="text-xs text-slate-500 tabular-nums">{item.product.sku} | Stock: {item.product.currentStock}</p>
                </div>
                <p className="text-sm font-bold text-slate-900 tabular-nums shrink-0">{formatCurrency(item.amount * (1 + item.gstRate / 100))}</p>
              </div>
              <div className="flex gap-4 mt-1 text-xs text-slate-500 tabular-nums">
                <span>Qty: {item.quantity}</span>
                <span>Rcvd: {item.receivedQty}</span>
                <span>@ {formatCurrency(item.unitPrice)}</span>
                <span>GST: {item.gstRate}%</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Totals */}
      <Card className="bg-slate-50">
        <CardContent className="p-3 space-y-1">
          <div className="flex justify-between text-sm">
            <span className="text-slate-500">Subtotal</span>
            <span className="tabular-nums">{formatCurrency(po.subtotal)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-slate-500">GST</span>
            <span className="tabular-nums">{formatCurrency(po.gstTotal)}</span>
          </div>
          <div className="flex justify-between text-sm font-bold border-t pt-1">
            <span>Grand Total</span>
            <span className="tabular-nums">{formatCurrency(po.grandTotal)}</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
