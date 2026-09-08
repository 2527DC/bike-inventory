# Brand & Category: one creation path, and a Fetch from Zoho on their own screens

Status: pending — written 8 Sep 2026.

Supersedes the unbuilt parts of `0709-zoho-brand-category-sync-plan.md`. That plan's §3
(`Brand.zohoBrandId`, `Category.zohoCategoryId`) is **already shipped** — migration
`20260908090622_zoho_brand_category_ids`, applied 8 Sep. Everything below builds on those two
columns existing.

---

## The problem, in one sentence

Seven code paths can create a Brand or a Category, five of them are imports that invent
taxonomy as a side effect of doing something else, and the worst of them mints a **brand out
of a bill's vendor name**.

Verified on disk, 8 Sep 2026:

| # | file:line | creates | from | class |
|---|---|---|---|---|
| 1 | `api/brands/route.ts:29` | Brand | admin screen | **deliberate CRUD — keep** |
| 2 | `api/categories/route.ts:50` | Category | admin screen | **deliberate CRUD — keep** |
| 3 | `api/zoho/pull-review/approve/route.ts:175` | Brand | `d.vendorName` | import side effect |
| 4 | `api/zoho/pull-review/approve/route.ts:179` | Category | `"Uncategorized"` | placeholder — one row ever |
| 5 | `api/zoho/pull-review/approve/route.ts:237` | Category | Zoho `item.category_name` | import side effect, **unbounded** |
| 6 | `api/zoho/pull-review/approve/route.ts:312` | Brand | `d.vendorName` again | **redundant duplicate of #3** |
| 7 | `api/stock-counts/[id]/route.ts:282` | Brand | `item.suggestedBrand` | import side effect |

### Why this is worse than clutter

`isPlaceholderBrand()` only knows `Imported` / `Unbranded` / `General`. A brand invented from
a vendor name is **none of those**, so a product imported from a bill:

- renders in the blue "real brand" pill on `/stock`, and
- **never enters the "Needs details" queue.**

It looks described. It isn't. That is the actual bug this plan closes.

### Two live defects found while mapping

- `approve/route.ts:237` does a **case-sensitive** `findFirst` against a `@unique` name.
  Zoho returning `"Tyres"` when the row is `"tyres"` throws a unique-constraint error, which
  the per-preview `catch` swallows into `results.errors` — the whole bill fails on a case
  difference.
- Brand / Category / Product / Vendor are all **read-then-create**, never `upsert`. Racy on
  the unique name columns.

---

## Decisions (owner, 8 Sep 2026)

| # | Question | Answer |
|---|---|---|
| D1 | Inbound meets an unknown brand — `Product.brandId` is non-null, so it needs *something* | **Fall back to `Unbranded`.** Record the real name in the import result. The product lands in the "Needs details" queue, which is where brands get fixed in bulk. **The import never fails on this.** |
| D2 | What does Fetch pull into the review sheet? | **All of them** — all 151 Zoho brands, all 33 categories. Nothing filtered out. Vendor-shaped rows are *flagged*, not hidden. |
| D3 | A local brand whose name matches a Zoho brand | **Auto-adopt silently.** Fill `zohoBrandId` on the existing row. No new row, no tick. Only genuinely new names are tickable. |
| D4 | Zoho's `parent_category_id` | **Ignore it. Import flat.** Arrange the tree by hand on `/categories`. |

---

## §1 — Design decision: do NOT reuse the ZohoPullPreview machinery

The obvious move is to stage brands as `ZohoPullPreview` rows like bills and invoices.
`entityType` is a free `String` (`schema.prisma:1583`), so it would work with no migration.

**Rejected.** Reusing it drags in five unrelated edits, each a place to get it wrong:

- `ZohoPullLog` has fixed counter columns `contactsNew/itemsNew/billsNew/invoicesNew`
  (`schema.prisma:1599-1614`) — no `brandsNew`. Needs a migration or a lie.
