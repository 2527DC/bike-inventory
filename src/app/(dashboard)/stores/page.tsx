"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Building2, Warehouse, Plus, Pencil, Trash2, X, Check, Boxes,
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
import type { WarehouseKind } from "@/hooks/use-sites";
import { BinsManager } from "@/components/bins/bins-manager";

const log = createLogger("stores");

/** What each kind is called on screen. FLOOR is the shop, GODOWN is storage (D2). */
const KIND_LABEL: Record<WarehouseKind, string> = { FLOOR: "Floor", GODOWN: "Godown" };

interface WarehouseRow {
  id: string;
  code: string;
  name: string;
  kind: WarehouseKind;
  sortOrder: number;
  /** FLOOR-only: invoices whose number starts with this reduce this floor (plan 1609, R30). */
  invoicePrefix: string | null;
  /** FLOOR-only: the store's primary floor when it has two or more (R33). */
  isPrimary: boolean;
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

// `kind` here is the union tag of the draft ("store" | "warehouse") and predates the column
// of the same name on Warehouse. The column is carried as `warehouseKind` in this state so
// the two never collide; the API field is still `kind`.
type Draft =
  | { kind: "store"; id: string | null; code: string; name: string; address: string; phone: string }
  | {
      kind: "warehouse"; id: string | null; storeId: string; code: string; name: string; warehouseKind: WarehouseKind;
      // FLOOR-only. Kept in the draft while the kind is toggled so flipping Godown → Floor does
      // not lose what was typed; never sent for a godown.
      invoicePrefix: string; isPrimary: boolean;
    };

/**
 * Why Save is disabled, or null. The server enforces the same rule (R32); saying it here means
 * the button explains itself instead of failing on click.
 */
function blockedReason(draft: Draft): string | null {
  if (!draft.code || !draft.name) return "Code and name are required.";
  if (draft.kind === "warehouse" && draft.warehouseKind === "FLOOR" && !draft.invoicePrefix.trim()) {
    return "A floor warehouse needs an invoice prefix.";
  }
  return null;
}

// ─── Store management (plan 1709-priority-build-and-stock-flow, R32) ─────────
// Admin › Settings › Store management is ONE screen with three tabs, each in the URL so a tab
// survives a refresh and can be linked: /stores?tab=stores | warehouses | bins. Each tab is shown
// by its own module's view grant (the module keys were kept — Q24); a tab the viewer may not see
// falls back to the first one they can. Cosmetic like every frontend check: the APIs re-check.

type TabKey = "stores" | "warehouses" | "bins";

const TABS: { key: TabKey; label: string; module: string; icon: typeof Building2 }[] = [
  { key: "stores", label: "Stores", module: "stores", icon: Building2 },
  { key: "warehouses", label: "Warehouses", module: "warehouses", icon: Warehouse },
  { key: "bins", label: "Bins", module: "bins", icon: Boxes },
];

/**
 * `useSearchParams` in a Client Component must sit under a Suspense boundary, or the production
 * build fails prerendering the page — the purchase-orders/page.tsx wrapper, copied.
 */
export default function StoresPage() {
  return (
    <Suspense fallback={<SkeletonList count={3} type="card" />}>
      <StoreManagementScreen />
    </Suspense>
  );
}

function StoreManagementScreen() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { canView, loading: permsLoading } = usePermissions();

  const allowed = TABS.filter((t) => canView(t.module));
  const requested = searchParams.get("tab");
  const tab: TabKey | null =
    allowed.find((t) => t.key === requested)?.key ?? allowed[0]?.key ?? null;

  // replace, not push: switching tabs is not a navigation the Back button should replay.
  const selectTab = (next: TabKey) => router.replace(`/stores?tab=${next}`, { scroll: false });

