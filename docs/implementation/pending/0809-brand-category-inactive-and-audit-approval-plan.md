# Brands and categories go inactive, never deleted; the stock audit gets "all uncounted → 0" and a real approval choice

Status: in-progress — written 8 Sep 2026; build started the same day on the §1.1 defaults, order B and C first, A (the migration) last, one commit at the end.
Branch: **`feat/taxonomy-inactive-and-audit-approval`** — base to be confirmed by the owner (Q0). The working tree on `chore/brand-stock-module-and-tooling` carries unrelated uncommitted work (AI provider), so this must not be built there.

Every `file:line` below was read from disk on 8 Sep 2026 by two Explore agents and re-checked by hand at the places that decide the design. Check rather than trust.

---

## 0. Requirement

### 0.1 The owner's words, verbatim (8 Sep 2026)

> in the categories and brands i dont need the aplication to have the delete option insted let us have only active and inactive which muct activate and incativate thats it it must not delete the data here
>
> and in the stock audit what i need is i need a button in the uncounted where a button like check all as 0 where the uncounted can be checkd all teh uncounted
>
> and from there remove the button add brand where we do not want to create the brand from there
>
> and the important things is that see i will make a stock count an i need the system where the person who aproves it he must be able to make action like a before approval where he need to option make the count as the system stock that it current stock or ask to show the difference of the current and audited stock

Related notes from `docs/Questions.md` (same day):

> do we need delete optioon for brand delete we can just remove the delete option and keep as inactive button which will make the brand , product , catagery as inactive
> do u need merge opton of categories product and brand product ( yes we need)
> 7. need to remove the brand adding from teh stock audit

One earlier line in the same file reads *"do we need the delete button of category ( yes we need it told by syed )"*. Today's instruction supersedes it; Q1 asks the owner to confirm.

### 0.2 Restated as requirements

| # | Requirement | Part |
|---|---|---|
| R1 | A brand or category can be made **inactive** and **active** again. Nothing about it, or under it, is deleted. | A |
| R2 | The **Delete** action for brands and categories is gone — from the screens and from the API. | A |
| R3 | Inactivating a brand or category also makes its products (and, for a category, its sub-categories) inactive — the owner's own note. | A |
| R4 | On a stock audit, the **Uncounted** tab gets one button that records **0** for every uncounted line at once. | B |
| R5 | The **"+ Add new brand…"** option inside the audit's per-line brand picker is removed. A stock audit never creates a brand. | B |
| R6 | Before approving, the approver **sees the differences** between current stock and the counted stock, and **chooses**: make the counted quantities the system stock, or keep system stock and only record the differences. | C |
| R7 | (process) Every plan from now on opens with the requirement, then the questions and their answers, then the current state, then the implementation. This file is the first written to that shape and `docs/implementation/README.md` now says so. | — |

---

## 1. Questions and clarifications — answer before build

Each question changes what gets built. A recommended default is given so the owner can answer "defaults" in one word; anything else, say which number and what.

