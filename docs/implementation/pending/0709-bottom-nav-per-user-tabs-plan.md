# Bottom navigation — make the per-user pin actually drive the PWA tab bar

Status: **PLANNED, not started** — written 7 Sep 2026.
Branch: **not cut yet.** Ask the owner which branch to base this on before creating one.

## The report

> "When I select the bottom navigation in the permission for the role it's not reflecting the
> same in the bottom navigation in the PWA."

Reproduced by reading the code. The setting is saved correctly and then ignored by everything
that renders. **No schema change is required** — the column already exists.

---

## 1. Root cause — the write path is complete, the read path was never built

`User.navTabs` (`prisma/schema.prisma:362`, column present since `prisma/migrations/0_init/migration.sql:231`)
is written by the admin UI and read back into that same admin form, which is why the selection
*looks* saved and sticky. Nothing on the rendering side has ever read it.

The chain breaks at five consecutive links:

| # | Link | File | State |
|---|---|---|---|
| 1 | Admin picks/orders/removes tabs | `src/app/(dashboard)/team/[id]/page.tsx:156-170, 310-395` | works |
| 2 | `PUT` sanitises against real routes, de-dupes, caps, persists | `src/app/api/users/[id]/route.ts:96-108` | works |
| 3 | `getAccess()` selects the user row | `src/lib/rbac.ts:121-140` | **never selects `navTabs`** |
| 4 | `ResolvedAccess` carries the user | `src/lib/rbac.ts:80-101` | **no `navTabs` field** |
| 5 | `GET /api/my-permissions` returns the bootstrap | `src/app/api/my-permissions/route.ts:16-21` | **omits `navTabs`** |
| 6 | Client store holds grants | `src/stores/permissions.ts:49-56, 86-99` | **no `navTabs`** |
| 7 | The tab bar renders | `src/components/bottom-nav.tsx:23-25` | **ignores the pin** |

Link 7 is the visible symptom. `bottom-nav.tsx` builds its middle tabs as:

```ts
const middle = modules
  .filter((m) => !m.parent && m.route && m.route !== "/")
  .slice(0, MAX_MIDDLE_TABS);
```

— the first three granted **root** modules by `Module.sortOrder`. The admin's choice never
enters the expression. Change the pin, and the bar is byte-identical because `sortOrder`
did not move.

### 1a. Second, independent bug — the cap disagrees with itself

`MAX_NAV_TABS = 4` in **two** places (`team/[id]/page.tsx:53`, `api/users/[id]/route.ts:14`)
but `MAX_MIDDLE_TABS = 3` in `bottom-nav.tsx:13`. The admin can pin a 4th tab, the API will
happily store it, and the bar would silently drop it. Three copies of one number in three
files is why they drifted; the fix is one exported constant, not three edits.

### 1b. What does NOT exist

`/team/permissions` (`src/app/(dashboard)/team/permissions/page.tsx`) edits role→permission
grants only. The `Role` model (`prisma/schema.prisma:82-97`) has **no nav column**. There is no
role-level nav pinning anywhere in the codebase — the only pinning is per-user, on the user's
own edit page. Confirmed with the owner: per-user is the intended behaviour, so nothing
role-level is being built here.

---

## 2. Decisions taken (owner, 7 Sep 2026)

| Question | Decision |
|---|---|
| Per-user or per-role? | **Per-user**, edited where it is today — on the user's edit page. |
| Nothing pinned? | **Hide the bottom bar completely.** Not the current "auto-pick their top 3". |
| How many tabs? | **Cap stays 4.** The bar renders up to 4 middle tabs (Home + 4 + More = 6). |

---

## 3. Blocking concern the owner must read before Phase 3

**On mobile, the bottom bar is the only navigation that exists.** `src/components/header.tsx`
is a logo, the user's name and an avatar circle — there is no menu button, no drawer, no links
(the whole file is 38 lines; a grep for `Menu|drawer|Sheet|Link` returns nothing). The desktop
sidebar is `hidden lg:flex` (`src/app/(dashboard)/layout.tsx:35`).

So a user with an empty `navTabs` on a phone gets **no bottom bar, no More button and no menu**.
They land on `/` and can only reach whatever that page happens to link to. This also strands the
admin who is configuring it, on their own phone, with no route back to `/team`.

