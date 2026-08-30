# Product types become data, and BrandLeadTime folds into Brand — plan

Status: pending — not started. Two independent changes on one branch, two commits. Part B is
settled and ready; Part A has three open questions in §8.
Suggested branch: `refactor/product-types-and-brand-lead-time`.
Prepared 30 Aug 2026. Every line number, row count and usage below was verified against the
tree and the live database on that date.

---

## 1. Why these two are in one plan

They are **not** coupled, and this document does not pretend otherwise. Each could ship alone.

They travel together because they are the same *kind* of change — master data the application
cannot edit at runtime — they touch the same two files (`prisma/schema.prisma`,
`prisma/rbac-catalog.ts`), and they share one `db:generate` → `db:seed:rbac` → `db:push` →
`npm run build` cycle. Splitting them across branches means paying that cycle twice and
resolving a schema conflict between them for no benefit.

**Two commits, in this order**, so either can be reverted alone:

| # | Contains | Size |
|---|---|---|
| 1 | **Part B** — `BrandLeadTime` folds into `Brand`, plus the guard fix | 5 files, no open questions |
| 2 | **Part A** — `ProductType` enum becomes a table, with a screen and permissions | 14 files, a data migration |

Part B is first because it is smaller, has no unanswered questions, and touches nothing Part A
touches. If Part A stalls on a question, Part B has already shipped.

---

# PART B — `BrandLeadTime` folds into `Brand`

Deliberately documented first, because it is the one that is ready.

## 2. Today

```prisma
model BrandLeadTime {
  id        String   @id @default(cuid())
  brandId   String   @unique          // strictly 1:1
  brand     Brand    @relation(fields: [brandId], references: [id])
  leadDays  Int      @default(7)      // the only column that carries meaning
  updatedAt DateTime @updatedAt
}
```

A whole table for one integer. Verified against the live database on 30 Aug 2026:

```
Brand           9 columns   17 rows
BrandLeadTime   4 columns    0 rows      <- never used, not once
```

All three read sites already collapse a missing row to the same number:

| Site | Code |
|---|---|
| `api/inbound/route.ts:149` | `const leadDays = leadTime?.leadDays ?? 7;` |
| `api/zoho/pull-review/approve/route.ts:345` | `const leadDays = brandLeadTime?.leadDays \|\| 7;` |
| `api/brand-lead-time/route.ts:25` | `leadDays: b.leadTime?.leadDays ?? 7,` |

"No row" and "7" are already synonyms. `leadDays Int @default(7)` on `Brand` says that in the
schema instead of encoding it as row-absence in three separate call sites.

## 3. The change

```prisma
model Brand {
  ...
  leadDays Int @default(7)   // was BrandLeadTime.leadDays
}

// model BrandLeadTime — deleted
// Brand.leadTime        — deleted
```

| File | Change |
|---|---|
| `prisma/schema.prisma` | add `leadDays` to `Brand` (344); delete `model BrandLeadTime` (1306–1312) and the `leadTime BrandLeadTime?` back-relation (356) |
| `src/app/api/brand-lead-time/route.ts` | `prisma.brandLeadTime.upsert` (46) → `prisma.brand.update`; drop the nested `leadTime: { select: … }` (17) and read `b.leadDays` directly (25); **guard `create` → `edit`** (38) |
| `src/app/api/inbound/route.ts` | 146–149: `brandLeadTime.findUnique` → `brand.findUnique({ select: { leadDays: true } })` |
| `src/app/api/zoho/pull-review/approve/route.ts` | 344–345: **delete the query entirely** — `shipmentBrand` is already in scope from line 337 |
| `src/app/(dashboard)/more/brand-lead-times/page.tsx` | no change, provided the API keeps returning `{ brandId, leadDays }` |

### 3.1 The guard is wrong today — this is a real bug, not a tidy-up

```ts
// src/app/api/brand-lead-time/route.ts:38
await requireFeature("brands", "create");   // <- setting an EXISTING brand's lead time
```

Setting a lead time on a brand that already exists is an **edit**, not a creation. As it
stands, a role granted `brands.edit` cannot change a lead time, while a role granted
`brands.create` and nothing else can. That is backwards.

