// The shared contract between the /stock table (PC) and the compact card (phone) — plan
// 2109-stock-list-table-and-compact-cards. Both render the SAME product with the SAME labels,
// colours and actions; everything they must agree on lives here so the two layouts cannot drift.

import { isLowStock } from "@/lib/reorder";
import type { AssemblyLevelValue } from "@/lib/assembly-level";

export interface StockProduct {
  id: string;
  sku: string;
  name: string;
  status: string;
  currentStock: number;
  reorderLevel: number;
  sellingPrice: number;
  mrp: number;
  /** Omitted by the API for anyone without `cost_price.view` — see
   *  api/products/route.ts:100, where the select reads `costPrice: isAdmin`.
   *  Optional here because it genuinely is absent, not zero. */
  costPrice?: number;
  category: { name: string } | null;
  brand: { id: string; name: string } | null;
  bin: { code: string; location: string } | null;
  reorderQty: number;
  reorderVendorId: string | null;
  /** The product's one assembly condition level; null = the next Assign asks (plan 1509, D3). */
  assemblyLevel: AssemblyLevelValue | null;
  /**
   * Live units by condition (plan 1709, R10, P7) — counted from the units, in the scoped store
   * when there is one. All three are 0 for a product whose stock has no unit codes yet.
   */
  assembledUnits: number;
  unassembledUnits: number;
  noAssemblyUnits: number;
}

// The out-of-stock branch comes FIRST in all three, so "low" here means low AND still on the
// shelf. isLowStock alone does not say that — it is true at zero too — which is why the order
// of these branches is behaviour, not style.
export function stockColor(p: StockProduct) {
  if (p.currentStock <= 0) return "text-red-600";
  if (isLowStock(p)) return "text-yellow-600";
  return "text-green-600";
}

export function stockBadge(p: StockProduct) {
  if (p.currentStock <= 0) return { variant: "danger" as const, label: "Out" };
  if (isLowStock(p)) return { variant: "warning" as const, label: "Low" };
  return { variant: "success" as const, label: "OK" };
}

/** The left colour edge on a card, and the left edge of the first cell in a table row. */
export function stockAccent(p: StockProduct) {
  if (p.status === "INACTIVE") return "border-l-slate-200";
  if (p.currentStock <= 0) return "border-l-red-500";
  if (isLowStock(p)) return "border-l-amber-400";
  return "border-l-green-500";
}

export function formatInr(amount: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount);
}

/** True when the product has any live units — only then are the A / U figures meaningful. */
export function hasUnits(p: StockProduct) {
  return (p.assembledUnits ?? 0) + (p.unassembledUnits ?? 0) + (p.noAssemblyUnits ?? 0) > 0;
}

/** The server-side sorts the table offers (Q2a). Every value is in `ALLOWED_SORT`, api-utils.ts:99. */
export type StockSortKey = "name" | "sellingPrice" | "costPrice" | "currentStock";
export interface StockSort {
  sortBy: StockSortKey;
  sortOrder: "asc" | "desc";
}
export const DEFAULT_STOCK_SORT: StockSort = { sortBy: "currentStock", sortOrder: "desc" };

/**
 * Everything a row or card needs besides the product itself. The page owns the state; the
 * layouts only render and call back. `busyId` greys out the actions of the row being saved.
 */
export interface StockRowContext {
  showCost: boolean;
  selectMode: boolean;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  /** Where a row/card opens outside select mode: `/stock/[id]`. */
  hrefFor: (p: StockProduct) => string;
  busyId: string | null;
  mayReorder: boolean;
  mayAssemblyLevel: boolean;
  mayDeactivate: boolean;
  onReorder: (p: StockProduct) => void;
  onAssemblyLevel: (p: StockProduct) => void;
  onSetStatus: (p: StockProduct, status: "ACTIVE" | "INACTIVE") => void;
}
