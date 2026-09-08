# Remove the Per Item view, the By Brand screen, and the view-toggle bar

Status: completed — 8 Sep 2026, Per Item, the By Brand screen and the view-tab bar are gone; the product list is untouched and keeps a single By Location link.

`/stock` grew four ways to look at the same rows: **List View**, **Per Item**, **By Brand**
and **By Bin / By Location**. Three of them go. The product list stays and becomes the page.

## Owner's decision, 8 Sep 2026

> *"I don't need the list button but I need to see the product listing."*

So this is **not** a removal of the product list. It is the removal of the *toggle* around it:

| | |
|---|---|
| **Deleted** | the Per Item view · the `/stock/by-brand` screen · the whole 4-button view-tab bar, **including the "List View" button** |
| **Kept** | the product listing itself — search, filters, select mode, bulk brand/status/category/bin/vendor, deactivate/restore, reorder sheet, Excel/PDF export, the brand & category colour pills |
| **Kept** | one **By Location** link to `/stock/by-bin`, re-sited as a standalone element |

The "List View" button cannot survive on its own: its active styling is
`stockView === "list" ? …`, so once `per-item` is gone it is a permanently-pressed button
that toggles nothing.

## What this costs

Nothing that exists elsewhere. Verified: `/api/stock/by-brand` and `/api/stock/per-item` each
have **exactly one caller**, both being deleted here. Neither has any other consumer in the
repo.

One casualty worth naming: the grouped-card brand/category pills added earlier today live at
`stock/page.tsx:1267-1285`, **inside `PerItemView`**, and go with it. The pills on the main
list card (~`:800-830`) are untouched, so the feature survives on the view being kept.

---

## §1 — Files deleted outright

| file | lines | guard | other callers |
|---|---|---|---|
| `src/app/(dashboard)/stock/by-brand/page.tsx` | 335 | client page | — |
| `src/app/api/stock/by-brand/route.ts` | 88 | `requireFeature("stock","view")` | **none** |
| `src/app/api/stock/per-item/route.ts` | 144 | `requireFeature("stock","view")` | **none** |

Remove the three now-empty directories too.

`by-brand/page.tsx:70` also calls `/api/products?brandId=…` — that is the shared products
route. **Do not delete it.**

## §2 — `src/app/(dashboard)/stock/page.tsx`

Delete **bottom-up**, so earlier line numbers stay valid:

| # | lines | what |
|---|---|---|
| 1 | 1160–1356 | `PerItemView` banner comment, `formatRelativeDate` (used only at 1329/1332), `PerItemView` itself |
| 2 | 1155 | `</>}` — the list-view fragment close |
| 3 | 599–600 | `{/* LIST VIEW */}` banner + `{stockView === "list" && <>` |
| 4 | 584–597 | the per-item render block + its banner |
| 5 | 552–582 | the entire View Tabs bar |
| 6 | 202–204 | the `useEffect` keyed on `stockView` |
| 7 | 188–200 | `fetchPerItemData` |
| 8 | 179–186 | the comment, `stockView` state, all five `perItem*` states, `expandedItem` |
| 9 | 87 | `type StockView` |
| 10 | 64–85 | `interface PerItemBin`, `interface PerItemGroup` |

Then:

- **Re-indent** the former list-view body (601–1154) out one level — it is no longer inside a
  conditional fragment.
- **Re-insert the By Location link** that was at 578–581 as a standalone element near the
  header. Keep `BIN_TRACKING_ENABLED ? "By Bin" : "By Location"` exactly as it reads today.
- **Remove `ChevronRight`** from the lucide import on line 7 — its only other use was at 1293
  inside `PerItemView`.
- **Keep** `Package`, `MapPin`, `Search`, `Link`, `useDebounce`, `useCallback`, `Card`,
  `CardContent`, `Badge`, `Input`, `SkeletonList`, `isPlaceholderBrand`,
  `isPlaceholderCategory`, `BIN_TRACKING_ENABLED`, `BrandItem` — each was checked
  individually and each still has a use in the list view.
- Fix the stale comment at old line 839: `Same pattern as stock/by-brand and stock/[id].` →
  drop the by-brand half.

## §3 — Comments and docs

- `src/lib/reorder.ts:31` — *"Three raw-SQL copies (`api/stock/summary`, `api/stock/by-brand`,
  `api/stock/by-bin`)"* → **two**. The other two are independent copies of the same predicate,
  not callers; deleting by-brand does not affect them.
- `docs/data-flow-and-modules.md:173` — drop `/by-brand` from the child-route list.
- `docs/schema/accounts-group.md:35` — drop `stock/by-brand/page.tsx`.
- Leave `docs/implementation/completed/*` and `pending/0409-*` alone — historical record.

## §4 — No RBAC and no database work

Checked explicitly, because deleting a route that someone has pinned to their bottom nav would
be a silent breakage:

- **No `Module` in `prisma/rbac-catalog.ts` has `route: "/stock/by-brand"`.** The stock-family
  routes are `/stock-management`, `/stock`, `/brand-stock`, `/stock-audit` only.
- `User.navTabs` can only ever hold a module `route` — the team editor offers module rows
  (`team/[id]/page.tsx:153`, `:409`), never a free-typed path.
- Even a hand-written value would be **silently skipped**: `use-bottom-nav.ts:59-61` drops a
  pinned route that matches no granted module.

So: no catalog edit, no `db:seed:rbac`, no migration, no `navTabs` cleanup.

## §5 — Verification

1. `npx tsc --noEmit` — catches any missed `PerItemGroup` / `stockView` / `ChevronRight`
   reference.
2. `npx eslint "src/app/(dashboard)/stock/page.tsx"` — catches unused imports. Two warnings at
   old lines 134 and 227 are **pre-existing**; anything else is new.
3. `npm run build` — must pass.
4. Open `/stock`: the product list renders with no tab bar above it, a By Location link is
   present and works, search/filters/select mode/bulk actions/deactivate/reorder/export all
   still function, and the brand + category pills still render on the cards.
5. `/stock/by-brand` returns 404.
