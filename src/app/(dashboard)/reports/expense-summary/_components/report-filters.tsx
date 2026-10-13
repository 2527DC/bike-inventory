"use client";

import { useState } from "react";
import { SlidersHorizontal, X } from "lucide-react";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { CATEGORY_LABELS, CATEGORY_ORDER } from "@/app/(dashboard)/expenses/new/_components/types";
import type { ExpenseCategory } from "@/types";
import { GROUP_BY_LABELS, type ExpenseSummary, type GroupBy, type ReportFilters } from "./types";

type Options = ExpenseSummary["options"];

interface Props {
  filters: ReportFilters;
  /** Last options the API sent; null before the first answer (the pickers wait for it). */
  options: Options | null;
  /** Name for a store/payer key the options no longer list (e.g. tapped from a group row). */
  labelFor: (dim: GroupBy, key: string) => string;
  onChange: (patch: Partial<ReportFilters>) => void;
}

const SELECT_CLASS =
  "h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900 disabled:opacity-50";

/**
 * Store, category and who-paid filters. The active ones always show as removable chips; the
 * pickers sit behind a "Filters" button so a phone sees the total first. Tapping a group row
 * is the other way in — it lands here as a chip.
 */
export function FilterBar({ filters, options, labelFor, onChange }: Props) {
  const [open, setOpen] = useState(false);

  const chips: { dim: GroupBy; key: string }[] = [
    filters.payer ? { dim: "payer" as const, key: filters.payer } : null,
    filters.storeId ? { dim: "store" as const, key: filters.storeId } : null,
    filters.category ? { dim: "category" as const, key: filters.category } : null,
  ].filter((c): c is { dim: GroupBy; key: string } => c !== null);

  const clear = (dim: GroupBy) =>
    onChange(dim === "payer" ? { payer: null } : dim === "store" ? { storeId: null } : { category: null });

  // A filter the window no longer lists (a store since deactivated, a payer outside the new
  // dates) is kept as an option so the picker still shows what is applied.
  const stores = options?.stores ?? [];
  const storeMissing = filters.storeId && filters.storeId !== "none" && !stores.some((s) => s.id === filters.storeId);
  const payerOptions = (options?.payers ?? []).map((p) => ({ id: p.key, label: p.label }));
  if (filters.payer && !payerOptions.some((p) => p.id === filters.payer)) {
    payerOptions.unshift({ id: filters.payer, label: labelFor("payer", filters.payer) });
  }

  return (
    <div className="mb-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls="expense-report-filters"
          className="flex min-h-[44px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:border-slate-400 focus-ring"
        >
          <SlidersHorizontal className="h-4 w-4" />
          Filters
          {chips.length > 0 && (
            <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-blue-600 px-1 text-[10px] font-semibold text-white">
              {chips.length}
            </span>
          )}
        </button>
        {chips.map((c) => (
          <button
            key={c.dim}
            type="button"
            onClick={() => clear(c.dim)}
            aria-label={`Remove filter ${GROUP_BY_LABELS[c.dim]}: ${labelFor(c.dim, c.key)}`}
            className="flex min-h-[44px] max-w-full items-center gap-1 rounded-full bg-slate-900 pl-3 pr-2 text-xs font-medium text-white focus-ring"
          >
            <span className="truncate">
              <span className="text-slate-300">{GROUP_BY_LABELS[c.dim]}:</span> {labelFor(c.dim, c.key)}
            </span>
            <X className="h-4 w-4 shrink-0" />
          </button>
        ))}
      </div>

      {open && (
        <div id="expense-report-filters" className="mt-2 space-y-3 rounded-xl border border-slate-200 bg-white p-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-500">Store</span>
              <select
                className={SELECT_CLASS}
                value={filters.storeId ?? ""}
                disabled={!options}
                onChange={(e) => onChange({ storeId: e.target.value || null })}
              >
                <option value="">All stores</option>
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
                {storeMissing && <option value={filters.storeId!}>{labelFor("store", filters.storeId!)}</option>}
                <option value="none">No store</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-500">Category</span>
              <select
                className={SELECT_CLASS}
                value={filters.category ?? ""}
                onChange={(e) => onChange({ category: e.target.value || null })}
              >
                <option value="">All categories</option>
                {CATEGORY_ORDER.map((c) => (
                  <option key={c} value={c}>{CATEGORY_LABELS[c].label}</option>
                ))}
              </select>
            </label>
          </div>
          {/* A div, not a wrapping label: the picker's own buttons (clear, options) sit inside it. */}
          <div>
            <label htmlFor="expense-report-payer" className="mb-1 block text-xs font-medium text-slate-500">
              Who paid
            </label>
            <SearchableSelect
              id="expense-report-payer"
              options={payerOptions}
              value={filters.payer}
              onChange={(key) => onChange({ payer: key })}
              placeholder={options ? "Anyone — search a name" : "Loading names…"}
              emptyText="Nobody paid in these dates"
              disabled={!options}
            />
          </div>
        </div>
      )}
    </div>
  );
}

/** Category key → its label, for chips. Unknown values (a hand-edited URL) read as typed. */
export function categoryLabel(key: string): string {
  return CATEGORY_LABELS[key as ExpenseCategory]?.label ?? key.replace(/_/g, " ");
}
