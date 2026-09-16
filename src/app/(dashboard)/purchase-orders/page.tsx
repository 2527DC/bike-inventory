"use client";
import { useDebounce } from "@/hooks/use-debounce";

import { Suspense, useState, useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus, ShoppingCart, Search, RefreshCw } from "lucide-react";
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
import { apiTry } from "@/lib/api-client";
import { ErrorBanner } from "@/components/ui/error-banner";
import { usePermissions } from "@/lib/use-permissions";
import { ReorderTab } from "./_components/reorder-tab";

const PO_COLUMNS: ExportColumn[] = [
  { header: "PO Number", key: "poNumber" },
  { header: "Vendor", key: "vendor.name" },
  { header: "Status", key: "status", format: (v) => statusLabel(String(v)) },
  { header: "Order Date", key: "orderDate", format: (v) => new Date(String(v)).toLocaleDateString("en-IN") },
  { header: "Expected Date", key: "expectedDate", format: (v) => v ? new Date(String(v)).toLocaleDateString("en-IN") : "" },
  { header: "Items", key: "items", format: (v) => String((v as Array<{ quantity: number }>)?.reduce((s: number, i) => s + i.quantity, 0) || 0) },
  // No Grand Total column: a purchase order carries no price (plan
  // 1509-po-product-and-quantity-only, Q6).
  { header: "Created By", key: "createdBy.name" },
];

interface POItem {
  id: string;
  poNumber: string;
  status: string;
  orderDate: string;
  expectedDate?: string;
  vendor: { name: string; code: string };
  items: Array<{ quantity: number }>;
  createdBy: { name: string };
}

// CANCELLED was the one POStatus with no chip, so a cancelled PO was reachable only through
// ALL. P9 makes cancelling a first-class action from every non-terminal state, which would
// have made that gap much more visible.
const STATUS_FILTERS = ["ALL", "DRAFT", "PENDING_APPROVAL", "APPROVED", "SENT_TO_VENDOR", "PARTIALLY_RECEIVED", "RECEIVED", "CANCELLED"];

function statusVariant(status: string) {
  switch (status) {
    case "DRAFT": return "default";
    case "APPROVED": case "RECEIVED": return "success";
    case "CANCELLED": return "danger";
    // PENDING_APPROVAL, SENT_TO_VENDOR and PARTIALLY_RECEIVED all landed here before P9 and
    // rendered identically, which mattered little while nothing could reach PENDING_APPROVAL.
    // Now that it is a real state somebody is waiting on, "warning" is still the right family
    // — they are all in flight — and the LABEL is what distinguishes them.
    default: return "warning";
  }
}

/** The label under the chip. Underscores are not words. */
function statusLabel(status: string) {
  return status.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase());
}

type TabKey = "orders" | "reorder";

/**
 * Purchase Orders, with Reorder as its second tab (plan 1509-reorder-inside-purchase-orders,
 * R7 / Q8). The tab is in the URL — `/purchase-orders?tab=reorder` — so `/reorder`, the
 * dashboard's Low Stock tiles and a bookmark can all land on it.
 *
 * `useSearchParams` in a Client Component must sit under a Suspense boundary, or the production
 * build fails prerendering this page ("Missing Suspense boundary with useSearchParams" —
 * node_modules/next/dist/docs/01-app/03-api-reference/04-functions/use-search-params.md).
 */
export default function PurchaseOrdersPage() {
  return (
    <Suspense fallback={<SkeletonList count={6} type="card" />}>
      <PurchaseOrdersScreen />
    </Suspense>
  );
}

