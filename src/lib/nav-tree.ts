// ─── Navigation tree ─────────────────────────────────────────────────────────
// One builder for every menu renderer — the desktop sidebar (app-sidebar.tsx), the /desktop
// shell sidebar, the mobile header drawer and /more — so they cannot disagree about what a
// module row means. The menu is DATA (the `modules` table filtered by `view`); nothing here
// names a module key or a role.
//
// Two rules every renderer follows (plan 1709, R28 and P5):
//   1. A parent whose `route` is null is an EXPANDER ONLY. It renders as a button that toggles
//      its children, never as a link. That covers both a routeless grouping module such as
//      Stock management and a parent the user was not granted (see GrantedModule.parent).
//   2. A child with `dividerBefore` gets a thin divider line above it — unless it is the first
//      child rendered, where a line would separate it from nothing.

import type { GrantedModule } from "@/stores/permissions";

/** A root module plus the granted, linkable children rendered beneath it. */
export interface NavNode {
  key: string;
  label: string;
  icon: string | null;
  /** null → expander only (routeless module, or a parent granted only through children). */
  route: string | null;
  sortOrder: number;
  dividerBefore: boolean;
  children: GrantedModule[];
}

export interface NavGroup {
  title: string;
  items: NavNode[];
}

/**
 * Build the two-level tree, grouped by `Module.group`, in `sortOrder`.
 *
 * `modules` arrives sorted by sortOrder from /api/my-permissions, so group order is the order
 * in which each group's first root appears — which is why the catalog keeps groups in sortOrder
 * bands (Operations 90–195, Purchase 200–240, Sales 250–260, Accounts 290–350, …).
 */
export function buildNavTree(modules: GrantedModule[]): NavGroup[] {
  const nodesByKey = new Map<string, NavNode>();
  const rootOrder: string[] = [];

  for (const m of modules) {
    if (m.parent) {
      // A child with no route is unreachable and renders nothing — skip it, but do NOT let
      // that skip remove its parent heading; other children may still be granted.
      if (!m.route) continue;
      let node = nodesByKey.get(m.parent.key);
      if (!node) {
        // Placeholder built from the carried parent. `route` stays null until (and unless) the
        // parent's own granted row turns up, which makes an ungranted parent an expander rather
        // than a dead link.
        node = {
          key: m.parent.key,
          label: m.parent.label,
          icon: m.parent.icon,
          route: null,
          sortOrder: m.parent.sortOrder,
          dividerBefore: false,
          children: [],
        };
        nodesByKey.set(node.key, node);
        rootOrder.push(node.key);
      }
      node.children.push(m);
      continue;
    }

    // A root. It may already exist as a placeholder created by one of its children.
    const existing = nodesByKey.get(m.key);
    if (existing) {
      existing.label = m.label;
      existing.icon = m.icon;
      existing.route = m.route;
      existing.sortOrder = m.sortOrder;
      existing.dividerBefore = m.dividerBefore === true;
    } else {
      nodesByKey.set(m.key, {
        key: m.key,
        label: m.label,
        icon: m.icon,
        route: m.route,
        sortOrder: m.sortOrder,
        dividerBefore: m.dividerBefore === true,
        children: [],
      });
      rootOrder.push(m.key);
    }
  }

  // A child inherits its parent's group, which the seeder asserts they share.
  const groupOf = new Map<string, string>();
  for (const m of modules) {
    const key = m.parent ? m.parent.key : m.key;
    if (!groupOf.has(key)) groupOf.set(key, (m.parent ? m.parent.group : m.group) || "Other");
  }

  const groups: NavGroup[] = [];
  for (const key of rootOrder) {
    const node = nodesByKey.get(key)!;

    // Skip only when routeless AND childless. `!route` means two things: a permission-only
    // module such as `cost_price` (no page — skip), and an expander whose children are the
    // point (keep).
    if (!node.route && node.children.length === 0) continue;

    node.children.sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label));

    const title = groupOf.get(key) || "Other";
    let g = groups.find((x) => x.title === title);
    if (!g) groups.push((g = { title, items: [] }));
    g.items.push(node);
  }

  return groups;
}

/** Whether to draw the divider above `children[index]` — never above the first child. */
export function showDividerBefore(children: GrantedModule[], index: number): boolean {
  return index > 0 && children[index].dividerBefore === true;
}
