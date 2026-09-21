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
  Trash2,
  History,
  Pencil,
  Building2,
  ShieldOff,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { CategoryTreeSelect } from "@/components/category-tree-select";
import { UnitLabelSheet } from "@/components/units/unit-label-sheet";
import { apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";

const log = createLogger("bins:manager");

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
  /** Items stored here need no assembly (R42, P6). Fixed when the bin is created (P6a). */
  nonAssemblable?: boolean;
  isActive: boolean;
  _count: {
    products: number;
    binStocks: number;
    units: number;
  };
  /** R5 / Q9: live units only, split on `assembledAt` — from one groupBy in `GET /api/bins`. */
  unitCounts?: { total: number; assembled: number; unassembled: number };
}

interface InventoryUnitDetail {
  id: string;
  unitCode: string;
  frameNumber?: string | null;
  status: string;
  /** Stamped when the unit entered a no-assembly bin; kept through transfers (P6). */
  nonAssemblable?: boolean;
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
  category?: { id: string; name: string; parentId?: string | null } | null;
  /** "Cycles › Kids › 16 inch" — the rule names a leaf, so the leaf's name alone is ambiguous. */
  categoryPath?: string | null;
  bin: { id: string; code: string; name: string; directions?: string | null; nonAssemblable?: boolean };
}

/** The flat rows `/api/categories` returns, as much of them as the tree picker needs. */
interface CategoryRow {
  id: string;
  name: string;
  parentId: string | null;
  isActive?: boolean;
}

/**
 * Warehouse bins — directory and home-bin rules. Bins are always on (plan 2109, Q27); the
 * Unmatched tab, the per-rule Apply button and both Generate-codes buttons were removed (R29, Q21, Q24).
 *
 * Extracted verbatim from src/app/(dashboard)/bins/page.tsx (plan 1709-priority-build-and-stock-
 * flow, Part F, R32) with no behaviour change, so it can render both at /bins and as the Bins tab
 * of Admin › Settings › Store management (/stores?tab=bins). Part H extends it.
 */