function PurchaseOrdersScreen() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { canView, loading: permsLoading } = usePermissions();

  // Each tab keeps the grant it had as a screen (Q10): Orders on purchase_orders.view, Reorder
  // on reorder.view. Cosmetic, like every frontend check — the two APIs re-check.
  const mayOrders = canView("purchase_orders");
  const mayReorder = canView("reorder");

  const requested: TabKey = searchParams.get("tab") === "reorder" ? "reorder" : "orders";
  const tab: TabKey =
    requested === "reorder"
      ? mayReorder ? "reorder" : "orders"
      : !mayOrders && mayReorder ? "reorder" : "orders";

  const selectTab = (next: TabKey) =>
    router.replace(next === "reorder" ? "/purchase-orders?tab=reorder" : "/purchase-orders", { scroll: false });

  const tabs = [
    ...(mayOrders ? [{ key: "orders" as const, label: "Orders", icon: ShoppingCart }] : []),
    ...(mayReorder ? [{ key: "reorder" as const, label: "Reorder", icon: RefreshCw }] : []),
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h1 className="text-lg font-bold text-slate-900">Purchase Orders</h1>
        <Link href="/purchase-orders/new">
          <Button size="sm" className="bg-blue-600 hover:bg-blue-700">
            <Plus className="h-4 w-4 mr-1" /> New PO
          </Button>
        </Link>
      </div>

      {/* Top tab bar — the assembly/page.tsx pattern. Only when both tabs are granted; with one,
          the bar would be a single button that does nothing. Scrolls sideways on a phone. */}
      {tabs.length > 1 && (
        <div className="-mx-1 overflow-x-auto px-1 mb-3">
          <div role="tablist" aria-label="Purchase order views" className="flex min-w-max gap-1 rounded-xl bg-slate-100 p-1">
            {tabs.map((t) => {
              const Icon = t.icon;
              const selected = tab === t.key;
              return (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => selectTab(t.key)}
                  className={`flex min-h-[44px] items-center gap-1.5 whitespace-nowrap rounded-lg px-4 text-xs font-semibold transition-all focus-ring ${
                    selected ? "bg-white text-blue-700 shadow-xs" : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span>{t.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* While the grants load, which tab is allowed is unknown — rendering Orders first would
          fire its request and then swap to Reorder for a person who only holds reorder.view. */}
      {permsLoading ? (
        <SkeletonList count={6} type="card" />
      ) : tab === "reorder" ? (
        <ReorderTab />
      ) : (
        <OrdersTab />
      )}
    </div>
  );
}

function OrdersTab() {
  const [orders, setOrders] = useState<POItem[]>([]);
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [loadError, setLoadError] = useState<string | null>(null);
  // A counter, not a re-set of an existing filter: setting a state value to what it already is
  // does not re-run the effect, so a Retry wired that way is a button that does nothing.
  const [reloadKey, setReloadKey] = useState(0);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search);
  const [dateFilter, setDateFilter] = useState<DateRangeKey>("all");
  const [dateFrom, setDateFrom] = useState<string | undefined>();
  const [dateTo, setDateTo] = useState<string | undefined>();

  // The request the filters describe right now. `loading` is DERIVED — "the list on screen was
  // loaded for a different request" — instead of being set to true at the top of the effect,
  // which is a synchronous setState in an effect body (react-hooks/set-state-in-effect).
  const params = new URLSearchParams({ limit: "50" });
  if (statusFilter !== "ALL") params.set("status", statusFilter);
  if (debouncedSearch.length >= 2) params.set("search", debouncedSearch);
  if (dateFrom) params.set("dateFrom", dateFrom);
  if (dateTo) params.set("dateTo", dateTo);
  const query = params.toString();
  const requestKey = `${query}#${reloadKey}`;
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const loading = loadedKey !== requestKey;

  useEffect(() => {
    let cancelled = false;
    // apiTry, not raw .json(): an expired session answers 307 -> /login -> HTML with status
    // 200, so the old .catch(() => {}) rendered "No purchase orders found" for a dead session.
    apiTry<POItem[]>(`/api/purchase-orders?${query}`).then(({ data, error }) => {
      // A newer filter already replaced this request; its answer must not overwrite that one.
      if (cancelled) return;
      setOrders(data ?? []);
      setLoadError(data ? null : error);
      setLoadedKey(requestKey);
    });
    return () => {
      cancelled = true;
    };
  }, [query, requestKey]);

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input
            placeholder="Search PO number or vendor..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <ExportButtons
          onExcel={() => exportToExcel(orders as unknown as Record<string, unknown>[], PO_COLUMNS, "purchase-orders")}
          onPDF={() => exportToPDF("Purchase Orders", orders as unknown as Record<string, unknown>[], PO_COLUMNS, "purchase-orders")}
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
          options: STATUS_FILTERS.map((s) => ({ key: s, label: s === "ALL" ? "All" : statusLabel(s) })),
          onChange: (key) => setStatusFilter(key),
        }]}
      />

      {!loading && loadError && (
        <div className="mb-3">
          <ErrorBanner message={loadError} onRetry={() => setReloadKey((k) => k + 1)} />
        </div>
      )}

      {loading ? (
        <SkeletonList count={6} type="card" />
      ) : loadError ? null : (
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
            { header: "Status", cell: (po) => {
              const needsTracking = ["SENT_TO_VENDOR", "PARTIALLY_RECEIVED"].includes(po.status);
              const aging = needsTracking ? getAging(po.orderDate) : null;
              return (
                <div className="flex items-center gap-1.5">
                  <Badge variant={statusVariant(po.status)} className="text-[10px]">{statusLabel(po.status)}</Badge>
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
                  {/* The status chip sits at the top of the right-hand column now that the total
                      above it is gone (plan 1509-po-product-and-quantity-only, Q6). */}
                  <div className="text-right shrink-0">
                    <Badge variant={statusVariant(po.status)}>
                      {statusLabel(po.status)}
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
