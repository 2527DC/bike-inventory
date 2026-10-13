"use client";

import { useState, useEffect, useCallback, use } from "react";
import Link from "next/link";
import { ArrowLeft, Phone, MessageSquare, AlertCircle, Check, Loader2, Power, BookOpen } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SkeletonList } from "@/components/ui/skeleton";
import type { Vendor, PurchaseOrder, VendorBill } from "@/types";
import { usePermissions } from "@/lib/use-permissions";
import { apiFetch } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";
import { VendorBrands } from "./_components/vendor-brands";
import { VendorContact } from "./_components/vendor-contact";
import { VendorCredits } from "./_components/vendor-credits";
import { VendorLedgerTab } from "./_components/vendor-ledger-tab";

const log = createLogger("vendors:detail");

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount);
}

type VendorDetail = Vendor & {
  purchaseOrders: PurchaseOrder[];
  /** The first 10 by due date — `_count.bills` is the real count. */
  bills: (VendorBill & { payments: Array<{ amount: number }> })[];
  /** What we owe this supplier over all history, from the ledger (plan 1210 Part 6, X9). */
  balance: number;
  _count?: { issues: number; credits: number; bills: number };
  /** Zoho's vendor id. Written only by the Zoho bill import; read-only here, never sent on PUT. */
  zohoVendorId?: string | null;
};

