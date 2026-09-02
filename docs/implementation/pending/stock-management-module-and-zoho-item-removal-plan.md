# Stock Management module tree, product types as data, the end of the Zoho item import, and a customer list

Status: in-progress — 1 Sep 2026. **Parts A and B are built** (§16 and §17 record what shipped and how each differed). Parts C and D not started; Part E optional and last.
Branch: **`refactor/stock-management-module`** — create it with exactly this name, off `main`.

Prepared 1 Sep 2026. Every line number, route and constraint below was read off the tree on
that date. Where a decision is still open it is marked **OPEN** and says who decides.

---

## 0. The nine decisions already taken

Recorded first because the rest of the document assumes them and a later reader will
otherwise re-open them.

| # | Question | Decision |
|---|---|---|
| 1 | How far does the Zoho removal go? | **Items/products only.** Bills and invoices stay — `/inbound`, `/bills`, `/receivables` and `/deliveries` depend on them, and the whole `ZohoPullPreview` → `approve` machinery stays alive for both. (Contacts later went too, as a consequence of decision #6 — but for its own reason, and without losing vendors: §2.1.3.) |
| 2 | The products already imported from Zoho | **Wipe and re-seed.** See §4.2 — this is the most destructive step in the plan and it does not only delete products. |
| 3 | Product Type | **A plain model with a `name`, plus list / create / edit.** Explicitly *not* the elaborate version once proposed in `product-type-and-brand-lead-time-plan.md` (since deleted) — no `code`/`name` split, no `tracksSize`, no classifier migration. §5 says how the two `type === "BICYCLE"` branches are handled without those. |
| 4 | Mobile bottom nav | **Stock Management gets a hub page** at `/stock-management`. A parent with a route stays a bottom-nav tab, so nesting the six children costs nothing on the phone. |
| 5 | How much schema may change | **Exactly one change, and only because decision #3 requires it.** Owner's instruction: do not change the schema. Then: *"I need the product type to be a dynamic creation where I must be able to create the product type from my system."* Those cannot both hold — §5.0 shows why. The second wins; the change is confined to what dynamic creation strictly needs, and every other schema edit this plan originally carried has been removed. **Parts A and C change no schema at all.** |
| 6 | The central pull UI | **Gone.** The `/settings/integrations` pull card — the one headed *"Auto-Sync: Daily at 1 PM IST"* — and the whole `/settings/integrations/pull-review` page are deleted. §2.1 records what that does and does not include; the shared `trigger-pull` / `pull-review` / `approve` **APIs stay**, because four other screens run on them. |
| 7 | Loading the product data | **A separate script, run last, and optional.** Owner, 1 Sep 2026: *"I don't need any data that are present in the product table… instead of seed we can have a script which inserts the data from the data file, where we can have the insertion step last or optional."* So the catalog ships **empty**. `scripts/import-products.ts` becomes **Part E** and can be run whenever the file is ready — or never. This dissolves the §15.1 blocker; see §7. |
| 9 | Inactive rows in the export | **Skipped entirely — REVERSES decision recorded in §7.4.1.** Owner, 1 Sep 2026: *"remove the inactive product or rows, don't consider those, only insert the active product."* The earlier answer was "import all as ACTIVE and deactivate later"; it is now a filter, applied before validation. Measured: **5,738 imported, 2,437 skipped** of 8,175 unique. Those SKUs will not exist here — if one later appears on a bill, the bill import creates a fresh product rather than matching it. `ONLY_ACTIVE = false` in the script brings them in. |
| 8 | The AI screens | **Removed, not migrated.** Owner: *"don't add any AI stock alert as of now — if there is anything like that, remove it"*, then *"remove that too, the AI insights too."* The whole `/ai` page and its three AI routes go in Part A. **One exception, with a reason — §2.2.2:** `api/ai/dashboard-insights` contains **no AI at all** (144 lines of raw SQL) and supplies the **Stock Value** and **Low Stock** tiles on two dashboards, so it is *renamed* to `api/dashboard/stats`, not deleted. |

---

## 1. What this plan does, in one paragraph

Four changes on one branch, in four commits. **(A)** The Zoho *item* fetch and everything
built to repair what it produced is deleted — two entry points, two dead routes, two helper
modules and a fix-up queue — and with it (decision #6) the central pull card and the
`pull-review` page, leaving each domain screen to pull its own entity. **(B)** `ProductType` stops being a Prisma enum and becomes a table with a create/list screen, and the catalog is emptied — products now arrive through an **optional Part E script** (decision #7), not through the app. **(C)** Six
Operations modules are re-parented under a new `Stock Management` container.

**All three AI routes are deleted in Part A (§2.2), so none of them reaches Part B.**

A, B and C travel together because A and B are the same decision seen from two sides — you
cannot delete the import without a replacement source of products — and because C's new
`product_types` module has nothing to point at until B ships. They share one
`db:generate` → `db:push` → `db:seed:rbac` → `npm run build` cycle.

**(D)**, added later and unrelated to the other three, gives `/customers` the list screen the
`customers` module has always claimed to have.

**Four commits, in this order**, so each is revertible alone — plus an optional fifth step:

| # | Contains | Rough size |
|---|---|---|
| 1 | **Part A** — remove the Zoho item import, the central pull UI, the AI screens and the dead `import/` tree | ~13 files edited, **10 deleted**, 1 renamed, no schema change |
| 2 | **Part B** — `ProductType` becomes a table, with its screen | **~20 files edited** (§5.2 + §15.2), 5 new, **the plan's only schema change** (§5.0) |
| 3 | **Part C** — the Stock Management module tree + hub page | 1 catalog file, 1 new page, **no schema change** |
| 4 | **Part D** — the customer list | 1 route extended, 1 new page, 1 catalog entry, **no schema change** |
| E | **Part E** — load the product data from the owner's file | **optional, and last** (decision #7). The branch ships without it |

Part A first because it *removes* the code Part B would otherwise have to migrate — the
import paths and the three AI routes are six of the ~23 `Product.type` sites (§5.2 plus §15.2),
and deleting them before the enum change means six fewer files to touch in commit 2.

---

# PART A — the Zoho item import goes away

## 2. What exists today

Two user-facing entry points, both driving the same three-call flow:

```
POST /api/zoho/trigger-pull   {step:"init"}      -> pullId
POST /api/zoho/trigger-pull   {step:"items"}     -> writes ZohoPullPreview rows
POST /api/zoho/trigger-pull   {step:"finalize"}
GET  /api/zoho/pull-review?pullId=…              -> the previews
POST /api/zoho/pull-review/approve {entityType:"item"} -> creates Products
```

| Entry point | Where |
|---|---|
| The **Fetch from Zoho** wizard on `/stock` | `stock/page.tsx:138-140` (state), `:313-410` (the flow), `:603`, `:658`, `:734`, `:771` (UI) |
| The **items** step of the 6-step pull on `/settings/integrations` | `integrations/page.tsx:46` (STEPS), `:322-328` (the call) |
| The item tab on `/settings/integrations/pull-review` | `pull-review/page.tsx` |

Plus two routes with **no caller anywhere in `src/`** — verified, they are already dead:

- `src/app/api/zoho/import/items/route.ts` (132 lines)
- `src/app/api/zoho/import/clean/route.ts` — this one deletes every product and re-imports.
  It is unreachable from the UI and should not survive a plan whose whole point is that
  products no longer come from Zoho.

And a repair layer that exists **only** because the import produced bad rows:

| File | Why it exists |
|---|---|
| `src/lib/import-placeholders.ts` | `PLACEHOLDER_BRAND` / `PLACEHOLDER_CATEGORY` — the invented `Imported` / `Uncategorized` values |
| `src/lib/product-size.ts` | `parseBicycleSize()` recovers a wheel size from the product name because Zoho has no size field |
| `src/app/api/products/backfill-size/route.ts` | runs that parse over already-imported rows |
| `stock/page.tsx:~992` | the "products the Zoho import could not describe" fix-up banner |
| `stock/page.tsx:~283` | the button that calls backfill-size |

## 2.1 The central pull UI goes too — added 1 Sep 2026 on the owner's instruction

> *"I don't need the `settings/integrations` + `settings/integrations/pull-review` UI and its
> related backend, and this card UI too: **Auto-Sync: Daily at 1 PM IST** — Pulls new vendors,
> items, bills, and invoices… Full import (all items, ~27 API calls for 5000+ items) — Pull
> Now — Review Pulls."*

Two things were checked before writing this in, and both change what the removal means.

### 2.1.1 That card advertises a schedule that does not exist

`integrations/page.tsx:678` renders the literal string **"Auto-Sync: Daily at 1 PM IST"**.
There is no such sync. `CLAUDE.md` is explicit — `api/cron/*` was deleted, `CRON_SECRET` is
gone, `vercel.json` declares no `crons` array, and `cron-removal-plan.md` shipped 28 Aug 2026.
Nothing in this application runs on a schedule.

So the card has been telling every admin that vendors, items, bills and invoices sync
themselves once a day, for four days, while the only thing that pulls anything is the **Pull
Now** button directly beneath the claim. **Deleting it removes a false statement from the UI**,
which is a better reason to delete it than tidiness.

### 2.1.2 The pull-review page is a duplicate — but its API is not

`/settings/integrations/pull-review` is not the only review screen. **Four domain pages
already run the identical pull → preview → approve sequence inline**, each against its own
entity:

| Page | Steps it drives | Review UI |
|---|---|---|
| `/inbound` (`:180`, `:209`, `:218`, `:228`, `:269`) | `init` → `bills` → `finalize` | its own, inline |
| `/bills` (`:142`, `:163`, `:176`, `:189`, `:225`) | `init` → `bills` → `finalize` | its own, inline |
| `/receivables` (`:114`, `:139`, `:147`, `:157`, `:168`, `:240`) | `init` → `invoices` → `finalize` | its own, inline |
| `/deliveries` (`zoho-import-flow.tsx:180`, `:203`, `:218`, `:232`, `:265`) | `init` → `invoices` → `finalize` | its own, inline |

Every one of them calls `GET /api/zoho/pull-review` and `POST /api/zoho/pull-review/approve`.

**Therefore: the page is deleted, the API is not.** "Related backend" here means the page's
own code and nothing else — `trigger-pull`, `pull-review` and `approve` are shared
infrastructure that four kept flows sit on. Deleting them breaks `/deliveries` Bulk Fetch,
`/bills`, `/inbound` and `/receivables` simultaneously, which is the exact outcome decision #1
exists to prevent.

### 2.1.3 The contacts step goes with the card — and vendors are fine

An earlier draft of this section claimed deleting the card "kills vendor import outright".
**That was wrong**, and the correction is recorded here rather than quietly removed, because
the wrong version would have added a screen nobody needs.

Three facts, each read off the code:

1. **Fetching stock never creates a vendor.** The item branch of `approve` (`:129-182`)
   writes `Product`, and finds-or-creates `Brand` and `Category`. `prisma.vendor` does not
   appear in it. Items and vendors are unrelated paths that happened to share one button.
2. **The bill import already creates vendors.** `approve` bill branch (`:205-215`) —
   *"Find vendor — auto-create if not found"* — matches on name, case-insensitive, and
   creates `{ name, code }` when there is no match. `/inbound` and `/bills` both drive the
   `bills` step, and both survive. **So vendors keep arriving from Zoho after this change.**
3. **`/vendors/new` creates them by hand**, and its form carries every field the contacts
   step wrote: `gstin` (`:81`), `city` (`:98`), `state` (`:102`), `phone` (`:113`),
   `email` (`:123`), plus `pan`, address and WhatsApp.

So `step: "contacts"` is a **third** path to a row that already has two. Delete it with the
card, along with the `contact` branch of `approve` and `import/contacts/route.ts`.

**The one real loss, stated plainly:** a vendor auto-created from a bill gets `name` and
`code` only — no GSTIN, no email, no phone. The contacts step was the only thing that filled
those automatically. After this change someone opens the vendor and types them in.

**That matters most for `gstin`**, which is not cosmetic: it drives GST treatment and ITC on
that vendor's bills. It is not silently lost — `/vendors/new` and the vendor edit screen both
expose it — but a bill-created vendor now starts blank where it used to start populated, and
nothing prompts anyone to fill it. Worth a follow-up (a "vendors missing GSTIN" list on
`/vendors`); out of scope here.

**No open question. §3 and §4 delete the contacts step.**

## 2.2 The AI screens go — decision #8, widened 1 Sep 2026

> *"Don't add any AI stock alert as of now. If there is anything like that, remove it."*
> … then: *"yes remove that too, the AI insights too."*

### 2.2.1 What was checked

| | |
|---|---|
| Four routes exist | `dashboard-insights`, `demand-forecast`, `low-stock-alerts`, `reorder-suggestions` |
| All four are guarded | `requireFeature("reorder", "view")` — consistently, no gap |
| **There is no `ai` module in `rbac-catalog.ts`** | verified. `/ai` appears in **no** sidebar, mobile or desktop. Reachable only by typing the URL |
| `/ai/page.tsx` renders four tabs | Overview, Reorder, Forecast, Alerts — one per route |
| `ai/page.tsx:60` | `fetch(endpoint).then((r) => r.json())` — the pattern CLAUDE.md bans. Deleted along with the page |

### 2.2.2 ⚠️ `dashboard-insights` contains no AI, and two live tiles depend on it

**Read this before deleting the folder.** `api/ai/dashboard-insights/route.ts` is 144 lines
of `prisma.$queryRaw`, `aggregate` and `groupBy`. **There is no Anthropic call, no OpenAI
call, no model of any kind.** It is a statistics endpoint that happens to live under `api/ai/`.

And it is not confined to the orphan page. It feeds **two real numbers on two dashboards**:

| Consumer | Reads | Renders |
|---|---|---|
| `(dashboard)/page.tsx:232`, `:239` | `stock_value` | the **Stock Value** tile |
| `(dashboard)/page.tsx:233`, `:241` | `reorder` | the **Low Stock** count |
| `(dashboard)/page.tsx:923`, `:926` | `reorder` | `lowStock` on the second view |
| `desktop/page.tsx:62`, `:67` | `stock_value` | the desktop **Stock Value** tile |

Deleting the route outright blanks Stock Value and Low Stock on the main dashboard *and* on
desktop. Those are ordinary aggregates the shop needs; nothing about them is AI.

### 2.2.3 What is therefore removed, and what is kept

**Deleted — every genuinely AI-branded surface:**

```
src/app/api/ai/low-stock-alerts/route.ts
src/app/api/ai/demand-forecast/route.ts
src/app/api/ai/reorder-suggestions/route.ts
src/app/(dashboard)/ai/page.tsx                  <- the whole orphan page, all four tabs
```

Also removed from `(dashboard)/page.tsx`: the **Smart Insights** card (`:393-412`), the
**AI Insights** count tile (`:364-365`), the `insights` field on its state type (`:35`),
the `:248` filter that populated it, and the `View all insights` link to the now-deleted
`/ai` (`:411`).

**Kept, but moved out of `api/ai/`:** the statistics route becomes
**`src/app/api/dashboard/stats/route.ts`**, unchanged in behaviour, with its three callers
repointed. The name stops claiming something the code does not do, and Stock Value and Low
Stock keep working. `src/app/api/ai/` is then empty and the folder goes.

**This removes three of the ~23 `Product.type` call sites** (`demand-forecast:52`,
`low-stock-alerts:19`, `reorder-suggestions:27`) before Part B has to migrate them.

**If the owner would rather lose Stock Value and Low Stock as well**, say so and the route
goes with the rest — but it is deleting working aggregates to remove an inaccurate folder
name, so the rename is the recommendation.

## 3. Files to delete outright

```
src/app/api/zoho/import/items/route.ts
src/app/api/zoho/import/clean/route.ts
src/app/api/products/backfill-size/route.ts
src/lib/import-placeholders.ts
src/app/(dashboard)/settings/integrations/pull-review/page.tsx     <- decision #6, §2.1
src/app/api/zoho/import/contacts/route.ts                          <- §2.1.3, already uncalled
src/app/api/ai/low-stock-alerts/route.ts                           <- decision #8, §2.2
src/app/api/ai/demand-forecast/route.ts                            <- decision #8, §2.2
src/app/api/ai/reorder-suggestions/route.ts                        <- decision #8, §2.2
src/app/(dashboard)/ai/page.tsx                                    <- the orphan AI page
```

`src/lib/product-size.ts` is **not** deleted — see §3.1.
`src/app/api/zoho/pull-review/**` is **not** deleted — see §2.1.2. The page goes, the API stays.

**Resolved 1 Sep 2026 — the owner approved deleting these too**, so `src/app/api/zoho/import/`
goes entirely:

```
src/app/api/zoho/import/bills/route.ts
src/app/api/zoho/import/invoices/route.ts
```

All five routes under `import/` are uncalled from `src/` — verified. **One check before the
delete lands:** `docs/postman/zoho-integration.postman_collection.json` and
`scripts/gen-zoho-postman.js` exist in this tree, so confirm the Postman collection does not
exercise these paths. If it does, the collection is regenerated rather than the routes kept.

### 3.1 `src/lib/product-size.ts` shrinks, it does not go

`BICYCLE_SIZES` (`:27`) is imported by `stock/page.tsx:24` and drives the size filter at
`:969`. That filter is still wanted — seeded products carry a real size. So:

- **keep** `export const BICYCLE_SIZES`
- **delete** `parseBicycleSize()` and the `SIZE_ALTERNATION` regex machinery that only serves it
- the file's header comment, which is entirely about parsing Zoho names, is rewritten to
  describe a list of wheel sizes

## 4. Files to edit

| File | Change |
|---|---|
| `src/app/api/zoho/trigger-pull/route.ts` | delete `buildItemPreviews()` (~`:52-160`), the `if (step === "items")` block (`:230-277`) and — per §2.1.3 — the `if (step === "contacts")` block (`:278-360`). `init`, `bills`, `invoices` and `finalize` are untouched. |
| `src/app/api/zoho/pull-review/approve/route.ts` | delete the `entityType === "item"` branch (`:129-182`), and with it `resolveCategory()` (`:86`) and `defaultBrand` (`:95-97`) — **verified: both are referenced only from inside that branch, at `:137` and `:153`.** Also delete the `entityType === "contact"` branch (`:111-128`) per §2.1.3. **Do not touch the `bill` branch's vendor auto-create (`:205-215`)** — after this change it is how vendors arrive from Zoho. |
| `src/app/(dashboard)/stock/page.tsx` | remove `fetchStep`/`itemPreviews` state (`:138-140`), the fetch flow (`:313-410`), its four UI blocks (`:603`, `:658-771`), the backfill-size button (`:283`) and the fix-up banner (`:992-993`). **Keep** the bulk brand/category/bin assign (`:255` → `/api/products/bulk`) — it is useful independently of imports; only the "the import invented this" framing goes. |
| `src/app/(dashboard)/settings/integrations/page.tsx` | **decision #6 — delete the whole pull card**, not just its items step: the `STEPS` array (`:46-47`), `callStep`, every pull-progress state, the "Auto-Sync: Daily at 1 PM IST" heading (`:678`), the sub-copy (`:681`), the full-import checkbox (`:795-804`), **Pull Now** (`:813`) and both **Review Pulls** links (`:784`, `:818`). **What survives on this page:** the three provider connect/disconnect cards, the sync-log history, and `CleanupSection` (`:860`) — none of which is pull UI. |
| `src/app/api/products/route.ts` | remove the `PLACEHOLDER_*` import (`:15`) and the needs-fix-up filter (`:73-74`). |
| `src/app/api/stock-counts/[id]/route.ts` | `:214` — drop `PLACEHOLDER_BRAND` from the `suggestedBrand` overwrite condition, leaving `["Unbranded","General"]`. |
| `src/app/(dashboard)/more/categories/page.tsx` | remove the `Uncategorized` explainer banner (`:376-380`) and the import (`:16`). |
| `prisma/rbac-catalog.ts` | **not a schema change** — seed input; it writes `permissions` rows, and `Module.parentId` already exists. Drop `"fetch"` from the `stock` module's actions (`:97`). **Verified: no `requireFeature("stock","fetch")` and no `canFetch("stock")` exists** — the wizard was gated by `zoho.fetch`. The seeder's stale-permission sweep (`seed-rbac.ts:169`) removes the row and its grants on the next seed. |
| `prisma/schema.prisma` | **no change in Part A.** `ZohoPullLog.itemsNew` stays — after the items step goes nothing writes it, which is harmless, and decision #5 holds the schema footprint to §5.0's four lines. |
| `src/lib/integrations/*` | **Owner approved the strip, 1 Sep 2026.** Delete `listItems`/`listAllItems` (`base.ts:440,448`), `BooksClient.getItem` (`books.ts:30`), the `IntegrationItem` type (`base.ts:41`) and **both `endpoints.ts` registry entries** (`:103` `listItems / listAllItems`, `:121` `BooksClient.getItem`). The registry documents the surface the app *uses*; an entry whose `owner` field names a method that no longer exists is worse documentation than no entry. Do this last in commit 1, after the call sites are gone, so the compiler proves nothing else referenced them. |

## 4.1 Docs affected

`imported-product-data-quality-plan.md` (**since deleted outright** rather than superseded — the owner removed it, which settles this section) was entirely about
repairing this import. Its "What remains" list — run the Part 0 measurement, then Part B,
then fix `autoType` — describes work that cannot exist after this branch.

**Approved by the owner, 1 Sep 2026 — supersede it, do not delete it.** Rewrite its header to
`Status: completed — superseded by stock-management-module-and-zoho-item-removal-plan.md,
1 Sep 2026`, add a short note saying the import was removed rather than repaired, and let
`.claude/hooks/plan-status.cjs` move the file to `completed/` and refresh the README tables.

The file is kept because it holds the evidence: **89 of 132 items came back typed `ACCESSORY`
while plainly being bicycles.** That measurement is the strongest single argument for why
this import was dropped instead of fixed, and deleting the plan would delete the reason.

The branch it shipped on, `fix/import-data-quality`, has uncommitted work in the tree
(`backfill-size`, `product-size.ts`, `import-placeholders.ts`, the `/stock` fix-up queue).
Part A deletes all of it. **Settle that branch — merge or abandon — before cutting
`refactor/stock-management-module` off `main`**, or the same code gets deleted on one branch
and revived by a later merge of the other.

Also touched: `docs/data-flow-and-modules.md`, `docs/water-flow-chart.md`,
`docs/agents/integration-architect.md` and `CLAUDE.md`'s cron table all describe the item
pull. Each needs a pass; none is load-bearing.

---

# PART B — products come from a seed, and `ProductType` becomes a table

## 4.2 ⚠️ The wipe is not confined to products — read this before running it

Decision #2 is wipe-and-re-seed. `Product` is the parent of **ten** relations
(`schema.prisma:492-506`):

```
transactions       InventoryTransaction[]     stock history
stockCounts        StockCountItem[]           every past audit line
serialItems        SerialItem[]               serial numbers
stockLevels        StockLevel[]               per-location quantities
purchaseOrderItems PurchaseOrderItem[]        open PO lines
transferOrderItems TransferOrderItem[]        open transfer lines
inboundLineItems   InboundLineItem[]          open shipment lines
brandStockMatches  BrandStockItem[]
brandSkuMappings   BrandSkuMapping[]
lmsProducts        LmsProduct[]               soft link, nullable
```

Deleting the products deletes or orphans all of it. **An open purchase order, an in-flight
inbound shipment or an unfinished stock audit that references a wiped SKU is destroyed, not
migrated.** That is a business consequence, not a technical one.

**Step 1 of this part, before any code:** run a count of rows in each of those ten tables
against the live database and show the owner the numbers. If PO / inbound / transfer lines
are all zero, the wipe is safe and cheap. If they are not, the owner should re-take decision
#2 with the numbers in front of them — the alternative (upsert by `sku`, preserving history)
is a smaller script, not a bigger one.

The plan proceeds on the wipe path as decided, but it does not run the wipe until that count
is on the table.

### 4.3 Order of deletion

Prisma will not cascade what the schema does not declare. The seed's wipe runs inside one
`$transaction`, children first:

```
InventoryTransaction -> StockCountItem -> SerialItem -> StockLevel
-> PurchaseOrderItem -> TransferOrderItem -> InboundLineItem
-> BrandStockItem (null the match) -> BrandSkuMapping (unlink)
-> LmsProduct (null productId) -> Product
```

Each `onDelete` rule is to be read off the schema and confirmed during implementation rather
than assumed from this list.

## 5.0 Why this is the one schema change, and why nothing else will do

The owner asked for no schema change, then asked to be able to **create a product type from
the running system**. This section records why only one of those can be true, so the question
is not re-opened.

`Product.type` is a Prisma **enum** (`schema.prisma:221-228`). An enum's values are part of
the PostgreSQL type definition. Adding "E-Bike" to it means editing `schema.prisma`, running
`db:push`, and redeploying — precisely the thing dynamic creation exists to remove. There is
no runtime path to a new enum value.

Three schema-free alternatives were considered; each fails on the same point:

| Alternative | Why it fails |
|---|---|
| Store the type list in `AppSetting` (`schema.prisma:1634` — a generic `key`/`value` table that already exists) | You could create and rename entries freely, but `Product.type` still accepts only the six enum values, so a type created this way **can never be put on a product**. A Create button producing something unusable is worse than no button. |
| Reuse `Category`, already a dynamic table | Different vocabularies. `/stock` renders both — tabs by type, a filter by category. Merging collapses two axes into one and silently changes what every product's category means. |
| Leave the six values, make the screen read-only | Honest and free, but not what was asked for. Recorded so the option stays visible if the cost below is judged too high. |

So the enum becomes a table, **held to the minimum that buys dynamic creation**:

```
ADD    model ProductType
ADD    Product.productTypeId  (FK)
DROP   Product.type           (the enum column)
DROP   enum ProductType
```

Four lines, in commit 2. That is the entire schema footprint of this plan.

## 5. `ProductType`: the model

Per decision #3 — a plain model, `name`, with list / create / edit.

```prisma
model ProductType {
  id        String   @id @default(cuid())
  name      String   @unique          // "Cycles", "Spares", "Accessories" — free text
  sortOrder Int      @default(0)      // tab order on /stock
  isActive  Boolean  @default(true)   // retire without deleting
  products  Product[]
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([isActive, sortOrder])
}

model Product {
  ...
  productTypeId String
  productType   ProductType @relation(fields: [productTypeId], references: [id])
  // type       ProductType   <- the enum column, deleted

  @@index([productTypeId])          // was @@index([type])         — schema.prisma:506
  @@index([status, productTypeId])  // was @@index([status, type]) — schema.prisma:507
}

// enum ProductType { BICYCLE SPARE_PART ACCESSORY BOX_PIECE WIP FINISHED_GOOD }  <- deleted
```

Two fields beyond `name`, each earning its place in one line:

- **`sortOrder`** — `/stock:791-792` and `/stock-audit/new:212-214` render the types as an
  ordered tab bar. Without a stored order the tabs reshuffle on every insert.
- **`isActive`** — decision #3 asks for list/create/edit and **not** delete. `Product.productTypeId`
  is required, so deleting a type in use would orphan products; `isActive: false` is how a
  type leaves the pickers. If the owner would rather have a real delete, it must be
  *restricted* and fail with a count ("used by 412 products"), never cascade.

Deliberately absent, per decision #3: no `code`/`name` split, no `tracksSize`.

### 5.1 The two `type === "BICYCLE"` branches, without `tracksSize`

Dropping the enum breaks two name-checks. Neither needs a new column:

| Site | Today | After |
|---|---|---|
| `stock/[id]/page.tsx:335,338` | show the size badge only when `product.type === "BICYCLE"` | **show the badge whenever `product.size` is set.** A product either has a size or it does not; the type check adds nothing and is exactly the name-comparison CLAUDE.md bans for roles. |
| `stock/page.tsx:969` size filter | offered under the Cycles tab | offer it always. `BICYCLE_SIZES` stays a static list of wheel sizes. |

This is why `tracksSize` is not needed: the field's own nullability already carries the
information the flag was invented to carry.

### 5.2 Every `Product.type` call site

**This table is incomplete — read it together with §15.2**, which lists eight more the
original scan missed. Together they come to roughly twenty-three.

**Deleted by Part A, so they never reach commit 2** — `zoho/import/items:73-80`,
`zoho/import/clean:81-83`, `zoho/pull-review/approve:149-162`,
`products/backfill-size:44,73`, and the three AI routes (`demand-forecast:52`,
`low-stock-alerts:19`, `reorder-suggestions:27`) per §2.2.

**To change in commit 2:**

| File | Line | Change |
|---|---|---|
| `src/lib/validations.ts` | `:29-34` | the `z.enum([...])` becomes a cuid string; existence is checked in the route |
| `src/app/api/products/[id]/route.ts` | `:136-143` | `VALID_TYPES` array → `prisma.productType.findUnique` |
| `src/app/api/products/route.ts` | `:28`, `:85` | `?type=` query param → `?productTypeId=` |
| `src/app/api/stock-counts/route.ts` | `:114` | same |
| `src/app/api/reports/stock-value/route.ts` | `:100-103` | `p.type.replace(/_/g," ")` → `p.productType.name`; the query needs `include: { productType: true }` |
| `src/app/(dashboard)/stock/page.tsx` | `:156`, `:438`, `:791-792` | hardcoded three-tab union type → tabs fetched from `/api/product-types`. **Default to `ALL`, not the first type** — §15.5 |
| `src/app/(dashboard)/stock/[id]/page.tsx` | `:251`, `:335`, `:338` | picker from the API; badge per §5.1 |
| `src/app/(dashboard)/stock-audit/new/page.tsx` | `:212-214` | tabs from the API |
| `src/app/api/products/auto-classify/route.ts` | `:136-142` | **delete the route.** It force-creates the categories `Bicycles`/`Spares`/`Accessories` and maps them to enum values — it is an import artefact and has no UI caller. Verified. |

**Not a call site, do not touch:** `inbound/[id]/page.tsx:128-151,635-660` uses the strings
`BICYCLE`/`SPARE_PART`/`ACCESSORY`/`MIXED` for a *shipment* type held in `localStorage`
(`:132`). It never reads `Product.type`. It is a separate vocabulary that happens to share
words. Leave it, and add a one-line comment saying so, because the next person will try to
"fix" it.

## 6. The Product Types screen and API

New:

```
src/app/api/product-types/route.ts        GET (list)   POST (create)
src/app/api/product-types/[id]/route.ts   PATCH (edit)
src/app/(dashboard)/product-types/page.tsx
```

- Guards: `requireFeature("product_types", "view" | "create" | "edit")`. No delete route —
  §5 explains why. The frontend's `canEdit` is cosmetic; the routes re-check.
- Zod schema in `src/lib/validations.ts`: `name` required, trimmed, 1-40 chars;
  `sortOrder` int; `isActive` boolean.
- `name` is `@unique` — a duplicate create returns a 409 with the existing name, not a
  Prisma error string.
- Logging per CLAUDE.md: `createLogger("product-types")`, `log.info` on create/edit with the
  type id, `log.error` in every catch.
- The list endpoint returns `_count.products` so the screen can show usage and so a future
  delete can refuse with a number.

## 7. Two scripts, not one — and only the first is required

Decision #7 splits what was a single seed into **two files with different lifetimes**, and
that split is what dissolves the §15.1 blocker rather than working around it.

### 7.0 `prisma/wipe-products.ts` — required, runs inside commit 2

```
"db:wipe:products": "ts-node --project prisma/tsconfig.json prisma/wipe-products.ts"
```

The §4.3 delete cascade and nothing else. **It must not mention `ProductType`** — it runs
*before* `db:generate`, against the old client, and `ts-node` typechecks the whole file
before executing a line (`prisma/tsconfig.json` sets no `transpileOnly`). A single combined
file cannot satisfy both sides of the schema change; two files trivially can.

Why it is required at all: `Product.productTypeId` is non-null, and `db:push` cannot add a
required column to a populated table without `--accept-data-loss` (§12.1). Emptying the
table first turns a data-loss prompt into an ordinary `ALTER`.

Decision #7 makes this uncontroversial — **the owner does not want the existing product rows**
— but §4.2 still applies to what hangs off them, and the row count is still worth running.

### 7.1 Default product types — seeded with the schema, not with the data

The catalog ships empty, but `ProductType` must not: `/stock`'s tabs, the product form and
`/product-types` all need something to show on day one, and `Product.productTypeId` is
required so nothing can be created without a type to point at.

So commit 2 seeds a handful directly — `Cycles`, `Spares`, `Accessories` — carrying the three
enum values that actually held products. `BOX_PIECE`, `WIP` and `FINISHED_GOOD` are **not**
recreated: all three have zero rows and always did, and the whole point of decision #3 is
that the owner adds what they need from `/product-types` instead.

### 7.2 `scripts/import-products.ts` — Part E: optional, and last

```
"import:products": "ts-node --project prisma/tsconfig.json scripts/import-products.ts <file>"
```

**Not part of commits 1–4.** It is written and run when the owner's file is ready, against a
schema that has already settled — so it compiles against the new client with no ordering
problem at all. If the file never arrives, the branch still ships and the catalog is simply
built by hand from `/product-types` and (once it exists) a product form.

What it does:

1. Read the `.xlsx`/`.csv` via `src/lib/excel-parser.ts` — §7.4.
2. Upsert `ProductType` rows for any type in the file not already present.
3. Upsert `Brand` and `Category` rows from the file's distinct values.
4. **Upsert products by `sku`**, not `createMany`. By the time this runs the catalog may
   already hold hand-created rows, and a blind insert would collide with `Product.sku @unique`
   and abort the run partway through.
5. **No `StockLevel` rows, `currentStock: 0`** — §7.3. Deliberate: `currentStock` is a
   *cached SUM* of `StockLevel` (`schema.prisma:518`, recomputed by
   `src/lib/stock-location.ts`), so writing a quantity to one and not the other yields a
   catalog that looks right on `/stock` and reports zero everywhere location matters. Zero in
   both is consistent. Quantities come from a stock audit.
6. Print a summary: types, brands, categories, products created vs updated, rows skipped.

It lives in `scripts/` rather than `prisma/` on purpose — `prisma/` is for schema and seed;
this is an operator tool that happens to write to the database, and `scripts/` already holds
one (`gen-zoho-postman.js`).

### 7.3 Opening stock is ZERO — decided 1 Sep 2026

The owner's decision: **the seed loads the catalog, not the quantities.** No `StockLevel`
rows are written and every `Product.currentStock` is `0`.

This removes the question the earlier draft could not answer (one number or per-location?)
and it removes step 6 of §7 entirely — there is no location to nominate and no sum to cache.

**What it means operationally, and it is not small.** The moment the wipe runs, the system
believes it holds nothing. Every screen driven by stock — `/stock` quantities, `/reorder`,
the dashboard's stock-value insight, `/reports/stock-value` — reads zero until real numbers
are established. Two ways in, both already built and both behind existing permissions:

- **A stock audit** (`/stock-audit/new`, `stock_audit.create`) — count the shelves and let
  the reconciliation write the levels. This is the intended path and the reason the module is
  in the Stock Management tree.
- **Inbound receiving** (`/inbound`) for anything arriving after the cutover.

**Sequence this deliberately:** do not run the wipe on a working day and discover at the
counter that every SKU reads zero. Seed the catalog, then count, then go live.
### 7.4 The data file — PROFILED 1 Sep 2026 against the real export

The file arrived: **`docs/implementation/Item.xls`**, 2.2 MB, a genuine legacy BIFF `.xls`
(OLE compound document, magic `D0 CF 11 E0`) — not a renamed CSV. One sheet, `Item`.
The `xlsx` package already in `package.json:49` reads BIFF8 directly.

**Now at `prisma/data/Item.xls`** — moved out of `docs/implementation/`, which is for plans.
8,216 rows of pricing is not documentation. Confirm it is git-ignored.

```
8,216 data rows   ->   8,175 unique items   (37 duplicate pairs, see below)
13 columns
```

#### 7.4.1 Column-by-column, measured not assumed

| # | Excel column | Blank | Distinct | → `Product` field |
|---|---|---|---|---|
| 0 | `Item Name` | 0 | 8,175 | **not imported** — superseded by `Product Name`, by instruction |
| 1 | `Item ID` | 0 | 8,175 | **`zohoItemId`** — the natural key. `@unique` and deliberately kept (consequence 9) |
| 2 | `Selling Price` | 0 | 1,583 | **`sellingPrice`** — format `INR 6499.00`, **all 8,216 match `/^INR [0-9.]+$/`**, no exceptions |
| 3 | `Brand` | **2,598** | 123 | **`brandId`** — 5,577 rows keep their real brand; 2,598 fall back to an `Unbranded` row |
| 4 | `Manufacturer` | 2,689 | 78 | **not imported** — dropped by instruction |
| 5 | `Taxable` | 0 | **1** | **nothing.** Every row is `"true"`. A dead column |
| 6 | `Status` | 0 | 2 | **read as a FILTER, never stored** — decision #9. Of the 8,175 unique rows, **5,738 are Active and are imported; 2,437 are Inactive and are skipped outright.** (The 5,768/2,448 split quoted earlier was measured before deduplication.) |
| 7 | `SKU` | 0 | 8,175 | **`sku`** — `@unique`. Mostly a plain counter (`1`,`2`,`3`…); 62 are real codes (`MON-TRA-BLU`, `MAC-CIT-26-SS-ORA`) |
| 8 | `HSN/SAC` | 234 | 168 | **`hsnCode`** — nullable, fine |
| 9 | `Purchase Price` | 0 | 2,452 | **`costPrice`** |
| 10 | `Product Name` | 0 | 8,138 | **`name`** — the owner’s choice over `Item Name`. Never blank; 37 products share a name, which `Product.name` permits (it is not unique) |
| 11 | `Category Name` | **1,353** | 32 | **not imported** — §7.4.3 |
| 12 | `Intra State Tax Rate` | 0 | 4 | **`gstRate`** — 5 % ×7,413, 18 % ×790, 12 % ×7, 28 % ×6 |

#### 7.4.2 The 37 duplicates are safe to drop

37 SKUs appear twice, 78 rows in total. **All 37 groups are byte-identical** — same
`Item ID`, same name, same prices, same status, on adjacent rows. A Zoho export artefact,
not two real products sharing a code.

Dedupe on `Item ID` (first wins). 8,216 → 8,175.

#### 7.4.3 Derivation was considered and then REMOVED by instruction

An earlier draft of this script derived product **type** and **size** from `Category Name`
(whose 32 values are 20 wheel sizes plus 11 category words) with `HSN/SAC` as a fallback for
the 1,353 blanks. It measured well — 6,822 rows decided by the curated column, 1,104 by HSN,
only 146 falling through.

**The owner removed it on 1 Sep 2026:** *"don't use any auto type regex."* Recorded rather
than deleted, because the measurements are the argument for either choice and the next person
will otherwise re-derive them:

- `Category Name` size values: `12 · 14 · 16 · 20 · 24 · 26 · 27.5 · 28 · 29 · 700C`, most with an
  `MS`/`SS` (multi-speed / single-speed) suffix — 4,841 rows.
- `Category Name` category words: `Accessories` 741, `SPARES` 717, `TOYS` 221, `E CYCLE` 187,
  `TRI CYCLE` 53, `service` 22, `BIKE` 15, `MINI CAR` 11, `old / refurbished cycles` 5,
  `PACKING MATIRIAL` 5, `GOGGLES` 4 — 1,981 rows. 1,353 blank.
- HSN is genuinely structured (8712 bicycles · 8711 motorised · 8714 cycle parts · 9503 toys),
  and cross-tabulating confirmed the curated column beats it where both exist.

**One bug that pass DID find, worth keeping:** matching a size token in the product name reads
`42T` and `44T` as wheel sizes. They are **chainring tooth counts**. Any future attempt at
name-derived sizing must whitelist real wheel sizes — the unrestricted version invented
`42"`, `44"`, `25"`, `22"`, `19.5"`, `19"`, `18"` and `27"` for 15 products.

**What the script does instead:** every product gets `type = SPARE_PART` (the schema default),
one `Uncategorized` category and no size. After the import `/stock`'s Cycles tab is empty and
all 8,175 sit under Spares — the expected state, corrected in bulk once product types are
editable data.

#### 7.4.4 What the file CANNOT supply

`Product` fields with no column behind them:

| Field | Required? | Resolution |
|---|---|---|
| `categoryId` | **yes** | one `Uncategorized` row for all 8,175. Owner's decision — re-filed later from `/more/categories`, which already supports a parent/child tree |
| `brandId` | **yes** | the `Brand` column where present (**5,577 rows**), else an `Unbranded` row (**2,598**) |
| `type` | **yes** | `SPARE_PART` for all — §7.4.3 |
| `size`, `color`, `description` | no | nothing usable without a classifier |
| `mrp` | no (default 0) | mirrors `sellingPrice`; 0 renders an empty MRP on every label |
| `currentStock` + `StockLevel` | no | **deliberately 0** — §7.3 |
| `minStock`/`maxStock`/`reorderLevel`/`reorderQty` | no (default 0) | set per product later |
| `condition` | no (default `NEW`) | not carried |
| `binId`, `reorderVendorId`, `imageUrls`, `tags` | no | nullable / empty |

**Excel columns deliberately NOT imported:** `Status` is read to filter on but never stored (decision #9); `Item Name` (superseded by `Product Name` on the
owner's instruction — they differ on 51 rows, always as variant vs group),
`Manufacturer` (dropped by instruction; it was only a brand fallback worth 24 rows),
`Taxable` (constant `"true"`), `Category Name` (§7.4.3), `Status` (all rows import ACTIVE).


---

# PART C — the Stock Management module tree

## 8. What the sidebar is, so the change is understood

Navigation is **entirely** data-driven. `src/lib/nav-config.ts` is a 13-line stub whose only
export is a URL helper; every sidebar entry comes from the `modules` table filtered by the
user's `view` grant (`app-sidebar.tsx:88-120`). **Part C therefore changes one file —
`prisma/rbac-catalog.ts` — plus one new page. No component is edited.**

Two constraints the seeder enforces and this design respects:

- **Exactly two levels.** `seed-rbac.ts:48` throws on a grandchild. This is why *Product
  Types is a direct child of Stock Management, not a child of Stocks* — the latter would be
  depth 3, would be rejected at seed time, and if it somehow got in would render nowhere.
- **A child's `group` must equal its parent's** (`seed-rbac.ts:57`). All seven rows below
  carry `group: "Operations"`.

## 9. The catalog change

Six existing modules gain a `parentKey` and a new `sortOrder`. **Their `key` values do not
change** — this is the point. Permissions key off the module key, so every existing
`stock.view`, `inbound.create`, `deliveries.approve`, `transfers.edit`, `stock_audit.approve`
grant on every role survives the move untouched. The seeder upserts `route`, `group`,
`sortOrder` and `parentId` in both create and update, so a re-seed *performs* the re-parenting
on the existing rows. This is exactly how `zoho` was moved under `settings`
(`rbac-catalog.ts:577-586` and its comment).

```ts
// ── Stock Management ──────────────────────────────────────────────────────
// A parent plus six children — the third module tree in this catalog, after Staff LMS
// and Store Management.
//
// Unlike `store_management`, this parent HAS a route. That is deliberate and it is about
// the phone: bottom-nav.tsx:24 filters to `!m.parent`, so a routeless parent would drop
// Stock, Inbound and Deliveries off the mobile bottom bar entirely and leave a stock user
// with Second-Hand / Scanner / POS. The hub page keeps the tab.
{
  key: "stock_management",
  label: "Stock Management",
  description: "Stock, product types, audits, inbound, dispatch and transfers",
  icon: "Boxes",
  route: "/stock-management",
  group: "Operations",
  sortOrder: 100,
  actions: ["view"],
},
{ key: "stock",         parentKey: "stock_management", sortOrder: 101, /* route /stock,        actions minus "fetch" */ },
{ key: "product_types", parentKey: "stock_management", sortOrder: 102, /* route /product-types, actions view/create/edit */ },
{ key: "stock_audit",   parentKey: "stock_management", sortOrder: 103, /* route /stock-audit */ },
{ key: "inbound",       parentKey: "stock_management", sortOrder: 104, /* route /inbound */ },
{ key: "deliveries",    parentKey: "stock_management", sortOrder: 105, /* route /deliveries */ },
{ key: "transfers",     parentKey: "stock_management", sortOrder: 106, /* route /transfers */ },
```

The full new module:

```ts
{
  key: "product_types",
  label: "Product Types",
  description: "The product type list used by the stock tabs and every product record",
  icon: "Tag",
  route: "/product-types",
  parentKey: "stock_management",
  group: "Operations",          // MUST equal the parent's — the seeder asserts it
  sortOrder: 102,
  actions: ["view", "create", "edit"],   // no delete — see §5
},
```

**Sort orders `101-106` are free** — verified: `stock` was 100, then `inbound` 110,
`deliveries` 120, `transfers` 130, `stock_audit` 140. The order above is the owner's stated
order (stocks, product types, stock audit, inbound, dispatch, transfers), not the old numeric
one.

**What stays in Operations as a root:** `second_hand` (150), `barcode` (160), `pos` (170).
The section does not disappear; it gains a collapsible group at the top.

## 10. The hub page

New: `src/app/(dashboard)/stock-management/page.tsx`.

A card grid of the six children, **each card shown only if the viewer holds that child's
`view` grant** — read from `usePermissions()`, the same store the sidebar uses, so the hub
can never offer a link the sidebar hides. Follow `/more/page.tsx` for the existing card-grid
pattern rather than inventing one.

It carries no data of its own and needs no API route.

## 11. After seeding: the grants nobody holds yet

`npm run db:seed:rbac` creates `stock_management.view` and the three `product_types.*`
permissions and grants them **to ADMIN only** (`seed-rbac.ts:2,6` — the seed re-grants the
full set to ADMIN and leaves every other role untouched, by design).

So immediately after the seed, a non-admin role sees:

- the six children it already had, now nested under a **Stock Management heading with no
  link** — `app-sidebar.tsx:100-110` builds a placeholder parent from a child's carried
  parent data, so the heading appears and the hub page is simply not clickable
- no Product Types entry

**This is a manual step, not a bug.** Someone must open `/team/permissions` and grant
`stock_management.view` and the `product_types` actions to whichever roles should have them.
Say so in the commit message and in the "what to test" handover — it has been missed before.

---

---

# PART D — the customer list

Added 1 Sep 2026 on the owner's instruction: *"I need the customer listing in list format
which shows the customer-related details from the customer table."*

Unrelated to A, B and C. It rides on this branch because it is small and shares the
`db:seed:rbac` cycle, and it is a **separate fourth commit** so it can be reverted alone.

## 11.1 There is no customer list today — but the API is already built

The gap is only a screen. Verified:

| | |
|---|---|
| `GET /api/customers` | **exists and is complete** — paginated, searchable on name and phone, guarded `customers.view`, and it already selects `id, name, phone, email, type, isActive, createdAt` plus `_count` of invoices and payments (`route.ts:24-35`) |
| `POST /api/customers` | exists, guarded `customers.create`, refuses a duplicate `phone` (`:54`) |
| `GET`/`PATCH /api/customers/[id]` | exist, guarded `customers.view` / `customers.edit` |
| A page listing customers | **does not exist.** The only customer UI in the app is `deliveries/[id]/_components/customer-info-card.tsx` and a `/api/customers` call from `/receivables:206` |

So the `customers` module is labelled **"Customers & Receivables"** but its route is
`/receivables` and there is no customer master screen behind it. Part D makes the label true.

## 11.2 What the list shows

Every column comes from `Customer` (`schema.prisma:1031-1051`) or is aggregated from its
relations. **`phone` is the identity** — it is `@unique` and, per CLAUDE.md, it is the single
row both the counter and the workshop resolve to. It is not an optional column.

| Column | Source | Note |
|---|---|---|
| Name | `Customer.name` | primary line; `@@index([name])` already exists and the API orders by it |
| Phone | `Customer.phone` | `@unique` — the identity. Tap-to-call on mobile |
| WhatsApp | `Customer.whatsapp` | **add to the API select** — currently not returned. Merged in from the service app |
| Email | `Customer.email` | already returned |
| Address | `Customer.address` | **add to the API select**; truncated in the list, full on the row's detail |
| Type | `Customer.type` | `WALK_IN` / `REGULAR` / `DEALER` (`schema.prisma:176-180`) — a badge, and a filter |
| Active | `Customer.isActive` | badge; inactive rows dimmed, not hidden |
| Invoices | `_count.invoices` | already returned |
| Payments | `_count.payments` | already returned |
| **Outstanding** | `SUM(CustomerInvoice.amount - paidAmount)` | **new** — see §11.3. The single most useful number on the screen and the reason to build it as a list rather than cards |
| Since | `Customer.createdAt` | already returned |

**Deliberately not shown:** `id`. And service-job counts are left out of v1 — `Customer.serviceJobs`
is a fourth relation to aggregate and the workshop has its own screens.

## 11.3 Outstanding balance — one query, not one per row

The obvious implementation is a per-customer sum inside the map. **Do not write that.** This
codebase has already paid for exactly that mistake: `zoho-pull-timeout-plan.md` exists because
the import ran two queries per record across Mumbai→Singapore and died at `maxDuration`.

The list is paginated, so:

```ts
const ids = customers.map((c) => c.id);
const owed = await prisma.customerInvoice.groupBy({
  by: ["customerId"],
  where: { customerId: { in: ids }, status: { not: "PAID" } },
  _sum: { amount: true, paidAmount: true },
});
```

One extra query per page, regardless of page size, merged in memory. `CustomerInvoice`
already carries `@@index([customerId])` and `@@index([status])` (`schema.prisma:1069-1070`),
so no schema change — Part D stays inside decision #5.

## 11.4 Files

| File | Change |
|---|---|
| `src/app/api/customers/route.ts` | add `whatsapp` and `address` to the `select` (`:27-32`); add the §11.3 `groupBy` and merge `outstanding` into each row; add an optional `?type=` filter alongside the existing `search`. Guard unchanged. |
| `src/app/(dashboard)/customers/page.tsx` | **new.** The list. `apiFetch` from `src/lib/api-client.ts` — never `fetch().then(r => r.json())`. Search box (name/phone, debounced, server-side via the existing `search` param), type filter, pagination. Follows the desktop-table / mobile-card split the other list screens use. |
| `prisma/rbac-catalog.ts` | one new sub-module, §11.5 |

Logging: `createLogger("customers")` in the route, `log.error` in the catch. No new logger on
the page — it is a read screen.

## 11.5 Module placement — a sub-module, and no new permissions

```ts
{
  key: "customer_list",
  label: "Customers",
  description: "The customer master — names, phones, type and outstanding balance",
  icon: "Users",
  route: "/customers",
  parentKey: "customers",     // "Customers & Receivables", route /receivables
  group: "Accounts",          // MUST equal the parent's — the seeder asserts it
  sortOrder: 321,             // parent is 320; brand_ledger is 340
  actions: ["view"],
},
```

Three things this deliberately does **not** do:

1. **It does not re-point the `customers` module.** `/receivables` stays its route — people
   have it bookmarked and nothing is gained by moving it.
2. **It declares `view` only.** Create and edit on the screen check the **parent's**
   `customers.create` / `customers.edit`, which is what `POST /api/customers` and
   `PATCH /api/customers/[id]` already guard on. Adding `customer_list.create` would create a
   second grant for the same action and make it ambiguous which one denies.
3. **It changes no schema.** `Module.parentId` already exists; this is seed input.

Same caveat as §11: after `db:seed:rbac`, `customer_list.view` is held by ADMIN only. Grant
it at `/team/permissions` to whoever should see the list.

## 12. Order of work

**Build cadence — owner’s instruction, 1 Sep 2026:** *“don’t keep having the build for every
phase, do it only when needed.”* So `npm run build` runs **twice**, not five times.

This departs from AGENTS.md, which says to build after every change. Recorded rather than
done quietly, along with where the two builds land and why those two:

- **After commit 2**, because it is the only commit the compiler can help with. Dropping
  `Product.type` breaks ~20 API files loudly, and skipping the build there means carrying
  type errors into commits 3 and 4 where they are harder to attribute.
- **Once at the end**, before the PR.

Commits 1, 3 and 4 are deletions and additive catalog entries — a build after each would
mostly re-prove the previous one. **§15.3 still applies to commit 2 and is not optional:** the
build passing is not evidence the screens work, and the seven pages it names must be opened
in a browser regardless of how many builds ran.

```
git checkout main && git checkout -b refactor/stock-management-module

── commit 1 ── Part A
   delete 10 files, edit ~11, drop stock.fetch from the catalog
   rename api/ai/dashboard-insights -> api/dashboard/stats, repoint its 3 callers (§2.2.3)
   (no build)

── commit 2 ── Part B      (the wipe runs BEFORE db:push — see §12.1)
   stop the dev server first  (prisma generate fails EPERM while it holds the engine)
   run the §4.2 row count, show the owner, then proceed
   write prisma/wipe-products.ts   (delete-only; NO ProductType reference — §7.0)
   npm run db:wipe:products                       <- empties Product + its 10 children
   schema: ProductType model, Product.productTypeId, drop Product.type, drop the enum,
           repoint @@index([type]) and @@index([status, type])  — §15.4
   npm run db:generate && npm run db:push         <- alters an empty table, no data-loss prompt
   seed the 3 default product types (§7.1)
   new API + screen + ~20 call sites (§5.2 AND §15.2)
   npm run build          <- THE ONE THAT MATTERS. Necessary but NOT sufficient — §15.3
   then open the 7 screens §15.3 names, in a browser

── commit 3 ── Part C
   rbac-catalog.ts, the hub page
   npm run db:seed:rbac
   (no build)

── commit 4 ── Part D
   extend /api/customers, new /customers page, customer_list sub-module
   npm run db:seed:rbac
   npm run build          <- the final one, before the PR

── LATER, OPTIONAL ── Part E      (decision #7 — not on the critical path)
   whenever the owner’s .xlsx/.csv is ready:
   write scripts/import-products.ts, confirm the column mapping against the real file
   npm run import:products <file>
   The branch ships without this. The catalog is simply empty until it runs.
```

Every `npm` and `git` command above is proposed for approval, one at a time, per AGENTS.md.
None is run unprompted.

**Build prerequisite:** `npm run build` needs a reachable database — `/staff-lms/playbooks`,
`/staff-lms/product-learning` and `/staff-lms/products` are prerendered server components.
Start Postgres first.

### 12.1 Why the wipe runs before `db:push`, not after

`Product.productTypeId` is **required**. Adding a required column with no default to a table
that already holds rows is not something `db:push` can do — it refuses, or demands
`--accept-data-loss`. Dropping `Product.type` in the same push is a second such prompt.

Since decision #2 wipes the products anyway, running the wipe first turns both prompts into
nothing: `db:push` alters an empty table. The alternative — pushing with rows present and
answering yes to `--accept-data-loss` — reaches the same end state by a route where one
mistyped flag destroys something that was never meant to go.

This is why the wipe is its own file, `prisma/wipe-products.ts` — §7.0 and §15.1 explain why
it cannot be a mode of the seed.

## 13. What to test when it is done

| Area | Check |
|---|---|
| `/stock` | no Fetch-from-Zoho button, no fix-up banner; tabs come from the Product Types table; the size filter still works; bulk brand/category/bin assign still works. **Every product reads 0 stock** — that is §7.2 working, not a bug |
| A stock audit | `/stock-audit/new` → count → reconcile actually writes levels, since this is now the only way quantities exist |
| `/` and `/desktop` | **Stock Value and Low Stock still show numbers** — §2.2.2. If either reads zero or blank, the `api/dashboard/stats` rename dropped a caller |
| `/ai` | 404s. No sidebar entry ever pointed at it |
| `/settings/integrations` | **no pull card at all** — no Auto-Sync heading, no Pull Now, no Review Pulls, no full-import checkbox. The three connect/disconnect cards, the sync history and Cleanup all still work. `/settings/integrations/pull-review` 404s |
| `/deliveries` | **Bulk Fetch still works end to end** — this is the regression the items-only scope exists to avoid |
| `/inbound`, `/bills`, `/receivables` | their Zoho fetches still work — **these three plus `/deliveries` are the reason the `pull-review` API survives the page's deletion (§2.1.2); test all four or the removal is unproven** |
| `/product-types` | create, rename, reorder, deactivate; a duplicate name is refused |
| `/stock-audit/new` | type tabs render from the table |
| `/reports` stock value | grouped by type shows the new names |
| Sidebar, desktop | Stock Management collapses/expands, holds six children, the parent links to the hub |
| Bottom nav, phone | **Stock Management appears as a tab** — the whole reason the parent has a route |
| `/team/permissions` | the new module and its actions are grantable |
| A non-admin role | still reaches all six children after the re-parent, with no re-granting |
| `/customers` | lists name, phone, WhatsApp, email, address, type, active, invoice/payment counts, **outstanding** and since-date; search by name and phone; filter by type; pagination |
| `/customers` performance | **watch the query count on page 2+** — outstanding must stay one `groupBy` per page (§11.3), not one sum per row |
| `/receivables` | unchanged — it keeps its route and still calls `/api/customers` (`:206`) after the select is widened |

---

## 14. Consequences accepted

1. **⚠️ After Part A there is NO way to create a product from inside the application.**
   An earlier draft of this line said "by seed script or by hand on `/stock`". **The second
   half was wrong** — verified 1 Sep 2026: `POST /api/products` exists and is guarded, but
   **no screen anywhere calls it.** `/stock` has no create form, there is no `/stock/new`, and
   the only `productSchema` consumers are `/purchase-orders/new` and two Staff LMS screens,
   none of which creates a stock product.

   So today the Zoho import is the *only* way a `Product` row is born. Delete it and the
   seed script becomes the sole path: a new SKU means editing a data file and running
   `ts-node` against the database. Nobody can add one from a phone on the shop floor.

   **Owner's decision, 1 Sep 2026, with that fact in front of them: accept it for now.**
   Every new SKU goes through the data file and a re-run of the seed. A product create form
   (`/stock/new`, guarded `stock.create`, against the `POST` and `PATCH` routes that already
   exist) is **a follow-up plan, not part of this branch.**

   Recorded plainly because it is the kind of gap that gets rediscovered as a bug six weeks
   later: between this branch shipping and that form existing, **adding one product requires
   a developer, a data file and a terminal.** Nobody can do it from the shop floor.
2. **The wipe destroys stock history for every existing SKU** — §4.2. Gated on the row count.
3. **The system holds zero stock the moment this ships** — §7.2. The seed loads a catalog,
   not quantities. Real numbers come from a stock audit, and until that count is done every
   stock-driven screen reads zero. Do not run the wipe on a trading day.
4. **`stock.fetch` grants disappear** on the next `db:seed:rbac` (stale-permission sweep). No
   guard reads it, so nothing loses access.
5. **One schema change, taken deliberately** — §5.0. Dynamic product-type creation is
   unreachable any other way; the enum is a PostgreSQL type, not data. The six existing type
   names are carried into the new table by the seed, so no vocabulary is lost — but the
   `Product.type` drop is the point of no return in §12, and it happens *after* the §4.2 row
   count, not before.
6. **There is no longer one place to pull everything from.** Bills and invoices are pulled
   from the screens that own them. That is more consistent than today — four screens already
   worked this way and the central card was the odd one out — but an admin who used **Pull
   Now** as a single "sync everything" button no longer has one, and nothing replaces it.
   Two of the four Zoho entities now have no dedicated pull at all: items by design
   (consequence 1), contacts because bills already create the row (§2.1.3).
7. **A vendor created from a bill import has no GSTIN, email or phone** — §2.1.3. The row is
   still created, and every field is still editable on `/vendors`, but nothing fills them
   automatically any more and nothing prompts anyone to. GSTIN drives that vendor's GST
   treatment, so this is the one consequence in this list with a compliance edge. A "vendors
   missing GSTIN" list would close it; not in scope.
8. **A false claim leaves the UI.** "Auto-Sync: Daily at 1 PM IST" has been untrue since
   `cron-removal-plan.md` shipped on 28 Aug 2026 (§2.1.1). Worth stating plainly: this is a
   bug fix riding along with a deletion, not merely a deletion.
9. **`Product.zohoItemId` becomes a column nothing writes.** It stays — it is `@unique` and
   holds real values for existing rows; dropping it is data loss for no gain.
10. **`Category` stops being a Zoho mirror.** Five of its seven write sites were Zoho paths
   (`imported-product-data-quality-plan.md` §6). After Part A only `POST /api/categories`
   and the seed write it, which means the "never give a human an edit screen for a mirror"
   argument against a Category CRUD screen **no longer applies**. Not in scope here; worth a
   follow-up plan.

---

# REVIEW — findings from reading this plan back against the code, 1 Sep 2026

Three blockers and four gaps, found by checking the plan's own claims rather than re-reading
its prose. Each is fixed in place above; this section exists so the reasoning is not lost.

## 15.1 RESOLVED — the ordering blocker, and how decision #7 removed it

**The finding.** §12.1 originally said: run `seed-products.ts --wipe-only`, then move the
schema. That cannot work. `prisma/tsconfig.json` sets no `transpileOnly`, so `ts-node`
typechecks the whole file before executing a line — and a combined seed references
`prisma.productType`, which does not exist on the generated client until after `db:generate`.
The wipe would never run, and the `db:push` behind it would then hit a populated table and
demand `--accept-data-loss`: precisely what the ordering existed to prevent.

**The fix, and it is better than a workaround.** Decision #7 split the one seed into two
files with different lifetimes (§7):

- `prisma/wipe-products.ts` — delete-only, no `ProductType` reference, compiles against the
  **old** client, runs inside commit 2 before the schema moves.
- `scripts/import-products.ts` — **Part E**, optional and last, written against the **new**
  client once the schema has settled. No ordering constraint at all.

The blocker is gone rather than sequenced around. Recorded because the failure mode — a
typecheck error on a script whose *executed* path was perfectly valid — is not obvious, and
the next person to merge these two files back into one will hit it again.

## 15.2 BLOCKER — §5.2 undercounts the `Product.type` call sites by roughly half

§5.2 lists ten. A scan for `type: true` inside a **Product** select finds these as well, none
of which the plan mentions:

| File | Line |
|---|---|
| `api/products/route.ts` | `:99` (the *select*, separate from the `:28`/`:85` filter already listed) |
| `api/products/search/route.ts` | `:34` |
| `api/products/stale/route.ts` | `:33` |
| `api/reorder/route.ts` | `:34` |
| `api/reports/movement/route.ts` | `:42` |
| `api/serials/search/route.ts` | `:27` (nested), `:46` |
| `api/serials/[id]/route.ts` | `:19` (nested) |
| `api/stock-counts/[id]/items/route.ts` | `:67` |

Each becomes `productType: { select: { name: true } }`, and **each changes the JSON shape its
callers read** — `p.type` becomes `p.productType.name`. Budget commit 2 at roughly twice
§5.2's size.

Be careful separating these from same-named fields on other models: `InventoryTransaction.type`
(`api/activity:47`, `api/inventory/cleanup:24`, `api/reports/movement:20`,
`api/serials/[id]:24`), `LedgerEntry.type` (`api/ledger/vendors/[id]:47`) and
`Customer.type` (`api/customers:28`) are all unrelated and must not be touched.

## 15.3 BLOCKER — `npm run build` will pass while the screens are broken

This is the most dangerous finding, because the plan's verification step is the thing that
fails to catch it.

**17 frontend files under `(dashboard)` declare their own `interface { type: string }`**
structurally, rather than importing a Prisma type. `stock/page.tsx:42`,
`stock/[id]/page.tsx:27,39`, `stock/by-brand/page.tsx:26`, `stock-audit/brand-count:19,24`,
`stock-audit/[id]:33`, `stock-audit/[id]/review:26`, `reorder/page.tsx:20` and more.

Because those interfaces are local structural types over a `fetch` result, **the compiler has
nothing to compare them against.** Drop `Product.type` from the API responses and:

- `npm run build` passes green
- `product.type` is `undefined` at runtime
- and at `stock-audit/brand-count/page.tsx:585`, `p.type.replace("_", " ")` **throws** —
  `Cannot read properties of undefined (reading 'replace')`. A blank tab bar elsewhere; a
  crash here.

AGENTS.md says the build must pass before anything is called done. **For commit 2 that is not
sufficient**, and the plan must say so. Verification for Part B is: grep every one of the 17
files for `\.type`, change each to `productType.name` alongside its API route, and then open
`/stock`, `/stock/[id]`, `/stock/by-brand`, `/stock-audit/brand-count`, `/stock-audit/[id]`,
`/stock-audit/[id]/review` and `/reorder` in a browser. Six of those seven are screens no
green build will exercise.

## 15.4 GAP — two indexes still name the dropped column

`schema.prisma:506-507`:

```prisma
@@index([type])
@@index([status, type])
```

`db:push` fails on an index over a column that no longer exists. They become
`@@index([productTypeId])` and `@@index([status, productTypeId])`. §5's schema block is
updated; without this, commit 2 stops at the push.

## 15.5 GAP — `/stock`'s default tab has no answer

`stock/page.tsx:156` initialises `typeFilter` to the literal `"BICYCLE"`. With types as data
there is no guaranteed `BICYCLE` row — the owner can rename or deactivate it.

**Decision needed, and the plan takes the safe one:** default to `ALL`. The alternative
(first active type by `sortOrder`) hides most of the catalog behind a tab choice the user did
not make, and reproduces the bug the comment at `:892` already describes — a default of
BICYCLE makes "which products need reordering?" silently mean "which *bicycles*".

## 15.6 GAP — the desktop sidebar is flat, and `/desktop/*` is missing most routes

Two things §8 overstated by saying navigation is data-driven everywhere.

1. **`src/components/desktop/sidebar.tsx` has no parent/child awareness.** It iterates
   `modules`, groups by `m.group`, and ignores `m.parent` entirely (`:30-37`). After Part C the
   desktop rail shows Stock Management **and** its six children as seven flat siblings under
   Operations. Not broken — but the collapsible nesting is mobile-only, and anyone testing on
   desktop will report the tree "did not work".
2. **`src/app/desktop/` contains only** `accounts, activity, barcode, deliveries, inbound,
   more, reports, stock, team, vendors` — with no catch-all route. `desktopHref` maps every
   module to `/desktop/<route>` regardless, so `/desktop/transfers`, `/desktop/stock-audit`
   and `/desktop/second-hand` **already 404 today.** This is pre-existing, not caused here.

   But this plan adds three more: `/desktop/stock-management`, `/desktop/product-types` and
   `/desktop/customers`. **Owner decides** — accept (consistent with the five that already
   404) or open a separate plan to make `/desktop` complete. Out of scope either way;
   recorded so it is not discovered as a regression from this branch.

## 15.7 GAP — every line number in Part A is a snapshot of a dirty tree

This plan was read off the working tree while `fix/import-data-quality` had uncommitted
changes in `stock/page.tsx`, `api/products/route.ts`, `api/stock-counts/[id]/route.ts`,
`more/categories/page.tsx` and others.

If that branch is abandoned and this one is cut from `main` (as §4.1 requires), **those line
numbers shift.** Locate by symbol name — `fetchStep`, `buildItemPreviews`, `PLACEHOLDER_BRAND`
— not by line, and re-read the file before editing.



---

# 16. PART A AS BUILT — 1 Sep 2026

Part A shipped. This section records where it **differed from the plan above**, because three
of the differences came from reading the running code and one from calling Zoho's live API,
and the plan's own text is wrong without them.

## 16.1 The correction that matters most: bill import still creates products

**Consequence 1 said "products can no longer be created from Zoho, at all."** That was wrong,
and it was caught mid-implementation rather than after.

`pull-review/approve` has a **bill** branch — kept by decision #1 — that calls
`prisma.product.create` when a bill line names a SKU the catalog does not hold. It is gated on
`source !== "accounting"`, and the two callers split exactly:

| Caller | `source` | Creates products? |
|---|---|---|
| `/bills` | `accounting` | no — financial only |
| `/inbound` | `inventory` | **yes** |

**Owner's decision, with that in front of them:** keep it. *"Remove the product creation by
Zoho item or stock fetch; when a bill is imported, if the product doesn't exist let it create
the product — keep that logic."* An inbound shipment must be able to receive something the
catalog has not met yet.

So the true statement is: **the Zoho ITEM pull is gone; `/inbound`'s bill import remains a
product-creation path.** Products it creates carry the vendor's name as brand and Zoho's
category or the `Uncategorized` placeholder.

Three things survive that the plan had marked for deletion, purely because this branch needs
them:

- `src/lib/import-placeholders.ts` — the bill branch reads `PLACEHOLDER_CATEGORY`
- `BooksClient.getItem` and its `items.get` registry entry — `approve:208` calls it for one
  product at a time, to get category/HSN/tax when creating from a bill line
- the `/stock` "Needs details" queue and placeholder styling — still fed by this path

## 16.2 The "Needs details" filter changed shape rather than going

Decided after measuring the consequence: with the catalog import putting **every** product in
`Uncategorized`, testing the category name would return all 8,175 rows, and a filter that
matches everything distinguishes nothing.

- **Brand only.** `api/products/route.ts` now tests brand against
  `PLACEHOLDER_BRAND_NAMES_LOWER` and no longer tests category. The comment there says why,
  and says not to add it back.
- **Three names, one definition.** `isPlaceholderBrand` recognises `Imported` (the old item
  import), `Unbranded` (`scripts/import-products.ts`) and `General` (hand-created rows). The
  list used to be inline in `api/stock-counts/[id]`; it now lives in one place so the display
  test, the filter and the stock-count overwrite rule cannot drift apart.
- **Category is no longer styled as a placeholder** on the /stock card — grey italic on every
  row is not a signal.

## 16.3 The AI removal, and the route that was not AI

Decision #8 widened to the whole `/ai` surface. Deleted: `low-stock-alerts`,
`demand-forecast`, `reorder-suggestions`, `(dashboard)/ai/page.tsx`, the **Smart Insights**
card and the **AI Insights** tile.

**`dashboard-insights` was renamed, not deleted** — §2.2.2. It contains no AI at all (144
lines of raw SQL) and is the source of the **Stock Value** and **Low Stock** tiles on two
dashboards. It is now `src/app/api/dashboard/stats/route.ts` with its three callers repointed.
`src/app/api/ai/` no longer exists.

Removing the tile left the Operations grid with three cards in a `lg:grid-cols-4`, a hole at
both breakpoints; it is `grid-cols-3` now, matching the file's other three-tile grids.

## 16.4 ⚠️ §7.4 is WRONG about Zoho — corrected against the live API

The plan says Zoho has no categories or brands API and that they are free-text strings on an
item. **Both claims are false.** Probed against the live org on 1 Sep 2026 with a throwaway
script (since deleted), using the credentials in `integration_config`:

| Endpoint | Zoho Inventory | Zakya POS | Zoho Books |
|---|---|---|---|
| `/categories` | **200 — 33 rows** | **200 — 33** | 401 not authorized |
| `/brands` | **200 — 151 rows** | **200 — 151** | 401 not authorized |
| `/manufacturers` | 200 — 83 | 200 — 83 | 200 — 83 |

`/items?per_page=1` returned 200 on all three as an auth control, so the Books 401 is a
product-level limitation, not a token problem. The published docs simply do not list these.

**Categories are a real tree** — `category_id`, `parent_category_id`, `depth`, `sibling_order`,
`has_active_items` — and it maps 1:1 onto this app's `Category.parentId`/`children`:

```
24 · 26 · 27.5 · 29 · 700C   are PARENTS
  24 SS, 24 MS               are their CHILDREN
Accessories · SPARES · TOYS · E CYCLE · BIKE · GOGGLES · MINI CAR · TRI CYCLE   are roots
```

`MS`/`SS` are not a naming quirk; they are child categories under a wheel-size parent. There
is also a junk row, `qazsws`, someone typed by accident.

**And Inventory's `/items` DOES return `category_id` and `category_name`; Books' does not.**
That is the direct evidence for Part 0 of the superseded data-quality plan: the placeholders
fired on the Books fallback path, which sends no category — not because of a mapping bug.

**Owner's decision after seeing this:** carry on as planned. The catalog import stays
`Unbranded`/`Uncategorized`; a category and brand sync is a **separate follow-up plan**, not
part of this branch. Worth knowing when it is written: the 151 brands contain obvious typo
duplicates (`RALEIGH`/`RALEIGY`/`RALIEGH`, `NINETY ONE`/`NINETYONE`/`NNETYONE`) and entries
that are vendors rather than brands (`SANGAM HARDWARE`, `JAI MATAJI HARDWARE`), so syncing all
151 as-is would import that mess.

## 16.5 Observability regression, caught by lint and fixed

Every `log.*` call in `trigger-pull` lived inside the `items` and `contacts` steps. Deleting
them left the file with a `createLogger` it never used and the surviving bill and invoice
steps completely silent — a CLAUDE.md violation the typecheck could not see.

`log.info` on the bills, invoices and finalize outcomes, and `log.warn` when a step is skipped
for want of a connected source. Identifiers only (`pullId`, counts, `errors.length`), never
payloads.

## 16.6 What was verified, and what was not

- **`npx tsc --noEmit`: clean.** The only errors were stale `.next/types/validator.ts` entries
  for deleted routes, which regenerate.
- **`npx eslint` on the 26 changed files: 0 errors.** Two warnings remain in `stock/page.tsx`
  (`session` unused, one `no-unused-expressions`) and **both pre-date this branch** — verified
  by stashing and re-linting, which showed three such warnings before and two after.
- **`npm run build` was NOT run** — per the owner's instruction that builds happen only when
  needed, and the plan's §12 puts the meaningful one after commit 2.
- **No screen has been opened in a browser.** §15.3 applies to Part B, but the /stock page
  lost its fetch wizard and gained a price line here, and neither has been looked at.

---

# 17. PART B AS BUILT — 1 Sep 2026

Built. Where it differed from the plan, and the two problems found on the way.

## 17.1 The §4.2 gate came back clean

Counted before the wipe: **59 products, and all ten child tables at ZERO** — no stock
movements, no audit lines, no serials, no open purchase-order / transfer / inbound lines. The
wipe therefore cost 59 rows and nothing else, which is the only reason it was safe to run.

`prisma/wipe-products.ts` keeps that check permanently: it counts the seven child tables and
**refuses without `--force`** if any hold rows. Anyone re-running this against a database with
real history gets stopped rather than surprised.

## 17.2 `db push` — a wrong turn worth recording

The first push failed `P1001` on `DIRECT_URL` (`…pooler.supabase.com:5432`). Read as "the
session pooler is unreachable", `DIRECT_URL` was repointed at the **6543 transaction pooler**.
That was wrong, twice over:

- `prisma db push` **hangs** through a transaction pooler. It takes a session-scoped advisory
  lock; the pooler multiplexes sessions, so the lock never resolves. It ran 5+ minutes and
  applied **nothing** — confirmed by querying `information_schema` afterwards.
- `PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK=true` did not help; it hung at the same point.
- `prisma migrate diff` failed outright `P1001` on 6543 — the **schema engine** cannot reach
  the pooler at all, even though the query **client** can, which is why the wipe had worked.

The actual diagnosis: a **TCP test showed BOTH 5432 and 6543 reachable**, and a `select 1`
over 5432 succeeded. The original failure was transient. `.env` restored from backup, push
ran in **7.25 s**.

**The lesson, for the next person:** `DIRECT_URL` must never be a transaction pooler, and a
one-off `P1001` against Supabase is worth retrying before it is worth diagnosing.

## 17.3 The schema change, verified rather than assumed

```
Product.type          dropped        enum ProductType     dropped
Product.productTypeId added          ProductType table    created
@@index([productTypeId])   and   @@index([status, productTypeId])   replace the two on `type`
```

One ordering constraint that a hand-written migration would have to respect and `db push`
handled: **in PostgreSQL a table and a type share one namespace**, and the new table has the
same name as the enum it replaces. The enum must go before the table is created.

Seeded three types — **Cycles (10), Spares (20), Accessories (30)**. `BOX_PIECE`, `WIP` and
`FINISHED_GOOD` were **not** recreated: all three held zero products and always did.

## 17.4 §15.2 was right — and §15.3 nearly bit

The compiler found the call sites §5.2 had missed, as predicted. But two of them were the
*silent* kind:

**(a) `api/stock-counts/route.ts`** filtered products with `where: { type: productType }`.
That **typechecked** — the conditional spread widens the object — while Prisma would have
thrown at runtime against a table with no `type` column. Found by reading, not by tooling.

**(b) Five routes returned `productType` but no `type`.** ESLint caught it only indirectly, as
an unused `withTypeName` import. Any screen reading `p.type` from `/reorder`,
`/api/products/stale`, `/api/serials/[id]` or either stock-count endpoint would have rendered
`undefined` — `stock-audit/brand-count:585` calls `p.type.replace(...)` and would have thrown.

**The mitigation is `src/lib/product-type.ts`.** Every list endpoint returns BOTH:

```
productType: { id, name }   the truth — for filtering, writing, linking
type: string | null         the NAME — so the 17 screens that declare their own
                            `interface { type: string }` keep rendering
```

The alias is a **migration aid, not a fixture**. When the last screen reads
`productType.name`, delete `withTypeName` and the `type` key with it. A visible side effect:
cards that showed `SPARE_PART` now show `Spares`, which is an improvement.

## 17.5 Decisions taken while building

- **`/stock`'s type tabs default to `All`** (§15.5), and are built from the table. The tab
  grid sizes itself to however many active types exist.
- **The size badge on `/stock/[id]` now renders whenever `size` is set**, replacing
  `type === "BICYCLE"`. That was a name comparison that would break the moment a type was
  renamed — the class of bug CLAUDE.md bans for roles.
- **`product_types` is seeded as a ROOT module now**, not held back for Part C. The screen is
  unreachable without it. Part C re-parents it under `stock_management` by adding `parentKey`;
  the seeder upserts `parentId` every run, so that move needs no migration.
- **No delete action, anywhere.** Not on the module, not in the API, not on the screen.
  `Product.productTypeId` is required with a RESTRICT foreign key, so a type in use cannot be
  removed — and one that is not still breaks saved reports. `isActive: false` is the answer,
  and the screen says so at the bottom rather than leaving people hunting for a delete button.
- **Bill-created products get the first active type by `sortOrder`.** A bill line carries a
  name, a rate and maybe an HSN code — nothing that says what kind of thing it is. Guessing
  from the name is the classifier that was removed for being wrong 89 times in 132. If no
  active type exists the import refuses that bill and says why, rather than inventing one.

## 17.6 Verified

- **`npx tsc --noEmit`: clean.**
- **`npm run build`: PASSED** (exit 0). `/product-types`, `/api/product-types` and
  `/api/dashboard/stats` are all in the output; `api/ai/` is not.
- **`npx eslint` on the changed files: 0 errors.** Four warnings remain, all confirmed
  pre-existing in `HEAD` (`session` unused ×2, one `no-unused-expressions`, `estimatedItems`).
- **`npm run db:seed:rbac`: 47 modules, 177 permissions.** Two numbers worth reading —
  **`1 stale permission removed`** is `stock.fetch` from Part A, and ADMIN's **`3 new`** are
  `product_types.view/create/edit`.

## 17.7 NOT verified — the part that matters

**No screen has been opened in a browser.** §15.3 says plainly that the build passing is not
evidence these work, and Part B is exactly the change that section was written about.

Still to check by hand: `/product-types` (create, rename, retire, restore, duplicate-name
refusal), `/stock` (tabs from the table, default All, price line, name clamp), `/stock/[id]`
(type picker, size badge), `/stock-audit/new` (type filter), `/stock-audit/brand-count`
(the `p.type.replace` line), `/reorder`, and `/` plus `/desktop` for the Stock Value and Low
Stock tiles after the `api/dashboard/stats` rename.

---

# 18. PART C AS BUILT — 1 Sep 2026

Built, and it went as the plan described — one file plus one page, no schema change, no
component edited. The seeder's own output is the verification.

## 18.1 The tree, read back from the database

```
stock_management   100  /stock-management   Operations   parentId: null   <- a ROOT
  stock            101  /stock              Operations
  product_types    102  /product-types      Operations
  stock_audit      103  /stock-audit        Operations
  inbound          104  /inbound            Operations
  deliveries       105  /deliveries         Operations
  transfers        106  /transfers          Operations
```

In the owner's stated order — stocks, product types, stock audit, inbound, dispatch,
transfers — rather than the old numeric one.

## 18.2 The claim that mattered, and how it was checked

The plan asserted that keeping every child's **key** means every existing grant survives,
because permissions key on the module key rather than on position in the tree. Two independent
confirmations:

- `db:seed:rbac` reported **no stale permissions removed**. A lost grant would have shown up
  there, as `stock.fetch` did in Part A.
- Queried directly: **29 role grants across the six children**, and every non-admin role's
  grant count unchanged (`SERVICE_MANAGER: 27`, `STAFF_LMS_ADMIN: 25`, and the rest).

Module counts moved exactly as predicted: **39 root / 8 child → 34 root / 14 child**. Six
modules became children, one new root appeared.

## 18.3 One thing the plan did not mention: the icon

`stock_management` uses `Boxes`, and **`Boxes` was not in `src/lib/module-icons.ts`**.
`moduleIcon()` falls back to `Package` for an unknown name — silently, by design, so the
sidebar never crashes on a typo. The parent would have rendered with the *same* icon as its
own `stock` child, which looks like a bug and is invisible in code review.

Added to the map. Worth remembering: **adding a module with a new icon is two files, not one.**

## 18.4 The hub page

`src/app/(dashboard)/stock-management/page.tsx` lists the six children **from the granted
module list**, not from a literal array — the same store the sidebar reads. A person without
`transfers.view` sees no Transfers card, and the page cannot drift when a module is added or
renamed. Cosmetic, as CLAUDE.md requires: each destination re-checks server-side.

It handles the case where somebody holds `stock_management.view` and none of the children,
saying so rather than rendering an empty page that looks broken.

## 18.5 Verified, and not

- `npx tsc --noEmit` clean; `npx eslint` on the changed files reported **nothing at all**.
- Tree and grants verified by querying the database, above.
- **`npm run build` NOT run** — the cadence in §12 puts the second and final build after
  commit 4.
- **Nothing opened in a browser.** Specifically unchecked: that the desktop rail still renders
  (§15.6 — it ignores `m.parent`, so the six will appear as flat siblings there, which is
  expected), and that **Stock Management now shows in the phone's bottom bar**, which is the
  entire reason the parent was given a route.

---

# 19. PART E AS BUILT — the catalog is loaded, 1 Sep 2026

Run, out of sequence. The plan put Part E last and optional; it went before Part D because the
catalog was empty and every stock screen read zero, which made Part B and C impossible to
look at.

## 19.1 What went in

```
8,216 rows in the export
8,175 unique by Item ID        (41 duplicates dropped — 37 byte-identical pairs)
5,738 ACTIVE     -> imported
2,437 inactive   -> skipped, decision #9
```

**5,738 created, 0 skipped as already present, 0 duplicate SKUs in the database afterwards.**
Verified by querying, not by trusting the script's own summary.

Every row landed as `Spares` / `Unbranded` / `Uncategorized`, which is the designed state:
no classifier (decision #8's sibling — *"don't use any auto type regex"*), one default brand
and one default category. Prices, GST rate and HSN came through intact — a spot check shows
`HERO TANGO 20T RS C/BRK GRN`, ₹6,500, GST 5 %, HSN 871200.

`StockLevel` is **0 rows** and `currentStock` is 0 on every product, deliberately — §7.3.

## 19.2 What to expect on the screens

- `/stock` shows 5,738 products, all with **0 stock**. The **Cycles** and **Accessories**
  tabs are **empty**; everything is under **Spares**. That is §17.5, not a bug.
- **Needs details** matches all 5,738, because `Unbranded` is a placeholder brand (§16.2).
  As brands are assigned the count falls — that is the queue working.
- The catalog carries **114 real brand names in the source file that were deliberately not
  imported**. `zohoItemId` is stored on every row, so a later backfill can re-read the same
  file and match on it. Re-running the import will NOT do it: `createMany({ skipDuplicates })`
  skips rows that exist rather than updating them.

## 19.3 Two oddities in the source data, imported as-is

Real SKUs in the file include `..` and `0`. They are what Zoho holds, they are unique, and the
import does not invent or normalise — a SKU is the shop's identifier and silently rewriting one
would be worse than an ugly value. Worth knowing before someone reports them as corruption.

## 19.4 The npm permission gate was removed at the same time

Unrelated to the plan but recorded because it changes how every later step runs:
`npm` and `npx` no longer prompt. It needed **two** changes, not one — the `permissions.ask`
entries in `.claude/settings.json` AND the `GATED` regex in `.claude/hooks/ask-git-npm.js`,
which returned `"ask"` on its own and would have kept prompting. `git` is still gated, and a
commit or push to `main` is still **denied**. See AGENTS.md.

---

# 20. PART D AS BUILT — 1 Sep 2026

The last part. One route extended, one page, one catalog entry, no schema change.

## 20.1 What the API gained

`GET /api/customers` was already paginated, searchable and guarded — only three things were
missing:

- **`whatsapp` and `address`** were on the model but not in the `select`. Both belong next to
  a phone number.
- **`?type=`** filter (WALK_IN / REGULAR / DEALER).
- **`outstanding`** per customer — `SUM(amount - paidAmount)` over invoices not yet `PAID`.

**The outstanding sum is ONE `groupBy` for the page, never one query per row.** The obvious
implementation is an aggregate inside a `map`, and this codebase has already paid for that:
the Zoho import ran two queries per record across Mumbai→Singapore and died at `maxDuration`.
`CustomerInvoice` already carries `@@index([customerId])` and `@@index([status])`, so no
schema change was needed.

## 20.2 The screen

`/customers` — a list, not cards, because the useful thing is comparing one number across
many rows. Server-side search on name and phone (filtering one loaded page in the browser
would silently miss everyone else), type chips, and pagination at 50.

`phone` is rendered as a `tel:` link. It is `@unique` on the model and, per CLAUDE.md, the
row both the counter and the workshop resolve to — it is the customer's identity, not a
detail. A zero outstanding is shown muted rather than hidden: "nothing owed" is an answer.

## 20.3 A bug found on the way

`src/lib/api-client.ts` documented a function called **`apiFetchPage`** in two comments. **No
such export exists** — it is `apiFetchEnvelope`. Anyone following the comment would have hit
a compile error and had to go read the file. Both comments corrected.

This mattered here: `apiFetch` returns `.data` and **discards `pagination`**, so a naive
`apiFetch` would have left the page count silently at the row count of page one.

## 20.4 Module placement

`customer_list` is a child of `customers`, `view` only. `/receivables` keeps its route —
people have it bookmarked. Create and edit check the **parent's** `customers.create` /
`customers.edit`, which is what `POST /api/customers` and `PATCH /api/customers/[id]` already
guard on; a `customer_list.create` would be a second grant for the same action and then
neither answers "who may add a customer".

Seeded: **49 modules (34 root, 15 child), 179 permissions**, ADMIN +1.

## 20.5 Verified

`tsc` clean. `eslint` on the changed files reported nothing at all. Seed applied.

**Still not opened in a browser** — see §21.
