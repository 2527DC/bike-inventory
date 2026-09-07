"use client";

// ─── Bottom navigation: resolving what this user's bar should show ───────────
//
// One hook, deliberately, so the bar (src/components/bottom-nav.tsx) and the layout
// (src/app/(dashboard)/layout.tsx, which reserves the bar's height) can never disagree
// about whether a bar exists at all. Two independent copies of that decision is how you
// get a 64px dead strip at the bottom of a page with no nav in it.
//
// WHY INTERSECT
// -------------
// `navTabs` is ADMIN INTENT — the routes a person with `team.edit` pinned on the user's edit
// page. `modules` is what the user's ROLE actually grants right now. Those two drift the
// moment a permission is revoked from a role: the pin survives on the user row (it is a
// display preference, not a grant, and nothing rewrites it when a role changes), while the
// grant behind it is gone. Rendering the pin alone would put a tab in the bar that bounces
// the user or 404s on arrival. The team editor already warns "role no longer grants this —
// won't show"; this is the code that makes that sentence true.
//
// The intersection is cosmetic, as every frontend permission check is — the route itself
// re-checks with requireFeature and is the real gate. A tab that leads nowhere is still a
// bug, and this is where it is prevented.
//
// WHY THE ORDER COMES FROM navTabs, NOT sortOrder
// -----------------------------------------------
// The bar used to be the first three granted root modules by `Module.sortOrder`, which is a
// global ordering an admin cannot change per person — pinning a tab moved nothing, which was
// the original report. We iterate `navTabs` and look each route up in `modules`, so the
// arrows in the team editor are the only thing that decides the order. `sortOrder` still
// orders the sidebar and /more; it has no say here.
//
// WHY EMPTY MEANS NO BAR
// ----------------------
// Owner decision, 7 Sep 2026: nothing pinned => the bar does not render, rather than the old
// behaviour of auto-picking their top three. `hasNav` is that decision, and it is false while
// the grants are still loading too — see bottom-nav.tsx for why we render nothing rather than
// a skeleton in that window.

import { useMemo } from "react";
import { usePermissions } from "@/lib/use-permissions";
import { MAX_NAV_TABS } from "@/lib/nav-tabs";
import { createLogger } from "@/lib/logger";

const log = createLogger("nav:tabs");

export interface BottomNavTab {
  key: string;
  href: string;
  label: string;
  icon: string | null;
}

export function useBottomNav(): { tabs: BottomNavTab[]; loading: boolean; hasNav: boolean } {
  const { navTabs, modules, loading } = usePermissions();

  const tabs = useMemo(() => {
    const resolved: BottomNavTab[] = [];

    for (const href of navTabs) {
      const granted = modules.find((m) => m.route === href);
      if (!granted) continue; // pinned, then the grant went away — skip it silently
      resolved.push({
        key: granted.key,
        href,
        label: granted.label,
        icon: granted.icon,
      });
      // Defence in depth: PUT /api/users/[id] already caps the stored list, but a row
      // written before that cap existed must not be allowed to overflow the bar.
      if (resolved.length >= MAX_NAV_TABS) break;
    }

    log.debug("resolved bottom nav", { pinned: navTabs.length, rendered: resolved.length });
    return resolved;
  }, [navTabs, modules]);

  return { tabs, loading, hasNav: tabs.length > 0 && !loading };
}
