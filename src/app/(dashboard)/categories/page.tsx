"use client";

import { useState, useEffect, useCallback, Fragment } from "react";
import Link from "next/link";
import { ArrowLeft, Tag, Plus, Check, X, Package } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SkeletonList } from "@/components/ui/skeleton";
import { ErrorBanner } from "@/components/ui/error-banner";
import { ActionConfirmation } from "@/components/ui/action-confirmation";
import { ZohoTaxonomySheet } from "@/components/zoho-taxonomy-sheet";
import { usePermissions } from "@/lib/use-permissions";
import { apiFetch, apiTry, ApiError } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";
import { PLACEHOLDER_CATEGORY } from "@/lib/import-placeholders";
import { buildCategoryTree, type CategoryTreeNode } from "@/lib/categories/tree";
import { CategoryTreeSelect } from "@/components/category-tree-select";
import { CategoryRow, type CategoryItem } from "./_components/category-row";

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
//
// Since plan 1709 (R43, P12) the list is the TREE: each parent followed by its children,
// indented, with expand/collapse. The tree comes from Zoho's import; a parent can also be
// chosen by hand on create and edit. Nothing is pushed back to Zoho.

/** What PATCH answers when `isActive` flips: the row plus what the cascade did. */
interface ToggleResult extends CategoryItem {
  productsChanged: number;
  subcategoriesChanged: number;
  unitsOnHand: number;
}

/** Rendered in the ActionConfirmation after a toggle — success, or a refusal with a reason. */
interface ToggleOutcome {
  type: "success" | "warning";
  title: string;
  name: string;
  message: string;
}

type StatusFilter = "ACTIVE" | "INACTIVE" | "ALL";

const STATUS_CHIPS: { key: StatusFilter; label: string }[] = [
  { key: "ACTIVE", label: "Active" },
  { key: "INACTIVE", label: "Inactive" },
  { key: "ALL", label: "All" },
];