This follows directly from the chosen behaviour and is not a reason to refuse it — but it should
be a deliberate choice, not a discovery in production. **Phase 4 is the safety net and I
recommend shipping it in the same PR.** If the owner declines Phase 4, ship Phases 1-3 as
specified and treat empty-`navTabs` as an admin error to avoid.

---

## 4. Phases

### Phase 1 — one cap constant, three call sites

**New:** `src/lib/nav-tabs.ts`

```ts
/** Maximum bottom-nav tabs an admin may pin. Home and More sit outside this count.
 *  Lived in three files and drifted (4 / 4 / 3), so the 4th pinned tab never rendered. */
export const MAX_NAV_TABS = 4;
```

**Edit:** delete the local constant in `team/[id]/page.tsx:53` and `api/users/[id]/route.ts:14`;
delete `MAX_MIDDLE_TABS` in `bottom-nav.tsx:13`. All three import from `@/lib/nav-tabs`.

No behaviour change on its own. Done first so Phase 3 has one number to honour.

### Phase 2 — carry `navTabs` from the database to the client

Four small edits, one per broken link:

1. **`src/lib/rbac.ts`** — add `navTabs: true` to the `prisma.user.findUnique` select
   (~line 130, beside `warehouseId`), and `navTabs: string[]` to `ResolvedAccess.user`
   (~line 96) with a comment saying it is a display preference, not a grant. Add
   `navTabs: []` to `EMPTY_ACCESS`. This rides the existing single User read — **no extra
   query**, which is the property `getAccess` was built to hold.
2. **`src/app/api/my-permissions/route.ts`** — return `navTabs: access.user?.navTabs ?? []`
   in the payload.
3. **`src/stores/permissions.ts`** — `navTabs: string[]` on the state, set it in the success
   branch (~line 91), and clear it to `[]` in the two reset/failure branches (~lines 96-99,
   134-139) so a signed-out user cannot inherit the last user's bar.
4. **`src/lib/use-permissions.ts`** — subscribe and return `navTabs`.

Logging (`createLogger("nav:tabs")`): `log.debug` the resolved tab count on load. Nothing here
is a secret; log counts and routes, never the user row.

### Phase 3 — render the pin, hide the bar when there is none

**New:** `src/lib/use-bottom-nav.ts` — one hook, so the bar and the layout can never disagree
about whether a bar exists.

```ts
// Resolves the tabs this user's bar should show.
//   - `navTabs` is admin intent; `modules` is what the role actually grants.
//   - INTERSECT the two, in the admin's order. A pinned route whose grant was later revoked
//     must not render: the team page already warns "role no longer grants this - won't show",
//     and the frontend is cosmetic anyway (the route re-checks), but a dead tab is a bug.
//   - Empty result => no bar at all (owner decision, 7 Sep).
```

Returns `{ tabs, loading, hasNav }`.

**Edit `src/components/bottom-nav.tsx`:** consume the hook. Delete the `.slice(0, N)` on
`sortOrder`. `if (!hasNav) return null`.

**While `loading`:** render **nothing** (no bar, no reserved space) rather than the current
5-cell skeleton. A skeleton would flash a bar that then vanishes for exactly the users who have
none. Users with tabs get one small shift when grants land; the store resolves once per session.
*If the owner prefers no shift over no flash, keep the skeleton and accept the flash — flag it.*

**Edit `src/app/(dashboard)/layout.tsx`:** the layout must stop reserving space when there is no
bar. `main` uses `pb-nav` (`src/app/globals.css:59-61`), and **nine** other elements position
themselves with `.above-nav` (`globals.css:69-71`) across `accounts/reconcile/[id]`,
`deliveries/dispatch`, `receivables`, `services/counter`, `stock`, `stock-audit/brand-count`,
`team/permissions`, `transfers/new`, `transfers/[id]`.

**Do not edit those eleven files.** Both rules resolve `var(--bottom-nav-height)`
(`globals.css:6`), and custom properties inherit — so overriding the variable on the layout root
corrects every dependent at once:

```css
/* globals.css - the bar is per-user now; when it is absent nothing may reserve its height. */
.nav-hidden { --bottom-nav-height: 0px; }
```

```tsx
<div className={cn("flex min-h-screen", !hasNav && "nav-hidden")}>
```

That is the root-cause fix. Patching `pb-nav` alone would leave nine fixed elements floating
64px above a bar that is not there.

