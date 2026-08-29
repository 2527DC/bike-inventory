# Frontend role-name checks — removal plan

Status: pending — 16 client-side gates read a session field that no longer exists, so every one of them denies everybody
Suggested branch: `fix/frontend-role-checks` (its own branch — it touches 15 page files plus the RBAC catalog).
Prepared 29 Aug 2026.

---

## 1. The bug, in three lines

`src/app/(dashboard)/more/brands/page.tsx:20`

```ts
const role = (session?.user as { role?: string })?.role || "";
const isAdmin = role === "ADMIN" || role === "CEO";
```

`src/lib/auth.ts:101` — what the session callback actually sets:

```ts
u.userId   = token.userId;
u.roleKey  = token.roleKey;
u.roleName = token.roleName;
```

There is no `role` field. It was removed when the app moved to dynamic RBAC, because
CLAUDE.md requires the JWT to carry identity only. So `role` is `""`, `isAdmin` is `false`,
and the page reports **"Admin access required" to every user including ADMIN**.

## 2. Why this went unnoticed

It fails in the safe direction. An over-restrictive gate hides a feature; it does not leak
one. Nothing throws, nothing 500s, no log line is written. The screen simply renders its
denial branch, which looks exactly like a permission that was never granted — so the
instinct is to go and fix the seed, which cannot possibly help, because the page never asks
the database anything.

Reseeding RBAC will not change the outcome. Neither will granting more permissions. The
check does not consult the permission system at all.

## 3. This is the rule CLAUDE.md puts first

> **Never compare a role name.** `if (user.role === "ADMIN")` and
> `["SUPERVISOR","MANAGER"].includes(role)` are both wrong.

The stated reason is that roles are rows an admin can create at runtime, so no list of names
in code can be correct. This plan is the second, sharper reason: the field those comparisons
read was deleted, and comparing against a name gave no compile-time signal when it went.
A `can("brands", "create")` call would have been a type error the day the field changed.

## 4. Not a security hole

Every API behind these screens guards itself properly:

| Route | Guard |
|---|---|
| `api/brands/[id]/merge/route.ts:13` | `requireFeature("brands", "create")` |
| `api/brands/route.ts:11,25` | `requireFeature("brands", "view" / "create")` |
| `api/bins/route.ts:11,26` | `requireFeature("settings", "view" / "create")` |

The frontend is over-restrictive, not under. Nothing is exposed. The screens are just
unusable — which is why this is a bug and not an incident.

## 5. Scope — 16 sites in 15 files

All read `session.user.role`. All are permanently false.

| File | Line(s) |
|---|---|
| `(dashboard)/more/brands/page.tsx` | 21 |
| `(dashboard)/more/bins/page.tsx` | 29 |
| `(dashboard)/more/problems/page.tsx` | 25 |
| `(dashboard)/more/app-logic/page.tsx` | 581 |
| `(dashboard)/deliveries/page.tsx` | 29 |
| `(dashboard)/price-correction/page.tsx` | 68, 134 |
| `(dashboard)/second-hand/page.tsx` | 58, 114 |
| `(dashboard)/second-hand/verify/page.tsx` | 27 |
| `(dashboard)/second-hand/[id]/page.tsx` | 56 |
| `(dashboard)/stock/[id]/page.tsx` | 87 |
| `(dashboard)/stock/by-brand/page.tsx` | 62 |
| `(dashboard)/inbound/[id]/page.tsx` | 84 |
| `(dashboard)/vendor-issues/page.tsx` | 104 |
| `(dashboard)/activity/page.tsx` | 60 |
| `desktop/activity/page.tsx` | 59 |
| `(dashboard)/accounts/settlement/page.tsx` | 49 |

`accounts/settlement` is the only partial survivor: it reads
`role === "ADMIN" || role === "CEO" || canDeleteCheck("bills")`, so the permission half
still works and the role half is dead weight.

