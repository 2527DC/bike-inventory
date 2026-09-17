"use client";

import * as React from "react";
import { useEffect, useId, useRef, useState } from "react";
import { X } from "lucide-react";
import { cn, fuzzyMatch } from "@/lib/utils";
import {
  buildCategoryTree,
  descendantIds,
  flattenCategoryTree,
  type CategoryTreeRow,
} from "@/lib/categories/tree";

/**
 * Searchable category picker that shows the tree — plan 1709 Part I (R43, P13).
 *
 * The look and the keyboard/screen-reader contract are `components/ui/searchable-select.tsx`'s,
 * copied rather than wrapped: that component renders a flat list of `{label, hint}` and has no
 * slot for indentation, and bending it to carry depth would change every one of its callers.
 *
 * Unfiltered, the list is the tree in pre-order — each parent followed by its children, indented.
 * While searching, the list is every matching row with its full path as the hint, because a
 * child found by name alone ("Kids") is ambiguous without the parent it sits under.
 *
 * It fetches nothing; the parent owns loading and errors (same rule as SearchableSelect).
 */

export interface CategoryTreeSelectRow extends CategoryTreeRow {
  isActive?: boolean;
}

export type CategoryTreeSelectMode = "any" | "roots" | "childrenOf";

interface CategoryTreeSelectProps {
  /** Flat rows; the tree is built here from `parentId`. */
  categories: CategoryTreeSelectRow[];
  value: string | null;
  onChange: (id: string | null) => void;
  placeholder?: string;
  /**
   * `any` — every row, as a tree (default).
   * `roots` — top-level rows only (the rule form's first select).
   * `childrenOf` — everything under `parentId`, not `parentId` itself (the rule form's second select).
   */
  mode?: CategoryTreeSelectMode;
  /** Required by `childrenOf`; ignored otherwise. With no parent the list is empty. */
  parentId?: string | null;
  /** Show the X and let an emptied field mean "none". Default true. */
  allowClear?: boolean;
  /** Rows to leave out, with their whole subtree — e.g. a category and its descendants in its own parent picker. */
  excludeIds?: string[];
  emptyText?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
  name?: string;
}

interface PickerOption {
  id: string;
  name: string;
  depth: number;
  path: string;
  inactive: boolean;
}

