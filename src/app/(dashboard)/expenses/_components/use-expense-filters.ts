"use client";

// The list's filters, read from the URL on arrival and written back to it as they change.
//
// The report (/reports/expense-summary) links here with `?storeId=&payer=&category=&dateFrom=&dateTo=`
// — the parameters src/lib/expenses/filters.ts understands — so "View these expenses" opens the
// list already narrowed to the total it came from. The same string is sent to GET /api/expenses
// and GET /api/expenses/totals, so the list, its total and the report share one filter.
//
// `useSearchParams` needs a Suspense boundary above it or the production build fails; the page
// provides it (node_modules/next/dist/docs/01-app/03-api-reference/04-functions/use-search-params.md).

import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { getDateRange, type DateRangeKey } from "@/components/date-filter";
import { CATEGORY_ORDER, payerName, type ExpenseRow, type StoreOption } from "./types";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const PRESETS: DateRangeKey[] = ["today", "3days", "week", "month"];

export interface ExpenseFilters {
  /** "ALL" or an ExpenseCategory. */
  category: string;
  /** "ALL", a store id, or "none" for rows saved before expenses carried a store. */
  storeId: string;
  /** "user:<id>" or "name:<key>". Only ever set from the URL; the screen can only remove it. */
  payer: string | null;
  dateKey: DateRangeKey;
  dateFrom?: string;
  dateTo?: string;
}

/** The preset chip a date window corresponds to, so "This Month" from the report reads as such. */
function dateKeyFor(from?: string, to?: string): DateRangeKey {
  if (!from && !to) return "all";
  for (const key of PRESETS) {
    const range = getDateRange(key);
    if (range && range.from === from && range.to === to) return key;
  }
  return "custom";
}

function fromUrl(sp: { get(name: string): string | null }): ExpenseFilters {
  const category = sp.get("category") ?? "";
  const payer = sp.get("payer") ?? "";
  const from = sp.get("dateFrom") ?? "";
  const to = sp.get("dateTo") ?? "";
  const dateFrom = DAY.test(from) ? from : undefined;
  const dateTo = DAY.test(to) ? to : undefined;
  return {
    category: (CATEGORY_ORDER as string[]).includes(category) ? category : "ALL",
    storeId: sp.get("storeId") || "ALL",
    payer: /^(user|name):./.test(payer) ? payer : null,
    dateKey: dateKeyFor(dateFrom, dateTo),
    dateFrom,
    dateTo,
  };
}

/** The query string for the URL and both APIs. No `limit` — the list adds its own. */
function toQuery(f: ExpenseFilters): string {
  const p = new URLSearchParams();
  if (f.storeId !== "ALL") p.set("storeId", f.storeId);
  if (f.payer) p.set("payer", f.payer);
  if (f.category !== "ALL") p.set("category", f.category);
  if (f.dateFrom) p.set("dateFrom", f.dateFrom);
  if (f.dateTo) p.set("dateTo", f.dateTo);
  return p.toString();
}

export function useExpenseFilters() {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  // Read once, when the screen mounts — a link from the report always mounts it afresh. From
  // then on this state is the source of truth and the URL follows it.
  const [filters, setFilters] = useState<ExpenseFilters>(() => fromUrl(searchParams));
  const query = toQuery(filters);

  // replaceState, not push: changing a chip should not add a Back step. Next.js syncs
  // useSearchParams with the native History API (docs: linking-and-navigating, "Native History API").
  useEffect(() => {
    const next = query ? `${pathname}?${query}` : pathname;
    if (`${window.location.pathname}${window.location.search}` !== next) {
      window.history.replaceState(null, "", next);
    }
  }, [pathname, query]);

  const update = (patch: Partial<ExpenseFilters>) => setFilters((f) => ({ ...f, ...patch }));

  return { filters, query, update };
}

/**
 * The Store group's chips: every active store, any store seen on the loaded rows that is no
 * longer active, the selected store if neither list has it (a link to a closed store), and
 * "No store".
 */
export function storeFilterOptions(
  stores: StoreOption[],
  rows: ExpenseRow[],
  selected: string
): { key: string; label: string }[] {
  const byId = new Map<string, string>();
  for (const s of stores) byId.set(s.id, s.name);
  for (const r of rows) if (r.store && !byId.has(r.store.id)) byId.set(r.store.id, r.store.name);
  if (selected !== "ALL" && selected !== "none" && !byId.has(selected)) byId.set(selected, "Selected store");

  return [
    { key: "ALL", label: "All" },
    ...[...byId].map(([key, label]) => ({ key, label })),
    { key: "none", label: "No store" },
  ];
}

/**
 * The payer chip's name. Every loaded row matches the payer filter, so the first one names
 * them; with no rows, a typed name falls back to its key (lower-cased by the report) in title
 * case, and a staff id to a neutral phrase.
 */
export function payerFilterLabel(payer: string, rows: ExpenseRow[]): string {
  if (rows[0]) return payerName(rows[0]);
  if (payer.startsWith("name:")) return payer.slice(5).replace(/\b\w/g, (c) => c.toUpperCase());
  return "A staff member";
}