## 6. The mapping

Each permission is taken from what the API already enforces, or from the CLAUDE.md rule that
covers the case. No new judgement was invented where an existing guard already answered it.

| # | File | What it really gates | Becomes |
|---|---|---|---|
| 1 | `more/brands` | whole page (brand merge) | `canCreate("brands")` |
| 2 | `more/bins` | whole page | `canCreate("settings")` |
| 3 | `more/problems` | resolve action on open problems | `canEdit("problems")` |
| 4 | `more/app-logic` | whole page | `canView("settings")` |
| 5 | `deliveries` | delete button + `isAdmin` prop to child | `canDelete("deliveries")` |
| 6 | `price-correction` | whole page | **open — see §8 Q1** |
| 7 | `second-hand` | cost value, revenue, prices **and** actions | split: `canView("cost_price")` + `canEdit("second_hand")` |
| 8 | `second-hand/verify` | whole page | `canApprove("second_hand")` |
| 9 | `second-hand/[id]` | margin, cost **and** an action | split, as row 7 |
| 10 | `stock/[id]` | the Pricing card (Cost / Selling / MRP) | `canView("cost_price")` |
| 11 | `stock/by-brand` | brand total value + "Highest Value" sort | `canView("cost_price")` |
| 12 | `inbound/[id]` | line rate/amount **and** approval bypass | split: `canView("cost_price")` + `canApprove("inbound")` |
| 13 | `vendor-issues` | delete button + delete column | `canDelete("vendor_issues")` |
| 14 | `activity` | Team Activity vs My Activity | `canApprove("activity")` |
| 15 | `desktop/activity` | same | `canApprove("activity")` |
| 16 | `accounts/settlement` | already permission-gated | delete the role half only |

### Four flags were doing two jobs

Rows 7, 9, 11 and 12 used one `isAdmin` to hide **money** and to gate an **action**. Those
are different questions and get different permissions. `cost_price` exists as its own module
for exactly this reason — CLAUDE.md: *"Cost-price visibility is its own module."* Collapsing
the two back together would recreate the problem in permission form.

### The shared edit

```ts
// out
const { data: session } = useSession();
const role = (session?.user as { role?: string })?.role || "";
const isAdmin = role === "ADMIN" || role === "CEO";

// in
const { canView, canEdit, canDelete, canApprove, canCreate, loading } = usePermissions();
```

**Every denial branch must check `loading` first.** `usePermissions` exposes it precisely
so a page never renders a denial against a permission set that has not arrived yet. Skipping
this produces a flash of "Admin access required" on every visit — the same symptom as the
bug being fixed, which would make the fix look like it failed.

## 7. One catalog change is required

`prisma/rbac-catalog.ts:81` — the `activity` module declares:

```ts
actions: ["view", "create"],
```

There is no `approve`. But "supervisors see everyone's activity, staff see only their own"
is precisely the rule CLAUDE.md says to express as the module's `approve` grant:

> Rules like "supervisors see all records, juniors see only their own" are expressed as the
> module's **`approve`** grant.

So:

```ts
actions: ["view", "create", "approve"],
```

**This makes `npm run db:seed:rbac` part of the change, not optional cleanup.** Until it
runs, the permission row does not exist and sites 14 and 15 deny everyone — the exact
failure this plan removes. Editing `prisma/` also fires the schema-review hook.

Every other action needed already exists, verified against the catalog:

| Module | Actions | Needed |
|---|---|---|
| `cost_price` | `["view"]` | `view` |
| `second_hand` | `view create edit delete approve` | `edit`, `approve` |
| `inbound` | `view create edit delete approve fetch` | `approve` |
| `deliveries` | `view create edit delete approve fetch` | `delete` |
| `vendor_issues` | `view create edit delete approve` | `delete` |
| `problems` | `view create edit delete` | `edit` |
| `brands` | CRUD | `create` |
| `settings` | `view create edit delete` | `view`, `create` |

