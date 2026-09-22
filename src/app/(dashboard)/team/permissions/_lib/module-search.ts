// Module search for the permission screens — plan 2209-permissions-module-search (R1, Q1–Q3).
// Shared by /team/permissions and /team/permissions/gaps so both find the same modules.

export interface SearchableModule {
  id: string;
  label: string;
  parentId: string | null;
}

export interface ModuleSearchResult {
  /** Every module to render: the matches plus their context. `null` = no search, show all. */
  visible: Set<string> | null;
  /** Parents shown only because a child matched — rendered muted as "(parent)" (Q2a). */
  contextOnly: Set<string>;
  /** How many modules actually matched the query (0 → "No module matches"). */
  matched: number;
}

/**
 * Which modules a search shows.
 *
 * - Matches the module's NAME (its label) only, case-insensitive and trimmed (Q1b, the owner:
 *   "the search match the name of the module").
 * - A matching sub-module brings its parent along as context, so it is not indented under
 *   nothing (Q2a).
 * - A matching parent brings all its sub-modules (Q3a) — searching "Stock management" is how
 *   people reach Inbound, Outbound and the rest.
 *
 * Pure: it decides what is RENDERED and nothing else. The caller must never feed it into the
 * grant set — a hidden module keeps its ticks and is saved with the role (R2).
 */
export function searchModules<T extends SearchableModule>(modules: T[], query: string): ModuleSearchResult {
  const q = query.trim().toLowerCase();
  if (!q) return { visible: null, contextOnly: new Set(), matched: 0 };

  const matches = new Set(modules.filter((m) => m.label.toLowerCase().includes(q)).map((m) => m.id));
  const visible = new Set(matches);
  const contextOnly = new Set<string>();

  for (const m of modules) {
    // A matching child's parent comes along as context.
    if (matches.has(m.id) && m.parentId && !matches.has(m.parentId)) {
      visible.add(m.parentId);
      contextOnly.add(m.parentId);
    }
    // A matching parent brings its children.
    if (m.parentId && matches.has(m.parentId)) visible.add(m.id);
  }
  // A parent that is itself a match is never "context only", even if a child also matched.
  for (const id of matches) contextOnly.delete(id);

  return { visible, contextOnly, matched: matches.size };
}
