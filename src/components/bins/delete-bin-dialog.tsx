"use client";

import { useState } from "react";
import { ArrowRightLeft, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";

const log = createLogger("bins:delete-dialog");

export interface DeletableBin {
  id: string;
  code: string;
  name: string;
  warehouse: { name: string };
  /** Live units on the shelf — from `GET /api/bins` (R5). Loose stock is checked by the server. */
  unitCounts?: { total: number };
  _count?: { homeBinRules?: number };
}

interface Props {
  bin: DeletableBin;
  onClose: () => void;
  /** The bin was deleted; the parent refreshes its list. */
  onDeleted: () => void;
  /** Open the move-everything sheet for this bin. Absent when the person cannot move items. */
  onMoveOut?: () => void;
}

/**
 * Delete a bin — plan 0310-bin-delete-multi-category-rules-and-transfer-directions, Part A (R1–R4).
 *
 * The screen's count decides what is OFFERED (a bin with items gets "Move everything out", not a
 * Delete button), but the server decides what HAPPENS: it also counts loose stock, second-hand
 * cycles and unfinished audits the list does not carry, and its refusal is shown word for word.
 */
export function DeleteBinDialog({ bin, onClose, onDeleted, onMoveOut }: Props) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  const items = bin.unitCounts?.total ?? 0;
  const rules = bin._count?.homeBinRules ?? 0;

  async function confirmDelete() {
    setDeleting(true);
    setError("");
    const { data, error: err } = await apiTry<{ rulesRemoved: number; productsCleared: number }>(
      `/api/bins/${bin.id}`,
      { method: "DELETE" }
    );
    setDeleting(false);
    if (err) {
      log.warn("bin delete refused", { binId: bin.id, message: err });
      setError(err);
      return;
    }
    log.info("bin deleted", { binId: bin.id, rulesRemoved: data?.rulesRemoved, productsCleared: data?.productsCleared });
    onDeleted();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center sm:p-4">
      <div className="w-full max-w-md rounded-t-3xl bg-white p-6 shadow-2xl duration-200 animate-in slide-in-from-bottom-5 sm:rounded-2xl sm:zoom-in-95 dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <Trash2 className="h-5 w-5 text-red-600" />
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">Delete bin {bin.code}</h2>
              <p className="text-[11px] text-slate-500">
                {bin.name} · {bin.warehouse.name}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-4 space-y-3 text-xs">
          {items > 0 ? (
            <p className="leading-relaxed text-slate-700 dark:text-slate-300">
              Bin <strong>{bin.code}</strong> still holds <strong>{items}</strong> item{items === 1 ? "" : "s"}. A bin
              can only be deleted when it is empty — move everything to another bin first.
            </p>
          ) : (
            <p className="leading-relaxed text-slate-700 dark:text-slate-300">
              Delete bin <strong>{bin.code}</strong>?{" "}
              {rules > 0 ? (
                <>
                  Its <strong>{rules}</strong> home-bin rule{rules === 1 ? " is" : "s are"} removed with it,
                </>
              ) : (
                <>It has no home-bin rules,</>
              )}{" "}
              and products that use it as their default bin lose it. Its movement history is kept, and creating a
              bin with code {bin.code} again brings it back.
            </p>
          )}

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 font-medium text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
              {error}
            </div>
          )}

          <div className="flex flex-wrap justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={onClose} disabled={deleting} className="h-9 text-xs">
              Cancel
            </Button>
            {onMoveOut && (items > 0 || error) && (
              <Button
                type="button"
                variant="outline"
                onClick={onMoveOut}
                disabled={deleting}
                className="h-9 gap-1.5 text-xs text-indigo-700"
              >
                <ArrowRightLeft className="h-3.5 w-3.5" /> Move everything out
              </Button>
            )}
            {items === 0 && (
              <Button
                type="button"
                onClick={confirmDelete}
                disabled={deleting}
                className="h-9 bg-red-600 text-xs text-white hover:bg-red-700"
              >
                {deleting ? "Deleting…" : "Delete bin"}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