It becomes `requireFeature("brands", "edit")`.

**No catalog change is needed.** `brands` already declares `CRUD` (`rbac-catalog.ts:195`), so
`brands.edit` already exists as a permission row — and lead times are already inside this
module by design: its description reads *"Brand master, lead times and stock files"*
(`rbac-catalog.ts:190`). There is no `brand_lead_times` module and none is being created.

**Consequence to accept:** anyone holding `brands.create` but not `brands.edit` loses the
ability to set lead times, and anyone holding `brands.edit` gains it. That is the point.

### 3.2 A round trip disappears from the Zoho import loop

At `approve:337` the brand row is already fetched:

```ts
let shipmentBrand = await prisma.brand.findFirst({ where: { name: … } });
…
const brandLeadTime = await prisma.brandLeadTime.findUnique({ where: { brandId: shipmentBrandId } });  // :344
```

With `leadDays` on `Brand`, line 344 is deleted outright — `shipmentBrand.leadDays` is already
in memory. This is inside the per-record import loop, so it is the same class of defect
`zoho-pull-timeout-plan.md` addresses. Small, but free.

## 4. What is NOT changed — decided 30 Aug 2026

**`Brand.cdTermsDays` and `Brand.cdPercentage` stay.** Owner's decision: do not drop them.

This is recorded because `schema.prisma:362` invites the opposite, and a future reader will
otherwise remove them believing the comment authorises it:

> `cdTermsDays`/`cdPercentage` above are **DEAD** — every one of the 50 cash-discount usages
> in `src/` reads Vendor, not Brand. Agreed terms live in `VendorDiscountTerm`; drop the two
> columns in a later cleanup.

The comment is accurate about **reads** — all 48 current references calculate from `Vendor`
(`bills/[id]/cd-eligibility:47`, `bills/aging-summary:44`, `reports/cd-summary:107`). It is
**incomplete about writes and about data**:

- `brandSchema` (`validations.ts:88–93`) accepts both fields, so `POST /api/brands` can set
  them. `/more/brands` never sends them, but the path is open.
- **Four `Brand` rows hold values right now**, and no `Vendor` row does:

```
BSA        1.5%  within 10 days     created 2026-08-25
Firefox      3%  within 20 days     created 2026-08-25
Hero         2%  within 15 days     created 2026-08-25
Trek       2.5%  within 30 days     created 2026-08-25

Vendor rows with cd values : 0 (of 1)
VendorDiscountTerm rows    : 0
```

So the only cash-discount data in the database sits in columns nothing reads, which is why
`/reports/cd-summary` and the bill deadline badges show nothing. **Dropping those columns
would be data loss, not cleanup.** Leave them. Where that data should actually live is a
separate question and out of scope here.

**Also unchanged:** `VendorDiscountTerm` (0 rows) and `BrandVendor` (0 rows, read by
`api/ledger/vendors/route.ts:31`). Both are built and unfed. See `docs/dead-code.md:71`.

---

# PART A — `ProductType` becomes a table

## 5. Today

```prisma
enum ProductType {          // schema.prisma:221-228
  BICYCLE
  SPARE_PART
  ACCESSORY
  BOX_PIECE
  WIP
  FINISHED_GOOD
}
```

Used by **exactly one column** — `Product.type` (381) — across 11 files. Live data:

```
SPARE_PART   9
ACCESSORY    7
BICYCLE      5           21 products total
BOX_PIECE    0
WIP          0
FINISHED_GOOD 0
```

Three of the six values have never been used, and outside the enum they appear in exactly one
place: a `VALID_TYPES` array at `api/products/[id]/route.ts:94`.

Adding a type — "E-Bike", "Tricycle" — currently requires a schema change and a deploy. That
is the whole problem.

## 6. ⚠️ `Category` is NOT the same thing and must not be merged into this

This section exists because merging them is the obvious-looking move and it is wrong.

`Category` is **already** a dynamic table (`schema.prisma:329`) with 9 rows. But look at who
writes it — seven sites, and **five are Zoho**:

