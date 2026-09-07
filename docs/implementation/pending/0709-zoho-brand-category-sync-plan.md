# Zoho brand & category sync — fetch, review, import, keyed on the Zoho id

**Status:** pending · **Raised:** 7 Sep 2026 · **Branch base:** to be confirmed by the owner

Replace "the brand is whatever the bill's vendor was called" with "the brand is a row pulled
from Zoho's own brand master, matched by `brand_id`". Same for categories, matched by
`category_id`. After this, a Brand or Category row is created by **one** path — a person
pressing Fetch on the relevant screen and approving what came back.

---

## 1. What was verified, and how

Everything below was read from the live API on 7 Sep 2026 (org `60025709765`, India DC) with
`scripts/zoho-probe.sh`, not from Zoho's public documentation — **the documentation is wrong
about this and led to the opposite conclusion earlier in the day.** The docs pages for both
Books and Inventory items do not list `brand`, `manufacturer` or `category_id`, and show no
brands resource. All three exist.

| Endpoint | Result |
|---|---|
| `GET /inventory/v1/brands` | **200** — 151 rows, keys `brand_id`, `name`, and nothing else |
| `GET /inventory/v1/categories` | **200** — 33 rows (32 real + a `ROOT` sentinel with id `-1`) |
| `GET /inventory/v1/items` | items carry `brand`, `manufacturer`, `category_id`, `category_name` |
| `GET /inventory/v1/items/{id}` | same; **no `brand_id` key** — checked explicitly |
| `itemcategories`, `items/categories`, `settings/categories` | 404 |

Field coverage over a 200-item sample:

| field | populated |
|---|---|
| `category_id` / `category_name` | 154/200 |
| `brand` | 134/200 |
| `manufacturer` | 131/200 |
| `vendor_name` | **0/200** |

Saved artefacts: `zoho-brands.json`, `zoho-brands.txt`, `zoho-categories.json` (repo root —
see §9 for where they should end up).

### 1.1 The asymmetry that shapes the whole design

**Categories can be linked by id end to end.** The item carries `category_id`, and the
category master carries `category_id` + `parent_category_id`.

**Brands cannot.** The brands master has `brand_id`, but the *item* carries only the brand
**name** as a string. So `Product → Brand` stays name-matched. What changes is the source of
that name: a closed 151-row list Zoho itself maintains, instead of an arbitrary vendor name
off a bill.

Storing `zohoBrandId` is still worth it — it is what makes the *brand list itself* idempotent
across re-fetches, which is the duplicate problem this plan is asked to solve.

---

## 2. Duplicate analysis of the incoming data

Run on the 151 fetched brands.

| test | result |
|---|---|
| exact-name duplicates | **0** |
| case-insensitive duplicates | **0** |
| collide after stripping spaces/punctuation | **2** pairs |

So Zoho will not hand us two rows with the same name, and `name @unique` will not blow up on
a straight import. The problem is softer and worse: **semantic** duplicates.

Real clusters (edit distance ≤ 2 after normalising, hand-filtered):

```
FIT TRIP / FITRIP / FITTRIP
NINETY ONE / NINETYONE / NNETYONE
RALEIGH / RALEIGY / RALIEGH
MAXMONT / MAXMOUNT
ALLWYN / ALLWYNT / ALLW
E MOTRAD / EMOTORAD
```

The scan also flags pairs that are **not** duplicates and must not be merged:
`TRINX/TORINO`, `AVON/FAVRON`, `GANA/GANG`, `DLFC/LFC`, `FITRIP/STRIP`, `FUNSTAR/UNISTAR`.
This is exactly why the import gets a review step and the merge decision stays with a person.

Separately, a large minority of the 151 are **vendors, not brands** — `SANGAM HARDWARE`,
`NARANG CYCLE STORES`, `SHAH CYCLE TRADING CO.(25-26)B0`, `JAI MATAJI HARDWARE`,
`FARHAN TEXTILES`, `SSK I T SOLUTIONS`, `VASTRA MANDIRA`, `LIYA V ENTERPRISES`,
`GK UDYOG 25-26` — and some are categories (`TOYS`, `SPARES`, `ACCESSORIES`). Zoho has the
same vendor/brand confusion this codebase has. Importing all 151 blind produces a brand list
that is wrong on roughly a third of its rows.

