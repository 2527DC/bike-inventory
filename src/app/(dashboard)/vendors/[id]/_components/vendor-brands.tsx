"use client";

import { useState, useEffect } from "react";
import { Star, Plus, X, Loader2, AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { apiFetch, apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";

const log = createLogger("vendors:brands-editor");

export interface VendorBrand {
  id: string;
  name: string;
  isPrimary: boolean;
}

interface Props {
  vendorId: string;
  vendorName: string;
  initial: VendorBrand[];
  canEdit: boolean;
  onSaved: (brands: VendorBrand[]) => void;
}

/**
 * Which brands this vendor supplies, and which of them it is the primary route for.
 *
 * ─── WHY THIS SCREEN IS THE POINT OF P10 ─────────────────────────────────────────────────
 *
 * `BrandVendor` had four readers — both ledger routes and both ledger screens — and no writer
 * at all. Nothing in the codebase could create a row: no seed, no import, no migration, no
 * route, no screen. Vendor resolution tiers 2 and 3 read that table, so without somewhere to
 * enter the data the whole derivation answers NO_VENDOR for every product and `/reorder`
 * refuses to raise a purchase order.
 *
 * So this is not a nice-to-have on a vendor page. It is the input side of the feature, and
 * until somebody uses it, P10 is inert.
 *
 * ─── THE STAR IS A BRAND-WIDE CLAIM, NOT A VENDOR-LOCAL ONE ──────────────────────────────
 *
 * "Primary" means "the usual billing route for THIS BRAND". Marking a brand primary here
 * CLEARS it on whichever other vendor held it — the server does that in one transaction,
 * because nothing in the database enforces it (there is no partial unique index) and a
 * vendor-scoped write cannot see the competing row. The response says how many were moved,
 * and that is surfaced rather than swallowed: quietly demoting another vendor is exactly the
 * kind of change somebody needs to be told about.
 */
export function VendorBrands({ vendorId, vendorName, initial, canEdit, onSaved }: Props) {
  const [brands, setBrands] = useState<VendorBrand[]>(initial);
  const [allBrands, setAllBrands] = useState<Array<{ id: string; label: string }>>([]);
  const [adding, setAdding] = useState(false);
  const [pick, setPick] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => setBrands(initial), [initial]);

  // Loaded when the picker opens, not on mount: most visits to a vendor page never touch it.
  useEffect(() => {
    if (!adding || allBrands.length > 0) return;
    apiTry<Array<{ id: string; name: string }>>("/api/brands").then(({ data, error: err }) => {
      if (data) setAllBrands(data.map((b) => ({ id: b.id, label: b.name })));
      else {
        log.warn("brand list unavailable", { message: err });
        setError("Could not load the brand list");
      }
    });
  }, [adding, allBrands.length]);

  async function save(next: VendorBrand[]) {
    setSaving(true);
    setError(null);
    setNote(null);
    try {
      const res = await apiFetch<{ brands: VendorBrand[]; clearedElsewhere: number }>(
        `/api/vendors/${vendorId}/brands`,
        { method: "PUT", json: { brands: next.map((b) => ({ brandId: b.id, isPrimary: b.isPrimary })) } }
      );
      setBrands(res.brands);
      onSaved(res.brands);
      if (res.clearedElsewhere > 0) {
        setNote(
          `${vendorName} is now the primary route for ${res.clearedElsewhere} brand${
            res.clearedElsewhere === 1 ? "" : "s"
          } that another vendor held.`
        );
      }
      log.info("vendor brands saved", { vendorId, count: res.brands.length });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Could not save";
      log.error("vendor brands save failed", { vendorId, message });
      setError(message);
      setBrands(initial); // put the chips back the way the server still has them
    } finally {
      setSaving(false);
    }
  }

  const addBrand = () => {
    if (!pick || brands.some((b) => b.id === pick)) return;
    const picked = allBrands.find((b) => b.id === pick);
    if (!picked) return;
    void save([...brands, { id: picked.id, name: picked.label, isPrimary: false }]);
    setPick(null);
    setAdding(false);
  };

  const available = allBrands.filter((b) => !brands.some((x) => x.id === b.id));

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-xs text-slate-500">Brands supplied</p>
        {canEdit && !adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            disabled={saving}
            className="text-xs text-blue-600 font-medium min-h-[32px] px-1 disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5 inline -mt-0.5" /> Add
          </button>
        )}
      </div>

      {brands.length === 0 && !adding && (
        <p className="text-sm text-slate-400">
          None yet.
          {canEdit
            ? " Adding them lets a purchase order work out its vendor from the product's brand."
            : ""}
        </p>
      )}

      {brands.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {brands.map((b) => (
            <span
              key={b.id}
              className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs ${
                b.isPrimary ? "border-amber-300 bg-amber-50 text-amber-900" : "border-slate-200 bg-slate-50 text-slate-700"
              }`}
            >
              {canEdit ? (
                <button
                  type="button"
                  disabled={saving}
                  title={b.isPrimary ? "Primary route for this brand" : "Make this the primary route for the brand"}
                  onClick={() =>
                    void save(brands.map((x) => (x.id === b.id ? { ...x, isPrimary: !x.isPrimary } : x)))
                  }
                  className="min-h-[24px] disabled:opacity-50"
                >
                  <Star className={`h-3.5 w-3.5 ${b.isPrimary ? "fill-amber-500 text-amber-500" : "text-slate-300"}`} />
                </button>
              ) : (
                b.isPrimary && <Star className="h-3.5 w-3.5 fill-amber-500 text-amber-500" />
              )}
              <span>{b.name}</span>
              {canEdit && (
                <button
                  type="button"
                  disabled={saving}
                  aria-label={`Remove ${b.name}`}
                  onClick={() => void save(brands.filter((x) => x.id !== b.id))}
                  className="min-h-[24px] text-slate-400 hover:text-red-600 disabled:opacity-50"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </span>
          ))}
          {saving && <Loader2 className="h-4 w-4 animate-spin text-slate-400 self-center" />}
        </div>
      )}

      {adding && (
        // overflow-visible matters: SearchableSelect renders its list as an absolutely
        // positioned child with no portal, so a scrolling parent would clip it.
        <div className="mt-2 space-y-2 overflow-visible">
          <SearchableSelect
            id={`vendor-${vendorId}-brand`}
            options={available}
            value={pick}
            onChange={setPick}
            placeholder="Search brands..."
            emptyText={allBrands.length === 0 ? "Loading..." : "All brands are already listed"}
            disabled={saving}
          />
          <div className="flex gap-2">
            <Button onClick={addBrand} disabled={!pick || saving} className="min-h-[44px]">
              Add
            </Button>
            <Button variant="outline" onClick={() => { setAdding(false); setPick(null); }} disabled={saving} className="min-h-[44px]">
              Cancel
            </Button>
          </div>
        </div>
      )}

      {note && (
        <p className="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">
          {note}
        </p>
      )}

      {error && (
        <p className="mt-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-2 flex items-start gap-1.5">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          {error}
        </p>
      )}

      {brands.length > 0 && !brands.some((b) => b.isPrimary) && (
        <p className="mt-2 text-[11px] text-slate-400">
          No primary set. With more than one vendor for a brand, a purchase order cannot work
          out which to use and will ask instead.
        </p>
      )}
    </div>
  );
}

export default VendorBrands;
