"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { ArrowLeft, Plus, Loader2, Tag, Check, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SkeletonList } from "@/components/ui/skeleton";
import { ErrorBanner } from "@/components/ui/error-banner";
import { usePermissions } from "@/lib/use-permissions";
import { apiFetch, apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";

const log = createLogger("product-types");

interface ProductType {
  id: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
  _count: { products: number };
}

/**
 * The product type master.
 *
 * Types used to be a Prisma enum of six fixed values; adding one meant a schema change and a
 * deploy. They are rows now, and this is where they are managed.
 *
 * There is deliberately no delete. `Product.productTypeId` is required and the foreign key is
 * RESTRICT, so removing a type in use fails at the database — and removing an unused one
 * still breaks any saved report that named it. Deactivating takes it out of every picker
 * while the products that hold it keep a valid answer.
 */
export default function ProductTypesPage() {
  const { canCreate, canEdit } = usePermissions();
  const mayCreate = canCreate("product_types");
  const mayEdit = canEdit("product_types");

  const [types, setTypes] = useState<ProductType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await apiTry<ProductType[]>("/api/product-types");
    if (data) setTypes(data);
    if (err) {
      setError(err);
      log.error("failed to load product types", { message: err });
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    setError(null);
    try {
      // The next slot after the current last, so a new type lands at the end of the tab bar
      // rather than jumping to the front on a 0 default.
      const sortOrder = types.length ? Math.max(...types.map((t) => t.sortOrder)) + 10 : 10;
      await apiFetch("/api/product-types", { method: "POST", json: { name, sortOrder } });
      setNewName("");
      await load();
      log.info("product type created", { name });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not create";
      setError(msg);
      log.error("create failed", { message: msg });
    } finally {
      setCreating(false);
    }
  }

  async function patch(id: string, body: Record<string, unknown>) {
    setBusyId(id);
    setError(null);
    try {
      await apiFetch(`/api/product-types/${id}`, { method: "PATCH", json: body });
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not update";
      setError(msg);
      log.error("update failed", { productTypeId: id, message: msg });
    } finally {
      setBusyId(null);
    }
  }

  async function saveRename(t: ProductType) {
    const name = editName.trim();
    setEditingId(null);
    if (!name || name === t.name) return;
    await patch(t.id, { name });
  }

  return (
    <div className="p-4 pb-24 max-w-2xl mx-auto">
      <div className="flex items-center gap-2 mb-1">
        <Link href="/stock" className="p-1 -ml-1 rounded-lg hover:bg-slate-100 focus-ring">
          <ArrowLeft className="h-5 w-5 text-slate-600" />
        </Link>
        <h1 className="text-lg font-bold text-slate-900">Product Types</h1>
      </div>
      <p className="text-[11px] text-slate-500 mb-4 ml-7">
        The list every product is filed under, and the tabs on Stock.
      </p>

      {error && (
        <ErrorBanner message={error} onRetry={load} onDismiss={() => setError(null)} />
      )}

      {mayCreate && (
        <Card className="mb-4">
          <CardContent className="p-3">
            <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wide">
              Add a type
            </label>
            <div className="flex gap-2 mt-1">
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); }}
                placeholder="E-Bike"
                maxLength={40}
                className="flex-1"
              />
              <Button onClick={handleCreate} disabled={creating || !newName.trim()} className="min-h-[44px]">
                {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                <span className="ml-1">Add</span>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <SkeletonList />
      ) : types.length === 0 ? (
        <div className="text-center py-12">
          <Tag className="h-8 w-8 text-slate-300 mx-auto mb-2" />
          <p className="text-sm text-slate-500">No product types yet.</p>
          <p className="text-xs text-slate-400 mt-1">
            Every product needs one, so add at least a type before creating products.
          </p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {types.map((t) => (
            <Card key={t.id} className={t.isActive ? "" : "opacity-60"}>
              <CardContent className="p-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  {editingId === t.id ? (
                    <div className="flex gap-1.5 items-center">
                      <Input
                        autoFocus
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveRename(t);
                          if (e.key === "Escape") setEditingId(null);
                        }}
                        maxLength={40}
                        className="h-9"
                      />
                      <button
                        onClick={() => saveRename(t)}
                        className="p-1.5 rounded-lg text-green-600 hover:bg-green-50 focus-ring"
                        aria-label="Save name"
                      >
                        <Check className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 focus-ring"
                        aria-label="Cancel"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => { if (mayEdit) { setEditingId(t.id); setEditName(t.name); } }}
                      disabled={!mayEdit}
                      className="text-left disabled:cursor-default focus-ring rounded"
                    >
                      <p className="text-sm font-semibold text-slate-900">{t.name}</p>
                      <p className="text-[11px] text-slate-400 tabular-nums">
                        {t._count.products} product{t._count.products === 1 ? "" : "s"}
                      </p>
                    </button>
                  )}
                </div>

                {!t.isActive && <Badge variant="default" className="text-[10px]">Retired</Badge>}

                {mayEdit && editingId !== t.id && (
                  <button
                    onClick={() => patch(t.id, { isActive: !t.isActive })}
                    disabled={busyId === t.id}
                    className={`min-h-[36px] px-2.5 rounded-lg text-xs font-medium disabled:opacity-50 focus-ring ${
                      t.isActive
                        ? "bg-slate-100 text-slate-600 hover:bg-slate-200"
                        : "bg-green-600 text-white hover:bg-green-700"
                    }`}
                  >
                    {busyId === t.id
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : t.isActive ? "Retire" : "Restore"}
                  </button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Said once, at the bottom. A type in use cannot be deleted — the foreign key is
          RESTRICT — and this explains what to do instead before anyone goes looking for a
          delete button that is not there. */}
      {!loading && types.length > 0 && (
        <p className="text-[11px] text-slate-500 mt-4 flex items-start gap-1.5">
          <Tag className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span>
            Types cannot be deleted — products point at them. <strong>Retire</strong> takes one
            out of the pickers and the Stock tabs; every product already filed under it keeps it.
          </span>
        </p>
      )}
    </div>
  );
}
