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
import { useStores } from "@/hooks/use-sites";
import { apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";

const log = createLogger("stock-audit:brand-count");

interface Brand { id: string; name: string; _count: { products: number } }
// One row per warehouse, flattened out of `useStores()` so the lookups below can resolve a
// warehouse id back to its store. `kind` is optional on purpose: `Warehouse.kind` arrives with
// plan 0909-stock-store-and-warehouse-scoping; until it is on the wire the Floor/Godown tag
// simply does not render (plan 0909-stock-screens-size-category-and-sidebar, Part E).
interface WarehouseRow {
  id: string; code: string; name: string; sortOrder: number;
  kind?: "FLOOR" | "GODOWN";
  storeId: string; storeName: string;
}
// `location` is the legacy free-text column and is nullable — never read it. A bin belongs to
// exactly one warehouse, which is what the picker filters on (plan 1509, B3).
interface BinOption {
  id: string; code: string; name: string; location: string | null;
  /** Decides the count entry (plan 2109, R32): one number, or Assembled + Unassembled. */
  nonAssemblable?: boolean;
  warehouse: { id: string; name: string; kind: "FLOOR" | "GODOWN" };
}
/**
 * One product's entry. `qty` is the TOTAL — what "counted" and the progress bar read. In an
 * assemblable bin it is the sum of `assembled` + `unassembled` (R32), which are what is saved.
 */
interface CountEntry {
  qty: number | null;
  reorder: number | null;
  assembled?: number | null;
  unassembled?: number | null;
}
interface CategoryOption { id: string; name: string }
interface ProductItem {
  id: string; sku: string; name: string;
  currentStock: number; reorderLevel: number; reorderQty: number;
  category: { name: string } | null; brand: { name: string } | null;
}
interface SearchResult {
  id: string; sku: string; name: string;
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
  // Bins are always on (plan 2109, Q27): the `useBinTracking()` switch was removed, and a
  // brand count is "this brand, in this bin" (R36).
  const { stores, loading: storesLoading } = useStores();
  // Store first, then that store's warehouses (Part E). The flat list is only for lookups —
  // the picker itself is grouped, so nobody has to know which building belongs to which shop.
  const warehouses: WarehouseRow[] = stores.flatMap((s) =>
    (s.warehouses as Array<Omit<WarehouseRow, "storeId" | "storeName">>).map((w) => ({
      ...w, storeId: s.id, storeName: s.name,
    }))
  );
  const selectedWarehouseFor = (id: string | null | undefined) => warehouses.find((w) => w.id === id) ?? null;
  const locationName = (id: string | null | undefined) =>
    warehouses.find((w) => w.id === id)?.name ?? "—";
  // "<warehouse> · <store>" — what the header, sticky bar and success copy print, because a
  // warehouse name alone ("Godown") does not say which shop's godown was counted.
  const locationLabel = (id: string | null | undefined) => {
    const w = warehouses.find((x) => x.id === id);
    return w ? `${w.name} · ${w.storeName}` : "—";
  };
  const { data: session } = useSession();
  const userName = (session?.user as { name?: string })?.name || "You";

  const [step, setStep] = useState<Step>("brand");
  const [brands, setBrands] = useState<Brand[]>([]);
  const [bins, setBins] = useState<BinOption[]>([]);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [selectedBrand, setSelectedBrand] = useState<Brand | null>(null);
  const [selectedBin, setSelectedBin] = useState<BinOption | null>(null);
  const [selectedStoreId, setSelectedStoreId] = useState<string | null>(null);
  const [selectedLocation, setSelectedLocation] = useState<string | null>(null);
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [counts, setCounts] = useState<Record<string, CountEntry>>({});
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
        selectedStoreId?: string | null;
        selectedLocation?: string | null;
        products?: ProductItem[];
        counts?: Record<string, CountEntry>;
      };
      if (d.step && d.step !== "submitted" && d.selectedBrand) {
        setSelectedBrand(d.selectedBrand);
        // A draft saved before plan 1509 can hold a bin with no store or warehouse — the bin
        // path used to skip both. Such a draft goes back to the location step, and a bin is
        // kept only when it sits in the restored warehouse, so the submit never sends a bin
        // the server would refuse.
        const hasScope = !!d.selectedStoreId && !!d.selectedLocation;
        if (d.selectedStoreId) setSelectedStoreId(d.selectedStoreId);
        if (d.selectedLocation) setSelectedLocation(d.selectedLocation);
        const binKept = hasScope && !!d.selectedBin && d.selectedBin.warehouse?.id === d.selectedLocation;
        if (binKept) setSelectedBin(d.selectedBin!);
        if (Array.isArray(d.products) && d.products.length) setProducts(d.products);
        if (d.counts) setCounts(d.counts);
        // A bin is required since plan 2109 (R36): a "whole warehouse" draft goes back to the
        // bin step instead of counting into a submit the server would refuse.
        setStep(d.step === "count" && !binKept ? "bin" : d.step);
        setDraftRestored(true);
      }
    } catch (e) {
      log.warn("draft restore failed", { message: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  // Auto-save the in-progress count on every change (skip the empty/done states).
  useEffect(() => {
    if (step === "submitted") return;
    if (step === "brand" && !selectedBrand) return;
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ step, selectedBrand, selectedBin, selectedStoreId, selectedLocation, products, counts }));
    } catch { /* ignore */ }
  }, [step, selectedBrand, selectedBin, selectedStoreId, selectedLocation, products, counts]);

  // Brands, bins and categories. Every call through `apiTry` — these were raw `fetch().json()`
  // with a bare `.catch(() => {})`, so an expired session left three empty pickers and no word.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [brandsRes, binsRes, catsRes] = await Promise.all([
        apiTry<Brand[]>("/api/brands"),
        apiTry<BinOption[]>("/api/bins"),
        apiTry<Array<{ id: string; name: string; children?: { id: string; name: string }[] }>>("/api/categories"),
      ]);
      if (cancelled) return;
      if (brandsRes.error) {
        log.error("brands load failed", { message: brandsRes.error });
        setError(`Could not load brands: ${brandsRes.error}`);
      } else setBrands((brandsRes.data ?? []).filter((b) => b._count.products > 0));
      if (binsRes.error) {
        // No bins, no brand count (R36) — say why rather than show an empty bin step.
        log.error("bins load failed", { message: binsRes.error });
        setError(`Could not load bins: ${binsRes.error}`);
      } else setBins(binsRes.data ?? []);
      if (catsRes.error) {
        log.warn("categories load failed", { message: catsRes.error });
      } else {
        const flat: CategoryOption[] = [];
        (catsRes.data ?? []).forEach((c) => {
          flat.push({ id: c.id, name: c.name });
          c.children?.forEach((ch) => flat.push({ id: ch.id, name: ch.name }));
        });
        setCategories(flat.sort((a, b) => a.name.localeCompare(b.name)));
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Debounced "not in list" search. Results and the spinner are cleared by the input's
  // onChange, so this effect only sets state from its timer (react-hooks/set-state-in-effect).
  useEffect(() => {
    if (notInListSearch.length < 2) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        const { data, error: err } = await apiTry<SearchResult[]>(
          `/api/products/search?q=${encodeURIComponent(notInListSearch)}`
        );
        if (cancelled) return;
        setNotInListSearching(false);
        if (err) {
          log.warn("product search failed", { message: err });
          setNotInListResults([]);
          return;
        }
        setNotInListResults(data ?? []);
      })();
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [notInListSearch]);

  const loadProducts = useCallback(async (brandId: string) => {
    setLoading(true);
    const { data, error: err } = await apiTry<ProductItem[]>(`/api/products?brandId=${brandId}&status=ACTIVE&limit=500`);
    setLoading(false);
    if (err) {
      log.error("products load failed", { brandId, message: err });
      setError(`Failed to load products: ${err}`);
      return;
    }
    const items = data ?? [];
    setProducts(items);
    const initial: Record<string, CountEntry> = {};
    items.forEach((p) => { initial[p.id] = { qty: null, reorder: p.reorderLevel || null }; });
    setCounts(initial);
    setExpandedCategories(new Set()); // all collapsed by default
  }, []);

  const handleSelectBrand = (brand: Brand) => {
    setSelectedBrand(brand);
    loadProducts(brand.id);
    // Step 2 is store → warehouse → bin.
    setStep("bin");
  };

  const handleSelectBin = (bin: BinOption) => {
    setSelectedBin(bin);
    // The condition entry depends on the bin (R32). Totals typed for another bin carry over;
    // into an assemblable bin they arrive as Unassembled, the condition every inward starts in.
    setCounts((prev) => {
      const next: Record<string, CountEntry> = {};
      for (const [k, c] of Object.entries(prev)) {
        next[k] = bin.nonAssemblable
          ? { ...c, assembled: null, unassembled: null }
          : c.assembled != null || c.unassembled != null || c.qty === null
            ? c
            : { ...c, assembled: 0, unassembled: c.qty };
      }
      return next;
    });
    setStep("count");
  };

  const handleSelectStore = (storeId: string) => {
    setSelectedStoreId(storeId);
    // A bin belongs to one warehouse, so it never survives a store switch.
    setSelectedBin(null);
    // A warehouse picked under another store must not survive the switch — the server would
    // refuse the pair (api/stock-counts/route.ts) and the person would not know why.
    if (selectedLocation && selectedWarehouseFor(selectedLocation)?.storeId !== storeId) {
      setSelectedLocation(null);
    }
  };

  // The warehouse is selected and the bin list for it opens below (plan 1509, B1). A bin is
  // required (plan 2109, R36): the "bins off → count the whole warehouse" jump and the
  // "Whole warehouse" button were removed.
  const handleSelectLocation = (loc: string) => {
    setSelectedLocation(loc);
    setSelectedBin(null);
  };

  const nonAssemblableBin = selectedBin?.nonAssemblable === true;

  const updateCount = (productId: string, field: "qty" | "reorder", value: number | null) => {
    setCounts((prev) => ({ ...prev, [productId]: { ...prev[productId], [field]: value } }));
  };

  /** Assemblable bin (R32): one half changes, the total follows. Both empty = not counted. */
  const updateHalf = (productId: string, field: "assembled" | "unassembled", value: number | null) => {
    setCounts((prev) => {
      const cur = prev[productId] ?? { qty: null, reorder: null };
      const next = { ...cur, [field]: value };
      const a = next.assembled ?? null;
      const u = next.unassembled ?? null;
      next.qty = a === null && u === null ? null : (a ?? 0) + (u ?? 0);
      return { ...prev, [productId]: next };
    });
  };

  const handleReclassify = async (
    productId: string,
    field: "brand" | "category",
    newId: string,
    newLabel: string
  ) => {
    setReclassifying((prev) => new Set(prev).add(productId));
    setInlineEdit(null);
    const body = field === "brand" ? { brandId: newId } : { categoryId: newId };
    const { error: err } = await apiTry(`/api/products/${productId}/reclassify`, { method: "PUT", json: body });
    setReclassifying((prev) => { const n = new Set(prev); n.delete(productId); return n; });
    if (err) {
      log.error("reclassify failed", { productId, field, message: err });
      setError(`Failed to update: ${err}`);
      return;
    }
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
  };

  const handleAddToCount = (result: SearchResult) => {
    const alreadyInList = !!products.find((p) => p.id === result.id);
    if (!alreadyInList) {
      const newProduct: ProductItem = {
        id: result.id, sku: result.sku, name: result.name,
        currentStock: result.currentStock, reorderLevel: result.reorderLevel,
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
    // Store, warehouse AND bin are required (plan 1509, B2; plan 2109, R36).
    if (!selectedStoreId || !selectedLocation) { setError("Select a store and location first"); return; }
    const selectedWarehouse = selectedWarehouseFor(selectedLocation);
    if (!selectedWarehouse) { setError("That warehouse is no longer available — pick another"); return; }
    if (selectedWarehouse.storeId !== selectedStoreId) {
      setError("That warehouse belongs to a different store — pick the location again"); return;
    }
    if (!selectedBin) { setError("Choose a bin"); setStep("bin"); return; }
    if (selectedBin.warehouse?.id !== selectedLocation) {
      setError(`Bin ${selectedBin.code} is not in ${selectedWarehouse.name} — pick the bin again`); return;
    }
    const counted = Object.entries(counts).filter(([, c]) => c.qty !== null);
    if (counted.length === 0) { setError("Count at least one item"); return; }

    setSubmitting(true);
    setError("");
    const ctx = { brandId: selectedBrand.id, storeId: selectedStoreId, warehouseId: selectedLocation, binId: selectedBin.id };

    try {
      const userId = (session?.user as { userId?: string })?.userId;
      if (!userId) { setError("Not logged in"); return; }

      const title = `${selectedBrand.name} @ ${locationName(selectedLocation)} · Bin ${selectedBin.code} — Brand Count`;
      const { data: created, error: createError, status } = await apiTry<{ id: string }>("/api/stock-counts", {
        method: "POST",
        json: {
          title,
          // Scope as store + warehouse + bin. The store is chosen first, the warehouse from
          // that store's own list and the bin from that warehouse's, so every id is the
          // person's explicit pick; the server refuses anything else (api/stock-counts/route.ts).
          storeId: selectedStoreId,
          warehouseId: selectedLocation,
          binId: selectedBin.id,
          // The COUNTED products only. Every product of the brand used to be sent, and the
          // Complete step below then refused with "N items not yet counted" whenever the
          // counter had (rightly) skipped products that are not in this bin.
          productIds: counted.map(([productId]) => productId),
          assignedToId: userId,
          selfCount: true,
          dueDate: new Date().toISOString(),
        },
      });
      if (createError || !created) {
        log.error("create failed", { ...ctx, status, message: createError });
        setError(createError || "Failed to create count");
        return;
      }

      const countId = created.id;

      // Every step below through `apiTry` — they were raw `fetch()` calls whose failures were
      // reported as a generic sentence, or (the reorder save) not at all.
      const started = await apiTry(`/api/stock-counts/${countId}`, { method: "PUT", json: { status: "IN_PROGRESS" } });
      if (started.error) {
        log.error("start failed", { ...ctx, countId, message: started.error });
        setError(`Failed to start count: ${started.error}`);
        return;
      }

      const loaded = await apiTry<{ items: Array<{ id: string; productId: string }> }>(`/api/stock-counts/${countId}`);
      if (loaded.error || !loaded.data) {
        log.error("count items load failed", { ...ctx, countId, message: loaded.error });
        setError(`Failed to load count items: ${loaded.error ?? "empty response"}`);
        return;
      }

      // Saved through the items route, which keeps the condition split (R32): Assembled +
      // Unassembled in an assemblable bin, one number in a non-assemblable one. The old
      // `PUT /api/stock-counts/[id]` body path saved the total only and cleared any split.
      const itemUpdates = loaded.data.items
        .filter((sci) => counts[sci.productId]?.qty !== null && counts[sci.productId]?.qty !== undefined)
        .map((sci) => {
          const c = counts[sci.productId];
          const hasSplit = !nonAssemblableBin && (c.assembled != null || c.unassembled != null);
          return {
            id: sci.id,
            ...(hasSplit
              ? { assembledQty: c.assembled ?? 0, unassembledQty: c.unassembled ?? 0 }
              : { countedQty: c.qty! }),
            notes: c.reorder !== null ? `Reorder: ${c.reorder}` : undefined,
          };
        });

      if (itemUpdates.length > 0) {
        const saved = await apiTry(`/api/stock-counts/${countId}/items`, { method: "PUT", json: { items: itemUpdates } });
        if (saved.error) {
          log.error("count save failed", { ...ctx, countId, lines: itemUpdates.length, message: saved.error });
          setError(`Failed to save counted items: ${saved.error}`);
          return;
        }
      }

      const reorderUpdates = Object.entries(counts)
        .filter(([, c]) => c.reorder !== null && c.qty !== null)
        .map(([productId, c]) => ({ id: productId, reorderLevel: c.reorder! }));

      if (reorderUpdates.length > 0) {
        const reordered = await apiTry("/api/reorder/update-levels", { method: "PUT", json: { items: reorderUpdates } });
        // Not fatal: the count itself is saved. Said, not swallowed.
        if (reordered.error) {
          log.warn("reorder levels not saved", { ...ctx, countId, products: reorderUpdates.length, message: reordered.error });
          setError(`Count saved, but reorder levels were not: ${reordered.error}`);
        }
      }

      const completed = await apiTry(`/api/stock-counts/${countId}`, { method: "PUT", json: { status: "COMPLETED" } });
      if (completed.error) {
        log.error("complete failed", { ...ctx, countId, message: completed.error });
        setError(completed.error || "Failed to mark as completed");
        return;
      }

      log.info("brand count submitted", { ...ctx, countId, lines: itemUpdates.length });
      clearBrandCountDraft();
      setResultId(countId);
      setStep("submitted");
    } catch (e) {
      log.error("submit failed", { ...ctx, message: e instanceof Error ? e.message : String(e) });
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

  // "<warehouse> · <store>", plus " · Bin <code>" when a bin was picked — one label for the
  // header, the sticky bar and the success copy, in both modes.
  const scopeLabel = `${locationLabel(selectedLocation)}${selectedBin ? ` · Bin ${selectedBin.code}` : ""}`;

  return (
    <div className="pb-32">
      <div className="flex items-center gap-3 mb-4">
        <Link href="/stock-audit" className="p-1"><ArrowLeft className="h-5 w-5 text-slate-600" /></Link>
        <div>
          <h1 className="text-lg font-bold text-slate-900">Brand Stock Count</h1>
          <p className="text-[10px] text-slate-500">
            {step === "brand" && "Step 1: Select brand"}
            {step === "bin" && `Step 2: ${selectedBrand?.name} — Select location and bin`}
            {step === "count" && `Step 3: Count ${selectedBrand?.name} at ${scopeLabel}`}
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
              setStep("brand"); setSelectedBrand(null); setSelectedBin(null); setSelectedStoreId(null); setSelectedLocation(null);
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

      {/* ── STEP 2: Select Location — store first, then that store's warehouses, in BOTH modes.
          Replaces a flat list of every warehouse in the business. No "Whole store" button: a
          brand count corrects stock, and correction is per warehouse (D12). With bins on, the
          bins of the chosen warehouse follow, plus "Whole warehouse" (plan 1509, B1). The old
          bins-on step was a flat bin list that skipped store and warehouse entirely, which is
          how a count went out with no storeId. ── */}
      {step === "bin" && (() => {
        const selectedStore = stores.find((s) => s.id === selectedStoreId) ?? null;
        const storeWarehouses = warehouses.filter((w) => w.storeId === selectedStoreId);
        const pickedWarehouse = storeWarehouses.find((w) => w.id === selectedLocation) ?? null;
        const warehouseBins = pickedWarehouse ? bins.filter((b) => b.warehouse?.id === pickedWarehouse.id) : [];
        return (
          <div className="space-y-3">
            <div>
              <p className="text-xs text-slate-600 mb-2">Which store are you counting {selectedBrand?.name} at?</p>
              <div className="grid grid-cols-2 gap-2">
                {stores.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => handleSelectStore(s.id)}
                    className={`min-h-[44px] rounded-lg text-sm font-medium transition-colors focus-ring ${
                      selectedStoreId === s.id ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {s.name}
                  </button>
                ))}
              </div>
              {storesLoading && stores.length === 0 && (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
                </div>
              )}
              {!storesLoading && stores.length === 0 && (
                <p className="text-xs text-slate-400 text-center py-4">No stores available</p>
              )}
            </div>

            {selectedStore && (
              <div className="space-y-2">
                <p className="text-xs text-slate-600">Which location in {selectedStore.name}?</p>
                {storeWarehouses.map((loc) => (
                  <button key={loc.id} onClick={() => handleSelectLocation(loc.id)}
                    className={`w-full flex items-center justify-between p-3 border rounded-lg hover:border-blue-400 transition-colors text-left ${
                      selectedLocation === loc.id
                        ? "border-slate-900 bg-slate-50 ring-1 ring-slate-900"
                        : "bg-white border-slate-200"
                    }`}>
                    <div className="flex items-center gap-2">
                      <MapPin className="h-4 w-4 text-amber-500" />
                      <div>
                        <p className="text-sm font-medium text-slate-900 flex items-center gap-1.5">
                          <span>{loc.name}</span>
                          {/* Floor / Godown tag — only once `Warehouse.kind` is on the wire. */}
                          {loc.kind && (
                            <Badge className="text-[9px] px-1 py-0 bg-slate-100 text-slate-600 font-normal">
                              {loc.kind === "FLOOR" ? "Floor" : "Godown"}
                            </Badge>
                          )}
                        </p>
                        <p className="text-[10px] text-slate-500 font-mono">{loc.code}</p>
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-slate-400" />
                  </button>
                ))}
                {storeWarehouses.length === 0 && (
                  <p className="text-[11px] text-slate-500">
                    {selectedStore.name} has no active warehouses — a brand count needs one, so pick another store.
                  </p>
                )}
              </div>
            )}

            {/* The bin is picked INSIDE the chosen warehouse, and is REQUIRED (plan 2109, R36):
                a brand count is "this brand, in this bin". "Whole warehouse" was removed. */}
            {pickedWarehouse && (
              <div className="space-y-2">
                <p className="text-xs text-slate-600">Which bin in {pickedWarehouse.name}?</p>
                {warehouseBins.map((b) => (
                  <button key={b.id} onClick={() => handleSelectBin(b)}
                    className="w-full min-h-[44px] flex items-center justify-between p-3 bg-white border border-slate-200 rounded-lg hover:border-blue-400 transition-colors text-left">
                    <div className="flex items-center gap-2">
                      <MapPin className="h-4 w-4 text-blue-500" />
                      <div>
                        <p className="text-sm font-medium text-slate-900 flex items-center gap-1.5">
                          <span>{b.name}</span>
                          {b.nonAssemblable && (
                            <Badge className="text-[9px] px-1 py-0 bg-amber-50 text-amber-700 font-normal">Non-assemblable</Badge>
                          )}
                        </p>
                        <p className="text-[10px] text-slate-500 font-mono">{b.code}</p>
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-slate-400" />
                  </button>
                ))}
                {warehouseBins.length === 0 && (
                  <p className="text-[11px] text-slate-500">
                    No bins in this warehouse — add one on /bins before counting here.
                  </p>
                )}
              </div>
            )}

            <button onClick={() => { setStep("brand"); setSelectedBrand(null); }}
              className="text-xs text-blue-600 mt-2 underline">← Change brand</button>
          </div>
        );
      })()}

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
                                  {nonAssemblableBin ? (
                                    // R32: a non-assemblable bin — one number, no condition.
                                    <div className="flex-1">
                                      <label className="text-[9px] text-slate-500 block mb-0.5">Count</label>
                                      <input type="number" min="0" inputMode="numeric"
                                        value={c.qty === null ? "" : c.qty}
                                        onChange={(e) => updateCount(p.id, "qty", e.target.value === "" ? null : parseInt(e.target.value) || 0)}
                                        placeholder="Qty"
                                        className="w-full text-center text-sm font-medium border border-slate-300 rounded-lg py-2 focus:ring-2 focus:ring-green-500 focus:border-green-500" />
                                    </div>
                                  ) : (
                                    // R32: an assemblable bin — Assembled and Unassembled; the
                                    // total is their sum.
                                    <>
                                      <div className="flex-1">
                                        <label className="text-[9px] text-slate-500 block mb-0.5">Assembled</label>
                                        <input type="number" min="0" inputMode="numeric"
                                          value={c.assembled == null ? "" : c.assembled}
                                          onChange={(e) => updateHalf(p.id, "assembled", e.target.value === "" ? null : parseInt(e.target.value) || 0)}
                                          placeholder="0"
                                          className="w-full text-center text-sm font-medium border border-slate-300 rounded-lg py-2 focus:ring-2 focus:ring-green-500 focus:border-green-500" />
                                      </div>
                                      <div className="flex-1">
                                        <label className="text-[9px] text-slate-500 block mb-0.5">Unassembled</label>
                                        <input type="number" min="0" inputMode="numeric"
                                          value={c.unassembled == null ? "" : c.unassembled}
                                          onChange={(e) => updateHalf(p.id, "unassembled", e.target.value === "" ? null : parseInt(e.target.value) || 0)}
                                          placeholder="0"
                                          className="w-full text-center text-sm font-medium border border-slate-300 rounded-lg py-2 focus:ring-2 focus:ring-green-500 focus:border-green-500" />
                                      </div>
                                    </>
                                  )}
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
                    onChange={(e) => {
                      const v = e.target.value;
                      setNotInListSearch(v);
                      if (v.length < 2) { setNotInListResults([]); setNotInListSearching(false); }
                      else setNotInListSearching(true);
                    }}
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

              {/* Back to the bin list of the same warehouse. */}
              <button
                onClick={() => {
                  setStep("bin");
                  setSelectedBin(null);
                }}
                className="text-xs text-blue-600 mt-4 underline">
                ← Change location or bin
              </button>
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
              {countedCount} items counted for {selectedBrand?.name}{selectedLocation ? ` at ${scopeLabel}` : ""}
            </p>
            <p className="text-xs text-slate-500 mt-2">
              Stock does not change until an approver reviews this count. They can record the differences only, or set this bin&apos;s stock to the counts — which also gives uncoded items their codes.
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
                setStep("brand"); setSelectedBrand(null); setSelectedBin(null); setSelectedStoreId(null); setSelectedLocation(null);
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
                by {userName} · {selectedBrand?.name}{selectedLocation ? ` · ${scopeLabel}` : ""}
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
