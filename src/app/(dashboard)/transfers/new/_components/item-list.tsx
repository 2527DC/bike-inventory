"use client";

import { Trash2, Package } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { LineBinPickers, type LineBins } from "../../_components/line-bin-pickers";
import type { TransferBinOptions } from "../../_components/use-bin-options";

export interface Product {
  id: string;
  name: string;
  sku: string;
  currentStock: number;
}

/**
 * One line of the order. `key` is stable for the line's life: since a product can be split across
 * bins (plan 0310, Part C), two lines may carry the same product, so the product id is no key.
 */
export interface TransferItem extends LineBins {
  key: string;
  product: Product;
  quantity: number;
}

interface Props {
  items: TransferItem[];
  /** Per line, the most it may ask for: what its from-bin holds less the other lines on that bin. */
  limits: number[];
  options: TransferBinOptions | null;
  optionsLoading: boolean;
  routeReady: boolean;
  sourceName?: string;
  destinationName?: string;
  /** True while the order is being submitted — no line may change mid-flight. */
  disabled: boolean;
  onQuantityChange: (index: number, quantity: number) => void;
  onBinChange: (index: number, patch: Partial<LineBins>) => void;
  onSplit: (index: number) => void;
  onRemove: (index: number) => void;
}

/** The lines of the order — product, quantity, and the bin each leaves from and goes to. */
export function ItemList({
  items,
  limits,
  options,
  optionsLoading,
  routeReady,
  sourceName,
  destinationName,
  disabled,
  onQuantityChange,
  onBinChange,
  onSplit,
  onRemove,
}: Props) {
  if (items.length === 0) {
    return (
      <div className="text-center py-8 border-2 border-dashed border-slate-200 rounded-lg mb-4">
        <Package className="h-8 w-8 text-slate-300 mx-auto mb-2" />
        <p className="text-sm text-slate-400">Search and add items to transfer</p>
      </div>
    );
  }

  return (
    <div className="space-y-3 mb-4">
      <p className="text-xs font-medium text-slate-500">{items.length} line{items.length !== 1 ? "s" : ""} to transfer</p>
      {items.map((item, index) => {
        const max = limits[index] ?? item.product.currentStock;
        return (
          <Card key={item.key} className="border-purple-100">
            <CardContent className="p-3">
              <div className="flex items-start justify-between mb-2">
                <div className="flex-1 min-w-0 mr-2">
                  <p className="text-sm font-medium text-slate-900">{item.product.name}</p>
                  <p className="text-xs text-slate-500 tabular-nums">{item.product.sku} | Stock: {item.product.currentStock}</p>
                </div>
                <button type="button" onClick={() => onRemove(index)} disabled={disabled} aria-label={`Remove ${item.product.name}`}
                  className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg hover:bg-red-50 text-red-400 hover:text-red-600 disabled:opacity-30 focus-ring">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>

              <label className="text-xs text-slate-500 mb-0.5 block">Qty</label>
              <div className="flex items-center gap-2">
                <button type="button"
                  onClick={() => onQuantityChange(index, Math.max(1, item.quantity - 1))}
                  disabled={disabled || item.quantity <= 1}
                  aria-label="Decrease quantity"
                  className="h-11 w-11 rounded-lg border border-slate-300 bg-white text-slate-700 text-lg font-bold flex items-center justify-center disabled:opacity-30 focus-ring">
                  −
                </button>
                <span className="h-11 min-w-[3rem] rounded-lg border border-slate-200 bg-slate-50 flex items-center justify-center text-sm font-semibold text-slate-900 tabular-nums">
                  {item.quantity}
                </span>
                <button type="button"
                  onClick={() => onQuantityChange(index, Math.min(Math.max(1, max), item.quantity + 1))}
                  disabled={disabled || item.quantity >= max}
                  aria-label="Increase quantity"
                  className="h-11 w-11 rounded-lg border border-purple-300 bg-purple-50 text-purple-700 text-lg font-bold flex items-center justify-center disabled:opacity-30 focus-ring">
                  +
                </button>
                <span className="text-[11px] text-slate-400 tabular-nums">/ {max}</span>
              </div>
              {item.quantity > max && (
                <p className="text-xs text-red-600 mt-1">
                  {max === 0 ? "Nothing left in this bin for this line" : `Only ${max} available here`}
                </p>
              )}

              <LineBinPickers
                productId={item.product.id}
                lineKey={item.key}
                choice={item}
                options={options}
                loading={optionsLoading}
                routeReady={routeReady}
                sourceName={sourceName}
                destinationName={destinationName}
                disabled={disabled}
                onChange={(patch) => onBinChange(index, patch)}
                onSplit={() => onSplit(index)}
              />
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
