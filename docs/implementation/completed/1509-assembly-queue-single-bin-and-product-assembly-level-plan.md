# /assembly gets tabs and a searchable "awaiting assignment" list; inbound puts a line in ONE bin with no loose-parts split; the assembly condition level lives on the product

Status: completed — 16 Sep 2026, `/assembly` has tabs and a searchable Awaiting Assignment list, every received inbound line lands in ONE bin with no loose-parts split, and the condition level lives on the product as `Product.assemblyLevel` (saved at the first assign, editable from `/stock` and the details page). Parts A–E built by parallel agents, `npx tsc --noEmit` exit 0. Committed and pushed as `3d1cf9e`, `ef9810e`, `164f95a`, `f20e080`, `fe50ca2`. Still owed by the owner: `npm run build`, the browser walk, and `migrate deploy` of the assembly migrations on the test/production database.
Branch: `feat/remove-static-team-health` (owner: "i need to implemnt in this branch level only").

Every `file:line` below was read from disk on 15 Sep 2026 by three parallel read-only agents
and re-checked where quoted. Check rather than trust. Another session has uncommitted PO work on
this same branch — this plan does not touch any PO file.

---

## 0. Requirement

### 0.1 The owner's words, verbatim (15 Sep 2026)

> now lets implmenat a plan for this requirent where /assembly screen make it propr list let it have the top nav bar where on clicking it it must list the unassigned  ieUnassembled Inventory Awaiting Assignment   and must be searchable  and another important one where while inbonding it must just get into bin only one  i  dont need any loose parts secrigation remove that it will be only items  Loose Parts Stock  dont need every thing that matched must  be inside the bycycels  ya that ist this is my requiremnt create a related requiremnt and ask any questions if u have doubt and another thing in the screen /assembly  when i click assigne button i get Assign Bicycle to Mechanic model and in this  we have assemble condition level where i should not see that every time where i should set it to item level ie stock /product level so that it should never ask me  we can have a action in the /stocks  where we can set it explecitly and also  i need to see that in the details  and also at the time of the assigning if  we get the same product while assigning then it should  ask me again if it is not set then it should ask or show option to selcte  --> this is our requiremntif u have any question ask and clariyf i need to implemnt in this  branch level only

> use multiple agent to complete the implmenation fast

Earlier, recorded in `docs/Doubt.md:30,36` (15 Sep 2026):

> while inbounding do u have  complete cycle or dou also inbound items like loose parts

> Should we provide a top tab switcher inside /assembly between: yes  provice them a switecher and go with the recomended option wth other and  except this Old Route /services/mechanic/

### 0.2 Restated as requirements

| # | Requirement |
|---|---|
| R1 | `/assembly` has a proper **top navigation bar** (tabs). One tab is **"Unassembled Inventory Awaiting Assignment"**, shown as a proper list. |
| R2 | That list is **searchable**. |
| R3 | While inbounding, a received line goes into **one bin only**. |
| R4 | **No loose-parts segregation.** "Loose Parts Stock" and every "Loose" label go; stock is shown as plain **items**. |
| R5 | **Everything that matched is a bicycle** — see Q1 for what this means in code. |
| R6 | The **assembly condition level** (50% / 85% / 100%) is set at the **product (item) level**, so the Assign Bicycle to Mechanic modal does not ask for it every time. |
| R7 | `/stock` has an **action to set the level explicitly**. |
| R8 | The level is **shown on the product's details**. |
| R9 | At assign time: if the product's level **is set**, it is used and not asked again; if it is **not set**, the modal asks / shows the option to select. |
| R10 | (process) Built on this branch, with several agents in parallel. |

---

## 1. Questions and clarifications — answer before build

