// ─── Bottom navigation: the one shared constant ──────────────────────────────
//
// The cap on how many tabs an admin may pin for a user lived in THREE files and drifted:
// `MAX_NAV_TABS = 4` in the team editor and in PUT /api/users/[id], but `MAX_MIDDLE_TABS = 3`
// in bottom-nav.tsx. The admin could pin a fourth tab, the API stored it, and the bar dropped
// it on the floor with no error. One number, one home, imported by all three.
//
// Home is NOT counted here — it sits outside the pinned set, so a full bar is
// Home + MAX_NAV_TABS. (There was a More button too; removed 23 Sep 2026.)

export const MAX_NAV_TABS = 4;