/** Module level and pure so the React Compiler memoizes the call (see SearchableSelect). */
function buildOptions(
  categories: CategoryTreeSelectRow[],
  mode: CategoryTreeSelectMode,
  parentId: string | null | undefined,
  excludeIds: string[] | undefined
): PickerOption[] {
  let rows = categories;
  if (excludeIds && excludeIds.length > 0) {
    const excluded = new Set<string>();
    for (const id of excludeIds) for (const d of descendantIds(categories, id)) excluded.add(d);
    rows = rows.filter((r) => !excluded.has(r.id));
  }

  const byId = new Map(categories.map((r) => [r.id, r]));
  const pathOf = (row: CategoryTreeSelectRow): string => {
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

  if (mode === "roots") {
    const ids = new Set(categories.map((r) => r.id));
    rows = rows.filter((r) => !r.parentId || !ids.has(r.parentId));
  } else if (mode === "childrenOf") {
    if (!parentId) return [];
    const under = descendantIds(categories, parentId);
    under.delete(parentId);
    // Their parent is filtered out, so the direct children become depth-0 roots below.
    rows = rows.filter((r) => under.has(r.id));
  }

  return flattenCategoryTree(buildCategoryTree(rows)).map((node) => ({
    id: node.id,
    name: node.name,
    depth: node.depth,
    path: pathOf(node),
    inactive: node.isActive === false,
  }));
}

function filterOptions(options: PickerOption[], query: string): PickerOption[] {
  const q = query.trim().toLowerCase();
  if (!q) return options;
  const literal = options.filter(
    (o) => o.name.toLowerCase().includes(q) || o.path.toLowerCase().includes(q)
  );
  if (literal.length > 0) return literal;
  return options.filter((o) => fuzzyMatch(query, o.name) || fuzzyMatch(query, o.path));
}

export function CategoryTreeSelect({
  categories,
  value,
  onChange,
  placeholder = "Search category...",
  mode = "any",
  parentId,
  allowClear = true,
  excludeIds,
  emptyText = "No matching category",
  disabled = false,
  className,
  id,
  name,
}: CategoryTreeSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);

  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const reactId = useId();
  const listId = `${reactId}-list`;
  const optionId = (index: number) => `${reactId}-opt-${index}`;

  const options = buildOptions(categories, mode, parentId, excludeIds);
  const searching = query.trim().length > 0;
  const filtered = filterOptions(options, query);
  // The committed label reads from the full list, so a value outside the current mode still shows.
  const selectedRow = value ? categories.find((c) => c.id === value) ?? null : null;

  const active = filtered.length === 0 ? 0 : Math.min(highlight, filtered.length - 1);

  useEffect(() => {
    if (!open) return;
    function handleMouseDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  function commit(option: PickerOption) {
    onChange(option.id);
    setQuery("");
    setOpen(false);
  }

  function clear() {
    onChange(null);
    setQuery("");
    setOpen(false);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (disabled) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      if (filtered.length === 0) return;
      setHighlight(
        e.key === "ArrowDown"
          ? (active + 1) % filtered.length
          : (active - 1 + filtered.length) % filtered.length
      );
      return;
    }
    if (e.key === "Enter") {
      if (!open) return;
      e.preventDefault();
      const option = filtered[active];
      if (option) commit(option);
      return;
    }
    if (e.key === "Escape") {
      if (!open) return;
      e.preventDefault();
      setOpen(false);
      setQuery("");
    }
  }

  const showClear = allowClear && !!value && !disabled;
  const inputValue = open ? query : selectedRow?.name ?? "";

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <input
        id={id}
        name={name}
        type="text"
        role="combobox"
        autoComplete="off"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && filtered.length > 0 ? optionId(active) : undefined}
        disabled={disabled}
        placeholder={placeholder}
        value={inputValue}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setHighlight(0);
          if (allowClear && e.target.value === "" && value !== null) onChange(null);
        }}
        onFocus={() => {
          if (!disabled) setOpen(true);
        }}
        onKeyDown={handleKeyDown}
        className={cn(
          "flex h-10 min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900 disabled:cursor-not-allowed disabled:opacity-50",
          showClear && "pr-11"
        )}
      />

      {showClear && (
        <button
          type="button"
          onClick={clear}
          aria-label="Clear selection"
          className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-slate-400 hover:text-slate-600"
        >
          <X className="h-4 w-4" />
        </button>
      )}

      <div
        ref={listRef}
        id={listId}
        role="listbox"
        hidden={!open}
        className="absolute z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg"
      >
        {filtered.length === 0 ? (
          <p className="p-3 text-center text-sm text-slate-400">{emptyText}</p>
        ) : (
          filtered.map((option, index) => (
            <button
              key={option.id}
              type="button"
              role="option"
              id={optionId(index)}
              data-index={index}
              aria-selected={option.id === value}
              onMouseDown={(e) => {
                e.preventDefault();
                commit(option);
              }}
              onMouseEnter={() => setHighlight(index)}
              // Indentation only in tree order; a search result list is flat and carries its path.
              style={{ paddingLeft: 12 + (searching ? 0 : option.depth * 16) }}
              className={cn(
                "flex min-h-[44px] w-full flex-col justify-center border-b border-slate-100 py-2 pr-3 text-left text-sm last:border-b-0 hover:bg-slate-50",
                index === active && "bg-slate-50",
                option.id === value && "bg-slate-100 font-medium"
              )}
            >
              <span className={cn("text-slate-800", option.inactive && "text-slate-400")}>
                {!searching && option.depth > 0 && (
                  <span aria-hidden className="mr-1 text-slate-300">└</span>
                )}
                {option.name}
                {option.inactive && <span className="ml-1 text-[11px] italic">(inactive)</span>}
              </span>
              {searching && option.path !== option.name && (
                <span className="text-[11px] text-slate-400">{option.path}</span>
              )}
            </button>
          ))
        )}
      </div>
    </div>
  );
}

export default CategoryTreeSelect;