| # | Question | Why it changes the build | Options | Recommended default | **Answer** |
|---|---|---|---|---|---|
| **Q1** | "Everything that matched must be inside the bicycles" — what does it mean? | Today only products whose **category name contains "cycle"/"bike"** or whose **tags contain "bicycle"/"cycle"** get per-unit rows (`U-000123`) and reach `/assembly` (`api/inbound/[id]/route.ts:266-276`). Everything else is bulk stock only. | (a) **every** received product is a bicycle: every one gets unit codes and appears in `/assembly`; (b) keep the cycle test, non-cycles are simply stock in the bin, no "loose" label | (a) — your answer to Doubt.md:30 says you inbound complete cycles only | **(a)** every item is a bicycle |
| **Q2** | "Into one bin only" — one bin per **line** or per **whole shipment**? | Today the screen offers one bin selector **per unit** (`inbound/[id]/page.tsx:520-534`), while the server already writes everything to the first bin (`route.ts:194, 244, 286, 294-299`). | (a) one bin per **line**; (b) one bin for the whole shipment | (a) | **(a)** one bin per line |
| **Q3** | When the product has **no** level and you pick one in the modal, should it be **saved to the product** so that product never asks again? | Decides whether the modal writes `Product.assemblyLevel`. | (a) yes, saved to the product (a "Remember for this product" tick, on by default); (b) no, this bicycle only — the product is set only from `/stock` | (a) | **Saved automatically, no tick.** "when the user is assigned i ned to save this the Assembly Condition Level where it will only one per product ie if i get the same product fro assembly Assembly Condition Level * must be autotaken" — and, on follow-up: "ya it must be saved at the assigne time also thre must be a action where it can be edited in the /stock details or have an action button which will give me some model to make action" |
| **Q4** | When the product **has** a level, can it still be changed for **one** bicycle in the modal? | Decides whether the modal shows the picker at all. | (a) no — the modal shows "Condition: 85% (product setting)" read-only; change it on `/stock`; (b) show it pre-selected with a "Change for this bicycle" link | (a) — "it should never ask me" | **(a)** no override |
| **Q5** | Who may set the level on `/stock`? | Decides the route guard and who sees the action. | (a) whoever can **assign** (`assembly.approve`); (b) whoever can edit stock (`stock.edit`) | (a) — the person who assigns decides the build | **(a)** `assembly.approve` (answered with Q4) |

### 1.1 Decisions on record

| # | Decision | Date |
|---|---|---|
| D1 | Every received product gets per-unit rows and reaches `/assembly`; the cycle/bike name test goes. | 15 Sep 2026 |
| D2 | Inbound: one bin per line. | 15 Sep 2026 |
| D3 | `Product.assemblyLevel` is the one level per product. The first assign of an unset product asks, and that choice is **saved to the product automatically** (no tick). Later assigns of the same product take it without asking. | 15 Sep 2026 |
| D4 | No per-bicycle override in the modal. The level is edited through an action button + modal on `/stock` (row) and on the product details page, guarded by `assembly.approve`. | 15 Sep 2026 |

---

## 2. How it works today — verified against the code

### 2.1 `/assembly`
- One client file, `src/app/(dashboard)/assembly/page.tsx` (1153 lines), no sub-components.
- The only "tabs" are a supervisor pill toggle, **"My Build Queue"** / **"Workshop & Assignments"** (`page.tsx:418-450`), state `"my_tasks" | "supervisor"` (`:103`).
- "Workshop & Assignments" stacks two sections: **"Unassembled Inventory Awaiting Assignment"** (`:683`) as a card grid in a `max-h-72` box (`:699`), **no search**, and **"Workshop Assembly Tasks"** (`:745`) with the page's only search (`:754`).
- Awaiting-assignment data: `inventoryUnit.findMany` with `assembledAt: null`, status `RECEIVED | PUT_AWAY`, no open task (`api/assembly/tasks/route.ts:56-61`), **`take: 100`** (`:76-77`) — a 101st unit is invisible. SKU is fetched but not shown; frame number not fetched.
- Every call on the page is raw `fetch` + `res.json()` (`page.tsx:147, 161, 218, 230, 251, 273, 306, 349`) — banned by CLAUDE.md.

### 2.2 The Assign modal and the level
- Modal "Assign Bicycle to Mechanic" (`page.tsx:1057`), picker **"Assembly Condition Level \*"**: `A50` 50% Box build, `A85` 85% Semi-built, `FULL` 100% Full tune (`:1100-1125`). Starts at `A85` (`:139`) and is reset to `A85` on every Assign click (`:726`).
- `POST /api/assembly/tasks` (`route.ts:104`, `assembly.approve`) has **no zod schema**: the body is destructured raw with `level = "A85"` as a default (`:106`).
- `enum AssemblyLevel { A50, A85, FULL }` (`schema.prisma:796-800`); `AssemblyTask.level` required (`:808`); `InventoryUnit.assemblyLevel` optional (`:760`), copied from the task on complete (`tasks/[id]/complete/route.ts:72`).
- **Nothing on `Product` (`schema.prisma:533-605`) or `Category` (`:471-492`) stores a level.**

