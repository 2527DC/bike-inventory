"use client";

import * as React from "react";
import { useEffect, useId, useRef, useState } from "react";
import { X } from "lucide-react";
import { cn, fuzzyMatch } from "@/lib/utils";

export interface SearchableSelectOption {
  id: string;
  label: string;
  /** Secondary text on the row — parent category, vendor code, city. Also searched. */
  hint?: string;
}

interface SearchableSelectProps {
  options: SearchableSelectOption[];
  value: string | null;
  onChange: (id: string | null) => void;
  placeholder?: string;
  emptyText?: string;
  disabled?: boolean;
  className?: string;
  /** Forwarded to the input so a caller's <label htmlFor> reaches it. */
  id?: string;
  name?: string;
}

/**
 * Substring first, fuzzy only as a fallback. `fuzzyMatch` accepts a subsequence match
 * ("cbl" hits "Cable"), which is what you want when nothing matched literally and noise when
 * something did — running it unconditionally would bury the exact hit among a dozen near-misses.
 *
 * Module level and pure so the React Compiler memoizes the call itself. A `useMemo` around this
 * body has early returns the compiler cannot preserve, and `react-hooks/preserve-manual-memoization`
 * fails the lint rather than quietly de-optimising the component.
 */
function filterOptions(
  options: SearchableSelectOption[],
  query: string
): SearchableSelectOption[] {
  const q = query.trim().toLowerCase();
  if (!q) return options;
  const literal = options.filter(
    (o) =>
      o.label.toLowerCase().includes(q) || (o.hint ?? "").toLowerCase().includes(q)
  );
  if (literal.length > 0) return literal;
  return options.filter(
    (o) => fuzzyMatch(query, o.label) || fuzzyMatch(query, o.hint)
  );
}

/**
 * Typeahead picker for a list already in memory.
 *
 * The pattern was hand-rolled inline in `vendor-issues/new/page.tsx` (a plain input, a
 * `showDropdown` boolean and a `.filter()`), which works with a mouse and not at all with a
 * keyboard or a screen reader. This is that markup with the accessibility contract added, so
 * the next screen that needs a picker does not grow a third copy.
 *
 * It fetches nothing. Options come in as a prop and the parent owns the loading state — that
 * keeps `apiFetch` where the error banner is and keeps this file free of any network path.
 */
export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = "Search...",
  emptyText = "No matches",
  disabled = false,
  className,
  id,
  name,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);

  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // useId (not a counter) because the input renders on the server too and a mismatched
  // aria-controls between the two passes is a hydration error.
  const reactId = useId();
  const listId = `${reactId}-list`;
  const optionId = (index: number) => `${reactId}-opt-${index}`;

  const selected = options.find((o) => o.id === value) ?? null;
  const filtered = filterOptions(options, query);

  // `highlight` indexes a list the parent can reshape at any time (options arrive from a fetch),
  // so it is clamped on read instead of being reset from an effect. An effect reset lands one
  // render late, and that render is exactly the window in which Enter commits a row that is no
  // longer on screen.
  const active =
    filtered.length === 0 ? 0 : Math.min(highlight, filtered.length - 1);

  /**
   * `mousedown`, not `click`: a drag that starts inside the list and releases outside it (or on
   * the list's own scrollbar) produces no `click` at all, so a click listener leaves the list
   * open with no way to dismiss it. The trade is that this fires before the option's `click`
   * would — which is why the options commit on `mousedown` too, and why they `preventDefault`
   * so the input never blurs.
   */
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

  // The list scrolls at max-h-60, so arrowing past the fold has to bring the row along.
  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  function commit(option: SearchableSelectOption) {
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
      e.preventDefault(); // otherwise the caret jumps to either end of the text
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
      if (!open) return; // let the surrounding form submit when the list is closed
      e.preventDefault();
      const option = filtered[active];
      if (option) commit(option);
      return;
    }
    if (e.key === "Escape") {
      if (!open) return;
      e.preventDefault(); // a bare Escape inside a sheet would otherwise close the sheet too
      setOpen(false);
      setQuery("");
    }
  }

  // While the list is open the field shows what is being typed; closed, it shows the commitment.
  // That is why closing always resets `query` — the label has to win once editing stops.
  const inputValue = open ? query : selected?.label ?? "";

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
        aria-activedescendant={
          open && filtered.length > 0 ? optionId(active) : undefined
        }
        disabled={disabled}
        placeholder={placeholder}
        value={inputValue}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setHighlight(0); // the old index pointed into the previous filter result
          // Emptying the field is the other way to mean "none" — the X is just the fast one.
          if (e.target.value === "" && value !== null) onChange(null);
        }}
        onFocus={() => {
          if (!disabled) setOpen(true);
        }}
        onKeyDown={handleKeyDown}
        className={cn(
          "flex h-10 min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900 disabled:cursor-not-allowed disabled:opacity-50",
          value && !disabled && "pr-11"
        )}
      />

      {value && !disabled && (
        <button
          type="button"
          onClick={clear}
          aria-label="Clear selection"
          // Full height of the field, not a 16px glyph — a thumb has to be able to hit it.
          className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-slate-400 hover:text-slate-600"
        >
          <X className="h-4 w-4" />
        </button>
      )}

      {/* No portal: every caller so far is a form column or a bottom sheet that scrolls with
          the field, and a portalled list has to be re-positioned on every scroll and resize.
          A caller that clips this needs `overflow-visible`, not a portal. */}
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
                e.preventDefault(); // keep focus on the input; blur would close the list first
                commit(option);
              }}
              onMouseEnter={() => setHighlight(index)}
              className={cn(
                "flex min-h-[44px] w-full flex-col justify-center border-b border-slate-100 px-3 py-2 text-left text-sm last:border-b-0 hover:bg-slate-50",
                index === active && "bg-slate-50",
                option.id === value && "bg-slate-100 font-medium"
              )}
            >
              <span className="text-slate-800">{option.label}</span>
              {option.hint && (
                <span className="text-[11px] text-slate-400">{option.hint}</span>
              )}
            </button>
          ))
        )}
      </div>
    </div>
  );
}

export default SearchableSelect;
