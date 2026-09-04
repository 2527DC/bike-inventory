"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { ArrowLeft, Trash2, Tag, Plus, Pencil, Check, X, GitMerge, Package } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SkeletonList } from "@/components/ui/skeleton";
import { ErrorBanner } from "@/components/ui/error-banner";
import { ActionConfirmation } from "@/components/ui/action-confirmation";
import { usePermissions } from "@/lib/use-permissions";
import { apiFetch, apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";
import { PLACEHOLDER_CATEGORY } from "@/lib/import-placeholders";

const log = createLogger("categories");

// The product taxonomy screen.
//
// Until this existed the taxonomy was entirely Zoho's: five of the seven places that create
// a Category are import routes mirroring `category_name` verbatim, and nothing in the UI
// ever called POST /api/categories. That is why several categories are wheel sizes and 151
// products sit in "Uncategorized".
//
// MERGE is therefore the operation that matters here, not create. The useful action is
// "move everything in `16` into Bicycles and delete `16`" — so merge is a first-class button
// on every row rather than something behind a menu.
//
// Deliberately modelled on /more/brands: same card list, same inline rename, same
// ActionConfirmation for a refusal. Two screens that do the same job should not need to be
// learned twice.

interface CategoryItem {
  id: string;
  name: string;
  description: string | null;
  reorderLevel: number;
  parent: { id: string; name: string } | null;
  _count: { products: number; children: number };
}

/** Delete answers with this. `deleted: false` is a refusal with a reason, not a failure. */
interface DeleteOutcome {
  deleted: boolean;
  name: string;
  message: string;
}

export default function CategoriesPage() {
  const { canView, canCreate, canEdit, canDelete, loading: permsLoading } = usePermissions();

  const [categories, setCategories] = useState<CategoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<DeleteOutcome | null>(null);

  // Inline edit — one row at a time. `draft` holds only what is being changed.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  const [mergeSource, setMergeSource] = useState<string | null>(null);
  const [mergeTarget, setMergeTarget] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await apiTry<CategoryItem[]>("/api/categories");
    if (err) {
      log.error("could not load categories", { message: err });
      setError(err);
      setCategories([]);
    } else {
      setCategories(data ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function startEdit(c: CategoryItem) {
    setEditingId(c.id);
    setDraftName(c.name);
  }

  function cancelEdit() {
    setEditingId(null);
    setDraftName("");
  }

  async function saveEdit(c: CategoryItem) {
    if (!draftName.trim()) return setError("A category needs a name");
    // Name is the only editable field now that movingLevel is gone. An unchanged save would
    // send {} and the API answers 400 "Nothing to update", so close the row instead.
    if (draftName.trim() === c.name) return cancelEdit();

    setBusy(c.id);
    setError(null);
    try {
      await apiFetch(`/api/categories/${c.id}`, {
        method: "PATCH",
        json: { name: draftName.trim() },
      });
      log.info("category saved", { categoryId: c.id });
      cancelEdit();
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not save";
      log.error("category save failed", { categoryId: c.id, message: msg });
      setError(msg);
    } finally {
      setBusy(null);
    }
  }

  async function create() {
    if (!newName.trim()) return;
    setBusy("new");
    setError(null);
    try {
      await apiFetch("/api/categories", { method: "POST", json: { name: newName.trim() } });
      log.info("category created");
      setNewName("");
      setCreating(false);
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not create the category";
      log.error("category create failed", { message: msg });
      setError(msg);
    } finally {
      setBusy(null);
    }
  }

  async function remove(c: CategoryItem) {
    if (!confirm(`Delete ${c.name}? If anything still references it you will be told instead.`)) return;
    setBusy(c.id);
    try {
      // A refusal arrives as 200 with deleted:false and a reason. Rendering it as a failure
      // would be wrong — nothing broke, the request was declined for a stated cause.
      const res = await apiFetch<DeleteOutcome>(`/api/categories/${c.id}`, { method: "DELETE" });
      log.info("category delete handled", { categoryId: c.id, deleted: res.deleted });
      setOutcome(res);
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not delete";
      log.error("category delete failed", { categoryId: c.id, message: msg });
      setOutcome({ deleted: false, name: c.name, message: msg });
    } finally {
      setBusy(null);
    }
  }

  async function merge() {
    if (!mergeSource || !mergeTarget) return;
    setBusy(mergeSource);
    setError(null);
    try {
      await apiFetch(`/api/categories/${mergeSource}/merge`, {
        method: "POST",
        json: { targetCategoryId: mergeTarget },
      });
      log.info("categories merged", { from: mergeSource, to: mergeTarget });
      setMergeSource(null);
      setMergeTarget("");
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not merge";
      log.error("category merge failed", { message: msg });
      setError(msg);
    } finally {
      setBusy(null);
    }
  }

  // permsLoading first, always. Rendering a denial before the grants arrive flashes
  // "access required" on every visit.
  if (permsLoading) return null;

  if (!canView("categories")) {
    return (
      <div className="text-center py-12">
        <p className="text-sm text-slate-400">You do not have permission to view categories</p>
      </div>
    );
  }

  const mayEdit = canEdit("categories");
  const mayMerge = canCreate("categories"); // merge is guarded on categories.create by the API
  const mayDelete = canDelete("categories");
  const totalProducts = categories.reduce((sum, c) => sum + c._count.products, 0);

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        {/* Back to the parent hub, not /more — Categories is a Stock Management child now. */}
        <Link href="/stock-management" aria-label="Back" className="p-2 -ml-2 rounded-lg hover:bg-slate-100 focus-ring">
          <ArrowLeft className="h-5 w-5 text-slate-600" />
        </Link>
        <div className="flex-1">
          <h1 className="text-lg font-bold text-slate-900">Categories</h1>
          <p className="text-xs text-slate-500 tabular-nums">
            {categories.length} categor{categories.length === 1 ? "y" : "ies"} · {totalProducts} product
            {totalProducts === 1 ? "" : "s"} filed
          </p>
        </div>
        {canCreate("categories") && !creating && (
          <Button size="sm" className="bg-blue-600 hover:bg-blue-700" onClick={() => setCreating(true)}>
            <Plus className="h-3.5 w-3.5 mr-1" />New
          </Button>
        )}
      </div>

      {error && <ErrorBanner message={error} onRetry={() => void load()} />}

      {creating && (
        <Card className="mb-3 border-blue-200">
          <CardContent className="p-3 flex gap-2">
            <Input
              placeholder="Category name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void create()}
              autoFocus
              className="min-h-[40px]"
            />
            <Button size="sm" onClick={() => void create()} disabled={!newName.trim() || busy === "new"}>
              <Check className="h-3.5 w-3.5" />
            </Button>
            <Button size="sm" variant="outline" onClick={() => { setCreating(false); setNewName(""); }}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <SkeletonList count={5} type="card" />
      ) : categories.length === 0 ? (
        <div className="text-center py-12">
          <Tag className="h-12 w-12 text-slate-300 mx-auto mb-3" />
          <p className="text-sm text-slate-500">No categories yet</p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {categories.map((c) => {
            const isEditing = editingId === c.id;
            const isMerging = mergeSource === c.id;

            return (
              <Card key={c.id}>
                <CardContent className="p-3">
                  {isEditing ? (
                    <div className="flex flex-col sm:flex-row gap-2">
                      <Input
                        value={draftName}
                        onChange={(e) => setDraftName(e.target.value)}
                        className="min-h-[40px] flex-1"
                        aria-label="Category name"
                        autoFocus
                      />
                      <div className="flex gap-1.5">
                        <Button size="sm" onClick={() => void saveEdit(c)} disabled={busy === c.id}>
                          <Check className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="sm" variant="outline" onClick={cancelEdit}>
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <Tag className="h-4 w-4 text-slate-400 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-semibold text-slate-900">{c.name}</p>
                          <Badge variant="info" className="text-[10px] tabular-nums">
                            {c._count.products} product{c._count.products === 1 ? "" : "s"}
                          </Badge>
                          {c._count.children > 0 && (
                            <Badge variant="default" className="text-[10px] tabular-nums">
                              {c._count.children} sub
                            </Badge>
                          )}
                        </div>
                        {(c.parent || c.description) && (
                          <p className="text-[11px] text-slate-500 mt-0.5 truncate">
                            {[c.parent ? `in ${c.parent.name}` : null, c.description].filter(Boolean).join(" · ")}
                          </p>
                        )}
                      </div>
                      <div className="flex gap-1 shrink-0">
                        {mayEdit && (
                          <IconBtn label={`Edit ${c.name}`} onClick={() => startEdit(c)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </IconBtn>
                        )}
                        {mayMerge && categories.length > 1 && (
                          <IconBtn label={`Merge ${c.name} into another category`} onClick={() => setMergeSource(c.id)}>
                            <GitMerge className="h-3.5 w-3.5" />
                          </IconBtn>
                        )}
                        {mayDelete && (
                          <IconBtn label={`Delete ${c.name}`} danger disabled={busy === c.id} onClick={() => void remove(c)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </IconBtn>
                        )}
                      </div>
                    </div>
                  )}

                  {isMerging && (
                    <div className="mt-2 pt-2 border-t border-slate-200">
                      <p className="text-[11px] text-slate-600 mb-1.5">
                        Move {c._count.products} product{c._count.products === 1 ? "" : "s"} from{" "}
                        <strong>{c.name}</strong> into another category, then delete <strong>{c.name}</strong>.
                        This cannot be undone.
                      </p>
                      <div className="flex gap-2">
                        <select
                          value={mergeTarget}
                          onChange={(e) => setMergeTarget(e.target.value)}
                          aria-label={`Merge ${c.name} into`}
                          className="flex-1 min-h-[40px] rounded-lg border border-slate-300 bg-white px-2 text-sm focus-ring"
                        >
                          <option value="">Merge into…</option>
                          {categories.filter((t) => t.id !== c.id).map((t) => (
                            <option key={t.id} value={t.id}>{t.name}</option>
                          ))}
                        </select>
                        <Button size="sm" onClick={() => void merge()} disabled={!mergeTarget || busy === c.id}>
                          {busy === c.id ? "Merging…" : "Merge"}
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => { setMergeSource(null); setMergeTarget(""); }}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Why this screen exists, said once at the bottom rather than as a banner nobody
          reads twice.
          Reworded now that Uncategorized is the whole catalog's starting state rather than an
          import's failure: `scripts/import-products.ts` files every product there by design,
          so "the import had no category for them" is no longer the story and a conditional
          banner would show permanently. */}
      {!loading && categories.some((c) => c.name === PLACEHOLDER_CATEGORY && c._count.products > 0) && (
        <p className="text-[11px] text-slate-500 mt-4 flex items-start gap-1.5">
          <Package className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span>
            <strong>{PLACEHOLDER_CATEGORY}</strong> is where every imported product starts.
            Build the categories you want here, then reassign products in bulk from Stock.
          </span>
        </p>
      )}

      {outcome && (
        <ActionConfirmation
          open
          onClose={() => setOutcome(null)}
          type={outcome.deleted ? "success" : "warning"}
          title={outcome.deleted ? "Deleted" : "Not deleted"}
          referenceId={outcome.name}
          details={outcome.message}
        />
      )}
    </div>
  );
}

function IconBtn({
  label, onClick, children, danger, disabled,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={`min-h-[36px] min-w-[36px] inline-flex items-center justify-center rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-40 focus-ring ${
        danger ? "text-red-600" : "text-slate-600"
      }`}
    >
      {children}
    </button>
  );
}