### 2.3 Inbound and bins
- Receive: `PUT /api/inbound/[id]` (`route.ts:149-414`). The screen allows one bin **per unit** and groups them (`page.tsx:520-534, 229-235`); the server writes one `InventoryTransaction` per bin (`route.ts:226-241`) but puts `Product.binId`, every `InventoryUnit` and the whole `BinStock` increment in the **first** bin only (`:194, 244, 286, 294-299`). Post-delivery put-away already sends one bin per line (`page.tsx:372`).
- Per-unit rows only for the cycle name/tag test (`route.ts:266-276`).
- "Loose" is not a data concept: it is the `/bins` screen's label for `BinStock` rows. KPI **"Loose Parts Stock"** (`bins/page.tsx:1118-1123`), per-bin label "Loose" (`:777, 837-841`), drawer "Loose Items / Parts" (`:1949-1958`). Because `BinStock` is written for **every** product, cycles included (`inbound route.ts:294-299`, `putaway/route.ts:223-227`, `bins/assign/route.ts:85-89`), **a bicycle is counted under both "Bicycles Shelved" and "Loose"**.

### 2.4 `/stock` and product details
- Row actions: Reorder settings, Deactivate, Restore (`stock/page.tsx:765-791`) via `RowBtn` (`:1036-1056`); bulk bar tabs Category / Brand / Bin / Status / Vendor (`:855-906`) → `POST /api/products/bulk`.
- Details: `stock/[id]/page.tsx`, badges row (`:421-431`), `ProductDetail` type (`:76-102`) — no assembly field.
- The narrow-route pattern to copy: `PUT /api/products/[id]/reorder` — own zod schema, `requireFeature`, read → `$transaction` write → `logActivity` (`reorder/route.ts:42-104`).

---

## 3. Implementation plan (written against the recommended defaults; revised once Q1–Q5 are answered)

### Part A — Schema (first; everything else depends on it)
| # | Change | Req |
|---|---|---|
| A1 | `Product.assemblyLevel AssemblyLevel?` — nullable, additive. Null = "not set, ask at assign". Migration `product_assembly_level`, applied to **local** `bch_local` only (owner applies elsewhere). | R6 |

### Part B — Server
| # | Change | Req |
|---|---|---|
| B1 | `PUT /api/products/[id]/assembly-level` — `{ level: "A50" \| "A85" \| "FULL" \| null }`, zod `productAssemblyLevelSchema`, guard per Q5, transaction + `logActivity`. | R7 |
| B2 | `POST /api/products/bulk` accepts `assemblyLevel` (same guard as B1) for the `/stock` bulk bar. | R7 |
| B3 | `GET /api/products/[id]` and the `/stock` list return `assemblyLevel`. | R8 |
| B4 | `POST /api/assembly/tasks` gets a zod schema. Level resolution: product level if set (Q4 a: a sent level is ignored); else the sent level is **required** ("Choose the assembly condition level") and is **always** written to `Product.assemblyLevel` in the same transaction (D3, no tick). The `"A85"` fallback goes. | R6, R9 |
| B5 | `GET /api/assembly/tasks` awaiting list: returns `product.assemblyLevel`, SKU and frame no; accepts `?q=` (unit code, frame no, product name, SKU, brand, bin code, warehouse) and pages instead of the silent `take: 100`. | R1, R2 |
| B6 | Inbound receive (`api/inbound/[id]/route.ts`): **one `binId` per line** (Q2 a); one `InventoryTransaction`; per-unit rows per Q1. | R3, R5 |

### Part C — `/assembly` screen
| # | Change | Req |
|---|---|---|
| C1 | Top tab bar: **Awaiting Assignment (n)** · **Assembly Tasks** · **My Build Queue**. Supervisors (`assembly.approve`) see all three; others see My Build Queue only. | R1 |
| C2 | Awaiting Assignment is a proper list (row per bicycle: unit code, product, SKU, brand, warehouse · bin, level chip or "Level not set", Assign button), with a search box (debounced, server `?q=`) and "Load more". | R1, R2 |
| C3 | Assign modal: product level set → read-only "Condition: 85% · Semi-built (product setting)"; not set → the three buttons, **none pre-selected**, with the note "Saved to this product — the next one won't ask". | R6, R9 |
| C4 | Every call moves to `apiTry` with `createLogger("assembly:page")`. | CLAUDE.md |

### Part D — Inbound + `/bins`
| # | Change | Req |
|---|---|---|
| D1 | Inbound receive screen: one bin selector **per line** (home-bin suggestion kept), not per unit. | R3 |
| D2 | `/bins`: "Loose Parts Stock" KPI, the "Loose" per-bin label and the "Loose Items / Parts" drawer section go. A bin shows its **items** (bicycles by unit, grouped by product). | R4, R5 |

