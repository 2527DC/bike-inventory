"use client";

import { useState } from "react";
import { Wrench, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";
import { ASSEMBLY_LEVELS, assemblyLevelLabel, type AssemblyLevelValue } from "@/lib/assembly-level";
import type { Mechanic, PendingUnit } from "./types";

const log = createLogger("assembly:assign-modal");

interface AssignResult {
  assigned: number;
  assignedTo: { id: string; name: string };
  level: AssemblyLevelValue | null;
  levelSource: "product" | "saved-now";
  levelsSaved: Array<{ productId: string; productName: string; level: AssemblyLevelValue }>;
}

interface AssignModalProps {
  /** Every selected unit id — may include units not loaded on screen ("Select all N matching"). */
  unitIds: string[];
  /** The selected units that ARE loaded, for the summary and the level question. */
  units: PendingUnit[];
  mechanics: Mechanic[];
  onClose: () => void;
  onAssigned: (message: string) => void;
}

/**
 * Assign one or many bicycles to a mechanic (R9). The level is the PRODUCT's (plan 1509,
 * D3/D4): a product with a level is assigned at it; a product with none is asked once and the
 * answer is saved to it. The level starts EMPTY — never defaulted.
 */
export function AssignModal({ unitIds, units, mechanics, onClose, onAssigned }: AssignModalProps) {
  const [mechanicId, setMechanicId] = useState("");
  const [level, setLevel] = useState<AssemblyLevelValue | null>(null);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const single = unitIds.length === 1 ? units.find((u) => u.id === unitIds[0]) ?? null : null;
  const productsWithoutLevel = [
    ...new Map(units.filter((u) => !u.product.assemblyLevel).map((u) => [u.product.id, u.product])).values(),
  ];
  const unloaded = unitIds.length - units.length;
  const levelRequired = productsWithoutLevel.length > 0;
  // Units not on screen may still belong to a product with no level — offer the choice, and the
  // server refuses naming the products if it turns out to be needed.
  const levelOffered = levelRequired || unloaded > 0;

  const blockReason = !mechanicId
    ? "Choose a mechanic"
    : levelRequired && !level
    ? "Choose the assembly condition level"
    : "";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (blockReason || saving) return;
    setSaving(true);
    setError("");
    const { data, error: failed, status } = await apiTry<AssignResult>("/api/assembly/tasks", {
      method: "POST",
      json: {
        unitIds,
        assignedToId: mechanicId,
        // The server ignores the level for products that already have one (D4).
        ...(level ? { level } : {}),
        notes: notes.trim() || undefined,
      },
    });
    setSaving(false);

    if (failed || !data) {
      log.error("assign failed", { units: unitIds.length, assignedToId: mechanicId, status });
      setError(failed || "Failed to assign");
      return;
    }

    log.info("assigned", { units: data.assigned, assignedToId: mechanicId });
    const who = data.assignedTo?.name ?? "the mechanic";
    const saved =
      data.levelsSaved.length === 1
        ? ` — saved to ${data.levelsSaved[0].productName}, the next one won't ask.`
        : data.levelsSaved.length > 1
        ? ` — level saved to ${data.levelsSaved.length} products.`
        : ".";
    onAssigned(
      single
        ? `${single.unitCode} assigned to ${who}${data.level ? ` at ${assemblyLevelLabel(data.level)}` : ""}${saved}`
        : `${data.assigned} bicycles assigned to ${who}${saved}`
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
      <div className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 text-sm font-bold text-slate-900">
            <Wrench className="h-4 w-4 text-indigo-600" />
            {single ? "Assign Bicycle to Mechanic" : `Assign ${unitIds.length} Bicycles to a Mechanic`}
          </h3>
          <button type="button" onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-600">
            <X className="h-4 w-4" />
          </button>
        </div>

        {single ? (
          <div className="mt-2 rounded-xl bg-slate-50 p-3 text-xs">
            <span className="font-mono font-bold text-indigo-600">{single.unitCode}</span>
            <div className="font-semibold text-slate-900">{single.product.name}</div>
            <div className="text-[11px] text-slate-500">
              {single.product.brand.name} · Warehouse: {single.warehouse.code}
            </div>
          </div>
        ) : (
          <div className="mt-2 rounded-xl bg-slate-50 p-3 text-xs text-slate-700">
            <div className="font-semibold text-slate-900">{unitIds.length} bicycles selected</div>
            {units.length > 0 && (
              <div className="mt-0.5 line-clamp-2 font-mono text-[11px] text-slate-500">
                {units.slice(0, 8).map((u) => u.unitCode).join(", ")}
                {unitIds.length > 8 ? ` +${unitIds.length - 8} more` : ""}
              </div>
            )}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-4 space-y-3 text-xs">
          <div>
            <label htmlFor="assign-mechanic" className="mb-1 block font-semibold text-slate-700">
              Assign To Mechanic *
            </label>
            <select
              id="assign-mechanic"
              required
              value={mechanicId}
              onChange={(e) => setMechanicId(e.target.value)}
              className="min-h-[44px] w-full rounded-lg border border-slate-200 bg-white p-2.5 text-xs text-slate-800"
            >
              <option value="">Select mechanic...</option>
              {mechanics.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m.email})
                </option>
              ))}
            </select>
          </div>

          {single && single.product.assemblyLevel ? (
            <div className="rounded-lg border border-indigo-100 bg-indigo-50/60 p-2.5">
              <div className="font-semibold text-slate-700">
                Assembly condition level:{" "}
                <span className="text-indigo-700">{assemblyLevelLabel(single.product.assemblyLevel)}</span>{" "}
                <span className="font-normal text-slate-500">(product setting)</span>
              </div>
              <p className="mt-0.5 text-[10px] text-slate-500">Change it from Stock → product.</p>
            </div>
          ) : levelOffered ? (
            <div>
              <label className="mb-1 block font-semibold text-slate-700">
                Assembly Condition Level {levelRequired ? "*" : "(for products with no level)"}
              </label>
              <div className="grid grid-cols-3 gap-2">
                {ASSEMBLY_LEVELS.map((lvl) => (
                  <button
                    type="button"
                    key={lvl.value}
                    onClick={() => setLevel(lvl.value)}
                    aria-pressed={level === lvl.value}
                    className={`min-h-[44px] rounded-lg border p-2 text-center transition-all ${
                      level === lvl.value
                        ? "border-indigo-600 bg-indigo-50 text-indigo-900"
                        : "border-slate-200 text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    <div className="font-bold">{lvl.percent}</div>
                    <div className="text-[10px] text-slate-400">{lvl.description}</div>
                  </button>
                ))}
              </div>
              <p className="mt-1 text-[10px] text-slate-500">
                {single
                  ? <>Saved to this product — the next {single.product.name} won&apos;t ask.</>
                  : productsWithoutLevel.length > 0
                  ? `Saved to ${productsWithoutLevel.map((p) => p.name).slice(0, 3).join(", ")}${productsWithoutLevel.length > 3 ? ` and ${productsWithoutLevel.length - 3} more` : ""}. Products that already have a level keep it.`
                  : "Used only for a product that has no level yet. Products that have one keep it."}
              </p>
            </div>
          ) : (
            <div className="rounded-lg border border-indigo-100 bg-indigo-50/60 p-2.5 text-slate-700">
              Each bicycle is built at its product&apos;s level.
            </div>
          )}

          <div>
            <label className="mb-1 block font-semibold text-slate-700">Supervisor Notes (Optional)</label>
            <Input
              placeholder="e.g. Check disc brake alignment"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="min-h-[44px] text-xs"
            />
          </div>

          {error && <div className="rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-700">{error}</div>}

          <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
            {blockReason && !saving && <span className="mr-auto text-[10px] text-slate-500">{blockReason} to continue.</span>}
            <Button size="sm" type="button" variant="outline" onClick={onClose} className="min-h-[44px]">
              Cancel
            </Button>
            <Button
              size="sm"
              type="submit"
              disabled={saving || !!blockReason}
              className="min-h-[44px] bg-indigo-600 font-bold text-white hover:bg-indigo-700"
            >
              {saving ? "Assigning..." : single ? "Confirm & Move to ASM" : `Assign ${unitIds.length}`}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