Categories are cleaner: 32 real rows, **0 case-insensitive duplicates**, 22 top level and 10
children, 31 of 32 carrying active items. One junk row (`qazsws`) to reject at review.

---

## 3. Schema change

Two nullable, unique columns. Additive, so old code survives the new schema (rule 7).

```prisma
model Brand {
  // ...
  /// Zoho Inventory brand_id. NULL for a brand created by hand here that Zoho has never
  /// heard of. Unique so a re-fetch can never insert the same Zoho brand twice.
  zohoBrandId String? @unique
}

model Category {
  // ...
  /// Zoho Inventory category_id. NULL for a locally created category.
  zohoCategoryId String? @unique
}
```

Generated migration (read before committing, per rule 3 — this one is pure `ADD COLUMN`
plus two indexes, no rewrite of a populated table):

```sql
ALTER TABLE "Brand"    ADD COLUMN "zohoBrandId"    TEXT;
ALTER TABLE "Category" ADD COLUMN "zohoCategoryId" TEXT;

CREATE UNIQUE INDEX "Brand_zohoBrandId_key"       ON "Brand"("zohoBrandId");
CREATE UNIQUE INDEX "Category_zohoCategoryId_key" ON "Category"("zohoCategoryId");
```

Postgres treats NULLs as distinct in a unique index, so any number of hand-made rows with a
NULL Zoho id coexist. That is the behaviour we want.

### 3.1 The second duplicate hole, and whether to close it now

`Brand.name @unique` is a **case-sensitive** btree, while every lookup in the codebase is
`mode: "insensitive"`. So `hero` can be inserted alongside `Hero`, and once both exist,
`findFirst` returns whichever Postgres yields first. `POST /api/brands` has no clash
pre-check at all (`api/brands/route.ts:29`), unlike `POST /api/categories` and
`PATCH /api/brands/[id]`, both of which do.

Optional, and safe right now because the local table holds only 3 brands with no case
collisions:

```sql
DROP INDEX "Brand_name_key";
CREATE UNIQUE INDEX "Brand_name_key" ON "Brand"(lower(name));
```

**Recommendation: do this in a separate migration, after the import, not before.** It is a
behaviour change on a constraint the whole app relies on, and it deserves its own review.
The clash pre-check on `POST /api/brands` (§6.4) is the cheap half and should ship with this
plan regardless.

---

## 4. The matching rule — how a duplicate becomes impossible

One resolver, used by both the brand and category importers. Three steps, in order, and it
**never creates a row that step 1 or 2 could have found**:

```
1. WHERE zohoBrandId = <brand_id>          → exact. Update the name if Zoho renamed it.
2. WHERE lower(name) = lower(<name>)       → an existing local row for the same brand.
                                             Attach zohoBrandId to it. Do NOT insert.
3. no match                                → candidate for creation, but only if a person
                                             ticked it on the review screen.
```

Step 2 is what stops the import from duplicating brands you already have. Step 3 behind a
tick is what stops the 151-row blind insert.

**A case this WILL NOT auto-resolve, by design:** the local table holds `HERO CYCLES`; Zoho
holds `HERO`. Different strings, so step 2 misses and step 3 offers to create `HERO` beside
it. The review screen must therefore offer a third action per row — *link to an existing
brand* — writing `zohoBrandId` onto the local row the person picks. Without that the import
manufactures precisely the duplicates it was built to prevent.

Re-running a fetch after this is a no-op: every row resolves at step 1.

---

## 5. The SQL you asked for

Two ways in. **The route in §6 is the one that should exist**; the raw SQL is a bootstrap for
getting the data in today, before the screens are built.

### 5.1 Generated bootstrap (one-time)

`scripts/gen-zoho-taxonomy-sql.js` reads `zoho-brands.json` / `zoho-categories.json` and
emits `prisma/data/zoho-taxonomy.sql`. Shape:

