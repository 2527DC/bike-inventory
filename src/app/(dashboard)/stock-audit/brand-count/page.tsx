"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import {
  ArrowLeft, MapPin, Check, Loader2, ChevronDown, ChevronRight, Send, X, Pencil, Search,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { BIN_TRACKING_ENABLED } from "@/lib/inventory-config";
import { useWarehouses } from "@/hooks/use-sites";

interface Brand { id: string; name: string; _count: { products: number } }
interface BinOption { id: string; code: string; name: string; location: string }
interface CategoryOption { id: string; name: string }
interface ProductItem {
  id: string; sku: string; name: string; type: string; size: string | null;
  currentStock: number; reorderLevel: number; reorderQty: number;
  category: { name: string } | null; brand: { name: string } | null;
}
interface SearchResult {
  id: string; sku: string; name: string; type: string;
  currentStock: number; reorderLevel: number;
  category: { name: string } | null; brand: { name: string } | null;
}

type Step = "brand" | "bin" | "count" | "submitted";
type InlineEdit = { productId: string; field: "brand" | "category" } | null;

// Auto-save key for an in-progress count, so a refresh / accidental close
// doesn't wipe everything the user has entered.
const DRAFT_KEY = "brand-count-draft";

function clearBrandCountDraft() {
  try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
}