export default function CategoriesPage() {
  const { canView, canCreate, canEdit, loading: permsLoading } = usePermissions();

  const [categories, setCategories] = useState<CategoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<ToggleOutcome | null>(null);
  // Default Active: the inactive rows are the retired ones, shown on request.
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ACTIVE");

  // Inline edit — one row at a time. `draft` holds only what is being changed.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftParentId, setDraftParentId] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newParentId, setNewParentId] = useState<string | null>(null);

  // Collapsed rather than expanded is stored: a fresh visit shows the whole tree (~30 rows).
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const [mergeSource, setMergeSource] = useState<string | null>(null);
  const [mergeTarget, setMergeTarget] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    // This screen is the master, so it asks for every row. Every other caller of
    // GET /api/categories takes the default, which is active rows only.
    const { data, error: err } = await apiTry<CategoryItem[]>("/api/categories?includeInactive=1");
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
    setDraftParentId(c.parentId);
  }

  function cancelEdit() {
    setEditingId(null);
    setDraftName("");
    setDraftParentId(null);
  }

  async function saveEdit(c: CategoryItem) {
    if (!draftName.trim()) return setError("A category needs a name");
    // Only what moved is sent. An unchanged save would send {} and the API answers 400
    // "Nothing to update", so close the row instead. The API re-checks the parent for a loop.
    const json: { name?: string; parentId?: string | null } = {};
    if (draftName.trim() !== c.name) json.name = draftName.trim();
    if ((draftParentId ?? null) !== (c.parentId ?? null)) json.parentId = draftParentId;
    if (Object.keys(json).length === 0) return cancelEdit();

    setBusy(c.id);
    setError(null);
    try {
      await apiFetch(`/api/categories/${c.id}`, { method: "PATCH", json });
      log.info("category saved", { categoryId: c.id, fields: Object.keys(json) });
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
      await apiFetch("/api/categories", {
        method: "POST",
        json: { name: newName.trim(), ...(newParentId ? { parentId: newParentId } : {}) },
      });
      log.info("category created", { parentId: newParentId });
      setNewName("");
      setNewParentId(null);
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

  /**
   * Active ⇄ inactive. Replaces delete (owner, 8 Sep 2026): nothing is removed, the category
   * leaves every picker and its products — and its sub-categories with theirs — go inactive
   * with it. Activating brings the category back and, only if the person says so, the
   * products that went down with it; a sub-category is activated on its own row, and the
   * API refuses to activate one whose parent is still inactive.
   */
  async function toggleActive(c: CategoryItem) {
    const products = `${c._count.products} product${c._count.products === 1 ? "" : "s"}`;
    const subs = c._count.children > 0
      ? ` and its ${c._count.children} sub-categor${c._count.children === 1 ? "y" : "ies"}`
      : "";
    let reactivateProducts = false;

    if (c.isActive) {
      if (
        !confirm(
          `Deactivate ${c.name}? Its ${products}${subs} will be set inactive and it leaves every category picker. Nothing is deleted.`
        )
      ) return;
    } else {
      if (!confirm(`Activate ${c.name}? It returns to every category picker.`)) return;
      if (c._count.products > 0) {
        reactivateProducts = confirm(
          `Also restore the products that went inactive with ${c.name}? OK restores them, Cancel leaves them inactive.`
        );
      }
    }

    setBusy(c.id);
    setError(null);
    try {
      const res = await apiFetch<ToggleResult>(`/api/categories/${c.id}`, {
        method: "PATCH",
        json: { isActive: !c.isActive, ...(reactivateProducts ? { reactivateProducts: true } : {}) },
      });
      log.info("category active toggled", {
        categoryId: c.id,
        isActive: res.isActive,
        productsChanged: res.productsChanged,
        unitsOnHand: res.unitsOnHand,
      });
      const changed = `${res.productsChanged} product${res.productsChanged === 1 ? "" : "s"}`;
      const units = `${res.unitsOnHand} unit${res.unitsOnHand === 1 ? "" : "s"}`;
      setOutcome({
        type: "success",
        title: res.isActive ? "Activated" : "Deactivated",
        name: c.name,
        message: res.isActive
          ? res.productsChanged > 0
            ? `${changed} restored.`
            : "Its products were left as they were."
          : `${changed}${
              res.subcategoriesChanged > 0
                ? ` and ${res.subcategoriesChanged} sub-categor${res.subcategoriesChanged === 1 ? "y" : "ies"}`
                : ""
            } set inactive · ${units} stay on the books.`,
      });
      await load();
    } catch (e) {
      // A 400 is a refusal with a reason (the placeholder, or a parent still inactive) —
      // rendered as a warning, not a failure, because nothing broke.
      const msg = e instanceof Error ? e.message : "Could not update the category";
      if (e instanceof ApiError && e.status === 400) {
        log.warn("category toggle refused", { categoryId: c.id, message: msg });
      } else {
        log.error("category toggle failed", { categoryId: c.id, message: msg });
      }
      setOutcome({ type: "warning", title: "Not changed", name: c.name, message: msg });
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
  const totalProducts = categories.reduce((sum, c) => sum + c._count.products, 0);

  const activeCount = categories.filter((c) => c.isActive).length;
  const inactiveCount = categories.length - activeCount;
  const visible =
    statusFilter === "ALL" ? categories
    : statusFilter === "ACTIVE" ? categories.filter((c) => c.isActive)
    : categories.filter((c) => !c.isActive);
  // Merging INTO a retired category would hide the moved products; only live ones are targets.
  const mergeTargets = categories.filter((c) => c.isActive);
  // A new or moved category goes under a live parent — the API refuses to activate a child
  // of an inactive one, so offering one here would only set up that refusal.
  const activeRows = mergeTargets;

  // The tree is built from the FILTERED rows: a child whose parent is filtered out becomes a
  // root of its own and says where it sits ("in Bicycles").
  const tree = buildCategoryTree(visible);
  const visibleIds = new Set(visible.map((c) => c.id));
  const parentIds = visible.filter((c) => visible.some((k) => k.parentId === c.id)).map((c) => c.id);
  const allCollapsed = parentIds.length > 0 && parentIds.every((id) => collapsed.has(id));

  function toggleCollapsed(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function renderNodes(nodes: CategoryTreeNode<CategoryItem>[]): React.ReactNode {
    return nodes.map((c) => {
      const expanded = !collapsed.has(c.id);
      // The picker must still label the current parent when that parent has gone inactive.
      const parentOptions =
        c.parentId && !activeRows.some((r) => r.id === c.parentId)
          ? [...activeRows, ...categories.filter((r) => r.id === c.parentId)]
          : activeRows;
      return (
        <Fragment key={c.id}>
          <CategoryRow
            category={c}
            depth={c.depth}
            visibleChildren={c.children.length}
            expanded={expanded}
            onToggleExpand={() => toggleCollapsed(c.id)}
            showParentHint={!!c.parentId && !visibleIds.has(c.parentId)}
            mayEdit={mayEdit}
            mayMerge={mayMerge}
            busy={busy === c.id}
            editing={editingId === c.id}
            draftName={draftName}
            onDraftName={setDraftName}
            draftParentId={draftParentId}
            onDraftParentId={setDraftParentId}
            parentOptions={parentOptions}
            onStartEdit={() => startEdit(c)}
            onSaveEdit={() => void saveEdit(c)}
            onCancelEdit={cancelEdit}
            merging={mergeSource === c.id}
            mergeTargets={mergeTargets}
            mergeTarget={mergeTarget}
            onMergeTarget={setMergeTarget}
            onStartMerge={() => setMergeSource(c.id)}
            onMerge={() => void merge()}
            onCancelMerge={() => {
              setMergeSource(null);
              setMergeTarget("");
            }}
            onToggleActive={() => void toggleActive(c)}
          />
          {expanded && c.children.length > 0 && renderNodes(c.children)}
        </Fragment>
      );
    });
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        {/* Back to /stock: Categories left the menu and is reached from /stock (plan 1709, Q27). */}
        <Link href="/stock" aria-label="Back" className="p-2 -ml-2 rounded-lg hover:bg-slate-100 focus-ring">
          <ArrowLeft className="h-5 w-5 text-slate-600" />
        </Link>
        <div className="flex-1">
          <h1 className="text-lg font-bold text-slate-900">Categories</h1>
          <p className="text-xs text-slate-500 tabular-nums">
            {activeCount} active{inactiveCount > 0 ? ` · ${inactiveCount} inactive` : ""} · {totalProducts} product
            {totalProducts === 1 ? "" : "s"} filed
          </p>
        </div>
        {/* Renders nothing at all without categories.fetch, so it is safe beside New. */}
        <ZohoTaxonomySheet kind="category" onDone={() => void load()} />
        {canCreate("categories") && !creating && (
          <Button size="sm" className="bg-blue-600 hover:bg-blue-700" onClick={() => setCreating(true)}>
            <Plus className="h-3.5 w-3.5 mr-1" />New
          </Button>
        )}
      </div>

      {error && <ErrorBanner message={error} onRetry={() => void load()} />}

      {creating && (
        <Card className="mb-3 border-blue-200">
          <CardContent className="p-3 flex flex-col gap-2">
            <Input
              placeholder="Category name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void create()}
              autoFocus
              className="min-h-[40px]"
              aria-label="Category name"
            />
            <div>
              <label htmlFor="new-category-parent" className="text-[10px] font-medium text-slate-500 uppercase tracking-wide">
                Parent (optional)
              </label>
              <CategoryTreeSelect
                id="new-category-parent"
                categories={activeRows}
                value={newParentId}
                onChange={setNewParentId}
                placeholder="Top level (no parent)"
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button size="sm" onClick={() => void create()} disabled={!newName.trim() || busy === "new"} aria-label="Create">
                <Check className="h-3.5 w-3.5" />
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => { setCreating(false); setNewName(""); setNewParentId(null); }}
                aria-label="Cancel"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Active / Inactive / All — the same pill row /vendors uses for its sort. */}
      <div className="flex gap-1.5 mb-3 pb-1" role="group" aria-label="Show categories">
        {STATUS_CHIPS.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => setStatusFilter(s.key)}
            aria-pressed={statusFilter === s.key}
            className={`shrink-0 px-2.5 py-1 min-h-[32px] rounded-full text-[11px] font-medium transition-colors focus-ring ${
              statusFilter === s.key ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200"
            }`}
          >
            {s.label}
          </button>
        ))}
        {parentIds.length > 0 && (
          <button
            type="button"
            onClick={() => setCollapsed(allCollapsed ? new Set() : new Set(parentIds))}
            className="ml-auto shrink-0 px-2.5 py-1 min-h-[32px] rounded-full text-[11px] font-medium text-slate-500 hover:bg-slate-100 focus-ring"
          >
            {allCollapsed ? "Expand all" : "Collapse all"}
          </button>
        )}
      </div>

      {loading ? (
        <SkeletonList count={5} type="card" />
      ) : categories.length === 0 ? (
        <div className="text-center py-12">
          <Tag className="h-12 w-12 text-slate-300 mx-auto mb-3" />
          <p className="text-sm text-slate-500">No categories yet</p>
        </div>
      ) : visible.length === 0 ? (
        <div className="text-center py-12">
          <Tag className="h-12 w-12 text-slate-300 mx-auto mb-3" />
          <p className="text-sm text-slate-500">
            No {statusFilter === "INACTIVE" ? "inactive" : "active"} categories
          </p>
        </div>
      ) : (
        <div className="space-y-1.5">{renderNodes(tree)}</div>
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
          type={outcome.type}
          title={outcome.title}
          referenceId={outcome.name}
          details={outcome.message}
        />
      )}
    </div>
  );
}
