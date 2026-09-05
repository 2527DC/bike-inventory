"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { ArrowLeft, MapPin, Package } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ActionConfirmation } from "@/components/ui/action-confirmation";
import { BIN_TRACKING_ENABLED } from "@/lib/inventory-config";
import { useStores } from "@/hooks/use-sites";

interface Bin {
  id: string;
  code: string;
  name: string;
  location: string;
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
  const { stores } = useStores();
  const router = useRouter();
  const { data: session } = useSession();
  const user = session?.user as { userId?: string; role?: string } | undefined;

  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");
  const [scope, setScope] = useState<"bin" | "location" | "all">(BIN_TRACKING_ENABLED ? "bin" : "all");
  // Scope (R2). storeId is required; warehouseId empty means the whole store, which is
  // verify-only — see the caption in the picker and section 5.1 of the 0409 plan.
  const [storeId, setStoreId] = useState<string>("");
  const [warehouseId, setWarehouseId] = useState<string>("");
  const [selectedBin, setSelectedBin] = useState("");
  const [selectedLocation, setSelectedLocation] = useState("");
  const [bins, setBins] = useState<Bin[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [assignedTo, setAssignedTo] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [confirmation, setConfirmation] = useState<{
    type: "success" | "warning" | "error" | "info";
    title: string;
    referenceId: string;
    items?: Array<{ label: string; value: string }>;
    details?: string;
    redirectTo?: string;
  } | null>(null);

  useEffect(() => {
    if (BIN_TRACKING_ENABLED) {
      fetch("/api/bins").then((r) => r.json()).then((res) => { if (res.success) setBins(res.data); }).catch(() => {});
    }
    // Load team members for assignment
    fetch("/api/users").then((r) => r.json()).then((res) => { if (res.success) setUsers(res.data); }).catch(() => {});
  }, []);

  // Group bins by location
  const locationGroups = useMemo(() => {
    const groups: Record<string, { bins: Bin[]; totalProducts: number }> = {};
    bins.forEach((b) => {
      if (!groups[b.location]) groups[b.location] = { bins: [], totalProducts: 0 };
      groups[b.location].bins.push(b);
      groups[b.location].totalProducts += b._count.products;
    });
    return groups;
  }, [bins]);

  const locations = Object.keys(locationGroups).sort();

  const selectedStore = stores.find((s) => s.id === storeId) ?? null;
  const selectedWarehouse = selectedStore?.warehouses.find((w) => w.id === warehouseId) ?? null;
  const scopeLabel = selectedWarehouse?.name ?? (selectedStore ? `${selectedStore.name} — whole store` : "");

  // Estimated item count for preview
  const estimatedItems = useMemo(() => {
    if (scope === "bin" && selectedBin) {
      const bin = bins.find((b) => b.id === selectedBin);
      return bin?._count.products || 0;
    }
    if (scope === "location" && selectedLocation) {
      return locationGroups[selectedLocation]?.totalProducts || 0;
    }
    if (scope === "all") {
      return bins.reduce((sum, b) => sum + b._count.products, 0);
    }
    return 0;
  }, [scope, selectedBin, selectedLocation, bins, locationGroups]);

  // Auto-set title
  useEffect(() => {
    if (scope === "bin" && selectedBin) {
      const bin = bins.find((b) => b.id === selectedBin);
      if (bin) setTitle(`Stock Count - ${bin.code}`);
    } else if (scope === "location" && selectedLocation) {
      setTitle(`Stock Count - ${selectedLocation}`);
    }
  }, [selectedBin, selectedLocation, scope, bins]);

  // Warehouse mode: name the audit after what it actually covers.
  useEffect(() => {
    if (BIN_TRACKING_ENABLED) return;
    if (scopeLabel) setTitle(`Stock Count - ${scopeLabel}`);
  }, [scopeLabel]);

  const handleSubmit = async () => {
    if (!title || !dueDate) return;
    if (scope === "bin" && !selectedBin) return;
    if (scope === "location" && !selectedLocation) return;
    if (!BIN_TRACKING_ENABLED && !storeId) { setError("Choose a store"); return; }
    setSubmitting(true);
    setError("");
    try {
      const body: Record<string, unknown> = {
        title,
        dueDate,
        notes: notes || undefined,
        assignedToId: assignedTo || user?.userId,
      };

      if (!BIN_TRACKING_ENABLED) {
        body.storeId = storeId;
        // Omitted entirely for a whole-store audit — the API reads absence as "whole store".
        if (warehouseId) body.warehouseId = warehouseId;
      } else if (scope === "bin" && selectedBin) {
        body.binId = selectedBin;
      } else if (scope === "location" && selectedLocation) {
        body.location = selectedLocation;
      }
      const res = await fetch("/api/stock-counts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.success) {
        const assignedUser = users.find((u) => u.id === (assignedTo || user?.userId));
        setConfirmation({
          type: "success",
          title: "Stock Count Created",
          referenceId: data.data.countNo || data.data.id,
          items: [
            { label: "Title", value: title },
            { label: "Assigned To", value: assignedUser?.name || "—" },
            { label: "Due Date", value: new Date(dueDate).toLocaleDateString("en-IN") },
            { label: "Scope", value: !BIN_TRACKING_ENABLED ? scopeLabel : scope === "bin" ? `Bin: ${bins.find((b) => b.id === selectedBin)?.code || selectedBin}` : scope === "location" ? `Location: ${selectedLocation}` : "All Products" },
          ],
          redirectTo: `/stock-audit/${data.data.id}`,
        });
      } else setError(data.error || "Failed to create stock count");
    } catch {
      setError("Network error. Please try again.");
    }
    finally { setSubmitting(false); }
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
        {/* Scope — bin/location scoping is bin-derived; hidden while bins are dormant */}
        {BIN_TRACKING_ENABLED && (
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Count Scope</label>
            <div className="flex gap-2">
              <button onClick={() => { setScope("bin"); setSelectedLocation(""); }}
                className={`flex-1 min-h-[44px] rounded-lg text-sm font-medium transition-colors focus-ring ${
                  scope === "bin" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"
                }`}>By Bin</button>
              <button onClick={() => { setScope("location"); setSelectedBin(""); }}
                className={`flex-1 min-h-[44px] rounded-lg text-sm font-medium transition-colors focus-ring ${
                  scope === "location" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"
                }`}>By Location</button>
              <button onClick={() => { setScope("all"); setSelectedBin(""); setSelectedLocation(""); }}
                className={`flex-1 min-h-[44px] rounded-lg text-sm font-medium transition-colors focus-ring ${
                  scope === "all" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"
                }`}>All Products</button>
            </div>
          </div>
        )}

        {/* SCOPE — two steps, store then what inside it (R2, §5.1).
            Replaces a flat list of every warehouse in the business, which asked the person
            raising the audit to know which building belonged to which shop. */}
        {!BIN_TRACKING_ENABLED && (
          <>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Store *</label>
              <div className="grid grid-cols-2 gap-2">
                {stores.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => { setStoreId(s.id); setWarehouseId(""); }}
                    className={`min-h-[44px] rounded-lg text-sm font-medium transition-colors focus-ring ${
                      storeId === s.id ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            </div>

            {selectedStore && (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Count *</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setWarehouseId("")}
                    className={`min-h-[44px] rounded-lg text-sm font-medium transition-colors focus-ring ${
                      warehouseId === "" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    Whole store
                  </button>
                  {/* Warehouses by NAME. A "floor" is just a warehouse named that way — there
                      is no kind/type column, by decision (MIG-1a). */}
                  {selectedStore.warehouses.map((w) => (
                    <button
                      key={w.id}
                      onClick={() => setWarehouseId(w.id)}
                      className={`min-h-[44px] rounded-lg text-sm font-medium transition-colors focus-ring ${
                        warehouseId === w.id ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {w.name}
                    </button>
                  ))}
                </div>
                {/* The caption is the whole point of §5.1: a whole-store count produces one
                    number per product while stock is held per warehouse, so the variance
                    cannot be written back anywhere without inventing a location. */}
                {warehouseId === "" && (
                  <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-1 mt-2">
                    Verify only — to correct stock, audit one warehouse.
                  </p>
                )}
                {selectedStore.warehouses.length === 0 && (
                  <p className="text-[11px] text-slate-500 mt-2">
                    {selectedStore.name} has no active warehouses, so only a verify-only
                    whole-store count is possible.
                  </p>
                )}
              </div>
            )}
          </>
        )}

        {/* Bin Selector */}
        {scope === "bin" && (
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Select Bin *</label>
            <div className="space-y-2 max-h-[50vh] overflow-y-auto">
              {locations.map((loc) => (
                <div key={loc}>
                  <p className="text-xs font-semibold text-slate-700 px-1 py-1 sticky top-0 bg-white">{loc}</p>
                  <div className="space-y-1.5 pl-1">
                    {locationGroups[loc].bins.map((b) => {
                      const isSelected = selectedBin === b.id;
                      return (
                        <button key={b.id} onClick={() => setSelectedBin(b.id)}
                          className={`w-full text-left px-3 py-2.5 rounded-lg border transition-all ${
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
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Location Selector */}
        {scope === "location" && (
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Select Location *</label>
            <div className="space-y-2">
              {locations.map((loc) => {
                const group = locationGroups[loc];
                const isSelected = selectedLocation === loc;
                return (
                  <button key={loc} onClick={() => setSelectedLocation(loc)}
                    className={`w-full text-left p-3 rounded-lg border transition-all ${
                      isSelected
                        ? "border-slate-900 bg-slate-50 ring-1 ring-slate-900"
                        : "border-slate-200 bg-white"
                    }`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <MapPin className={`h-4 w-4 ${isSelected ? "text-slate-900" : "text-slate-400"}`} />
                        <span className="text-sm font-medium text-slate-900">{loc}</span>
                      </div>
                      <span className="text-xs text-slate-500">
                        {group.bins.length} bin{group.bins.length !== 1 ? "s" : ""} · {group.totalProducts} items
                      </span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-1 ml-6">
                      {group.bins.map((b) => (
                        <span key={b.id} className="px-2 py-0.5 bg-slate-100 rounded text-xs text-slate-600">
                          {b.code} ({b._count.products})
                        </span>
                      ))}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Baseline mode notice */}
        {(scope === "bin" || scope === "location") && (
          <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg">
            <Package className="h-4 w-4 text-amber-600 shrink-0" />
            <p className="text-xs text-amber-700">
              <span className="font-medium">Baseline Mode:</span> All active products will be listed. Count what you physically find — items counted with {'>'} 0 will be assigned to this {scope === "bin" ? "bin" : "location"}.
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
          if (!BIN_TRACKING_ENABLED && !storeId) missing.push("store");
          if (scope === "bin" && !selectedBin) missing.push("bin");
          if (scope === "location" && !selectedLocation) missing.push("location");
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