```sql
BEGIN;

-- Brands. Matched on zohoBrandId first; a name that already exists is ADOPTED
-- (its zohoBrandId is filled in) rather than duplicated.
INSERT INTO "Brand" (id, name, "zohoBrandId", "leadDays", "createdAt", "updatedAt")
VALUES (gen_random_uuid()::text, 'APOLLO', '1593656000000022797', 7, now(), now())
ON CONFLICT ("zohoBrandId") DO UPDATE SET name = EXCLUDED.name, "updatedAt" = now();
-- ... one row per brand

-- Adopt local rows that already carry the name but no Zoho id.
UPDATE "Brand" b SET "zohoBrandId" = v.zoho_id, "updatedAt" = now()
FROM (VALUES ('APOLLO','1593656000000022797') /* ... */) AS v(name, zoho_id)
WHERE lower(b.name) = lower(v.name) AND b."zohoBrandId" IS NULL;

COMMIT;
```

Categories need **two passes** because `parentId` is a self-FK — insert every row with
`parentId` NULL, then a second `UPDATE` resolving `parent_category_id` through
`zohoCategoryId`. A single pass fails on any child whose parent has not been inserted yet.

```sql
UPDATE "Category" c SET "parentId" = p.id
FROM "Category" p
WHERE p."zohoCategoryId" = <parent_category_id of c>
  AND c."zohoCategoryId" = <category_id of c>;
```

Rows to exclude at generation time: the `ROOT` sentinel (`category_id = -1`), and
`parent_category_id = -1` means top level, i.e. `parentId = NULL`.

**Caveat, stated plainly:** running this SQL by hand against Supabase contradicts
`CLAUDE.md` — production is written by `prisma migrate deploy` and nothing else, and the
Supabase SQL editor is named as a banned path. On the cloud TEST database that is a
judgement call, not a violation, but it should be a deliberate one. The clean route is §6.

### 5.2 Ordinary seed, if we want it repeatable

Same content as a `prisma/seed-zoho-taxonomy.ts` run through
`ts-node --project prisma/tsconfig.json` (the Windows inline-JSON gotcha). Uses the §4
resolver, so it is idempotent and shares its logic with the route.

---

## 6. The screens and routes

### 6.1 Client methods — `src/lib/integrations/inventory.ts`

```ts
async listBrands()      // GET /brands?per_page=200,     paginate on page_context.has_more_page
async listCategories()  // GET /categories?per_page=200
```

Plus entries in `src/lib/integrations/endpoints.ts` — `apiCall` is `protected`, so a call
from outside that folder will not compile, and the endpoint registry is what
`docs/integrations-endpoints.md` is generated from.

### 6.2 `POST /api/brands/sync-zoho` — guard `brands.create`

Fetches, resolves each row through §4, and returns a **preview**. Writes nothing.

```jsonc
{ "linked":   [ { "zohoBrandId": "...", "name": "HERO", "localId": "...", "matchedBy": "zohoId" } ],
  "adoptable":[ { "zohoBrandId": "...", "name": "SHIMANO", "localId": "...", "matchedBy": "name" } ],
  "new":      [ { "zohoBrandId": "...", "name": "APOLLO" } ],
  "warnings": [ { "name": "RALIEGH", "similarTo": ["RALEIGH","RALEIGY"] } ] }
```

`warnings` runs the same normalise-and-edit-distance check as §2, so the person deciding sees
`RALEIGH / RALEIGY / RALIEGH` grouped rather than as three unrelated rows.

`PUT /api/brands/sync-zoho` applies only the ids the person ticked, in one transaction.

### 6.3 `POST` / `PUT /api/categories/sync-zoho` — guard `categories.create`

Same shape, plus the two-pass parent resolution from §5.1.

**Do not re-guard `GET /api/categories`** — it is on `stock.view` deliberately
(`api/categories/route.ts:14-18`) because every product form reads it for a dropdown.

Worth fixing while here: `GET /api/brands` requires `brands.view`, so a role without it gets
a 403 on the brand dropdown in `/stock`, `/stock-audit` and `/brand-stock/upload`. That is
the inconsistency the category comment warns about, left in place on the brand side.

