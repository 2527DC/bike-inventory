"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { ArrowLeft, Trash2, Tag, Plus, Pencil, Check, X, GitMerge, Clock } from "lucide-react";
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

const log = createLogger("brands");

interface BrandItem {
  id: string;
  name: string;
  contactPhone: string | null;
  whatsappNumber: string | null;
  /** Days this brand takes to deliver. A column on Brand since the BrandLeadTime fold. */
  leadDays: number;
  /**
   * Cash-discount terms. DEAD as far as any calculation is concerned — every one of the
   * cash-discount usages in src/ reads Vendor, not Brand. Four brands nonetheless carry real
   * values, so they are shown read-only rather than hidden: invisible data is how it stays
   * wrong. Owner's decision 30 Aug 2026 was to keep the columns.
   */
  cdTermsDays: number | null;
  cdPercentage: number | null;
  _count: { products: number };
}

/** Both delete and merge answer with this. `deleted: false` is a refusal, not a failure. */
interface DeleteOutcome {
  deleted: boolean;
  name: string;
  message: string;
}

export default function BrandsPage() {
  const { canView, canCreate, canEdit, canDelete, loading: permsLoading } = usePermissions();

  const [brands, setBrands] = useState<BrandItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<DeleteOutcome | null>(null);

  // Inline edit — one row at a time. `draft` holds only what is being changed.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftLead, setDraftLead] = useState("");

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  const [mergeSource, setMergeSource] = useState<string | null>(null);
  const [mergeTarget, setMergeTarget] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await apiTry<BrandItem[]>("/api/brands");
    if (err) {
      log.error("could not load brands", { message: err });
      setError(err);
      setBrands([]);
    } else {
      setBrands(data ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function startEdit(b: BrandItem) {
    setEditingId(b.id);
    setDraftName(b.name);
    setDraftLead(String(b.leadDays));
  }

  function cancelEdit() {
    setEditingId(null);
    setDraftName("");
    setDraftLead("");
  }

  async function saveEdit(b: BrandItem) {
    const leadDays = parseInt(draftLead, 10);
    if (!draftName.trim()) return setError("A brand needs a name");
    if (!Number.isFinite(leadDays) || leadDays < 1) return setError("Lead time must be at least 1 day");

    setBusy(b.id);
    setError(null);
    try {
      // Sends only what changed. The API takes every field as optional for this reason.
      await apiFetch(`/api/brands/${b.id}`, {
        method: "PATCH",
        json: {
          ...(draftName.trim() !== b.name ? { name: draftName.trim() } : {}),
          ...(leadDays !== b.leadDays ? { leadDays } : {}),
        },
      });
      log.info("brand saved", { brandId: b.id });
      cancelEdit();
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not save";
      log.error("brand save failed", { brandId: b.id, message: msg });
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
      await apiFetch("/api/brands", { method: "POST", json: { name: newName.trim() } });
      log.info("brand created");
      setNewName("");
      setCreating(false);
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not create the brand";
      log.error("brand create failed", { message: msg });
      setError(msg);
    } finally {
      setBusy(null);
    }
  }

  async function remove(b: BrandItem) {
    if (!confirm(`Delete ${b.name}? If anything still references it you will be told instead.`)) return;
    setBusy(b.id);
    try {
      // A refusal arrives as 200 with deleted:false and a reason. Rendering it as a failure
      // would be wrong — nothing broke, the request was declined for a stated cause.
      const res = await apiFetch<DeleteOutcome>(`/api/brands/${b.id}`, { method: "DELETE" });
      log.info("brand delete handled", { brandId: b.id, deleted: res.deleted });
      setOutcome(res);
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not delete";
      log.error("brand delete failed", { brandId: b.id, message: msg });
      setOutcome({ deleted: false, name: b.name, message: msg });
    } finally {
      setBusy(null);
    }
  }

  async function merge() {
    if (!mergeSource || !mergeTarget) return;
    setBusy(mergeSource);
    setError(null);
    try {
      await apiFetch(`/api/brands/${mergeSource}/merge`, {
        method: "POST",
        json: { targetBrandId: mergeTarget },
      });
      log.info("brands merged", { from: mergeSource, to: mergeTarget });
      setMergeSource(null);
      setMergeTarget("");
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not merge";
      log.error("brand merge failed", { message: msg });
      setError(msg);
    } finally {
      setBusy(null);
    }
  }

  // permsLoading first, always. Rendering a denial before the grants arrive flashes
  // "access required" on every visit — the same symptom as the bug that removal fixed.
  if (permsLoading) return null;

  if (!canView("brands")) {
    return (
      <div className="text-center py-12">
        <p className="text-sm text-slate-400">You do not have permission to view brands</p>
      </div>
    );
  }

  const mayEdit = canEdit("brands");
  const mayMerge = canCreate("brands"); // merge is guarded on brands.create by the API
  const mayDelete = canDelete("brands");

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <Link href="/more" aria-label="Back" className="p-2 -ml-2 rounded-lg hover:bg-slate-100 focus-ring">
          <ArrowLeft className="h-5 w-5 text-slate-600" />
        </Link>
        <div className="flex-1">
          <h1 className="text-lg font-bold text-slate-900">Brands</h1>
          <p className="text-xs text-slate-500 tabular-nums">
            {brands.length} brand{brands.length === 1 ? "" : "s"} · lead time is days to deliver
          </p>
        </div>
        {canCreate("brands") && !creating && (
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
              placeholder="Brand name"
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
      ) : brands.length === 0 ? (
        <div className="text-center py-12">
          <Tag className="h-12 w-12 text-slate-300 mx-auto mb-3" />
          <p className="text-sm text-slate-500">No brands yet</p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {brands.map((b) => {
            const isEditing = editingId === b.id;
            const isMerging = mergeSource === b.id;

            return (
              <Card key={b.id}>
                <CardContent className="p-3">
                  {isEditing ? (
                    <div className="flex flex-col sm:flex-row gap-2">
                      <Input
                        value={draftName}
                        onChange={(e) => setDraftName(e.target.value)}
                        className="min-h-[40px] flex-1"
                        aria-label="Brand name"
                        autoFocus
                      />
                      <div className="flex items-center gap-1.5">
                        <Clock className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                        <Input
                          type="number"
                          min={1}
                          value={draftLead}
                          onChange={(e) => setDraftLead(e.target.value)}
                          className="min-h-[40px] w-20 tabular-nums"
                          aria-label="Lead time in days"
                        />
                        <span className="text-xs text-slate-500 shrink-0">days</span>
                      </div>
                      <div className="flex gap-1.5">
                        <Button size="sm" onClick={() => void saveEdit(b)} disabled={busy === b.id}>
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
                          <p className="text-sm font-semibold text-slate-900">{b.name}</p>
                          <Badge variant="info" className="text-[10px] tabular-nums">
                            {b._count.products} product{b._count.products === 1 ? "" : "s"}
                          </Badge>
                          <Badge variant="default" className="text-[10px] tabular-nums">
                            {b.leadDays}d lead
                          </Badge>
                          {b.cdPercentage != null && b.cdTermsDays != null && (
                            // Read-only: no calculation reads these. Shown so the data is not
                            // invisible — see the interface comment.
                            <Badge variant="warning" className="text-[10px] tabular-nums">
                              CD {b.cdPercentage}% / {b.cdTermsDays}d
                            </Badge>
                          )}
                        </div>
                        {(b.contactPhone || b.whatsappNumber) && (
                          <p className="text-[11px] text-slate-500 mt-0.5">
                            {[b.contactPhone, b.whatsappNumber].filter(Boolean).join(" · ")}
                          </p>
                        )}
                      </div>
                      <div className="flex gap-1 shrink-0">
                        {mayEdit && (
                          <IconBtn label={`Edit ${b.name}`} onClick={() => startEdit(b)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </IconBtn>
                        )}
                        {mayMerge && brands.length > 1 && (
                          <IconBtn label={`Merge ${b.name} into another brand`} onClick={() => setMergeSource(b.id)}>
                            <GitMerge className="h-3.5 w-3.5" />
                          </IconBtn>
                        )}
                        {mayDelete && (
                          <IconBtn label={`Delete ${b.name}`} danger disabled={busy === b.id} onClick={() => void remove(b)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </IconBtn>
                        )}
                      </div>
                    </div>
                  )}

                  {isMerging && (
                    <div className="mt-2 pt-2 border-t border-slate-200">
                      <p className="text-[11px] text-slate-600 mb-1.5">
                        Move every product from <strong>{b.name}</strong> into another brand, then delete{" "}
                        <strong>{b.name}</strong>. This cannot be undone.
                      </p>
                      <div className="flex gap-2">
                        <select
                          value={mergeTarget}
                          onChange={(e) => setMergeTarget(e.target.value)}
                          className="flex-1 min-h-[40px] rounded-lg border border-slate-300 bg-white px-2 text-sm focus-ring"
                        >
                          <option value="">Merge into…</option>
                          {brands.filter((t) => t.id !== b.id).map((t) => (
                            <option key={t.id} value={t.id}>{t.name}</option>
                          ))}
                        </select>
                        <Button size="sm" onClick={() => void merge()} disabled={!mergeTarget || busy === b.id}>
                          {busy === b.id ? "Merging…" : "Merge"}
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
