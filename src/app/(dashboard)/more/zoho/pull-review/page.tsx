"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  ArrowLeft, CheckCircle2, XCircle, Download, RefreshCw,
  Users, Package, FileText, ShoppingCart, Clock, Loader2,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface PreviewItem {
  id: string;
  entityType: string;
  zohoId: string;
  data: Record<string, unknown>;
  status: string;
}

interface PullLog {
  pullId: string;
  status: string;
  contactsNew: number;
  itemsNew: number;
  billsNew: number;
  invoicesNew: number;
  apiCallsUsed: number;
  errors: string | null;
  createdAt: string;
  approvedAt: string | null;
}

interface PullData {
  latest: {
    pullId: string;
    status: string;
    contactsNew: number;
    itemsNew: number;
    billsNew: number;
    invoicesNew: number;
    apiCallsUsed: number;
    errors: string | null;
    createdAt: string;
    previews: {
      contacts: PreviewItem[];
      items: PreviewItem[];
      bills: PreviewItem[];
      invoices: PreviewItem[];
    };
  } | null;
  history: PullLog[];
}

const ENTITY_ICONS = {
  contacts: Users,
  items: Package,
  bills: FileText,
  invoices: ShoppingCart,
};

const STATUS_BADGE: Record<string, string> = {
  PENDING_REVIEW: "warning",
  APPROVED: "success",
  REJECTED: "danger",
  PARTIAL: "info",
};