  return (
    <div>
      <div className="mb-3">
        <h1 className="text-lg font-bold text-slate-900">Store management</h1>
        <p className="text-xs text-slate-500">Stores, their warehouses, and the bins inside them</p>
      </div>

      {allowed.length > 1 && (
        <div className="-mx-1 overflow-x-auto px-1 mb-3">
          <div role="tablist" aria-label="Store management" className="flex min-w-max gap-1 rounded-xl bg-slate-100 p-1">
            {allowed.map((t) => {
              const Icon = t.icon;
              const selected = tab === t.key;
              return (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => selectTab(t.key)}
                  className={`flex min-h-[44px] items-center gap-1.5 whitespace-nowrap rounded-lg px-4 text-xs font-semibold transition-all focus-ring ${
                    selected ? "bg-white text-blue-700 shadow-xs" : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span>{t.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* While the grants load, which tab is allowed is unknown — rendering one first would fire
          its request and then swap for a person who holds only another tab's grant. */}
      {permsLoading ? (
        <SkeletonList count={3} type="card" />
      ) : tab === null ? (
        <div className="text-center py-12">
          <Building2 className="h-12 w-12 text-slate-300 mx-auto mb-3" />
          <p className="text-sm text-slate-500">
            Your role cannot view stores, warehouses or bins. Ask an admin for access.
          </p>
        </div>
      ) : tab === "bins" ? (
        <BinsManager />
      ) : (
        // keyed so switching Stores ↔ Warehouses starts from a clean form, not a half-typed draft
        <SitesPanel key={tab} view={tab} />
      )}
    </div>
  );
}

/**
 * The Stores and Warehouses tabs. One component because they share the draft form, the save and
 * delete handlers and the same GET /api/stores (stores with warehouses nested) — what was one
 * screen before the tabs. `view` decides which half of the hierarchy is listed.
 */
function SitesPanel({ view }: { view: "stores" | "warehouses" }) {
  const { canCreate, canEdit, canDelete } = usePermissions();

  const [stores, setStores] = useState<StoreRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  // A save failure belongs beside the form it came from, not in the page banner whose Retry
  // reloads the list.
  const [saveError, setSaveError] = useState<string | null>(null);
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
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    if (!draft) return;
    setBusy(true);
    setSaveError(null);
    try {
      if (draft.kind === "store") {
        const body = {
          code: draft.code, name: draft.name,
          address: draft.address || undefined, phone: draft.phone || undefined,
        };
        if (draft.id) await apiFetch(`/api/stores/${draft.id}`, { method: "PUT", json: body });
        else await apiFetch("/api/stores", { method: "POST", json: body });
      } else {
        const isFloor = draft.warehouseKind === "FLOOR";
        const body = {
          storeId: draft.storeId, code: draft.code, name: draft.name, kind: draft.warehouseKind,
          // Only a floor carries these; the server clears both on a godown regardless.
          ...(isFloor ? { invoicePrefix: draft.invoicePrefix.trim(), isPrimary: draft.isPrimary } : {}),
        };
        if (draft.id) await apiFetch(`/api/warehouses/${draft.id}`, { method: "PUT", json: body });
        else await apiFetch("/api/warehouses", { method: "POST", json: body });
      }
      log.info("site saved", { kind: draft.kind, editing: Boolean(draft.id) });
      setDraft(null);
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not save";
      log.error("site save failed", { kind: draft.kind, id: draft.id, message: msg });
      setSaveError(msg);
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
  const warehouseCount = stores.reduce((n, s) => n + s.warehouses.length, 0);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-base font-bold text-slate-900">{view === "stores" ? "Stores" : "Warehouses"}</h2>
          <p className="text-xs text-slate-500 tabular-nums">
            {stores.length} store{stores.length === 1 ? "" : "s"} ·{" "}
            {warehouseCount} warehouse{warehouseCount === 1 ? "" : "s"}
          </p>
        </div>
        {view === "stores" && canCreate("stores") && (
          <Button
            size="sm"
            className="bg-blue-600 hover:bg-blue-700"
            onClick={() => { setSaveError(null); setDraft({ kind: "store", id: null, code: "", name: "", address: "", phone: "" }); }}
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
              {draft.kind === "warehouse" && (
                // Floor = the shop, where a customer sees the bike; Godown = storage. A delivery
                // reduces only the floor its invoice prefix matches (plan 1609, A40) and inbound
                // lands in a godown by default, so the choice is behavioural, not a label.
                <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Kind of location">
                  {(["FLOOR", "GODOWN"] as WarehouseKind[]).map((k) => (
                    <button
                      key={k}
                      type="button"
                      role="radio"
                      aria-checked={draft.warehouseKind === k}
                      onClick={() => setDraft({ ...draft, warehouseKind: k })}
                      className={`${inputCls} rounded-lg text-sm font-semibold border transition-colors focus-ring ${
                        draft.warehouseKind === k
                          ? "bg-blue-600 text-white border-blue-600"
                          : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                      }`}
                    >
                      {KIND_LABEL[k]}
                    </button>
                  ))}
                </div>
              )}
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
            {draft.kind === "warehouse" && draft.warehouseKind === "FLOOR" && (
              // Shown only for a floor: a godown sells nothing, so it has no prefix and cannot be
              // the store's primary floor (plan 1609, R30–R33).
              <div className="space-y-2">
                <div>
                  <label htmlFor="wh-invoice-prefix" className="block text-[11px] font-semibold text-slate-700 mb-1">
                    Invoice prefix <span className="text-red-600">*</span>
                  </label>
                  <Input
                    id="wh-invoice-prefix"
                    placeholder="e.g. INV/"
                    value={draft.invoicePrefix}
                    onChange={(e) => setDraft({ ...draft, invoicePrefix: e.target.value })}
                    className={`${inputCls} font-mono`}
                    maxLength={20}
                    aria-describedby="wh-invoice-prefix-help"
                  />
                  <p id="wh-invoice-prefix-help" className="text-[11px] text-slate-500 mt-1">
                    Invoices whose number starts with this reduce this floor&rsquo;s stock
                  </p>
                </div>
                <label className="flex items-center gap-2 min-h-[40px] text-sm text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={draft.isPrimary}
                    onChange={(e) => setDraft({ ...draft, isPrimary: e.target.checked })}
                    className="h-4 w-4 rounded border-slate-300 accent-blue-600 focus-ring"
                  />
                  Primary floor for this store
                </label>
              </div>
            )}
            <p className="text-[11px] text-slate-500">
              The code is a stable handle used in URLs like{" "}
              <code className="font-mono">/stock/by-location/{draft.code || "CODE"}</code>. The name
              can be changed freely.
            </p>
            {saveError && (
              <p role="alert" className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-2 py-1.5">
                {saveError}
              </p>
            )}
            {/* The empty-form case says nothing, as before; the reason is shown once there is
                something to explain — a typed code or name, or a floor with no prefix. */}
            {blockedReason(draft) && (draft.code || draft.name || (draft.kind === "warehouse" && draft.warehouseKind === "FLOOR")) && (
              <p className="text-[11px] text-amber-700">{blockedReason(draft)}</p>
            )}
            <div className="flex gap-2">
              <Button size="sm" onClick={() => void save()} disabled={busy || blockedReason(draft) !== null}>
                <Check className="h-3.5 w-3.5 mr-1" />{busy ? "Saving…" : "Save"}
              </Button>
              <Button size="sm" variant="outline" onClick={() => { setDraft(null); setSaveError(null); }} disabled={busy}>
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
        view === "stores" ? (
        <div className="space-y-2">
          {stores.map((s) => (
              <Card key={s.id}>
                <CardContent className="p-3">
                  <div className="flex items-start gap-2">
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
                          onClick={() => {
                            setSaveError(null);
                            setDraft({
                              kind: "store", id: s.id, code: s.code, name: s.name,
                              address: s.address ?? "", phone: s.phone ?? "",
                            });
                          }}
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

                </CardContent>
              </Card>
          ))}
        </div>
        ) : (
        // Warehouses tab: the list that used to sit nested under each store, lifted out and
        // grouped by store so a warehouse is never shown without the site it belongs to.
        <div className="space-y-2">
          {stores.map((s) => (
              <Card key={s.id}>
                <CardContent className="p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <Building2 className="h-4 w-4 text-slate-400 shrink-0" />
                    <p className="text-sm font-semibold text-slate-900">{s.name}</p>
                    <Badge variant="default" className="font-mono text-[10px]">{s.code}</Badge>
                  </div>
                    <div className="ml-2 pl-3 border-l border-slate-200 space-y-1.5">
                      {s.warehouses.length === 0 && (
                        <p className="text-[11px] text-slate-500 py-1">
                          No warehouses. Stock cannot be held at this site until one exists.
                        </p>
                      )}
                      {s.warehouses.map((w) => (
                        <div key={w.id} className="flex items-start gap-2">
                          <Warehouse className="h-3.5 w-3.5 text-slate-400 shrink-0 mt-1" />
                          {/* Wraps on a 375px screen: a name and up to four badges do not fit one line. */}
                          <div className="flex items-center gap-1.5 flex-wrap flex-1 min-w-0">
                            <span className="text-sm text-slate-800">{w.name}</span>
                            <Badge variant={w.kind === "FLOOR" ? "info" : "default"} className="text-[10px]">
                              {KIND_LABEL[w.kind]}
                            </Badge>
                            <Badge variant="default" className="font-mono text-[10px]">{w.code}</Badge>
                            {/* A floor without a prefix matches no invoice, so its sales import as
                                Dummy deliveries (plan 1609, A41b). Say so on the row, not only in
                                the edit form nobody has opened. */}
                            {w.kind === "FLOOR" && (w.invoicePrefix ? (
                              <Badge variant="default" className="font-mono text-[10px]" title="Invoice prefix">
                                {w.invoicePrefix}
                              </Badge>
                            ) : (
                              <Badge variant="warning" className="text-[10px]">No invoice prefix</Badge>
                            ))}
                            {w.kind === "FLOOR" && w.isPrimary && (
                              <Badge variant="success" className="text-[10px]">Primary</Badge>
                            )}
                          </div>
                          <div className="flex gap-1 shrink-0">
                            {canEdit("warehouses") && (
                              <IconBtn
                                label={`Edit ${w.name}`}
                                onClick={() => {
                                  setSaveError(null);
                                  setDraft({
                                    kind: "warehouse", id: w.id, storeId: s.id, code: w.code, name: w.name,
                                    warehouseKind: w.kind, invoicePrefix: w.invoicePrefix ?? "", isPrimary: w.isPrimary,
                                  });
                                }}
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
                          onClick={() => {
                            setSaveError(null);
                            setDraft({
                              kind: "warehouse", id: null, storeId: s.id, code: "", name: "",
                              warehouseKind: "GODOWN", invoicePrefix: "", isPrimary: false,
                            });
                          }}
                          className="inline-flex items-center gap-1 text-[11px] text-blue-600 hover:text-blue-700 focus-ring rounded px-1 py-1"
                        >
                          <Plus className="h-3 w-3" />Add warehouse
                        </button>
                      )}
                    </div>
                </CardContent>
              </Card>
          ))}
        </div>
        )
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
