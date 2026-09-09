"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Search, Phone, Building2, Star } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { SkeletonList } from "@/components/ui/skeleton";
import { useDebounce } from "@/hooks/use-debounce";
import { ExportButtons } from "@/components/export-buttons";
import { FilterSheet } from "@/components/filter-sheet";
import { DesktopTable } from "@/components/desktop-table";
import { exportToExcel, exportToPDF, type ExportColumn } from "@/lib/export";
import { apiFetchEnvelope } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";

const log = createLogger("vendors");

const VENDOR_COLUMNS: ExportColumn[] = [
  { header: "Code", key: "code" },
  { header: "Name", key: "name" },
  { header: "City", key: "city" },
  { header: "Phone", key: "phone" },
  { header: "WhatsApp", key: "whatsappNumber" },
  { header: "Payment Terms (Days)", key: "paymentTermDays" },
  { header: "Opening Balance (Apr 1)", key: "openingBalance" },
  { header: "Status", key: "isActive", format: (v) => (v ? "Active" : "Inactive") },
  { header: "POs", key: "_count.purchaseOrders" },
  { header: "Bills", key: "_count.bills" },
];

interface VendorItem {
  id: string;
  name: string;
  code: string;
  city?: string;
  phone?: string;
  whatsappNumber?: string;
  isActive: boolean;
  paymentTermDays: number;
  /** Carried-forward balance as of 1 Apr 2026. Not the same number as outstandingBalance. */
  openingBalance: number;
  outstandingBalance: number;
  _count: { purchaseOrders: number; bills: number };
}

type VendorFilter = "ALL" | "ACTIVE" | "INACTIVE";
type VendorSort = "name" | "highest_due" | "lowest_due";

function getStarRating(billCount: number, allCounts: number[]): number {
  if (allCounts.length === 0 || billCount === 0) return 0;
  const sorted = [...allCounts].filter(c => c > 0).sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const idx = sorted.findIndex(c => c >= billCount);
  const pct = ((idx === -1 ? sorted.length : idx) / sorted.length) * 100;
  if (pct >= 80) return 5;
  if (pct >= 60) return 4;
  if (pct >= 40) return 3;
  if (pct >= 20) return 2;
  return 1;
}

