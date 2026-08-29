"use client";
import { useDebounce } from "@/hooks/use-debounce";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Loader2, Truck, Phone, MapPin, Package, Search } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getAging, AGING_COLORS, formatINR } from "@/lib/utils";
import { getStatusColor, getStatusLabel } from "@/lib/status-colors";

interface DeliveryListViewProps {
  title: string;
  backHref: string;
  fetchUrl: string;
  fetchParams?: Record<string, string>;
  statusFilters: string[];
  clientFilter?: (d: DeliveryItem) => boolean;
  showCourier?: boolean;
  showAging?: boolean;
  emptyMessage?: string;
}

interface DeliveryItem {
  id: string;
  invoiceNo: string;
  invoiceDate: string;
  invoiceAmount: number;
  customerName: string;
  customerPhone: string | null;
  customerArea: string | null;
  status: string;
  scheduledDate: string | null;
  lineItems: Array<{ name: string; quantity: number }> | null;
  salesPerson: string | null;
  courierName?: string | null;
  trackingNo?: string | null;
  deliveredAt?: string | null;
}

function formatFilterLabel(f: string): string {
  if (f === "ALL") return "All";
  return getStatusLabel(f);
}

export function DeliveryListView({
  title,
  backHref,
  fetchUrl,
  fetchParams,
  statusFilters,
  clientFilter,
  showCourier = false,
  showAging = true,
  emptyMessage = "No deliveries",
}: DeliveryListViewProps) {
  const router = useRouter();
  const [deliveries, setDeliveries] = useState<DeliveryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);
  const [statusFilter, setStatusFilter] = useState("ALL");

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "100", ...fetchParams });
      if (statusFilter !== "ALL") params.set("status", statusFilter);
      if (debouncedSearch) params.set("search", debouncedSearch);
      const res = await fetch(`${fetchUrl}?${params}`).then((r) => r.json());
      if (res.success) {
        const data: DeliveryItem[] = res.data;
        setDeliveries(clientFilter ? data.filter(clientFilter) : data);
      }
    } catch {
      /* ignore */
    }
    setLoading(false);
  }, [fetchUrl, fetchParams, statusFilter, debouncedSearch, clientFilter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const hasFilters = statusFilters.length > 0;

  return (
    <div className="pb-20">
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <Link href={backHref} className="min-h-[48px] min-w-[48px] flex items-center justify-center -ml-2">
          <ArrowLeft className="h-5 w-5 text-slate-600" />
        </Link>
        <h1 className="text-lg font-bold text-slate-900">{title}</h1>
        <Badge variant="default" className="ml-auto text-xs">
          {deliveries.length}
        </Badge>
      </div>

      {/* Search */}
      <div className="relative mb-2">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <input
          type="text"
          placeholder="Search customer, invoice..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-8 pr-3 py-2.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-400"
        />
      </div>

      {/* Status Filter Chips */}
      {hasFilters && (
        <div className="flex gap-1.5 overflow-x-auto scrollbar-hide mb-3 pb-1">
          {statusFilters.map((f) => (
            <button
              key={f}
              onClick={() => setStatusFilter(f)}
              className={`shrink-0 px-3 py-2 rounded-full text-xs font-medium transition-colors min-h-[40px] ${
                statusFilter === f
                  ? "bg-slate-900 text-white"
                  : "bg-slate-100 text-slate-600"
              }`}
            >
              {formatFilterLabel(f)}
            </button>
          ))}
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
        </div>
      ) : deliveries.length === 0 ? (
        <div className="text-center py-12">
          <Truck className="h-8 w-8 text-slate-300 mx-auto mb-2" />
          <p className="text-sm text-slate-500">{emptyMessage}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {deliveries.map((d) => {
            const aging = showAging ? getAging(d.invoiceDate) : null;
            const firstItem = d.lineItems?.[0]?.name;
            const extraCount = (d.lineItems?.length ?? 0) - 1;

            return (
              <Card
                key={d.id}
                className="cursor-pointer hover:shadow-md transition-shadow"
                onClick={() => router.push(`/deliveries/${d.id}`)}
              >
                <CardContent className="p-3.5">
                  {/* Top row: name + badges */}
                  <div className="flex items-start justify-between mb-1.5">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-900 truncate">
                        {d.customerName}
                      </p>
                      <p className="text-xs text-slate-500">{d.invoiceNo}</p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0 ml-2">
                      {aging && (
                        <Badge className={`text-xs ${AGING_COLORS[aging.level] || ""}`}>
                          {aging.text}
                        </Badge>
                      )}
                      <Badge className={`text-xs ${getStatusColor(d.status)}`}>
                        {getStatusLabel(d.status)}
                      </Badge>
                    </div>
                  </div>

                  {/* Area */}
                  {d.customerArea && (
                    <div className="flex items-center gap-1 text-xs text-slate-500 mb-1">
                      <MapPin className="h-3 w-3 shrink-0" /> {d.customerArea}
                    </div>
                  )}

                  {/* Line items */}
                  {firstItem && (
                    <p className="text-xs text-slate-700 mb-1 truncate">
                      <Package className="h-3 w-3 inline mr-0.5" />
                      {firstItem}
                      {extraCount > 0 && ` +${extraCount} more`}
                    </p>
                  )}

                  {/* Bottom row: meta + phone */}
                  <div className="flex items-center justify-between mt-1.5">
                    <div className="flex items-center gap-2 text-xs text-slate-500 flex-wrap">
                      <span>{formatINR(d.invoiceAmount)}</span>
                      {d.salesPerson && <span>{d.salesPerson}</span>}
                      {showCourier ? (
                        <>
                          {d.courierName && <span>{d.courierName}</span>}
                          {d.trackingNo && <span>{d.trackingNo}</span>}
                        </>
                      ) : (
                        <>
                          {d.scheduledDate && (
                            <span>
                              {new Date(d.scheduledDate).toLocaleDateString("en-IN")}
                            </span>
                          )}
                          {d.deliveredAt && (
                            <span>
                              {new Date(d.deliveredAt).toLocaleDateString("en-IN")}
                            </span>
                          )}
                        </>
                      )}
                    </div>
                    {d.customerPhone && (
                      <a
                        href={`tel:${d.customerPhone}`}
                        onClick={(e) => e.stopPropagation()}
                        className="min-h-[48px] min-w-[48px] flex items-center justify-center rounded-full bg-green-100 text-green-700"
                      >
                        <Phone className="h-4 w-4" />
                      </a>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
