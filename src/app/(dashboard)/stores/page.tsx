"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Building2, Warehouse, Plus, Pencil, Trash2, ChevronDown, ChevronRight, X, Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SkeletonList } from "@/components/ui/skeleton";
import { ErrorBanner } from "@/components/ui/error-banner";
import { ActionConfirmation } from "@/components/ui/action-confirmation";
import { usePermissions } from "@/lib/use-permissions";
import { apiFetch, apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";

const log = createLogger("stores");

interface WarehouseRow {
  id: string;
  code: string;
  name: string;
  sortOrder: number;
}

interface StoreRow {
  id: string;
  code: string;
  name: string;
  address: string | null;
  phone: string | null;
  sortOrder: number;
  warehouses: WarehouseRow[];
}

/** Both DELETE endpoints answer with this. `deleted: false` is a refusal, not a failure. */
interface DeleteOutcome {
  deleted: boolean;
  name: string;
  message: string;
}

type Draft =
  | { kind: "store"; id: string | null; code: string; name: string; address: string; phone: string }
  | { kind: "warehouse"; id: string | null; storeId: string; code: string; name: string };

export default function StoresPage() {
  const { canCreate, canEdit, canDelete } = usePermissions();

  const [stores, setStores] = useState<StoreRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<DeleteOutcome | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await apiTry<StoreRow[]>("/api/stores");
    if (err) {
      log.error("could not load stores", { message: err });
      setError(err);
      setStores([]);
    } else {
      setStores(data ?? []);
      // Open every store on first load — with two sites, collapsing by default hides the
      // whole point of the screen.
      setExpanded(new Set((data ?? []).map((s) => s.id)));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function save() {
    if (!draft) return;
    setBusy(true);
    setError(null);
    try {
      if (draft.kind === "store") {
        const body = {
          code: draft.code, name: draft.name,
          address: draft.address || undefined, phone: draft.phone || undefined,
        };
        if (draft.id) await apiFetch(`/api/stores/${draft.id}`, { method: "PUT", json: body });
        else await apiFetch("/api/stores", { method: "POST", json: body });
      } else {
        const body = { storeId: draft.storeId, code: draft.code, name: draft.name };
        if (draft.id) await apiFetch(`/api/warehouses/${draft.id}`, { method: "PUT", json: body });
        else await apiFetch("/api/warehouses", { method: "POST", json: body });
      }
      log.info("site saved", { kind: draft.kind, editing: Boolean(draft.id) });
      setDraft(null);
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not save";
      log.error("site save failed", { kind: draft.kind, message: msg });
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  async function remove(kind: "store" | "warehouse", id: string, name: string) {
    if (!confirm(`Delete ${name}? If anything still references it you will be told instead.`)) return;
    setBusy(true);
    try {
      // A refusal comes back as 200 with deleted:false and a reason. Rendering it as a
      // failure would be wrong — nothing broke, the request was declined for a stated cause.
      const res = await apiFetch<DeleteOutcome>(`/api/${kind}s/${id}`, { method: "DELETE" });
      log.info("delete handled", { kind, id, deleted: res.deleted });
      setOutcome(res);
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not delete";
      log.error("delete failed", { kind, id, message: msg });
      setOutcome({ deleted: false, name, message: msg });
    } finally {
      setBusy(false);
    }
  }

  const inputCls = "min-h-[40px]";

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-lg font-bold text-slate-900">Stores</h1>
          <p className="text-xs text-slate-500 tabular-nums">
            {stores.length} store{stores.length === 1 ? "" : "s"} ·{" "}
            {stores.reduce((n, s) => n + s.warehouses.length, 0)} warehouse
            {stores.reduce((n, s) => n + s.warehouses.length, 0) === 1 ? "" : "s"}
          </p>
        </div>
        {canCreate("stores") && (
          <Button
            size="sm"
            className="bg-blue-600 hover:bg-blue-700"
            onClick={() => setDraft({ kind: "store", id: null, code: "", name: "", address: "", phone: "" })}
          >
            <Plus className="h-3.5 w-3.5 mr-1" />New store
          </Button>
        )}
      </div>

      {error && <ErrorBanner message={error} onRetry={() => void load()} />}

      {draft && (
        <Card className="mb-3 border-blue-200">
          <CardContent className="p-3 space-y-2">
            <p className="text-xs font-semibold text-slate-700">
              {draft.id ? "Edit" : "New"} {draft.kind}
              {draft.kind === "warehouse" && (
                <span className="font-normal text-slate-500">
                  {" "}under {stores.find((s) => s.id === draft.storeId)?.name}
                </span>
              )}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <Input
                placeholder="Code (e.g. BCH_STORE)"
                value={draft.code}
                onChange={(e) => setDraft({ ...draft, code: e.target.value.toUpperCase() })}
                className={`${inputCls} font-mono uppercase`}
                autoFocus
              />
              <Input
                placeholder="Name (e.g. BCH Store)"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                className={inputCls}
              />
              {draft.kind === "store" && (
                <>
                  <Input
                    placeholder="Address (optional)"
                    value={draft.address}
                    onChange={(e) => setDraft({ ...draft, address: e.target.value })}
                    className={inputCls}
                  />
                  <Input
                    placeholder="Phone (optional)"
                    value={draft.phone}
                    onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
                    className={inputCls}
                  />
                </>
              )}
            </div>
            <p className="text-[11px] text-slate-500">
              The code is a stable handle used in URLs like{" "}
              <code className="font-mono">/stock/by-location/{draft.code || "CODE"}</code>. The name
              can be changed freely.
            </p>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => void save()} disabled={busy || !draft.code || !draft.name}>
                <Check className="h-3.5 w-3.5 mr-1" />{busy ? "Saving…" : "Save"}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setDraft(null)} disabled={busy}>
                <X className="h-3.5 w-3.5 mr-1" />Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <SkeletonList count={2} type="card" />
      ) : stores.length === 0 ? (
        <div className="text-center py-12">
          <Building2 className="h-12 w-12 text-slate-300 mx-auto mb-3" />
          <p className="text-sm text-slate-500">No stores yet</p>
        </div>
      ) : (
        <div className="space-y-2">
          {stores.map((s) => {
            const open = expanded.has(s.id);
            return (
              <Card key={s.id}>
                <CardContent className="p-3">
                  <div className="flex items-start gap-2">
                    <button
                      type="button"
                      onClick={() => toggle(s.id)}
                      aria-label={open ? `Collapse ${s.name}` : `Expand ${s.name}`}
                      className="p-1 -ml-1 rounded hover:bg-slate-100 focus-ring shrink-0"
                    >
                      {open ? <ChevronDown className="h-4 w-4 text-slate-500" /> : <ChevronRight className="h-4 w-4 text-slate-500" />}
                    </button>
                    <Building2 className="h-4 w-4 text-slate-400 shrink-0 mt-1" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-slate-900">{s.name}</p>
                        <Badge variant="default" className="font-mono text-[10px]">{s.code}</Badge>
                        <Badge variant="info" className="text-[10px] tabular-nums">
                          {s.warehouses.length} warehouse{s.warehouses.length === 1 ? "" : "s"}
                        </Badge>
                      </div>
                      {(s.address || s.phone) && (
                        <p className="text-[11px] text-slate-500 mt-0.5">
                          {[s.address, s.phone].filter(Boolean).join(" · ")}
                        </p>
                      )}
                    </div>
                    <div className="flex gap-1 shrink-0">
                      {canEdit("stores") && (
                        <IconBtn
                          label={`Edit ${s.name}`}
                          onClick={() => setDraft({
                            kind: "store", id: s.id, code: s.code, name: s.name,
                            address: s.address ?? "", phone: s.phone ?? "",
                          })}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </IconBtn>
                      )}
                      {canDelete("stores") && (
                        <IconBtn label={`Delete ${s.name}`} danger disabled={busy} onClick={() => void remove("store", s.id, s.name)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </IconBtn>
                      )}
                    </div>
                  </div>

                  {open && (
                    <div className="mt-2 ml-7 pl-3 border-l border-slate-200 space-y-1.5">
                      {s.warehouses.length === 0 && (
                        <p className="text-[11px] text-slate-500 py-1">
                          No warehouses. Stock cannot be held at this site until one exists.
                        </p>
                      )}
                      {s.warehouses.map((w) => (
                        <div key={w.id} className="flex items-center gap-2">
                          <Warehouse className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                          <span className="text-sm text-slate-800">{w.name}</span>
                          <Badge variant="default" className="font-mono text-[10px]">{w.code}</Badge>
                          <div className="flex gap-1 ml-auto">
                            {canEdit("warehouses") && (
                              <IconBtn
                                label={`Edit ${w.name}`}
                                onClick={() => setDraft({ kind: "warehouse", id: w.id, storeId: s.id, code: w.code, name: w.name })}
                              >
                                <Pencil className="h-3 w-3" />
                              </IconBtn>
                            )}
                            {canDelete("warehouses") && (
                              <IconBtn label={`Delete ${w.name}`} danger disabled={busy} onClick={() => void remove("warehouse", w.id, w.name)}>
                                <Trash2 className="h-3 w-3" />
                              </IconBtn>
                            )}
                          </div>
                        </div>
                      ))}
                      {canCreate("warehouses") && (
                        <button
                          type="button"
                          onClick={() => setDraft({ kind: "warehouse", id: null, storeId: s.id, code: "", name: "" })}
                          className="inline-flex items-center gap-1 text-[11px] text-blue-600 hover:text-blue-700 focus-ring rounded px-1 py-1"
                        >
                          <Plus className="h-3 w-3" />Add warehouse
                        </button>
                      )}
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
      className={`min-h-[32px] min-w-[32px] inline-flex items-center justify-center rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-40 focus-ring ${
        danger ? "text-red-600" : "text-slate-600"
      }`}
    >
      {children}
    </button>
  );
}