- `zohoPullSchema` enums the step: `z.enum(["init","bills","invoices","finalize"])`
  (`validations.ts:1064-1081`).
- `pull-review/route.ts:37-42` hardcodes four buckets; a fifth entityType is invisible in
  `latest.previews`.
- `approve/route.ts:111/:395` dispatches on entityType and an **unknown one falls through
  both branches and is still marked APPROVED** (`:481-484`) — a silent no-op.
- `pull-review/export/route.ts:31-44` has another per-entityType switch.

Brands and categories are a **master-data sync**, not a transactional pull. They need no
`pullId`, no audit trail of what was previewed, and no cross-session resume. Two stateless
routes per entity are smaller, and touch nothing that currently works.

**Preview writes nothing.** That rule carries over from the 0709 plan and is not negotiable.

---

## §2 — Zoho client (`src/lib/integrations/`)

`apiCall` is `protected` on purpose (`base.ts:263`), so every Zoho call is a method on the
client plus an `ENDPOINTS` entry — a missing entry is a compile error.

**`src/lib/integrations/endpoints.ts`** — two new `INVENTORY_ONLY` entries, modelled on
`"items.create.inventory"` (`:175-183`):

```
"brands.list.inventory"     GET /brands      owner/purpose per house style
"categories.list.inventory" GET /categories
```

**`src/lib/integrations/inventory.ts`** — four methods, copying the `listBills`/`listAllBills`
shape (`base.ts:354-376`): `per_page=200`, loop on `page_context.has_more_page`, no sleep
between sequential pages, let `apiCall` handle the 429 backoff.

```ts
async listBrands(page = 1)      // -> { brands: ZohoBrand[] } & PageContext
async listAllBrands()           // -> ZohoBrand[]
async listCategories(page = 1)  // -> { categories: ZohoCategory[] } & PageContext
async listAllCategories()       // -> ZohoCategory[]
```

Row types are declared inline in `inventory.ts` (the `books.ts:118-155` convention), carrying
only what is used: `brand_id`, `brand_name`; `category_id`, `category_name`,
`parent_category_id` (read, then **discarded** per D4 — kept in the type so the next person
sees the field exists and was a decision, not an oversight).

Logging: `createLogger("zoho:taxonomy")`. `log.debug` per page with a count, `log.info` on
completion with totals.

---

## §3 — RBAC

`ActionKey` already includes `"fetch"` (`rbac-catalog.ts:10`). `brands` and `categories`
currently use the shared `CRUD` constant, which does not.

```ts
// rbac-catalog.ts:287 and :319
actions: [...CRUD, "fetch"],
```

Guard mapping — deliberately **not** `zoho.fetch`. The point of this plan is that taxonomy is
owned by its own screen; a person who can fetch bills should not silently gain the ability to
rewrite the brand master.

| route | guard |
|---|---|
| `GET /api/brands/zoho-preview` | `requireFeature("brands", "fetch")` |
| `POST /api/brands/zoho-import` | `requireFeature("brands", "create")` |
| `GET /api/categories/zoho-preview` | `requireFeature("categories", "fetch")` |
| `POST /api/categories/zoho-import` | `requireFeature("categories", "create")` |

RBAC catalog changes are **data, not migrations** (CLAUDE.md rule 11): after deploy, run
`npm run db:seed:rbac`.

---

## §4 — The four new routes

### `GET /api/brands/zoho-preview` — writes nothing

1. `getInventory()`; 503 with a clear message if not connected.
2. `listAllBrands()`.
3. Load every local Brand: `id, name, zohoBrandId`.
4. Classify each Zoho row:

| status | condition | UI |
|---|---|---|
| `linked` | a local brand already has this `zohoBrandId` | shown, greyed, not tickable |
| `adopt` | no zoho id, but `lower(name)` matches a local brand | shown, **not tickable — applied automatically** (D3) |
| `new` | no id match, no name match | **tickable**, ticked by default |

