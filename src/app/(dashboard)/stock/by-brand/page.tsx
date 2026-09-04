"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { usePermissions } from "@/lib/use-permissions";
import { ArrowLeft, ChevronDown, ChevronRight, Search, AlertTriangle, Package, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useDebounce } from "@/hooks/use-debounce";
import { BIN_TRACKING_ENABLED } from "@/lib/inventory-config";

// WhatsApp glyph (lucide has no brand icon)
function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.149-.197.297-.767.967-.94 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.521.149-.174.198-.298.298-.497.099-.198.05-.372-.025-.521-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51l-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.71.306 1.263.489 1.694.625.712.227 1.36.195 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}

interface BrandProduct {
  id: string;
  name: string;
  sku: string;
  currentStock: number;
  reorderLevel: number;
  sellingPrice: number;
  mrp: number;
  category: { name: string } | null;
  bin: { code: string; name: string; location: string } | null;
}

interface BrandStock {
  id: string;
  name: string;
  contactPhone: string | null;
  whatsappNumber: string | null;
  productCount: number;
  totalStock: number;
  lowStockCount: number;
  outOfStockCount: number;
  totalValue: number;
  byLocation?: Record<string, number>;
  products?: BrandProduct[];
}

// The per-warehouse breakdown chips. Was a hardcoded list of the four old enum values;
// warehouses are rows, so the chips are built from whatever the API actually returned for
// this brand. A warehouse added today shows up with no code change.

type SortKey = "name" | "value" | "count" | "stock";