**Edit `team/[id]/page.tsx:315-318`** — the helper text is now wrong. It reads "Leave empty to
use their highest-priority modules automatically." It must say that leaving it empty means the
person gets **no bottom navigation on their phone**, and warn when the admin is about to save an
empty list.

### Phase 4 — the safety net (recommended; owner's call — see §3)

Add a menu button to `src/components/header.tsx` opening the existing module list (the same
`modules` the `/more` page already renders, `src/app/(dashboard)/more/page.tsx:17,64-72`) so
mobile navigation never depends on the bar being present. Without this, an empty pin is
unrecoverable on a phone.

### Phase 5 — delete dead code

`src/components/lms-bottom-nav.tsx` is a hardcoded `NAV_ITEMS` bar that **nothing imports**
(a grep for `LmsBottomNav` across `src` returns only its own definition). It is a second,
divergent answer to this exact question sitting in the tree waiting to be copied. Delete it,
or say why it stays.

---

## 5. Files touched

| File | Phase | Change |
|---|---|---|
| `src/lib/nav-tabs.ts` | 1 | new — the one cap constant |
| `src/app/(dashboard)/team/[id]/page.tsx` | 1, 3 | import the constant; correct the helper text |
| `src/app/api/users/[id]/route.ts` | 1 | import the constant |
| `src/lib/rbac.ts` | 2 | select + type `navTabs` |
| `src/app/api/my-permissions/route.ts` | 2 | return `navTabs` |
| `src/stores/permissions.ts` | 2 | hold + clear `navTabs` |
| `src/lib/use-permissions.ts` | 2 | expose `navTabs` |
| `src/lib/use-bottom-nav.ts` | 3 | new — resolve pin against grants |
| `src/components/bottom-nav.tsx` | 1, 3 | render the pin; return null when empty |
| `src/app/(dashboard)/layout.tsx` | 3 | `.nav-hidden` when no bar |
| `src/app/globals.css` | 3 | `.nav-hidden { --bottom-nav-height: 0px }` |
| `src/components/header.tsx` | 4 | mobile menu (optional) |
| `src/components/lms-bottom-nav.tsx` | 5 | delete |

**No migration.** `navTabs` already exists in `0_init`. Nothing in `prisma/` changes, so none of
the migration rules in CLAUDE.md are engaged.

## 6. What might break

- **`/more` is unaffected** — it renders `modules`, not `navTabs`, and stays the full menu.
- **Desktop is unaffected** — the bar is `lg:hidden` already; `.nav-hidden` only zeroes a
  variable that desktop does not use for `main` (`lg:pb-10`).
  *Observation, pre-existing:* `.above-nav` elements offset by 64px on desktop where no bar has
  ever rendered. Out of scope; not introduced here.
- **Every existing user has `navTabs = []`** (the column default, never written for anyone the
  admin has not edited). **Shipping Phase 3 therefore removes the bottom bar for every user at
  once** until an admin pins tabs for each of them. This is the single biggest operational
  consequence of the plan and it needs the owner's explicit sign-off, plus a decision:
  backfill each user's current auto-picked three into `navTabs` before the deploy, or accept
  the blank slate. **Ask before building Phase 3.**

## 7. Verification

1. `npm run build` must pass (background it — it exceeds the 10-minute foreground limit).
2. `/team/<user>` → pin 2 tabs → save → reload that user's session on a phone or a narrow
   viewport: exactly those 2 appear, in that order, between Home and More.
3. Pin 4 → all 4 render (this is the `MAX_NAV_TABS` drift regression test).
4. Reorder with the arrows → the bar order follows.
5. Pin a module, then revoke that module's `view` from the role → the tab disappears and the
   team page shows its "role no longer grants this" warning.
6. Clear all pins → no bar, and **no dead 64px gap** at the bottom of `/stock`,
   `/receivables` and `/transfers/new` (the `.above-nav` pages).
7. Sign out and in as a user with a different pin → no bleed from the previous user's bar.

## Clarifications

**7 Sep 2026, owner** — per-user not per-role; empty means hide the bar entirely; cap stays 4.
Raised in return: the mobile header has no navigation of its own, so "hide entirely" strands a
phone user with no pins (§3), and every existing user currently has an empty `navTabs` (§6).
Both need a decision before Phase 3 is built.
