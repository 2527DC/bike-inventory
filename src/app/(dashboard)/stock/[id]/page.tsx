"use client";

import { use, useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { BIN_TRACKING_ENABLED } from "@/lib/inventory-config";
import Link from "next/link";
import { ArrowLeft, QrCode, MapPin, Tag, Package, IndianRupee, Pencil, Save, X, Power } from "lucide-react";
import { LabelPrintButton } from "@/components/label-print";
import { Badge } from "@/components/ui/badge";
import { SkeletonList } from "@/components/ui/skeleton";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TransactionItem } from "@/components/transaction-item";
import { usePermissions } from "@/lib/use-permissions";

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
  type: string;
  status: string;
  condition: string;
  currentStock: number;
  reservedStock: number;
  reorderLevel: number;
  maxStock: number;
  costPrice: number;
  sellingPrice: number;
  mrp: number;
  gstRate: number;
  hsnCode: string | null;
  size: string | null;
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
  const role = (session?.user as { role?: string })?.role || "";
  const { canEdit: canEditCheck } = usePermissions();
  const isAdmin = role === "ADMIN" || role === "CEO";
  const canEdit = canEditCheck("stock");
  const canEditType = true; // all authenticated users can reclassify product type
  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState("");
  const [editData, setEditData] = useState<Record<string, unknown>>({ name: "", color: "", size: "", sellingPrice: 0, mrp: 0, reorderLevel: 0, brandId: "", binId: "", type: "" });
  const [brands, setBrands] = useState<{ id: string; name: string }[]>([]);
  const [bins, setBins] = useState<{ id: string; code: string; name: string; location: string }[]>([]);

  useEffect(() => {
    Promise.all([
      fetch("/api/brands").then((r) => r.json()),
      BIN_TRACKING_ENABLED ? fetch("/api/bins").then((r) => r.json()) : Promise.resolve({ success: false }),
    ]).then(([bRes, binRes]) => {
      if (bRes.success) setBrands(bRes.data);
      if (binRes.success) setBins(binRes.data);
    }).catch(() => {});
  }, []);

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

  function startEdit() {
    setEditData({
      name: product!.name,
      color: (product as unknown as Record<string, string>).color || "",
      size: product!.size || "",
      sellingPrice: product!.sellingPrice,
      mrp: product!.mrp,
      reorderLevel: product!.reorderLevel,
      brandId: product!.brandId || "",
      binId: product!.binId || "",
      type: product!.type || "",
    });
    setEditing(true);
  }

  async function handleSave() {
    setSaving(true);
    setActionError("");
    try {
      let res;
      if (canEdit) {
        // Full edit — admin/purchase manager
        // Only send non-empty fields; skip type if not set (empty string fails enum validation)
        const payload: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(editData)) {
          if (v !== "" && v !== undefined) payload[k] = v;
        }
        res = await fetch(`/api/products/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } else {
        // Type-only reclassification — all authenticated users
        res = await fetch(`/api/products/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: editData.type }),
        });
      }
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
        {(canEdit || canEditType) && !editing && (
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

            {/* Type selector — visible to ALL users */}
            <div>
              <label className="text-[11px] text-slate-500 uppercase tracking-wide font-medium">Item Type</label>
              <div className="grid grid-cols-3 gap-1.5 mt-1">
                {([
                  { key: "BICYCLE", label: "Cycle" },
                  { key: "SPARE_PART", label: "Spare" },
                  { key: "ACCESSORY", label: "Accessory" },
                ] as const).map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setEditData({ ...editData, type: t.key })}
                    className={`py-2 rounded-lg text-xs font-semibold border transition-colors ${
                      editData.type === t.key
                        ? "bg-blue-600 text-white border-blue-600"
                        : "bg-white text-slate-600 border-slate-200 hover:border-slate-400"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

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
                    {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
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
                    <label className="text-[11px] text-slate-500">Size</label>
                    <Input value={editData.size as string} onChange={(e) => setEditData({ ...editData, size: e.target.value })} placeholder='e.g. 26"' />
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
      {(product.brand || (product.type === "BICYCLE" && product.size) || product.condition !== "NEW") && (
        <div className="flex flex-wrap gap-2 mb-3">
          {product.brand && <Badge variant="default" className="font-semibold">{product.brand.name}</Badge>}
          {product.type === "BICYCLE" && product.size && <Badge variant="default">{product.size}</Badge>}
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
                product.reorderLevel > 0 && product.currentStock <= product.reorderLevel ? "text-yellow-600" : "text-green-600"
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
