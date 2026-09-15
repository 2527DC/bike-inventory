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
  Building2,
  Inbox,
  CheckSquare,
  Square,
  RefreshCw,
  Check,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useBinTracking } from "@/hooks/use-bin-tracking";
import { formatDateTime } from "@/lib/utils";
import { apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";

const log = createLogger("bins:page");

interface Warehouse {
  id: string;
  code: string;
  name: string;
  kind: "FLOOR" | "GODOWN";
  storeId: string;
  store?: { id: string; name: string; code: string } | null;
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

interface UnmatchedItem {
  id: string;
  productName: string;
  quantity: number;
  deliveredQty: number | null;
  productId: string | null;
  product: {
    id: string;
    sku: string;
    name: string;
    brand?: { id: string; name: string } | null;
    category?: { id: string; name: string } | null;
  } | null;
  shipment: {
    id: string;
    shipmentNo: string;
    billNo: string;
    deliveredAt: string | null;
  };
}

export default function BinsPage() {
  const { canView, canCreate, canEdit } = usePermissions();

  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<string>("ALL");
  const [selectedStoreFilter, setSelectedStoreFilter] = useState<string>("ALL");
  const [selectedKindFilter, setSelectedKindFilter] = useState<string>("ALL");
  const [bins, setBins] = useState<BinSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterAssemblyOnly, setFilterAssemblyOnly] = useState(false);

  // Top tab navigation: "directory" vs "unmatched"
  const [activeTab, setActiveTab] = useState<"directory" | "unmatched">("directory");

  // Unmatched Inbound Items state
  const [unmatchedItems, setUnmatchedItems] = useState<UnmatchedItem[]>([]);
  const [unmatchedCount, setUnmatchedCount] = useState<number>(0);
  const [unmatchedLoading, setUnmatchedLoading] = useState<boolean>(false);
  const [unmatchedSearch, setUnmatchedSearch] = useState<string>("");
  const [selectedUnmatchedIds, setSelectedUnmatchedIds] = useState<Set<string>>(new Set());
  const [bulkBinId, setBulkBinId] = useState<string>("");
  const [singleBinSelections, setSingleBinSelections] = useState<Record<string, string>>({});
  const [assignLoadingId, setAssignLoadingId] = useState<string | null>(null);
  const [bulkAssignLoading, setBulkAssignLoading] = useState<boolean>(false);
  const [assignSuccessMsg, setAssignSuccessMsg] = useState<string>("");
  const [assignError, setAssignError] = useState<string>("");

  // Dynamic Bin Tracking State
  const { isBinTrackingEnabled, toggleBinTracking } = useBinTracking();
  const [togglingTracking, setTogglingTracking] = useState(false);

  // Modals
  const [showAddModal, setShowAddModal] = useState(false);
  const [showRulesModal, setShowRulesModal] = useState(false);
  const [showMoveModal, setShowMoveModal] = useState(false);
  const [selectedBinForDetail, setSelectedBinForDetail] = useState<BinSummary | null>(null);

  // Add Bin Form State
  const [newBinWarehouseId, setNewBinWarehouseId] = useState("");
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
  const [detailedMovements, setDetailedMovements] = useState<MovementLog[]>([]);

  // Move Modal State
  const [moveUnitId, setMoveUnitId] = useState("");
  const [moveFromBinId, setMoveFromBinId] = useState("");
  const [moveToBinId, setMoveToBinId] = useState("");
  const [moveReason, setMoveReason] = useState("");
  const [moveSaving, setMoveSaving] = useState(false);

  // Home Rules State
  const [rulesWarehouseId, setRulesWarehouseId] = useState("");
  const [homeRules, setHomeRules] = useState<HomeRule[]>([]);
  const [rulesLoading, setRulesLoading] = useState(false);
  const [brands, setBrands] = useState<{ id: string; name: string }[]>([]);
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [ruleBins, setRuleBins] = useState<BinSummary[]>([]);
  const [ruleBrandId, setRuleBrandId] = useState("");
  const [ruleCategoryId, setRuleCategoryId] = useState("");
  const [ruleBinId, setRuleBinId] = useState("");
  const [ruleSaving, setRuleSaving] = useState(false);

  // Toggle Bin Tracking Setting
  async function handleToggleTracking() {
    setTogglingTracking(true);
    try {
      await toggleBinTracking(!isBinTrackingEnabled);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to toggle bin tracking");
    } finally {
      setTogglingTracking(false);
    }
  }

  // 1. Initial Load: Fetch Warehouses & All Bins
  useEffect(() => {
    async function loadInitialData() {
      setLoading(true);
      try {
        const [whRes, binRes] = await Promise.all([
          fetch("/api/warehouses"),
          fetch("/api/bins"),
        ]);
        const whJson = await whRes.json();
        const binJson = await binRes.json();
        if (whJson.success && Array.isArray(whJson.data)) {
          setWarehouses(whJson.data);
          if (whJson.data.length > 0) {
            setNewBinWarehouseId(whJson.data[0].id);
            setRulesWarehouseId(whJson.data[0].id);
          }
        }
        if (binJson.success && Array.isArray(binJson.data)) {
          setBins(binJson.data);
        }
        // Also fetch initial count of unmatched inbound items
        fetch("/api/bins/unmatched-items")
          .then((r) => r.json())
          .then((json) => {
            if (json.success && json.data) {
              setUnmatchedCount(json.data.total || 0);
            }
          })
          .catch(() => {});
      } catch (err) {
        console.error("Failed to load warehouses/bins", err);
      } finally {
        setLoading(false);
      }
    }
    loadInitialData();
  }, []);

  // 2. Fetch Bins
  async function fetchBins(warehouseId?: string) {
    const wId = warehouseId !== undefined ? warehouseId : selectedWarehouseId;
    setLoading(true);
    try {
      const url = wId && wId !== "ALL" ? `/api/bins?warehouseId=${encodeURIComponent(wId)}` : "/api/bins";
      const res = await fetch(url);
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

  // 3. Fetch Unmatched Inbound Items
  async function fetchUnmatchedItems() {
    setUnmatchedLoading(true);
    try {
      const res = await fetch("/api/bins/unmatched-items");
      const json = await res.json();
      if (json.success && json.data) {
        setUnmatchedItems(json.data.items || []);
        setUnmatchedCount(json.data.total || 0);
      }
    } catch (err) {
      console.error("Failed to fetch unmatched items", err);
    } finally {
      setUnmatchedLoading(false);
    }
  }

  async function handleAssignSingle(lineItemId: string) {
    const binId = singleBinSelections[lineItemId];
    if (!binId) {
      setAssignError("Please choose a bin for this item before assigning.");
      return;
    }
    setAssignLoadingId(lineItemId);
    setAssignError("");
    setAssignSuccessMsg("");
    try {
      const res = await fetch("/api/bins/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: [{ lineItemId, binId }] }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || "Failed to assign bin");
      }
      setAssignSuccessMsg("Item successfully assigned to bin!");
      setSelectedUnmatchedIds((prev) => {
        const next = new Set(prev);
        next.delete(lineItemId);
        return next;
      });
      await fetchUnmatchedItems();
      fetchBins();
    } catch (err: unknown) {
      setAssignError(err instanceof Error ? err.message : "Failed to assign bin");
    } finally {
      setAssignLoadingId(null);
    }
  }

  async function handleAssignBulk() {
    if (selectedUnmatchedIds.size === 0) {
      setAssignError("Please select at least one item to assign.");
      return;
    }
    if (!bulkBinId) {
      setAssignError("Please select a target bin for the selected items.");
      return;
    }
    setBulkAssignLoading(true);
    setAssignError("");
    setAssignSuccessMsg("");
    try {
      const items = Array.from(selectedUnmatchedIds).map((lineItemId) => ({
        lineItemId,
        binId: bulkBinId,
      }));
      const res = await fetch("/api/bins/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || "Failed to assign bins");
      }
      setAssignSuccessMsg(`Successfully assigned ${items.length} item(s) to bin!`);
      setSelectedUnmatchedIds(new Set());
      setBulkBinId("");
      await fetchUnmatchedItems();
      fetchBins();
    } catch (err: unknown) {
      setAssignError(err instanceof Error ? err.message : "Failed to assign bins");
    } finally {
      setBulkAssignLoading(false);
    }
  }

  const binsByWarehouse = useMemo(() => {
    const map = new Map<string, { warehouseName: string; bins: BinSummary[] }>();
    for (const b of bins) {
      if (!b.isActive) continue;
      const whId = b.warehouseId || b.warehouse?.id || "other";
      const whName = b.warehouse?.name || "Warehouse";
      if (!map.has(whId)) {
        map.set(whId, { warehouseName: whName, bins: [] });
      }
      map.get(whId)!.bins.push(b);
    }
    return Array.from(map.values());
  }, [bins]);

  const filteredUnmatched = useMemo(() => {
    if (!unmatchedSearch.trim()) return unmatchedItems;
    const q = unmatchedSearch.toLowerCase();
    return unmatchedItems.filter((it) => {
      const name = (it.productName || it.product?.name || "").toLowerCase();
      const sku = (it.product?.sku || "").toLowerCase();
      const brand = (it.product?.brand?.name || "").toLowerCase();
      const category = (it.product?.category?.name || "").toLowerCase();
      const shipmentNo = (it.shipment?.shipmentNo || "").toLowerCase();
      const billNo = (it.shipment?.billNo || "").toLowerCase();
      return (
        name.includes(q) ||
        sku.includes(q) ||
        brand.includes(q) ||
        category.includes(q) ||
        shipmentNo.includes(q) ||
        billNo.includes(q)
      );
    });
  }, [unmatchedItems, unmatchedSearch]);

  const allFilteredSelected =
    filteredUnmatched.length > 0 &&
    filteredUnmatched.every((it) => selectedUnmatchedIds.has(it.id));

  function toggleSelectAll() {
    if (allFilteredSelected) {
      setSelectedUnmatchedIds(new Set());
    } else {
      setSelectedUnmatchedIds(new Set(filteredUnmatched.map((it) => it.id)));
    }
  }

  function toggleSelectItem(id: string) {
    setSelectedUnmatchedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Pre-select warehouse for new bin modal or rules modal
  useEffect(() => {
    if (selectedWarehouseId !== "ALL") {
      setNewBinWarehouseId(selectedWarehouseId);
      setRulesWarehouseId(selectedWarehouseId);
    } else if (warehouses.length > 0 && !newBinWarehouseId) {
      setNewBinWarehouseId(warehouses[0].id);
      setRulesWarehouseId(warehouses[0].id);
    }
  }, [selectedWarehouseId, warehouses, newBinWarehouseId]);

  // Load Rules and Bins for Rules modal
  useEffect(() => {
    if (showRulesModal && rulesWarehouseId) {
      setRulesLoading(true);
      Promise.all([
        fetch(`/api/bins/home-rules?warehouseId=${encodeURIComponent(rulesWarehouseId)}`).then((r) => r.json()),
        fetch("/api/brands").then((r) => r.json()),
        fetch("/api/categories").then((r) => r.json()),
        fetch(`/api/bins?warehouseId=${encodeURIComponent(rulesWarehouseId)}`).then((r) => r.json()),
      ])
        .then(([rulesRes, brandsRes, catRes, binsRes]) => {
          if (rulesRes.success) setHomeRules(rulesRes.data);
          if (brandsRes.success) setBrands(brandsRes.data);
          if (catRes.success) setCategories(catRes.data);
          if (binsRes.success) setRuleBins(binsRes.data);
        })
        .finally(() => setRulesLoading(false));
    }
  }, [showRulesModal, rulesWarehouseId]);

  // Load Bin Detailed Inventory
  async function openBinDetail(bin: BinSummary) {
    setSelectedBinForDetail(bin);
    setBinDetailsLoading(true);
    // The route still returns `binStocks`; the drawer no longer shows them as "loose parts"
    // (plan 1509-assembly-queue-single-bin-and-product-assembly-level, R4). Every received
    // product is a coded bicycle now, so the bin's contents ARE its units.
    const { data, error } = await apiTry<{
      units: InventoryUnitDetail[];
      recentMovements: MovementLog[];
    }>(`/api/bins/${bin.id}/inventory`);
    if (error) {
      log.error("bin inventory load failed", { binId: bin.id, message: error });
    } else if (data) {
      setDetailedUnits(data.units || []);
      setDetailedMovements(data.recentMovements || []);
    }
    setBinDetailsLoading(false);
  }

  // Create Bin
  async function handleCreateBin(e: React.FormEvent) {
    e.preventDefault();
    if (!newBinCode.trim() || !newBinName.trim()) {
      setFormError("Code and Name are required");
      return;
    }
    const targetWhId = newBinWarehouseId || (selectedWarehouseId !== "ALL" ? selectedWarehouseId : warehouses[0]?.id);
    if (!targetWhId) {
      setFormError("Please select a target warehouse");
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
          warehouseId: targetWhId,
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

    const targetWhId = rulesWarehouseId || (selectedWarehouseId !== "ALL" ? selectedWarehouseId : warehouses[0]?.id);
    if (!targetWhId) {
      alert("Please select a target warehouse for this rule");
      return;
    }

    setRuleSaving(true);
    try {
      const res = await fetch("/api/bins/home-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          warehouseId: targetWhId,
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
      const rRes = await fetch(`/api/bins/home-rules?warehouseId=${encodeURIComponent(targetWhId)}`);
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

    const targetWhId =
      selectedWarehouseId !== "ALL"
        ? selectedWarehouseId
        : bins.find((b) => b.id === moveToBinId)?.warehouseId || warehouses[0]?.id;

    setMoveSaving(true);
    try {
      const res = await fetch("/api/bins/move", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          warehouseId: targetWhId,
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

  // Unique Stores for filtering
  const uniqueStores = useMemo(() => {
    const storeMap = new Map<string, string>();
    warehouses.forEach((w) => {
      if (w.store) {
        storeMap.set(w.store.id, w.store.name);
      }
    });
    return Array.from(storeMap.entries()).map(([id, name]) => ({ id, name }));
  }, [warehouses]);

  // Warehouses matching Store and Kind filter
  const selectableWarehouses = useMemo(() => {
    return warehouses.filter((w) => {
      const matchesStore = selectedStoreFilter === "ALL" || w.storeId === selectedStoreFilter;
      const matchesKind = selectedKindFilter === "ALL" || w.kind === selectedKindFilter;
      return matchesStore && matchesKind;
    });
  }, [warehouses, selectedStoreFilter, selectedKindFilter]);

  // Filtered Bins
  const filteredBins = useMemo(() => {
    return bins.filter((b) => {
      const binWarehouse = warehouses.find((w) => w.id === b.warehouseId);

      // Warehouse filter
      if (selectedWarehouseId !== "ALL" && b.warehouseId !== selectedWarehouseId) {
        return false;
      }
      // Store filter
      if (selectedStoreFilter !== "ALL" && binWarehouse && binWarehouse.storeId !== selectedStoreFilter) {
        return false;
      }
      // Kind filter
      if (selectedKindFilter !== "ALL" && binWarehouse && binWarehouse.kind !== selectedKindFilter) {
        return false;
      }

      const matchesSearch =
        b.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
        b.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (b.directions && b.directions.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (b.zone && b.zone.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (binWarehouse && binWarehouse.name.toLowerCase().includes(searchQuery.toLowerCase()));

      const matchesAssembly = !filterAssemblyOnly || b.isAssemblyArea;
      return matchesSearch && matchesAssembly;
    });
  }, [bins, warehouses, selectedWarehouseId, selectedStoreFilter, selectedKindFilter, searchQuery, filterAssemblyOnly]);

  // Group filtered bins by warehouse for directory view
  const warehousesWithBins = useMemo(() => {
    const targetWarehouses = selectableWarehouses.filter((w) => {
      if (selectedWarehouseId !== "ALL") {
        return w.id === selectedWarehouseId;
      }
      return true;
    });

    return targetWarehouses.map((wh) => {
      const whBins = filteredBins.filter((b) => b.warehouseId === wh.id);
      return {
        warehouse: wh,
        bins: whBins,
      };
    });
  }, [selectableWarehouses, filteredBins, selectedWarehouseId]);

  const selectedWarehouse = warehouses.find((w) => w.id === selectedWarehouseId);

  // Compute aggregate stats from filtered bins
  const totalUnits = filteredBins.reduce((acc, b) => acc + (b._count.units || 0), 0);
  const assemblyBinsCount = filteredBins.filter((b) => b.isAssemblyArea).length;

  // The bin drawer lists its bicycles grouped by product, with a count per product — the
  // "items" view that replaced the Bicycles / Loose split (R4).
  const unitsByProduct = useMemo(() => {
    const groups = new Map<string, { product: InventoryUnitDetail["product"]; units: InventoryUnitDetail[] }>();
    for (const u of detailedUnits) {
      const g = groups.get(u.product.id);
      if (g) g.units.push(u);
      else groups.set(u.product.id, { product: u.product, units: [u] });
    }
    return Array.from(groups.values()).sort((a, b) => a.product.name.localeCompare(b.product.name));
  }, [detailedUnits]);

  function renderBinCard(bin: BinSummary) {
    const hasCycles = (bin._count.units || 0) > 0;

    return (
      <Card
        key={bin.id}
        className={`relative overflow-hidden transition-all hover:shadow-md ${bin.isAssemblyArea
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
  }

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

        <div className="flex flex-wrap items-center gap-3">
          {/* Dynamic Bin Tracking Toggle Switch */}
          <div className="flex items-center gap-2.5 rounded-xl border border-slate-200/80 bg-white px-3.5 py-1.5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="flex flex-col">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                Bin Tracking
              </span>
              <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                {isBinTrackingEnabled ? "Active & Enforced" : "Disabled (Off)"}
              </span>
            </div>
            {canEdit("bins") && (
              <button
                type="button"
                role="switch"
                aria-checked={isBinTrackingEnabled}
                disabled={togglingTracking}
                onClick={handleToggleTracking}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 ${isBinTrackingEnabled ? "bg-indigo-600" : "bg-slate-300 dark:bg-slate-700"
                  } ${togglingTracking ? "opacity-50 cursor-not-allowed" : ""}`}
                title={isBinTrackingEnabled ? "Click to Disable Bin Tracking" : "Click to Enable Bin Tracking"}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${isBinTrackingEnabled ? "translate-x-5" : "translate-x-0"
                    }`}
                />
              </button>
            )}
          </div>

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
              onClick={() => {
                if (selectedWarehouseId !== "ALL") {
                  setNewBinWarehouseId(selectedWarehouseId);
                } else if (warehouses.length > 0) {
                  setNewBinWarehouseId(warehouses[0].id);
                }
                setShowAddModal(true);
              }}
              className="gap-2 bg-indigo-600 text-white shadow-sm hover:bg-indigo-700"
            >
              <Plus className="h-4 w-4" />
              New Bin
            </Button>
          )}
        </div>
      </div>

      {/* Top-Level Navigation Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-2">
        <button
          onClick={() => setActiveTab("directory")}
          className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all ${
            activeTab === "directory"
              ? "bg-indigo-600 text-white shadow-sm"
              : "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          }`}
        >
          <Boxes className="h-4 w-4" />
          <span>Warehouse Directory</span>
        </button>

        <button
          onClick={() => {
            setActiveTab("unmatched");
            fetchUnmatchedItems();
          }}
          className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all ${
            activeTab === "unmatched"
              ? "bg-indigo-600 text-white shadow-sm"
              : "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          }`}
        >
          <Inbox className="h-4 w-4" />
          <span>Unmatched Inbound</span>
          {unmatchedCount > 0 && (
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                activeTab === "unmatched"
                  ? "bg-white text-indigo-700"
                  : "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
              }`}
            >
              {unmatchedCount}
            </span>
          )}
        </button>
      </div>

      {activeTab === "directory" ? (
        <>
          {/* Search & Filter Bar: Store, Kind, Warehouse & Quick Search */}
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        {/* Store Filter */}
        <div className="flex flex-col min-w-[170px] flex-1">
          <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Store / Branch
          </label>
          <select
            value={selectedStoreFilter}
            onChange={(e) => {
              setSelectedStoreFilter(e.target.value);
              setSelectedWarehouseId("ALL");
            }}
            className="mt-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-800 focus:border-indigo-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
          >
            <option value="ALL">All Stores ({uniqueStores.length})</option>
            {uniqueStores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>

        {/* Kind Filter (Floor vs Godown) */}
        <div className="flex flex-col min-w-[150px]">
          <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Site Type
          </label>
          <select
            value={selectedKindFilter}
            onChange={(e) => {
              setSelectedKindFilter(e.target.value);
              setSelectedWarehouseId("ALL");
            }}
            className="mt-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-800 focus:border-indigo-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
          >
            <option value="ALL">All Types (Floor & Godown)</option>
            <option value="FLOOR">Floor (Showroom/Retail)</option>
            <option value="GODOWN">Godown (Storage/Warehouse)</option>
          </select>
        </div>

        {/* Warehouse Dropdown */}
        <div className="flex flex-col min-w-[220px] flex-1">
          <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Warehouse / Site Scope
          </label>
          <select
            value={selectedWarehouseId}
            onChange={(e) => setSelectedWarehouseId(e.target.value)}
            className="mt-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-800 focus:border-indigo-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
          >
            <option value="ALL">🌟 All Warehouses Directory ({selectableWarehouses.length})</option>
            {selectableWarehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name} ({w.kind}) {w.store ? `- ${w.store.name}` : ""}
              </option>
            ))}
          </select>
        </div>

        {/* Search query input */}
        <div className="flex flex-col min-w-[200px] flex-1">
          <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Search Landmarks & Bins
          </label>
          <div className="relative mt-1">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
            <input
              type="text"
              placeholder="Search code, name, directions..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 pl-8 pr-3 py-2 text-xs text-slate-800 focus:border-indigo-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
            />
          </div>
        </div>

        {/* Assembly areas toggle */}
        <div className="flex flex-col justify-end pt-5">
          <button
            onClick={() => setFilterAssemblyOnly((prev) => !prev)}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${filterAssemblyOnly
              ? "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
              : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400"
              }`}
          >
            <Wrench className="h-3.5 w-3.5" />
            <span>Assembly Only</span>
          </button>
        </div>
      </div>

      {/* KPI Stats Banner */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
        <Card className="border-slate-200/80 bg-white/50 backdrop-blur-sm dark:border-slate-800 dark:bg-slate-900/50">
          <CardContent className="p-4">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Total Bins</div>
            <div className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">{filteredBins.length}</div>
            <div className="mt-1 text-xs text-slate-400">Matching landmarks</div>
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
        {/* "Loose Parts Stock" is gone (R4): every received product is a coded bicycle, so the
            count of distinct BinStock rows it showed double-counted the bicycles above. */}
      </div>

      {/* Directory View / Single Warehouse View */}
      {loading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="h-44 animate-pulse rounded-xl border border-slate-200 bg-slate-100/80 dark:border-slate-800 dark:bg-slate-800/40" />
          ))}
        </div>
      ) : selectedWarehouseId === "ALL" ? (
        /* ALL WAREHOUSES DIRECTORY VIEW */
        <div className="space-y-8">
          {warehousesWithBins.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50/50 p-12 text-center dark:border-slate-800 dark:bg-slate-900/20">
              <Boxes className="h-10 w-10 text-slate-300 dark:text-slate-600" />
              <h3 className="mt-3 text-base font-semibold text-slate-800 dark:text-slate-200">No Warehouses Found</h3>
              <p className="mt-1 text-xs text-slate-500 max-w-sm">
                No warehouses match your current store or site filters.
              </p>
            </div>
          ) : (
            warehousesWithBins.map(({ warehouse: wh, bins: whBins }) => (
              <div key={wh.id} className="space-y-3 rounded-2xl border border-slate-200/80 bg-slate-50/40 p-5 dark:border-slate-800/80 dark:bg-slate-900/20">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/60 pb-3 dark:border-slate-800/60">
                  <div className="flex items-center gap-2.5">
                    <div className="rounded-lg bg-indigo-50 p-2 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-400">
                      <Building2 className="h-4 w-4" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-base font-bold text-slate-900 dark:text-white">
                          {wh.name}
                        </span>
                        <Badge variant="info" className="text-[10px] uppercase font-semibold">
                          {wh.kind}
                        </Badge>
                        {wh.store && (
                          <span className="text-xs text-slate-500">
                            • {wh.store.name}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-500">
                        {whBins.length} landmark bin{whBins.length !== 1 ? "s" : ""} configured
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setSelectedWarehouseId(wh.id)}
                      className="h-8 text-xs font-semibold gap-1 border-slate-200 text-slate-700 hover:bg-white dark:border-slate-700 dark:text-slate-300"
                    >
                      Focus Site
                    </Button>
                    {canCreate("bins") && (
                      <Button
                        size="sm"
                        onClick={() => {
                          setNewBinWarehouseId(wh.id);
                          setShowAddModal(true);
                        }}
                        className="h-8 text-xs font-semibold gap-1 bg-indigo-600 text-white hover:bg-indigo-700"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Add Bin
                      </Button>
                    )}
                  </div>
                </div>

                {whBins.length === 0 ? (
                  <div className="flex items-center justify-between rounded-xl border border-dashed border-slate-200 bg-white/50 p-4 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-900/40">
                    <span>
                      {searchQuery ? "No bins match your search in this warehouse." : "No bins created for this warehouse yet."}
                    </span>
                    {canCreate("bins") && !searchQuery && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setNewBinWarehouseId(wh.id);
                          setShowAddModal(true);
                        }}
                        className="h-7 text-xs text-indigo-600 hover:text-indigo-700"
                      >
                        <Plus className="mr-1 h-3 w-3" /> Create First Bin
                      </Button>
                    )}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 pt-1">
                    {whBins.map(renderBinCard)}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      ) : (
        /* SINGLE WAREHOUSE VIEW */
        <div>
          {filteredBins.length === 0 ? (
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
                  onClick={() => {
                    setNewBinWarehouseId(selectedWarehouseId);
                    setShowAddModal(true);
                  }}
                  className="mt-4 gap-1.5 bg-indigo-600 text-white hover:bg-indigo-700"
                >
                  <Plus className="h-3.5 w-3.5" /> Create First Bin
                </Button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {filteredBins.map(renderBinCard)}
            </div>
          )}
        </div>
      )}
        </>
      ) : (
        /* UNMATCHED INBOUND ITEMS TAB */
        <div className="space-y-4">
          {/* Notifications */}
          {assignSuccessMsg && (
            <div className="flex items-center justify-between rounded-xl border border-green-200 bg-green-50 p-3 text-xs font-medium text-green-800 dark:border-green-900/40 dark:bg-green-950/20 dark:text-green-300">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                <span>{assignSuccessMsg}</span>
              </div>
              <button
                onClick={() => setAssignSuccessMsg("")}
                className="text-green-700 hover:underline"
              >
                Dismiss
              </button>
            </div>
          )}

          {assignError && (
            <div className="flex items-center justify-between rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-medium text-red-800 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-300">
              <div className="flex items-center gap-2">
                <ShieldAlert className="h-4 w-4 text-red-600" />
                <span>{assignError}</span>
              </div>
              <button
                onClick={() => setAssignError("")}
                className="text-red-700 hover:underline"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Subheader & Search / Filter Controls */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center gap-3 flex-1 min-w-[240px]">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search delivered items, SKU, shipment, brand, category..."
                  value={unmatchedSearch}
                  onChange={(e) => setUnmatchedSearch(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 py-2 text-xs text-slate-800 focus:border-indigo-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                />
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={fetchUnmatchedItems}
                disabled={unmatchedLoading}
                className="gap-1.5 h-9 text-xs border-slate-200 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${unmatchedLoading ? "animate-spin" : ""}`} />
                <span>Refresh</span>
              </Button>
            </div>

            <div className="text-xs text-slate-500">
              Showing <span className="font-bold text-slate-800 dark:text-slate-200">{filteredUnmatched.length}</span> of {unmatchedCount} unassigned item{unmatchedCount !== 1 ? "s" : ""}
            </div>
          </div>

          {/* Bulk Action Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-indigo-100 bg-indigo-50/50 p-4 dark:border-indigo-950/60 dark:bg-indigo-950/20">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={toggleSelectAll}
                className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:text-indigo-600"
              >
                {allFilteredSelected ? (
                  <CheckSquare className="h-4 w-4 text-indigo-600" />
                ) : (
                  <Square className="h-4 w-4 text-slate-400" />
                )}
                <span>Select All Visible</span>
              </button>
              {selectedUnmatchedIds.size > 0 && (
                <Badge variant="info" className="text-xs">
                  {selectedUnmatchedIds.size} selected
                </Badge>
              )}
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <select
                value={bulkBinId}
                onChange={(e) => setBulkBinId(e.target.value)}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-800 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 max-w-xs"
              >
                <option value="">Choose Destination Bin...</option>
                {binsByWarehouse.map((group) => (
                  <optgroup key={group.warehouseName} label={group.warehouseName}>
                    {group.bins.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.code} — {b.name} {b.directions ? `(${b.directions})` : ""}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>

              <Button
                size="sm"
                disabled={selectedUnmatchedIds.size === 0 || !bulkBinId || bulkAssignLoading || !canEdit("bins")}
                onClick={handleAssignBulk}
                className="h-8 gap-1.5 bg-indigo-600 text-white hover:bg-indigo-700 text-xs"
              >
                {bulkAssignLoading ? (
                  <>
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    <span>Assigning...</span>
                  </>
                ) : (
                  <>
                    <Check className="h-3.5 w-3.5" />
                    <span>Assign Selected ({selectedUnmatchedIds.size})</span>
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* Items Listing */}
          {unmatchedLoading ? (
            <div className="space-y-3">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-28 animate-pulse rounded-2xl border border-slate-200 bg-slate-100/70 dark:border-slate-800 dark:bg-slate-800/40" />
              ))}
            </div>
          ) : filteredUnmatched.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50/50 p-12 text-center dark:border-slate-800 dark:bg-slate-900/20">
              <CheckCircle2 className="h-12 w-12 text-emerald-500" />
              <h3 className="mt-3 text-base font-bold text-slate-800 dark:text-slate-200">
                {unmatchedItems.length === 0
                  ? "All Delivered Items Assigned!"
                  : "No items match your search"}
              </h3>
              <p className="mt-1 text-xs text-slate-500 max-w-sm">
                {unmatchedItems.length === 0
                  ? "Every delivered inbound line item has been placed into a designated warehouse bin."
                  : "Try clearing your search query to see all unmatched inbound items."}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredUnmatched.map((it) => {
                const isSelected = selectedUnmatchedIds.has(it.id);
                const currentBinChoice = singleBinSelections[it.id] || "";
                const isSaving = assignLoadingId === it.id;
                const brandName = it.product?.brand?.name;
                const catName = it.product?.category?.name;
                const qty = it.deliveredQty || it.quantity;

                return (
                  <div
                    key={it.id}
                    className={`rounded-2xl border p-4 transition-all ${
                      isSelected
                        ? "border-indigo-400 bg-indigo-50/30 shadow-sm dark:border-indigo-700 dark:bg-indigo-950/20"
                        : "border-slate-200/80 bg-white hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900"
                    }`}
                  >
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                      {/* Left: Checkbox + Product & Shipment Info */}
                      <div className="flex items-start gap-3 flex-1 min-w-0">
                        <button
                          type="button"
                          onClick={() => toggleSelectItem(it.id)}
                          className="mt-0.5 text-slate-400 hover:text-indigo-600 shrink-0"
                        >
                          {isSelected ? (
                            <CheckSquare className="h-5 w-5 text-indigo-600" />
                          ) : (
                            <Square className="h-5 w-5 text-slate-300" />
                          )}
                        </button>

                        <div className="space-y-1.5 min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-bold text-slate-900 dark:text-white truncate">
                              {it.productName || it.product?.name}
                            </span>
                            {it.product?.sku && (
                              <span className="font-mono text-[11px] bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded text-slate-600 dark:text-slate-300">
                                {it.product.sku}
                              </span>
                            )}
                            <Badge variant="warning" className="text-[10px]">
                              Qty: {qty}
                            </Badge>
                          </div>

                          <div className="flex items-center gap-2 flex-wrap text-xs">
                            {brandName && (
                              <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                                Brand: {brandName}
                              </span>
                            )}
                            {catName && (
                              <span className="inline-flex items-center rounded-md bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300">
                                Category: {catName}
                              </span>
                            )}
                            <span className="text-slate-400">•</span>
                            <span className="text-slate-600 dark:text-slate-400">
                              Shipment: <strong className="text-slate-800 dark:text-slate-200">{it.shipment?.shipmentNo}</strong>
                            </span>
                            <span className="text-slate-400">•</span>
                            <span className="text-slate-600 dark:text-slate-400">
                              Bill: <strong className="text-slate-800 dark:text-slate-200">{it.shipment?.billNo}</strong>
                            </span>
                            {it.shipment?.deliveredAt && (
                              <>
                                <span className="text-slate-400">•</span>
                                <span className="text-slate-500">
                                  Delivered: {formatDateTime(it.shipment.deliveredAt)}
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Right: Destination Bin Selection & Assign Button */}
                      <div className="flex items-center gap-2 shrink-0 self-end md:self-center">
                        <select
                          value={currentBinChoice}
                          onChange={(e) =>
                            setSingleBinSelections((prev) => ({
                              ...prev,
                              [it.id]: e.target.value,
                            }))
                          }
                          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-800 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 max-w-[220px]"
                        >
                          <option value="">Select destination bin...</option>
                          {binsByWarehouse.map((group) => (
                            <optgroup key={group.warehouseName} label={group.warehouseName}>
                              {group.bins.map((b) => (
                                <option key={b.id} value={b.id}>
                                  {b.code} — {b.name}
                                </option>
                              ))}
                            </optgroup>
                          ))}
                        </select>

                        <Button
                          size="sm"
                          disabled={!currentBinChoice || isSaving || !canEdit("bins")}
                          onClick={() => handleAssignSingle(it.id)}
                          className="h-8 gap-1 bg-indigo-600 text-white hover:bg-indigo-700 text-xs"
                        >
                          {isSaving ? (
                            <>
                              <RefreshCw className="h-3 w-3 animate-spin" />
                              <span>Saving...</span>
                            </>
                          ) : (
                            <>
                              <MapPin className="h-3 w-3" />
                              <span>Assign</span>
                            </>
                          )}
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
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
                  Target Warehouse *
                </label>
                <select
                  required
                  value={newBinWarehouseId}
                  onChange={(e) => setNewBinWarehouseId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-800 focus:border-indigo-500 focus:outline-none dark:border-slate-800 dark:bg-slate-800 dark:text-slate-200"
                >
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name} ({w.kind}) {w.store ? `- ${w.store.name}` : ""}
                    </option>
                  ))}
                </select>
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
                  {/* Items in this bin — its bicycles, grouped by product with a count (R4).
                      The separate "Loose Items / Parts" list is gone: every received product
                      is a coded bicycle (D1), so it only repeated these same bicycles. */}
                  <div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-xs font-bold uppercase text-slate-900 dark:text-white">
                        <Bike className="h-4 w-4 text-emerald-600" />
                        <span>Items in this bin ({detailedUnits.length})</span>
                      </div>
                    </div>

                    {detailedUnits.length === 0 ? (
                      <div className="mt-2 rounded-xl border border-dashed border-slate-200 p-6 text-center text-xs text-slate-400 dark:border-slate-800">
                        No items currently in this bin.
                      </div>
                    ) : (
                      <div className="mt-3 space-y-3">
                        {unitsByProduct.map((g) => (
                          <div key={g.product.id} className="rounded-xl border border-slate-200 bg-slate-50/50 dark:border-slate-800 dark:bg-slate-900/40">
                            <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-3 py-2 dark:border-slate-800">
                              <div className="min-w-0">
                                <div className="truncate text-xs font-semibold text-slate-800 dark:text-slate-200">
                                  {g.product.name}
                                </div>
                                <div className="font-mono text-[11px] text-slate-400">
                                  {g.product.sku} · {g.product.brand.name} · {g.product.category.name}
                                </div>
                              </div>
                              <Badge variant="default" className="shrink-0 text-[11px]">
                                ×{g.units.length}
                              </Badge>
                            </div>
                            <div className="divide-y divide-slate-100 dark:divide-slate-800">
                              {g.units.map((u) => (
                                <div key={u.id} className="flex items-center justify-between p-3 text-xs">
                                  <div className="flex flex-wrap items-center gap-2">
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
                                    {u.assembledBy && (
                                      <span className="text-[11px] text-slate-400">Built by {u.assembledBy.name}</span>
                                    )}
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
                    Home Bin Rules
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
              {/* Warehouse Scope Selector */}
              <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-800/50">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Warehouse Scope:
                </label>
                <select
                  value={rulesWarehouseId}
                  onChange={(e) => setRulesWarehouseId(e.target.value)}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                >
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name} ({w.kind}) {w.store ? `- ${w.store.name}` : ""}
                    </option>
                  ))}
                </select>
              </div>

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
                      {ruleBins.map((b) => (
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
