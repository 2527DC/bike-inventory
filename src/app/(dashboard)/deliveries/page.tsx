"use client";
import { useDebounce } from "@/hooks/use-debounce";

import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { Truck } from "lucide-react";
import { usePermissions } from "@/lib/use-permissions";
import { apiFetch, apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";
import { SkeletonList } from "@/components/ui/skeleton";
import { ActionConfirmation } from "@/components/ui/action-confirmation";
import { ErrorBanner } from "@/components/ui/error-banner";
import { DeliveryStats, type Stats } from "./_components/delivery-stats";
import { DeliverySearch } from "./_components/delivery-search";
import { DeliveryFilters } from "./_components/delivery-filters";
import { DeliveryCard, type DeliveryItem } from "./_components/delivery-card";
import { DeliveryTable } from "./_components/delivery-table";
import { MatchWarehousesButton } from "./_components/match-warehouses-button";
import { ZohoImportFlow } from "./_components/zoho-import-flow";
import { BottomSheetModal } from "./_components/bottom-sheet-modal";

const log = createLogger("deliveries:list");

export default function DeliveriesPage() {
  const { canFetch, canApprove, canDelete, canEdit } = usePermissions();
  // "Match warehouses" writes Delivery.warehouseId — deliveries.edit (plan 1609 A43b).
  const canMatchWarehouses = canEdit("deliveries");
  const canFetchInvoices = canFetch("zoho");
  // The IMPORT gate. The component has never had one — only the Fetch button was gated —
  // so anyone who could open the panel could also write Delivery rows. The route now
  // requires zoho.approve; this is the matching client-side courtesy (the API re-checks).
  const canImportInvoices = canApprove("zoho");
  // Gates the delete button and is handed to the child as a prop. Deleting a delivery is
  // exactly deliveries.delete.
  const isAdmin = canDelete("deliveries");

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
      apiFetch<DeliveryItem[]>(`/api/deliveries?${params}`),
      apiFetch<Stats>("/api/deliveries/stats"),
    ])
      .then(([list, statsData]) => {
        setDeliveries(list);
        setStats(statsData);
      })
      .catch((e) => {
        log.warn("deliveries load failed", { filter, error: e instanceof Error ? e.message : String(e) });
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
    const res = await apiTry(`/api/deliveries/${id}`, { method: "PUT", json: { status: "VERIFIED" } });
    if (res.error) {
      log.warn("mark ready failed", { deliveryId: id, status: res.status });
      setActionError(res.error);
      return;
    }
    fetchData();
  };

  const handleDelete = async (id: string) => {
    setDeleting(id);
    const res = await apiTry(`/api/deliveries/${id}`, { method: "DELETE" });
    setDeleting(null);
    if (res.error) {
      log.warn("delete failed", { deliveryId: id, status: res.status });
      setActionError(res.error);
      return;
    }
    log.info("delivery deleted", { deliveryId: id });
    setDeleteConfirm(null);
    fetchData();
  };

  const handleConvertToPrebook = async (d: DeliveryItem) => {
    setPrebooking(d.id);
    setPrebookConfirm(null);
    try {
      const itemName = d.lineItems?.[0]?.name || "Unknown product";
      const pbRes = await apiTry("/api/prebookings", {
        method: "POST",
        json: {
          customerName: d.customerName,
          customerPhone: d.customerPhone || undefined,
          zohoInvoiceNo: d.invoiceNo,
          productName: itemName,
          salesPerson: d.salesPerson || undefined,
        },
      });

      if (pbRes.error) {
        log.warn("pre-booking create failed", { deliveryId: d.id, status: pbRes.status });
        setConfirmation({
          type: "error",
          title: "Pre-booking Failed",
          referenceId: d.invoiceNo,
          details: pbRes.error,
        });
        return;
      }

      const statusRes = await apiTry(`/api/deliveries/${d.id}`, { method: "PUT", json: { status: "PREBOOKED" } });
      if (statusRes.error) {
        log.warn("pre-booking status failed", { deliveryId: d.id, status: statusRes.status });
        setConfirmation({
          type: "error",
          title: "Pre-booking Status Failed",
          referenceId: d.invoiceNo,
          details: statusRes.error,
        });
        return;
      }
      log.info("converted to pre-booking", { deliveryId: d.id });

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
    } catch (e) {
      // apiTry never throws; kept so an unexpected fault still reaches the screen.
      log.error("pre-booking failed", { deliveryId: d.id, error: e instanceof Error ? e.message : String(e) });
      setConfirmation({
        type: "error",
        title: "Pre-booking Failed",
        referenceId: d.invoiceNo,
        details: e instanceof Error ? e.message : "Please try again.",
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
      {/* Header.
          `flex-wrap` + `gap-y-2` is load-bearing, not styling. ZohoImportFlow renders a
          trigger button AND — once opened — a `w-full` inline panel, banners and result
          cards. Being full width, each of those wraps onto its own line beneath the title
          row instead of being squeezed into it. That is what makes the fetch UI inline on
          the page rather than a modal covering the delivery list (R1). */}
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-2 mb-2">
        <h1 className="text-lg font-bold text-slate-900">Deliveries</h1>
        <ZohoImportFlow canFetch={canFetchInvoices} canImport={canImportInvoices} onImported={fetchData} />
      </div>

      {canMatchWarehouses && <MatchWarehousesButton onMatched={fetchData} />}

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
        <DeliveryTable
          deliveries={deliveries}
          isAdmin={isAdmin}
          deleting={deleting}
          prebooking={prebooking}
          onDelete={(id) => setDeleteConfirm(id)}
          onPrebook={(delivery) => setPrebookConfirm(delivery)}
          onMarkReady={handleMarkReady}
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