| Site | Source of the name |
|---|---|
| `zoho/pull-review/approve:72`, `:216`, `:264` | Zoho's `category_name`, verbatim |
| `zoho/import/items:34`, `zoho/import/clean:54` | same |
| `products/auto-classify:94` | force-creates `Bicycles`, `Spares`, `Accessories` |
| `POST /api/categories:32` | **nothing in the UI calls this** |

```ts
// zoho/pull-review/approve.ts:67 — the comment is explicit
// Mirror Zoho categories — use exact category_name from Zoho, fallback to "Uncategorized"
```

There is no `PATCH` and no `DELETE` on `/api/categories`, so a category can never be renamed
or removed. **Category is a mirror of Zoho's vocabulary, not yours.**

`Product.type` is the opposite: a small controlled set that the application's own navigation
is built on — the tabs on `/stock:622`, `/stock-audit/new:221`, `/stock/[id]:250`, and a
server-side filter at `api/products/route.ts:49` and `api/stock-counts/route.ts:105`.

**The rule to apply, and to apply again next time this comes up:** ask who owns the
vocabulary. If an external system decides the values, it is a mirror — never give a human an
edit screen for it, the next sync overwrites them. If you decide the values and your screens
are built around them, it belongs in a table you control. `Category` is the first.
`type` is the second.

Merging them would hand the stock page's tabs to whatever text a supplier types into Zoho.

## 7. The change

### 7.1 Schema

```prisma
model ProductType {
  id        String  @id @default(cuid())
  code      String  @unique          // BICYCLE, SPARE_PART, ACCESSORY — what CODE matches on
  name      String                   // "Cycles", "Spares" — what PEOPLE see, freely editable
  isActive  Boolean @default(true)   // retire without deleting
  sortOrder Int     @default(0)      // tab order on /stock
  tracksSize Boolean @default(false) // replaces every `type === "BICYCLE"` check — see 7.2

  products  Product[]
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([isActive, sortOrder])
}

model Product {
  ...
  productTypeId String
  productType   ProductType @relation(fields: [productTypeId], references: [id])
  // type       ProductType  <- enum column deleted
}
// enum ProductType — deleted
```

**`code` and `name` are separate on purpose.** `code` is the stable handle the classifiers and
any remaining code match on; `name` is display text an admin can rename freely. Collapsing
them means renaming "Cycles" to "Bicycles" silently breaks the import classifier.

**Deletion is restricted, not cascading.** `Product.productTypeId` is required, so deleting a
type in use must fail with a count — *"used by 412 products"* — rather than orphan them.
`isActive: false` is the normal way to remove one from pickers.

### 7.2 `tracksSize` — the part that matters most

Two places branch on the value `BICYCLE`:

```ts
// (dashboard)/stock/[id]/page.tsx:335 and :338
{(product.brand || (product.type === "BICYCLE" && product.size) || …
{product.type === "BICYCLE" && product.size && <Badge>{product.size}</Badge>}
```

plus `BICYCLE_SIZES` at `stock/page.tsx:85` and the default filter at `:134`.

**A name check is exactly the bug CLAUDE.md bans for roles**, for the same reason: the moment
an admin adds "E-Bike", it silently gets no size field and nobody is told. `tracksSize` on the
row makes the behaviour a property of the type instead of a property of its name. Seed it
`true` for `BICYCLE` and `false` for the other two.

### 7.3 RBAC — a sub-module under `stock`

```ts
{
  key: "stock_product_types",          // parent_child naming, as settings_storage does
  label: "Product Types",
  description: "The global product type list — codes, display names and ordering",
  icon: "Tag",
  route: "/stock/types",
  group: "Operations",                 // MUST match the parent's group
  sortOrder: 101,                      // stock 100, inbound 110 — 101-109 is free
  actions: CRUD,                       // ["view","create","edit","delete"]
  parentKey: "stock",
}
```

This is what the owner asked for when describing `product_type_create` /
`product_type_edit`. Those cannot be **actions** — actions are the fixed six
(`view · create · edit · delete · approve · fetch`) and an action is one grant, not a feature
name. A sub-module produces `stock_product_types.create`, `.edit`, `.delete`, `.view`, which
is the same intent spelled the way this codebase spells it.