5. `vendorLike: boolean` on every row — a heuristic flag only (matches a `Vendor.name`
   case-insensitively, or contains a company suffix such as `PVT`/`LTD`/`ENTERPRISE`).
   Per D2 nothing is hidden and nothing is auto-unticked; the flag renders as an amber "looks
   like a vendor" chip so the person deciding can see it.

Response:

```ts
{ rows: Array<{ zohoId, name, status: "linked"|"adopt"|"new", localId?, localName?, vendorLike }>,
  counts: { linked, adopt, new, total } }
```

### `POST /api/brands/zoho-import` — the only new writer

Body: `{ create: string[] }` — Zoho brand ids the person ticked. **Adoptions are not in the
body**; they are recomputed server-side and always applied (D3). The client cannot ask for an
adoption that the server did not independently decide on.

Per row, in one `$transaction`:

- **adopt** → `update` the local brand, set `zohoBrandId`. Name untouched. Never renames.
- **create** → case-insensitive existence check first (`POST /api/brands` has none —
  `route.ts:29` — and this path must not inherit that gap), then `create` with
  `{ name, zohoBrandId }`.
- A `zohoBrandId` already taken by another row → skip and report. The `@unique` index is the
  real guard; this makes the refusal a sentence.

Response `{ adopted, created, skipped, errors: string[] }`.

`log.info("zoho brand import", { adopted, created, skipped })`.

### The two category routes

Identical, against `Category` / `zohoCategoryId`. Two differences:

- `parent_category_id` is **read and discarded** (D4). One comment saying so, so nobody
  "fixes" it later.
- `POST /api/categories` already has a case-insensitive clash check returning 409
  (`categories/route.ts:45-49`); the import must match that behaviour rather than 409 per row
  — it skips and reports instead.

---

## §5 — The UI

Both screens are already the same component twice (`categories/page.tsx:31-33` says so
outright). Build **one** shared component and mount it in both.

`src/components/zoho-taxonomy-sheet.tsx`:

```tsx
<ZohoTaxonomySheet kind="brand" | "category" onDone={() => void load()} />
```

State machine mirrors `inbound/page.tsx:119` — `idle → fetching → selecting → importing`.
Ticking is a plain `Set` of Zoho ids, no library (`inbound/page.tsx:281-287`).

- Trigger: a `Fetch from Zoho` button in the header action bar beside `New`
  (`more/brands/page.tsx:200-215`), rendered only when `canFetch(kind)`.
- Sheet body: three sections — **New (tickable)**, **Will be linked** (adopt, informational),
  **Already linked** (collapsed count only). Amber chip on `vendorLike` rows.
- Footer: `Cancel` / `Import N` (disabled at 0 new **and** 0 adopt).
- Result via the existing `<ActionConfirmation>` both screens already render.
- `apiFetch` / `apiTry` throughout — never raw `fetch().then(r => r.json())`.
  (`inbound/page.tsx:289` uses raw `fetch`; do not copy that.)
- Loading and error states are mandatory: skeleton while fetching, `<ErrorBanner>` with retry.

`usePermissions()` needs `canFetch` if it does not already expose it — check before assuming;
frontend gates are cosmetic and the API re-checks regardless.

---

## §6 — Close the side-effect creation paths

This is the half that actually enforces "one creation path". Without it §2–§5 just add a
second way in.

### `api/zoho/pull-review/approve/route.ts`

**`:174-175` — brand from vendor name.** Replace find-or-create with resolve-or-placeholder:

```
match vendorName against Brand (case-insensitive)
  hit  -> use it
  miss -> use the `Unbranded` placeholder brand, and push
          `Brand "<vendorName>" not found — product filed under Unbranded`
          into results (see §6.1 about where that goes)
```

**`:178-179` — placeholder category.** Keep, but make it read-only in effect: seed
`Uncategorized` in `prisma/seed.ts` and change this to a plain `findFirst` that errors loudly
if absent. An import should not be the thing that creates the placeholder.