| # | Question | Why it changes the build | Options | Recommended default | **Answer** |
|---|---|---|---|---|---|
| **Q0** | Which branch does this build on, and one branch for all three parts or one per part? | The current tree is dirty with unrelated work; `main` was squash-merged 8 Sep. | (a) one branch, three commits — A, B, C; (b) three branches | (a), off whatever the owner names | |
| **Q1** | Confirm: **no** delete for categories either, despite the earlier "yes we need it — Syed" note? | Decides whether `DELETE /api/categories/[id]` is removed or kept. | yes remove / keep for categories | remove for both | |
| **Q2a** | Deactivating a brand: set **all its products** to `INACTIVE`? | It is the difference between "hidden from pickers" and "the whole line is retired". The owner's note says yes. | (a) yes, cascade; (b) no, brand only | (a) — with a confirm that states the product count | |
| **Q2b** | Deactivating a category: cascade to its **sub-categories and their products** too? | A parent with 3 children and 400 products is a big write. | (a) yes, whole subtree; (b) this category only, refuse if it has active children | (a) | |
| **Q2c** | Re-activating a brand or category: **also** re-activate the products it took down? | Products retired *individually* before the brand went inactive would come back too. | (a) never — restore products from `/stock → Inactive`; (b) an opt-in tick in the dialog: "also restore its N inactive products" | (b), unticked by default | |
| **Q2d** | Refuse to deactivate while its products still hold stock (`currentStock > 0`)? | The inventory consultant's rule: stock that exists must stay visible. Inactive products leave `/stock`, reorder and future audits. | (a) refuse with the unit count; (b) warn in the confirm, allow | (b) — the confirm names the units on hand; a hard refusal would block retiring a brand with one stray unit | |
| **Q3** | What does an **import** do when it matches an inactive brand or category? (Zoho bill approve, Zoho brand/category import, catalog script) | These match by name / `zohoBrandId` and would file a new product under a retired brand. | (a) use it anyway and push a notice ("brand X is inactive"); (b) treat as unknown → `Unbranded` / `Uncategorized` + notice; (c) silently re-activate | (a) — identity is identity; a person re-activates on the master screen | |
| **Q4** | **Merge** stays (owner said yes). After a merge the emptied **source row** is hard-deleted today. Keep that, or deactivate the source instead? | "Must not delete the data" — the data (products, links) is *moved* by merge, so the row that remains is empty. | (a) keep deleting the empty source; (b) keep the row, mark inactive | (a) — an empty row whose name blocks re-use is clutter. **See §2.4 D4 before answering**: merge does not move every relation. | |
| **Q5** | Who may activate / deactivate? | No `activate` action exists in the vocabulary; Vendor and User toggles ride on `edit`. | (a) `brands.edit` / `categories.edit`; (b) a new `deactivate` action in the catalog | (a) | |
| **Q6** | Remove `delete` from the `brands` and `categories` entries in `rbac-catalog.ts` and re-seed? | Leaving it shows a checkbox on `/team/permissions` that does nothing. Re-seed deletes the stale permission rows. | yes / no | yes | |
| **Q7** | **"Record 0 for all uncounted"** — every uncounted line in the audit, or only the ones on screen (current search)? | Whole-audit is one server query; on-screen needs the client to send ids. | (a) whole audit, server-side; (b) only the rows on screen | (a) — the on-screen list is capped at 500 and a search hides rows, so (b) would silently miss lines | |
| **Q8** | Keep the per-line **brand picker** (choose an *existing* brand as a suggestion, applied only when the product's brand is a placeholder), or drop the whole brand-suggestion feature from the audit? | R5 removes only the create option. The picker itself is the reason `suggestedBrand` exists. | (a) keep picker, remove create; (b) remove the picker and `suggestedBrand` handling entirely | (a) | |
| **Q9** | Do you audit **per warehouse** (floor and godown separately) or the **whole store** at once? | **Today a whole-store audit can never be applied to stock** (a 400, decided 4 Sep — §2.3). If you count whole-store, R6's "make the count the system stock" is impossible without a new rule for where the difference lands. | (a) per warehouse — keep the rule, R6 is already possible; (b) whole store — the approver picks the warehouse that receives a surplus, and a shortage is taken from the store's warehouses in picker order (the rule `deductFromStore` already uses for sales) | (b) only if you actually count whole-store; otherwise (a) | |
| **Q10** | The **variance shown to the approver**: against the snapshot taken when the audit was raised, or against **live** stock at approval time? | Stock moves between raising and approving. The ledger row written today records the snapshot as `previousStock`, which is wrong if a sale happened in between. | (a) live, and the ledger records live; snapshot shown beside it when different; (b) snapshot only | (a) | |
| **Q11** | Who may choose **"set system stock"**? Today the API needs `stock_audit.approve`; the screen additionally hides the button unless the person holds `stock.edit`. | Your words: *"the person who approves it must be able to make the action"*. | (a) `stock_audit.approve` alone, API and UI aligned; (b) both `approve` and `stock.edit`, enforced in the API too | (a) | |
| **Q12** | Where does approval happen — one screen? | Today two screens approve: the count screen (both buttons, no preview) and the review table (verify-only, no apply). | (a) the review table is the only approval screen; the count screen links to it; (b) keep both, add the choice to both | (a) | |

### 1.1 Decisions on record

Owner, 8 Sep 2026: *"just implement"* — every question runs on its recommended default. Two build-order instructions given at the same time: **the migration and everything that depends on it (Part A) is built last**, after B and C; and **one commit at the very end**, after all parts, not one per part.

| # | Decision | Date |
|---|---|---|
| Q0 | Branch `feat/taxonomy-inactive-and-audit-approval` off the tip of `chore/brand-stock-module-and-tooling` (the tree this plan was verified against). The owner's unrelated uncommitted work stays uncommitted; the final commit stages only this plan's files. | 8 Sep 2026 |
| Q1 | No delete for categories either. | 8 Sep 2026 |
| Q2 | a: cascade to products; b: whole subtree; c: opt-in tick on activate; d: warn, do not refuse. | 8 Sep 2026 |
| Q3 | Imports use an inactive match and push a notice. | 8 Sep 2026 |
| Q4 | Merge keeps deleting the emptied source, and first moves every relation (D4). | 8 Sep 2026 |
| Q5, Q6 | Toggle on `edit`; `delete` leaves the catalog. | 8 Sep 2026 |
| Q7 | Whole audit, server-side. | 8 Sep 2026 |
| Q8 | Keep the pick-existing brand picker; remove only the create option. | 8 Sep 2026 |
| Q9 | **Built as (b)**: a whole-store audit can be applied when the approver names the warehouse that receives a surplus; a shortage is taken in picker order via `deductFromStore`. Chosen because R6 says the approver *must* be able to set system stock, and per-warehouse-only would leave whole-store audits unable to. Unused code if the owner never counts whole-store; supersedes the 4 Sep §5.1 rule and says so. | 8 Sep 2026 |
| Q10 | Live stock, snapshot shown beside it. | 8 Sep 2026 |
| Q11 | `stock_audit.approve` alone; UI aligned to API. | 8 Sep 2026 |
| Q12 | The review table is the only approval screen. | 8 Sep 2026 |

---

## 2. How it works today — verified against the code

### 2.1 Brands and categories: hard delete, no active flag anywhere

**Schema.** `Category` is `prisma/schema.prisma:431-449`, `Brand` is `:451-485`. Neither has `isActive`, `deletedAt` or `status`. Every other master table already has `isActive Boolean @default(true)`: `Store :264`, `Warehouse :295`, `User :327`, `Bin :630`, `Vendor :758`. `Product` carries `status ProductStatus @default(ACTIVE)` with indexes `@@index([status, categoryId])` and `@@index([status, brandId])`.

**Relations that point at Brand / Category and what a delete does to them** (declared or Prisma default):

| Model.field | Target | On delete |
|---|---|---|
| `Product.brand` / `Product.category` (both required, `:493-496`) | — | Restrict |
| `InboundShipment.brand :1859` | Brand | Restrict |
| `InboundShipment.category :1874` | Category | Restrict (explicit) |
| `BrandStockUpload.brand :2188`, `BrandSkuMapping.brand :2257` | Brand | Restrict |
| `PreBooking.brand :2067`, `BrandLedgerEntry.brand :2582`, `LedgerGap.brand :2670`, `VendorDiscountTerm.brand :2753` | Brand | **SetNull** — the reference is silently lost |
| `BrandVendor.brand :2789` | Brand | Cascade |
| `Category.parent :436` | Category | SetNull — a child is quietly promoted to root |

**API.**

| Route | Guard | What it does |
|---|---|---|
| `DELETE /api/brands/[id]` — `src/app/api/brands/[id]/route.ts:81-135` | `brands.delete` | counts nine relations (`:93-101`); any non-zero → `200 { deleted: false, message }` (`:122-128`); else `prisma.brand.delete` (`:131`) |
| `DELETE /api/categories/[id]` — `src/app/api/categories/[id]/route.ts:132-176` | `categories.delete` | counts products, children, inbound shipments (`:142`); refuses the same way (`:161-166`); else deletes (`:169`) |
| `PATCH /api/brands/[id]` — `:23-79` | `brands.edit` | inline `updateSchema :14-21` — name, contacts, `leadDays`; case-insensitive clash → 409 |
| `PATCH /api/categories/[id]` — `:13-130` | `categories.edit` | `categoryUpdateSchema` (`src/lib/validations.ts:135-138`); cycle check; writes `logActivity` inside a transaction (`:96-107`) |
| `POST /api/brands/[id]/merge` — `merge/route.ts:8-80` | `brands.create` | moves products (`:36-39`) and `BrandVendor` links, then hard-deletes the source (`:51-76`) |
| `POST /api/categories/[id]/merge` — `merge/route.ts:22-80` | `categories.create` | refuses if the source has children (`:51-56`); moves products and inbound shipments (`:67-74`); deletes the source (`:75`) |
| `GET /api/brands` — `route.ts:9-20` | `brands.view` | all rows, `_count.products`. `export const revalidate = 300` at `:1` |
| `GET /api/categories` — `route.ts:16-30` | **`stock.view`** | deliberately, so product-form dropdowns do not empty for non-taxonomy roles (`:12-15`) |

**Screens.** `/more/brands` (`src/app/(dashboard)/more/brands/page.tsx`) and `/categories` (`src/app/(dashboard)/categories/page.tsx`) are the same component twice. Each has:

- a Trash `IconBtn` gated on `canDelete` — brands `:326-330`, categories `:313-317`;
- `remove()` with a native `confirm` and `apiFetch(..., { method: "DELETE" })` — brands `:143-148`, categories `:144-149`;
- an `ActionConfirmation` that renders "Deleted" / "Not deleted" — brands `:368-376`, categories `:374-380`;
- `mayEdit / mayMerge / mayDelete` from `usePermissions()` — brands `:195-197`, categories `:196-198`.

**Consumers that would need to respect an inactive flag.** None filter on one today because none exists. The full list, all reading `GET /api/brands` or `GET /api/categories`:

| Consumer | Where |
|---|---|
| `/stock` filter chips and bulk re-file selects | `stock/page.tsx:243,245` fetch; `:515-533` filters; `:890` and `:914` bulk selects |
| product edit form | `stock/[id]/page.tsx:105` |
| stock audit count screen, per-line brand picker | `stock-audit/[id]/page.tsx:207-211` |
| brand-count wizard | `stock-audit/brand-count/page.tsx:111-125` (already drops brands with zero products, `:116`) |
| inbound shipment category picker | `inbound/[id]/page.tsx:174` |
| brand-stock upload picker | `brand-stock/upload/page.tsx:41`; server check `api/brand-stock/upload/route.ts:23` |
| vendor ↔ brand link picker | `vendors/[id]/_components/vendor-brands.tsx:64` |
| Zoho bill approve (matches by name, falls back to `Unbranded`) | `api/zoho/pull-review/approve/route.ts:50-70, 242, 262, 349, 355`; it already has `results.notices` (`:150`) |
| Zoho brand / category import (matches by `zohoBrandId`, then name) | `api/brands/zoho-import/route.ts:56-131`, `api/categories/zoho-import/route.ts:64-147` |
| catalog script and seed | `scripts/import-products.ts:247,256`; `prisma/seed.ts:91-108` |

**House style for a toggle** — two exist, both riding on `edit`:

- Vendor: pill button, `confirm`, `PUT { isActive }` — `vendors/[id]/page.tsx:174-195`; list defaults to active-only with `?includeInactive=1` — `api/vendors/route.ts:17`; status chips All / Active / Inactive — `vendors/page.tsx:87-88`.
- Team: icon button, no confirm, `apiFetch PUT { isActive }` — `team/page.tsx:126-131, 372-380`; inactive rows `opacity-60` + `<Badge variant="danger">Inactive</Badge>` (`:245, :295`).

**RBAC.** `prisma/rbac-catalog.ts:278-309` (`brands`) and `:334-353` (`categories`), both `actions: [...CRUD, "fetch"]`. `PermAction` (`src/stores/permissions.ts:17`) is `view | create | edit | delete | approve | fetch` — there is no `activate`.

**Placeholders.** `Unbranded`, `Imported`, `General` and `Uncategorized` are import fall-backs (`src/lib/import-placeholders.ts:25-26, 55, 78`). If any of them goes inactive, an import that falls back to it files a product under an inactive row.

### 2.2 Stock audit: the Uncounted tab and the brand picker

**Data.** `StockCount` `prisma/schema.prisma:677-714` — `status String` (not an enum; values in the comment at `:685`), `storeId`, `warehouseId`. `StockCountItem` `:717-735` — `systemQty Int` is the snapshot written at creation (`api/stock-counts/route.ts:172-176, 203-210`), **`countedQty Int?` where `null` means uncounted** (`:724`), `variance Int?`, `suggestedBrand String?`.

**The Uncounted tab** is a filter, not a section: `stock-audit/[id]/page.tsx:111` holds `tab`, sends it as `filter` (`:142`), and the items route resolves `uncounted` to `countedQty: null` (`api/stock-counts/[id]/items/route.ts:81`). Tab counts come from the same response (`:121-127`).

**Per-line writes** go through one endpoint only, `PUT /api/stock-counts/[id]/items` (`items/route.ts:134-190`): `stock_audit.edit` plus assignee-only (`:148-153`), body `{ items: [{ id, countedQty, suggestedBrand?, notes? }] }`, no zod, a loop of `findUnique` + `update` per line (`:170-179`). **It does not check the audit's status** — counts can be saved against a `COMPLETED` or `APPROVED` audit.

**There is no bulk action.** The only way to express "none found" is the per-line `0 ✓` pill (`:698-706` quick mode, `:767-775` card), and Complete refuses while any line is uncounted (`:583-590` client, `[id]/route.ts:224-229` server). A bulk zero used to exist — inside the dead "baseline" branch of Complete (`[id]/route.ts:231-242`, `updateMany` + raw SQL for variance), guarded by `BASELINE_END = 2026-07-31`, which has passed.

**The brand picker** (`stock-audit/[id]/page.tsx:803-842`) is a per-line `<select>` whose last option is `+ Add new brand...` (`:839`). Choosing it opens `prompt()` and fires a raw `fetch("/api/brands", { method: "POST" })` whose response is never read (`:813-819`); a `catch {}` swallows the failure. `POST /api/brands` needs `brands.create`, so a counter without that grant gets a brand name that exists only on their screen. The chosen name is saved as `suggestedBrand`; at approval the server **matches only** (`[id]/route.ts:284-306`) and applies it only when the product's brand is a placeholder.

### 2.3 Stock audit: what approval does

**Status machine** — `api/stock-counts/[id]/route.ts:123-129`: `PENDING → IN_PROGRESS → COMPLETED → APPROVED | REJECTED`, `REJECTED → IN_PROGRESS`. Approve and reject need `stock_audit.approve` **and not the assignee** (`:104-111`).

**Plain approval changes nothing.** Applying the counts needs `applyToStock: true` in the body (`:144-147`, zod at `src/lib/validations.ts:192`), and then only for a **warehouse-scoped** audit: a whole-store audit gets `400 "This audit covers the whole store. Approve as verify-only, or raise one audit per warehouse to correct stock."` (`:170-188`). That rule was decided on 4 Sep 2026 (`0409-unified-purchasing-transfers-cleanup-plan.md` §5.1, line 1471): a whole-store count is one number per product while `StockLevel` is per warehouse, so the system cannot know where the difference belongs.

**The apply loop** (`:255-356`): for each counted line, `setWarehouseQty(tx, productId, warehouseId, countedQty)` (`src/lib/stock-location.ts:253`) and, when `countedQty − systemQty ≠ 0`, one `InventoryTransaction` of type `ADJUSTMENT` with `previousStock: item.systemQty` — the **snapshot**, not live stock (`:329-354`).

**What the approver sees.** On the count screen (`stock-audit/[id]/page.tsx:528-552`): the Progress card (counted, with-variance, net variance), a link to the review table, then `Approve (verify only)`, `Reject`, and — only when `canEdit("stock")` *and* `summary.canCorrectStock` — `Approve & correct stock levels`. **No preview and no confirm; both approve buttons fire on tap.** The review table (`stock-audit/[id]/review/page.tsx`) is the only per-line System → Counted → Variance view (`:259-279`) and it can approve **verify-only only** (`:126-137`, raw `fetch`).

So R6 is **half built**: the choice exists on one screen without a preview, the preview exists on the other screen without the choice, and the API refuses the choice for whole-store audits.

### 2.4 Live defects found while mapping

| # | Defect | Where | Effect |
|---|---|---|---|
| **D1** | `if (!item.countedQty) continue; // TS guard (query already filters > 0)` — the query filters `not: null`, which **includes 0**, and `!0` is true. | `api/stock-counts/[id]/route.ts:270` | **A line counted as 0 is never applied.** "Approve & correct" leaves phantom stock on every empty shelf. With R4 producing hundreds of zero lines, this bug would make the apply mode silently useless for exactly the lines it matters most for. The comment three lines above (`:264`) says the opposite of what the code does. |
| **D2** | The API lets `stock_audit.approve` apply stock; the screen additionally demands `stock.edit` (`stock-audit/[id]/page.tsx:85-89`). | UI stricter than API | The frontend gate is cosmetic (CLAUDE.md rule 5), so `approve` alone is the real rule today. Q11 decides which one is intended. |
| **D3** | `previousStock` on the `ADJUSTMENT` row is the snapshot `systemQty`, not the live quantity at approval. | `[id]/route.ts:345` | A sale between raising and approving makes the ledger row lie about what stock was. `staleCount` (`items/route.ts:105-108`) already knows when this has happened; the apply path ignores it. |
| **D4** | Brand merge moves only products and vendor links (`merge/route.ts:36-39, 51-76`), then deletes the source. | `api/brands/[id]/merge` | **Confirmed by the schema reviewer (§2.5).** A source with `InboundShipment`, `BrandStockUpload` or `BrandSkuMapping` rows makes the delete throw `P2003` and the merge rolls back with an opaque string. A source with `PreBooking`, `BrandLedgerEntry`, `LedgerGap` or `VendorDiscountTerm` rows merges *successfully* and those rows lose their brand (SetNull), unlogged. The DELETE handler counts all seven as blockers (`brands/[id]/route.ts:93-101`); merge, which will outlive it, does not. |
| **D5** | Dead code: two `BASELINE_END = 2026-07-31` branches. | `[id]/route.ts:220-243` and `:256-328`; `stock-audit/[id]/page.tsx:585-588` | ~70 lines in the function this plan edits that can no longer execute. |
| **D6** | `PUT /api/stock-counts/[id]/items` has no status check. | `items/route.ts:134-190` | Counts can be rewritten on an approved audit. |
| **D7** | No logger in `items/route.ts`; raw `fetch().then(r => r.json())` in the review page (`:129`), the count screen's brand list (`:208`), the brand-count wizard (`:111-113`) and the product edit form (`:105`). | — | CLAUDE.md non-negotiables; fixed where this plan touches the file, listed so nobody is surprised by the diff. |

### 2.5 Schema reviewer findings (8 Sep 2026, against the change as described in §3)

- **The DDL is safe.** `ADD COLUMN … boolean NOT NULL DEFAULT true` is metadata-only on Postgres ≥ 11 — no rewrite, a momentary catalog lock. Additive, so the old code survives it.
- **No index.** None of `Store`, `Warehouse`, `Bin`, `Vendor` index `isActive`, and `AiProvider` (`schema.prisma:1178-1181`) records why: the planner sequential-scans a table this small whatever it carries. `Brand` (115 rows) and `Category` (32) are that size. `@@index([isActive])` would be the schema's first, and noise.
- **The cascade is one indexed statement.** `@@index([status, brandId])` / `@@index([status, categoryId])` exist at `schema.prisma:549-550`; ~5,700 rows need no batching. **But `ProductStatus` has a third value, `DISCONTINUED`** (`schema.prisma:170-174`). A blind `updateMany` would rewrite it to `INACTIVE` and nothing would ever restore it — the cascade must filter `status: ACTIVE` on the way down and `status: INACTIVE` on the way back up (A2 does).
- **D4 confirmed — brand merge is less complete than delete was.** Of the nine relations on `Brand`, merge moves two (`products`, `vendors`). `inboundShipments`, `stockUploads`, `skuMappings` are Restrict → `tx.brand.delete` at `merge/route.ts:76` throws `P2003` and the whole merge rolls back with an opaque string. `preBookings`, `ledgerEntries`, `ledgerGaps`, `discountTerms` are SetNull → the merge **succeeds and silently strips the brand off the ledger reconciliation's own rows**. Category merge is complete (moves products and inbound shipments, refuses on children). With delete gone, merge becomes the only way to tidy a brand row, so this gap will be hit more, not less.
- **Placeholders have no schema protection** and cannot have one — matching is by name in `import-placeholders.ts`. `Unbranded` carries 5,738 of 5,739 products; deactivating it would cascade `INACTIVE` onto the whole catalog in one request. The route-level refusal in A2 is therefore mandatory, not a nicety.
- **The seeder revokes silently.** `prisma/seed-rbac.ts:169-172` `deleteMany`s every `Permission` whose key is not in the catalog; `RolePermission.permission` is `onDelete: Cascade` (`schema.prisma:108`), so every role holding `brands.delete` / `categories.delete` loses it on the next `npm run db:seed:rbac` with no log line. The seed ships ADMIN only (commit `95b03bb`), so in practice that is ADMIN — A3 records the holders before the re-seed anyway.
- **`GET /api/brands` `revalidate = 300` is inert** — the same directive was removed from the categories route on exactly that finding (`categories/route.ts:1-4`: *"both handlers call requireFeature, which reads cookies, so the route is dynamic and was never cached"*). A2 removes it from brands and adds the same `force-dynamic` line, so the file stops promising a cache it never had.
- Both list routes have **no `where` at all** today; the column alone hides nothing. A2's default filter is the whole visible effect.

---

## 3. Implementation plan

Three parts, independent of each other, one commit each. A is the only part with a migration.

### Part A — brands and categories: active / inactive

#### A1 — schema and migration

```prisma
model Category {
  …
  isActive Boolean @default(true)
  …
}
model Brand {
  …
  isActive Boolean @default(true)
  …
}
```

`npx prisma migrate dev --name brand_category_is_active` **on localhost only** (`.env` currently points at the Supabase test project — switch it, or pass the URL per command as recorded in memory). Expected SQL: two `ALTER TABLE … ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true` and nothing else. Additive; the old code survives it (rule 7). **No index** — the reviewer's reasoning is in §2.5 and matches every other `isActive` in the schema.

Placeholders are protected by a route rule, not the schema: `isPlaceholderBrand(name)` / `isPlaceholderCategory(name)` → `400 "<name> is the import fall-back and cannot be made inactive"`.

#### A2 — API

**`PATCH /api/brands/[id]`** (`brands/[id]/route.ts:14-21` schema, `:23-79` handler) — add `isActive: z.boolean().optional()` and `reactivateProducts: z.boolean().optional()` (Q2c). When `isActive` flips:

```
false:  $transaction
          refuse if placeholder
          brand.update { isActive: false }
          products = product.updateMany({ where: { brandId, status: ACTIVE }, data: { status: INACTIVE } })
          logActivity(tx, { module: "brands", action: "deactivated", entityType: "Brand",
                            entityId, entityRef: name, details: `${products.count} products set inactive` })
true:   $transaction
          brand.update { isActive: true }
          if reactivateProducts: product.updateMany({ where: { brandId, status: INACTIVE }, data: { status: ACTIVE } })
          logActivity(… action: "activated", details: restored count or "products untouched")
```

Response: the brand row plus `{ productsChanged: n, unitsOnHand: sum(currentStock) }` so the confirmation can say what happened. `log.info("brand deactivated", { brandId, productsChanged })`.

The `status: ACTIVE` filter on the way down and `status: INACTIVE` on the way up are **not optional**: `ProductStatus` also has `DISCONTINUED` (§2.5), and a blind `updateMany` would rewrite it with nothing to restore it. Write the same-transaction `updateMany` twice, never a loop.

**`PATCH /api/categories/[id]`** (`categories/[id]/route.ts:13-130`; `categoryUpdateSchema` at `validations.ts:135-138`) — same shape. Deactivate walks the subtree (Q2b): collect descendant ids by looping `findMany({ where: { parentId: { in: ids } } })` until empty, then `category.updateMany` on the set and `product.updateMany({ where: { categoryId: { in: set } } })`. Activate: the row only; refuse `400 "Activate <parent> first"` when the parent is inactive.

**Remove** the `DELETE` handlers: `brands/[id]/route.ts:81-135` and `categories/[id]/route.ts:132-176`, and their imports. Nothing else calls them (the two pages are the only callers; verified by grep in §2.1).

**`GET /api/brands`** and **`GET /api/categories`** — follow `api/vendors/route.ts:17`: default `where: { isActive: true }`, all rows on `?includeInactive=1`. `isActive` reaches the client automatically (both routes use `include`, not `select`). Add `isActive: true` to the `children` select in categories (`route.ts:21`) so the tree can badge an inactive child. This one change makes **every picker in §2.1 active-only with no edit to the picker** — the two master screens are the only callers that pass `includeInactive=1`. While there: replace `export const revalidate = 300` at `brands/route.ts:1` with the `force-dynamic` line and comment the categories route already carries (`categories/route.ts:1-4`) — it never cached anything (§2.5).

**Merge** (Q4): keep, and close D4 in the same commit. `brands/[id]/merge/route.ts` moves the seven relations it skips today — `updateMany({ where: { brandId: source }, data: { brandId: target } })` on `InboundShipment`, `BrandStockUpload`, `BrandSkuMapping`, `PreBooking`, `BrandLedgerEntry`, `LedgerGap`, `VendorDiscountTerm` — inside the existing transaction, before the delete. `BrandSkuMapping` and `VendorDiscountTerm` may carry a unique on `(brandId, …)`; the builder reads their `@@unique` lines and, on a clash, refuses with a sentence naming the two rows rather than letting `P2002` surface. Q4 = (b) instead: skip the delete, set `isActive: false` on the emptied source, and the moves above still happen.

**Imports** (Q3 default): `api/zoho/pull-review/approve/route.ts` brand and category matching (`:242, :262, :349, :355`) and the two `zoho-import` routes match regardless of `isActive`; when the match is inactive, push `"Brand "<name>" is inactive — product filed under it; re-activate on /more/brands"` to `results.notices` (`:150`) or the import response's `skipped`/`errors` equivalent. `scripts/import-products.ts` is offline tooling and is left alone.

#### A3 — RBAC catalog (Q6)

`prisma/rbac-catalog.ts:308` and `:353`: `actions: ["view", "create", "edit", "fetch"]`. Data, not a migration: `npm run db:seed:rbac` after deploy.

The seeder deletes the two stale `Permission` rows (`seed-rbac.ts:169-172`) and the cascade on `RolePermission` (`schema.prisma:108`) revokes them from every role **without a log line** (§2.5). Before the re-seed, record who holds them, so the revocation is a known fact and not a mystery on `/team/permissions`:

```sql
SELECT r.key, p.key FROM role_permissions rp
JOIN roles r ON r.id = rp."roleId" JOIN permissions p ON p.id = rp."permissionId"
WHERE p.key IN ('brands.delete', 'categories.delete');
```

(table and column names to be confirmed against `schema.prisma` `@@map`s by the builder). Expected answer: ADMIN only. Add the `⚠ RUN npm run db:seed:rbac AFTER DEPLOY` comment the other changed entries carry (`rbac-catalog.ts:140-141`).

#### A4 — the two master screens

Same edit on `more/brands/page.tsx` and `categories/page.tsx`:

| Today | Becomes |
|---|---|
| Trash `IconBtn` on `mayDelete` (`:326-330` / `:313-317`) | `Power` icon `IconBtn` on `mayEdit`: amber "Deactivate <name>" when active, green "Activate <name>" when inactive — the `team/page.tsx:372-380` pattern |
| `remove()` (`:143-148` / `:144-149`) | `toggleActive()`: native `confirm` (the page's existing style) — *"Deactivate Hero? Its 42 products will be set inactive and it leaves every brand picker. Nothing is deleted."* — then `apiFetch(PATCH, { isActive })`. On activate, the confirm carries the Q2c tick |
| `ActionConfirmation` "Deleted / Not deleted" (`:368-376` / `:374-380`) | "Deactivated / Activated" with `details` from the response (`productsChanged`, `unitsOnHand`) |
| list fetch | `?includeInactive=1`; a three-chip status filter All / Active / Inactive, default **Active**, beside the search — `vendors/page.tsx:87-88` |
| row | inactive rows `opacity-60` + `<Badge variant="danger">Inactive</Badge>`; inactive children badged in the category tree |
| `mayDelete` | deleted with `canDelete` from the destructure (`:46` / `:53`) |

`Power` is in `lucide-react`. Loading, disabled-while-busy and error states as today (`busy === b.id`).

#### A5 — pickers that pre-select an existing value

With A2's default filter every picker is active-only for free. One case needs care: a product whose brand or category is *already* inactive must still show that value in its edit form, or the select renders blank and the next save changes the product silently. `stock/[id]/page.tsx:105` — if the product's `brandId` is not in the fetched list, append `{ id, name: "<name> (inactive)" }` to the options. Apply the same one-liner wherever a picker is bound to an existing row (inbound category `inbound/[id]/page.tsx:692`, vendor-brands `vendor-brands.tsx:64`). The builder greps for `api/brands` and `api/categories` and checks each of the ten sites in §2.1.

Verification item 2 in §4 covers the cache question: after A2 removed the inert `revalidate`, a toggled brand must be gone from a picker on the next load, with no wait.

### Part B — stock audit: zero all uncounted; no brand creation

#### B1 — `POST /api/stock-counts/[id]/zero-uncounted` (new)

The dead baseline code (`[id]/route.ts:231-242`) resurrected as an explicit, named action:

```
guard   requireFeature("stock_audit", "edit"), then assignee-only (copy items/route.ts:148-153)
status  IN_PROGRESS only → 409 otherwise
body    { expected: number }   — the uncounted count the screen showed
tx      live = count({ stockCountId, countedQty: null })
        if live !== expected → 409 "The uncounted list changed (now N). Reload and try again."
        updateMany({ where: { stockCountId, countedQty: null }, data: { countedQty: 0, countedAt: now } })
        $executeRaw UPDATE "StockCountItem" SET variance = 0 - "systemQty"
                    WHERE "stockCountId" = ${id} AND "countedQty" = 0 AND variance IS NULL
        logActivity(tx, { module: "stock_audit", action: "zeroed_uncounted", entityType: "StockCount",
                          entityId, entityRef: countNo, details: `${n} lines recorded as 0` })
return  { zeroed: n }
```

`createLogger("stock-counts:zero")`, `log.info("uncounted zeroed", { stockCountId, zeroed, userId })`. Idempotent: a second call finds nothing to zero and returns `{ zeroed: 0 }`. Add the `zeroed_uncounted` action to the `stock_audit` activity labels (`api/activity/route.ts:209`).

While in `items/route.ts`: add the missing status check (D6 — writes only on `IN_PROGRESS`) and a `createLogger("stock-counts:items")` (D7).

#### B2 — the button, on the Uncounted tab

`stock-audit/[id]/page.tsx`, rendered under the tab bar (`:613-625`) when `tab === "uncounted" && isAssignee && summary.status === "IN_PROGRESS" && tabCounts.uncounted > 0`:

```
[ Record 0 for all 312 uncounted ]      — full-width, min-h 44px, disabled while busy
```

On tap: **flush dirty rows first** (the manual save at `:259-287`, so a typed-but-unsaved count is not zeroed under the counter's fingers), then the reject-style bottom sheet (`:876-910` pattern): *"312 items you have not counted will be recorded as 0 — none found. You can still change any line afterwards. Complete will then be allowed."* Confirm → `apiTry(POST zero-uncounted, { expected })` → refetch summary and items → the tab shows its empty state. A 409 renders the API's sentence and reloads counts.

Update the Complete refusal text (`:583-590`) to name the button, and drop the `isBaseline` branch of it (D5).

#### B3 — remove `+ Add new brand…`

`stock-audit/[id]/page.tsx:807-828`: delete the `__custom__` option (`:839`) and the `if (e.target.value === "__custom__")` branch; keep the `else`. Replace the raw `fetch("/api/brands")` at `:208` with `apiTry` — it now returns active brands only (A2). Nothing on the server changes: `[id]/route.ts:284-306` is already match-only. If Q8 = (b), also drop `suggestedBrand` from the items PUT body, the `brands` state, and the `:284-306` block; the column stays (rule 7).

### Part C — approval: see the differences, then choose

#### C1 — fix the apply loop (D1, D3), remove the dead baseline (D5)

`api/stock-counts/[id]/route.ts`:

- `:270` → `if (item.countedQty === null) continue;` — zero lines apply. Correct the comment.
- Read the **live** scoped quantity per line before writing (`getWarehouseQtyMap` for the batch, `stock-location.ts:264`) and write the `ADJUSTMENT` row with `previousStock: live`, `quantity: |counted − live|`, and the sentence naming both: `[STOCK_COUNT] [VERIFICATION] Shortage of 3 (snapshot 10, live 9, counted 6) during "…"`. Keep the `[STOCK_COUNT]` prefix — `DELETE` reverses by it (`:428-466`). `StockCountItem.variance` stays counted − snapshot (what the counter saw).
- Delete both `BASELINE_END` branches (`:220-243`, `:256-328`); the Complete check becomes unconditional.
- Response: `{ …, applied: { lines, changed, netUnits, zeroLines, writtenOff } }`.
- Q11 = (a): no change to the guard. Q11 = (b): `applyToStock` additionally requires `userCan(user.id, "stock", "edit")`, `403` with a sentence otherwise.

#### C2 — live quantities in the items response

`items/route.ts:100-108` already fetches the live scoped map to compute `staleCount`. Return it per line: `liveQty` on each item. The review table gains a **Now** column shown only when `liveQty !== systemQty` for any row, so a stale audit is visible before it is applied (Q10).

#### C3 — the review table becomes the approval screen (Q12)

`stock-audit/[id]/review/page.tsx`, block at `:224-235`, for `status === COMPLETED && canApprove && !isAssignee`:

```
Differences                      42 lines differ · net −17 units · 9 lines counted 0 (31 units)
[ tabs: Variance | Counted | All ]   (existing, :109-113)
[ table: Product · System · Now* · Counted · Variance ]   (existing + Now)

How do you want to approve?
 ( ) Record the differences only        system stock unchanged; the variance stays on this audit
 (•) Set system stock to the counts     every counted line becomes the stock at <warehouse>;
                                        an adjustment entry is written for each line that changes
[ Approve ]   [ Reject ]
```

- The second option is rendered only when `summary.canCorrectStock` (and, if Q11 = (b), `canEdit("stock")`). For a whole-store audit it shows disabled with the API's own sentence — unless Q9 = (b), see C4.
- **Approve opens a confirm sheet** (the reject sheet's pattern) that repeats the mode, lines, net units, the write-off line, and for apply: *"This overwrites stock at Floor. There is no undo except another audit."* Then `apiTry(PUT, { status: "APPROVED", applyToStock })` with `timeoutMs: 60_000` (the count screen's value, `:296`). The result lands in an `ActionConfirmation` built from `applied`.
- `handleApprove` (`:126-137`) moves off raw `fetch`; `createLogger("stock-audit:review")`.
- The count screen (`stock-audit/[id]/page.tsx:528-552`) keeps **Reject** and replaces both approve buttons with one link, *Review differences & approve →*, so there is exactly one place an approval is decided.

#### C4 — whole-store apply (only if Q9 = (b))

`stockCountUpdateSchema` gains `correctionWarehouseId: z.string().optional()`. For a whole-store audit with `applyToStock`, it is required and must be an active warehouse of `existing.storeId` (400 otherwise). Per line, with `delta = counted − liveStoreTotal`:

```
delta > 0 → adjustWarehouseQty(tx, productId, correctionWarehouseId, delta)     (stock-location.ts:32)
delta < 0 → deductFromStore(tx, productId, storeId, -delta, label)               (stock-location.ts:85)
```

`deductFromStore` drains the store's active warehouses in picker order — the rule sales already follow, so a shortage found by counting is booked the way a sale would have been. The review screen adds a warehouse picker beside the second radio. The 4 Sep §5.1 decision is superseded by this answer and the plan says so in its PR. If Q9 = (a), C4 is not built and the disabled option's sentence stands.

### Phases and dependencies

| Phase | Work | Depends on | Agent |
|---|---|---|---|
| A1 | schema + migration | Q0 | A |
| A2 | PATCH toggles, cascade, DELETE removed, GET default filter, merge fix, import notices | A1, Q2–Q4 | A |
| A3 | catalog: drop `delete` | Q6 | A |
| A4 | two master screens | A2 | A |
| A5 | pre-selected inactive values in pickers; `revalidate` check | A2 | A |
| B1 | `zero-uncounted` route; items status check + logger | Q7 | B |
| B2 | the button + sheet | B1 | B |
| B3 | remove `+ Add new brand…`; `apiTry` | Q8 | B |
| C1 | apply-loop fixes, dead baseline out | Q10, Q11 | C |
| C2 | `liveQty` per line | — | C |
| C3 | review screen approval choice + confirm; count screen links | C1, C2, Q12 | C |
| C4 | whole-store apply | C1, Q9 = (b) | C |

A, B and C touch disjoint files except `stock-audit/[id]/page.tsx` (B2, B3, C3) and `api/stock-counts/[id]/route.ts` (B1's neighbour, C1). Build order inside the file: B before C. Three agents in parallel, then one review pass (`/code-review`) across the branch before the owner builds.

**No cron, no timer, no new module, no JWT change.** One migration (A1). One catalog change (A3).

### Logging

| Scope | New lines |
|---|---|
| `brands` / `categories` routes | `log.info("brand deactivated", { brandId, productsChanged })`, `"brand activated"`, `"deactivate refused — placeholder"` as `warn` |
| `stock-counts:zero` (new) | `info` on success with `zeroed`; `warn` on the 409 mismatch with both counts |
| `stock-counts:items` (new) | `warn` on a write refused by status |
| `stock-counts` | `info("stock corrected", { stockCountId, lines, changed, netUnits, zeroLines })` in place of the per-line silence; `warn` when `liveQty !== systemQty` on an applied line |
| `stock-audit:review` (new) | `error` on approve failure with the API sentence |

Every `catch` logs. No payloads, only ids and counts.

### Board of agents — checked

- **inventory-consultant** — *"Never estimate stock — count it."* R4 is the one place this plan lets a person record a number they did not count. Mitigations: the button names the count; the sheet says "none found"; the approver's confirm shows how many zero lines and how many units are written off before anything is applied; the activity log records who zeroed how many. **Flagged to the owner here rather than silently built.**
- **database-architect** — soft delete over hard delete ✓; additive migration ✓; cascade inside one transaction ✓; the ~5,700-row `updateMany` is one statement ✓.
- **backend-engineer** — transitions stay in the `VALID_TRANSITIONS` map ✓; zero-uncounted is idempotent and status-gated ✓; the `expected` count is the idempotency guard against a stale screen ✓; D6 closed ✓.
- **frontend-engineer** — every new button has disabled-while-busy, an error line and a sheet; 375 px: the radio pair stacks; no role names anywhere (`usePermissions` only) ✓.

---

## 4. Verification

The owner runs the build (their instruction, 8 Sep). Before handing over, each agent runs `npx tsc --noEmit` (~1 min, no database) and `npx eslint` on its files.

**Part A**
1. Migration SQL read: two `ADD COLUMN … DEFAULT true`, nothing else. `npx prisma migrate status` clean on local.
2. `/more/brands`: Deactivate a test brand with products → confirm names the count → row dims, badge shows → `/stock` no longer lists its products under Active, does under Inactive → the brand is absent from the product edit picker → a product already on it still shows "(inactive)" in its own form.
3. Activate it again with the tick → products return.
4. Deactivate `Unbranded` → refused with the sentence.
5. `/team/permissions`: no `delete` checkbox under Brands or Categories after `npm run db:seed:rbac`.
6. Approve a Zoho bill whose vendor matches the inactive brand → product filed under it, notice in the result.

**Part B**
7. Audit with 20 uncounted lines, type 5 on one row without waiting for auto-save, press the button → the typed row keeps 5, the other 19 read 0, tab shows 0 uncounted, Complete is allowed.
8. Press it again → `{ zeroed: 0 }`, no error. Open the same audit in a second tab with a stale count → 409 with the sentence.
9. The brand picker has no "+ Add new brand" and lists active brands only.

**Part C**
10. A warehouse audit where one line was counted 0 on a shelf that has 4 in stock. Approve with "Set system stock" → stock is 0, one `ADJUSTMENT` row with `previousStock 4` (D1 gone).
11. Raise an audit, sell one unit of a product, count it → the review table shows a **Now** column for that row and the ledger row records the live figure.
12. Approve with "Record the differences only" → stock unchanged, the audit shows APPROVED with its variance.
13. A whole-store audit: the second option is disabled with the sentence (Q9 = a) or asks for a warehouse and books surplus there / shortage in picker order (Q9 = b).
14. `DELETE` on the approved audit still reverses by `[STOCK_COUNT]` (`:428-466`).

---

## 6. Build record — 8 Sep 2026

Built the same evening by four agents in parallel with strict file ownership (B: counting; C: approval; A-screens; then A-migration+API last, per the owner's order), reviewed by two read-only agents, one commit at the end. `npx tsc --noEmit` exit 0 across the whole tree; `eslint` clean on every touched file (one pre-existing `react-hooks/exhaustive-deps` warning on the count screen's auto-save effect, untouched). **`npm run build` was NOT run** — the owner runs it.

**Migration.** `prisma/migrations/20260908161249_brand_category_is_active/` — written by `migrate dev` on localhost `bch` (host printed and checked; the database had all seven prior migrations recorded and real data, so no reset was offered or run). SQL is exactly the two `ALTER TABLE … ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true` statements. `migrate status` up to date afterwards. **Not applied anywhere but localhost** — run `migrate status` then `migrate deploy` by hand on the cloud test project before this code runs there.

**Built as planned, with these deviations and additions:**

| Where | What differs from §3, and why |
|---|---|
| A2 `brands/[id]/merge` | Refuses (400) on a `BrandSkuMapping` name clash instead of skipping — a half-moved mapping would leave the source undeletable anyway. Response gains `relationsMoved`. |
| A2 categories PATCH | Response also carries `subcategoriesChanged`. Activating a parent does not activate its children; each is activated on its own row, parent first. |
| A2 zoho-import | `notices: string[]` added to both import responses; `ZohoTaxonomySheet` renders it under the errors list when present. |
| A4 screens | No search box existed on either master screen, so the status pills sit between the create card and the list. Merge targets are active-only and the Merge button hides when no other active row exists. Activate asks a second `confirm` for the product restore only when `_count.products > 0`. |
| A5 | `inbound/[id]` and `vendor-brands.tsx` needed no change: neither binds a select to an existing row's value. |
| B2 | The bulk-zero button is hidden while a search is active (search replaces the tab filter, so a whole-audit action over a filtered list would read as "zero these rows"). |
| B3 | `api/activity/route.ts` needed no edit — the feed renders `action.replace(/_/g, " ")`, so `zeroed_uncounted`, `deactivated`, `activated` read correctly. |
| C1 | The per-line `product.findUnique` in the old loop is gone; the line's `include` already carries what the brand block needs. |
| C3 | The four summary cards keep the snapshot figures; the "Differences" strip and the confirm sheet use live stock. Both are labelled. |

**Found by review and fixed before the commit:**

- `api/stock-counts/[id]/route.ts` — the PUT's own `data.items` loop was a second unguarded write path (D6 had two doors, not one); now 409 unless `IN_PROGRESS`. GET, PUT and DELETE catches now log with the audit id (`id` hoisted above each `try`).
- Count screen — the first press of "Record 0 for all uncounted" after a flush sent a stale `expected` and always 409'd; `fetchItems`/`fetchSummary` now return their promises and are awaited. `fetchSummary`, `fetchItems` and `handleDelete` moved off raw `fetch().then(r => r.json())` while there. An empty save batch clears `dirtyRef`.
- Review screen — the approve card no longer flashes for the assignee before the session resolves; the "cannot apply" sentence distinguishes a whole-store audit with no active warehouse from a legacy audit.

**Owner steps after the deploy (unchanged from §3):** `npm run db:seed:rbac` — the holder query found only ADMIN holding `brands.delete` / `categories.delete`, so that is the only role that loses a grant; `migrate deploy` on the target before the code goes live.

**Known and left alone:** `[id]/route.ts` DELETE still reverses an approved count by writing `Product.currentStock` globally from a scoped `previousStock` (pre-existing); `scripts/import-products.ts` ignores `isActive` (offline tooling, §5).

## 5. Out of scope, deliberately

- **Making `Product.brandId` / `categoryId` nullable.** Still the real fix for placeholders; still every screen.
- **`brand_vendors`, lead times, the brand-stock upload module.** Untouched.
- **The brand-count wizard's reclassify chips** (`brand-count/page.tsx:601-652`) — they pick existing rows and create nothing; only their fetch gains the active-only default for free.
- **Questions.md items 3, 4, 5, 6** (searchable store picker, brand-count listing the store, permission review) — separate plans.
- **A per-line "un-count"** (setting `countedQty` back to null). Not asked for; the zeroed line can be overwritten with any number.