### Part E — `/stock` + details
| # | Change | Req |
|---|---|---|
| E1 | Row action **"Assembly level"** (wrench) → small sheet: 50% / 85% / 100% / Not set → B1. Shown per Q5. | R7 |
| E2 | Bulk bar tab **"Assembly level"** → B2. | R7 |
| E3 | Details page: "Assembly level: 85% · Semi-built" (or "Not set") with the same edit control. | R8 |

### Phases and agents (R10)
1. **A** alone (schema + migrate + generate; the dev server is stopped for `prisma generate`, EPERM).
2. Then in parallel, one agent each: **B+C** (assembly API + screen — one agent, same contract), **B6+D** (inbound + bins), **B1–B3+E** (products API + `/stock` + details).
3. `npx tsc --noEmit` once at the end (Claude); `npm run build` (owner).
Every new branch logs through `createLogger` with ids only; every `catch` logs.

### Board of agents — to check before "done"
- **Inventory / Warehouse:** one bin per line; bicycles counted once (no double count with "Loose").
- **Database:** additive nullable column, no backfill needed; enum reused.
- **Backend:** zod on the assign route; guard per Q5 on B1/B2; server re-checks the level (the modal is cosmetic).
- **Frontend:** 44 px targets, loading/empty states, disabled Assign with a reason.

---

## 4. Verification
1. `npx tsc --noEmit`; `npx prisma migrate status` on local.
2. `/stock`: set a product to 100% → details show it; bulk-set three products.
3. `/assembly` → Awaiting Assignment: search by unit code, by product name, by SKU; Load more past 100.
4. Assign a bicycle of the 100% product → no picker, task level FULL. Assign one of an unset product → picker, none pre-selected; the product now shows that level on `/stock`, and the next bicycle of that product does not ask.
5. API: assign with no level for an unset product → 400 "Choose the assembly condition level".
6. Inbound: receive a line → one bin; units and stock in that bin. `/bins` shows no "Loose" anywhere, and a bicycle is counted once.

---

## 6. Build record — 15 Sep 2026