export default function VendorDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { canEdit: canEditCheck, canView } = usePermissions();
  const canEditBalance = canEditCheck("vendors");
  // The brand ledger (the ledger app's per-vendor screen at /ledger/[id]) has no sidebar entry
  // on purpose — this button is the only way in. Cosmetic gate; the API re-checks.
  const canOpenLedger = canView("brand_ledger");
  const [vendor, setVendor] = useState<VendorDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"overview" | "pos" | "bills" | "credits" | "issues" | "ledger">("overview");
  const [editingBalance, setEditingBalance] = useState(false);
  const [balanceValue, setBalanceValue] = useState("");
  const [savingBalance, setSavingBalance] = useState(false);
  const [editingTerms, setEditingTerms] = useState(false);
  const [termsValue, setTermsValue] = useState("");
  const [savingTerms, setSavingTerms] = useState(false);
  const [editingCd, setEditingCd] = useState(false);
  const [cdDaysValue, setCdDaysValue] = useState("");
  const [cdPctValue, setCdPctValue] = useState("");
  const [savingCd, setSavingCd] = useState(false);
  const [actionError, setActionError] = useState("");

  // The vendor's one contact (person, designation, phone, email, WhatsApp) is edited by
  // <VendorContact> below and saved on the Vendor row (plan 2109 R28). The VendorContact list
  // and its add / delete calls to /api/vendors/[id]/contacts were removed.

  const loadVendor = useCallback(() => {
    apiFetch<VendorDetail>(`/api/vendors/${id}`)
      .then((res) => setVendor(res))
      .catch((e) => log.warn("vendor failed to load", { vendorId: id, error: e instanceof Error ? e.message : String(e) }))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { loadVendor(); }, [loadVendor]);

  // Refetch when tab becomes visible (another user may have updated)
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") loadVendor(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [loadVendor]);

  if (loading) {
    return (
      <div className="py-2">
        <SkeletonList count={5} type="card" />
      </div>
    );
  }

  if (!vendor) {
    return (
      <div className="text-center py-12">
        <p className="text-sm text-slate-400">Vendor not found</p>
        <Link href="/vendors" className="text-sm text-blue-600 hover:underline mt-2 inline-block">
          Back to Vendors
        </Link>
      </div>
    );
  }

  const whatsappLink = vendor.whatsappNumber
    ? `https://wa.me/91${vendor.whatsappNumber.replace(/\D/g, "").slice(-10)}`
    : null;

  // The ledger balance over ALL history (opening + bills − payments − CD − credit notes +
  // refunds), computed by the API with vendorBalance() — not a sum of the 10 bills on this page.
  const balance = vendor.balance ?? 0;
  // A bill due today is not overdue yet; one due yesterday is.
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const issueCount = vendor._count?.issues ?? 0;
  const billCount = vendor._count?.bills ?? vendor.bills.length;
  const creditCount = vendor._count?.credits ?? 0;

  const tabs = [
    { key: "overview", label: "Overview" },
    { key: "pos", label: `POs (${vendor.purchaseOrders.length})` },
    { key: "bills", label: `Bills (${billCount})` },
    { key: "credits", label: `Credits (${creditCount})` },
    { key: "issues", label: `Issues (${issueCount})` },
    { key: "ledger", label: "Ledger" },
  ] as const;

  return (
    <div>
      {actionError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-2.5 mb-3 text-xs text-red-700">
          {actionError}
          <button onClick={() => setActionError("")} className="ml-2 underline">dismiss</button>
        </div>
      )}

      <div className="flex items-center gap-3 mb-4">
        <Link href="/vendors" className="p-2 -ml-2 rounded-lg hover:bg-slate-100 focus-ring" aria-label="Back">
          <ArrowLeft className="h-5 w-5 text-slate-600" />
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-bold text-slate-900 truncate">{vendor.name}</h1>
          <p className="text-xs text-slate-500 tabular-nums truncate">{vendor.code}</p>
        </div>
        {canEditBalance ? (
          <button
            onClick={async () => {
              const newStatus = !vendor.isActive;
              if (!confirm(`Mark this vendor as ${newStatus ? "Active" : "Inactive"}?`)) return;
              try {
                await apiFetch(`/api/vendors/${id}`, { method: "PUT", json: { isActive: newStatus } });
                setVendor({ ...vendor, isActive: newStatus });
              } catch (e) {
                log.warn("vendor status change failed", { vendorId: id, error: e instanceof Error ? e.message : String(e) });
                setActionError(e instanceof Error ? e.message : "Could not change vendor status");
              }
            }}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
              vendor.isActive
                ? "bg-green-100 text-green-700 hover:bg-green-200"
                : "bg-slate-100 text-slate-500 hover:bg-slate-200"
            }`}
          >
            <Power className="h-3 w-3" />
            {vendor.isActive ? "Active" : "Inactive"}
          </button>
        ) : (
          <Badge variant={vendor.isActive ? "success" : "default"}>
            {vendor.isActive ? "Active" : "Inactive"}
          </Badge>
        )}
      </div>

      {/* Contact Actions */}
      <div className="flex gap-2 mb-4">
        {vendor.phone && (
          <a href={`tel:${vendor.phone}`} className="flex-1">
            <Button variant="outline" size="sm" className="w-full">
              <Phone className="h-4 w-4 mr-1" /> Call
            </Button>
          </a>
        )}
        {whatsappLink && (
          <a href={whatsappLink} target="_blank" rel="noopener noreferrer" className="flex-1">
            <Button variant="outline" size="sm" className="w-full text-green-600 border-green-300">
              <MessageSquare className="h-4 w-4 mr-1" /> WhatsApp
            </Button>
          </a>
        )}
        {canOpenLedger && (
          <Link href={`/ledger/${id}`} className="flex-1">
            <Button variant="outline" size="sm" className="w-full">
              <BookOpen className="h-4 w-4 mr-1" /> Ledger
            </Button>
          </Link>
        )}
      </div>

      {/* Balance card — the ledger's closing figure (plan 1210 Part 6, X9) */}
      {Math.abs(balance) >= 1 && (
        <Card className={`mb-4 ${balance > 0 ? "bg-red-50 border-red-200" : "bg-green-50 border-green-200"}`}>
          <CardContent className="p-3 flex items-center justify-between">
            <span className={`text-sm font-medium ${balance > 0 ? "text-red-700" : "text-green-700"}`}>
              {balance > 0 ? "Balance we owe" : "Supplier owes us"}
              <span className="block text-[11px] font-normal text-slate-500">All bills, payments and credit notes, from the ledger</span>
            </span>
            <span className={`text-lg font-bold tabular-nums ${balance > 0 ? "text-red-700" : "text-green-700"}`}>
              {formatCurrency(Math.abs(balance))}
            </span>
          </CardContent>
        </Card>
      )}

      {/* Opening Balance (Apr 1, 2026) */}
      {canEditBalance && vendor && (
        <Card className="bg-slate-50 border-slate-200 mb-4">
          <CardContent className="p-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-slate-500">Opening Balance (Apr 1)</p>
                {!editingBalance ? (
                  <p className="text-sm font-bold text-slate-900 tabular-nums">
                    {formatCurrency(vendor.openingBalance || 0)}
                  </p>
                ) : (
                  <input
                    type="number"
                    value={balanceValue}
                    onChange={(e) => setBalanceValue(e.target.value)}
                    className="mt-1 w-32 px-2 py-1 text-sm font-bold border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-slate-400"
                    autoFocus
                    min="0"
                    step="0.01"
                  />
                )}
              </div>
              {!editingBalance ? (
                <button
                  onClick={() => { setBalanceValue(String(vendor.openingBalance || 0)); setEditingBalance(true); }}
                  className="text-xs text-blue-600 font-medium"
                >
                  Edit
                </button>
              ) : (
                <div className="flex gap-2">
                  <button
                    onClick={() => setEditingBalance(false)}
                    className="text-xs text-slate-500"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={async () => {
                      setSavingBalance(true);
                      try {
                        await apiFetch(`/api/vendors/${id}`, {
                          method: "PUT",
                          json: { openingBalance: parseFloat(balanceValue) || 0 },
                        });
                        setVendor({ ...vendor, openingBalance: parseFloat(balanceValue) || 0 });
                        setEditingBalance(false);
                      } catch (e) {
                        log.warn("save opening balance failed", { vendorId: id, error: e instanceof Error ? e.message : String(e) });
                        setActionError(e instanceof Error ? e.message : "Save balance failed");
                      } finally { setSavingBalance(false); }
                    }}
                    disabled={savingBalance}
                    className="flex items-center gap-1 bg-slate-900 text-white px-2.5 py-1 rounded-md text-xs font-medium disabled:opacity-50"
                  >
                    {savingBalance ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                    Save
                  </button>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-4 bg-slate-100 rounded-lg p-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 text-xs font-medium py-2 rounded-md transition-colors ${
              tab === t.key ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Overview Tab */}
      {tab === "overview" && (
        <div className="space-y-3">
          {vendor.addressLine1 && (
            <div>
              <p className="text-xs text-slate-500 mb-0.5">Address</p>
              <p className="text-sm text-slate-700">
                {vendor.addressLine1}{vendor.city ? `, ${vendor.city}` : ""}{vendor.state ? `, ${vendor.state}` : ""} {vendor.pincode || ""}
              </p>
            </div>
          )}
          {vendor.gstin && (
            <div>
              <p className="text-xs text-slate-500 mb-0.5">GSTIN</p>
              <p className="text-sm text-slate-700 font-mono">{vendor.gstin}</p>
            </div>
          )}
          {vendor.zohoVendorId && (
            <div>
              <p className="text-xs text-slate-500 mb-0.5">Zoho vendor id</p>
              <p className="text-sm text-slate-700 font-mono select-all">{vendor.zohoVendorId}</p>
            </div>
          )}

          <VendorContact
            vendorId={id}
            contact={vendor}
            canEdit={canEditBalance}
            onSaved={(patch) => setVendor(vendor ? { ...vendor, ...patch } : vendor)}
          />

          <VendorBrands
            vendorId={id}
            vendorName={vendor.name}
            initial={vendor.brands ?? []}
            canEdit={canEditBalance}
            onSaved={(brands) => setVendor(vendor ? { ...vendor, brands } : vendor)}
          />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs text-slate-500 mb-0.5">Payment Terms</p>
              {canEditBalance && editingTerms ? (
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={termsValue}
                    onChange={(e) => setTermsValue(e.target.value)}
                    className="w-16 px-2 py-1 text-sm font-medium border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-slate-400"
                    autoFocus
                    min="0"
                  />
                  <span className="text-xs text-slate-500">days</span>
                  <button
                    onClick={async () => {
                      setSavingTerms(true);
                      try {
                        const val = parseInt(termsValue) || 0;
                        await apiFetch(`/api/vendors/${id}`, { method: "PUT", json: { paymentTermDays: val } });
                        setVendor({ ...vendor, paymentTermDays: val });
                        setEditingTerms(false);
                      } catch (e) {
                        log.warn("save payment terms failed", { vendorId: id, error: e instanceof Error ? e.message : String(e) });
                        setActionError(e instanceof Error ? e.message : "Save terms failed");
                      } finally { setSavingTerms(false); }
                    }}
                    disabled={savingTerms}
                    className="p-1 bg-slate-900 text-white rounded-md disabled:opacity-50"
                  >
                    {savingTerms ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                  </button>
                  <button onClick={() => setEditingTerms(false)} className="text-xs text-slate-500">Cancel</button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <p className="text-sm text-slate-700 tabular-nums">{vendor.paymentTermDays} days</p>
                  {canEditBalance && (
                    <button
                      onClick={() => { setTermsValue(String(vendor.paymentTermDays)); setEditingTerms(true); }}
                      className="text-xs text-blue-600 font-medium"
                    >
                      Edit
                    </button>
                  )}
                </div>
              )}
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-0.5">Credit Limit</p>
              <p className="text-sm text-slate-700 tabular-nums">{formatCurrency(vendor.creditLimit)}</p>
            </div>
          </div>
          <div>
            <p className="text-xs text-slate-500 mb-0.5">Cash Discount</p>
            {editingCd ? (
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={cdPctValue}
                  onChange={(e) => setCdPctValue(e.target.value)}
                  placeholder="%"
                  className="w-16 px-2 py-1 text-sm border border-slate-300 rounded-md"
                />
                <span className="text-xs text-slate-400">% in</span>
                <input
                  type="number"
                  value={cdDaysValue}
                  onChange={(e) => setCdDaysValue(e.target.value)}
                  placeholder="days"
                  className="w-16 px-2 py-1 text-sm border border-slate-300 rounded-md"
                />
                <span className="text-xs text-slate-400">days</span>
                <button
                  onClick={async () => {
                    setSavingCd(true);
                    try {
                      await apiFetch(`/api/vendors/${id}`, {
                        method: "PUT",
                        json: {
                          cdPercentage: parseFloat(cdPctValue) || 0,
                          cdTermsDays: parseInt(cdDaysValue) || 0,
                        },
                      });
                      loadVendor(); setEditingCd(false);
                    } catch (e) {
                      log.warn("save cash discount failed", { vendorId: id, error: e instanceof Error ? e.message : String(e) });
                      setActionError(e instanceof Error ? e.message : "Save cash discount failed");
                    } finally { setSavingCd(false); }
                  }}
                  disabled={savingCd}
                  className="p-1 bg-slate-900 text-white rounded-md disabled:opacity-50"
                >
                  {savingCd ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                </button>
                <button onClick={() => setEditingCd(false)} className="text-xs text-slate-500">Cancel</button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                {vendor.cdPercentage && vendor.cdTermsDays ? (
                  <p className="text-sm text-slate-700 tabular-nums">{vendor.cdPercentage}% within {vendor.cdTermsDays} days</p>
                ) : (
                  <p className="text-sm text-slate-400">Not set</p>
                )}
                {canEditBalance && (
                  <button
                    onClick={() => {
                      setCdPctValue(String(vendor.cdPercentage || ""));
                      setCdDaysValue(String(vendor.cdTermsDays || ""));
                      setEditingCd(true);
                    }}
                    className="text-xs text-blue-600 font-medium"
                  >
                    Edit
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* POs Tab */}
      {tab === "pos" && (
        <div className="space-y-2">
          {vendor.purchaseOrders.map((po) => (
            <Link key={po.id} href={`/purchase-orders/${po.id}`}>
              <Card className="hover:border-slate-300 mb-2">
                <CardContent className="p-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-slate-900 tabular-nums">{po.poNumber}</p>
                    <p className="text-xs text-slate-500 tabular-nums">{new Date(po.orderDate).toLocaleDateString("en-IN")}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-slate-900 tabular-nums">{formatCurrency(po.grandTotal)}</p>
                    <Badge variant={po.status === "RECEIVED" ? "success" : po.status === "CANCELLED" ? "danger" : "warning"}>
                      {po.status.replace(/_/g, " ")}
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
          {vendor.purchaseOrders.length === 0 && <p className="text-sm text-slate-400 text-center py-4">No purchase orders</p>}
        </div>
      )}

      {/* Bills Tab */}
      {tab === "bills" && (
        <div className="space-y-2">
          {billCount > vendor.bills.length && (
            <p className="text-[11px] text-slate-500">
              Showing {vendor.bills.length} of {billCount} bills, earliest due date first. The Ledger tab lists every bill.
            </p>
          )}
          {vendor.bills.map((bill) => {
            const remaining = bill.amount - bill.paidAmount;
            // The bill's STORED due date (plan 1210 Q5): what the supplier's invoice says, or bill
            // date + the terms in force when it was imported. Changing the vendor's terms today
            // must not re-age old bills, so it is never recomputed here.
            const dueDate = new Date(bill.dueDate);
            const isOverdue = dueDate < startOfToday && remaining > 0.01 && bill.status !== "PAID";
            return (
              <Link key={bill.id} href={`/bills/${bill.id}`}>
                <Card className={`hover:border-slate-300 mb-2 ${isOverdue ? "border-red-200" : ""}`}>
                  <CardContent className="p-3 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-slate-900 tabular-nums">{bill.billNo}</p>
                      <p className="text-xs text-slate-500 tabular-nums">
                        {new Date(bill.billDate).toLocaleDateString("en-IN")} · Due: {dueDate.toLocaleDateString("en-IN")}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className={`text-sm font-bold tabular-nums ${remaining > 0 ? "text-red-600" : "text-green-600"}`}>
                        {formatCurrency(remaining)}
                      </p>
                      <Badge variant={bill.status === "PAID" ? "success" : isOverdue ? "danger" : "warning"}>
                        {isOverdue ? "OVERDUE" : bill.status.replace(/_/g, " ")}
                      </Badge>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
          {vendor.bills.length === 0 && <p className="text-sm text-slate-400 text-center py-4">No bills</p>}
        </div>
      )}

      {/* Credits Tab — every credit note, its applications and refunds (plan 1210 Part 4) */}
      {tab === "credits" && <VendorCredits vendorId={id} onChanged={loadVendor} />}

      {/* Issues Tab */}
      {tab === "issues" && (
        <div className="space-y-2">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-slate-500" />
              <p className="text-sm font-medium text-slate-700">
                {issueCount} issue{issueCount !== 1 ? "s" : ""} recorded
              </p>
            </div>
            <Link href={`/vendor-issues?vendorId=${vendor.id}`}>
              <Badge variant="info" className="cursor-pointer">View All</Badge>
            </Link>
          </div>
          <Link href={`/vendor-issues/new`}>
            <Card className="hover:border-slate-300 border-dashed">
              <CardContent className="p-3 text-center">
                <p className="text-sm text-blue-600 font-medium">+ Report New Issue</p>
              </CardContent>
            </Card>
          </Link>
        </div>
      )}

      {/* Ledger Tab — whole-history running balance, by store (plan 1210 Part 6) */}
      {tab === "ledger" && <VendorLedgerTab vendorId={id} />}
    </div>
  );
}