**`:236-237` — category from Zoho name.** Stop creating. Resolve `zohoCategoryId` first (the
column now exists), then `lower(name)`, else `defaultCategory`. **This also fixes the
case-sensitivity defect** that currently fails a whole bill.

**`:308-314` — the second brand lookup.** Delete outright. Reuse the brand already resolved
above. `InboundShipment.brandId` is non-null (`schema.prisma:1819`) and the resolved brand —
real or placeholder — satisfies it.

### `api/stock-counts/[id]/route.ts:282`

Match-only. On a miss, leave `brandId` untouched — the product already has a valid one — and
surface `brand "<x>" is not in the list; create it on /more/brands` in the approval response.
Brand creation stays behind `brands.create`.

### §6.1 — while we are here

`approve/route.ts:272` reports a *successful* product auto-creation by pushing it into
`results.errors`. The new "filed under Unbranded" notices must not join it there. Add
`results.notices: string[]` alongside `errors`, and move the existing auto-create message into
it. The client already renders `errors`; render `notices` in a neutral tone beside it.

---

## §7 — Out of scope, deliberately

- **Backfilling the 1,289 `Unbranded` products.** Owner decided 8 Sep: fix them by hand via
  the `/stock` "needs details" filter and bulk brand assign, which already exist. A
  name-derived backfill would mis-brand ~345 of them.
- **`brand_vendors`** (0 rows). Zoho's item payload has no vendor, so there is no source to
  derive brand→vendor from. Separate problem.
- **`scripts/import-products.ts:247,256`** — offline tooling, not a runtime path. Low risk.
  Worth gating behind `--create-taxonomy` eventually; not now.
- **The `Product.brandId` / `categoryId` non-null constraint.** Making them nullable is the
  real root fix and touches every screen that assumes a brand exists. Not in this plan; the
  placeholder rows remain the workaround, as `import-placeholders.ts` already documents.

---

## §8 — Phases and dependencies

| Phase | Work | Depends on |
|---|---|---|
| P1 | `endpoints.ts` entries + `inventory.ts` list methods | — |
| P2 | `rbac-catalog.ts` — add `fetch` to brands + categories | — |
| P3 | 4 API routes (preview + import × 2) | P1, P2 |
| P4 | `ZohoTaxonomySheet` + mount on both screens | P3 |
| P5 | Close creation paths in `approve` + `stock-counts`; add `results.notices` | — |
| P6 | Seed `Uncategorized` and `Unbranded` in `prisma/seed.ts` | — |

**P1, P2, P5 and P6 are independent of each other** and can be built in parallel. P3 needs
P1+P2. P4 needs P3.

**No schema migration.** `zohoBrandId` / `zohoCategoryId` already exist. Nothing else changes
shape.

---

## §9 — Verification

1. `npx tsc --noEmit` — clean.
2. `npm run build` — must pass.
3. `npm run db:seed:rbac` on local, then confirm `brands.fetch` / `categories.fetch` appear at
   `/settings/roles`.
4. `/more/brands` → **Fetch from Zoho**. With 115 local brands and 151 in Zoho, expect roughly
   115 `adopt` and ~36 `new`. **Zero** `linked` on the first run.
5. Import. Then re-run Fetch: everything must now be `linked`, `new` must be 0.
   **This is the duplicate test** — if a second run offers to create anything, `zohoBrandId`
   is not being written.
6. Repeat 4–5 for `/categories` (32 local, 33 Zoho).
7. Approve a Zoho bill whose vendor is not a brand. Assert: **no new Brand row**, the product
   is created on `Unbranded`, and it appears under `/stock` → "Needs details".
8. `SELECT count(*) FROM "Brand"` before and after step 7 — must be unchanged.
9. Approve a stock count carrying a `suggestedBrand` that does not exist. Assert no Brand row
   is created and the response names the brand.
