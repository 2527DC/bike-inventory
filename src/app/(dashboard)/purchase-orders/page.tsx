"use client";
import { useDebounce } from "@/hooks/use-debounce";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Plus, ShoppingCart, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ExportButtons } from "@/components/export-buttons";
import { DesktopTable } from "@/components/desktop-table";
import { exportToExcel, exportToPDF, type ExportColumn } from "@/lib/export";
import { getAging, AGING_BADGE } from "@/lib/utils";
import { type DateRangeKey } from "@/components/date-filter";
import { FilterSheet } from "@/components/filter-sheet";
import { SkeletonList } from "@/components/ui/skeleton";

const PO_COLUMNS: ExportColumn[] = [
  { header: "PO Number", key: "poNumber" },
  { header: "Vendor", key: "vendor.name" },
  { header: "Status", key: "status", format: (v) => String(v).replace(/_/g, " ") },
  { header: "Order Date", key: "orderDate", format: (v) => new Date(String(v)).toLocaleDateString("en-IN") },
  { header: "Expected Date", key: "expectedDate", format: (v) => v ? new Date(String(v)).toLocaleDateString("en-IN") : "" },
  { header: "Items", key: "items", format: (v) => String((v as Array<{ quantity: number }>)?.reduce((s: number, i) => s + i.quantity, 0) || 0) },
  { header: "Grand Total", key: "grandTotal", format: (v) => `₹${Number(v || 0).toLocaleString("en-IN")}` },
  { header: "Created By", key: "createdBy.name" },
];

interface POItem {
  id: string;
  poNumber: string;
  status: string;
  grandTotal: number;
  orderDate: string;
  expectedDate?: string;
  vendor: { name: string; code: string };
  items: Array<{ quantity: number }>;
  createdBy: { name: string };
}

const STATUS_FILTERS = ["ALL", "DRAFT", "PENDING_APPROVAL", "APPROVED", "SENT_TO_VENDOR", "PARTIALLY_RECEIVED", "RECEIVED"];

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount);
}

function statusVariant(status: string) {
  switch (status) {
    case "DRAFT": return "default";
    case "APPROVED": case "RECEIVED": return "success";
    case "CANCELLED": return "danger";
    default: return "warning";
  }
}

