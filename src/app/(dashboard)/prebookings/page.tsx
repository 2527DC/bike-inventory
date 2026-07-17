"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { Loader2, UserCheck, Phone, Plus, Search, Zap, Link2, X, Truck, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SkeletonList } from "@/components/ui/skeleton";
import { FilterSheet } from "@/components/filter-sheet";
import { DesktopTable } from "@/components/desktop-table";
import { usePermissions } from "@/lib/use-permissions";

interface PreBooking {
  id: string;
  customerName: string;
  customerPhone: string | null;
  zohoInvoiceNo: string;
  productName: string;
  salesPerson: string | null;
  status: string;
  expectedDate: string | null;
  fulfilledAt: string | null;
  createdAt: string;
  brand: { name: string } | null;
  createdBy: { name: string };
  matchedShipment: { id: string; shipmentNo: string; expectedDeliveryDate: string; status: string } | null;
}

interface AvailableItem {
  id: string;
  productName: string;
  quantity: number;
  shipment: {
    id: string;
    shipmentNo: string;
    expectedDeliveryDate: string;
    brand: { name: string };
  };
}

type StatusFilter = "ALL" | "WAITING" | "MATCHED" | "FULFILLED" | "CANCELLED";

const STATUS_BADGE: Record<string, { variant: "warning" | "info" | "success" | "default"; label: string }> = {
  WAITING: { variant: "warning", label: "Waiting" },
  MATCHED: { variant: "info", label: "Matched" },
  FULFILLED: { variant: "success", label: "Fulfilled" },
  CANCELLED: { variant: "default", label: "Cancelled" },
};

function daysAgo(dateStr: string) {
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24));
  if (diff === 0) return "Today";
  if (diff === 1) return "1 day ago";
  return `${diff} days ago`;
}

function agingColor(dateStr: string) {
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24));
  if (diff >= 15) return "text-red-600 bg-red-50";
  if (diff >= 7) return "text-amber-600 bg-amber-50";
  if (diff >= 3) return "text-blue-600 bg-blue-50";
  return "text-slate-500 bg-slate-50";
}