### 6.4 Screens

- `/more/brands` — a **Fetch from Zoho** button opening the review sheet: three groups
  (already linked / adopt existing / create new), per-row tick, near-duplicate warnings
  inline, and a *link to existing brand* picker for the `HERO` vs `HERO CYCLES` case.
- `/categories` — the same, rendered as the parent/child tree so the shape is visible before
  it is committed.
- Both re-use the existing merge action for cleanup afterwards.
- Ship the missing clash pre-check on `POST /api/brands` in the same change (§3.1).

Logging per `CLAUDE.md`: `createLogger("zoho:taxonomy-sync")`, `log.debug` on the outbound
call with row counts, `log.info` on applied counts, `log.warn` on a near-duplicate the person
accepted anyway, `log.error` with status and endpoint on failure. No token, no payload.

---

## 7. Then: the backfill that actually pays for this

`Product.zohoItemId` is populated on every row. So:

1. page `/inventory/v1/items`
2. match `zohoItemId → Product`
3. set `categoryId` from `category_id` via `Category.zohoCategoryId` (id match, exact)
4. set `brandId` from `brand` via `Brand.name` (name match against the imported 151)
5. never overwrite a product that already has a non-placeholder brand

**5,738 of 5,739 products are currently `Unbranded`** and `brand_vendors` holds 0 rows. On
the sampled coverage this recovers a real brand for roughly two thirds and a real category
for roughly three quarters. The rest stay blank because Zoho is blank there — which is the
honest answer, not a failure.

This is the largest single improvement in the plan and it needs no deployment.

---

## 8. What this removes

`api/zoho/pull-review/approve/route.ts:173-175` and `:309-312` stop inventing a brand from
`d.vendorName`. Once items carry a real brand, the bill import should resolve the brand from
the item, and fall back to leaving it alone — **not** to the vendor name.

Note `vendor_name` is empty on every item sampled, so the bill genuinely remains the only
vendor signal. That part of the import stays.

Also worth recording: **no code in the current tree produces item previews at all.**
`trigger-pull` writes only `bill` and `invoice` rows, and says so at `:541-543`. The
`itempullresponse.js` sample in `prisma/data/` came from an older build. If item previews
carrying brand and category are wanted, that step must be written; it is not there to extend.

---

## 9. Housekeeping

- `zoho-brands.json`, `zoho-brands.txt`, `zoho-categories.json` are untracked in the repo
  root. Move to `prisma/data/` beside the other pulls, or gitignore them. They contain no
  secrets.
- `scripts/zoho-probe.sh` reads `$PGURL` from the environment and holds no password, so it is
  safe to commit.
- The Supabase password was pasted into a chat transcript on 7 Sep 2026. **Rotate it.**

---

## 10. Questions for the owner before any code

1. **Which branch does this stack on?** Current tip is `feat/purchasing-transfers-p5-p15`.
2. **Import all 151 brands, or only those Zoho items actually reference?** 134/200 sampled
   items carry a brand; the full set includes vendors and categories misfiled as brands.
   Importing only referenced brands gives a smaller, truer list.
3. **What should happen to the ~50 rows that are plainly vendors?** Import and let people
   merge, skip them at review, or import and link them through `BrandVendor` instead?
4. **`HERO` (Zoho) vs `HERO CYCLES` (local)** — confirm the *link to existing* action is
   wanted, or should the local row simply be renamed to match Zoho?
5. **Case-insensitive unique on `Brand.name` (§3.1)** — now, later, or never?
6. **Bootstrap by SQL (§5.1) or wait for the screens (§6)?** SQL is faster today; the screen
   is the thing that keeps working next month.

---

## Clarifications recorded

- Zoho **does** expose a brand master with ids. An earlier answer in this session said it did
  not, based on the public docs. Corrected by live API calls; the docs are misleading.
- The item payload carries no `brand_id` — verified on the single-item detail endpoint, and
  confirmed independently by the owner's own saved pull response, which contains
  `categoryId` 0 times and `brandId` 0 times.
