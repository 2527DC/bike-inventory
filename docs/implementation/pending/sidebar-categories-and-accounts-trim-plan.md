# Categories in the sidebar, Bills and Expenses out of it

Status: pending — specified and ready to run. Decisions in §1 are answered; no blocking
questions.
Branch: **`feat/categories-module`** — cut from `perf/single-auth-query-v2`, not `main`, so
it carries the auth, S3 and accounts-module work that has not merged yet.
Prepared 30 Aug 2026. Every count below was measured against the tree, not estimated.

---

## 1. What was asked, and what was decided

| # | Ask | Decision |
|---|---|---|
| A | Bills & Payments and Expenses should not be in the sidebar | **Hide, do not delete.** `route: null` in the catalog; permissions and screens keep working |
| A2 | The home dashboard cards linking to `/bills` and `/expenses` | **Left alone.** Both screens stay reachable from the dashboard and by URL |
| B | A Categories module in the **Purchase** group, with a listing screen | Build it — §3 |

Part B was previously specified as Part B of `master-data-screens-and-filter-ui-plan.md`.
**It now lives here**, so that this plan can be run on its own without pulling in the filter
drawer, the brands rework and product delete. That plan's Part B points here.

---

## 2. Part A — take Bills and Expenses out of the sidebar

### Why hiding, not removing

The sidebar is not a list of links; it is `getAccess().modules` filtered by the user's
`view` grant. Deleting a module therefore deletes its permissions, and `userCan` answers
`undefined === true` → **false for everyone, ADMIN included**.

`bills` is referenced by **20 files**, not just `/bills`:

```
api/bills/*            api/payments/*        api/credits/route.ts
api/bank-statements/*  api/zoho/trigger-pull/route.ts
(dashboard)/accounts/settlement, /inbound, /vendors/[id], /bills,
settings/integrations, settings/integrations/pull-review, desktop/vendors, and the dashboard
```

So removing the module would 403 the Zoho bill pull, settlement, inbound receiving and the
vendor detail screen. `expenses` is smaller — 5 files — but the same argument applies.

### The mechanism

All three navigation surfaces are data-driven and already skip routeless entries:

| File | Behaviour |
|---|---|
| `src/components/app-sidebar.tsx:157` | "skip only when routeless AND childless" |
| `src/components/bottom-nav.tsx:24` | `.filter((m) => !m.parent && m.route && m.route !== "/")` |
| `src/components/desktop/sidebar.tsx` | same `modules` source |

Neither module has children, so `route: null` removes it from all three at once, and from
`/api/my-permissions` consumers that key off `route`.

### The change

`prisma/rbac-catalog.ts` — two lines:

```ts
{ key: "bills",    label: "Bills & Payments", ..., route: null, group: "Accounts", ... }
{ key: "expenses", label: "Expenses",         ..., route: null, group: "Accounts", ... }
```

Then `npm run db:seed:rbac`. The seeder's update block includes `route`
(`prisma/seed-rbac.ts:79`), so the existing rows are updated in place — no permission is
touched, no grant is lost, and reverting is the same two lines.

Add a comment at both entries saying the route is null **on purpose** and that restoring the
string is all it takes to bring them back. Without that, the next person reads it as a bug.

### What must still work afterwards

- `/bills` and `/expenses` open by URL and from the dashboard cards.
- The Zoho pull still imports bills (`trigger-pull` guards on `bills.fetch`).
- `/accounts` (the hub) and `/accounts/settlement` still open and still link to bills.
- `/team/permissions` still lists Bills and Expenses as grantable — an admin can still see
  and change who holds them. **This is the one visible consequence to confirm**: the
  permission matrix reads the same `modules` table, so check it still renders both rows.

---

## 3. Part B — the Categories module and screen

### The gap, precisely

```
/api/categories        GET (stock.view), POST (stock.create)   ← no PATCH, no DELETE, no merge
screen                 none
RBAC module            none — it borrows `stock`
Category.parentId      exists; nothing has ever written it, so the tree is flat
Product.categoryId     REQUIRED (schema.prisma:449) — which is why imports invent
                       "Uncategorized" rather than leaving it empty
```

Seven places create a `Category` and five are Zoho import routes that mirror
`category_name` verbatim. Nothing in the UI calls `POST /api/categories`. **The taxonomy is
entirely Zoho's and cannot be corrected from the app** — that is the actual problem this
screen solves.

### The catalog entry

```ts
{
  key: "categories",
  label: "Categories",
  description: "Product categories — the taxonomy Zoho imports into",
  icon: "Tag",
  route: "/more/categories",
  group: "Purchase",       // beside `brands` (220)
  sortOrder: 225,
  actions: CRUD,
}
```