export function BinsManager() {
  const { canView, canCreate, canEdit } = usePermissions();

  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<string>("ALL");
  const [selectedStoreFilter, setSelectedStoreFilter] = useState<string>("ALL");
  const [selectedKindFilter, setSelectedKindFilter] = useState<string>("ALL");
  const [bins, setBins] = useState<BinSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterAssemblyOnly, setFilterAssemblyOnly] = useState(false);

  // The "directory" / "Unmatched Inbound" tabs and the bin-tracking switch were removed (plan
  // 2109: R29 dropped, R34 makes a bin mandatory at receive, Q27 bins always on).

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
  // R42, P6a: set here and nowhere else — the edit form shows it read-only.
  const [newBinNonAssemblable, setNewBinNonAssemblable] = useState(false);
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
  // R5: the drawer's Total · Assembled · Unassembled, from the same helper as the card.
  const [detailCounts, setDetailCounts] = useState<{ total: number; assembled: number; unassembled: number } | null>(null);

  // Move Modal State
  const [moveUnitId, setMoveUnitId] = useState("");
  const [moveFromBinId, setMoveFromBinId] = useState("");
  const [moveToBinId, setMoveToBinId] = useState("");
  const [moveReason, setMoveReason] = useState("");
  const [moveSaving, setMoveSaving] = useState(false);
  const [moveError, setMoveError] = useState("");

  // Home Rules State
  const [rulesWarehouseId, setRulesWarehouseId] = useState("");
  const [homeRules, setHomeRules] = useState<HomeRule[]>([]);
  const [rulesLoading, setRulesLoading] = useState(false);
  const [brands, setBrands] = useState<{ id: string; name: string }[]>([]);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [ruleBins, setRuleBins] = useState<BinSummary[]>([]);
  const [ruleBrandId, setRuleBrandId] = useState("");
  // R39, P13: the top-level category, then the SUBCATEGORY — required whenever the chosen
  // category still has active children, because a rule always names a leaf.
  const [ruleCategoryId, setRuleCategoryId] = useState<string | null>(null);
  const [ruleSubcategoryId, setRuleSubcategoryId] = useState<string | null>(null);
  const [ruleBinId, setRuleBinId] = useState("");
  const [ruleSaving, setRuleSaving] = useState(false);
  const [ruleError, setRuleError] = useState("");

  // The per-rule "Apply to existing stock" (R40) and "Generate unit codes" (R41) state were
  // removed with their buttons (plan 2109, Q21, Q24): codes now come from the bin audit (R31).

  // The printable sheet (R46), opened with the new codes, a whole bin, or one item.
  const [labelSheet, setLabelSheet] = useState<{ unitIds?: string[]; binId?: string; heading: string } | null>(null);

  // P6b: clear one unit's no-assembly stamp, with a reason.
  const [markUnit, setMarkUnit] = useState<InventoryUnitDetail | null>(null);
  const [markReason, setMarkReason] = useState("");
  const [markSaving, setMarkSaving] = useState(false);
  const [markError, setMarkError] = useState("");

  // 1. Initial Load: Fetch Warehouses & All Bins
  useEffect(() => {
    async function loadInitialData() {
      setLoading(true);
      // `apiTry`, never `fetch().then(r => r.json())`: an expired session answers 307 → /login
      // → HTML with status 200, which `res.ok` does not catch and `.json()` dies on (CLAUDE.md).
      const [wh, binList] = await Promise.all([
        apiTry<Warehouse[]>("/api/warehouses"),
        apiTry<BinSummary[]>("/api/bins"),
      ]);
      if (wh.error) log.error("warehouse load failed", { message: wh.error });
      else if (Array.isArray(wh.data)) {
        setWarehouses(wh.data);
        if (wh.data.length > 0) {
          setNewBinWarehouseId(wh.data[0].id);
          setRulesWarehouseId(wh.data[0].id);
        }
      }
      if (binList.error) log.error("bin load failed", { message: binList.error });
      else if (Array.isArray(binList.data)) setBins(binList.data);
      setLoading(false);
    }
    loadInitialData();
  }, []);

  // 2. Fetch Bins
  async function fetchBins(warehouseId?: string) {
    const wId = warehouseId !== undefined ? warehouseId : selectedWarehouseId;
    setLoading(true);
    const url = wId && wId !== "ALL" ? `/api/bins?warehouseId=${encodeURIComponent(wId)}` : "/api/bins";
    const { data, error } = await apiTry<BinSummary[]>(url);
    if (error) log.error("bin load failed", { warehouseId: wId, message: error });
    else if (data) setBins(data);
    setLoading(false);
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
    if (!showRulesModal || !rulesWarehouseId) return;
    let cancelled = false;
    async function loadRules(warehouseId: string) {
      setRulesLoading(true);
      const [rules, brandList, catList, binList] = await Promise.all([
        apiTry<HomeRule[]>(`/api/bins/home-rules?warehouseId=${encodeURIComponent(warehouseId)}`),
        apiTry<{ id: string; name: string }[]>("/api/brands"),
        apiTry<CategoryRow[]>("/api/categories"),
        apiTry<BinSummary[]>(`/api/bins?warehouseId=${encodeURIComponent(warehouseId)}`),
      ]);
      if (cancelled) return;
      if (rules.error) log.error("home rules load failed", { warehouseId, message: rules.error });
      else if (rules.data) setHomeRules(rules.data);
      if (brandList.error) log.error("brand load failed", { message: brandList.error });
      else if (brandList.data) setBrands(brandList.data);
      if (catList.error) log.error("category load failed", { message: catList.error });
      else if (catList.data) setCategories(catList.data);
      if (binList.error) log.error("rule bin load failed", { warehouseId, message: binList.error });
      else if (binList.data) setRuleBins(binList.data);
      setRulesLoading(false);
    }
    loadRules(rulesWarehouseId);
    return () => {
      cancelled = true;
    };
  }, [showRulesModal, rulesWarehouseId]);

  /** Active children of the chosen category: while there are any, a subcategory is required (P13). */
  const ruleSubcategories = useMemo(
    () => (ruleCategoryId ? categories.filter((c) => c.parentId === ruleCategoryId) : []),
    [categories, ruleCategoryId]
  );

  // Load Bin Detailed Inventory
  async function openBinDetail(bin: BinSummary) {
    setSelectedBinForDetail(bin);
    setDetailCounts(bin.unitCounts ?? null);
    setBinDetailsLoading(true);
    // The route still returns `binStocks`; the drawer no longer shows them as "loose parts"
    // (plan 1509-assembly-queue-single-bin-and-product-assembly-level, R4). Every received
    // product is a coded bicycle now, so the bin's contents ARE its units.
    const { data, error } = await apiTry<{
      units: InventoryUnitDetail[];
      recentMovements: MovementLog[];
      unitCounts?: { total: number; assembled: number; unassembled: number };
    }>(`/api/bins/${bin.id}/inventory`);
    if (error) {
      log.error("bin inventory load failed", { binId: bin.id, message: error });
    } else if (data) {
      setDetailedUnits(data.units || []);
      setDetailedMovements(data.recentMovements || []);
      if (data.unitCounts) setDetailCounts(data.unitCounts);
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

    const { error } = await apiTry<BinSummary>("/api/bins", {
      method: "POST",
      json: {
        code: newBinCode.trim(),
        name: newBinName.trim(),
        warehouseId: targetWhId,
        directions: newBinDirections.trim() || undefined,
        floor: newBinFloor.trim() || undefined,
        zone: newBinZone.trim() || undefined,
        isAssemblyArea: newBinIsAssembly,
        // R42, P6a: the ONLY place this is ever sent — the edit route refuses a change.
        nonAssemblable: newBinNonAssemblable,
      },
    });
    if (error) {
      log.error("bin create failed", { code: newBinCode.trim(), warehouseId: targetWhId, message: error });
      setFormError(error);
    } else {
      log.info("bin created", { code: newBinCode.trim(), nonAssemblable: newBinNonAssemblable });
      setShowAddModal(false);
      setNewBinCode("");
      setNewBinName("");
      setNewBinDirections("");
      setNewBinFloor("");
      setNewBinZone("");
      setNewBinIsAssembly(false);
      setNewBinNonAssemblable(false);
      fetchBins();
    }
    setNewBinSaving(false);
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
    // `nonAssemblable` is deliberately NOT sent: it is fixed at creation (P6a) and the route
    // refuses a change.
    const { data, error } = await apiTry<BinSummary>(`/api/bins/${editingBin.id}`, {
      method: "PATCH",
      json: {
        code: editBinCode.trim().toUpperCase(),
        name: editBinName.trim(),
        directions: editBinDirections.trim() || null,
        floor: editBinFloor.trim() || null,
        zone: editBinZone.trim() || null,
        capacity: editBinCapacity.trim() ? Number(editBinCapacity) : null,
        isAssemblyArea: editBinIsAssembly,
        isActive: editBinIsActive,
      },
    });
    if (error) {
      log.error("bin update failed", { binId: editingBin.id, message: error });
      setEditFormError(error);
    } else {
      // Update active inspect modal if the currently edited bin is inspected
      if (data && selectedBinForDetail && selectedBinForDetail.id === editingBin.id) {
        setSelectedBinForDetail((prev) => (prev ? { ...prev, ...data } : null));
      }
      setEditingBin(null);
      fetchBins();
    }
    setEditBinSaving(false);
  }

  // Save Home Bin Rule
  async function handleSaveRule(e: React.FormEvent) {
    e.preventDefault();
    setRuleError("");
    if (!ruleBinId) return;
    if (!ruleBrandId && !ruleCategoryId) {
      setRuleError("Choose at least a brand or a category");
      return;
    }
    // P13: a rule always names a leaf. While the chosen category still has active children,
    // the subcategory decides — the server refuses it too, but saying so here is kinder.
    if (ruleCategoryId && ruleSubcategories.length > 0 && !ruleSubcategoryId) {
      setRuleError(
        `Choose a subcategory of ${categories.find((c) => c.id === ruleCategoryId)?.name ?? "that category"}`
      );
      return;
    }

    const targetWhId = rulesWarehouseId || (selectedWarehouseId !== "ALL" ? selectedWarehouseId : warehouses[0]?.id);
    if (!targetWhId) {
      setRuleError("Choose the warehouse this rule is for");
      return;
    }

    setRuleSaving(true);
    const { data, error } = await apiTry<HomeRule>("/api/bins/home-rules", {
      method: "POST",
      json: {
        warehouseId: targetWhId,
        brandId: ruleBrandId || undefined,
        categoryId: ruleCategoryId || undefined,
        subcategoryId: ruleSubcategoryId || undefined,
        binId: ruleBinId,
      },
    });
    if (error) {
      log.error("home bin rule save failed", { warehouseId: targetWhId, message: error });
      setRuleError(error);
    } else {
      log.info("home bin rule saved", { ruleId: data?.id, warehouseId: targetWhId, binId: ruleBinId });
      setRuleBrandId("");
      setRuleCategoryId(null);
      setRuleSubcategoryId(null);
      setRuleBinId("");
      const refreshed = await apiTry<HomeRule[]>(
        `/api/bins/home-rules?warehouseId=${encodeURIComponent(targetWhId)}`
      );
      if (refreshed.error) log.error("home rules refresh failed", { message: refreshed.error });
      else if (refreshed.data) setHomeRules(refreshed.data);
    }
    setRuleSaving(false);
  }

  async function handleDeleteRule(id: string) {
    if (!confirm("Are you sure you want to delete this home bin rule?")) return;
    const { error } = await apiTry(`/api/bins/home-rules?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (error) {
      log.error("home bin rule delete failed", { ruleId: id, message: error });
      setRuleError(error);
      return;
    }
    setHomeRules((prev) => prev.filter((r) => r.id !== id));
  }

  // Apply-rule-to-existing-stock and Generate-unit-codes handlers removed (plan 2109, Q21, Q24).

  // ── P6b: this item does need assembly after all ──
  async function confirmMarkAssemblable() {
    if (!markUnit) return;
    if (!markReason.trim()) {
      setMarkError("Say why this item needs assembly after all");
      return;
    }
    setMarkSaving(true);
    setMarkError("");
    const { error } = await apiTry(`/api/units/${markUnit.id}/assemblable`, {
      method: "POST",
      json: { reason: markReason.trim() },
    });
    if (error) {
      log.error("mark assemblable failed", { unitId: markUnit.id, message: error });
      setMarkError(error);
    } else {
      log.info("unit marked assemblable", { unitId: markUnit.id, unitCode: markUnit.unitCode });
      setMarkUnit(null);
      setMarkReason("");
      if (selectedBinForDetail) openBinDetail(selectedBinForDetail);
    }
    setMarkSaving(false);
  }

  // Handle Relocate Move
  async function handleExecuteMove(e: React.FormEvent) {
    e.preventDefault();
    if (!moveToBinId || !moveReason.trim()) {
      setMoveError("Choose the destination bin and say why it is moving");
      return;
    }

    const targetWhId =
      selectedWarehouseId !== "ALL"
        ? selectedWarehouseId
        : bins.find((b) => b.id === moveToBinId)?.warehouseId || warehouses[0]?.id;

    setMoveSaving(true);
    setMoveError("");
    const { error } = await apiTry("/api/bins/move", {
      method: "POST",
      json: {
        warehouseId: targetWhId,
        unitId: moveUnitId || undefined,
        fromBinId: moveFromBinId || undefined,
        toBinId: moveToBinId,
        reason: moveReason.trim(),
      },
    });
    if (error) {
      // A 409 here is the P6 refusal: a no-assembly item cannot go into a bin that holds items
      // needing assembly. Shown in the form rather than an alert, because it names the bin.
      log.warn("bin move refused", { unitId: moveUnitId || null, toBinId: moveToBinId, message: error });
      setMoveError(error);
    } else {
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
    }
    setMoveSaving(false);
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
  const totalUnits = filteredBins.reduce((acc, b) => acc + (b.unitCounts?.total ?? 0), 0);
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
    const counts = bin.unitCounts ?? { total: 0, assembled: 0, unassembled: 0 };
    const hasCycles = counts.total > 0;
    // Q7: capacity warns, never blocks.
    const overCapacity = bin.capacity != null && bin.capacity > 0 && counts.total > bin.capacity;

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
                {bin.nonAssemblable && (
                  <Badge variant="default" className="gap-1 font-semibold">
                    <ShieldOff className="h-3 w-3" /> No assembly
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
            {/* R5 / Q9: Total · Assembled · Unassembled, live items only. A no-assembly bin shows Total only. */}
            <div className="flex min-w-0 flex-col gap-0.5">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                <Bike className={`h-4 w-4 ${hasCycles ? "text-emerald-600" : "text-slate-300"}`} />
                <span className={`font-semibold ${hasCycles ? "text-emerald-700 dark:text-emerald-400" : "text-slate-400"}`}>
                  {counts.total}
                </span>
                <span className="text-[10px] text-slate-400">Total</span>
                {!bin.nonAssemblable && (
                  <>
                    <span className="text-slate-300">·</span>
                    <span className="font-semibold text-slate-700 dark:text-slate-300">{counts.assembled}</span>
                    <span className="text-[10px] text-slate-400">Assembled</span>
                    <span className="text-slate-300">·</span>
                    <span className="font-semibold text-slate-700 dark:text-slate-300">{counts.unassembled}</span>
                    <span className="text-[10px] text-slate-400">Unassembled</span>
                  </>
                )}
              </div>
              {overCapacity && (
                <span className="text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                  {counts.total} / {bin.capacity} — over capacity
                </span>
              )}
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
          {/* The "Bin Tracking" on/off switch was removed: bins are always on (plan 2109, Q27). */}

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

          {/* The warehouse "Generate unit codes" button was removed (plan 2109, Q24): existing
              items get their U- codes from the bin audit (R31). */}

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

      {/* The "Warehouse Directory" / "Unmatched Inbound" tabs were removed (plan 2109, R29
          dropped): every inbound line now needs a bin before it is received (R34). */}
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

              {/* R42, P6, P6a — set here and never again. */}
              <div className="flex items-start gap-2 rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                <input
                  type="checkbox"
                  id="nonAssemblableCheck"
                  checked={newBinNonAssemblable}
                  onChange={(e) => setNewBinNonAssemblable(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                <label htmlFor="nonAssemblableCheck" className="text-xs font-medium text-slate-700 dark:text-slate-300">
                  Items here <strong>need no assembly</strong> (spares, accessories). They never show on
                  the build line, and once an item is in such a bin it cannot be moved into a bin that
                  holds items needing assembly.
                  <span className="mt-1 block text-[11px] font-normal text-amber-600 dark:text-amber-400">
                    This cannot be changed later — to change it, create another bin and move the items.
                  </span>
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

                {/* Read-only: the flag is fixed when the bin is created (R42, P6a). */}
                <div className="flex items-center gap-2 rounded-lg border border-dashed border-slate-200 bg-slate-50 p-2.5 dark:border-slate-800 dark:bg-slate-800/40">
                  <ShieldOff className="h-4 w-4 shrink-0 text-slate-400" />
                  <div className="text-xs text-slate-600 dark:text-slate-400">
                    {editingBin.nonAssemblable ? (
                      <>
                        Items here <strong>need no assembly</strong>.
                      </>
                    ) : (
                      <>
                        Items here <strong>need assembly</strong>.
                      </>
                    )}{" "}
                    Set when the bin was created and cannot be changed.
                  </div>
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
                    {selectedBinForDetail.nonAssemblable && (
                      <Badge variant="default" className="text-[10px] gap-1 font-semibold">
                        <ShieldOff className="h-3 w-3" /> No assembly
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
                  {/* R5 / Q9: live items only; a no-assembly bin shows Total only. */}
                  {detailCounts && (
                    <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                      <strong>{detailCounts.total}</strong> Total
                      {!selectedBinForDetail.nonAssemblable && (
                        <>
                          {" · "}<strong>{detailCounts.assembled}</strong> Assembled
                          {" · "}<strong>{detailCounts.unassembled}</strong> Unassembled
                        </>
                      )}
                      {selectedBinForDetail.capacity != null &&
                        selectedBinForDetail.capacity > 0 &&
                        detailCounts.total > selectedBinForDetail.capacity && (
                          <span className="ml-2 font-semibold text-amber-600 dark:text-amber-400">
                            {detailCounts.total} / {selectedBinForDetail.capacity} — over capacity
                          </span>
                        )}
                    </p>
                  )}
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

                {/* R46: reprint every label on this shelf. */}
                <Button
                  size="sm"
                  variant="outline"
                  disabled={detailedUnits.length === 0}
                  onClick={() =>
                    setLabelSheet({
                      binId: selectedBinForDetail.id,
                      heading: `Bin ${selectedBinForDetail.code} · ${selectedBinForDetail.warehouse.name}`,
                    })
                  }
                  className="h-8 gap-1.5 border-slate-200 text-xs text-slate-700 hover:bg-slate-100 dark:border-slate-800 dark:text-slate-200"
                >
                  <Printer className="h-3.5 w-3.5 text-indigo-500" /> Print labels
                </Button>

                {/* The bin-level "Generate codes" button was removed (plan 2109, Q24, R31). */}

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
                                    {u.nonAssemblable && (
                                      <Badge variant="default" className="gap-1 text-[10px]">
                                        <ShieldOff className="h-3 w-3" /> No assembly
                                      </Badge>
                                    )}
                                  </div>

                                  <div className="flex shrink-0 items-center gap-1">
                                    {/* P6b: the correction for an item stamped by mistake — it
                                        cannot otherwise leave a no-assembly bin. */}
                                    {u.nonAssemblable && canEdit("bins") && (
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        onClick={() => {
                                          setMarkUnit(u);
                                          setMarkReason("");
                                          setMarkError("");
                                        }}
                                        className="h-7 text-xs text-amber-600 hover:bg-amber-50"
                                      >
                                        Needs assembly
                                      </Button>
                                    )}
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      onClick={() =>
                                        setLabelSheet({ unitIds: [u.id], heading: u.unitCode })
                                      }
                                      className="h-7 text-xs text-slate-500 hover:bg-slate-100"
                                    >
                                      Label
                                    </Button>
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
              {moveError && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs font-medium text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
                  {moveError}
                </div>
              )}

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

                {ruleError && (
                  <div className="mt-2 rounded-lg border border-red-200 bg-red-50 p-2.5 text-[11px] font-medium text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
                    {ruleError}
                  </div>
                )}

                <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
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

                  {/* R39, P13: category, then subcategory. The picker shows the top level only —
                      choosing a parent is never a rule on its own while it has children. */}
                  <div>
                    <label className="text-[11px] font-medium text-slate-600 dark:text-slate-400">Category</label>
                    <CategoryTreeSelect
                      categories={categories}
                      mode="roots"
                      value={ruleCategoryId}
                      onChange={(id) => {
                        setRuleCategoryId(id);
                        setRuleSubcategoryId(null);
                        setRuleError("");
                      }}
                      placeholder="(Any category)"
                      className="mt-1"
                    />
                  </div>

                  {/* Shown only when the chosen category HAS children — then it is required. */}
                  {ruleCategoryId && ruleSubcategories.length > 0 && (
                    <div>
                      <label className="text-[11px] font-medium text-slate-600 dark:text-slate-400">
                        Subcategory *
                      </label>
                      <CategoryTreeSelect
                        categories={categories}
                        mode="childrenOf"
                        parentId={ruleCategoryId}
                        value={ruleSubcategoryId}
                        onChange={(id) => {
                          setRuleSubcategoryId(id);
                          setRuleError("");
                        }}
                        placeholder="Choose a subcategory"
                        className="mt-1"
                      />
                      <p className="mt-1 text-[10px] text-slate-400">
                        A rule always names a category with nothing under it, so it cannot be
                        ambiguous about which products it covers.
                      </p>
                    </div>
                  )}

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
                          {b.code} ({b.name}){b.nonAssemblable ? " — no assembly" : ""}
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

              {/* The "Apply to existing stock" panel was removed (plan 2109, Q21): rules act only
                  when an inbound line is received. */}

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
                              {r.categoryPath || r.category?.name || "All Categories"}
                            </span>
                            <span className="text-slate-400">→</span>
                            <span className="font-mono font-bold text-indigo-600 dark:text-indigo-400">
                              {r.bin.code}
                            </span>
                            <span className="text-slate-500">({r.bin.name})</span>
                            {r.bin.nonAssemblable && (
                              <Badge variant="default" className="gap-1 text-[10px]">
                                <ShieldOff className="h-3 w-3" /> No assembly
                              </Badge>
                            )}
                          </div>
                          {r.bin.directions && (
                            <div className="mt-0.5 text-[11px] italic text-slate-400">
                              {r.bin.directions}
                            </div>
                          )}
                        </div>

                        <div className="flex shrink-0 items-center gap-1">
                          {/* Per-rule "Apply to existing stock" removed (plan 2109, Q21). */}
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleDeleteRule(r.id)}
                            className="h-7 text-red-600 hover:bg-red-50 hover:text-red-700"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 5 (Generate unit codes for existing stock) was removed (plan 2109, Q24): codes
          come from the bin audit (R31). */}

      {/* ── MODAL 6: THIS ITEM DOES NEED ASSEMBLY AFTER ALL (P6b) ── */}
      {markUnit && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center sm:p-4">
          <div className="w-full max-w-md rounded-t-3xl bg-white p-6 shadow-2xl duration-200 animate-in slide-in-from-bottom-5 sm:rounded-2xl sm:zoom-in-95 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <Wrench className="h-5 w-5 text-amber-600" />
                <h2 className="text-base font-bold text-slate-900 dark:text-white">
                  {markUnit.unitCode} needs assembly
                </h2>
              </div>
              <button
                onClick={() => setMarkUnit(null)}
                aria-label="Close"
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-4 space-y-3 text-xs">
              <p className="leading-relaxed text-slate-600 dark:text-slate-400">
                This item is in a bin whose contents need no assembly, so it is kept off the build
                line and cannot be moved into a normal bin. Clearing that puts it back on the build
                line. It stays in this bin until you relocate it — and putting it into a no-assembly
                bin again marks it the same way.
              </p>

              {markError && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 font-medium text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
                  {markError}
                </div>
              )}

              <div>
                <label className="font-semibold text-slate-700 dark:text-slate-300">Why? *</label>
                <Input
                  autoFocus
                  placeholder="e.g. Put in the spares bin by mistake — it is a cycle"
                  value={markReason}
                  onChange={(e) => setMarkReason(e.target.value)}
                  className="mt-1 text-xs"
                />
              </div>

              <div className="flex justify-end gap-2 pt-1">
                <Button type="button" variant="outline" onClick={() => setMarkUnit(null)} className="h-9 text-xs">
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={confirmMarkAssemblable}
                  disabled={markSaving}
                  className="h-9 bg-amber-600 text-xs text-white hover:bg-amber-700"
                >
                  {markSaving ? "Saving…" : "Mark as needing assembly"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL 7: PRINTABLE LABELS (R46) ── */}
      {labelSheet && (
        <UnitLabelSheet
          unitIds={labelSheet.unitIds}
          binId={labelSheet.binId}
          heading={labelSheet.heading}
          onClose={() => setLabelSheet(null)}
        />
      )}
    </div>
  );
}