- **A1 done.** `Product.assemblyLevel AssemblyLevel?` (`schema.prisma`, Product "Bicycle specific" block). Migration `20260915192349_product_assembly_level` — one `ALTER TABLE "Product" ADD COLUMN "assemblyLevel" "AssemblyLevel"` — **hand-written** and applied to local `bch_local` with `migrate deploy`. The owner applies it elsewhere (`migrate status` → `migrate deploy`).
- **Why hand-written:** `migrate dev --create-only` on `bch_local` reported **pre-existing drift** and asked for a reset (refused — it drops the database). `migrate diff --from-schema-datasource --to-schema-datamodel` shows the local database is missing FKs on `inventory_units` (inbound_shipment_id, assembled_by_id), `assembly_tasks` (assigned_to_id, assigned_by_id), `bin_movement_logs` (from/to bin, moved_by), `complaints` (fault_mechanic_id, attributed_by_id), plus `bins` pkey name / `warehouse_id NOT NULL` and one index name. All of it dates from `20260912040000_assembly_audit_build_line`. **Not fixed here** — it needs its own migration and a decision; flagged to the owner.
- Shared pieces written first so the parallel agents could not collide: `src/lib/assembly-level.ts` (labels), `productAssemblyLevelSchema` + `assemblyTaskCreateSchema` in `src/lib/validations.ts`.
- Parts B–E built by three parallel agents: Assembly (B4, B5, C1–C4), Inbound/Bins (B6, D1, D2), Products/Stock (B1–B3, E1–E3). `npx tsc --noEmit` = exit 0 across all of it.
- Contract as built: `GET /api/assembly/tasks` keeps `tasks, pendingUnits, mechanics, isSupervisor` and adds `pendingTotal, pendingPage, pendingPageSize, pendingHasMore`, `?q=`, `?pendingPage=`, `?only=pending`; `POST` returns the task + `levelSource: "product" | "saved-now"` (the product save is `updateMany … where assemblyLevel: null`, so two simultaneous first assigns cannot overwrite each other). `PUT /api/inbound/[id]` is `{ lineItemId, deliveredQty, warehouseId, binId? }`. `PUT /api/products/[id]/assembly-level` `{ level | null }`; `POST /api/products/bulk` takes `assemblyLevel`.
- **Agent went beyond the ask (flag):** with bins on, the inbound receive now takes the **warehouse from the bin** (the screen sends the default godown, which would put a Floor bin's units in the wrong warehouse). Logged as `receive warehouse taken from bin`. Keep or revert — owner's call.
- **Known, not changed:** a bins-on receive still never writes `StockLevel` (pre-existing); products received before this change that have `BinStock` rows but no units no longer show in the `/bins` drawer; the rest of `bins/page.tsx`, `stock/page.tsx:293` and `my-assembly-tasks.tsx` still use raw `fetch`.

### 6.1 Drift diagnosis — why `migrate dev` asked to reset `bch_local`
- `bch_local` was **created 14 Sep 2026** (`pg_stat_file` on its `PG_VERSION`), yet its `_prisma_migrations` rows date from 7–12 Sep. It is a **copy** of another database; its migration history came with the copy.
- `20260912040000_assembly_audit_build_line` is recorded as applied (12 Sep 04:26 UTC, 1 step, checksum **identical** to the file on disk — it was not edited afterwards).
- The migration was **hand-written**, not produced by `prisma migrate dev`: every object is guarded (`CREATE TABLE IF NOT EXISTS`, `DO $$ IF NOT EXISTS (… pg_constraint …)`). Four differences are baked into the file itself and would appear on ANY database it runs on: the table is renamed `Bin` → `bins` but keeps the pkey name `Bin_pkey` (Prisma expects `bins_pkey`); `bins.warehouse_id` is added nullable and never `SET NOT NULL` (schema says required); index `bin_movement_logs_warehouse_id_created_at_idx` (Prisma expects `…_createdAt_idx`); and nine FKs are written with **no `ON DELETE`** clause where the schema says `SET NULL`/`RESTRICT`.
- Those same nine FKs — exactly the ones without an `ON DELETE` — are **absent** from `bch_local` (45 other FKs to `User` exist). Every FK the file writes WITH an `ON DELETE` is present. How they were lost (in the source database or in the 14 Sep copy) cannot be proven from here.
- Rules it runs against: CLAUDE.md DB rule 1 (the folder must be what `migrate dev` wrote), rule 3 (read the SQL against the schema), rule 10 (local = a restore made by the restore script). A `migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url <throwaway>` would have been non-empty the day it was written; the CI `migrations` job that runs that check is still unbuilt.
- **Checked 15 Sep 2026 against a throwaway shadow db (`bch_shadow_demo`, created and dropped):** `migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --exit-code` = **2**. On a fresh replay the nine FKs DO get created (without `ON DELETE`), so the diff drops and re-adds them with the schema's actions, renames `Bin_pkey`, sets `bins.warehouse_id NOT NULL`, renames the index. On `bch_local` the same nine are absent altogether — so a fix migration must use `DROP CONSTRAINT IF EXISTS` to run on both shapes. `migrate status` reports "up to date" throughout because it only compares file names with `_prisma_migrations` rows.
- **Fix written 15 Sep 2026 on the owner's "ok write it":** `prisma/migrations/20260915201206_fix_assembly_fk_and_bins_drift/migration.sql` — the `migrate diff` output made safe for both shapes (`DROP CONSTRAINT IF EXISTS`, guarded pkey rename, `ALTER INDEX IF EXISTS`), a pre-check that refuses a bin with no warehouse, wrapped in `BEGIN/COMMIT` so a failure leaves the database untouched. Local `bch_local` had 0 broken links and 0 bins without a warehouse before it ran.
- **Verified 15 Sep 2026:** (1) throwaway shadow db → `migrate diff --from-migrations … --to-schema-datamodel … --exit-code` = **0** with all 18 files (the fresh-database shape, keys present with the wrong rule); (2) `migrate deploy` applied it to local `bch_local` (the keys-missing shape); (3) `migrate diff --from-schema-datasource … --exit-code` on `bch_local` = **0**; (4) `migrate status` = up to date, 18 migrations. **Owner still applies it to the test/production database:** snapshot → `migrate status` → `migrate deploy` (three pending there: `ai_call_log`, `product_assembly_level`, this fix).
- **Original fix note:** one new migration that renames the pkey, sets `warehouse_id NOT NULL` (after checking no nulls), renames the index, and adds / replaces the nine FKs with the schema's `ON DELETE` actions — generated with `migrate diff` against a throwaway shadow db, never by resetting.

---

## 5. Out of scope, deliberately
- `/services/mechanic/*` (Doubt.md:36).
- The `BinStock` table itself — still written, still read by stock counts and transfers; only the "loose" presentation goes.
- Category-level assembly defaults (the owner said product level).
- The PO files another session is changing on this branch.
