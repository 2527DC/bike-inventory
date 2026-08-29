"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut, LayoutDashboard, ChevronRight } from "lucide-react";
import { signOut, useSession } from "next-auth/react";
import { cn } from "@/lib/utils";
import { usePermissions } from "@/lib/use-permissions";
import { clearPermissionCache } from "@/lib/use-permissions";
import { moduleIcon } from "@/lib/module-icons";
import { useScrollShadows } from "@/lib/use-scroll-shadows";
import type { GrantedModule } from "@/stores/permissions";

interface AppSidebarProps {
  className?: string;
}

// Persisted EXPANDER OVERRIDES, keyed by parent module key.
//
// A record of explicit choices, not a set of open sections — and the difference is the
// whole design. A section is open by default when the current page is inside it, so a plain
// `Set<open>` cannot express "I closed the section I am standing in": the key was never in
// the set, so removing it is a no-op and the section springs straight back open. Here
// `false` is a real, storable answer.
//
//   undefined -> follow the route (open iff a child is active)
//   true      -> the user opened it
//   false     -> the user closed it, even though a child is active
//
// try/catch on both sides: a private window or blocked site data THROWS on access, and a
// nav that crashes over a saved preference is worse than one that forgets.
const OPEN_KEY = "bch:sidebar:open";

type ExpandOverrides = Record<string, boolean>;