export default function PullReviewPage() {
  const [data, setData] = useState<PullData | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [expandedSection, setExpandedSection] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  function fetchData() {
    setLoading(true);
    fetch("/api/zoho/pull-review")
      .then((r) => r.json())
      .then((res) => { if (res.success) setData(res.data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }

  useEffect(() => { fetchData(); }, []);

  async function handleAction(action: "approve" | "reject") {
    if (!data?.latest?.pullId) return;
    const msg = action === "approve"
      ? "This will write all new records to the database. Continue?"
      : "This will discard all pulled data. Continue?";
    if (!confirm(msg)) return;

    setActing(true);
    setResult(null);
    try {
      const res = await fetch("/api/zoho/pull-review/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pullId: data.latest.pullId, action }),
      });
      const json = await res.json();
      if (json.success) {
        if (action === "approve") {
          const d = json.data;
          setResult(`Approved: ${d.contacts} vendors, ${d.items} items, ${d.bills} bills, ${d.invoices} invoices${d.errors?.length ? ` (${d.errors.length} errors)` : ""}`);
        } else {
          setResult("Pull rejected — no data written.");
        }
        fetchData();
      } else {
        setResult(`Error: ${json.error}`);
      }
    } catch {
      setResult("Something went wrong");
    } finally {
      setActing(false);
    }
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSelectAll(section: string) {
    if (!data?.latest) return;
    const items = data.latest.previews[section as keyof typeof data.latest.previews] || [];
    const allSelected = items.every((p) => selectedIds.has(p.id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const p of items) {
        if (allSelected) next.delete(p.id); else next.add(p.id);
      }
      return next;
    });
  }

  async function handleApproveSelected() {
    if (!data?.latest?.pullId || selectedIds.size === 0) return;
    if (!confirm(`Import ${selectedIds.size} selected records?`)) return;

    setActing(true);
    setResult(null);
    try {
      const res = await fetch("/api/zoho/pull-review/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pullId: data.latest.pullId, action: "approve", previewIds: Array.from(selectedIds) }),
      });
      const json = await res.json();
      if (json.success) {
        const d = json.data;
        const imported = d.contacts + d.items + d.bills + d.invoices;
        setResult(`Imported ${imported} selected records${d.remainingPending > 0 ? ` (${d.remainingPending} still pending)` : ""}${d.errors?.length ? ` (${d.errors.length} errors)` : ""}`);
        setSelectedIds(new Set());
        fetchData();
      } else {
        setResult(`Error: ${json.error}`);
      }
    } catch {
      setResult("Something went wrong");
    } finally {
      setActing(false);
    }
  }

  async function handleApproveEntity(entityType: string) {
    if (!data?.latest?.pullId) return;
    const label = entityType === "invoice" ? "invoices" : entityType === "item" ? "items" : entityType === "bill" ? "bills" : "contacts";
    if (!confirm(`Approve only ${label}? Other data stays pending for review.`)) return;

    setActing(true);
    setResult(null);
    try {
      const res = await fetch("/api/zoho/pull-review/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pullId: data.latest.pullId, action: "approve", entityType }),
      });
      const json = await res.json();
      if (json.success) {
        const d = json.data;
        setResult(`Approved ${label}: ${d[label] || 0} imported${d.remainingPending > 0 ? ` (${d.remainingPending} other records still pending)` : ""}${d.errors?.length ? ` (${d.errors.length} errors)` : ""}`);
        fetchData();
      } else {
        setResult(`Error: ${json.error}`);
      }
    } catch {
      setResult("Something went wrong");
    } finally {
      setActing(false);
    }
  }

  function handleExport() {
    if (!data?.latest?.pullId) return;
    window.open(`/api/zoho/pull-review/export?pullId=${data.latest.pullId}`, "_blank");
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }

  const latest = data?.latest;
  const totalNew = latest ? latest.contactsNew + latest.itemsNew + latest.billsNew + latest.invoicesNew : 0;
  const isPending = latest?.status === "PENDING_REVIEW" || latest?.status === "PARTIAL";

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <Link href="/more/zoho" className="p-1">
          <ArrowLeft className="h-5 w-5 text-slate-600" />
        </Link>
        <h1 className="text-lg font-bold text-slate-900 flex-1">Zoho Pull Review</h1>
        <button onClick={fetchData} className="p-2 rounded-lg hover:bg-slate-100">
          <RefreshCw className="h-4 w-4 text-slate-500" />
        </button>
      </div>

      {!latest ? (
        <div className="text-center py-12">
          <Clock className="h-10 w-10 text-slate-300 mx-auto mb-2" />
          <p className="text-sm text-slate-400">No pull data yet</p>
          <p className="text-xs text-slate-300 mt-1">Run a pull from the Zoho settings page</p>
        </div>
      ) : (
        <>
          {/* Pull Summary Card */}
          <Card className="mb-4">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-sm font-medium text-slate-900">
                    Pull: {new Date(latest.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </p>
                  <p className="text-xs text-slate-400">
                    {latest.apiCallsUsed} API calls used | {totalNew} new records
                  </p>
                </div>
                <Badge variant={STATUS_BADGE[latest.status] as "warning" | "success" | "danger" | "info"}>
                  {latest.status === "PENDING_REVIEW" ? "Pending Review" : latest.status.charAt(0) + latest.status.slice(1).toLowerCase()}
                </Badge>
              </div>

              {/* Summary grid */}
              <div className="grid grid-cols-4 gap-2 mb-4">
                {(["contacts", "items", "bills", "invoices"] as const).map((type) => {
                  const Icon = ENTITY_ICONS[type];
                  const count = latest[`${type}New` as keyof typeof latest] as number;
                  return (
                    <button
                      key={type}
                      onClick={() => setExpandedSection(expandedSection === type ? null : type)}
                      className={`p-2 rounded-lg border text-center transition-colors ${
                        expandedSection === type ? "border-slate-900 bg-slate-50" : "border-slate-200 hover:border-slate-300"
                      }`}
                    >
                      <Icon className="h-4 w-4 text-slate-500 mx-auto mb-1" />
                      <p className="text-lg font-bold text-slate-900">{count}</p>
                      <p className="text-[10px] text-slate-400 capitalize">{type}</p>
                    </button>
                  );
                })}
              </div>

              {/* Action buttons */}
              {isPending && totalNew > 0 && (
                <div className="flex gap-2 mb-3">
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1"
                    onClick={handleExport}
                  >
                    <Download className="h-4 w-4 mr-1" /> Download CSV
                  </Button>
                </div>
              )}

              {/* Per-entity approve buttons */}
              {isPending && totalNew > 0 && (
                <div className="flex gap-1.5 mb-2 flex-wrap">
                  {latest.invoicesNew > 0 && (
                    <Button size="sm" variant="outline" className="text-xs border-green-200 text-green-700 hover:bg-green-50" onClick={() => handleApproveEntity("invoice")} disabled={acting}>
                      <ShoppingCart className="h-3 w-3 mr-1" /> Import {latest.invoicesNew} Invoices
                    </Button>
                  )}
                  {latest.itemsNew > 0 && (
                    <Button size="sm" variant="outline" className="text-xs border-green-200 text-green-700 hover:bg-green-50" onClick={() => handleApproveEntity("item")} disabled={acting}>
                      <Package className="h-3 w-3 mr-1" /> Import {latest.itemsNew} Items
                    </Button>
                  )}
                  {latest.billsNew > 0 && (
                    <Button size="sm" variant="outline" className="text-xs border-green-200 text-green-700 hover:bg-green-50" onClick={() => handleApproveEntity("bill")} disabled={acting}>
                      <FileText className="h-3 w-3 mr-1" /> Import {latest.billsNew} Bills
                    </Button>
                  )}
                  {latest.contactsNew > 0 && (
                    <Button size="sm" variant="outline" className="text-xs border-green-200 text-green-700 hover:bg-green-50" onClick={() => handleApproveEntity("contact")} disabled={acting}>
                      <Users className="h-3 w-3 mr-1" /> Import {latest.contactsNew} Contacts
                    </Button>
                  )}
                </div>
              )}

              {isPending && totalNew > 0 && (
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1 text-red-600 border-red-200 hover:bg-red-50"
                    onClick={() => handleAction("reject")}
                    disabled={acting}
                  >
                    <XCircle className="h-4 w-4 mr-1" /> Reject All
                  </Button>
                  <Button
                    size="sm"
                    className="flex-1 bg-green-600 hover:bg-green-700"
                    onClick={() => handleAction("approve")}
                    disabled={acting}
                  >
                    {acting ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-1" />}
                    {acting ? "Processing..." : "Approve All"}
                  </Button>
                </div>
              )}

              {isPending && totalNew === 0 && (
                <p className="text-xs text-slate-400 text-center py-2">No new data in this pull — everything is already synced.</p>
              )}

              {result && (
                <p className={`text-xs mt-3 p-2 rounded-lg ${result.startsWith("Error") ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700"}`}>
                  {result}
                </p>
              )}

              {latest.errors && (
                <details className="mt-3">
                  <summary className="text-xs text-red-500 cursor-pointer">
                    {JSON.parse(latest.errors).length} error(s)
                  </summary>
                  <div className="mt-1 text-xs text-red-400 space-y-0.5">
                    {(JSON.parse(latest.errors) as string[]).map((e, i) => (
                      <p key={i}>{e}</p>
                    ))}
                  </div>
                </details>
              )}
            </CardContent>
          </Card>

          {/* Expanded section — preview items with checkboxes */}
          {expandedSection && (
            <Card className="mb-4">
              <CardContent className="p-3">
                {(() => {
                  const sectionItems = latest.previews[expandedSection as keyof typeof latest.previews];
                  const sectionSelectedCount = sectionItems.filter((p) => selectedIds.has(p.id)).length;
                  const allSelected = sectionItems.length > 0 && sectionSelectedCount === sectionItems.length;
                  return (
                    <>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          {isPending && sectionItems.length > 0 && (
                            <input
                              type="checkbox"
                              checked={allSelected}
                              onChange={() => toggleSelectAll(expandedSection)}
                              className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                            />
                          )}
                          <h3 className="text-sm font-bold text-slate-900 capitalize">{expandedSection} ({sectionItems.length})</h3>
                        </div>
                        {isPending && sectionSelectedCount > 0 && (
                          <Button
                            size="sm"
                            className="text-xs bg-green-600 hover:bg-green-700"
                            onClick={handleApproveSelected}
                            disabled={acting}
                          >
                            {acting ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <CheckCircle2 className="h-3 w-3 mr-1" />}
                            Import {sectionSelectedCount} Selected
                          </Button>
                        )}
                      </div>
                      <div className="space-y-1.5 max-h-80 overflow-y-auto">
                        {sectionItems.map((p) => {
                          const d = p.data;
                          return (
                            <div
                              key={p.id}
                              className={`p-2 rounded-lg border transition-colors cursor-pointer ${
                                selectedIds.has(p.id) ? "border-blue-300 bg-blue-50/50" : "border-slate-100 bg-slate-50/50"
                              }`}
                              onClick={() => isPending && toggleSelect(p.id)}
                            >
                              <div className="flex items-start gap-2">
                                {isPending && (
                                  <input
                                    type="checkbox"
                                    checked={selectedIds.has(p.id)}
                                    onChange={() => toggleSelect(p.id)}
                                    onClick={(e) => e.stopPropagation()}
                                    className="mt-0.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                  />
                                )}
                                <div className="flex-1 min-w-0">
                                  {p.entityType === "contact" && (
                                    <>
                                      <p className="text-sm font-medium text-slate-900">{String(d.name)}</p>
                                      <p className="text-xs text-slate-500">
                                        {d.phone ? `Phone: ${d.phone}` : ""} {d.gstin ? `| GSTIN: ${d.gstin}` : ""}
                                      </p>
                                    </>
                                  )}
                                  {p.entityType === "item" && (
                                    <>
                                      <p className="text-sm font-medium text-slate-900">{String(d.name)}</p>
                                      <p className="text-xs text-slate-500">
                                        SKU: {String(d.sku)} | Cost: ₹{Number(d.costPrice).toLocaleString("en-IN")} | Sell: ₹{Number(d.sellingPrice).toLocaleString("en-IN")} | GST: {String(d.gstRate)}%
                                      </p>
                                    </>
                                  )}
                                  {p.entityType === "bill" && (
                                    <>
                                      <p className="text-sm font-medium text-slate-900">Bill #{String(d.billNumber)}</p>
                                      <p className="text-xs text-slate-500">
                                        Vendor: {String(d.vendorName)} | ₹{Number(d.total).toLocaleString("en-IN")}
                                      </p>
                                      {(d.lineItems as Array<{ name: string; sku: string; quantity: number; rate: number }>)?.length > 0 && (
                                        <div className="mt-1 pl-2 border-l-2 border-slate-200 space-y-0.5">
                                          {(d.lineItems as Array<{ name: string; sku: string; quantity: number; rate: number }>).map((li, idx) => (
                                            <p key={idx} className="text-[11px] text-slate-600">
                                              {li.name} {li.sku ? `(${li.sku})` : ""} — Qty: {li.quantity} × ₹{li.rate.toLocaleString("en-IN")}
                                            </p>
                                          ))}
                                        </div>
                                      )}
                                    </>
                                  )}
                                  {p.entityType === "invoice" && (
                                    <>
                                      <p className="text-sm font-medium text-slate-900">Invoice #{String(d.invoiceNumber)}</p>
                                      <p className="text-xs text-slate-500">
                                        {String(d.customerName)} | ₹{Number(d.total).toLocaleString("en-IN")}
                                        {d.salesPerson ? ` | Sales: ${d.salesPerson}` : ""}
                                      </p>
                                      {(d.lineItems as Array<{ name: string; sku: string; quantity: number; rate: number }>)?.length > 0 && (
                                        <div className="mt-1 pl-2 border-l-2 border-slate-200 space-y-0.5">
                                          {(d.lineItems as Array<{ name: string; sku: string; quantity: number; rate: number }>).map((li, idx) => (
                                            <p key={idx} className="text-[11px] text-slate-600">
                                              {li.name} {li.sku ? `(${li.sku})` : ""} — Qty: {li.quantity} × ₹{li.rate.toLocaleString("en-IN")}
                                            </p>
                                          ))}
                                        </div>
                                      )}
                                    </>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                        {sectionItems.length === 0 && (
                          <p className="text-xs text-slate-400 text-center py-4">No new {expandedSection} in this pull</p>
                        )}
                      </div>
                    </>
                  );
                })()}
              </CardContent>
            </Card>
          )}

          {/* Pull History */}
          {data && data.history.length > 1 && (
            <div className="mt-4">
              <h3 className="text-sm font-bold text-slate-900 mb-2">Pull History</h3>
              <div className="space-y-1.5">
                {data.history.slice(1).map((h) => (
                  <div key={h.pullId} className="flex items-center justify-between p-2 rounded-lg border border-slate-100">
                    <div>
                      <p className="text-xs font-medium text-slate-700">
                        {new Date(h.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                      </p>
                      <p className="text-[10px] text-slate-400">
                        {h.contactsNew}C {h.itemsNew}I {h.billsNew}B {h.invoicesNew}Inv | {h.apiCallsUsed} calls
                      </p>
                    </div>
                    <Badge variant={STATUS_BADGE[h.status] as "warning" | "success" | "danger" | "info"} className="text-[10px]">
                      {h.status === "PENDING_REVIEW" ? "Pending" : h.status.charAt(0) + h.status.slice(1).toLowerCase()}
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
