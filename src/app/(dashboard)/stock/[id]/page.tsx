"use client";

import { use, useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { BIN_TRACKING_ENABLED } from "@/lib/inventory-config";
import { isLowStock } from "@/lib/reorder";
import { apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";
import Link from "next/link";
import { ArrowLeft, QrCode, MapPin, Tag, IndianRupee, Pencil, Save, X, Power } from "lucide-react";
import { LabelPrintButton } from "@/components/label-print";
import { Badge } from "@/components/ui/badge";
import { SkeletonList } from "@/components/ui/skeleton";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchableSelect, type SearchableSelectOption } from "@/components/ui/searchable-select";
import { TransactionItem } from "@/components/transaction-item";
import { usePermissions } from "@/lib/use-permissions";

const log = createLogger("stock:detail");

/**
 * What GET /api/categories returns: a FLAT list of every row — roots AND children — each with
 * its `children` nested and its `parent` named. It is not a tree; a child appears twice.
 */
interface RawCategory {
  id: string;
  name: string;
  parent: { id: string; name: string } | null;
  children?: Array<{ id: string; name: string; isActive?: boolean }>;
}

/**
 * Flattened for the picker, parent as the hint so "Tyres" under two parents can be told apart.
 * Only ROOT rows are walked — iterating every row would push each child twice, once as its own
 * row and once under its parent (plan 0909-stock-screens-size-category-and-sidebar, Q10). A
 * child whose parent is not in the list (the parent is inactive, the child is not) is kept, or
 * it would vanish from the picker even though it is a valid destination.
 */
function flattenCategories(rows: RawCategory[]): SearchableSelectOption[] {
  const rootIds = new Set(rows.filter((c) => c.parent === null).map((c) => c.id));
  const flat: SearchableSelectOption[] = [];
  for (const c of rows) {
    if (c.parent === null) {
      flat.push({ id: c.id, label: c.name });
      for (const ch of c.children ?? []) {
        if (ch.isActive === false) continue;
        flat.push({ id: ch.id, label: ch.name, hint: c.name });
      }
    } else if (!rootIds.has(c.parent.id)) {
      flat.push({ id: c.id, label: c.name, hint: c.parent.name });
    }
  }
  return flat;
}

interface SerialItem {
  id: string;
  serialCode: string;
  status: string;
  condition: string;
  bin: { code: string } | null;
}

interface Transaction {
  id: string;
  type: string;
  quantity: number;
  referenceNo: string | null;
  notes: string | null;
  createdAt: string;
  user: { name: string };
}

interface ProductDetail {
  id: string;
  sku: string;
  name: string;
  status: string;
  condition: string;
  currentStock: number;
  reservedStock: number;
  reorderLevel: number;
  reorderQty: number;
  reorderVendorId: string | null;
  maxStock: number;
  costPrice: number;
  sellingPrice: number;
  mrp: number;
  gstRate: number;
  hsnCode: string | null;
  tags: string[];
  categoryId: string | null;
  category: { id: string; name: string } | null;
  brandId: string | null;
  brand: { id: string; name: string } | null;
  binId: string | null;
  bin: { id: string; code: string; name: string; location: string } | null;
  serialItems: SerialItem[];
  transactions: Transaction[];
}

function fmt(val: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(val);
}

function formatTime(dateStr: string) {
  return new Date(dateStr).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

function parseTransactionLabel(notes: string | null, type: string): string {
  if (!notes) return type === "INWARD" ? "Inward" : "Outward";
  const n = notes.toLowerCase();
  if (n.includes("[inbound]")) return "Inbound Shipment";
  if (n.includes("[stock_count]") || n.includes("stock count")) return "Stock Count";
  if (n.includes("[delivery]") || n.includes("delivery")) return "Delivery";
  if (n.includes("[transfer]") || n.includes("transfer")) return "Transfer";
  if (n.includes("[adjustment]") || n.includes("adjust")) return "Adjustment";
  return type === "INWARD" ? "Inward" : "Outward";
}

export default function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: session } = useSession();
  const { canView } = usePermissions();
  const { canEdit: canEditCheck } = usePermissions();
  // Gates the Pricing card (Cost / Selling / MRP) and nothing else on this page.
  const isAdmin = canView("cost_price");
  const canEdit = canEditCheck("stock");
  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState("");
  const [editData, setEditData] = useState<Record<string, unknown>>({ name: "", color: "", categoryId: "", sellingPrice: 0, mrp: 0, reorderLevel: 0, reorderQty: 0, reorderVendorId: "", brandId: "", binId: "" });
  const [vendors, setVendors] = useState<Array<{ id: string; name: string; code: string }>>([]);
  const [brands, setBrands] = useState<{ id: string; name: string }[]>([]);
  const [categories, setCategories] = useState<SearchableSelectOption[]>([]);
  const [bins, setBins] = useState<{ id: string; code: string; name: string; location: string }[]>([]);

  useEffect(() => {
    // GET /api/brands and GET /api/categories both answer active rows only by default — a
    // retired row is not a destination. The product's own brand / category is appended below
    // if it is no longer listed.
    void Promise.all([
      apiTry<{ id: string; name: string }[]>("/api/brands"),
      apiTry<RawCategory[]>("/api/categories"),
      BIN_TRACKING_ENABLED
        ? apiTry<{ id: string; code: string; name: string; location: string }[]>("/api/bins")
        : Promise.resolve({ data: null, error: null }),
    ]).then(([bRes, cRes, binRes]) => {
      if (bRes.data) setBrands(bRes.data);
      else if (bRes.error) log.error("could not load brands", { productId: id, message: bRes.error });
      if (cRes.data) setCategories(flattenCategories(cRes.data));
      else if (cRes.error) log.error("could not load categories", { productId: id, message: cRes.error });
      if (binRes.data) setBins(binRes.data);
      else if (binRes.error) log.error("could not load bins", { productId: id, message: binRes.error });
    });
  }, [id]);

  // Loaded when the form opens rather than with the product: most visits to this page are
  // to read it, and the vendor list is only needed by the one select in the edit form.
  useEffect(() => {
    if (!editing || vendors.length > 0) return;
    apiTry<Array<{ id: string; name: string; code: string }>>("/api/vendors?limit=500").then(
      ({ data }) => { if (data) setVendors(data); }
    );
  }, [editing, vendors.length]);

  useEffect(() => {
    fetch(`/api/products/${id}`)
      .then((r) => r.json())
      .then((res) => { if (res.success) setProduct(res.data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className="space-y-3">
        <SkeletonList count={5} type="card" />
      </div>
    );
  }

  if (!product) {
    return (
      <div className="text-center py-12">
        <p className="text-slate-500">Product not found</p>
        <Link href="/stock" className="text-blue-600 text-sm mt-2 inline-block">Back to Stock</Link>
      </div>
    );
  }

  const inStockSerials = product.serialItems.filter((s) => s.status === "IN_STOCK");

  // The brand list is active brands only. A product already filed under an inactive brand
  // must still see its own brand in the select, or the control renders blank and the next
  // save would silently move the product. Appended, marked, never hidden.
  const currentBrand = product.brand;
  const brandOptions =
    currentBrand && !brands.some((b) => b.id === currentBrand.id)
      ? [...brands, { id: currentBrand.id, name: `${currentBrand.name} (inactive)` }]
      : brands;

  // Same rule for the category: the picker lists active rows, and a product already filed
  // under an inactive one must still see it, or the control renders blank. Saving with the
  // inactive id still in place succeeds — PUT refuses a category only on CHANGE (D2 / Q9).
  const currentCategory = product.category;
  const categoryOptions =
    currentCategory && !categories.some((c) => c.id === currentCategory.id)
      ? [...categories, { id: currentCategory.id, label: `${currentCategory.name} (inactive)` }]
      : categories;

  function startEdit() {
    setEditData({
      name: product!.name,
      color: (product as unknown as Record<string, string>).color || "",
      categoryId: product!.categoryId || "",
      sellingPrice: product!.sellingPrice,
      mrp: product!.mrp,
      reorderLevel: product!.reorderLevel,
      reorderQty: product!.reorderQty ?? 0,
      reorderVendorId: product!.reorderVendorId || "",
      brandId: product!.brandId || "",
      binId: product!.binId || "",
    });
    setEditing(true);
  }

  async function handleSave() {
    setSaving(true);
    setActionError("");
    try {
      // Only send non-empty fields. The type-only PATCH branch is gone with the type: this
      // form is reachable only by a stock.edit holder now.
      const payload: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(editData)) {
        if (v !== "" && v !== undefined) payload[k] = v;
      }
      // reorderVendorId is the one field where "" is a CHOICE — "No vendor" — not an
      // untouched box. The loop above drops empty strings, which is right for text fields and
      // wrong here: it would make clearing a vendor silently do nothing. Sent as null, which
      // is what the schema and the column both take.
      if (editData.reorderVendorId === "") payload.reorderVendorId = null;
      const res = await fetch(`/api/products/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.success) {
        // Always re-fetch full product so serialItems/transactions/tags are intact
        const full = await fetch(`/api/products/${id}`).then((r) => r.json());
        if (full.success) setProduct(full.data);
        setEditing(false);
      } else {
        setActionError(data.error || "Save failed");
      }
    } catch (e) { setActionError(e instanceof Error ? e.message : "Save failed"); }
    finally { setSaving(false); }
  }

  return (
    <div>
      {actionError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-2.5 mb-3 text-xs text-red-700">
          {actionError}
          <button onClick={() => setActionError("")} className="ml-2 underline">dismiss</button>
        </div>
      )}

      <div className="flex items-center gap-2 mb-4">
        <Link href="/stock" aria-label="Back" className="p-2 -ml-2 rounded-lg hover:bg-slate-100 focus-ring"><ArrowLeft className="h-5 w-5 text-slate-600" /></Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-bold text-slate-900 truncate">{product.name}</h1>
          <p className="text-xs text-slate-500 tabular-nums truncate">{product.sku}</p>
        </div>
        {canEdit && (
          <button
            onClick={async () => {
              const newStatus = product.status === "ACTIVE" ? "INACTIVE" : "ACTIVE";
              if (!confirm(`Mark this item as ${newStatus}?`)) return;
              const res = await fetch(`/api/products/${id}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ status: newStatus }),
              }).then(r => r.json());
              if (res.success) setProduct({ ...product, status: newStatus });
            }}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium shrink-0 transition-colors ${
              product.status === "ACTIVE"
                ? "bg-green-100 text-green-700 hover:bg-green-200"
                : "bg-slate-100 text-slate-500 hover:bg-slate-200"
            }`}
          >
            <Power className="h-3 w-3" />
            {product.status === "ACTIVE" ? "Active" : "Inactive"}
          </button>
        )}
        {canEdit && !editing && (
          <button onClick={startEdit} className="p-2 rounded-lg hover:bg-slate-100">
            <Pencil className="h-4 w-4 text-slate-500" />
          </button>
        )}
        <LabelPrintButton product={{
          name: product.name,
          sku: product.sku,
          mrp: product.mrp,
          sellingPrice: product.sellingPrice,
          brand: product.brand?.name,
        }} />
      </div>

      {editing && (
        <Card className="mb-4 border-blue-200 bg-blue-50">
          <CardContent className="p-3 space-y-2">
            <p className="text-xs font-semibold text-blue-800 mb-1">Edit Product</p>

            {/* Full edit fields — admins / purchase manager only */}
            {canEdit && (
              <>
                <div>
                  <label className="text-[11px] text-slate-500">Name</label>
                  <Input value={editData.name as string} onChange={(e) => setEditData({ ...editData, name: e.target.value })} />
                </div>
                <div>
                  <label className="text-[11px] text-slate-500">Brand</label>
                  <select value={editData.brandId as string} onChange={(e) => setEditData({ ...editData, brandId: e.target.value })}
                    className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="">No brand</option>
                    {brandOptions.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>
                {BIN_TRACKING_ENABLED && (
                  <div>
                    <label className="text-[11px] text-slate-500">Bin / Location</label>
                    <select value={editData.binId as string} onChange={(e) => setEditData({ ...editData, binId: e.target.value })}
                      className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                      <option value="">No bin</option>
                      {bins.map((b) => <option key={b.id} value={b.id}>{b.code} — {b.name} ({b.location})</option>)}
                    </select>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[11px] text-slate-500">Category</label>
                    {/* Category took over what Size used to say — 20 of the 32 categories ARE
                        wheel sizes, and `Product.size` was never written. The dropdown is
                        unportalled; `Card` sets no overflow, so nothing clips it. */}
                    <SearchableSelect
                      options={categoryOptions}
                      value={(editData.categoryId as string) || null}
                      onChange={(cid) => setEditData({ ...editData, categoryId: cid ?? "" })}
                      placeholder="Search categories"
                      emptyText="No category matches"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-slate-500">Color</label>
                    <Input value={editData.color as string} onChange={(e) => setEditData({ ...editData, color: e.target.value })} placeholder="e.g. Red" />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="text-[11px] text-slate-500">Selling Price</label>
                    <Input type="number" value={editData.sellingPrice as number} onChange={(e) => setEditData({ ...editData, sellingPrice: Number(e.target.value) })} />
                  </div>
                  <div>
                    <label className="text-[11px] text-slate-500">MRP</label>
                    <Input type="number" value={editData.mrp as number} onChange={(e) => setEditData({ ...editData, mrp: Number(e.target.value) })} />
                  </div>
                  <div>
                    <label className="text-[11px] text-slate-500">Reorder Level</label>
                    <Input type="number" value={editData.reorderLevel as number} onChange={(e) => setEditData({ ...editData, reorderLevel: Number(e.target.value) })} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[11px] text-slate-500">Reorder Qty</label>
                    <Input type="number" value={editData.reorderQty as number} onChange={(e) => setEditData({ ...editData, reorderQty: Number(e.target.value) })} />
                  </div>
                  <div>
                    <label className="text-[11px] text-slate-500">Reorder Vendor</label>
                    {/* A plain select, matching the Brand and Bin pickers three fields up.
                        The typeahead lives in the /stock sheet, where the person is scanning a
                        list; here they already have the product open. */}
                    <select
                      value={editData.reorderVendorId as string}
                      onChange={(e) => setEditData({ ...editData, reorderVendorId: e.target.value })}
                      className="w-full min-h-[44px] rounded-lg border border-slate-300 px-2 text-sm"
                    >
                      <option value="">No vendor</option>
                      {vendors.map((v) => (
                        <option key={v.id} value={v.id}>{v.name} ({v.code})</option>
                      ))}
                    </select>
                  </div>
                </div>
              </>
            )}

            <div className="flex gap-2">
              <Button size="sm" onClick={handleSave} disabled={saving} className="flex-1 bg-blue-600 hover:bg-blue-700">
                <Save className="h-3.5 w-3.5 mr-1" />{saving ? "Saving..." : "Save"}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setEditing(false)} className="flex-1">
                <X className="h-3.5 w-3.5 mr-1" />Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Identity badges */}
      {/* Brand, then category in the same violet chip /stock uses for it, so the list and the
          detail agree on what a category looks like. The size badge that used to sit here is
          gone with `Product.size` (plan 0909-stock-screens-size-category-and-sidebar, D1). */}
      {(product.brand || product.category || product.condition !== "NEW") && (
        <div className="flex flex-wrap items-center gap-2 mb-3">
          {product.brand && <Badge variant="default" className="font-semibold">{product.brand.name}</Badge>}
          {product.category && (
            <span className="rounded-full bg-violet-50 px-1.5 py-0.5 text-[11px] font-medium text-violet-700">
              {product.category.name}
            </span>
          )}
          {product.condition !== "NEW" && <Badge variant="warning">{product.condition.replace("_", " ")}</Badge>}
        </div>
      )}

      {/* Stock + Location combined card (most important info first) */}
      <Card className="mb-3">
        <CardContent className="p-4">
          <div className="grid grid-cols-3 gap-4 text-center mb-3">
            <div>
              <p className={`text-2xl font-bold tabular-nums ${
                product.currentStock <= 0 ? "text-red-600" :
                isLowStock(product) ? "text-yellow-600" : "text-green-600"
              }`}>{product.currentStock}</p>
              <p className="text-xs text-slate-500">In Stock</p>
              {product.reservedStock > 0 && (
                <p className="text-[11px] text-orange-600 mt-0.5 tabular-nums">{product.currentStock - product.reservedStock} avail · {product.reservedStock} reserved</p>
              )}
            </div>
            <div>
              <p className="text-2xl font-bold text-yellow-600 tabular-nums">{product.reorderLevel}</p>
              <p className="text-xs text-slate-500">Reorder Level</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-400 tabular-nums">{product.maxStock}</p>
              <p className="text-xs text-slate-500">Max Stock</p>
            </div>
          </div>
          {BIN_TRACKING_ENABLED && (product.bin ? (
            <div className="flex items-center gap-2 pt-3 border-t border-slate-100">
              <MapPin className="h-4 w-4 text-blue-500" />
              <div>
                <p className="text-sm font-medium text-slate-900">
                  <span className="font-mono">{product.bin.code}</span> — {product.bin.name}
                </p>
                <p className="text-xs text-slate-500">{product.bin.location}</p>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 pt-3 border-t border-slate-100">
              <MapPin className="h-4 w-4 text-slate-300" />
              <p className="text-xs text-slate-400">No bin assigned</p>
            </div>
          ))}
        </CardContent>
      </Card>

      {isAdmin && (
        <Card className="mb-3">
          <CardHeader><CardTitle className="flex items-center gap-1.5"><IndianRupee className="h-3.5 w-3.5" /> Pricing</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div><p className="text-slate-500">Cost</p><p className={`font-semibold tabular-nums ${product.costPrice === 0 ? "text-amber-600" : "text-slate-900"}`}>{fmt(product.costPrice)}</p>{product.costPrice === 0 && <p className="text-[11px] text-amber-600 mt-0.5">COGS will be inaccurate</p>}</div>
              <div><p className="text-slate-500">Selling</p><p className="font-semibold tabular-nums text-slate-900">{fmt(product.sellingPrice)}</p></div>
              <div><p className="text-slate-500">MRP</p><p className="font-semibold tabular-nums text-slate-900">{fmt(product.mrp)}</p></div>
            </div>
            <div className="mt-2 text-xs text-slate-500 tabular-nums">
              GST: {product.gstRate}% {product.hsnCode && `| HSN: ${product.hsnCode}`}
            </div>
          </CardContent>
        </Card>
      )}

      {product.serialItems.length > 0 && (
        <Card className="mb-3">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-1.5"><QrCode className="h-3.5 w-3.5" /> Serial Items ({product.serialItems.length})</CardTitle>
              <Link href={`/stock/${product.id}/serials`}><Button variant="ghost" size="sm">View All</Button></Link>
            </div>
          </CardHeader>
          <CardContent>
            {product.serialItems.slice(0, 5).map((s) => (
              <div key={s.id} className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
                <div>
                  <p className="text-sm font-mono font-medium tabular-nums">{s.serialCode}</p>
                  <p className="text-xs text-slate-500 tabular-nums">{s.bin?.code || "No bin"} | {s.condition}</p>
                </div>
                <Badge variant={s.status === "IN_STOCK" ? "success" : s.status === "SOLD" ? "info" : "warning"}>
                  {s.status.replace("_", " ")}
                </Badge>
              </div>
            ))}
            {inStockSerials.length > 0 && (
              <Link href={`/stock/${product.id}/barcode`}>
                <Button variant="outline" size="sm" className="w-full mt-3">
                  <QrCode className="h-3.5 w-3.5 mr-1.5" />Generate Barcodes
                </Button>
              </Link>
            )}
          </CardContent>
        </Card>
      )}

      {product.tags.length > 0 && (
        <Card className="mb-3">
          <CardHeader><CardTitle className="flex items-center gap-1.5"><Tag className="h-3.5 w-3.5" /> Tags</CardTitle></CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-1.5">
              {product.tags.map((tag) => (<Badge key={tag} variant="info">{tag}</Badge>))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="mb-3">
        <CardHeader><CardTitle>Recent Transactions</CardTitle></CardHeader>
        <CardContent>
          {product.transactions.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-4">No transactions yet</p>
          ) : (
            product.transactions.slice(0, 5).map((t) => (
              <TransactionItem
                key={t.id}
                direction={t.type === "INWARD" ? "in" : "out"}
                productName={product.name}
                sku={product.sku}
                quantity={t.quantity}
                time={formatTime(t.createdAt)}
                reference={t.referenceNo || undefined}
                label={parseTransactionLabel(t.notes, t.type)}
              />
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