> **Seed BEFORE guarding any route on it.** `userCan` resolves an unknown module key to
> false for **everyone including ADMIN**, so guarding first denies the screen to its own
> administrator and reads like a missing grant rather than a missing seed. Same trap as
> `stores` in the store-hierarchy plan.

Confirm `"Tag"` resolves in `src/lib/module-icons.ts` before seeding; an unmapped name
renders the fallback icon, which looks like a bug rather than a choice.

### The routes

| Route | Guard | Behaviour |
|---|---|---|
| `GET /api/categories` | **stays `stock.view`** | every product form reads it for a dropdown; re-guarding it would silently empty those dropdowns for anyone who is not a taxonomy admin — an empty list, not a 403 |
| `POST /api/categories` | `categories.create` | exists; re-guard |
| `PATCH /api/categories/[id]` | `categories.edit` | rename, description, `movingLevel`, `reorderLevel`, `parentId` |
| `DELETE /api/categories/[id]` | `categories.delete` | refuse with counts when products reference it |
| `POST /api/categories/[id]/merge` | `categories.create` | move products to the target, then delete the source |

**Copy `api/brands/[id]/route.ts` and `api/brands/[id]/merge/route.ts` rather than inventing
a shape.** Brands already implement exactly this: DELETE builds a `blockers` list from
`_count` and refuses with a readable message; merge runs `updateMany` + `delete` inside one
`$transaction`. Merge is guarded on `brands.create` there, which is why `categories.create`
is used above — same precedent, and merge does create nothing but does destroy the source,
so `edit` would be the wrong verb to imply.

Category's blocker counts are `products` and `children` (the self-relation) — a category
with children must not be deletable, or the tree orphans.

### The screen — `/more/categories`

Model it on `src/app/(dashboard)/more/brands/page.tsx` (401 lines): a card list, inline
rename, a create row, delete with `ActionConfirmation`, and a merge picker. Same imports,
same `usePermissions()` gating (`canCreate`/`canEdit`/`canDelete` on `"categories"`), same
`apiTry`/`apiFetch` usage, `SkeletonList` while loading and `ErrorBanner` on failure.

Per row show: name, product count, moving level, reorder level, and whether it is a child.

**Merge is the operation that matters.** With ~9 categories, several of which are wheel
sizes (`12`, `14`, `16`, `20`, `24 SS`, `29 MS` — Zoho's only non-blank values) and 151
products sitting in `Uncategorized`, the useful action is "move everything in `16` into
`Bicycles`, then delete `16`". Make merge a first-class button, not a menu item.

---

## 4. Files

| File | Change |
|---|---|
| `prisma/rbac-catalog.ts` | `bills.route` and `expenses.route` → `null`; new `categories` module |
| `src/app/api/categories/route.ts` | POST re-guarded on `categories.create`; drop the inert `revalidate = 300` (the route reads cookies via the guard, so it is already dynamic) |
| `src/app/api/categories/[id]/route.ts` | **new** — PATCH, DELETE |
| `src/app/api/categories/[id]/merge/route.ts` | **new** — POST |
| `src/app/(dashboard)/more/categories/page.tsx` | **new** — the screen |
| `src/lib/validations.ts` | extend `categorySchema` for PATCH (partial) |

No change to any navigation component. Both halves of this plan are catalog + seed.

## 5. Order

```
1  Part A   route: null on bills + expenses, seed, confirm the sidebar and /team/permissions
2  Part B   catalog entry + seed FIRST (the trap above), then routes, then the screen
```

## 6. Verification

- `npm run build` passes.
- Sidebar: Bills & Payments and Expenses are gone; **Categories** appears under Purchase
  between Brands (220) and Vendor / Ops Issues (230).
- `/bills` and `/expenses` still open by URL and from the dashboard cards; `/accounts` and
  settlement still work; a Zoho bill pull still imports.
- `/team/permissions` still lists Bills, Expenses and the new Categories rows.
- On `/more/categories`: rename a category; create one; try to delete one that has products
  and read the refusal; merge a wheel-size category into a real one and confirm the products
  moved and the source is gone.
- Sign in as a role WITHOUT `categories` grants: the sidebar entry is absent and the API
  returns 403. Frontend hiding is cosmetic — check the API, not just the button.

## 7. Board of Agents

- **Inventory consultant** — the taxonomy is product master data; merge changes what every
  stock report groups by.
- **Database architect** — `Category` is self-referencing; deleting a parent with children,
  and merging a category that is someone's parent, both need deciding rather than
  discovering.
