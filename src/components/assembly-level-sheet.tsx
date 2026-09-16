"use client";

import { useState, useEffect, useRef } from "react";
import { X, Loader2, AlertTriangle, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";
import { ASSEMBLY_LEVELS, type AssemblyLevelValue } from "@/lib/assembly-level";

const log = createLogger("stock:assembly-level-sheet");

export interface AssemblyLevelTarget {
  id: string;
  name: string;
  sku: string;
  assemblyLevel: AssemblyLevelValue | null;
}

export interface AssemblyLevelSaved {
  id: string;
  assemblyLevel: AssemblyLevelValue | null;
}

interface Props {
  open: boolean;
  product: AssemblyLevelTarget | null;
  onClose: () => void;
  onSaved: (updated: AssemblyLevelSaved) => void;
}

/**
 * Set a product's ONE assembly condition level (plan 1509-assembly-queue-single-bin-and-product-
 * assembly-level, E1/E3, D3/D4) — opened from the /stock row and the product details page.
 *
 * The level decides how every bicycle of this product is built. Once it is set, the Assign
 * modal on /assembly stops asking for it; "Not set" puts the question back there for the next
 * bicycle, which is how a wrong level gets undone.
 *
 * Same overlay shape as `reorder-sheet.tsx` (bottom sheet on a phone, centred card from `sm:`,
 * Escape closes, focus returns to the button that opened it) — deliberately not a new primitive;
 * see the note at the top of that file.
 */
export function AssemblyLevelSheet({ open, product, onClose, onSaved }: Props) {
  const [choice, setChoice] = useState<AssemblyLevelValue | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const firstRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<Element | null>(null);

  // Reset the pick whenever the sheet opens for a product, or that product's saved level
  // changes. Keyed on the id and the saved level, not the `product` object: the details page
  // builds that object inline on every render, and an object key would reset the person's pick
  // whenever the parent re-rendered while the sheet was open.
  //
  // Done DURING RENDER (React's "adjusting state when a prop changes"), not in an effect: an
  // effect that sets state paints the stale pick first and then renders again
  // (react-hooks/set-state-in-effect).
  const productId = product?.id;
  const savedLevel = product?.assemblyLevel ?? null;
  const resetKey = open && productId ? `${productId}:${savedLevel ?? ""}` : null;
  const [lastResetKey, setLastResetKey] = useState<string | null>(null);
  if (resetKey !== lastResetKey) {
    setLastResetKey(resetKey);
    if (resetKey) {
      setChoice(savedLevel);
      setError(null);
    }
  }

  useEffect(() => {
    if (!open) return;
    triggerRef.current = document.activeElement;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !saving) onClose();
    };
    document.addEventListener("keydown", onKey);
    firstRef.current?.focus();

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      (triggerRef.current as HTMLElement | null)?.focus?.();
    };
  }, [open, saving, onClose]);

  if (!open || !product) return null;

  const unchanged = choice === (product.assemblyLevel ?? null);

  async function handleSave() {
    if (!product || saving) return;
    setSaving(true);
    setError(null);
    const { data, error: err, status } = await apiTry<AssemblyLevelSaved>(
      `/api/products/${product.id}/assembly-level`,
      { method: "PUT", json: { level: choice } }
    );
    setSaving(false);
    if (err || !data) {
      log.error("assembly level save failed", { productId: product.id, status, message: err });
      setError(err || "Could not save the assembly level");
      return;
    }
    log.info("assembly level saved", { productId: product.id, level: data.assemblyLevel });
    onSaved(data);
    onClose();
  }

  const options: Array<{ value: AssemblyLevelValue | null; title: string; sub: string }> = [
    ...ASSEMBLY_LEVELS.map((l) => ({ value: l.value, title: l.percent, sub: l.description })),
    { value: null, title: "Not set", sub: "Ask at the next assign" },
  ];

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/40 sm:p-4"
      onClick={() => !saving && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Assembly level"
        className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl max-h-[88vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between p-4 border-b border-slate-100 shrink-0">
          <div className="pr-3 min-w-0">
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-1.5">
              <Wrench className="h-4 w-4 text-slate-500" /> Assembly level
            </h2>
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

        <div className="p-4 space-y-3 overflow-y-auto">
          <p className="text-xs text-slate-500">
            Every bicycle of this product is assigned at this level. The Assign screen on
            /assembly will not ask for it again.
          </p>

          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Assembly level">
            {options.map((o, i) => {
              const selected = choice === o.value;
              return (
                <button
                  key={o.value ?? "none"}
                  ref={i === 0 ? firstRef : undefined}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  disabled={saving}
                  onClick={() => setChoice(o.value)}
                  className={`min-h-[56px] rounded-lg border px-3 py-2 text-left transition-colors focus-ring disabled:opacity-50 ${
                    selected
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  <span className="block text-sm font-bold">{o.title}</span>
                  <span className={`block text-[11px] ${selected ? "text-slate-200" : "text-slate-500"}`}>
                    {o.sub}
                  </span>
                </button>
              );
            })}
          </div>

          {error && (
            <div className="flex items-start gap-2 p-3 rounded-lg border border-red-200 bg-red-50">
              <AlertTriangle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
              <p className="text-xs text-red-700 break-words">{error}</p>
            </div>
          )}
        </div>

        <div className="flex gap-2 p-4 border-t border-slate-100 shrink-0 pb-safe">
          <Button variant="outline" onClick={onClose} disabled={saving} className="flex-1 min-h-[44px]">
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || unchanged} className="flex-1 min-h-[44px]">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default AssemblyLevelSheet;
