"use client";

import { useState, useEffect, useMemo } from "react";
import { usePermissions } from "@/lib/use-permissions";
import {
  Boxes,
  MapPin,
  Plus,
  ArrowRightLeft,
  Printer,
  Search,
  Wrench,
  Bike,
  Layers,
  Sparkles,
  Info,
  X,
  CheckCircle2,
  Trash2,
  History,
  ShieldAlert,
  Pencil,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

interface Warehouse {
  id: string;
  code: string;
  name: string;
  kind: "FLOOR" | "GODOWN";
  storeId: string;
}

interface BinSummary {
  id: string;
  code: string;
  name: string;
  warehouseId: string;
  warehouse: { id: string; name: string; code: string; kind: string };
  location?: string | null;
  directions?: string | null;
  floor?: string | null;
  zone?: string | null;
  capacity?: number | null;
  isAssemblyArea: boolean;
  isActive: boolean;
  _count: {
    products: number;
    binStocks: number;
    units: number;
  };
}

interface InventoryUnitDetail {
  id: string;
  unitCode: string;
  frameNumber?: string | null;
  status: string;
  assembledBy?: { id: string; name: string } | null;
  product: {
    id: string;
    sku: string;
    name: string;
    brand: { id: string; name: string };
    category: { id: string; name: string };
  };
}

interface BinStockDetail {
  id: string;
  quantity: number;
  product: {
    id: string;
    sku: string;
    name: string;
    brand: { id: string; name: string };
    category: { id: string; name: string };
  };
}

interface MovementLog {
  id: string;
  createdAt: string;
  reason: string;
  quantity: number;
  movedBy: { id: string; name: string };
  fromBin?: { id: string; code: string; name: string } | null;
  toBin?: { id: string; code: string; name: string } | null;
  unit?: { id: string; unitCode: string } | null;
  product?: { id: string; sku: string; name: string } | null;
}

interface HomeRule {
  id: string;
  warehouseId: string;
  warehouse: { id: string; name: string; code: string };
  brand?: { id: string; name: string } | null;
  category?: { id: string; name: string } | null;
  bin: { id: string; code: string; name: string; directions?: string | null };
}

export default function BinsPage() {
  const { canView, canCreate, canEdit } = usePermissions();

  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<string>("");
  const [bins, setBins] = useState<BinSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterAssemblyOnly, setFilterAssemblyOnly] = useState(false);

  // Modals
  const [showAddModal, setShowAddModal] = useState(false);
  const [showRulesModal, setShowRulesModal] = useState(false);
  const [showMoveModal, setShowMoveModal] = useState(false);
  const [selectedBinForDetail, setSelectedBinForDetail] = useState<BinSummary | null>(null);

  // Add Bin Form State
  const [newBinCode, setNewBinCode] = useState("");
  const [newBinName, setNewBinName] = useState("");
  const [newBinDirections, setNewBinDirections] = useState("");
  const [newBinFloor, setNewBinFloor] = useState("");
  const [newBinZone, setNewBinZone] = useState("");
  const [newBinIsAssembly, setNewBinIsAssembly] = useState(false);
  const [newBinSaving, setNewBinSaving] = useState(false);
  const [formError, setFormError] = useState("");

  // Edit Bin Form State
  const [editingBin, setEditingBin] = useState<BinSummary | null>(null);
  const [editBinCode, setEditBinCode] = useState("");
  const [editBinName, setEditBinName] = useState("");
  const [editBinDirections, setEditBinDirections] = useState("");
  const [editBinFloor, setEditBinFloor] = useState("");
  const [editBinZone, setEditBinZone] = useState("");
  const [editBinCapacity, setEditBinCapacity] = useState("");
  const [editBinIsAssembly, setEditBinIsAssembly] = useState(false);
  const [editBinIsActive, setEditBinIsActive] = useState(true);
  const [editBinSaving, setEditBinSaving] = useState(false);
  const [editFormError, setEditFormError] = useState("");

  // Details Modal State
  const [binDetailsLoading, setBinDetailsLoading] = useState(false);
  const [detailedUnits, setDetailedUnits] = useState<InventoryUnitDetail[]>([]);
  const [detailedStocks, setDetailedStocks] = useState<BinStockDetail[]>([]);
  const [detailedMovements, setDetailedMovements] = useState<MovementLog[]>([]);

  // Move Modal State
  const [moveUnitId, setMoveUnitId] = useState("");
  const [moveFromBinId, setMoveFromBinId] = useState("");
  const [moveToBinId, setMoveToBinId] = useState("");
  const [moveReason, setMoveReason] = useState("");
  const [moveSaving, setMoveSaving] = useState(false);

  // Home Rules State
  const [homeRules, setHomeRules] = useState<HomeRule[]>([]);
  const [rulesLoading, setRulesLoading] = useState(false);
  const [brands, setBrands] = useState<{ id: string; name: string }[]>([]);
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [ruleBrandId, setRuleBrandId] = useState("");
  const [ruleCategoryId, setRuleCategoryId] = useState("");
  const [ruleBinId, setRuleBinId] = useState("");
  const [ruleSaving, setRuleSaving] = useState(false);

  // 1. Initial Load: Fetch Warehouses
  useEffect(() => {
    async function loadWarehouses() {
      try {
        const res = await fetch("/api/warehouses");
        const json = await res.json();
        if (json.success && Array.isArray(json.data)) {
          setWarehouses(json.data);
          if (json.data.length > 0) {
            setSelectedWarehouseId(json.data[0].id);
          }
        }
      } catch (err) {
        console.error("Failed to load warehouses", err);
      }
    }
    loadWarehouses();
  }, []);

  // 2. Fetch Bins for Selected Warehouse
  async function fetchBins(warehouseId?: string) {
    const wId = warehouseId || selectedWarehouseId;
    if (!wId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/bins?warehouseId=${encodeURIComponent(wId)}`);
      const json = await res.json();
      if (json.success) {
        setBins(json.data);
      }
    } catch (err) {
      console.error("Failed to load bins", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (selectedWarehouseId) {
      fetchBins(selectedWarehouseId);
    }
  }, [selectedWarehouseId]);

  // Load Brand & Category dropdowns when Rules modal opens
  useEffect(() => {
    if (showRulesModal && selectedWarehouseId) {
      setRulesLoading(true);
      Promise.all([
        fetch(`/api/bins/home-rules?warehouseId=${encodeURIComponent(selectedWarehouseId)}`).then((r) => r.json()),
        fetch("/api/brands").then((r) => r.json()),
        fetch("/api/categories").then((r) => r.json()),
      ])
        .then(([rulesRes, brandsRes, catRes]) => {
          if (rulesRes.success) setHomeRules(rulesRes.data);
          if (brandsRes.success) setBrands(brandsRes.data);
          if (catRes.success) setCategories(catRes.data);
        })
        .finally(() => setRulesLoading(false));
    }
  }, [showRulesModal, selectedWarehouseId]);

  // Load Bin Detailed Inventory
  async function openBinDetail(bin: BinSummary) {
    setSelectedBinForDetail(bin);
    setBinDetailsLoading(true);
    try {
      const res = await fetch(`/api/bins/${bin.id}/inventory`);
      const json = await res.json();
      if (json.success) {
        setDetailedUnits(json.data.units || []);
        setDetailedStocks(json.data.binStocks || []);
        setDetailedMovements(json.data.recentMovements || []);
      }
    } catch (err) {
      console.error("Failed to fetch bin inventory", err);
    } finally {
      setBinDetailsLoading(false);
    }
  }

  // Create Bin
  async function handleCreateBin(e: React.FormEvent) {
    e.preventDefault();
    if (!newBinCode.trim() || !newBinName.trim()) {
      setFormError("Code and Name are required");
      return;
    }
    setNewBinSaving(true);
    setFormError("");

    try {
      const res = await fetch("/api/bins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: newBinCode.trim(),
          name: newBinName.trim(),
          warehouseId: selectedWarehouseId,
          directions: newBinDirections.trim() || undefined,
          floor: newBinFloor.trim() || undefined,
          zone: newBinZone.trim() || undefined,
          isAssemblyArea: newBinIsAssembly,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || "Failed to create bin");
      }

      setShowAddModal(false);
      setNewBinCode("");
      setNewBinName("");
      setNewBinDirections("");
      setNewBinFloor("");
      setNewBinZone("");
      setNewBinIsAssembly(false);
      fetchBins();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : "Failed to create bin");
    } finally {
      setNewBinSaving(false);
    }
  }

  // Open Edit Bin Modal
  function openEditModal(bin: BinSummary) {
    setEditingBin(bin);
    setEditBinCode(bin.code);
    setEditBinName(bin.name);
    setEditBinDirections(bin.directions || "");
    setEditBinFloor(bin.floor || "");
    setEditBinZone(bin.zone || "");
    setEditBinCapacity(bin.capacity !== null && bin.capacity !== undefined ? String(bin.capacity) : "");
    setEditBinIsAssembly(Boolean(bin.isAssemblyArea));
    setEditBinIsActive(bin.isActive !== false);
    setEditFormError("");
  }

  // Save Bin Edit
  async function handleUpdateBin(e: React.FormEvent) {
    e.preventDefault();
    if (!editingBin) return;
    if (!editBinCode.trim() || !editBinName.trim()) {
      setEditFormError("Bin code and name are required");
      return;
    }

    setEditBinSaving(true);
    setEditFormError("");
    try {
      const res = await fetch(`/api/bins/${editingBin.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: editBinCode.trim().toUpperCase(),
          name: editBinName.trim(),
          directions: editBinDirections.trim() || null,
          floor: editBinFloor.trim() || null,
          zone: editBinZone.trim() || null,
          capacity: editBinCapacity.trim() ? Number(editBinCapacity) : null,
          isAssemblyArea: editBinIsAssembly,
          isActive: editBinIsActive,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || "Failed to update bin");
      }

      // Update active inspect modal if the currently edited bin is inspected
      if (selectedBinForDetail && selectedBinForDetail.id === editingBin.id) {
        setSelectedBinForDetail((prev) => (prev ? { ...prev, ...json.data } : null));
      }

      setEditingBin(null);
      fetchBins();
    } catch (err: unknown) {
      setEditFormError(err instanceof Error ? err.message : "Failed to update bin");
    } finally {
      setEditBinSaving(false);
    }
  }

  // Save Home Bin Rule
  async function handleSaveRule(e: React.FormEvent) {
    e.preventDefault();
    if (!ruleBinId) return;
    if (!ruleBrandId && !ruleCategoryId) {
      alert("Select at least a Brand or Category");
      return;
    }

    setRuleSaving(true);
    try {
      const res = await fetch("/api/bins/home-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          warehouseId: selectedWarehouseId,
          brandId: ruleBrandId || undefined,
          categoryId: ruleCategoryId || undefined,
          binId: ruleBinId,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || "Failed to save rule");
      }

      setRuleBrandId("");
      setRuleCategoryId("");
      setRuleBinId("");
      // Refresh rules
      const rRes = await fetch(`/api/bins/home-rules?warehouseId=${encodeURIComponent(selectedWarehouseId)}`);
      const rJson = await rRes.json();
      if (rJson.success) setHomeRules(rJson.data);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to save rule");
    } finally {
      setRuleSaving(false);
    }
  }

  async function handleDeleteRule(id: string) {
    if (!confirm("Are you sure you want to delete this home bin rule?")) return;
    try {
      await fetch(`/api/bins/home-rules?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      setHomeRules((prev) => prev.filter((r) => r.id !== id));
    } catch (err) {
      console.error(err);
    }
  }

  // Handle Relocate Move
  async function handleExecuteMove(e: React.FormEvent) {
    e.preventDefault();
    if (!moveToBinId || !moveReason.trim()) {
      alert("Target bin and Reason are required");
      return;
    }

    setMoveSaving(true);
    try {
      const res = await fetch("/api/bins/move", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          warehouseId: selectedWarehouseId,
          unitId: moveUnitId || undefined,
          fromBinId: moveFromBinId || undefined,
          toBinId: moveToBinId,
          reason: moveReason.trim(),
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || "Move failed");
      }

      setShowMoveModal(false);
      setMoveUnitId("");
      setMoveFromBinId("");
      setMoveToBinId("");
      setMoveReason("");

      // Refresh bins and active detail
      fetchBins();
      if (selectedBinForDetail) {
        openBinDetail(selectedBinForDetail);
      }
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Move failed");
    } finally {
      setMoveSaving(false);
    }
  }

  // Filtered Bins
  const filteredBins = useMemo(() => {
    return bins.filter((b) => {
      const matchesSearch =
        b.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
        b.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (b.directions && b.directions.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (b.zone && b.zone.toLowerCase().includes(searchQuery.toLowerCase()));

      const matchesAssembly = !filterAssemblyOnly || b.isAssemblyArea;
      return matchesSearch && matchesAssembly;
    });
  }, [bins, searchQuery, filterAssemblyOnly]);

  const selectedWarehouse = warehouses.find((w) => w.id === selectedWarehouseId);

  // Compute aggregate stats
  const totalUnits = bins.reduce((acc, b) => acc + (b._count.units || 0), 0);
  const totalLoose = bins.reduce((acc, b) => acc + (b._count.binStocks || 0), 0);
  const assemblyBinsCount = bins.filter((b) => b.isAssemblyArea).length;

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
            <Boxes className="h-4 w-4" />
            <span>Warehouse Directory & Landmarks</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Warehouse Bins & Locations
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Designate named landmarks, directions for counters, assembly staging areas, and auto-putaway rules.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canEdit("bins") && (
            <Button
              variant="outline"
              onClick={() => setShowRulesModal(true)}
              className="gap-2 border-indigo-200 text-indigo-700 hover:bg-indigo-50 dark:border-indigo-900 dark:text-indigo-300 dark:hover:bg-indigo-950/40"
            >
              <Sparkles className="h-4 w-4" />
              Home Bin Rules
            </Button>
          )}

          {canCreate("bins") && (
            <Button
              onClick={() => setShowAddModal(true)}
              className="gap-2 bg-indigo-600 text-white shadow-sm hover:bg-indigo-700"
            >
              <Plus className="h-4 w-4" />
              New Bin
            </Button>
          )}
        </div>
      </div>

      {/* Warehouse Selector Pills */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl bg-slate-100 p-2 dark:bg-slate-900">
        <span className="px-3 text-xs font-semibold uppercase text-slate-500">Site:</span>
        {warehouses.map((w) => {
          const isSelected = w.id === selectedWarehouseId;
          const isFloor = w.kind === "FLOOR";
          return (
            <button
              key={w.id}
              onClick={() => setSelectedWarehouseId(w.id)}
              className={`flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold transition-all ${
                isSelected
                  ? "bg-white text-indigo-700 shadow-sm dark:bg-slate-800 dark:text-indigo-300"
                  : "text-slate-600 hover:bg-white/50 dark:text-slate-400 dark:hover:bg-slate-800/50"
              }`}
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  isFloor ? "bg-emerald-500 ring-2 ring-emerald-200" : "bg-blue-500 ring-2 ring-blue-200"
                }`}
              />
              <span>{w.name}</span>
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] uppercase text-slate-500 dark:bg-slate-700">
                {w.kind}
              </span>
            </button>
          );
        })}
      </div>

      {/* KPI Stats Banner */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Card className="border-slate-200/80 bg-white/50 backdrop-blur-sm dark:border-slate-800 dark:bg-slate-900/50">
          <CardContent className="p-4">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Total Bins</div>
            <div className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">{bins.length}</div>
            <div className="mt-1 text-xs text-slate-400">Configured landmarks</div>
          </CardContent>
        </Card>

        <Card className="border-amber-200/80 bg-amber-50/30 backdrop-blur-sm dark:border-amber-900/40 dark:bg-amber-950/10">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-amber-700 dark:text-amber-400">Assembly Staging</span>
              <Wrench className="h-4 w-4 text-amber-600" />
            </div>
            <div className="mt-1 text-2xl font-bold text-amber-900 dark:text-amber-200">{assemblyBinsCount}</div>
            <div className="mt-1 text-xs text-amber-700/70 dark:text-amber-400/70">Designated build zones</div>
          </CardContent>
        </Card>

        <Card className="border-emerald-200/80 bg-emerald-50/30 backdrop-blur-sm dark:border-emerald-900/40 dark:bg-emerald-950/10">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400">Bicycles Shelved</span>
              <Bike className="h-4 w-4 text-emerald-600" />
            </div>
            <div className="mt-1 text-2xl font-bold text-emerald-900 dark:text-emerald-200">{totalUnits}</div>
            <div className="mt-1 text-xs text-emerald-700/70 dark:text-emerald-400/70">Coded units in bins</div>
          </CardContent>
        </Card>

        <Card className="border-slate-200/80 bg-white/50 backdrop-blur-sm dark:border-slate-800 dark:bg-slate-900/50">
          <CardContent className="p-4">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Loose Parts Stock</div>
            <div className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">{totalLoose}</div>
            <div className="mt-1 text-xs text-slate-400">Bulk products & spares</div>
          </CardContent>
        </Card>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="relative w-full md:w-80">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <Input
            placeholder="Search code, name, directions..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 text-sm"
          />
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setFilterAssemblyOnly((prev) => !prev)}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              filterAssemblyOnly
                ? "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400"
            }`}
          >
            <Wrench className="h-3.5 w-3.5" />
            <span>Assembly Areas Only</span>
          </button>
        </div>
      </div>

      {/* Bins Grid */}
      {loading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="h-44 animate-pulse rounded-xl border border-slate-200 bg-slate-100/80 dark:border-slate-800 dark:bg-slate-800/40" />
          ))}
        </div>
      ) : filteredBins.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50/50 p-12 text-center dark:border-slate-800 dark:bg-slate-900/20">
          <Boxes className="h-10 w-10 text-slate-300 dark:text-slate-600" />
          <h3 className="mt-3 text-base font-semibold text-slate-800 dark:text-slate-200">No Bins Found</h3>
          <p className="mt-1 text-xs text-slate-500 max-w-sm">
            {searchQuery
              ? "No bins match your search filter."
              : `No bins created yet for ${selectedWarehouse?.name || "this warehouse"}.`}
          </p>
          {canCreate("bins") && !searchQuery && (
            <Button
              size="sm"
              onClick={() => setShowAddModal(true)}
              className="mt-4 gap-1.5 bg-indigo-600 text-white hover:bg-indigo-700"
            >
              <Plus className="h-3.5 w-3.5" /> Create First Bin
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredBins.map((bin) => {
            const hasCycles = (bin._count.units || 0) > 0;
            const hasLoose = (bin._count.binStocks || 0) > 0;

            return (
              <Card
                key={bin.id}
                className={`relative overflow-hidden transition-all hover:shadow-md ${
                  bin.isAssemblyArea
                    ? "border-amber-300/80 bg-amber-50/10 dark:border-amber-800/60 dark:bg-amber-950/5"
                    : "border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
                }`}
              >
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xl font-bold tracking-tight text-slate-900 dark:text-white">
                          {bin.code}
                        </span>
                        {bin.isAssemblyArea && (
                          <Badge variant="warning" className="gap-1 font-semibold">
                            <Wrench className="h-3 w-3" /> Assembly
                          </Badge>
                        )}
                      </div>
                      <div className="text-sm font-medium text-slate-700 dark:text-slate-300">{bin.name}</div>
                    </div>

                    <div className="flex items-center gap-1">
                      {bin.floor && (
                        <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                          {bin.floor}
                        </span>
                      )}
                      {bin.zone && (
                        <span className="rounded bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300">
                          {bin.zone}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Directions / Landmark Box */}
                  <div className="mt-3 flex items-start gap-2 rounded-lg bg-slate-50 p-2.5 text-xs text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
                    <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                    <span className="italic leading-relaxed">
                      {bin.directions || "No physical directions specified. Update landmark description."}
                    </span>
                  </div>

                  {/* Inventory Overview */}
                  <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3 dark:border-slate-800/80">
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-1 text-xs">
                        <Bike className={`h-4 w-4 ${hasCycles ? "text-emerald-600" : "text-slate-300"}`} />
                        <span className={`font-semibold ${hasCycles ? "text-emerald-700 dark:text-emerald-400" : "text-slate-400"}`}>
                          {bin._count.units || 0}
                        </span>
                        <span className="text-[10px] text-slate-400">Cycles</span>
                      </div>

                      <div className="flex items-center gap-1 text-xs">
                        <Boxes className={`h-4 w-4 ${hasLoose ? "text-blue-600" : "text-slate-300"}`} />
                        <span className={`font-semibold ${hasLoose ? "text-blue-700 dark:text-blue-400" : "text-slate-400"}`}>
                          {bin._count.binStocks || 0}
                        </span>
                        <span className="text-[10px] text-slate-400">Loose</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5">
                      {canEdit("bins") && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => openEditModal(bin)}
                          className="h-8 px-2.5 text-xs font-semibold gap-1 border-slate-200 text-slate-700 hover:bg-slate-100 dark:border-slate-800 dark:text-slate-200 dark:hover:bg-slate-800"
                        >
                          <Pencil className="h-3 w-3 text-slate-500" />
                          Edit
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => openBinDetail(bin)}
                        className="h-8 px-3 text-xs font-semibold text-indigo-600 hover:bg-indigo-50 hover:text-indigo-700 dark:text-indigo-400 dark:hover:bg-indigo-950/40"
                      >
                        Inspect
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* ── MODAL 1: ADD BIN ── */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 sm:p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-t-3xl sm:rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-900 animate-in slide-in-from-bottom-5 sm:zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <Boxes className="h-5 w-5 text-indigo-600" />
                <h2 className="text-lg font-bold text-slate-900 dark:text-white">Create Warehouse Bin</h2>
              </div>
              <button
                onClick={() => setShowAddModal(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleCreateBin} className="mt-4 space-y-4">
              {formError && (
                <div className="rounded-lg bg-red-50 p-3 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">
                  {formError}
                </div>
              )}

              <div>
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Warehouse Scope
                </label>
                <input
                  disabled
                  value={`${selectedWarehouse?.name} (${selectedWarehouse?.kind})`}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-800 dark:text-slate-300"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Bin Code *
                  </label>
                  <Input
                    required
                    placeholder="e.g. A1 or ASM"
                    value={newBinCode}
                    onChange={(e) => setNewBinCode(e.target.value.toUpperCase())}
                    className="mt-1 font-mono uppercase"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Display Name *
                  </label>
                  <Input
                    required
                    placeholder="e.g. Shelf Rack 1"
                    value={newBinName}
                    onChange={(e) => setNewBinName(e.target.value)}
                    className="mt-1"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Landmark Directions (Plain Language Description) *
                </label>
                <textarea
                  rows={2}
                  placeholder="e.g. Ground floor, left of entrance, first steel rack beside wall"
                  value={newBinDirections}
                  onChange={(e) => setNewBinDirections(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 p-2.5 text-xs text-slate-900 shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-slate-800 dark:bg-slate-900 dark:text-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">Floor</label>
                  <Input
                    placeholder="e.g. Ground Floor"
                    value={newBinFloor}
                    onChange={(e) => setNewBinFloor(e.target.value)}
                    className="mt-1 text-xs"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">Zone</label>
                  <Input
                    placeholder="e.g. Zone A"
                    value={newBinZone}
                    onChange={(e) => setNewBinZone(e.target.value)}
                    className="mt-1 text-xs"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2 rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                <input
                  type="checkbox"
                  id="assemblyAreaCheck"
                  checked={newBinIsAssembly}
                  onChange={(e) => setNewBinIsAssembly(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                <label htmlFor="assemblyAreaCheck" className="text-xs font-medium text-slate-700 dark:text-slate-300">
                  This is an <strong>Assembly Area</strong> (Units assigned to mechanics auto-move here)
                </label>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setShowAddModal(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={newBinSaving} className="bg-indigo-600 text-white hover:bg-indigo-700">
                  {newBinSaving ? "Saving..." : "Create Bin"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── MODAL: EDIT BIN ── */}
      {editingBin && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 sm:p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-t-3xl sm:rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-900 animate-in slide-in-from-bottom-5 sm:zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <div className="p-1.5 bg-indigo-50 text-indigo-600 rounded-lg dark:bg-indigo-950 dark:text-indigo-400">
                  <Pencil className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white">
                    Edit Warehouse Bin
                  </h2>
                  <p className="text-[11px] text-slate-500">{editingBin.warehouse.name}</p>
                </div>
              </div>
              <button
                onClick={() => setEditingBin(null)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleUpdateBin} className="mt-4 space-y-4 text-xs">
              {editFormError && (
                <div className="rounded-lg bg-red-50 p-3 text-xs font-medium text-red-700 dark:bg-red-950/40 dark:text-red-300">
                  {editFormError}
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-700 dark:text-slate-300">
                    Bin Code *
                  </label>
                  <Input
                    required
                    placeholder="e.g. BCG_BIN_1"
                    value={editBinCode}
                    onChange={(e) => setEditBinCode(e.target.value.toUpperCase())}
                    className="mt-1 font-mono uppercase text-xs"
                  />
                </div>
                <div>
                  <label className="font-semibold text-slate-700 dark:text-slate-300">
                    Display Name *
                  </label>
                  <Input
                    required
                    placeholder="e.g. Rack A Shelf 1"
                    value={editBinName}
                    onChange={(e) => setEditBinName(e.target.value)}
                    className="mt-1 text-xs"
                  />
                </div>
              </div>

              <div>
                <label className="font-semibold text-slate-700 dark:text-slate-300">
                  Landmark Directions (Plain Language Description)
                </label>
                <textarea
                  rows={2}
                  placeholder="e.g. Left side after entrance, second metal rack on upper tier"
                  value={editBinDirections}
                  onChange={(e) => setEditBinDirections(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 p-2.5 text-xs text-slate-900 shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-slate-800 dark:bg-slate-900 dark:text-white"
                />
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="font-semibold text-slate-700 dark:text-slate-300">Floor</label>
                  <Input
                    placeholder="Ground / 1st"
                    value={editBinFloor}
                    onChange={(e) => setEditBinFloor(e.target.value)}
                    className="mt-1 text-xs"
                  />
                </div>
                <div>
                  <label className="font-semibold text-slate-700 dark:text-slate-300">Zone</label>
                  <Input
                    placeholder="Zone A"
                    value={editBinZone}
                    onChange={(e) => setEditBinZone(e.target.value)}
                    className="mt-1 text-xs"
                  />
                </div>
                <div>
                  <label className="font-semibold text-slate-700 dark:text-slate-300">Capacity</label>
                  <Input
                    type="number"
                    min="0"
                    placeholder="Units"
                    value={editBinCapacity}
                    onChange={(e) => setEditBinCapacity(e.target.value)}
                    className="mt-1 text-xs"
                  />
                </div>
              </div>

              <div className="space-y-2 pt-1">
                <div className="flex items-center gap-2 rounded-lg border border-slate-200 p-2.5 dark:border-slate-800">
                  <input
                    type="checkbox"
                    id="editAssemblyAreaCheck"
                    checked={editBinIsAssembly}
                    onChange={(e) => setEditBinIsAssembly(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <label htmlFor="editAssemblyAreaCheck" className="text-xs font-medium text-slate-700 dark:text-slate-300">
                    This is an <strong>Assembly Area</strong> (Mechanics stage bikes here)
                  </label>
                </div>

                <div className="flex items-center gap-2 rounded-lg border border-slate-200 p-2.5 dark:border-slate-800">
                  <input
                    type="checkbox"
                    id="editActiveCheck"
                    checked={editBinIsActive}
                    onChange={(e) => setEditBinIsActive(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <label htmlFor="editActiveCheck" className="text-xs font-medium text-slate-700 dark:text-slate-300">
                    Active (visible in putaway and audit selections)
                  </label>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                <Button type="button" variant="outline" onClick={() => setEditingBin(null)} className="h-9 text-xs">
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={editBinSaving}
                  className="h-9 text-xs bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm"
                >
                  {editBinSaving ? "Saving..." : "Save Changes"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── MODAL 2: INSPECT BIN INVENTORY & MOVEMENT TRAIL ── */}
      {selectedBinForDetail && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 sm:p-4 backdrop-blur-sm">
          <div className="flex max-h-[92vh] sm:max-h-[88vh] w-full max-w-3xl flex-col rounded-t-3xl sm:rounded-2xl bg-white shadow-2xl dark:bg-slate-900 animate-in slide-in-from-bottom-5 sm:zoom-in-95 duration-200">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 p-4 sm:p-5 dark:border-slate-800">
              <div className="flex items-start sm:items-center gap-3 min-w-0">
                <div className="shrink-0 px-3.5 py-1.5 rounded-xl bg-indigo-100 dark:bg-indigo-950 font-mono text-sm sm:text-base font-extrabold text-indigo-800 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 shadow-sm">
                  {selectedBinForDetail.code}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white truncate">
                      {selectedBinForDetail.name}
                    </h2>
                    {selectedBinForDetail.isAssemblyArea && (
                      <Badge variant="warning" className="text-[10px] gap-1 font-semibold">
                        <Wrench className="h-3 w-3" /> Assembly Staging
                      </Badge>
                    )}
                    {selectedBinForDetail.floor && (
                      <span className="text-[11px] font-medium text-slate-500 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded">
                        {selectedBinForDetail.floor}
                      </span>
                    )}
                    {selectedBinForDetail.zone && (
                      <span className="text-[11px] font-semibold text-indigo-600 bg-indigo-50 dark:bg-indigo-950 px-2 py-0.5 rounded">
                        {selectedBinForDetail.zone}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-1.5 flex-wrap">
                    <MapPin className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                    <span>{selectedBinForDetail.directions || "No physical directions specified"}</span>
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                {canEdit("bins") && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => openEditModal(selectedBinForDetail)}
                    className="h-8 gap-1.5 border-slate-200 text-xs text-slate-700 hover:bg-slate-100 dark:border-slate-800 dark:text-slate-200"
                  >
                    <Pencil className="h-3.5 w-3.5 text-slate-500" /> Edit
                  </Button>
                )}

                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setMoveFromBinId(selectedBinForDetail.id);
                    setShowMoveModal(true);
                  }}
                  className="h-8 gap-1.5 border-slate-200 text-xs text-slate-700 hover:bg-slate-100 dark:border-slate-800 dark:text-slate-200"
                >
                  <ArrowRightLeft className="h-3.5 w-3.5 text-indigo-500" /> Move Out
                </Button>

                <button
                  onClick={() => setSelectedBinForDetail(null)}
                  className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            {/* Content Body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-6">
              {binDetailsLoading ? (
                <div className="py-12 text-center text-xs text-slate-400">Loading contents...</div>
              ) : (
                <>
                  {/* Coded Bicycles in this Bin */}
                  <div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-xs font-bold uppercase text-slate-900 dark:text-white">
                        <Bike className="h-4 w-4 text-emerald-600" />
                        <span>Bicycles Shelved Here ({detailedUnits.length})</span>
                      </div>
                    </div>

                    {detailedUnits.length === 0 ? (
                      <div className="mt-2 rounded-xl border border-dashed border-slate-200 p-6 text-center text-xs text-slate-400 dark:border-slate-800">
                        No bicycles currently in this bin.
                      </div>
                    ) : (
                      <div className="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-200 bg-slate-50/50 dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900/40">
                        {detailedUnits.map((u) => (
                          <div key={u.id} className="flex items-center justify-between p-3 text-xs">
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-mono font-bold text-indigo-600 dark:text-indigo-400">
                                  {u.unitCode}
                                </span>
                                <Badge variant="default" className="text-[10px]">
                                  {u.status}
                                </Badge>
                                {u.frameNumber && (
                                  <span className="font-mono text-[10px] text-slate-400">
                                    Frame: {u.frameNumber}
                                  </span>
                                )}
                              </div>
                              <div className="mt-1 font-medium text-slate-800 dark:text-slate-200">
                                {u.product.name}
                              </div>
                              <div className="text-[11px] text-slate-400">
                                {u.product.brand.name} · {u.product.category.name}
                                {u.assembledBy && ` · Built by ${u.assembledBy.name}`}
                              </div>
                            </div>

                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setMoveUnitId(u.id);
                                setMoveFromBinId(selectedBinForDetail.id);
                                setShowMoveModal(true);
                              }}
                              className="h-7 text-xs text-indigo-600 hover:bg-indigo-50"
                            >
                              Relocate
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Loose Stocks */}
                  <div>
                    <div className="flex items-center gap-2 text-xs font-bold uppercase text-slate-900 dark:text-white">
                      <Boxes className="h-4 w-4 text-blue-600" />
                      <span>Loose Items / Parts ({detailedStocks.length})</span>
                    </div>

                    {detailedStocks.length === 0 ? (
                      <div className="mt-2 rounded-xl border border-dashed border-slate-200 p-6 text-center text-xs text-slate-400 dark:border-slate-800">
                        No loose items or parts in this bin.
                      </div>
                    ) : (
                      <div className="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
                        {detailedStocks.map((s) => (
                          <div key={s.id} className="flex items-center justify-between p-3 text-xs">
                            <div>
                              <div className="font-medium text-slate-800 dark:text-slate-200">
                                {s.product.name}
                              </div>
                              <div className="font-mono text-[11px] text-slate-400">
                                {s.product.sku} · {s.product.brand.name}
                              </div>
                            </div>
                            <div className="text-sm font-bold text-blue-600 dark:text-blue-400">
                              {s.quantity} units
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Movement Audit Trail */}
                  <div>
                    <div className="flex items-center gap-2 text-xs font-bold uppercase text-slate-900 dark:text-white">
                      <History className="h-4 w-4 text-slate-400" />
                      <span>Recent Movements In / Out ({detailedMovements.length})</span>
                    </div>

                    {detailedMovements.length === 0 ? (
                      <div className="mt-2 rounded-xl border border-dashed border-slate-200 p-4 text-center text-xs text-slate-400 dark:border-slate-800">
                        No movements logged for this bin.
                      </div>
                    ) : (
                      <div className="mt-2 divide-y divide-slate-100 text-xs dark:divide-slate-800">
                        {detailedMovements.map((log) => (
                          <div key={log.id} className="flex items-center justify-between py-2 text-[11px]">
                            <div>
                              <span className="font-semibold text-slate-700 dark:text-slate-300">
                                {log.reason}
                              </span>
                              <span className="ml-2 text-slate-400">
                                {log.fromBin ? log.fromBin.code : "Unassigned"} → {log.toBin?.code}
                              </span>
                              {log.unit && (
                                <span className="ml-2 font-mono font-bold text-indigo-500">
                                  {log.unit.unitCode}
                                </span>
                              )}
                            </div>
                            <div className="text-slate-400">
                              {new Date(log.createdAt).toLocaleDateString()} by {log.movedBy.name}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL 3: INTRA-WAREHOUSE MOVE ── */}
      {showMoveModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 sm:p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-t-3xl sm:rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-900 animate-in slide-in-from-bottom-5 sm:zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <ArrowRightLeft className="h-5 w-5 text-indigo-600" />
                <h2 className="text-base font-bold text-slate-900 dark:text-white">
                  Intra-Warehouse Relocate
                </h2>
              </div>
              <button
                onClick={() => setShowMoveModal(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleExecuteMove} className="mt-4 space-y-4 text-xs">
              <div className="rounded-lg bg-blue-50 p-3 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
                <div className="flex items-center gap-1.5 font-semibold">
                  <Info className="h-4 w-4" /> Move is Strictly Intra-Warehouse
                </div>
                <p className="mt-0.5 text-[11px] leading-relaxed">
                  Moving items between different stores or warehouses requires an inter-location Stock Transfer.
                </p>
              </div>

              <div>
                <label className="font-semibold text-slate-700 dark:text-slate-300">Target Bin *</label>
                <select
                  required
                  value={moveToBinId}
                  onChange={(e) => setMoveToBinId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white p-2.5 text-xs text-slate-900 dark:border-slate-800 dark:bg-slate-800 dark:text-white"
                >
                  <option value="">Select destination bin...</option>
                  {bins
                    .filter((b) => b.id !== moveFromBinId)
                    .map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.code} - {b.name} ({b.directions || "No directions"})
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label className="font-semibold text-slate-700 dark:text-slate-300">
                  Reason for Movement *
                </label>
                <Input
                  required
                  placeholder="e.g. Put-away round 1, Relocated for customer viewing, Staged for assembly"
                  value={moveReason}
                  onChange={(e) => setMoveReason(e.target.value)}
                  className="mt-1 text-xs"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setShowMoveModal(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={moveSaving} className="bg-indigo-600 text-white hover:bg-indigo-700">
                  {moveSaving ? "Moving..." : "Confirm Move"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── MODAL 4: HOME BIN RULES ── */}
      {showRulesModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 sm:p-4 backdrop-blur-sm">
          <div className="flex max-h-[92vh] sm:max-h-[90vh] w-full max-w-2xl flex-col rounded-t-3xl sm:rounded-2xl bg-white shadow-2xl dark:bg-slate-900 animate-in slide-in-from-bottom-5 sm:zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b border-slate-100 p-5 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-indigo-600" />
                <div>
                  <h2 className="text-base font-bold text-slate-900 dark:text-white">
                    Home Bin Rules ({selectedWarehouse?.name})
                  </h2>
                  <p className="text-xs text-slate-500">
                    Auto-suggest destination bins during inbound receipt rounds based on Brand and Category.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowRulesModal(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-5 text-xs">
              {/* Add Rule Form */}
              <form onSubmit={handleSaveRule} className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 dark:border-slate-800 dark:bg-slate-900/40">
                <div className="font-semibold text-slate-800 dark:text-slate-200">Add New Home Bin Rule</div>
                <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
                  <div>
                    <label className="text-[11px] font-medium text-slate-600 dark:text-slate-400">Brand</label>
                    <select
                      value={ruleBrandId}
                      onChange={(e) => setRuleBrandId(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-white p-2 text-xs text-slate-900 dark:border-slate-800 dark:bg-slate-800 dark:text-white"
                    >
                      <option value="">(Any Brand)</option>
                      {brands.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-[11px] font-medium text-slate-600 dark:text-slate-400">Category</label>
                    <select
                      value={ruleCategoryId}
                      onChange={(e) => setRuleCategoryId(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-white p-2 text-xs text-slate-900 dark:border-slate-800 dark:bg-slate-800 dark:text-white"
                    >
                      <option value="">(Any Category)</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-[11px] font-medium text-slate-600 dark:text-slate-400">Home Bin *</label>
                    <select
                      required
                      value={ruleBinId}
                      onChange={(e) => setRuleBinId(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-white p-2 text-xs text-slate-900 dark:border-slate-800 dark:bg-slate-800 dark:text-white"
                    >
                      <option value="">Select destination bin...</option>
                      {bins.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.code} ({b.name})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="mt-3 flex justify-end">
                  <Button type="submit" disabled={ruleSaving} size="sm" className="bg-indigo-600 text-white hover:bg-indigo-700">
                    {ruleSaving ? "Saving..." : "Save Rule"}
                  </Button>
                </div>
              </form>

              {/* Existing Rules List */}
              <div>
                <div className="font-semibold text-slate-800 dark:text-slate-200">
                  Active Rules ({homeRules.length})
                </div>

                {rulesLoading ? (
                  <div className="py-6 text-center text-slate-400">Loading rules...</div>
                ) : homeRules.length === 0 ? (
                  <div className="mt-2 rounded-lg border border-dashed border-slate-200 p-6 text-center text-slate-400 dark:border-slate-800">
                    No home bin rules configured for this warehouse yet.
                  </div>
                ) : (
                  <div className="mt-2 divide-y divide-slate-100 rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
                    {homeRules.map((r) => (
                      <div key={r.id} className="flex items-center justify-between p-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-slate-800 dark:text-slate-200">
                              {r.brand ? r.brand.name : "All Brands"}
                            </span>
                            <span className="text-slate-400">+</span>
                            <span className="font-semibold text-slate-800 dark:text-slate-200">
                              {r.category ? r.category.name : "All Categories"}
                            </span>
                            <span className="text-slate-400">→</span>
                            <span className="font-mono font-bold text-indigo-600 dark:text-indigo-400">
                              {r.bin.code}
                            </span>
                            <span className="text-slate-500">({r.bin.name})</span>
                          </div>
                          {r.bin.directions && (
                            <div className="mt-0.5 text-[11px] italic text-slate-400">
                              {r.bin.directions}
                            </div>
                          )}
                        </div>

                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleDeleteRule(r.id)}
                          className="h-7 text-red-600 hover:bg-red-50 hover:text-red-700"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
