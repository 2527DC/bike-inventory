"use client";

import { useState, useEffect, useRef } from "react";
import { X, Loader2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { apiFetch, apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";

const log = createLogger("stock:reorder-sheet");

export interface ReorderTarget {
  id: string;
  name: string;
  sku: string;
  currentStock: number;
  reorderLevel: number;
  reorderQty?: number;
  reorderVendorId?: string | null;
}

export interface ReorderSaved {
  id: string;
  reorderLevel: number;
  reorderQty: number;
  reorderVendorId: string | null;
}

interface Props {
  open: boolean;
  product: ReorderTarget | null;
  onClose: () => void;
  onSaved: (updated: ReorderSaved) => void;
}

/**
 * Set a product's reorder level, quantity and vendor without opening the product.
 *
 * ─── WHY THIS IS NOT BUILT ON A SHARED PRIMITIVE ─────────────────────────────────────────
 *
 * The plan called for a new `ui/bottom-sheet.tsx` built by lifting a focus trap out of
 * `filter-sheet.tsx`. Two things were wrong with that (owner, 6 Sep): `filter-sheet` has no
 * focus trap — nothing in this repo does — and it is a right-hand DRAWER used by twelve
 * screens, so it is neither the layout wanted here nor a safe thing to refactor for one
 * feature. Meanwhile the repo already carries fifteen overlay sites across four named
 * components and three layout shapes, so adding a primitive that migrates none of them simply
 * makes it five.
 *
 * So this reuses the shape `customers/_components/customer-edit-sheet.tsx` already proved —
 * bottom sheet on a phone, centred card from `sm:` — and adds the two things that file is
 * missing: `pb-safe` and focus RETURN. Collapsing the fifteen is its own phase.
 *
 * Still no focus trap, deliberately and consistently with every other overlay here; adding one
 * to this sheet alone would make it the odd one out rather than fix anything.
 */
export function ReorderSheet({ open, product, onClose, onSaved }: Props) {
  const [level, setLevel] = useState("0");
  const [qty, setQty] = useState("0");
  const [vendorId, setVendorId] = useState<string | null>(null);
  const [vendors, setVendors] = useState<Array<{ id: string; label: string; hint?: string }>>([]);
  const [vendorsDenied, setVendorsDenied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const panelRef = useRef<HTMLDivElement>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<Element | null>(null);

  useEffect(() => {
    if (!open || !product) return;
    setLevel(String(product.reorderLevel ?? 0));
    setQty(String(product.reorderQty ?? 0));
    setVendorId(product.reorderVendorId ?? null);
    setError(null);
  }, [open, product]);

  // The vendor list is fetched when the sheet first opens, not on mount: /stock renders this
  // for a row at a time, and a list of every vendor on page load is a request nobody asked for.
  useEffect(() => {
    if (!open || vendors.length > 0 || vendorsDenied) return;

    // limit=500 is the cap parseSearchParams enforces (api-utils.ts:67-85); asking for more
    // silently yields 500 anyway, so the number is written honestly.
    apiTry<Array<{ id: string; name: string; code: string; city: string | null }>>(
      "/api/vendors?limit=500"
    ).then(({ data, error: err }) => {
      if (data) {
        setVendors(
          data.map((v) => ({
            id: v.id,
            label: v.name,
            hint: [v.code, v.city].filter(Boolean).join(" · "),
          }))
        );
        return;
      }
      // A role can hold reorder.edit without vendors.view. That is not an error worth showing:
      // the level and quantity are still worth saving, so the picker is hidden with a note and
      // the save goes ahead without touching the vendor.
      log.warn("vendor list unavailable, hiding the picker", { message: err });
      setVendorsDenied(true);
    });
  }, [open, vendors.length, vendorsDenied]);

  useEffect(() => {
    if (!open) return;
    triggerRef.current = document.activeElement;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !saving) onClose();
    };
    document.addEventListener("keydown", onKey);
    firstFieldRef.current?.focus();
    firstFieldRef.current?.select();

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      // Focus RETURN — back to the row button that opened this. customer-edit-sheet does not
      // do it and should; without it a keyboard user lands at the top of the document.
      (triggerRef.current as HTMLElement | null)?.focus?.();
    };
  }, [open, saving, onClose]);

  if (!open || !product) return null;

  const levelNum = Number(level);
  const qtyNum = Number(qty);
  const numbersValid =
    Number.isInteger(levelNum) && levelNum >= 0 && Number.isInteger(qtyNum) && qtyNum >= 0;
  const canSave = numbersValid && !saving;

  async function handleSave() {
    if (!canSave || !product) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await apiFetch<ReorderSaved>(`/api/products/${product.id}/reorder`, {
        method: "PUT",
        json: {
          reorderLevel: levelNum,
          reorderQty: qtyNum,
          // Sent only when the picker was actually available. Sending null from a screen that
          // could not show the vendor would CLEAR a vendor the person never saw.
          ...(vendorsDenied ? {} : { reorderVendorId: vendorId }),
        },
      });
      log.info("reorder settings saved", { productId: product.id, level: levelNum, qty: qtyNum });
      onSaved(updated);
      onClose();
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to save";
      log.error("reorder save failed", { productId: product.id, message });
      setError(message);
    } finally {
      setSaving(false);
    }
  }

  const label = "block text-[10px] font-medium text-slate-500 uppercase tracking-wide mb-1";
  const input =
    "w-full min-h-[44px] rounded-lg border border-slate-300 px-3 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500";

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/40 sm:p-4"
      onClick={() => !saving && onClose()}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Reorder settings"
        className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl max-h-[88vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between p-4 border-b border-slate-100 shrink-0">
          <div className="pr-3 min-w-0">
            <h2 className="text-base font-bold text-slate-900 truncate">Reorder settings</h2>
            <p className="text-xs text-slate-500 mt-0.5 truncate">
              {product.name} · {product.sku}
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={saving}
            aria-label="Close"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center -mr-2 -mt-2 text-slate-400 hover:text-slate-600 disabled:opacity-50"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* overflow-visible, NOT overflow-y-auto: SearchableSelect renders its list as an
            absolutely positioned child with no portal, so a scrolling container clips it.
            This sheet is short enough not to need scrolling. */}
        <div className="p-4 space-y-4 overflow-visible">
          <p className="text-xs text-slate-500">
            In stock now:{" "}
            <span className="font-semibold text-slate-900">{product.currentStock}</span>
          </p>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label} htmlFor="reorder-level">
                Reorder level
              </label>
              <input
                id="reorder-level"
                ref={firstFieldRef}
                type="number"
                inputMode="numeric"
                min={0}
                value={level}
                onChange={(e) => setLevel(e.target.value)}
                className={input}
              />
              <p className="text-[10px] text-slate-400 mt-1">0 turns low-stock alerts off</p>
            </div>
            <div>
              <label className={label} htmlFor="reorder-qty">
                Reorder qty
              </label>
              <input
                id="reorder-qty"
                type="number"
                inputMode="numeric"
                min={0}
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                className={input}
              />
              <p className="text-[10px] text-slate-400 mt-1">0 = order up to the level</p>
            </div>
          </div>

          {vendorsDenied ? (
            <p className="text-xs text-slate-400">
              You do not have access to the vendor list, so the reorder vendor is left unchanged.
            </p>
          ) : (
            <div>
              <label className={label} htmlFor="reorder-vendor">
                Reorder vendor
              </label>
              <SearchableSelect
                id="reorder-vendor"
                options={vendors}
                value={vendorId}
                onChange={setVendorId}
                placeholder="Search vendors..."
                emptyText="No vendors match"
                disabled={saving}
              />
            </div>
          )}

          {!numbersValid && (
            <p className="text-xs text-amber-600">
              Reorder level and quantity must be whole numbers, zero or more.
            </p>
          )}

          {error && (
            <div className="flex items-start gap-2 p-3 rounded-lg border border-red-200 bg-red-50">
              <AlertTriangle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
              <p className="text-xs text-red-700 break-words">{error}</p>
            </div>
          )}
        </div>

        <div className="flex gap-2 p-4 border-t border-slate-100 shrink-0 pb-safe">
          <Button
            variant="outline"
            onClick={onClose}
            disabled={saving}
            className="flex-1 min-h-[44px]"
          >
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!canSave} className="flex-1 min-h-[44px]">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default ReorderSheet;