`stock` has no children today; these would be its first. `settings` (2 children) and
`staff_lms` (4) are the existing examples.

> **Order is load-bearing.** `db:seed:rbac` must run **before** any route carries
> `requireFeature("stock_product_types", …)`. `userCan` returns `undefined === true` for an
> unknown module key, so guarding first denies **everyone, including ADMIN** — and it looks
> like an ungranted permission rather than a missing seed. Same trap as
> `store-hierarchy-and-team-plan.md` §4.

### 7.4 Sever the auto-classify coupling — required, not optional

```ts
// src/app/api/products/auto-classify/route.ts:135
// Also update ProductType to match
const productType = catName === "Bicycles" ? "BICYCLE" : catName === "Accessories" ? "ACCESSORY" : "SPARE_PART";
```

This lets the Zoho-fed mirror overwrite the curated list. Once an admin can set a product to
"E-Bike", the next classify run silently resets it to `SPARE_PART`.

**Decision: `auto-classify` stops writing `type` altogether.** It keeps assigning
`categoryId`, which is its actual job. Reclassifying a product's *type* stays a deliberate act
through `PATCH /api/products/[id]`.

### 7.5 Files

| Layer | File | Change |
|---|---|---|
| schema | `prisma/schema.prisma` | new model 221; `Product.type` → `productTypeId` (381); drop the enum |
| seed | `prisma/seed.ts` | seed the three type rows |
| catalog | `prisma/rbac-catalog.ts` | the sub-module above |
| lib | `src/lib/validations.ts` | 28–35 `z.enum([...])` → `z.string()` (an id); 110 `productType` likewise |
| types | `src/types/index.ts` | 22–28 union → an interface |
| API | `api/products/route.ts:25,49` | `?type=` filters on `productTypeId` |
| API | `api/products/[id]/route.ts:94` | delete `VALID_TYPES`; validate against the table |
| API | `api/products/auto-classify/route.ts:135,142` | stop writing `type` (§7.4) |
| API | `api/stock-counts/route.ts:105` | filter on `productTypeId` |
| API | `api/zoho/import/items:65`, `import/clean:82`, `pull-review/approve:131` | see §8 Q1 |
| **new** | `api/product-types/route.ts`, `[id]/route.ts` | CRUD behind `stock_product_types` |
| Pages | `stock/page.tsx:85,134,622`, `stock/[id]/page.tsx:250,335,338`, `stock-audit/new/page.tsx:221` | read the list from the API; `tracksSize` replaces the `BICYCLE` checks |
| **new** | `(dashboard)/stock/types/page.tsx` | the management screen |

`inbound/[id]/page.tsx:116` is **not** in scope. Its
`"BICYCLE" | "SPARE_PART" | "ACCESSORY" | "MIXED"` is a shipment-level UI concept kept in
`localStorage`; it never touches `Product.type` and `MIXED` is not a product type at all.
Leave it alone — renaming it is a separate cleanup.

### 7.6 The data migration

21 products carry a type. Prisma cannot hold `enum ProductType` and `model ProductType` at the
same time, so this cannot be done in one push.

**If `store-hierarchy-and-team-plan.md`'s database reset happens first, this is free** — reset,
then push the final schema and seed. Prefer that if the reset is close.

Otherwise, three steps with the mapping captured out of band:

1. **Capture** — write the 21 `{ sku, type }` pairs to a JSON file. 21 rows; this is a
   formality, but it is the only copy once the column is dropped.
2. **Push the final schema** — new model, `productTypeId` **nullable**, enum and old column
   gone. Seed the three type rows.
3. **Reapply** from the JSON by `sku`, then make `productTypeId` required and push again.
   Confirm `SELECT count(*) FROM "Product" WHERE "productTypeId" IS NULL` returns 0 **before**
   the final push, or the push fails on the not-null constraint and leaves you mid-migration.

---

## 8. Open questions — Part A only

Part B has none.