export default function BrandStockPage() {
  const { canView } = usePermissions();
  // Both uses are money: the per-brand total value, and the sort option that ranks by it.
  // Offering "Highest Value" to someone who cannot see the values sorts by an invisible key.
  const isAdmin = canView("cost_price");
  const [brands, setBrands] = useState<BrandStock[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loadingBrands, setLoadingBrands] = useState<Set<string>>(new Set());
  const [sharing, setSharing] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search);
  const [sortBy, setSortBy] = useState<SortKey>("name");

  const fetchBrandProducts = useCallback(async (brandId: string): Promise<BrandProduct[]> => {
    const res = await fetch(`/api/products?brandId=${brandId}&status=ACTIVE&limit=500&sortBy=name&sortOrder=asc`);
    const data = await res.json();
    return data.success ? (data.data as BrandProduct[]) : [];
  }, []);

  // Build the brand's in-stock list and open WhatsApp to share it.
  const shareBrandWhatsApp = useCallback(async (e: React.MouseEvent, brand: BrandStock) => {
    e.stopPropagation();
    setSharing((prev) => new Set(prev).add(brand.id));
    try {
      let products = brand.products;
      if (!products) {
        products = await fetchBrandProducts(brand.id);
        setBrands((prev) => prev.map((b) => (b.id === brand.id ? { ...b, products } : b)));
      }
      const inStock = (products || [])
        .filter((p) => p.currentStock >= 1)
        .sort((a, b) => a.name.localeCompare(b.name));

      const lines: string[] = [];
      lines.push(`📦 *${brand.name} — Stock*`);
      lines.push(`📅 ${new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}`);
      lines.push("");
      if (inStock.length === 0) {
        lines.push("No items in stock.");
      } else {
        inStock.forEach((p, i) => {
          lines.push(`${i + 1}. ${p.name}`);
          lines.push(`   ${p.sku} · Qty: ${p.currentStock}`);
        });
        const totalUnits = inStock.reduce((s, p) => s + p.currentStock, 0);
        lines.push("");
        lines.push(`📊 ${inStock.length} models · ${totalUnits} units`);
      }
      lines.push("\n_Sent from BCH OPS App_");
      window.open(`https://wa.me/?text=${encodeURIComponent(lines.join("\n"))}`, "_blank");
    } finally {
      setSharing((prev) => { const n = new Set(prev); n.delete(brand.id); return n; });
    }
  }, [fetchBrandProducts]);

  useEffect(() => {
    fetch("/api/stock/by-brand")
      .then((r) => r.json())
      .then((res) => { if (res.success) setBrands(res.data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Lazy-load products for a brand when expanded
  const loadBrandProducts = useCallback(async (brandId: string) => {
    setLoadingBrands((prev) => new Set(prev).add(brandId));
    try {
      const products = await fetchBrandProducts(brandId);
      setBrands((prev) => prev.map((b) => (b.id === brandId ? { ...b, products } : b)));
    } catch {}
    setLoadingBrands((prev) => {
      const next = new Set(prev);
      next.delete(brandId);
      return next;
    });
  }, [fetchBrandProducts]);

  const searched = debouncedSearch
    ? brands.filter((b) =>
        b.name.toLowerCase().includes(debouncedSearch.toLowerCase())
      )
    : brands;

  const filtered = [...searched].sort((a, b) => {
    if (sortBy === "name") return a.name.localeCompare(b.name);
    if (sortBy === "value") return b.totalValue - a.totalValue;
    if (sortBy === "count") return b.productCount - a.productCount;
    if (sortBy === "stock") return b.totalStock - a.totalStock;
    return 0;
  });

  const totalProducts = filtered.reduce((s, b) => s + b.productCount, 0);
  const totalStock = filtered.reduce((s, b) => s + b.totalStock, 0);
  const totalLow = filtered.reduce((s, b) => s + b.lowStockCount, 0);

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
        // Lazy-load products if not already loaded
        const brand = brands.find((b) => b.id === id);
        if (brand && !brand.products) {
          loadBrandProducts(id);
        }
      }
      return next;
    });
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-3">
        <Link href="/stock" className="p-1">
          <ArrowLeft className="h-5 w-5 text-slate-600" />
        </Link>
        <div className="flex-1">
          <h1 className="text-lg font-bold text-slate-900">Stock by Brand</h1>
          <p className="text-xs text-slate-500">
            {totalProducts} products | {totalStock.toLocaleString("en-IN")} units | {totalLow} low stock
          </p>
        </div>
      </div>

      <div className="relative mb-2">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <Input
          placeholder="Search brand..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      <div className="flex gap-1.5 mb-3 overflow-x-auto scrollbar-hide pb-1">
        {([
          { key: "name", label: "Name A-Z" },
          ...(isAdmin ? [{ key: "value" as SortKey, label: "Highest Value" }] : []),
          { key: "count", label: "Most Products" },
          { key: "stock", label: "Most Stock" },
        ] as { key: SortKey; label: string }[]).map((s) => (
          <button key={s.key} onClick={() => setSortBy(s.key)}
            className={`shrink-0 px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${
              sortBy === s.key ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200"
            }`}>
            {s.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="p-4 border border-slate-100 rounded-lg animate-pulse">
              <div className="h-4 bg-slate-200 rounded w-1/3 mb-2" />
              <div className="h-3 bg-slate-200 rounded w-1/2" />
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12">
          <Package className="h-10 w-10 text-slate-300 mx-auto mb-2" />
          <p className="text-sm text-slate-400">No brands found</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((brand) => {
            const isExpanded = expanded.has(brand.id);
            const isLoadingProducts = loadingBrands.has(brand.id);

            return (
              <Card key={brand.id}>
                <CardContent className="p-0">
                  <div className="w-full p-3 flex items-center gap-2">
                    <button
                      onClick={() => toggle(brand.id)}
                      className="flex-1 min-w-0 flex items-center gap-3 text-left"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold text-slate-900">{brand.name}</p>
                          {brand.lowStockCount > 0 && (
                            <Badge variant="warning" className="text-[10px]">
                              <AlertTriangle className="h-2.5 w-2.5 mr-0.5" />
                              {brand.lowStockCount} low
                            </Badge>
                          )}
                          {brand.outOfStockCount > 0 && (
                            <Badge variant="danger" className="text-[10px]">
                              {brand.outOfStockCount} out
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {brand.productCount} products | {brand.totalStock.toLocaleString("en-IN")} units
                        </p>
                        {brand.byLocation && Object.values(brand.byLocation).some((v) => v > 0) && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {Object.keys(brand.byLocation ?? {}).sort().map((code) => {
                              const l = { key: code, label: code.replace(/_/g, " ") };
                              const q = brand.byLocation?.[l.key] || 0;
                              if (q <= 0) return null;
                              return (
                                <span key={l.key} className="inline-flex items-center rounded-full bg-slate-100 text-slate-600 px-2 py-0.5 text-[10px] font-medium">
                                  {l.label} {q.toLocaleString("en-IN")}
                                </span>
                              );
                            })}
                          </div>
                        )}
                      </div>
                      {isAdmin && (
                        <div className="text-right shrink-0">
                          <p className="text-sm font-bold text-slate-700">
                            {new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(brand.totalValue)}
                          </p>
                        </div>
                      )}
                      {isExpanded ? (
                        <ChevronDown className="h-4 w-4 text-slate-400 shrink-0" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-slate-400 shrink-0" />
                      )}
                    </button>
                    <button
                      onClick={(e) => shareBrandWhatsApp(e, brand)}
                      disabled={sharing.has(brand.id)}
                      title={`Send ${brand.name} stock on WhatsApp`}
                      aria-label={`Send ${brand.name} stock on WhatsApp`}
                      className="shrink-0 w-9 h-9 rounded-full bg-green-500 hover:bg-green-600 flex items-center justify-center active:scale-95 transition-transform disabled:opacity-50"
                    >
                      {sharing.has(brand.id)
                        ? <Loader2 className="h-4 w-4 text-white animate-spin" />
                        : <WhatsAppIcon className="h-[18px] w-[18px] text-white" />}
                    </button>
                  </div>

                  {isExpanded && (
                    <div className="border-t border-slate-100 px-3 pb-3">
                      {isLoadingProducts ? (
                        <div className="flex items-center justify-center py-4 gap-2">
                          <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
                          <span className="text-xs text-slate-400">Loading products...</span>
                        </div>
                      ) : brand.products ? (
                        brand.products.filter((p) => p.currentStock >= 1).length === 0 ? (
                          <p className="text-xs text-slate-400 text-center py-3">No items in stock</p>
                        ) : (
                          brand.products.filter((p) => p.currentStock >= 1).map((p) => (
                            <Link key={p.id} href={`/stock/${p.id}`}>
                              <div className="flex items-center gap-2 py-2 border-b border-slate-50 last:border-0 hover:bg-slate-50 -mx-1 px-1 rounded">
                                <div className="flex-1 min-w-0">
                                  <p className="text-xs font-medium text-slate-800 truncate">{p.name}</p>
                                  <p className="text-[10px] text-slate-400">
                                    {p.sku} | {p.category?.name || ""} {BIN_TRACKING_ENABLED && p.bin ? `| ${p.bin.code}` : ""}
                                  </p>
                                </div>
                                <div className="text-right shrink-0">
                                  <p className={`text-sm font-bold ${
                                    p.reorderLevel > 0 && p.currentStock <= p.reorderLevel ? "text-yellow-600" : "text-green-600"
                                  }`}>{p.currentStock}</p>
                                </div>
                              </div>
                            </Link>
                          ))
                        )
                      ) : null}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