## 8. Open questions — answer before building

**Q1 — `price-correction` has no module.** Nothing in `MODULE_CATALOG` covers it. Either
gate it on `canEdit("stock")`, or add a `price_correction` module. Note that
`docs/doubt-clarification.md` line 13 asks *"Price Correction why do u have that module"* —
if the screen is going away, neither option is worth doing and site 6 should be dropped from
this plan.

**Q2 — sites 3 and 4 are slated for deletion.**
`docs/implementation/pending/app-logic-and-problems-removal-plan.md` deletes both
`/more/app-logic` and `/more/problems`, and removes the `problems` module from the catalog
entirely. Fixing them here is work that gets thrown away. Fix anyway so they are usable in
the meantime, or skip both and let the removal plan handle them?

**Q3 — site 12 is a behaviour change, not a reveal.** `inbound/[id]:176`:

```ts
const isApproved = !!shipment?.approvedAt || isAdmin;
```

An admin is treated as approved whether or not the shipment was approved. Today that bypass
is dead, because `isAdmin` is always false. Mapping it to `canApprove("inbound")` **restores
a bypass that is currently not happening**. Every other site in this plan only reveals hidden
UI; this one changes what the app does. Confirm that the original intent is what you want
back, or say it should become `!!shipment?.approvedAt` with no bypass at all.

## 9. Found in passing — not in this plan

`(dashboard)/services/counter/page.tsx:161`:

```ts
const isMechanic = currentUser?.role === "MECHANIC";
```

Different shape: `currentUser` comes from an API fetch rather than the session, and the
catalog's key is `SERVICE_MECHANIC`, not `MECHANIC` — so this likely never matches either.
It drives self-assignment convenience (auto-assigning a job to yourself), not access, so it
needs its own decision about intended behaviour rather than a mechanical permission swap.
Excluded deliberately; raise it separately.

## 10. Rollout

1. Branch `fix/frontend-role-checks` off `main`.
2. Answer Q1–Q3. Q2 in particular decides whether this is 16 sites or 14.
3. Add `approve` to the `activity` module in `prisma/rbac-catalog.ts`.
4. Stop the dev server, then `npm run db:seed:rbac`. (`prisma generate` fails with `EPERM`
   while the server holds the query engine.)
5. Convert the sites, one file at a time, splitting the four dual-purpose flags.
6. `npm run build`.

## 11. Verification

- `npm run build` passes. These files are all under `src/`, so the build type-checks them —
  unlike a `prisma/` change, which it does not.
- `grep -rn 'session?.user as { role' src/` returns **nothing**.
- `grep -rn 'role === "ADMIN"\|role === "CEO"' src/app/` returns **nothing**.
- Signed in as ADMIN, every one of the 16 screens renders its full UI. Today they render a
  denial or hide the element.
- No flash of denial on load — reload each screen and watch. A flash means a `loading` check
  was missed.
- The real proof, and the reason for the whole design: create a role in the UI holding only
  `cost_price.view`, assign it to a test user, and confirm they see prices on `stock/[id]`
  but still cannot delete on `deliveries`. That is one permission granted at runtime with no
  redeploy — which no role-name comparison could ever have expressed.

## 12. Not covered here

Two other problems surfaced in the same session and each needs its own plan and branch:

- **`/api/zoho/trigger-pull` `items` step times out (504).** It runs 2–3 sequential Prisma
  round trips per item against a Singapore database from a Mumbai region, under a
  `maxDuration = 30`. The `bills` step in the same file does the same job in three round
  trips total. The fix is to batch `items` the way `bills` already is.
- **Sample data still in the live database.** `prisma/seed.ts` no longer creates products,
  brands, bins, transactions or LMS content, but a seed only ever writes — the rows written
  by earlier runs are still in Supabase and still render in the UI. Removing them is a
  separate, destructive decision.
