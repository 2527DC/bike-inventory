"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { ArrowLeft, Loader2, Package } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ActionConfirmation } from "@/components/ui/action-confirmation";
import { useBinTracking } from "@/hooks/use-bin-tracking";
import { useStores } from "@/hooks/use-sites";
import { apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";

const log = createLogger("stock-audit:new");

// GET /api/bins returns each bin's warehouse, which is what lets the bin step show only the
// bins inside the warehouse that was picked. `location` is the legacy free-text column — it is
// nullable and nothing here reads it any more (plan 1509-stock-count-scope-by-warehouse, A4).
interface Bin {
  id: string;
  code: string;
  name: string;
  location: string | null;
  warehouse: { id: string; name: string; kind: "FLOOR" | "GODOWN" };
  _count: { products: number };
}

interface User {
  id: string;
  name: string;
  // GET /api/users selects role as a RELATION — { id, key, name } — not a string. Rendering
  // it directly threw "Objects are not valid as a React child" and tripped the error
  // boundary the moment the user list resolved, which is why the page painted and then died.
  role: { id: string; key: string; name: string } | null;
}

export default function NewStockAuditPage() {
  const { isBinTrackingEnabled: BIN_TRACKING_ENABLED } = useBinTracking();
  const { stores, loading: storesLoading } = useStores();
  const router = useRouter();
  const { data: session } = useSession();
  const user = session?.user as { userId?: string; role?: string } | undefined;

  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");
  // Scope (plan 1509, D1): a store, then exactly ONE of its warehouses — the Floor or a
  // Godown. There is no whole-store count any more, in either bin mode. The bin is optional:
  // "" means the whole warehouse (Q2).
  const [storeId, setStoreId] = useState<string>("");
  const [warehouseId, setWarehouseId] = useState<string>("");
  const [selectedBin, setSelectedBin] = useState("");
  const [bins, setBins] = useState<Bin[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [assignedTo, setAssignedTo] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [confirmation, setConfirmation] = useState<{
    type: "success" | "warning" | "error" | "info";
    title: string;
    referenceId: string;
    description?: string;
    items?: Array<{ label: string; value: string }>;
    details?: string;
    redirectTo?: string;
  } | null>(null);

  useEffect(() => {
    if (BIN_TRACKING_ENABLED) {
      (async () => {
        const { data, error: err } = await apiTry<Bin[]>("/api/bins");
        // A person without the `bins` view grant lands here too. The bin step then offers
        // only "Whole warehouse", which is still a valid count.
        if (err) log.warn("bins load failed", { message: err });
        else setBins(data ?? []);
      })();
    }
    // Load team members for assignment
    fetch("/api/users").then((r) => r.json()).then((res) => { if (res.success) setUsers(res.data); }).catch(() => {});
  }, [BIN_TRACKING_ENABLED]);

  const selectedStore = stores.find((s) => s.id === storeId) ?? null;
  const selectedWarehouse = selectedStore?.warehouses.find((w) => w.id === warehouseId) ?? null;
  const warehouseBins = useMemo(
    () => bins.filter((b) => b.warehouse?.id === warehouseId),
    [bins, warehouseId]
  );
  const pickedBin = warehouseBins.find((b) => b.id === selectedBin) ?? null;

  // Name the audit after what it actually covers — the same rule in both bin modes. Set where
  // the choice is made, not in an effect: an effect that sets state renders twice
  // (react-hooks/set-state-in-effect).
  const autoTitle = (warehouseName: string, binCode?: string) =>
    binCode ? `Stock Count - ${warehouseName} · Bin ${binCode}` : `Stock Count - ${warehouseName}`;

  const selectStore = (id: string) => {
    setStoreId(id);
    // A warehouse or bin picked under another store must not survive the switch — the server
    // refuses the pair, and the person would not know why.
    setWarehouseId("");
    setSelectedBin("");
  };

  const selectWarehouse = (id: string) => {
    setWarehouseId(id);
    setSelectedBin("");
    const w = selectedStore?.warehouses.find((x) => x.id === id);
    if (w) setTitle(autoTitle(w.name));
  };

  /** `null` = the whole warehouse. */
  const selectBin = (bin: Bin | null) => {
    setSelectedBin(bin?.id ?? "");
    if (selectedWarehouse) setTitle(autoTitle(selectedWarehouse.name, bin?.code));
  };

  const handleSubmit = async () => {
    if (!storeId) { setError("Choose a store"); return; }
    if (!warehouseId) { setError("Choose a warehouse"); return; }
    if (!title || !dueDate) return;
    setSubmitting(true);
    setError("");

    const body: Record<string, unknown> = {
      title,
      dueDate,
      notes: notes || undefined,
      assignedToId: assignedTo || user?.userId,
      storeId,
      warehouseId,
    };
    if (pickedBin) body.binId = pickedBin.id;

    const { data, error: err, status } = await apiTry<{ id: string; countNo?: string }>(
      "/api/stock-counts",
      { method: "POST", json: body }
    );
    setSubmitting(false);

    if (err || !data) {
      log.error("stock count create failed", {
        status,
        storeId,
        warehouseId,
        binId: pickedBin?.id ?? null,
      });
      setError(err || "Failed to create stock count");
      return;
    }

    const assignedUser = users.find((u) => u.id === (assignedTo || user?.userId));
    const scopeText = `${selectedWarehouse?.name ?? "—"} · ${selectedStore?.name ?? "—"}${pickedBin ? ` · Bin ${pickedBin.code}` : ""}`;
    setConfirmation({
      type: "success",
      title: "Stock Count Created",
      referenceId: data.countNo || data.id,
      items: [
        { label: "Title", value: title },
        { label: "Assigned To", value: assignedUser?.name || "—" },
        { label: "Due Date", value: new Date(dueDate).toLocaleDateString("en-IN") },
        { label: "Scope", value: scopeText },
      ],
      redirectTo: `/stock-audit/${data.id}`,
    });
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <Link href="/stock-audit" className="p-2 -ml-2 rounded-lg hover:bg-slate-100 focus-ring" aria-label="Back">
          <ArrowLeft className="h-5 w-5 text-slate-600" />
        </Link>
        <h1 className="text-lg font-bold text-slate-900 truncate">New Stock Count</h1>
      </div>

      <div className="space-y-3">
        {/* SCOPE — store, then ONE warehouse inside it, then (bins on) an optional bin.
            The same steps whatever bin mode says: the old bin-mode toggle sent no store at
            all, which is the "storeId … received undefined" error plan 1509 fixes. */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">Store *</label>
          {storesLoading && stores.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-4 text-xs text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading stores…
            </div>
          ) : stores.length === 0 ? (
            <p className="text-xs text-slate-400 text-center py-4">No stores available</p>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {stores.map((s) => (
                <button
                  key={s.id}
                  onClick={() => selectStore(s.id)}
                  className={`min-h-[44px] rounded-lg text-sm font-medium transition-colors focus-ring ${
                    storeId === s.id ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"
                  }`}
                >
                  {s.name}
                </button>
              ))}
            </div>
          )}
        </div>

        {selectedStore && (
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Warehouse *</label>
            {/* Each warehouse carries its kind, so nobody has to know which building is the
                shop (Floor) and which is storage (Godown). */}
            <div className="grid grid-cols-2 gap-2">
              {selectedStore.warehouses.map((w) => {
                const isSelected = warehouseId === w.id;
                return (
                  <button
                    key={w.id}
                    onClick={() => selectWarehouse(w.id)}
                    className={`min-h-[44px] rounded-lg px-2 py-1.5 text-sm font-medium transition-colors focus-ring flex flex-col items-center justify-center gap-0.5 ${
                      isSelected ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    <span className="leading-tight text-center">{w.name}</span>
                    <span
                      className={`text-[10px] font-normal px-1.5 rounded-full ${
                        isSelected
                          ? "bg-white/20 text-white"
                          : w.kind === "FLOOR"
                          ? "bg-blue-50 text-blue-700"
                          : "bg-amber-50 text-amber-700"
                      }`}
                    >
                      {w.kind === "FLOOR" ? "Floor" : "Godown"}
                    </span>
                  </button>
                );
              })}
            </div>
            {selectedStore.warehouses.length === 0 && (
              <p className="text-[11px] text-slate-500 mt-2">
                {selectedStore.name} has no active warehouse — add one before counting here.
              </p>
            )}
          </div>
        )}

        {/* Bin — only the bins inside the picked warehouse, never a flat list of the whole
            business. Optional: "Whole warehouse" is the default (Q2). */}
        {BIN_TRACKING_ENABLED && selectedWarehouse && (
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Bin</label>
            <div className="space-y-1.5 max-h-[50vh] overflow-y-auto">
              <button
                onClick={() => selectBin(null)}
                className={`w-full min-h-[44px] text-left px-3 py-2.5 rounded-lg border transition-all ${
                  selectedBin === ""
                    ? "border-slate-900 bg-slate-50 ring-1 ring-slate-900"
                    : "border-slate-200 bg-white"
                }`}
              >
                <span className="text-sm font-medium text-slate-900">Whole warehouse</span>
                <span className="text-sm text-slate-500"> — {selectedWarehouse.name}</span>
              </button>
              {warehouseBins.map((b) => {
                const isSelected = selectedBin === b.id;
                return (
                  <button key={b.id} onClick={() => selectBin(b)}
                    className={`w-full min-h-[44px] text-left px-3 py-2.5 rounded-lg border transition-all ${
                      isSelected
                        ? "border-slate-900 bg-slate-50 ring-1 ring-slate-900"
                        : "border-slate-200 bg-white"
                    }`}>
                    <div className="flex items-center justify-between">
                      <div className="min-w-0">
                        <span className="text-sm font-medium text-slate-900">{b.code}</span>
                        <span className="text-sm text-slate-500"> — {b.name}</span>
                      </div>
                      <span className={`shrink-0 ml-2 text-xs px-2 py-0.5 rounded-full ${
                        b._count.products > 0 ? "bg-blue-50 text-blue-600" : "bg-slate-100 text-slate-400"
                      }`}>
                        {b._count.products} items
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
            {warehouseBins.length === 0 && (
              <p className="text-[11px] text-slate-500 mt-2">No bins in this warehouse.</p>
            )}
          </div>
        )}

        {/* Baseline mode notice — a bin count lists every active product when the bin holds
            nothing yet, and what is counted is assigned to the bin. */}
        {pickedBin && (
          <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg">
            <Package className="h-4 w-4 text-amber-600 shrink-0" />
            <p className="text-xs text-amber-700">
              <span className="font-medium">Baseline Mode:</span> All active products will be listed. Count what you physically find — items counted with {'>'} 0 will be assigned to bin {pickedBin.code}.
            </p>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Title *</label>
          <Input placeholder="e.g. Stock Count - Assembly Bin" value={title} onChange={(e) => setTitle(e.target.value)} className="min-h-[44px]" />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Due Date *</label>
          <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="min-h-[44px]" />
        </div>

        {/* Assign To — ADMIN must assign to someone else (cannot count themselves) */}
        {users.length > 0 && (
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Assign To *</label>
            <select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}
              className="w-full min-h-[44px] rounded-lg border border-slate-300 px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent">
              <option value="">Select a team member...</option>
              {users.filter((u) => u.id !== (user as { userId?: string })?.userId).map((u) => (
                <option key={u.id} value={u.id}>{u.name} ({u.role?.name ?? "No role"})</option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
          <textarea
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent min-h-[80px]"
            placeholder="Any instructions for the person counting..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        {(() => {
          const missing: string[] = [];
          if (!storeId) missing.push("store");
          if (!warehouseId) missing.push("warehouse");
          if (!title) missing.push("title");
          if (!dueDate) missing.push("due date");
          if (!assignedTo) missing.push("assignee");
          const disabled = missing.length > 0 || submitting;
          return (
            <>
              <button onClick={handleSubmit}
                disabled={disabled}
                className="w-full min-h-[48px] bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed">
                {submitting ? "Creating..." : "Create Stock Count"}
              </button>
              {missing.length > 0 && !submitting && (
                <p className="text-xs text-slate-500 text-center">Add {missing.join(", ")} to enable.</p>
              )}
            </>
          );
        })()}
      </div>

      <ActionConfirmation
        open={!!confirmation}
        onClose={() => {
          const redirectTo = confirmation?.redirectTo;
          setConfirmation(null);
          if (redirectTo) router.push(redirectTo);
        }}
        type={confirmation?.type || "success"}
        title={confirmation?.title || ""}
        referenceId={confirmation?.referenceId || ""}
        items={confirmation?.items}
        details={confirmation?.details}
      />
    </div>
  );
}