**Q1 — should Zoho import still guess a type?**
Three routes guess from the item name today (`import/items:65`, `import/clean:82`,
`pull-review/approve:131`), e.g. `/\bcycl|bicycl|bike\b/ → BICYCLE`. Options: keep guessing
into the seeded codes; or import everything as one default type and let someone assign it.
Keeping the guess means new admin-created types are never auto-assigned, which is arguably
correct — the app cannot infer a rule for a type it has never seen.

**Q2 — the three unused values.** `BOX_PIECE`, `WIP`, `FINISHED_GOOD` have zero rows and zero
UI. Seed them as `isActive: false` rows, or drop them? (They look like leftovers from the
workshop module, which has its own `JobType`.) Recommendation: drop — nothing references them
and they can be created from the new screen in seconds if wanted.

**Q3 — the screen for Part B.** Keep `/more/brand-lead-times` as its own page, or fold
`leadDays` into `/more/brands` as an inline column and delete that page? Storage merges either
way; this is purely one screen or two. **This one only affects Part B's last row and can be
answered after commit 1 lands.**

---

## 9. Execution order

```
1. Part B  — schema, four files, guard fix          -> build, commit 1
2. Part A  — catalog entry FIRST, then db:seed:rbac -> so the module exists
3. Part A  — schema + migration (§7.6)
4. Part A  — API, pages, new screen                 -> build, commit 2
```

Step 2 before step 4 is the §7.3 trap: guards before seed deny everyone.

After each schema change, with the dev server stopped:

```
npm run db:generate
npm run db:seed:rbac
npm run db:push
npm run build
```

## 10. Verification

**Part B**

- `grep -rn "brandLeadTime\|BrandLeadTime" src prisma` returns nothing.
- A lead time saved on `/more/brand-lead-times` persists across a reload.
- A role with `brands.edit` and **not** `brands.create` **can** save one. A role with
  `brands.create` and not `edit` **cannot**. This is the bug fix; testing only as ADMIN
  proves nothing, because ADMIN holds both.
- Creating an inbound shipment for a brand with `leadDays = 14` sets
  `expectedDeliveryDate = billDate + 14`; for a brand never edited, `+ 7`.
- Approving a Zoho shipment pull sets the same, and the route makes **one fewer query**.
- `Brand.cdTermsDays` / `cdPercentage` still exist, and BSA / Firefox / Hero / Trek still
  carry their four values.

**Part A**

- `grep -rn "BOX_PIECE\|FINISHED_GOOD\|\"BICYCLE\"" src` returns nothing outside the seed.
- `/stock` tabs render from the database; renaming "Cycles" to "Bicycles" on `/stock/types`
  changes the tab with no deploy.
- Creating a type with `tracksSize: true` makes the size badge appear on `/stock/[id]` for its
  products — **without any code change**. This is the acceptance test for §7.2.
- Deleting a type that products use is refused, with the count in the message.
- A role without `stock_product_types.edit` sees no edit control, **and** `PATCH` returns 403.
- Running `POST /api/products/auto-classify` **does not change any product's type** (§7.4),
  only its category.
- All 21 products still have their original type after the migration, checked by `sku`.

## 11. Risks

| Risk | Severity | Handling |
|---|---|---|
| Guarding routes before the catalog is seeded | **high** — denies ADMIN, looks like a permission bug | §9 step 2 |
| The 21 product→type pairs lost mid-migration | medium | §7.6 step 1 captures them first; or reset first |
| A missed `type === "BICYCLE"` check | medium — silently no size field, no error | §10's `tracksSize` test is the one that catches it |
| Someone "fixes" `Category` into this later | medium | §6 exists to answer them |
| `prisma generate` EPERM | nuisance | stop the dev server |

## 12. Board of Agents

Consult before marking done:

- `docs/agents/database-architect.md` — new model, FK restrict-on-delete, the enum→table
  migration, the `@@index([isActive, sortOrder])`
- `docs/agents/inventory-consultant.md` — whether a product type is the right axis for the
  stock tabs and stock-count scoping at all
- `docs/agents/backend-engineer.md` — the two new route files, zod schemas, the guard fix
- `docs/agents/integration-architect.md` — Q1, and the §7.4 decision that Zoho stops writing
  `type`
- `docs/agents/frontend-engineer.md` — the new screen, and the tabs now being async