export default function VendorsPage() {
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search);
  const [vendors, setVendors] = useState<VendorItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [activeFilter, setActiveFilter] = useState<VendorFilter>("ACTIVE");
  const [sortBy, setSortBy] = useState<VendorSort>("name");
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ limit: "100", includeInactive: "true" });
    if (debouncedSearch.length >= 2) params.set("search", debouncedSearch);

    try {
      // apiFetchEnvelope, not apiFetch: the row count lives in `pagination`, which sits
      // OUTSIDE `data` and apiFetch discards. Never a raw fetch().then(r => r.json()) —
      // an expired session answers 307 -> /login -> HTML with status 200, which `res.ok`
      // does not catch (CLAUDE.md).
      const { data, pagination } = await apiFetchEnvelope<VendorItem[]>(`/api/vendors?${params}`);
      setVendors(data);
      setTotal(pagination?.total ?? data.length);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not load vendors";
      setError(msg);
      log.error("failed to load vendors", { message: msg });
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const allBillCounts = vendors.map(v => v._count.bills);

  const statusFiltered = activeFilter === "ALL" ? vendors
    : activeFilter === "ACTIVE" ? vendors.filter((v) => v.isActive)
    : vendors.filter((v) => !v.isActive);

  const filtered = [...statusFiltered].sort((a, b) => {
    if (sortBy === "name") return a.name.localeCompare(b.name);
    if (sortBy === "highest_due") return b.outstandingBalance - a.outstandingBalance;
    if (sortBy === "lowest_due") return a.outstandingBalance - b.outstandingBalance;
    return 0;
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h1 className="text-lg font-bold text-slate-900">Vendors</h1>
        <ExportButtons
          onExcel={() => exportToExcel(vendors as unknown as Record<string, unknown>[], VENDOR_COLUMNS, "vendors")}
          onPDF={() => exportToPDF("Vendors List", vendors as unknown as Record<string, unknown>[], VENDOR_COLUMNS, "vendors")}
        />
      </div>

      <div className="relative mb-3">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <Input
          placeholder="Search vendor name, code, or city..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      <FilterSheet
        className="mb-2"
        groups={[{
          label: "Status",
          value: activeFilter,
          defaultValue: "ALL",
          options: [
            { key: "ALL", label: "All" },
            { key: "ACTIVE", label: "Active" },
            { key: "INACTIVE", label: "Inactive" },
          ],
          onChange: (key) => setActiveFilter(key as VendorFilter),
        }]}
      />

      <div className="flex gap-1.5 mb-3 pb-1">
        {([
          { key: "name", label: "Name A-Z" },
          { key: "highest_due", label: "Highest Due" },
          { key: "lowest_due", label: "Lowest Due" },
        ] as { key: VendorSort; label: string }[]).map((s) => (
          <button key={s.key} onClick={() => setSortBy(s.key)}
            className={`shrink-0 px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${
              sortBy === s.key ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200"
            }`}>
            {s.label}
          </button>
        ))}
      </div>

      <p className="text-xs text-slate-500 mb-2">Showing {filtered.length} of {total} vendors</p>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-center">
          <p className="text-sm font-medium text-red-700">Could not load vendors</p>
          <p className="text-xs text-red-600 mt-1">{error}</p>
          <button
            onClick={() => { fetchData(); }}
            className="mt-3 text-xs font-medium text-red-700 underline"
          >
            Retry
          </button>
        </div>
      ) : loading ? (
        <SkeletonList count={6} type="card" />
      ) : (
        <>
        <DesktopTable
          className="hidden lg:block"
          rows={filtered}
          rowKey={(v) => v.id}
          rowHref={(v) => `/vendors/${v.id}`}
          emptyText="No vendors found"
          columns={[
            { header: "Vendor", cell: (v) => {
              const stars = getStarRating(v._count.bills, allBillCounts);
              return (
                <div className="flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-slate-400 shrink-0" />
                  <span className="font-medium text-slate-900">{v.name}</span>
                  {stars > 0 && (
                    <span className="flex items-center gap-0.5 shrink-0">
                      {Array.from({ length: stars }).map((_, i) => (
                        <Star key={i} className="h-3 w-3 fill-amber-400 text-amber-400" />
                      ))}
                    </span>
                  )}
                </div>
              );
            } },
            { header: "City", cell: (v) => v.city || "—" },
            { header: "Bills", cell: (v) => v._count.bills || "—", className: "text-right w-20 tabular-nums" },
            { header: "Status", cell: (v) => <Badge variant={v.isActive ? "success" : "default"}>{v.isActive ? "Active" : "Inactive"}</Badge> },
            { header: "Opening Bal.", cell: (v) => v.openingBalance !== 0
              ? <span className="text-slate-700 tabular-nums">₹{v.openingBalance.toLocaleString("en-IN")}</span>
              : <span className="text-slate-400">—</span>, className: "text-right" },
            { header: "Outstanding", cell: (v) => v.outstandingBalance > 0
              ? <span className="font-medium text-red-600 tabular-nums">₹{v.outstandingBalance.toLocaleString("en-IN")}</span>
              : <span className="text-slate-400">—</span>, className: "text-right" },
            { header: "", cell: (v) => v.phone
              ? <a href={`tel:${v.phone}`} onClick={(e) => e.stopPropagation()} className="inline-flex p-1.5 rounded-full hover:bg-slate-100"><Phone className="h-4 w-4 text-slate-500" /></a>
              : null, className: "w-12" },
          ]}
        />
        <div className="space-y-2 lg:hidden">
          {filtered.map((v) => {
            const stars = getStarRating(v._count.bills, allBillCounts);
            const accent = v.outstandingBalance > 0
              ? "border-l-red-500"
              : v.isActive
              ? "border-l-green-500"
              : "border-l-slate-200";
            return (
            // The card is a DIV, not a Link. The call button inside it is an <a href="tel:">,
            // and an <a> inside an <a> is invalid HTML — React's validateDOMNesting warned on
            // every render of this list and it would break hydration. So the row link is an
            // absolutely-positioned overlay that covers the card, and the call button sits
            // above it on z-10. Both stay real links; neither contains the other.
            <div
              key={v.id}
              className={`relative rounded-xl border border-slate-200 border-l-4 ${accent} bg-white shadow-sm transition-colors active:bg-slate-50 focus-within:ring-2 focus-within:ring-slate-900`}
            >
              <Link
                href={`/vendors/${v.id}`}
                aria-label={v.name}
                className="absolute inset-0 z-0 rounded-xl focus:outline-none"
              />
              <div className="p-3">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0 mr-3">
                    <div className="flex items-center gap-2">
                      <Building2 className="h-4 w-4 text-slate-400 shrink-0" />
                      <p className="text-sm font-semibold text-slate-900 truncate">{v.name}</p>
                      {stars > 0 && (
                        <span className="flex items-center gap-0.5 shrink-0" title={`${stars}/5 — based on ${v._count.bills} bills`}>
                          {Array.from({ length: stars }).map((_, i) => (
                            <Star key={i} className="h-3 w-3 fill-amber-400 text-amber-400" />
                          ))}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5 ml-6">
                      {v.city || "—"} {v._count.bills > 0 ? <span className="tabular-nums">| {v._count.bills} Bills</span> : ""}
                    </p>
                    <div className="flex items-center gap-2 mt-1.5 ml-6">
                      <Badge variant={v.isActive ? "success" : "default"}>
                        {v.isActive ? "Active" : "Inactive"}
                      </Badge>
                      {v.outstandingBalance > 0 && (
                        <span className="text-xs font-semibold text-red-600 tabular-nums">
                          ₹{v.outstandingBalance.toLocaleString("en-IN")} due
                        </span>
                      )}
                      {v.openingBalance !== 0 && (
                        <span className="text-xs text-slate-600 tabular-nums">
                          ₹{v.openingBalance.toLocaleString("en-IN")} opening
                        </span>
                      )}
                    </div>
                  </div>
                  {v.phone && (
                    <a
                      href={`tel:${v.phone}`}
                      className="relative z-10 p-2 rounded-full hover:bg-slate-100"
                    >
                      <Phone className="h-4 w-4 text-slate-500" />
                    </a>
                  )}
                </div>
              </div>
            </div>
            );
          })}

          {filtered.length === 0 && (
            <div className="text-center py-12">
              <Building2 className="h-8 w-8 text-slate-300 mx-auto mb-2" />
              <p className="text-sm text-slate-400">No vendors found</p>
            </div>
          )}
        </div>
        </>
      )}
    </div>
  );
}