function readOverrides(): ExpandOverrides {
  try {
    const raw = localStorage.getItem(OPEN_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: ExpandOverrides = {};
    for (const [k, v] of Object.entries(parsed)) if (typeof v === "boolean") out[k] = v;
    return out;
  } catch {
    return {};
  }
}

function writeOverrides(o: ExpandOverrides) {
  try {
    localStorage.setItem(OPEN_KEY, JSON.stringify(o));
  } catch {
    /* storage unavailable — the nav still works, it just forgets */
  }
}

/** A parent module plus the granted children rendered beneath it. */
interface TreeNode {
  key: string;
  label: string;
  icon: string | null;
  /** null when the parent itself is not granted — renders as a heading, not a link. */
  route: string | null;
  sortOrder: number;
  children: GrantedModule[];
}

// Desktop sidebar. Every entry comes from the `modules` table filtered by the user's `view`
// permission — there is no hardcoded per-role tab list any more. Seeding a new module makes it
// appear here for whoever holds its view grant, with no change to this file.
export function AppSidebar({ className }: AppSidebarProps) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const { modules, role, loading } = usePermissions();

  const userName = session?.user?.name || "User";
  const initials = userName
    .split(" ")
    .map((n: string) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  function isActive(href: string) {
    if (href === "/") return pathname === "/";
    return pathname === href || pathname.startsWith(href + "/");
  }

  // ── Build the tree ─────────────────────────────────────────────────────────
  // Two levels, no deeper. A child carries its parent's display fields even when the
  // parent is not granted (see GrantedModule.parent), which is what lets a user holding
  // only `staff_lms_learning.view` still see a "Staff LMS" heading above it.
  const nodesByKey = new Map<string, TreeNode>();
  const rootOrder: string[] = [];

  for (const m of modules) {
    if (m.parent) {
      // A child with no route is unreachable and renders nothing — skip it, but do NOT
      // let that skip remove its parent heading; other children may still be granted.
      if (!m.route) continue;
      let node = nodesByKey.get(m.parent.key);
      if (!node) {
        // Placeholder built from the carried parent. `route` stays null until (and unless)
        // the parent's own granted row turns up, which is what makes an ungranted parent
        // render as a plain heading rather than a dead link.
        node = {
          key: m.parent.key,
          label: m.parent.label,
          icon: m.parent.icon,
          route: null,
          sortOrder: m.parent.sortOrder,
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
    } else {
      nodesByKey.set(m.key, {
        key: m.key,
        label: m.label,
        icon: m.icon,
        route: m.route,
        sortOrder: m.sortOrder,
        children: [],
      });
      rootOrder.push(m.key);
    }
  }

  // Group the tree by `group`, preserving sortOrder. A group is taken from the granted
  // module itself; a child inherits its parent's, which the seeder asserts they share.
  const groupOf = new Map<string, string>();
  for (const m of modules) {
    const key = m.parent ? m.parent.key : m.key;
    if (!groupOf.has(key)) groupOf.set(key, (m.parent ? m.parent.group : m.group) || "Other");
  }

  const groups: { title: string; items: TreeNode[] }[] = [];
  for (const key of rootOrder) {
    const node = nodesByKey.get(key)!;

    // C3 — skip only when routeless AND childless. `!route` means two different things
    // now: a permission-only module such as `cost_price` (skip it, there is no page), and
    // a parent whose own view grant is missing (keep it, its children are the point).
    if (!node.route && node.children.length === 0) continue;

    node.children.sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label));

    const title = groupOf.get(key) || "Other";
    let g = groups.find((x) => x.title === title);
    if (!g) groups.push((g = { title, items: [] }));
    g.items.push(node);
  }

  // ── Expanded state ─────────────────────────────────────────────────────────
  // State holds only the user's EXPLICIT choices; whether a section is open is DERIVED
  // from those plus the current route. Three behaviours fall out of that split, and all
  // three break if you store "is open" directly instead:
  //
  //   1. A deep link (…/staff-lms/learning/lessons/abc123 pasted from WhatsApp) lands with
  //      its section already open, on the FIRST PAINT — no collapsed-then-jump flash.
  //   2. The scroll-into-view latch below finds `activeRef` mounted. That latch is
  //      one-shot: if the active child is still unmounted when it fires, it finds nothing,
  //      burns the latch, and the sidebar never scrolls to the active item again.
  //   3. A manual collapse STAYS collapsed while you navigate inside that section — the
  //      `false` override outranks the route.
  //
  // Only the overrides are state, and they persist to localStorage.
  const [overrides, setOverrides] = useState<ExpandOverrides>(() => readOverrides());

  // Resolve each section: an explicit choice wins, otherwise follow the route.
  //
  // This is derived on every render rather than seeded once into state, because on the
  // FIRST render `modules` is still empty — the permission fetch has not landed — so there
  // is no tree to read the active route out of yet. A one-shot initialiser would therefore
  // auto-open nothing, forever.
  const expandedKeys = new Set<string>();
  for (const g of groups) {
    for (const node of g.items) {
      const override = overrides[node.key];
      const routeSaysOpen = node.children.some((c) => isActive(c.route!));
      if (override ?? routeSaysOpen) expandedKeys.add(node.key);
    }
  }

  function toggle(key: string) {
    setOverrides((prev) => {
      const next = { ...prev, [key]: !expandedKeys.has(key) };
      writeOverrides(next);
      return next;
    });
  }

  // Fade edges telling the user the list is cut off. Keyed on the module count so the
  // measurement re-runs once the permission fetch replaces the skeleton.
  const { ref: navRef, atTop, atBottom, onScroll } = useScrollShadows<HTMLElement>([
    modules.length,
  ]);

  // Bring the current page's entry into view on load. Without this, landing directly on a
  // deep route (/analytics, /services/*) leaves the sidebar scrolled to the top with the
  // active item off-screen, so the nav gives no clue where you are.
  const activeRef = useRef<HTMLAnchorElement | null>(null);
  // A ref, not state: this is a one-shot latch on a DOM side effect and must not re-render.
  const didScrollToActive = useRef(false);
  useEffect(() => {
    if (didScrollToActive.current || !activeRef.current) return;
    activeRef.current.scrollIntoView({ block: "nearest" });
    didScrollToActive.current = true;
    // `expandedKeys.size` is in the deps because the active item may be a CHILD, and a
    // child inside a collapsed section is unmounted — activeRef would be null, the latch
    // would burn on nothing, and the sidebar would never scroll to it. The derivation above
    // already opens the containing section on first paint; this dep is the belt to that
    // pair of braces.
  }, [modules.length, expandedKeys.size]);

  const linkClass = (active: boolean) =>
    cn(
      "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
      active ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
    );

  return (
    <aside
      className={cn(
        "w-60 h-screen sticky top-0 bg-white border-r border-slate-200 flex-col shrink-0",
        className
      )}
    >
      <div className="flex items-center gap-2.5 px-5 h-16 border-b border-slate-100 shrink-0">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.jpg" alt="BCH OPS" className="h-9 w-9 rounded-lg object-cover" />
        <span className="text-base font-bold text-slate-900">BCH OPS</span>
      </div>

      {/* `min-h-0` is what lets the nav shrink below its content height instead of pushing the
          footer past the bottom of the h-screen aside; `relative` anchors the fade edges. */}
      <div className="relative flex-1 min-h-0">
        {!atTop && (
          <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-5 bg-gradient-to-b from-white to-transparent" />
        )}

        <nav
          ref={navRef}
          onScroll={onScroll}
          className="h-full overflow-y-auto overscroll-contain scrollbar-thin py-3 px-3"
        >
        {loading && (
          <div className="space-y-2 px-1 py-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-8 rounded-lg bg-slate-100 animate-pulse" />
            ))}
          </div>
        )}

        {!loading && groups.length === 0 && (
          <p className="px-3 py-4 text-xs text-slate-400">
            No modules assigned. Ask an admin to grant your role access.
          </p>
        )}

        {groups.map((group) => (
          <div key={group.title} className="mt-4 first:mt-0">
            <p className="px-3 mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
              {group.title}
            </p>
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const Icon = moduleIcon(item.icon) ?? LayoutDashboard;
                const hasChildren = item.children.length > 0;
                const expanded = hasChildren && expandedKeys.has(item.key);

                // A parent counts as active only on its OWN route — never because a child
                // is active, or every child click would highlight two rows at once.
                const selfActive = !!item.route && isActive(item.route);
                const activeChild = item.children.find((c) => isActive(c.route!));

                // The row is TWO hit targets: the label navigates, the chevron toggles.
                // A whole-row toggle would make it impossible to collapse the section you
                // are standing in without navigating away first.
                const label = (
                  <>
                    <Icon className="h-4.5 w-4.5 shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </>
                );

                return (
                  <div key={item.key}>
                    <div className="flex items-center gap-0.5">
                      {item.route ? (
                        <Link
                          ref={selfActive && !activeChild ? activeRef : undefined}
                          href={item.route}
                          className={cn(linkClass(selfActive), "flex-1 min-w-0")}
                        >
                          {label}
                        </Link>
                      ) : (
                        // Parent granted through its children only. There is no route to
                        // link to, and a dead <a> is worse than none — so it is inert text.
                        <div
                          className={cn(
                            "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium",
                            "flex-1 min-w-0 text-slate-500"
                          )}
                        >
                          {label}
                        </div>
                      )}

                      {hasChildren && (
                        <button
                          type="button"
                          onClick={() => toggle(item.key)}
                          aria-expanded={expanded}
                          aria-controls={`nav-${item.key}`}
                          aria-label={`${expanded ? "Collapse" : "Expand"} ${item.label}`}
                          className="shrink-0 w-7 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-900 transition-colors"
                        >
                          <ChevronRight
                            className={cn(
                              "h-4 w-4 transition-transform",
                              expanded && "rotate-90"
                            )}
                          />
                        </button>
                      )}
                    </div>

                    {/* UNMOUNTED when collapsed, not CSS-hidden — a hidden-but-mounted
                        link is still tabbable and still read by screen readers. */}
                    {expanded && (
                      <div id={`nav-${item.key}`} role="group" className="mt-0.5 ml-4 space-y-0.5 border-l border-slate-100 pl-2">
                        {item.children.map((child) => {
                          const ChildIcon = moduleIcon(child.icon) ?? LayoutDashboard;
                          const childActive = isActive(child.route!);
                          return (
                            <Link
                              key={child.key}
                              ref={childActive ? activeRef : undefined}
                              href={child.route!}
                              className={linkClass(childActive)}
                            >
                              <ChildIcon className="h-4 w-4 shrink-0" />
                              <span className="truncate">{child.label}</span>
                            </Link>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
        </nav>

        {!atBottom && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-5 bg-gradient-to-t from-white to-transparent" />
        )}
      </div>

      <div className="border-t border-slate-200 px-4 py-3 shrink-0">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-full bg-slate-200 flex items-center justify-center shrink-0">
            <span className="text-xs font-semibold text-slate-600">{initials}</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-slate-900 truncate">{userName}</p>
            <p className="text-[11px] text-slate-400 truncate">{role?.name || ""}</p>
          </div>
          <button
            onClick={() => {
              clearPermissionCache();
              signOut({ callbackUrl: "/login" });
            }}
            className="text-slate-400 hover:text-red-500 transition-colors"
            title="Sign out"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}
