"use client";

import { useState, useEffect, use, useMemo } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Search, Package, Loader2, ChevronDown, Warehouse, Store } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { DesktopTable } from "@/components/desktop-table";


interface LocProduct {
  id: string;
  name: string;
  sku: string;
  brandId: string | null;
  brandName: string;
  qty: number;
  value: number;
  reorderLevel: number;
}
interface LocData {
  code: string;
  // "warehouse" shows one warehouse; "store" sums across every warehouse at that site.
  level: "warehouse" | "store";
  label: string;
  // Per-warehouse totals, present only at store level.
  warehouses: Array<{ code: string; name: string; units: number }> | null;
  totalUnits: number;
  totalValue: number;
  productCount: number;
  products: LocProduct[];
}

function formatINR(n: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
}

export default function StockByLocationDetailPage({ params }: { params: Promise<{ location: string }> }) {
  const { location } = use(params);
  const router = useRouter();
  const [data, setData] = useState<LocData | null>(null);
  const [loading, setLoading] = useState(true);
  const [brandFilter, setBrandFilter] = useState("ALL");
  const [search, setSearch] = useState("");

  // "store" or "warehouse", straight from the API — a store view sums across its
  // warehouses, and the page says which it is showing rather than guessing from the code.
  const kind = data?.level;

  useEffect(() => {
    fetch(`/api/stock/by-location/${location}`)
      .then((r) => r.json())
      .then((res) => { if (res.success) setData(res.data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [location]);

  const goBack = () => {
    if (typeof window !== "undefined" && window.history.length > 1) router.back();
    else router.push("/stock/by-bin");
  };

  // Brands present in this location, with per-brand unit totals (for the dropdown).
  const brands = useMemo(() => {
    const map = new Map<string, { key: string; name: string; qty: number }>();
    for (const p of data?.products || []) {
      const key = p.brandId || "UNBRANDED";
      const cur = map.get(key) || { key, name: p.brandName, qty: 0 };
      cur.qty += p.qty;
      map.set(key, cur);
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [data]);

  const filtered = useMemo(() => {
    let list = data?.products || [];
    if (brandFilter !== "ALL") list = list.filter((p) => (p.brandId || "UNBRANDED") === brandFilter);
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((p) => p.name.toLowerCase().includes(q) || (p.sku || "").toLowerCase().includes(q));
    return list;
  }, [data, brandFilter, search]);

  const shownUnits = filtered.reduce((s, p) => s + p.qty, 0);
  const shownValue = filtered.reduce((s, p) => s + p.value, 0);
  const label = data?.label || location;

  return (
    <div className="pb-10">
      <div className="flex items-center gap-3 mb-3">
        <button onClick={goBack} className="p-1" aria-label="Back"><ArrowLeft className="h-5 w-5 text-slate-600" /></button>
        <div className={`h-9 w-9 rounded-xl flex items-center justify-center ${kind === "warehouse" ? "bg-amber-100 text-amber-700" : "bg-blue-100 text-blue-700"}`}>
          {kind === "warehouse" ? <Warehouse className="h-5 w-5" /> : <Store className="h-5 w-5" />}
        </div>
        <div className="flex-1">
          <h1 className="text-lg font-bold text-slate-900">{label}</h1>
          <p className="text-xs text-slate-500">
            {data ? `${data.totalUnits.toLocaleString("en-IN")} units | ${formatINR(data.totalValue)}` : "Loading…"}
          </p>
        </div>
      </div>

      {/* Brand selector */}
      <div className="relative mb-3">
        <select
          value={brandFilter}
          onChange={(e) => setBrandFilter(e.target.value)}
          className="w-full appearance-none h-11 pl-3 pr-9 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900"
          aria-label="Filter by brand"
        >
          <option value="ALL">All brands ({(data?.totalUnits ?? 0).toLocaleString("en-IN")} units)</option>
          {brands.map((b) => (
            <option key={b.key} value={b.key}>{b.name} ({b.qty.toLocaleString("en-IN")})</option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
      </div>

      {/* Search */}
      <div className="relative mb-3">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <Input placeholder="Search product name or SKU…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
      </div>

      {/* Shown totals */}
      {!loading && (
        <div className="flex items-center justify-between mb-3 text-xs">
          <span className="text-slate-500">{filtered.length} product{filtered.length === 1 ? "" : "s"}{brandFilter !== "ALL" ? " · this brand" : ""}</span>
          <span className="font-semibold text-slate-700">{shownUnits.toLocaleString("en-IN")} units · {formatINR(shownValue)}</span>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16 gap-2">
          <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
          <span className="text-sm text-slate-400">Loading…</span>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12">
          <Package className="h-10 w-10 text-slate-300 mx-auto mb-2" />
          <p className="text-sm text-slate-400">No stock here{brandFilter !== "ALL" ? " for this brand" : ""}.</p>
        </div>
      ) : (
        <>
          <DesktopTable
            className="hidden lg:block"
            rows={filtered}
            rowKey={(p) => p.id}
            rowHref={(p) => `/stock/${p.id}`}
            emptyText="No products"
            columns={[
              { header: "Product", cell: (p) => (
                <div>
                  <span className="font-medium text-slate-900">{p.name}</span>
                  {p.sku && <span className="block text-[11px] text-slate-400">{p.sku}</span>}
                </div>
              ) },
              { header: "Brand", cell: (p) => <span className="text-slate-600">{p.brandName}</span> },
              { header: "Units", className: "text-right whitespace-nowrap", cell: (p) => <span className="font-semibold text-slate-900 tabular-nums">{p.qty.toLocaleString("en-IN")}</span> },
              { header: "Value", className: "text-right whitespace-nowrap", cell: (p) => <span className="text-slate-600 tabular-nums">{formatINR(p.value)}</span> },
            ]}
          />
          <div className="space-y-2 lg:hidden">
            {filtered.map((p) => (
              <Card key={p.id} className="mb-2">
                <CardContent className="p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-900 line-clamp-2">{p.name}</p>
                      <p className="text-xs text-slate-500 mt-0.5">{p.brandName}{p.sku ? ` · ${p.sku}` : ""}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-base font-bold text-slate-800 tabular-nums">{p.qty.toLocaleString("en-IN")}</p>
                      <p className="text-[10px] text-slate-400">units</p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between border-t border-slate-100 mt-2 pt-1.5">
                    <span className="text-[11px] text-slate-400">Stock value</span>
                    <span className="text-xs font-semibold text-slate-600">{formatINR(p.value)}</span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