export default function PurchaseOrdersPage() {
  const [orders, setOrders] = useState<POItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search);
  const [dateFilter, setDateFilter] = useState<DateRangeKey>("all");
  const [dateFrom, setDateFrom] = useState<string | undefined>();
  const [dateTo, setDateTo] = useState<string | undefined>();

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ limit: "50" });
    if (statusFilter !== "ALL") params.set("status", statusFilter);
    if (debouncedSearch.length >= 2) params.set("search", debouncedSearch);
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);

    fetch(`/api/purchase-orders?${params}`)
      .then((r) => r.json())
      .then((res) => { if (res.success) setOrders(res.data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [statusFilter, debouncedSearch, dateFrom, dateTo]);

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h1 className="text-lg font-bold text-slate-900">Purchase Orders</h1>
        <div className="flex items-center gap-2">
          <ExportButtons
            onExcel={() => exportToExcel(orders as unknown as Record<string, unknown>[], PO_COLUMNS, "purchase-orders")}
            onPDF={() => exportToPDF("Purchase Orders", orders as unknown as Record<string, unknown>[], PO_COLUMNS, "purchase-orders")}
          />
          <Link href="/purchase-orders/new">
            <Button size="sm" className="bg-blue-600 hover:bg-blue-700">
              <Plus className="h-4 w-4 mr-1" /> New PO
            </Button>
          </Link>
        </div>
      </div>

      <div className="relative mb-3">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <Input
          placeholder="Search PO number or vendor..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      <FilterSheet
        className="mb-4"
        dateValue={dateFilter}
        onDateChange={(key, from, to) => { setDateFilter(key); setDateFrom(from); setDateTo(to); }}
        groups={[{
          label: "Status",
          value: statusFilter,
          defaultValue: "ALL",
          options: STATUS_FILTERS.map((s) => ({ key: s, label: s === "ALL" ? "All" : s.replace(/_/g, " ") })),
          onChange: (key) => setStatusFilter(key),
        }]}
      />

      {loading ? (
        <SkeletonList count={6} type="card" />
      ) : (
        <>
        <DesktopTable
          className="hidden lg:block"
          rows={orders}
          rowKey={(po) => po.id}
          rowHref={(po) => `/purchase-orders/${po.id}`}
          emptyText="No purchase orders found"
          columns={[
            { header: "PO #", cell: (po) => <span className="font-medium text-slate-900">{po.poNumber}</span> },
            { header: "Vendor", cell: (po) => po.vendor.name },
            { header: "Date", cell: (po) => new Date(po.orderDate).toLocaleDateString("en-IN"), className: "whitespace-nowrap text-slate-500" },
            { header: "Items", cell: (po) => po.items.reduce((s, i) => s + i.quantity, 0), className: "text-right tabular-nums w-16" },
            { header: "Total", cell: (po) => <span className="font-semibold text-slate-900 tabular-nums">{formatCurrency(po.grandTotal)}</span>, className: "text-right whitespace-nowrap" },
            { header: "Status", cell: (po) => {
              const needsTracking = ["SENT_TO_VENDOR", "PARTIALLY_RECEIVED"].includes(po.status);
              const aging = needsTracking ? getAging(po.orderDate) : null;
              return (
                <div className="flex items-center gap-1.5">
                  <Badge variant={statusVariant(po.status)} className="text-[10px]">{po.status.replace(/_/g, " ")}</Badge>
                  {aging && aging.level !== "ok" && (
                    <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded-full ${AGING_BADGE[aging.level]}`}>{aging.text}</span>
                  )}
                </div>
              );
            } },
          ]}
        />
        <div className="space-y-2 lg:hidden">
          {orders.map((po) => {
            const needsTracking = ["SENT_TO_VENDOR", "PARTIALLY_RECEIVED"].includes(po.status);
            const aging = needsTracking ? getAging(po.orderDate) : null;
            const isLate = aging && (aging.level === "danger" || aging.level === "critical");
            const accent = isLate || po.status === "CANCELLED"
              ? "border-l-red-500"
              : po.status === "RECEIVED" || po.status === "APPROVED"
              ? "border-l-green-500"
              : po.status === "DRAFT"
              ? "border-l-slate-200"
              : "border-l-amber-400";
            return (
            <Link
              key={po.id}
              href={`/purchase-orders/${po.id}`}
              className={`block rounded-xl border border-slate-200 border-l-4 ${accent} bg-white shadow-sm transition-colors active:bg-slate-50 focus-ring`}
            >
              <div className="p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-900 tabular-nums truncate">{po.poNumber}</p>
                    <p className="text-xs text-slate-500 tabular-nums truncate mt-0.5">
                      {po.vendor.name} · {new Date(po.orderDate).toLocaleDateString("en-IN")}
                    </p>
                    <p className="text-xs text-slate-400 tabular-nums truncate mt-0.5">
                      {po.items.reduce((s, i) => s + i.quantity, 0)} items · By {po.createdBy.name}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-bold text-slate-900 tabular-nums">{formatCurrency(po.grandTotal)}</p>
                    <Badge variant={statusVariant(po.status)} className="mt-1">
                      {po.status.replace(/_/g, " ")}
                    </Badge>
                    {aging && aging.level !== "ok" && (
                      <span className={`block text-[11px] font-semibold px-1.5 py-0.5 rounded-full tabular-nums mt-1 ${AGING_BADGE[aging.level]}`}>
                        {aging.text}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </Link>
            );
          })}

          {orders.length === 0 && (
            <div className="text-center py-12">
              <ShoppingCart className="h-8 w-8 text-slate-300 mx-auto mb-2" />
              <p className="text-sm text-slate-400">No purchase orders found</p>
            </div>
          )}
        </div>
        </>
      )}
    </div>
  );
}
