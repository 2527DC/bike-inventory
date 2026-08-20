"use client";

import { useState, useEffect, useCallback, use } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { ArrowLeft, Phone, MessageSquare, FileText, CreditCard, Building2, AlertCircle, Check, Loader2, Power, Trash2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SkeletonList } from "@/components/ui/skeleton";
import type { Vendor, PurchaseOrder, VendorBill, VendorCredit } from "@/types";
import { usePermissions } from "@/lib/use-permissions";

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount);
}

type VendorDetail = Vendor & {
  purchaseOrders: PurchaseOrder[];
  bills: (VendorBill & { payments: Array<{ amount: number }> })[];
  credits: VendorCredit[];
  _count?: { issues: number };
};

export default function VendorDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: session } = useSession();
  const role = (session?.user as { role?: string })?.role || "";
  const { canEdit: canEditCheck } = usePermissions();
  const canEditBalance = canEditCheck("vendors");
  const [vendor, setVendor] = useState<VendorDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"overview" | "pos" | "bills" | "credits" | "issues" | "ledger">("overview");
  const [ledger, setLedger] = useState<{ openingBalance: number; currentBalance: number; entries: Array<{ id: string; date: string; type: string; description: string; debit: number; credit: number; balance: number }> } | null>(null);
  const [ledgerLoading, setLedgerLoading] = useState(false);
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

  // Add-contact form (name + number) for the brand.
  const [showAddContact, setShowAddContact] = useState(false);
  const [contactName, setContactName] = useState("");
  const [contactNumber, setContactNumber] = useState("");
  const [contactPrimary, setContactPrimary] = useState(true);
  const [savingContact, setSavingContact] = useState(false);

  async function addContact() {
    if (!contactName.trim() || !contactNumber.trim()) return;
    setSavingContact(true);
    setActionError("");
    try {
      const num = contactNumber.trim();
      const res = await fetch(`/api/vendors/${id}/contacts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Save the one number to both fields so it works for WhatsApp (wa.me) and tel: calls.
        body: JSON.stringify({ name: contactName.trim(), phone: num, whatsapp: num, isPrimary: contactPrimary }),
      });
      const data = await res.json();
      if (data.success) {
        setContactName(""); setContactNumber(""); setContactPrimary(false); setShowAddContact(false);
        loadVendor();
      } else {
        setActionError(data.error || "Failed to add contact");
      }
    } catch { setActionError("Network error"); }
    finally { setSavingContact(false); }
  }

  async function deleteContact(contactId: string) {
    if (!confirm("Remove this contact?")) return;
    try {
      const res = await fetch(`/api/vendors/${id}/contacts/${contactId}`, { method: "DELETE" }).then((r) => r.json());
      if (res.success) loadVendor();
      else setActionError(res.error || "Failed to remove contact");
    } catch { setActionError("Network error"); }
  }

  const loadVendor = useCallback(() => {
    fetch(`/api/vendors/${id}`)
      .then((r) => r.json())
      .then((res) => { if (res.success) setVendor(res.data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { loadVendor(); }, [loadVendor]);

  // Load ledger when tab is selected
  useEffect(() => {
    if (tab === "ledger" && !ledger) {
      setLedgerLoading(true);
      fetch(`/api/vendors/${id}/ledger`)
        .then(r => r.json())
        .then(res => { if (res.success) setLedger(res.data); })
        .catch(() => {})
        .finally(() => setLedgerLoading(false));
    }
  }, [tab, id, ledger]);

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

  const totalOutstanding = vendor.bills
    .filter((b) => b.status !== "PAID")
    .reduce((sum, b) => sum + (b.amount - b.paidAmount), 0);

  const issueCount = vendor._count?.issues ?? 0;

  const tabs = [
    { key: "overview", label: "Overview" },
    { key: "pos", label: `POs (${vendor.purchaseOrders.length})` },
    { key: "bills", label: `Bills (${vendor.bills.length})` },
    { key: "credits", label: `Credits (${vendor.credits.length})` },
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
              const res = await fetch(`/api/vendors/${id}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ isActive: newStatus }),
              }).then(r => r.json());
              if (res.success) setVendor({ ...vendor, isActive: newStatus });
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
      </div>

      {/* Outstanding Card */}
      {totalOutstanding > 0 && (
        <Card className="bg-red-50 border-red-200 mb-4">
          <CardContent className="p-3 flex items-center justify-between">
            <span className="text-sm font-medium text-red-700">Outstanding</span>
            <span className="text-lg font-bold text-red-700 tabular-nums">{formatCurrency(totalOutstanding)}</span>
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
                        const res = await fetch(`/api/vendors/${id}`, {
                          method: "PUT",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ openingBalance: parseFloat(balanceValue) || 0 }),
                        }).then(r => r.json());
                        if (res.success) {
                          setVendor({ ...vendor, openingBalance: parseFloat(balanceValue) || 0 });
                          setEditingBalance(false);
                        }
                      } catch (e) { setActionError(e instanceof Error ? e.message : "Save balance failed"); } finally { setSavingBalance(false); }
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
                        const res = await fetch(`/api/vendors/${id}`, {
                          method: "PUT",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ paymentTermDays: val }),
                        }).then(r => r.json());
                        if (res.success) {
                          setVendor({ ...vendor, paymentTermDays: val });
                          setEditingTerms(false);
                        }
                      } catch (e) { setActionError(e instanceof Error ? e.message : "Save terms failed"); } finally { setSavingTerms(false); }
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
                      const res = await fetch(`/api/vendors/${id}`, {
                        method: "PUT",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          cdPercentage: parseFloat(cdPctValue) || 0,
                          cdTermsDays: parseInt(cdDaysValue) || 0,
                        }),
                      }).then(r => r.json());
                      if (res.success) { loadVendor(); setEditingCd(false); }
                    } catch (e) { setActionError(e instanceof Error ? e.message : "Save cash discount failed"); } finally { setSavingCd(false); }
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
          {/* Contacts — name + number for the brand. The primary contact is who the issue
              "Share on WhatsApp" button messages. */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs text-slate-500">Contacts</p>
              {canEditBalance && !showAddContact && (
                <button onClick={() => setShowAddContact(true)} className="text-xs font-medium text-blue-600 hover:underline">
                  + Add contact
                </button>
              )}
            </div>

            {vendor.contacts && vendor.contacts.length > 0 ? (
              vendor.contacts.map((c) => {
                const num = c.whatsapp || c.phone;
                return (
                  <div key={c.id} className="flex items-center gap-2 py-1">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-sm text-slate-700">{c.name}</span>
                        {c.designation && <span className="text-xs text-slate-400">({c.designation})</span>}
                        {c.isPrimary && <Badge variant="info">Primary</Badge>}
                      </div>
                      {num && <span className="text-xs text-slate-500">{num}</span>}
                    </div>
                    {num && (
                      <a href={`https://wa.me/91${num.replace(/\D/g, "").slice(-10)}`} target="_blank" rel="noopener noreferrer"
                        className="p-1.5 text-green-600 hover:bg-green-50 rounded-full" title="WhatsApp">
                        <MessageSquare className="h-4 w-4" />
                      </a>
                    )}
                    {canEditBalance && (
                      <button onClick={() => deleteContact(c.id)} className="p-1.5 text-slate-300 hover:text-red-500 rounded-full" title="Remove">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                );
              })
            ) : (
              !showAddContact && <p className="text-xs text-slate-400">No contacts yet.</p>
            )}

            {showAddContact && (
              <div className="mt-2 space-y-2 bg-slate-50 rounded-lg p-2.5">
                <input value={contactName} onChange={(e) => setContactName(e.target.value)}
                  placeholder="Contact person name"
                  className="flex h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900" />
                <input value={contactNumber} onChange={(e) => setContactNumber(e.target.value)}
                  type="tel" inputMode="tel" placeholder="Mobile number (WhatsApp)"
                  className="flex h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900" />
                <label className="flex items-center gap-2 text-xs text-slate-600">
                  <input type="checkbox" checked={contactPrimary} onChange={(e) => setContactPrimary(e.target.checked)} />
                  Make this the primary contact (messaged from issues)
                </label>
                <div className="flex gap-2">
                  <Button size="sm" onClick={addContact} disabled={savingContact || !contactName.trim() || !contactNumber.trim()} className="flex-1">
                    {savingContact ? "Saving…" : "Save Contact"}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => { setShowAddContact(false); setContactName(""); setContactNumber(""); }}>
                    Cancel
                  </Button>
                </div>
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
          {vendor.bills.map((bill) => {
            const remaining = bill.amount - bill.paidAmount;
            // Calculate due date from billDate + vendor's payment terms (app controls overdue)
            const appDueDate = new Date(bill.billDate);
            appDueDate.setDate(appDueDate.getDate() + (vendor.paymentTermDays || 30));
            const isOverdue = appDueDate < new Date() && remaining > 0;
            return (
              <Link key={bill.id} href={`/bills/${bill.id}`}>
                <Card className={`hover:border-slate-300 mb-2 ${isOverdue ? "border-red-200" : ""}`}>
                  <CardContent className="p-3 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-slate-900 tabular-nums">{bill.billNo}</p>
                      <p className="text-xs text-slate-500 tabular-nums">
                        {new Date(bill.billDate).toLocaleDateString("en-IN")} · Due: {appDueDate.toLocaleDateString("en-IN")}
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

      {/* Credits Tab */}
      {tab === "credits" && (
        <div className="space-y-2">
          {vendor.credits.map((credit) => (
            <Card key={credit.id} className="mb-2">
              <CardContent className="p-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-900 tabular-nums">{credit.creditNoteNo}</p>
                  <p className="text-xs text-slate-500 tabular-nums">{new Date(credit.creditDate).toLocaleDateString("en-IN")}</p>
                  {credit.reason && <p className="text-xs text-slate-400 mt-0.5">{credit.reason}</p>}
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold text-slate-900 tabular-nums">{formatCurrency(credit.amount)}</p>
                  <p className="text-xs text-slate-500 tabular-nums">Used: {formatCurrency(credit.usedAmount)}</p>
                </div>
              </CardContent>
            </Card>
          ))}
          {vendor.credits.length === 0 && <p className="text-sm text-slate-400 text-center py-4">No credit notes</p>}
        </div>
      )}

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

      {/* Ledger Tab */}
      {tab === "ledger" && (
        <div>
          {ledgerLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
            </div>
          ) : ledger ? (
            <>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-[11px] text-slate-500">Opening Balance</p>
                  <p className="text-sm font-medium text-slate-700 tabular-nums">{formatCurrency(ledger.openingBalance)}</p>
                </div>
                <div className="text-right">
                  <p className="text-[11px] text-slate-500">Current Balance</p>
                  <p className={`text-sm font-bold tabular-nums ${ledger.currentBalance > 0 ? "text-red-600" : "text-green-600"}`}>
                    {formatCurrency(ledger.currentBalance)}
                  </p>
                </div>
              </div>
              <div className="border rounded-lg overflow-hidden">
                <div className="grid grid-cols-12 gap-0 bg-slate-100 px-2 py-1.5 text-[11px] font-semibold text-slate-600">
                  <div className="col-span-3">Date</div>
                  <div className="col-span-4">Description</div>
                  <div className="col-span-2 text-right">Debit</div>
                  <div className="col-span-3 text-right">Balance</div>
                </div>
                {ledger.entries.map((entry) => (
                  <div key={entry.id} className={`grid grid-cols-12 gap-0 px-2 py-2 border-t border-slate-100 text-xs ${entry.type === "PAYMENT" ? "bg-green-50/50" : ""}`}>
                    <div className="col-span-3 text-slate-500 tabular-nums">{new Date(entry.date).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}</div>
                    <div className="col-span-4 text-slate-900 truncate">{entry.description}</div>
                    <div className="col-span-2 text-right tabular-nums">
                      {entry.type === "BILL" ? (
                        <span className="text-red-600">{formatCurrency(entry.debit)}</span>
                      ) : (
                        <span className="text-green-600">-{formatCurrency(entry.credit)}</span>
                      )}
                    </div>
                    <div className="col-span-3 text-right font-medium tabular-nums">{formatCurrency(entry.balance)}</div>
                  </div>
                ))}
                {ledger.entries.length === 0 && (
                  <p className="text-sm text-slate-400 text-center py-4">No transactions</p>
                )}
              </div>
            </>
          ) : (
            <p className="text-sm text-slate-400 text-center py-8">Could not load ledger</p>
          )}
        </div>
      )}
    </div>
  );
}