export default function PreBookingsPage() {
  const { data: session } = useSession();
  const role = (session?.user as { role?: string })?.role || "";
  const { canCreate: canCreateCheck, canApprove: canApproveCheck } = usePermissions(role);
  const canCreate = canCreateCheck("deliveries");
  const canMatch = canApproveCheck("deliveries");

  const [preBookings, setPreBookings] = useState<PreBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<StatusFilter>("WAITING");

  // Create form
  const [showForm, setShowForm] = useState(false);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [zohoInvoiceNo, setZohoInvoiceNo] = useState("");
  const [productName, setProductName] = useState("");
  const [salesPerson, setSalesPerson] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const [actionError, setActionError] = useState("");

  // Zoho search
  const [searching, setSearching] = useState(false);

  // Auto match
  const [autoMatching, setAutoMatching] = useState(false);
  const [matchResult, setMatchResult] = useState<string | null>(null);

  // Manual match
  const [manualMatchPb, setManualMatchPb] = useState<PreBooking | null>(null);
  const [availableItems, setAvailableItems] = useState<AvailableItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [matchingItem, setMatchingItem] = useState<string | null>(null);
  const [itemSearch, setItemSearch] = useState("");

  const fetchData = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({ limit: "100" });
    if (filter !== "ALL") params.set("status", filter);

    fetch(`/api/prebookings?${params}`)
      .then((r) => r.json())
      .then((res) => { if (res.success) setPreBookings(res.data.preBookings || []); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [filter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleSearchZoho = async () => {
    if (!zohoInvoiceNo.trim()) return;
    setSearching(true);
    setError("");
    try {
      const res = await fetch("/api/deliveries/search-zoho", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: zohoInvoiceNo.trim() }),
      }).then((r) => r.json());

      if (res.success && res.data.results?.length > 0) {
        const inv = res.data.results[0];
        setCustomerName(inv.customerName || "");
        setCustomerPhone(inv.phone || "");
        if (inv.salesPerson || inv.salesperson_name) setSalesPerson(inv.salesPerson || inv.salesperson_name || "");
        if (inv.lineItems?.length > 0) {
          setProductName(inv.lineItems[0].name || "");
        }
      } else {
        setError("Invoice not found. Enter details manually.");
      }
    } catch {
      setError("Search failed. Enter details manually.");
    } finally {
      setSearching(false);
    }
  };

  const handleCreate = async () => {
    if (!customerName || !zohoInvoiceNo || !productName) {
      setError("Customer name, invoice no, and product name are required");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/prebookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerName,
          customerPhone: customerPhone || undefined,
          zohoInvoiceNo,
          productName,
          salesPerson: salesPerson || undefined,
        }),
      }).then((r) => r.json());

      if (res.success) {
        setShowForm(false);
        setCustomerName("");
        setCustomerPhone("");
        setZohoInvoiceNo("");
        setProductName("");
        setSalesPerson("");
        fetchData();
      } else {
        setError(res.error || "Failed");
      }
    } catch {
      setError("Network error");
    } finally {
      setSubmitting(false);
    }
  };

  const handleAutoMatch = async () => {
    setAutoMatching(true);
    setMatchResult(null);
    try {
      const res = await fetch("/api/prebookings/match", { method: "POST" }).then((r) => r.json());
      if (res.success) {
        setMatchResult(`Matched ${res.data.matched} of ${res.data.total} waiting pre-bookings`);
        fetchData();
      } else {
        setMatchResult(res.error || "Auto-match failed");
      }
    } catch {
      setMatchResult("Network error");
    } finally {
      setAutoMatching(false);
    }
  };

  const openManualMatch = async (pb: PreBooking) => {
    setManualMatchPb(pb);
    setLoadingItems(true);
    setItemSearch("");
    try {
      const res = await fetch("/api/prebookings/available-items").then((r) => r.json());
      if (res.success) setAvailableItems(res.data || []);
    } catch (e) { setActionError(e instanceof Error ? e.message : "Failed to load items"); }
    finally { setLoadingItems(false); }
  };

  const handleManualMatch = async (lineItemId: string) => {
    if (!manualMatchPb) return;
    setMatchingItem(lineItemId);
    try {
      const res = await fetch(`/api/prebookings/${manualMatchPb.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchLineItemId: lineItemId }),
      }).then((r) => r.json());
      if (res.success) {
        setManualMatchPb(null);
        fetchData();
      } else {
        setActionError(res.error || "Match failed");
      }
    } catch {
      setActionError("Network error");
    } finally {
      setMatchingItem(null);
    }
  };

  const filteredItems = itemSearch
    ? availableItems.filter((it) =>
        it.productName.toLowerCase().includes(itemSearch.toLowerCase()) ||
        it.shipment.brand.name.toLowerCase().includes(itemSearch.toLowerCase()) ||
        it.shipment.shipmentNo.toLowerCase().includes(itemSearch.toLowerCase())
      )
    : availableItems;

  const waitingCount = preBookings.filter((pb) => pb.status === "WAITING").length;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900">Pre-Bookings</h1>
          <p className="text-xs text-slate-500">Customer cycle reservations</p>
        </div>
        <div className="flex gap-2">
          {canMatch && filter === "WAITING" && waitingCount > 0 && (
            <Button size="sm" variant="outline" onClick={handleAutoMatch} disabled={autoMatching}
              className="text-amber-700 border-amber-200 hover:bg-amber-50">
              {autoMatching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4 mr-1" />}
              Auto Match
            </Button>
          )}
          {canCreate && !showForm && (
            <Button size="sm" onClick={() => setShowForm(true)} className="bg-purple-600 hover:bg-purple-700">
              <Plus className="h-4 w-4 mr-1" /> New
            </Button>
          )}
        </div>
      </div>

      {actionError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-2.5 mb-3 text-xs text-red-700">
          {actionError}
          <button onClick={() => setActionError("")} className="ml-2 underline">dismiss</button>
        </div>
      )}

      {matchResult && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-2 mb-3">
          <p className="text-xs text-blue-700">{matchResult}</p>
        </div>
      )}

      {/* Create Form */}
      {showForm && (
        <Card className="mb-3 border-purple-200 bg-purple-50/50">
          <CardContent className="p-3 space-y-3">
            <p className="text-xs font-semibold text-purple-800">New Pre-Booking</p>

            <div>
              <label className="block text-xs text-slate-600 mb-0.5">Zoho Invoice No *</label>
              <div className="flex gap-2">
                <Input value={zohoInvoiceNo} onChange={(e) => setZohoInvoiceNo(e.target.value)}
                  placeholder="e.g. 017616" onKeyDown={(e) => e.key === "Enter" && handleSearchZoho()} />
                <Button variant="outline" onClick={handleSearchZoho} disabled={searching} className="shrink-0">
                  {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                </Button>
              </div>
              <p className="text-[10px] text-slate-400 mt-0.5">Search to auto-fill from Zoho</p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-600 mb-0.5">Customer *</label>
                <Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Name" />
              </div>
              <div>
                <label className="block text-xs text-slate-600 mb-0.5">Phone</label>
                <Input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} placeholder="Phone" />
              </div>
            </div>

            <div>
              <label className="block text-xs text-slate-600 mb-0.5">Sales Person</label>
              <Input value={salesPerson} onChange={(e) => setSalesPerson(e.target.value)} placeholder="Auto-filled from Zoho" />
            </div>

            <div>
              <label className="block text-xs text-slate-600 mb-0.5">Product Name *</label>
              <Input value={productName} onChange={(e) => setProductName(e.target.value)}
                placeholder='e.g. "Hero Sprint 26" or "Firefox Road 700c"' />
            </div>

            {error && <p className="text-xs text-red-600">{error}</p>}

            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setShowForm(false)} className="flex-1">Cancel</Button>
              <Button onClick={handleCreate} disabled={submitting || !customerName || !zohoInvoiceNo || !productName}
                className="flex-1 bg-purple-600 hover:bg-purple-700">
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filter */}
      <FilterSheet
        className="mb-3"
        groups={[{
          label: "Status",
          value: filter,
          defaultValue: "ALL",
          options: [
            { key: "WAITING", label: STATUS_BADGE.WAITING.label },
            { key: "MATCHED", label: STATUS_BADGE.MATCHED.label },
            { key: "FULFILLED", label: STATUS_BADGE.FULFILLED.label },
            { key: "ALL", label: "All" },
          ],
          onChange: (key) => setFilter(key as StatusFilter),
        }]}
      />

      {/* List */}
      {loading ? (
        <SkeletonList count={6} type="card" />
      ) : preBookings.length === 0 ? (
        <div className="text-center py-12">
          <UserCheck className="h-10 w-10 text-slate-300 mx-auto mb-3" />
          <p className="text-sm text-slate-400">No pre-bookings found</p>
        </div>
      ) : (
        <>
        <DesktopTable
          className="hidden lg:block"
          rows={preBookings}
          rowKey={(pb) => pb.id}
          emptyText="No pre-bookings found"
          columns={[
            { header: "Customer", cell: (pb) => (
              <div>
                <p className="font-medium text-slate-900">{pb.customerName}</p>
                {pb.salesPerson && <p className="text-[11px] text-slate-400">Sales: {pb.salesPerson}</p>}
              </div>
            ) },
            { header: "Product", cell: (pb) => (
              <div>
                <p className="text-slate-700">{pb.productName}</p>
                {pb.brand && <p className="text-[11px] text-slate-400">{pb.brand.name}</p>}
              </div>
            ) },
            { header: "Invoice", cell: (pb) => <span className="text-slate-500">{pb.zohoInvoiceNo}</span> },
            { header: "Age", cell: (pb) => (pb.status !== "FULFILLED" && pb.status !== "CANCELLED")
              ? <span className={`inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded-full ${agingColor(pb.createdAt)}`}><Clock className="h-2.5 w-2.5" />{daysAgo(pb.createdAt)}</span>
              : <span className="text-slate-400">—</span>, className: "whitespace-nowrap" },
            { header: "Status", cell: (pb) => {
              const badge = STATUS_BADGE[pb.status] || { variant: "default" as const, label: pb.status };
              return <Badge variant={badge.variant}>{badge.label}</Badge>;
            } },
            { header: "", className: "text-right", cell: (pb) => (
              <div className="flex items-center justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                {pb.matchedShipment && (
                  <Link href={`/inbound/${pb.matchedShipment.id}`} className="inline-flex items-center gap-1 text-xs text-blue-700 hover:underline">
                    <Truck className="h-3.5 w-3.5" /> {pb.matchedShipment.shipmentNo}
                  </Link>
                )}
                {pb.status === "WAITING" && canMatch && (
                  <button onClick={() => openManualMatch(pb)} className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-amber-50 text-amber-700 text-xs font-medium border border-amber-200 hover:bg-amber-100">
                    <Link2 className="h-3.5 w-3.5" /> Match
                  </button>
                )}
                {pb.customerPhone && (
                  <a href={`https://wa.me/91${pb.customerPhone.replace(/\D/g, "").slice(-10)}`} target="_blank" rel="noopener noreferrer" className="inline-flex p-1.5 rounded-full hover:bg-green-50">
                    <Phone className="h-3.5 w-3.5 text-green-600" />
                  </a>
                )}
              </div>
            ) },
          ]}
        />
        <div className="space-y-2 lg:hidden">
          {preBookings.map((pb) => {
            const badge = STATUS_BADGE[pb.status] || { variant: "default" as const, label: pb.status };
            const active = pb.status !== "FULFILLED" && pb.status !== "CANCELLED";
            const ageDays = Math.floor((Date.now() - new Date(pb.createdAt).getTime()) / 86400000);
            const accent = pb.status === "WAITING" && ageDays >= 15
              ? "border-l-red-500"
              : pb.status === "WAITING"
              ? "border-l-amber-400"
              : pb.status === "MATCHED"
              ? "border-l-blue-400"
              : pb.status === "FULFILLED"
              ? "border-l-green-500"
              : "border-l-slate-200";
            return (
              <div key={pb.id} className={`rounded-xl border border-slate-200 border-l-4 ${accent} bg-white shadow-sm`}>
                <div className="p-3">
                  <div className="flex items-start justify-between mb-1">
                    <div className="flex-1 min-w-0 mr-2">
                      <p className="text-sm font-semibold text-slate-900 truncate">{pb.customerName}</p>
                      <p className="text-xs text-slate-500">{pb.productName}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <Badge variant={badge.variant}>{badge.label}</Badge>
                      {active && (
                        <span className={`inline-flex items-center gap-0.5 text-[11px] font-medium px-1.5 py-0.5 rounded-full tabular-nums ${agingColor(pb.createdAt)}`}>
                          <Clock className="h-2.5 w-2.5" /> {daysAgo(pb.createdAt)}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <span className="text-[11px] text-slate-400 tabular-nums">Invoice: {pb.zohoInvoiceNo}</span>
                    {pb.brand && <span className="text-[11px] text-slate-400">| {pb.brand.name}</span>}
                    {pb.salesPerson && <span className="text-[11px] text-slate-400">| Sales: {pb.salesPerson}</span>}
                  </div>

                  {/* Matched — show shipment tracking */}
                  {pb.matchedShipment && (
                    <Link href={`/inbound/${pb.matchedShipment.id}`}
                      className="mt-2 bg-blue-50 rounded-lg p-2 flex items-center justify-between">
                      <p className="text-xs text-blue-700 tabular-nums">
                        Matched: {pb.matchedShipment.shipmentNo} |{" "}
                        ETA: {new Date(pb.matchedShipment.expectedDeliveryDate).toLocaleDateString("en-IN")}
                      </p>
                      <Truck className="h-3.5 w-3.5 text-blue-500" />
                    </Link>
                  )}

                  {/* Waiting — show manual match button */}
                  {pb.status === "WAITING" && canMatch && (
                    <button onClick={() => openManualMatch(pb)}
                      className="mt-2 w-full py-1.5 rounded-lg bg-amber-50 text-amber-700 text-xs font-medium border border-amber-200 hover:bg-amber-100 flex items-center justify-center gap-1.5">
                      <Link2 className="h-3.5 w-3.5" /> Match to Inbound Item
                    </button>
                  )}

                  <div className="flex items-center justify-between mt-2">
                    <span className="text-[11px] text-slate-400 tabular-nums">
                      {new Date(pb.createdAt).toLocaleDateString("en-IN")} by {pb.createdBy.name}
                    </span>
                    {pb.customerPhone && (
                      <a href={`https://wa.me/91${pb.customerPhone.replace(/\D/g, "").slice(-10)}`}
                        target="_blank" rel="noopener noreferrer"
                        className="p-1.5 rounded-full hover:bg-green-50">
                        <Phone className="h-3.5 w-3.5 text-green-600" />
                      </a>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        </>
      )}

      {/* Manual Match Modal */}
      {manualMatchPb && (
        <div className="fixed inset-0 z-[60] bg-black/40 flex items-end justify-center">
          <div className="bg-white w-full max-w-lg rounded-t-2xl max-h-[80vh] flex flex-col">
            <div className="p-4 border-b flex items-center justify-between">
              <div>
                <p className="text-sm font-bold text-slate-900">Match: {manualMatchPb.customerName}</p>
                <p className="text-xs text-slate-500">{manualMatchPb.productName}</p>
              </div>
              <button onClick={() => setManualMatchPb(null)} className="p-1.5 hover:bg-slate-100 rounded-full">
                <X className="h-5 w-5 text-slate-400" />
              </button>
            </div>

            <div className="p-3 border-b">
              <Input value={itemSearch} onChange={(e) => setItemSearch(e.target.value)}
                placeholder="Search by product, brand, or shipment..." className="text-sm" />
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {loadingItems ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
                </div>
              ) : filteredItems.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-sm text-slate-400">No available in-transit items found</p>
                  <p className="text-[10px] text-slate-400 mt-1">Items already matched or delivered won&apos;t appear here</p>
                </div>
              ) : (
                filteredItems.map((item) => (
                  <button key={item.id} onClick={() => handleManualMatch(item.id)}
                    disabled={matchingItem === item.id}
                    className="w-full text-left p-3 rounded-lg border border-slate-200 hover:border-blue-300 hover:bg-blue-50/50 transition-colors disabled:opacity-50">
                    <p className="text-sm font-medium text-slate-900">{item.productName}</p>
                    <div className="flex items-center gap-2 mt-1 text-[10px] text-slate-500">
                      <span>{item.shipment.brand.name}</span>
                      <span>|</span>
                      <span>{item.shipment.shipmentNo}</span>
                      <span>|</span>
                      <span>Qty: {item.quantity}</span>
                      <span>|</span>
                      <span>ETA: {new Date(item.shipment.expectedDeliveryDate).toLocaleDateString("en-IN")}</span>
                    </div>
                    {matchingItem === item.id && (
                      <p className="text-xs text-blue-600 mt-1">Matching...</p>
                    )}
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