export default function BrandCountPage() {
  const { warehouses } = useWarehouses();
  const locationName = (id: string | null | undefined) =>
    warehouses.find((w) => w.id === id)?.name ?? "—";
  const { data: session } = useSession();
  const userName = (session?.user as { name?: string })?.name || "You";

  const [step, setStep] = useState<Step>("brand");
  const [brands, setBrands] = useState<Brand[]>([]);
  const [bins, setBins] = useState<BinOption[]>([]);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [selectedBrand, setSelectedBrand] = useState<Brand | null>(null);
  const [selectedBin, setSelectedBin] = useState<BinOption | null>(null);
  const [selectedLocation, setSelectedLocation] = useState<string | null>(null);
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [counts, setCounts] = useState<Record<string, { qty: number | null; reorder: number | null }>>({});
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [brandSearch, setBrandSearch] = useState("");
  const [resultId, setResultId] = useState("");
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [draftRestored, setDraftRestored] = useState(false);

  // Inline brand/category edit
  const [inlineEdit, setInlineEdit] = useState<InlineEdit>(null);
  const [reclassifying, setReclassifying] = useState<Set<string>>(new Set());

  // "Not in list" search
  const [notInListSearch, setNotInListSearch] = useState("");
  const [notInListResults, setNotInListResults] = useState<SearchResult[]>([]);
  const [notInListSearching, setNotInListSearching] = useState(false);

  // Restore an in-progress count after a refresh / reopen.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const d = JSON.parse(raw) as {
        step?: Step;
        selectedBrand?: Brand | null;
        selectedBin?: BinOption | null;
        selectedLocation?: string | null;
        products?: ProductItem[];
        counts?: Record<string, { qty: number | null; reorder: number | null }>;
      };
      if (d.step && d.step !== "submitted" && d.selectedBrand) {
        setSelectedBrand(d.selectedBrand);
        if (d.selectedBin) setSelectedBin(d.selectedBin);
        if (d.selectedLocation) setSelectedLocation(d.selectedLocation);
        if (Array.isArray(d.products) && d.products.length) setProducts(d.products);
        if (d.counts) setCounts(d.counts);
        setStep(d.step);
        setDraftRestored(true);
      }
    } catch { /* ignore */ }
  }, []);

  // Auto-save the in-progress count on every change (skip the empty/done states).
  useEffect(() => {
    if (step === "submitted") return;
    if (step === "brand" && !selectedBrand) return;
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ step, selectedBrand, selectedBin, selectedLocation, products, counts }));
    } catch { /* ignore */ }
  }, [step, selectedBrand, selectedBin, selectedLocation, products, counts]);

  useEffect(() => {
    Promise.all([
      fetch("/api/brands").then((r) => r.json()),
      BIN_TRACKING_ENABLED ? fetch("/api/bins").then((r) => r.json()) : Promise.resolve({ success: false }),
      fetch("/api/categories").then((r) => r.json()),
    ]).then(([brandsRes, binsRes, catsRes]) => {
      if (brandsRes.success) setBrands(brandsRes.data.filter((b: Brand) => b._count.products > 0));
      if (binsRes.success) setBins(binsRes.data);
      if (catsRes.success) {
        const flat: CategoryOption[] = [];
        (catsRes.data as Array<{ id: string; name: string; children?: { id: string; name: string }[] }>).forEach((c) => {
          flat.push({ id: c.id, name: c.name });
          c.children?.forEach((ch) => flat.push({ id: ch.id, name: ch.name }));
        });
        setCategories(flat.sort((a, b) => a.name.localeCompare(b.name)));
      }
    }).catch(() => {});
  }, []);

  // Debounced "not in list" search
  useEffect(() => {
    if (notInListSearch.length < 2) { setNotInListResults([]); return; }
    const timer = setTimeout(() => {
      setNotInListSearching(true);
      fetch(`/api/products/search?q=${encodeURIComponent(notInListSearch)}`)
        .then((r) => r.json())
        .then((res) => { if (res.success) setNotInListResults(res.data); })
        .catch(() => {})
        .finally(() => setNotInListSearching(false));
    }, 300);
    return () => clearTimeout(timer);
  }, [notInListSearch]);

  const loadProducts = useCallback(async (brandId: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/products?brandId=${brandId}&status=ACTIVE&limit=500`);
      const json = await res.json();
      if (json.success) {
        const items = (json.data || []) as ProductItem[];
        setProducts(items);
        const initial: Record<string, { qty: number | null; reorder: number | null }> = {};
        items.forEach((p) => { initial[p.id] = { qty: null, reorder: p.reorderLevel || null }; });
        setCounts(initial);
        setExpandedCategories(new Set()); // all collapsed by default
      }
    } catch { setError("Failed to load products"); }
    finally { setLoading(false); }
  }, []);

  const handleSelectBrand = (brand: Brand) => {
    setSelectedBrand(brand);
    loadProducts(brand.id);
    // Step 2 is location (bins dormant) or bin selection.
    setStep("bin");
  };

  const handleSelectBin = (bin: BinOption) => {
    setSelectedBin(bin);
    setStep("count");
  };

  const handleSelectLocation = (loc: string) => {
    setSelectedLocation(loc);
    setStep("count");
  };

  const updateCount = (productId: string, field: "qty" | "reorder", value: number | null) => {
    setCounts((prev) => ({ ...prev, [productId]: { ...prev[productId], [field]: value } }));
  };

  const handleReclassify = async (
    productId: string,
    field: "brand" | "category",
    newId: string,
    newLabel: string
  ) => {
    setReclassifying((prev) => new Set(prev).add(productId));
    setInlineEdit(null);
    try {
      const body = field === "brand" ? { brandId: newId } : { categoryId: newId };
      const res = await fetch(`/api/products/${productId}/reclassify`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setProducts((prev) =>
          prev.map((p) => {
            if (p.id !== productId) return p;
            return {
              ...p,
              brand: field === "brand" ? { name: newLabel } : p.brand,
              category: field === "category" ? { name: newLabel } : p.category,
            };
          })
        );
      } else {
        setError("Failed to update — check your connection and try again");
      }
    } catch {
      setError("Failed to update — check your connection and try again");
    } finally {
      setReclassifying((prev) => { const n = new Set(prev); n.delete(productId); return n; });
    }
  };

  const handleAddToCount = (result: SearchResult) => {
    const alreadyInList = !!products.find((p) => p.id === result.id);
    if (!alreadyInList) {
      const newProduct: ProductItem = {
        id: result.id, sku: result.sku, name: result.name, type: result.type,
        size: null, currentStock: result.currentStock, reorderLevel: result.reorderLevel,
        reorderQty: 0, category: result.category, brand: result.brand,
      };
      setProducts((prev) => [...prev, newProduct]);
      setCounts((prev) => ({ ...prev, [result.id]: { qty: null, reorder: result.reorderLevel || null } }));

      // Expand the category this product lands in, so it isn't hidden in a collapsed group
      setExpandedCategories((prev) => new Set(prev).add(result.category?.name || "Uncategorized"));

      // Auto-change brand to the selected brand if it's different
      if (selectedBrand && result.brand?.name !== selectedBrand.name) {
        handleReclassify(result.id, "brand", selectedBrand.id, selectedBrand.name);
      }
    }
    setNotInListSearch("");
    setNotInListResults([]);
  };

  const countedCount = Object.values(counts).filter((c) => c.qty !== null).length;
  const totalProducts = products.length;

  const handleSubmit = async () => {
    if (!selectedBrand) return;
    if (BIN_TRACKING_ENABLED && !selectedBin) return;
    if (!BIN_TRACKING_ENABLED && !selectedLocation) { setError("Select a location first"); return; }
    const counted = Object.entries(counts).filter(([, c]) => c.qty !== null);
    if (counted.length === 0) { setError("Count at least one item"); return; }

    setSubmitting(true);
    setError("");

    try {
      const userId = (session?.user as { userId?: string })?.userId;
      if (!userId) { setError("Not logged in"); return; }

      const title = BIN_TRACKING_ENABLED && selectedBin
        ? `${selectedBrand.name} @ ${selectedBin.name} — Brand Count`
        : `${selectedBrand.name} @ ${locationName(selectedLocation)} — Brand Count`;
      const res = await fetch("/api/stock-counts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          ...(BIN_TRACKING_ENABLED && selectedBin
            ? { binId: selectedBin.id, location: selectedBin.location }
            : { location: selectedLocation }),
          productIds: products.map((p) => p.id),
          assignedToId: userId,
          selfCount: true,
          dueDate: new Date().toISOString(),
        }),
      });
      const createJson = await res.json();
      if (!res.ok || !createJson.success) { setError(createJson.error || "Failed to create count"); return; }

      const countId = createJson.data.id;

      const startRes = await fetch(`/api/stock-counts/${countId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "IN_PROGRESS" }),
      });
      if (!startRes.ok) { setError("Failed to start count"); return; }

      const itemsRes = await fetch(`/api/stock-counts/${countId}`).then((r) => r.json());
      if (!itemsRes.success) { setError("Failed to load count items"); return; }

      const stockCountItems = itemsRes.data.items as Array<{ id: string; productId: string }>;

      const itemUpdates = stockCountItems
        .filter((sci) => counts[sci.productId]?.qty !== null && counts[sci.productId]?.qty !== undefined)
        .map((sci) => ({
          id: sci.id,
          countedQty: counts[sci.productId].qty!,
          notes: counts[sci.productId].reorder !== null
            ? `Reorder: ${counts[sci.productId].reorder}`
            : undefined,
        }));

      if (itemUpdates.length > 0) {
        const updateRes = await fetch(`/api/stock-counts/${countId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items: itemUpdates }),
        });
        if (!updateRes.ok) { setError("Failed to save counted items"); return; }
      }

      const reorderUpdates = Object.entries(counts)
        .filter(([, c]) => c.reorder !== null && c.qty !== null)
        .map(([productId, c]) => ({ id: productId, reorderLevel: c.reorder! }));

      if (reorderUpdates.length > 0) {
        await fetch("/api/reorder/update-levels", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items: reorderUpdates }),
        });
      }

      const completeRes = await fetch(`/api/stock-counts/${countId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "COMPLETED" }),
      });
      if (!completeRes.ok) {
        const err = await completeRes.json().catch(() => ({}));
        setError((err as { error?: string }).error || "Failed to mark as completed");
        return;
      }

      clearBrandCountDraft();
      setResultId(countId);
      setStep("submitted");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Submit failed");
    } finally {
      setSubmitting(false);
    }
  };

  const filtered = products.filter((p) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q);
  });

  const groups: Record<string, ProductItem[]> = {};
  for (const p of filtered) {
    const cat = p.category?.name || "Uncategorized";
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(p);
  }

  const toggleCategory = (cat: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      next.has(cat) ? next.delete(cat) : next.add(cat);
      return next;
    });
  };

  // Auto-expand all categories when user is searching
  const isCategoryExpanded = (cat: string) => search.length > 0 || expandedCategories.has(cat);

  const warehouseBins = bins.filter((b) => b.location.toLowerCase().includes("warehouse"));
  const otherBins = bins.filter((b) => !b.location.toLowerCase().includes("warehouse"));

  return (
    <div className="pb-32">
      <div className="flex items-center gap-3 mb-4">
        <Link href="/stock-audit" className="p-1"><ArrowLeft className="h-5 w-5 text-slate-600" /></Link>
        <div>
          <h1 className="text-lg font-bold text-slate-900">Brand Stock Count</h1>
          <p className="text-[10px] text-slate-500">
            {step === "brand" && "Step 1: Select brand"}
            {step === "bin" && (BIN_TRACKING_ENABLED
              ? `Step 2: ${selectedBrand?.name} — Select bin`
              : `Step 2: ${selectedBrand?.name} — Select location`)}
            {step === "count" && (BIN_TRACKING_ENABLED
              ? `Step 3: Count ${selectedBrand?.name} items in ${selectedBin?.name}`
              : `Step 3: Count ${selectedBrand?.name} at ${locationName(selectedLocation)}`)}
            {step === "submitted" && "Done! Waiting for approval"}
          </p>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-2.5 mb-3 text-xs text-red-700">
          {error}
          <button onClick={() => setError("")} className="ml-2 underline">dismiss</button>
        </div>
      )}

      {draftRestored && step !== "submitted" && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-2.5 mb-3 text-xs text-green-800 flex items-center justify-between gap-2">
          <span>✓ Restored your in-progress count{selectedBrand ? ` for ${selectedBrand.name}` : ""}.</span>
          <button
            onClick={() => {
              clearBrandCountDraft();
              setStep("brand"); setSelectedBrand(null); setSelectedBin(null); setSelectedLocation(null);
              setProducts([]); setCounts({}); setSearch(""); setDraftRestored(false);
            }}
            className="underline shrink-0"
          >
            Start fresh
          </button>
        </div>
      )}

      {/* ── STEP 1: Select Brand ── */}
      {step === "brand" && (
        <div className="space-y-2">
          <p className="text-xs text-slate-600 mb-2">Which brand are you counting?</p>

          {/* Brand search */}
          <div className="relative mb-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
            <Input
              placeholder="Search brand..."
              value={brandSearch}
              onChange={(e) => setBrandSearch(e.target.value)}
              className="pl-9 pr-9"
            />
            {brandSearch && (
              <button
                onClick={() => setBrandSearch("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 cursor-pointer"
                aria-label="Clear search"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {(() => {
            const q = brandSearch.trim().toLowerCase();
            const visible = q ? brands.filter((b) => b.name.toLowerCase().includes(q)) : brands;
            if (visible.length === 0) {
              return <p className="text-xs text-slate-400 text-center py-6">No brand matches &quot;{brandSearch}&quot;</p>;
            }
            return visible.map((b) => (
              <button key={b.id} onClick={() => handleSelectBrand(b)}
                className="w-full flex items-center justify-between p-3 bg-white border border-slate-200 rounded-lg hover:border-blue-400 transition-colors text-left">
                <div>
                  <p className="text-sm font-medium text-slate-900">{b.name}</p>
                  <p className="text-[10px] text-slate-500">{b._count.products} products</p>
                </div>
                <ChevronRight className="h-4 w-4 text-slate-400" />
              </button>
            ));
          })()}
        </div>
      )}

      {/* ── STEP 2: Select Location (bins dormant) ── */}
      {step === "bin" && !BIN_TRACKING_ENABLED && (
        <div className="space-y-2">
          <p className="text-xs text-slate-600 mb-2">Which location are you counting {selectedBrand?.name} at?</p>
          {warehouses.map((loc) => (
            <button key={loc.id} onClick={() => handleSelectLocation(loc.id)}
              className="w-full flex items-center justify-between p-3 bg-white border border-slate-200 rounded-lg hover:border-blue-400 transition-colors text-left">
              <div className="flex items-center gap-2">
                <MapPin className={`h-4 w-4 ${"text-amber-500"}`} />
                <div>
                  <p className="text-sm font-medium text-slate-900">{loc.name}</p>
                  <p className="text-[10px] text-slate-500">{loc.store.name}</p>
                </div>
              </div>
              <ChevronRight className="h-4 w-4 text-slate-400" />
            </button>
          ))}
          <button onClick={() => { setStep("brand"); setSelectedBrand(null); }}
            className="text-xs text-blue-600 mt-2 underline">← Change brand</button>
        </div>
      )}

      {/* ── STEP 2: Select Bin ── */}
      {step === "bin" && BIN_TRACKING_ENABLED && (
        <div className="space-y-2">
          <p className="text-xs text-slate-600 mb-2">Where are the {selectedBrand?.name} items stored?</p>

          {warehouseBins.length > 0 && (
            <div className="mb-3">
              <p className="text-[10px] font-semibold text-slate-500 uppercase mb-1">Warehouse Bins</p>
              {warehouseBins.map((b) => (
                <button key={b.id} onClick={() => handleSelectBin(b)}
                  className="w-full flex items-center justify-between p-3 bg-white border border-slate-200 rounded-lg hover:border-blue-400 transition-colors text-left mb-1.5">
                  <div className="flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-blue-500" />
                    <div>
                      <p className="text-sm font-medium text-slate-900">{b.name}</p>
                      <p className="text-[10px] text-slate-500">{b.code} · {b.location}</p>
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-slate-400" />
                </button>
              ))}
            </div>
          )}

          {otherBins.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-slate-500 uppercase mb-1">Store Bins</p>
              {otherBins.map((b) => (
                <button key={b.id} onClick={() => handleSelectBin(b)}
                  className="w-full flex items-center justify-between p-3 bg-white border border-slate-200 rounded-lg hover:border-slate-300 transition-colors text-left mb-1.5">
                  <div className="flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-slate-400" />
                    <div>
                      <p className="text-sm font-medium text-slate-900">{b.name}</p>
                      <p className="text-[10px] text-slate-500">{b.code} · {b.location}</p>
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-slate-400" />
                </button>
              ))}
            </div>
          )}

          <button onClick={() => { setStep("brand"); setSelectedBrand(null); }}
            className="text-xs text-blue-600 mt-2 underline">← Change brand</button>
        </div>
      )}

      {/* ── STEP 3: Count Items ── */}
      {step === "count" && (
        <div>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
            </div>
          ) : (
            <>
              {/* Progress */}
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs text-slate-600">{countedCount} of {totalProducts} counted</p>
                <div className="w-32 bg-slate-200 rounded-full h-2">
                  <div className="bg-green-500 h-2 rounded-full transition-all"
                    style={{ width: `${totalProducts > 0 ? (countedCount / totalProducts) * 100 : 0}%` }} />
                </div>
              </div>

              {/* Search */}
              <Input placeholder="Search by name or SKU..." value={search}
                onChange={(e) => setSearch(e.target.value)} className="mb-3" />

              {/* Items grouped by category — collapsed by default */}
              {Object.entries(groups).sort(([a], [b]) => a.localeCompare(b)).map(([cat, items]) => {
                const expanded = isCategoryExpanded(cat);
                const catCounted = items.filter((p) => counts[p.id]?.qty !== null).length;
                return (
                  <div key={cat} className="mb-2">
                    <button onClick={() => toggleCategory(cat)}
                      className="flex items-center gap-1.5 w-full text-left py-2 px-1">
                      {expanded
                        ? <ChevronDown className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                        : <ChevronRight className="h-3.5 w-3.5 text-slate-400 shrink-0" />}
                      <span className="text-xs font-semibold text-slate-700 uppercase flex-1">{cat}</span>
                      <span className="text-[10px] text-slate-400 mr-1">{catCounted}/{items.length}</span>
                      {catCounted === items.length && items.length > 0 && (
                        <Check className="h-3 w-3 text-green-500 shrink-0" />
                      )}
                    </button>

                    {expanded && (
                      <div className="space-y-1.5 mt-1">
                        {items.map((p) => {
                          const c = counts[p.id] || { qty: null, reorder: null };
                          const isCounted = c.qty !== null;
                          const isReclassifying = reclassifying.has(p.id);
                          const editingThisProduct = inlineEdit?.productId === p.id;

                          return (
                            <Card key={p.id} className={isCounted ? "border-green-200 bg-green-50/30" : ""}>
                              <CardContent className="p-2.5">
                                <div className="flex items-start justify-between mb-1">
                                  <div className="flex-1 min-w-0 mr-2">
                                    <p className="text-xs font-medium text-slate-900 leading-tight">{p.name}</p>
                                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                      <span className="text-[10px] text-slate-400 font-mono">{p.sku}</span>
                                      {p.size && (
                                        <Badge className="text-[9px] px-1 py-0 bg-slate-100 text-slate-600">{p.size}</Badge>
                                      )}
                                      <Badge className="text-[9px] px-1 py-0 bg-blue-50 text-blue-600">
                                        {p.type.replace("_", " ")}
                                      </Badge>
                                    </div>

                                    {/* Brand & Category change chips */}
                                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                                      {isReclassifying ? (
                                        <span className="text-[10px] text-slate-400 flex items-center gap-1 py-1.5">
                                          <Loader2 className="h-3 w-3 animate-spin" /> Saving…
                                        </span>
                                      ) : (
                                        <>
                                          <button
                                            onClick={() => setInlineEdit(
                                              editingThisProduct && inlineEdit?.field === "category"
                                                ? null
                                                : { productId: p.id, field: "category" }
                                            )}
                                            className="flex items-center gap-1 min-h-[28px] text-[10px] text-amber-700 bg-amber-50 border border-amber-200 px-2 py-1 rounded-md leading-tight cursor-pointer hover:bg-amber-100 active:bg-amber-200 transition-colors"
                                          >
                                            <span>{p.category?.name || "No Category"}</span>
                                            <Pencil className="h-2.5 w-2.5 shrink-0" />
                                          </button>
                                          <button
                                            onClick={() => setInlineEdit(
                                              editingThisProduct && inlineEdit?.field === "brand"
                                                ? null
                                                : { productId: p.id, field: "brand" }
                                            )}
                                            className="flex items-center gap-1 min-h-[28px] text-[10px] text-violet-700 bg-violet-50 border border-violet-200 px-2 py-1 rounded-md leading-tight cursor-pointer hover:bg-violet-100 active:bg-violet-200 transition-colors"
                                          >
                                            <span>{p.brand?.name || "No Brand"}</span>
                                            <Pencil className="h-2.5 w-2.5 shrink-0" />
                                          </button>
                                        </>
                                      )}
                                    </div>

                                    {/* Inline selector */}
                                    {editingThisProduct && !isReclassifying && (
                                      <div className="mt-1.5 p-2 bg-slate-50 border border-slate-200 rounded-lg">
                                        <p className="text-[9px] text-slate-500 mb-1">
                                          Change {inlineEdit?.field === "brand" ? "brand" : "category"} to:
                                        </p>
                                        <select
                                          className="w-full text-sm border border-slate-300 rounded-lg py-2 px-2 bg-white"
                                          defaultValue=""
                                          onChange={(e) => {
                                            const val = e.target.value;
                                            if (!val) return;
                                            const opts = inlineEdit?.field === "brand" ? brands : categories;
                                            const found = opts.find((o) => o.id === val);
                                            if (found && inlineEdit) {
                                              handleReclassify(p.id, inlineEdit.field, found.id, found.name);
                                            }
                                          }}
                                        >
                                          <option value="">
                                            Select {inlineEdit?.field === "brand" ? "brand" : "category"}...
                                          </option>
                                          {(inlineEdit?.field === "brand" ? brands : categories).map((o) => (
                                            <option key={o.id} value={o.id}>{o.name}</option>
                                          ))}
                                        </select>
                                        <button
                                          onClick={() => setInlineEdit(null)}
                                          className="text-[11px] text-slate-500 mt-1 w-full text-center min-h-[36px] cursor-pointer hover:text-slate-700"
                                        >
                                          Cancel
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                  {isCounted && <Check className="h-4 w-4 text-green-600 shrink-0 mt-0.5" />}
                                </div>

                                <div className="flex items-center gap-2 mt-2">
                                  <div className="flex-1">
                                    <label className="text-[9px] text-slate-500 block mb-0.5">Count</label>
                                    <input type="number" min="0" inputMode="numeric"
                                      value={c.qty === null ? "" : c.qty}
                                      onChange={(e) => updateCount(p.id, "qty", e.target.value === "" ? null : parseInt(e.target.value) || 0)}
                                      placeholder="Qty"
                                      className="w-full text-center text-sm font-medium border border-slate-300 rounded-lg py-2 focus:ring-2 focus:ring-green-500 focus:border-green-500" />
                                  </div>
                                  <div className="flex-1">
                                    <label className="text-[9px] text-slate-500 block mb-0.5">Reorder Level</label>
                                    <input type="number" min="0" inputMode="numeric"
                                      value={c.reorder === null ? "" : c.reorder}
                                      onChange={(e) => updateCount(p.id, "reorder", e.target.value === "" ? null : parseInt(e.target.value) || 0)}
                                      placeholder="Min"
                                      className="w-full text-center text-sm border border-slate-200 rounded-lg py-2 focus:ring-2 focus:ring-blue-500" />
                                  </div>
                                </div>
                              </CardContent>
                            </Card>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* ── Not in list section ── */}
              <div className="mt-5 border-t border-slate-200 pt-4">
                <p className="text-xs font-semibold text-slate-700 mb-0.5">
                  Found something not in this list?
                </p>
                <p className="text-[10px] text-slate-500 mb-2">
                  Search any product, add it here, and its brand will be updated to {selectedBrand?.name} automatically.
                </p>
                <div className="relative">
                  <Input
                    placeholder="Search by name or SKU..."
                    value={notInListSearch}
                    onChange={(e) => setNotInListSearch(e.target.value)}
                    className="pr-8"
                  />
                  {notInListSearching && (
                    <Loader2 className="absolute right-2.5 top-2.5 h-4 w-4 animate-spin text-slate-400 pointer-events-none" />
                  )}
                  {notInListSearch && !notInListSearching && (
                    <button
                      onClick={() => { setNotInListSearch(""); setNotInListResults([]); }}
                      className="absolute right-2.5 top-2.5 p-0.5"
                    >
                      <X className="h-4 w-4 text-slate-400" />
                    </button>
                  )}
                </div>

                {notInListResults.length > 0 && (
                  <div className="mt-2 space-y-1.5 max-h-52 overflow-y-auto">
                    {notInListResults.map((result) => {
                      const alreadyAdded = !!products.find((p) => p.id === result.id);
                      const brandMismatch = result.brand?.name !== selectedBrand?.name;
                      return (
                        <button
                          key={result.id}
                          disabled={alreadyAdded}
                          onClick={() => handleAddToCount(result)}
                          className={`w-full text-left p-2.5 border rounded-lg transition-colors ${
                            alreadyAdded
                              ? "border-green-200 bg-green-50/30 cursor-default"
                              : "border-slate-200 bg-white hover:border-blue-400 active:bg-blue-50"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-medium text-slate-900 truncate">{result.name}</p>
                              <p className="text-[10px] text-slate-400">
                                {result.sku} · {result.brand?.name || "No brand"} · {result.category?.name || "No category"}
                              </p>
                            </div>
                            {alreadyAdded ? (
                              <span className="text-[10px] text-green-600 font-medium shrink-0 flex items-center gap-0.5">
                                <Check className="h-3 w-3" /> Added
                              </span>
                            ) : (
                              <span className="text-[10px] text-blue-600 font-medium shrink-0">
                                + Add{brandMismatch ? " & rebrand" : ""}
                              </span>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}

                {notInListSearch.length >= 2 && !notInListSearching && notInListResults.length === 0 && (
                  <p className="text-[10px] text-slate-400 mt-2 text-center">
                    No products found for &quot;{notInListSearch}&quot;
                  </p>
                )}
              </div>

              {BIN_TRACKING_ENABLED ? (
                <button onClick={() => { setStep("bin"); setSelectedBin(null); }}
                  className="text-xs text-blue-600 mt-4 underline">← Change bin</button>
              ) : (
                <button onClick={() => { setStep("bin"); setSelectedLocation(null); }}
                  className="text-xs text-blue-600 mt-4 underline">← Change location</button>
              )}
            </>
          )}
        </div>
      )}

      {/* ── STEP 4: Submitted ── */}
      {step === "submitted" && (
        <div className="text-center py-8 space-y-4">
          <Check className="h-12 w-12 text-green-600 mx-auto" />
          <div>
            <p className="text-lg font-bold text-green-900">Count Submitted!</p>
            <p className="text-sm text-slate-600 mt-1">
              {countedCount} items counted for {selectedBrand?.name}{BIN_TRACKING_ENABLED && selectedBin ? ` in ${selectedBin.name}` : selectedLocation ? ` at ${locationName(selectedLocation)}` : ""}
            </p>
            <p className="text-xs text-slate-500 mt-2">
              This is a verification count — it records the numbers and any variance, but does not change stock. Stock is added through Inwards.
            </p>
          </div>
          <div className="flex gap-2 justify-center mt-4">
            <Link href={`/stock-audit/${resultId}/review`}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium">
              View Count
            </Link>
            <button
              onClick={() => {
                clearBrandCountDraft();
                setStep("brand"); setSelectedBrand(null); setSelectedBin(null); setSelectedLocation(null);
                setProducts([]); setCounts({}); setSearch(""); setResultId("");
                setNotInListSearch(""); setNotInListResults([]); setDraftRestored(false);
              }}
              className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg text-sm font-medium">
              Count Another Brand
            </button>
          </div>
        </div>
      )}

      {/* ── Sticky Submit Bar ── */}
      {step === "count" && countedCount > 0 && (
        <div className="fixed above-nav left-0 right-0 bg-white border-t border-slate-200 p-3 z-50 max-w-screen-sm lg:max-w-none mx-auto">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-slate-600"><strong>{countedCount}</strong> of {totalProducts} counted</p>
              <p className="text-[10px] text-slate-400">
                by {userName} · {selectedBrand?.name}{BIN_TRACKING_ENABLED && selectedBin ? ` · ${selectedBin.code}` : selectedLocation ? ` · ${locationName(selectedLocation)}` : ""}
              </p>
            </div>
            <button onClick={handleSubmit} disabled={submitting}
              className="flex items-center gap-1.5 bg-green-600 text-white px-4 py-2.5 rounded-lg text-sm font-medium disabled:opacity-50">
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Submit for Approval
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
