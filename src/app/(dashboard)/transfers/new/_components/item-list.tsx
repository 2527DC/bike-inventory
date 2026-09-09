"use client";

import { Trash2, Package } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export interface Product {
  id: string;
  name: string;
  sku: string;
  currentStock: number;
}

export interface TransferItem {
  product: Product;
  quantity: number;
}

interface Props {
  items: TransferItem[];
  /** True while the order is being submitted — no line may change mid-flight. */
  disabled: boolean;
  onQuantityChange: (index: number, quantity: number) => void;
  onRemove: (index: number) => void;
}

/** The lines of the order — product and quantity only. The lane lives on the route card. */
export function ItemList({ items, disabled, onQuantityChange, onRemove }: Props) {
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
      <p className="text-xs font-medium text-slate-500">{items.length} item{items.length !== 1 ? "s" : ""} to transfer</p>
      {items.map((item, index) => (
        <Card key={item.product.id} className="border-purple-100">
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
                onClick={() => onQuantityChange(index, Math.min(item.product.currentStock, item.quantity + 1))}
                disabled={disabled || item.quantity >= item.product.currentStock}
                aria-label="Increase quantity"
                className="h-11 w-11 rounded-lg border border-purple-300 bg-purple-50 text-purple-700 text-lg font-bold flex items-center justify-center disabled:opacity-30 focus-ring">
                +
              </button>
              <span className="text-[11px] text-slate-400 tabular-nums">/ {item.product.currentStock}</span>
            </div>
            {item.quantity > item.product.currentStock && (
              <p className="text-xs text-red-600 mt-1">Exceeds available stock</p>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
