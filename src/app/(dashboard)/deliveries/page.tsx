"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Loader2, Truck, Trash2 } from "lucide-react";
import { useDebounce, getAging, AGING_BADGE } from "@/lib/utils";
import { usePermissions } from "@/lib/use-permissions";
import { Badge } from "@/components/ui/badge";
import { SkeletonList } from "@/components/ui/skeleton";
import { getStatusColor, getStatusLabel } from "@/lib/status-colors";
import { DesktopTable } from "@/components/desktop-table";
import { ActionConfirmation } from "@/components/ui/action-confirmation";
import { ErrorBanner } from "@/components/ui/error-banner";
import { DeliveryStats, type Stats } from "./_components/delivery-stats";
import { DeliverySearch } from "./_components/delivery-search";
import { DeliveryFilters } from "./_components/delivery-filters";
import { DeliveryCard, type DeliveryItem } from "./_components/delivery-card";
import { ZohoImportFlow } from "./_components/zoho-import-flow";
import { BottomSheetModal } from "./_components/bottom-sheet-modal";

export default function DeliveriesPage() {
  const { data: session } = useSession();
  const role = (session?.user as { role?: string })?.role || "";
  const { canFetch } = usePermissions();
  const canFetchInvoices = canFetch("deliveries");
  const isAdmin = role === "ADMIN" || role === "CEO";

  // ─── Data state ───
  const [deliveries, setDeliveries] = useState<DeliveryItem[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [dataError, setDataError] = useState<string | null>(null);

  // ─── Filter state ───
  const searchParams = useSearchParams();
  const [filter, setFilter] = useState(searchParams.get("status") || "PENDING");
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search);
  const [dateRange, setDateRange] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState<string | undefined>();
  const [dateTo, setDateTo] = useState<string | undefined>();

  // ─── Action state ───
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [prebookConfirm, setPrebookConfirm] = useState<DeliveryItem | null>(null);
  const [prebooking, setPrebooking] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<{
    type: "success" | "warning" | "error" | "info";
    title: string;
    referenceId: string;
    items?: Array<{ label: string; value: string }>;
    details?: string;
  } | null>(null);
  const [actionError, setActionError] = useState("");

  // ─── Data fetching ───
  const fetchData = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filter !== "ALL") params.set("status", filter);
    if (debouncedSearch) params.set("search", debouncedSearch);
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    if (dateRange !== "all" && dateRange !== "custom") params.set("dateRange", dateRange);
    params.set("limit", "100");

    Promise.all([
      fetch(`/api/deliveries?${params}`).then((r) => r.json()),
      fetch("/api/deliveries/stats").then((r) => r.json()),
    ])
      .then(([listRes, statsRes]) => {
        if (listRes.success) setDeliveries(listRes.data);
        if (statsRes.success) setStats(statsRes.data);
      })
      .catch((e) => {
        if (typeof navigator !== "undefined" && !navigator.onLine) {
          setDataError("You're offline. Check your connection and retry.");
        } else {
          setDataError(e instanceof Error ? e.message : "Failed to load data. Tap retry.");
        }
      })
      .finally(() => setLoading(false));
  }, [filter, debouncedSearch, dateRange, dateFrom, dateTo]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ─── Handlers ───
  const handleMarkReady = async (id: string) => {
    try {
      const res = await fetch(`/api/deliveries/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "VERIFIED" }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setActionError(data.error || "Mark ready failed");
        return;
      }
      fetchData();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Network error");
    }
  };

  const handleDelete = async (id: string) => {
    setDeleting(id);
    try {
      const res = await fetch(`/api/deliveries/${id}`, { method: "DELETE" }).then((r) => r.json());
      if (!res.success) throw new Error(res.error || "Delete failed");
      setDeleteConfirm(null);
      fetchData();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeleting(null);
    }
  };

  const handleConvertToPrebook = async (d: DeliveryItem) => {
    setPrebooking(d.id);
    setPrebookConfirm(null);
    try {
      const itemName = d.lineItems?.[0]?.name || "Unknown product";
      const pbRes = await fetch("/api/prebookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerName: d.customerName,
          customerPhone: d.customerPhone || undefined,
          zohoInvoiceNo: d.invoiceNo,
          productName: itemName,
          salesPerson: d.salesPerson || undefined,
        }),
      }).then((r) => r.json());

      if (!pbRes.success) {
        setConfirmation({
          type: "error",
          title: "Pre-booking Failed",
          referenceId: d.invoiceNo,
          details: pbRes.error || "Failed to create pre-booking",
        });
        return;
      }

      const statusRes = await fetch(`/api/deliveries/${d.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "PREBOOKED" }),
      });
      const statusJson = await statusRes.json();
      if (!statusRes.ok || !statusJson.success) {
        setConfirmation({
          type: "error",
          title: "Pre-booking Status Failed",
          referenceId: d.invoiceNo,
          details: statusJson.error || "Failed to update delivery status to PREBOOKED",
        });
        return;
      }

      setConfirmation({
        type: "success",
        title: "Converted to Pre-booking",
        referenceId: d.invoiceNo,
        items: [
          { label: "Customer", value: d.customerName },
          { label: "Product", value: itemName },
        ],
      });
      fetchData();
    } catch {
      setConfirmation({
        type: "error",
        title: "Network Error",
        referenceId: d.invoiceNo,
        details: "Could not connect to server. Please try again.",
      });
    } finally {
      setPrebooking(null);
    }
  };

  const handleDateChange = (key: string, from: string | undefined, to: string | undefined) => {
    setDateRange(key);
    setDateFrom(from);
    setDateTo(to);
  };

  // ─── Render ───
  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-lg font-bold text-slate-900">Deliveries</h1>
        <div className="flex items-center gap-1.5">
          <ZohoImportFlow canFetch={canFetchInvoices} onImported={fetchData} />
        </div>
      </div>

      {/* Stats */}
      {stats && <DeliveryStats stats={stats} onFilterChange={setFilter} />}

      {/* Filters */}
      <DeliveryFilters
        filter={filter}
        onFilterChange={setFilter}
        stats={stats}
        dateRange={dateRange}
        dateFrom={dateFrom}
        dateTo={dateTo}
        onDateChange={handleDateChange}
      />

      {/* Local search */}
      <DeliverySearch value={search} onChange={setSearch} />

      {/* Action error banner */}
      {actionError && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-2.5 mb-2 text-xs text-amber-700">
          {actionError}
          <button onClick={() => setActionError("")} className="ml-2 underline">
            dismiss
          </button>
        </div>
      )}

      {/* Data load error */}
      {dataError && (
        <ErrorBanner
          message={dataError}
          type={typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "error"}
          onRetry={() => {
            setDataError(null);
            fetchData();
          }}
          onDismiss={() => setDataError(null)}
        />
      )}

      {/* Delivery Cards */}
      {loading ? (
        <SkeletonList count={6} type="card" />
      ) : deliveries.length === 0 ? (
        <div className="text-center py-12">
          <Truck className="h-8 w-8 text-slate-300 mx-auto mb-2" />
          <p className="text-sm text-slate-400">No deliveries found</p>
        </div>
      ) : (
        <>
        <DesktopTable
          className="hidden lg:block"
          rows={deliveries}
          rowKey={(d) => d.id}
          rowHref={(d) => `/deliveries/${d.id}`}
          emptyText="No deliveries found"
          columns={[
            { header: "Invoice", cell: (d) => (
              <div className="flex items-center gap-1.5">
                <span className="font-medium text-slate-900">{d.invoiceNo}</span>
                {d.isOutstation && <Badge variant="warning" className="text-[9px]">Outstation</Badge>}
                {d.reversePickup && <Badge variant="info" className="text-[9px]">Reverse</Badge>}
              </div>
            ) },
            { header: "Customer", cell: (d) => (
              <div>
                <p className="text-slate-800">{d.customerName}</p>
                {d.customerArea && <p className="text-[11px] text-slate-400">{d.customerArea}</p>}
              </div>
            ) },
            { header: "Items", cell: (d) => {
              const items = d.lineItems || [];
              const text = items.map((i) => `${i.name}${i.quantity > 1 ? ` x${i.quantity}` : ""}`).join(", ");
              return <span className="text-slate-500 line-clamp-1 max-w-[20rem] inline-block align-middle">{text || "—"}</span>;
            } },
            { header: "Amount", cell: (d) => <span className="tabular-nums">{new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(d.invoiceAmount)}</span>, className: "text-right whitespace-nowrap" },
            { header: "Date", cell: (d) => new Date(d.invoiceDate).toLocaleDateString("en-IN"), className: "whitespace-nowrap text-slate-500" },
            { header: "Status", cell: (d) => {
              const isPending = ["PENDING", "VERIFIED", "SCHEDULED"].includes(d.status);
              const aging = isPending ? getAging(d.invoiceDate) : null;
              return (
                <div className="flex items-center gap-1.5">
                  <Badge className={`text-[10px] ${getStatusColor(d.status)}`}>{getStatusLabel(d.status)}</Badge>
                  {aging && aging.level !== "ok" && <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded-full ${AGING_BADGE[aging.level]}`}>{aging.text}</span>}
                </div>
              );
            } },
            { header: "", className: "text-right", cell: (d) => (
              <div className="flex items-center justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
                {d.status === "PENDING" && (
                  <>
                    <Link href={`/deliveries/${d.id}`}><button className="px-2 py-1 rounded-md bg-blue-600 text-white text-xs font-medium">Schedule</button></Link>
                    <Link href={`/deliveries/${d.id}?action=walkout`}><button className="px-2 py-1 rounded-md bg-green-600 text-white text-xs font-medium">Walk-out</button></Link>
                    <button onClick={() => setPrebookConfirm(d)} disabled={prebooking === d.id} className="px-2 py-1 rounded-md bg-purple-600 text-white text-xs font-medium disabled:opacity-50">{prebooking === d.id ? <Loader2 className="h-3 w-3 animate-spin" /> : "Pre-book"}</button>
                  </>
                )}
                {d.status === "SCHEDULED" && <Link href="/deliveries/dispatch"><button className="px-2 py-1 rounded-md bg-orange-600 text-white text-xs font-medium">Dispatch</button></Link>}
                {d.status === "PREBOOKED" && <button onClick={() => handleMarkReady(d.id)} className="px-2 py-1 rounded-md bg-blue-600 text-white text-xs font-medium">Mark Ready</button>}
                {isAdmin && <button onClick={() => setDeleteConfirm(d.id)} disabled={deleting === d.id} className="p-1.5 rounded-md bg-slate-100 text-slate-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-50">{deleting === d.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}</button>}
              </div>
            ) },
          ]}
        />
        <div className="space-y-2.5 lg:hidden">
          {deliveries.map((d) => (
            <DeliveryCard
              key={d.id}
              delivery={d}
              onDelete={(id) => setDeleteConfirm(id)}
              onPrebook={(delivery) => setPrebookConfirm(delivery)}
              onMarkReady={handleMarkReady}
              isAdmin={isAdmin}
              deleting={deleting}
              prebooking={prebooking}
            />
          ))}
        </div>
        </>
      )}

      {/* Delete Confirmation */}
      <BottomSheetModal
        open={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        title="Delete Delivery?"
        description="This delivery entry will be permanently removed. This cannot be undone."
        actions={[
          {
            label: deleting === deleteConfirm ? "Deleting..." : "Delete",
            onClick: () => deleteConfirm && handleDelete(deleteConfirm),
            variant: "danger",
            loading: deleting === deleteConfirm,
            disabled: deleting === deleteConfirm,
          },
          {
            label: "Cancel",
            onClick: () => setDeleteConfirm(null),
            variant: "secondary",
          },
        ]}
      />

      {/* Pre-book Confirmation */}
      <BottomSheetModal
        open={!!prebookConfirm}
        onClose={() => setPrebookConfirm(null)}
        title="Convert to Pre-Booking?"
        description={
          prebookConfirm
            ? `${prebookConfirm.invoiceNo} will be converted to a pre-booking. The delivery status will change to Prebooked.`
            : undefined
        }
        actions={[
          {
            label: prebooking === prebookConfirm?.id ? "Converting..." : "Convert",
            onClick: () => prebookConfirm && handleConvertToPrebook(prebookConfirm),
            variant: "primary",
            loading: prebooking === prebookConfirm?.id,
            disabled: prebooking === prebookConfirm?.id,
          },
          {
            label: "Cancel",
            onClick: () => setPrebookConfirm(null),
            variant: "secondary",
          },
        ]}
      >
        {prebookConfirm && (
          <div className="bg-purple-50 rounded-lg p-3 space-y-1">
            <p className="text-sm text-purple-900">
              <span className="text-slate-500">Customer:</span> {prebookConfirm.customerName}
            </p>
            <p className="text-sm text-purple-900">
              <span className="text-slate-500">Product:</span>{" "}
              {prebookConfirm.lineItems?.[0]?.name || "Unknown"}
            </p>
          </div>
        )}
      </BottomSheetModal>

      {/* Action Confirmation */}
      <ActionConfirmation
        open={!!confirmation}
        onClose={() => setConfirmation(null)}
        type={confirmation?.type || "success"}
        title={confirmation?.title || ""}
        referenceId={confirmation?.referenceId || ""}
        items={confirmation?.items}
        details={confirmation?.details}
      />
    </div>
  );
}
