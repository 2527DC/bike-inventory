"use client";

import { useId, useState } from "react";
import { Search } from "lucide-react";
import { cn, fuzzyMatch } from "@/lib/utils";
import type { CategoryTreeRow } from "@/lib/categories/tree";

/**
 * A searchable CHECKLIST of leaf categories — plan 0310-bin-delete-multi-category-rules-and-
 * transfer-directions, R5, Q4 (the home-bin rule form).
 *
 * Only categories a rule may name are listed: active, with no active children (P13). So the
 * root → subcategory two-step of `CategoryTreeSelect` is not needed here, and "choose a
 * subcategory" cannot be got wrong — a parent is never offered. Each row carries its full path,
 * because a leaf's own name ("16 inch") is ambiguous across parents.
 *
 * The search is `CategoryTreeSelect`'s: substring first, fuzzy only when nothing matched
 * literally. "Select all shown" ticks exactly the filtered rows, so "kids" + Select all ticks every
 * kids size and nothing else. It fetches nothing; the parent owns loading and errors.
 */

export interface CategoryMultiSelectRow extends CategoryTreeRow {
  isActive?: boolean;
}

interface Props {
  categories: CategoryMultiSelectRow[];
  value: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  className?: string;
  emptyText?: string;
}

interface LeafOption {
  id: string;
  name: string;
  path: string;
}

/** Module level and pure, like `buildOptions` in category-tree-select, so the compiler memoizes it. */
function leafOptions(categories: CategoryMultiSelectRow[]): LeafOption[] {
  const active = categories.filter((c) => c.isActive !== false);
  const byId = new Map(active.map((c) => [c.id, c]));
  const parents = new Set(active.filter((c) => c.parentId).map((c) => c.parentId as string));

  const pathOf = (row: CategoryMultiSelectRow): string => {
    const names = [row.name];
    const seen = new Set([row.id]);
    let parent = row.parentId ? byId.get(row.parentId) : undefined;
    while (parent && !seen.has(parent.id)) {
      names.unshift(parent.name);
      seen.add(parent.id);
      parent = parent.parentId ? byId.get(parent.parentId) : undefined;
    }
    return names.join(" › ");
  };

  return active
    .filter((c) => !parents.has(c.id))
    .map((c) => ({ id: c.id, name: c.name, path: pathOf(c) }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

function filterLeaves(options: LeafOption[], query: string): LeafOption[] {
  const q = query.trim().toLowerCase();
  if (!q) return options;
  const literal = options.filter((o) => o.path.toLowerCase().includes(q));
  if (literal.length > 0) return literal;
  return options.filter((o) => fuzzyMatch(query, o.name) || fuzzyMatch(query, o.path));
}

export function CategoryMultiSelect({
  categories,
  value,
  onChange,
  disabled = false,
  className,
  emptyText = "No matching category",
}: Props) {
  const [query, setQuery] = useState("");
  const searchId = useId();

  const options = leafOptions(categories);
  const shown = filterLeaves(options, query);
  const selected = new Set(value);
  const allShownSelected = shown.length > 0 && shown.every((o) => selected.has(o.id));

  function toggle(id: string) {
    onChange(selected.has(id) ? value.filter((v) => v !== id) : [...value, id]);
  }

  function selectAllShown() {
    const next = new Set(value);
    for (const o of shown) next.add(o.id);
    onChange([...next]);
  }

  function clearShown() {
    const drop = new Set(shown.map((o) => o.id));
    onChange(value.filter((v) => !drop.has(v)));
  }

  return (
    <div className={cn("rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900", className)}>
      <div className="relative border-b border-slate-100 p-2 dark:border-slate-800">
        <label htmlFor={searchId} className="sr-only">
          Search categories
        </label>
        <Search className="pointer-events-none absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
        <input
          id={searchId}
          type="text"
          autoComplete="off"
          placeholder="Search categories…"
          value={query}
          disabled={disabled}
          onChange={(e) => setQuery(e.target.value)}
          className="h-10 w-full rounded-md border border-slate-200 bg-slate-50 pl-8 pr-3 text-xs text-slate-900 focus:border-indigo-500 focus:bg-white focus:outline-none disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-1.5 text-[11px] dark:border-slate-800">
        <span className="font-semibold text-slate-600 dark:text-slate-300">
          {value.length} selected
          {query.trim() && <span className="font-normal text-slate-400"> · {shown.length} shown</span>}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={selectAllShown}
            disabled={disabled || shown.length === 0 || allShownSelected}
            className="min-h-[32px] rounded px-2 font-medium text-indigo-600 hover:bg-indigo-50 disabled:opacity-40 dark:text-indigo-400 dark:hover:bg-indigo-950/40"
          >
            Select all shown
          </button>
          <button
            type="button"
            onClick={clearShown}
            disabled={disabled || !shown.some((o) => selected.has(o.id))}
            className="min-h-[32px] rounded px-2 font-medium text-slate-500 hover:bg-slate-100 disabled:opacity-40 dark:hover:bg-slate-800"
          >
            Clear
          </button>
        </div>
      </div>

      <div role="group" aria-label="Categories" className="max-h-56 overflow-y-auto">
        {shown.length === 0 ? (
          <p className="p-3 text-center text-xs text-slate-400">{options.length === 0 ? "No categories loaded" : emptyText}</p>
        ) : (
          shown.map((o) => (
            <label
              key={o.id}
              className={cn(
                "flex min-h-[40px] cursor-pointer items-center gap-2.5 border-b border-slate-50 px-3 py-1.5 text-xs last:border-b-0 hover:bg-slate-50 dark:border-slate-800/60 dark:hover:bg-slate-800/50",
                selected.has(o.id) && "bg-indigo-50/60 dark:bg-indigo-950/30"
              )}
            >
              <input
                type="checkbox"
                checked={selected.has(o.id)}
                disabled={disabled}
                onChange={() => toggle(o.id)}
                className="h-4 w-4 shrink-0 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              />
              <span className="min-w-0 break-words text-slate-800 dark:text-slate-200">{o.path}</span>
            </label>
          ))
        )}
      </div>
    </div>
  );
}

export default CategoryMultiSelect;
