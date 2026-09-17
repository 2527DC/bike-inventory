import type { Prisma, PrismaClient } from "@prisma/client";
import { createLogger } from "@/lib/logger";

/**
 * Category tree helpers — plan 1709-priority-build-and-stock-flow, Part I (R43, P13).
 *
 * `Category.parentId` has existed since the first schema; what was missing was one place that
 * walks it. Three callers need it: `api/products` (a parent filter includes its children's
 * products, P13), the home-bin rule matcher, and every picker that shows the tree.
 *
 * The file has ONE database function and several pure ones. Only TYPES are imported from
 * `@prisma/client`, so a client component can import the pure helpers without pulling Prisma
 * into the browser bundle.
 *
 * Cycle safety matters in both halves. The PATCH route rejects a cycle and the Zoho import
 * skips one, but `parentId` is a plain self-reference with no database constraint against a
 * loop, so a row written by a script or an older build could still form one. A tree walk that
 * trusts the data would recurse forever on it.
 */

const log = createLogger("categories:tree");

export type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Every category id in the subtree rooted at `id`, including `id` itself. Active and inactive
 * rows both — deactivation hides a row from pickers, it does not change what is filed under it.
 *
 * One recursive CTE rather than a loop of `findMany({ where: { parentId } })`: one round trip
 * however deep the tree. `path` carries the ids already visited on the branch, and a row whose
 * id is already on it is not followed — that is what stops a cycle.
 *
 * An unknown `id` returns `[id]`, so a caller that filters `categoryId IN (...)` gets no rows
 * rather than an unfiltered list.
 */
export async function categorySubtreeIds(db: Db, id: string): Promise<string[]> {
  const started = Date.now();
  try {
    const rows = await db.$queryRaw<Array<{ id: string }>>`
      WITH RECURSIVE subtree(id, path) AS (
        SELECT c."id", ARRAY[c."id"]
        FROM "Category" c
        WHERE c."id" = ${id}
        UNION ALL
        SELECT c."id", s.path || c."id"
        FROM "Category" c
        JOIN subtree s ON c."parentId" = s.id
        WHERE NOT (c."id" = ANY(s.path))
      )
      SELECT DISTINCT id FROM subtree
    `;
    const ids = rows.map((r) => r.id);
    if (!ids.includes(id)) ids.unshift(id);
    log.debug("subtree resolved", { categoryId: id, count: ids.length, ms: Date.now() - started });
    return ids;
  } catch (err) {
    log.error("subtree query failed", {
      categoryId: id,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/** The minimum a row needs to be placed in the tree. Extra fields are carried through. */
export interface CategoryTreeRow {
  id: string;
  name: string;
  parentId: string | null;
}

export type CategoryTreeNode<T extends CategoryTreeRow = CategoryTreeRow> = T & {
  depth: number;
  children: CategoryTreeNode<T>[];
};

const byName = (a: { name: string }, b: { name: string }) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: "base" });

/**
 * Nest a flat list into a tree, siblings sorted by name. Pure.
 *
 * Roots are rows with no parent OR whose parent is not in `rows` — a filtered list (say, active
 * only) must still show a child whose parent was filtered out, rather than lose it.
 *
 * A cycle has no root to be reached from, so after the walk every row not yet placed is
 * promoted to a root and walked from there; `placed` stops the walk re-entering the loop. The
 * result always contains every input row exactly once.
 */
export function buildCategoryTree<T extends CategoryTreeRow>(rows: T[]): CategoryTreeNode<T>[] {
  const ids = new Set(rows.map((r) => r.id));
  const childrenOf = new Map<string, T[]>();
  for (const row of rows) {
    if (row.parentId && ids.has(row.parentId) && row.parentId !== row.id) {
      const list = childrenOf.get(row.parentId) ?? [];
      list.push(row);
      childrenOf.set(row.parentId, list);
    }
  }

  const placed = new Set<string>();
  function build(row: T, depth: number): CategoryTreeNode<T> {
    placed.add(row.id);
    const kids = (childrenOf.get(row.id) ?? [])
      .filter((k) => !placed.has(k.id))
      .sort(byName);
    const node: CategoryTreeNode<T> = { ...row, depth, children: [] };
    for (const kid of kids) {
      if (placed.has(kid.id)) continue; // reached through a sibling's subtree in a malformed tree
      node.children.push(build(kid, depth + 1));
    }
    return node;
  }

  const roots: CategoryTreeNode<T>[] = [];
  const rootRows = rows
    .filter((r) => !r.parentId || !ids.has(r.parentId) || r.parentId === r.id)
    .sort(byName);
  for (const row of rootRows) {
    if (!placed.has(row.id)) roots.push(build(row, 0));
  }

  // Anything left is on a cycle. Break it at the alphabetically first row.
  const orphans = rows.filter((r) => !placed.has(r.id)).sort(byName);
  for (const row of orphans) {
    if (!placed.has(row.id)) roots.push(build(row, 0));
  }
  if (orphans.length > 0) roots.sort(byName);

  return roots;
}

/** Depth-first, pre-order flattening: each parent followed by its children. Pure. */
export function flattenCategoryTree<T extends CategoryTreeRow>(
  nodes: CategoryTreeNode<T>[]
): CategoryTreeNode<T>[] {
  const out: CategoryTreeNode<T>[] = [];
  const walk = (list: CategoryTreeNode<T>[]) => {
    for (const node of list) {
      out.push(node);
      walk(node.children);
    }
  };
  walk(nodes);
  return out;
}

/**
 * In-memory counterpart of `categorySubtreeIds` for a list already loaded: `id` plus every
 * descendant. Used by the parent picker to exclude a category's own subtree. Pure, cycle-safe.
 */
export function descendantIds(rows: CategoryTreeRow[], id: string): Set<string> {
  const childrenOf = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.parentId) continue;
    const list = childrenOf.get(row.parentId) ?? [];
    list.push(row.id);
    childrenOf.set(row.parentId, list);
  }
  const seen = new Set<string>([id]);
  const stack = [id];
  while (stack.length) {
    const current = stack.pop() as string;
    for (const child of childrenOf.get(current) ?? []) {
      if (!seen.has(child)) {
        seen.add(child);
        stack.push(child);
      }
    }
  }
  return seen;
}
