// Navigation is derived from the `modules` table at runtime (see src/lib/rbac.ts and
// src/stores/permissions.ts), not from tables in this file.
//
// Everything that used to live here — getPrimaryTabs(), getDesktopExtraTabs(),
// FEATURE_NAV_ITEMS, NAV_FEATURE_MAP — was a per-role hardcoded list. Those lists were the
// reason granting someone a feature had no effect on what they could see: the nav ignored
// grants entirely. They are gone. Only the desktop route helper remains.

/** Map a dashboard href onto its /desktop equivalent. */
export function desktopHref(href: string): string {
  if (href === "/") return "/desktop";
  return `/desktop${href}`;
}
