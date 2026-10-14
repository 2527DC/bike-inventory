# A Fetch tick on every module that fetches — and that one tick fetches and imports

Status: completed — 14 Oct 2026, released: PR #80 merged into `main` at the owner's instruction; production is seeded (`npm run db:seed:rbac`) BEFORE the VPS deploy from `main` (§3 Release order). No migration. Left for the owner: tick Fetch per role on `/team/permissions` (step 4), merge `main` into `test` and seed `test` (step 5), drop `zoho.fetch` next release (step 6).
Branch: **`feat/1410-fetch-permissions`** — off `origin/main` @ `e3b20bc` (owner: "From main, straight to production"). On 14 Oct 2026 the owner had PR #79's branch (`feat/1410-stock-quick-add`, the /stock table and Add stock) merged INTO this branch, so both can be tested together; the one `stock/page.tsx` conflict was resolved by keeping all of #79 and swapping in this plan's Fetch check. If #79 reaches `main` first, this branch's PR shows only its own changes; if this one goes first, it carries #79 with it.

Every `file:line` below was read from disk on 14 Oct 2026 at `e3b20bc`.

---

## 0. Requirement

### 0.1 The owner's words, verbatim (14 Oct 2026)

> I need you to create a related permissions and see data like the permissions are related to fetch and for every module in the whenever I try to add a permission with respect to role right I need the permissions of fetch where whichever the module has the fetch implementations I need you to add that permissions in the roles and permissions things. that i can add the fetch permissions to the other roles too asking it out if you have a and i will clarify it

The owner's answers to the four clarifying questions, same day, verbatim:

> **Which modules should get their own 'Fetch' tick?** — " all the module which has teh fetch  feature must get the  fetch permission  "
>
> **People who can fetch today (they hold 'Zoho › Fetch'): should they keep fetching on every screen after the change?** — "Yes, copy their access (Recommended)"
>
> **After fetching, the 'Import' / save step — which permission should it need?** — " i dont need any permision for this improt and other thing i need one feact permisson if the permission is given  whith that permission any body can fetach and improt it "
>
> **Which branch should this go on?** — "From main, straight to production"

### 0.2 Restated as requirements

| # | Requirement | Source |
|---|---|---|
| **R1** | Every module that has a fetch feature gets its **own Fetch tick** on Roles & permissions (`/team/permissions`), so Fetch can be given to any role. A quick lookup (search one Zoho invoice or contact) counts as a fetch feature. | message; answer 1 |
| **R2** | That **one tick is enough to fetch and to import** on that module's screen. The import / save step needs no second permission (not `create`, not *Zoho › Approve*). | answer 3 |
| **R3** | Roles that can fetch today **keep fetching on every screen they could fetch on** — their access is copied, once, on the day. | answer 2 |
| **R4** | Built from `main`, goes to production by PR (not through `test` first). | answer 4 |
| R5 | *(Derived from CLAUDE.md "Frontend checks are cosmetic" — not the owner's words.)* The tick controls the button **and** the route. No screen shows a Fetch button that its route refuses, and no route accepts a module's fetch from a screen that belongs to another module. | CLAUDE.md |

---

## 1. Questions and clarifications — answer before build

A recommended default is given for each, so "defaults" answers all of them.

| # | Question | Why it changes the build | Options | Recommended default | **Answer** |
|---|---|---|---|---|---|
| **Q1** | `/receivables` import: today the **browser** creates each customer and invoice through `POST /api/customers` and `POST /api/customer-invoices`, which need `customers.create` (§2.2). R2 says the Fetch tick alone must import. | Without moving the import, a person with only *Customers › Fetch* fetches the list and then every row fails. | (a) the import moves into the server (`pull-review/approve`), guarded by `customers.fetch` alone; (b) leave it — import also needs `customers.create` | **(a)** — it is what R2 says, and it is one request instead of three per invoice |**(a)** — owner, 14 Oct |
| **Q2** | `/receivables` import **also creates a Delivery** for every invoice it imports (§2.4 F1). Keep that? | With Q1 (a) the server repeats exactly what happens today, or stops doing it. | (a) keep, as today; (b) stop — `/receivables` writes customer invoices only | **(a)** — this plan changes *who*, not *what*. F1 is raised for its own decision. |**(a)** — owner, 14 Oct |
| **Q3** | POS **Re-fetch** deletes that period's POS sessions **and its settlements** (cash counted, matches) and pulls again. Which tick? | It is the one destructive fetch. Today the route needs `pos.create`; the button is shown to `bills.delete` holders. | (a) *POS › Fetch* alone, like every other fetch; (b) *POS › Fetch* **and** *POS › Approve* | **(a)** — no weaker than today's `pos.create`, and the confirm dialog stays |**(a)** — owner, 14 Oct |
| **Q4** | Brands and categories: today *Fetch* opens the Zoho preview and **Create** is needed to import (the 8 Sep plan's "two grants"). Apply R2 here too — *Brands › Fetch* alone imports? | Reverses a written decision (`prisma/rbac-catalog.ts:361-376`, `:415-425`). | yes / no (keep two grants for these two) | **yes** — "one fetch permission … fetch and import" |**yes** — owner, 14 Oct |
| **Q5** | *Integrations › Fetch / Sync* (`zoho.fetch`) guards nothing after this change. Remove it now or next release? | The seeder deletes a removed permission's grants **before** it could copy them (§2.5), and old code still running during the deploy checks it. | (a) keep it one release (labelled as unused), remove in the next; (b) remove now | **(a)** — the additive order is what lets the seed run before the deploy with nothing breaking |**(a)** — owner, 14 Oct |

### 1.1 Decisions on record

| # | Decision | Date |
|---|---|---|
| — | The four answers in §0.1. | 14 Oct 2026 |
| D1 | The tick that matters is the **screen's** module. Two screens that share a route (Bills and Inbound both pull bills; Receivables and Deliveries both pull invoices) each send their module, and the route checks that module's Fetch. | 14 Oct 2026 (this plan) |
| D0 | Owner, 14 Oct 2026: *"go with the recommendation and implement it with respect to the main reference"* — Q1–Q5 on their defaults. *"I will test it locally … after I tell explicitly to push it and merge it with respect to main you can do it."* | 14 Oct 2026 |
| D2 | Copy sources (R3) are the permissions that **actually gated the fetch and the import today**, no wider: a role gets a new Fetch tick only if it could already do that fetch. Table in §3 A2. | 14 Oct 2026 (this plan) |

---

## 2. How it works today — verified against the code

### 2.1 Why there is only one Fetch tick today

`prisma/rbac-catalog.ts:147-162`: the 0409 plan (P4, "Option B") **removed** per-module `fetch` from inbound, deliveries, vendors, bills, customers and brand_ledger, because each screen's button checked its own module while the route checked `zoho.fetch` — "a role could hold the button and not the route … which is exactly how 'the Fetch button does nothing' started." `zoho.fetch` / `zoho.approve` became the single truth.

This plan goes back to per-module ticks on the owner's instruction, and keeps the lesson: **each screen and every route it calls check the same module key** (R5). The mismatch P4 fixed is not reintroduced.

Only `zoho`, `brands` and `categories` declare `fetch` today (`rbac-catalog.ts:379`, `:430`, `:898`). The role editor already draws a *Fetch* chip for any module whose permission rows include it (`team/permissions/page.tsx:43`, `:340`) — **no UI work is needed for the ticks to appear**.

### 2.2 Every fetch feature in the app

| Screen | What Fetch does | Routes it calls | Route guard today | Button shown today to |
|---|---|---|---|---|
| `/inbound` — Fetch bills | pull Zoho bills, pick, import as shipments | `zoho/trigger-pull` step `bills` · `zoho/pull-review` · `zoho/pull-review/approve` (`source: "inventory"`) | `zoho.fetch` (`trigger-pull:114`, `pull-review:11`) · `zoho.approve` (`approve:87`) | `zoho.fetch` (`inbound/page.tsx:138`) |
| `/bills` — Fetch bills | same pull, import as vendor bills | same, `source: "accounting"` | same | `zoho.fetch` (`bills/page.tsx:67`) |
| `/receivables` — Fetch invoices | pull Zoho invoices, import as customer invoices | `trigger-pull` step `invoices` · `pull-review` · then **per invoice from the browser** `POST /api/customers` + `GET/POST /api/customer-invoices` · then `approve` | `zoho.fetch` · `customers.create` (`customers/route.ts:101`, `customer-invoices/route.ts:85`) · `zoho.approve` | `zoho.fetch` (`receivables/page.tsx:49`) |
| `/deliveries` — Bulk fetch, and search one invoice | pull or search invoices, import as deliveries | `trigger-pull` `invoices` · `pull-review` · `approve` · `deliveries/search-zoho` · `deliveries/import-zoho` | `zoho.fetch` · `zoho.approve` (`approve:87`, `import-zoho:29`) | fetch `zoho.fetch`, import `zoho.approve` (`deliveries/page.tsx:28,32`) |
| `/prebookings` — look up invoice | fill name, phone, salesperson, product from one Zoho invoice | `deliveries/search-zoho` | `zoho.fetch` (`search-zoho:19`) | not gated (shown with `deliveries.create`) |
| `/second-hand/new` — look up invoice | fill the seller's name and phone | `deliveries/search-zoho` | `zoho.fetch` | not gated |
| `/vendor-issues/new` — search client | look up a Zoho contact | `zoho/search-contacts` | `zoho.fetch` (`search-contacts:10`) | not gated |
| Workshop job card — payment check | is this Zoho invoice paid? | `api/services/zoho` | `serviceGuard("zoho","fetch")` (`services/zoho:35`) | not gated; on failure it falls back to manual entry (`JobCard.tsx:549`) |
| `/stock` — Fetch from Zoho | preview Zoho items, import products | `stock/zoho-preview` · `stock/zoho-import` | `zoho.fetch` · `zoho.fetch` **or** `stock.create` (`zoho-import:44-48`) | `zoho.fetch` or `stock.fetch` (does not exist) or `stock.edit` (`stock/page.tsx:134`) — §2.4 F3 |
| `/vendors` — Fetch from Zoho | preview Zoho vendors, import | `vendors/zoho-preview` · `vendors/zoho-import` | `vendors.create` (both, `:41`, `:48`) | `vendors.create` (`zoho-vendor-sheet.tsx:141`) |
| `/more/brands` — Fetch from Zoho | preview Zoho brands, import | `brands/zoho-preview` · `brands/zoho-import` | `brands.fetch` · `brands.create` (`:68`, `:30`) | `brands.fetch` (`zoho-taxonomy-sheet.tsx:174`) |
| `/categories` — Fetch from Zoho | same for categories | `categories/zoho-preview` · `categories/zoho-import` | `categories.fetch` · `categories.create` (`:39`, `:56`) | `categories.fetch` |
| `/accounts/settlement` — Fetch POS, Re-fetch | pull POS sessions from Zakya, then create one settlement per day | `POST pos/sessions` · `POST pos/settlement` per day | `pos.create` (`sessions:41`, `settlement:44`) | Fetch: anyone on the page; Re-fetch: `bills.delete` (`settlement/page.tsx:51`) |

Pull notifications (`zoho.pull_started`, `zoho.pull_finished`) go to holders of `zoho.fetch` (`trigger-pull:185`, `:638`).

### 2.3 Not fetch features — unchanged

Checked and left alone: AI extractions (bank statements, bills, ledgers); the Google Contacts push; the three Zoho **write-backs** (`inbound/route.ts:341` draft push, `second-hand/route.ts:121` item push, `stock/price-check/[productId]:78` cost push); `deliveries/backfill` (no screen); `pull-review/export` (`zoho.view`); the Zoho payments read inside a settlement's detail (`pos/settlement/[id]`, loads with `pos.view`); Integrations connect / disconnect (`zoho.edit`); *Clear sync data* (`sync/clear`, `zoho.approve`).

### 2.4 Defects found while mapping

| # | Defect | In this plan? |
|---|---|---|
| **F1** | `/receivables` import calls `pull-review/approve` with `entityType: "invoice"` "to mark previews approved" (`receivables/page.tsx:241`), but that branch **creates a Delivery** per invoice (`approve/route.ts:559-640`). Importing on `/receivables` therefore also fills `/deliveries`. | Q2 — kept unless the owner says stop |
| **F2** | `approve` applies `entityType` **only when no `previewIds` are sent** (`approve/route.ts:113-118`). Any id from any pull is imported, whatever its type. Harmless while one grant covered everything; with four module ticks sharing the route, a Deliveries-only person could import bills by id. | **Fixed** (B3) — the module's entity type is always in the filter |
| **F3** | `/stock` shows *Fetch from Zoho* to `stock.edit` holders; its preview route refuses them (`zoho.fetch`). The "button does nothing" pattern. | **Fixed** (C8) |
| **F4** | `/accounts/settlement` opens on `bills.view` and shows Re-fetch on `bills.delete`; its API is `pos.*`. | Fetch buttons only (C10). Page access stays — §5 |
| **F5** | `DELETE /api/pos/settlement` checks `pos.delete`, which is not in the catalog (`rbac-catalog.ts:272`) — **nobody, ADMIN included, can delete a settlement**. | No — §5, raised |
| **F6** | `zoho/sync/logs` needs `zoho.fetch`; the Integrations page that reads it is shown on `zoho.view`. | **Fixed** (B12) |
| **F7** | Callers this plan touches use `fetch().then(r => r.json())` — `prebookings/page.tsx:121`, `second-hand/new/page.tsx:49`, `vendor-issues/new/page.tsx:114`, `receivables/page.tsx:114-242`, `bills/page.tsx:144-232`. | **Fixed on the lines touched** (`apiFetch` / `apiTry`) |
| **F8** | `stock/zoho-import` creates brands and categories with no brand or category grant. | No — §5 |

### 2.5 The seeder

`prisma/seed-rbac.ts` creates any permission the catalog adds; **ADMIN** gets every permission, every other role gets nothing new. A permission removed from the catalog is deleted with all its grants, silently, in the stale sweep — which runs **before** anything could copy those grants.

The copy-once mechanism R3 needs (`inheritGrantsFrom`, seeder step 2b) exists only on `feat/1210-bank-accounts-suspense` (`19e5cde`). It is ported here **character for character**, so that branch merges onto this one without a conflict in the mechanism itself. What it does: when a run *creates* `<module>.<action>`, every non-system role holding any listed source permission gets it; never re-applied once the permission exists, so a later revocation sticks.

### 2.6 Who holds the source grants (local `bch_dev_1210`, 14 Oct)

`zoho.fetch`, `zoho.approve`, `pos.create`: **ADMIN only**. `vendors.create`: ADMIN, INVENTORY_INWARDS. On that data the copy grants exactly one new tick — *Vendors › Fetch* to INVENTORY_INWARDS — and everything else stays ADMIN-only until someone ticks it. Production may have moved since; the seeder prints every copy it makes.

---

## 3. Implementation plan

Four parts, one commit. **No migration** — permissions are data (rule 11).

### Part A — catalog and seeder

**A1.** Port `inheritGrantsFrom` (the `ModuleSeed` field and seeder step 2b) from `19e5cde`, unchanged.

**A2.** Add `fetch` to ten modules, each with the copy sources that gated that fetch **and** its import today (D2):

| Module | New tick | Copied once from |
|---|---|---|
| `inbound` | *1 Inbound › Fetch* | `zoho.fetch`, `zoho.approve` |
| `bills` | *Bills & Payments › Fetch* | `zoho.fetch`, `zoho.approve` |
| `customers` | *Customers › Fetch* | `zoho.fetch`, `zoho.approve` |
| `deliveries` | *2 Outbound › Fetch* | `zoho.fetch`, `zoho.approve` |
| `stock` | *Stock & inventory › Fetch* | `zoho.fetch` (a `stock.create` holder could never open the preview, so had no working fetch) |
| `vendors` | *Vendors › Fetch* | `vendors.create` |
| `pos` | *POS › Fetch* | `pos.create` |
| `second_hand` | *Second-Hand › Fetch* | `zoho.fetch` |
| `vendor_issues` | *Vendor / Ops Issues › Fetch* | `zoho.fetch` |
| `service_jobs` | *Service Jobs › Fetch* | `zoho.fetch` |

`brands` and `categories` keep their existing `fetch` (no copy — the permission already exists). `zoho` keeps `fetch` for one release (Q5), its comment saying it guards nothing and is removed next release. The comments at `rbac-catalog.ts:147-162`, `:361-376`, `:415-425` are rewritten to say what is true after this change.

### Part B — the routes

| # | Route | After |
|---|---|---|
| B1 | `POST zoho/trigger-pull` | Body gains a required `module` (`inbound` · `bills` · `customers` · `deliveries`) in `zohoPullSchema`. Guard `requireFeature(module, "fetch")`. Step `bills` only for `inbound`/`bills`, `invoices` only for `customers`/`deliveries` — else 400. Both notifications go to holders of `<module>.fetch`. |
| B2 | `GET zoho/pull-review` | Required `?module=`; guard `<module>.fetch`; returns only that module's entity type (bills or invoices). |
| B3 | `POST zoho/pull-review/approve` | Zod body with `module`; guard `<module>.fetch`. The preview filter **always** carries the module's entity type (F2). `source` is derived from `module` (`bills` → `accounting`, `inbound` → `inventory`), not trusted from the body. For `customers` (Q1 a): find-or-create the customer by phone and create the customer invoice server-side, using the **same** normalisation and rules as `POST /api/customers` / `POST /api/customer-invoices` (moved into `src/lib/customers/`, not copied); existing invoices skipped by exact number; then today's invoice branch (Q2 a). |
| B4 | `POST deliveries/search-zoho` | Body `{ query, module }`, `module` ∈ `deliveries` · `second_hand`; guard `<module>.fetch`. |
| B5 | `POST deliveries/import-zoho` | `deliveries.fetch` (was `zoho.approve`). |
| B6 | `stock/zoho-preview`, `stock/zoho-import` | `stock.fetch`; the `zoho.fetch`-or-`stock.create` fallback goes. |
| B7 | `vendors/zoho-preview`, `vendors/zoho-import` | `vendors.fetch` (was `vendors.create`). |
| B8 | `brands/zoho-import`, `categories/zoho-import` | `brands.fetch` / `categories.fetch` (was `.create`) — Q4. |
| B9 | `POST pos/sessions` | `pos.fetch`, Re-fetch included (Q3 a). `POST pos/settlement` accepts `pos.fetch` **or** `pos.create` (`requireAuth` + `userCan`, no role names): it is the import step of Fetch POS and also the *New settlement* button. |
| B10 | `GET zoho/search-contacts` | `vendor_issues.fetch`. |
| B11 | `GET api/services/zoho` | `serviceGuard("service_jobs", "fetch")`. |
| B12 | `GET zoho/sync/logs` | `zoho.view` (F6). |

After Part B, no route checks `zoho.fetch`; `zoho.approve` guards only *Clear sync data*.

### Part C — the screens

| # | Screen | After |
|---|---|---|
| C1 | `/bills` | Button on `canFetch("bills")`; sends `module: "bills"`; touched calls → `apiFetch` (F7). |
| C2 | `/inbound` | `canFetch("inbound")`; `module: "inbound"`. |
| C3 | `/receivables` | `canFetch("customers")`; `module: "customers"`; the per-invoice browser loop becomes one `approve` call (B3). |
| C4 | `/deliveries` | Fetch **and** import on `canFetch("deliveries")`; `zoho-import-flow.tsx` sends `module: "deliveries"` on every call. |
| C5 | `/prebookings` | Invoice lookup shown on `canFetch("deliveries")`; `module: "deliveries"`; `apiTry`. |
| C6 | `/second-hand/new` | Lookup on `canFetch("second_hand")`; `module: "second_hand"`; `apiTry`. |
| C7 | `/vendor-issues/new` | Contact search on `canFetch("vendor_issues")`; `apiTry`. |
| C8 | `/stock` | `canFetch("stock")` only (F3). |
| C9 | `/vendors` | `canFetch("vendors")`. |
| C10 | `/accounts/settlement` | *Fetch POS* and *Re-fetch* on `canFetch("pos")`. |
| — | Brands, categories, job card | No change: the taxonomy sheet already checks `canFetch(module)`; the job card already falls back to manual entry on a refusal. |

Without the tick a lookup is simply not offered and the form is filled by hand, as it is today when Zoho has no match.

### Part D — docs

`docs/notifications-guide.md:65-66` (recipients become the screen's Fetch holders). The plan's own §6 build record.

### Logging

Every changed route already has a scoped logger. Added: `trigger-pull` and `approve` log `module` with `pullId`; `approve` logs the receivables import's counts (customers matched / created, invoices created / skipped) — ids and counts only, no names or phones; `pos/settlement` logs which grant let the request through. New catches log before they rethrow.

### Board of agents

Backend engineer (guards, zod at the boundary), integration architect (shared Zoho pull), accounting consultant (bills, receivables, POS settlement), frontend engineer (button gating). Their docs are read before the build is called done; any conflict is raised, not resolved quietly.

### Release order — the seed goes first

1. PR → `main`, merged.
2. **Before the VPS deploy**, the owner runs `npm run db:seed:rbac` against production. It adds the ten ticks and prints each copy. The running (old) code is unaffected — it still checks `zoho.fetch`, which still exists.
3. Deploy the VPS from `main`.
4. Tick *Fetch* for whichever roles should have it on `/team/permissions`.
5. Later: merge `main` into `test` and seed `test` the same way.
6. Next release: drop `fetch` from `zoho` in the catalog and re-seed (Q5).

If step 2 is skipped, every fetch in the app is refused — for ADMIN too — until the seed runs. That is the one way to break this release.

---

## 4. Verification

| Check | How |
|---|---|
| Types, lint, build | `npx tsc --noEmit`, `npx eslint` on touched files, `npm run build` |
| Seeder | Local DB by explicit URL only. Run 1 prints the ten new permissions and the copies; run 2 prints no copies; revoke a copied tick, run 3 does not restore it. |
| Guards — every route in Part B | Script against a local app on `:3100` + local DB, with a throwaway role: **without** the tick → 403; **with only** the tick (no `create`, no `approve`) → past the guard. Zoho is not connected locally (credentials nulled, rule 10), so "past the guard" ends in "Zoho is not connected" — which proves the guard, not Zoho. |
| Cross-module refusal | A role with *Outbound › Fetch* only: `module: "bills"` → 403; bill preview ids with `module: "deliveries"` → nothing imported (F2). Step `bills` with `module: "customers"` → 400. |
| Receivables import (Q1) | Seeded invoice previews, *Customers › Fetch* only: customers matched by phone or created, invoices created once, a re-run creates nothing; delivery created per Q2. Rows cleaned up. |
| Role editor | `/team/permissions` shows a *Fetch* chip on the twelve modules. |
| Screens | Each screen in Part C with and without the tick: button absent / present. The real Zoho fetch is the owner's browser pass after deploy (only production holds working credentials). |

---

## 6. Build record — 14 Oct 2026

Built on `feat/1410-fetch-permissions` (off `origin/main` @ `e3b20bc`), uncommitted until the owner has tested.

**What was built** — every row of §3, with these differences from the text above, each deliberate:

| Where | Plan said | Built | Why |
|---|---|---|---|
| B3 receivables | customer and invoice rules "moved into `src/lib/customers/`, not copied" | `src/lib/customers/zoho-receivable.ts` calls the **existing** `findOrCreateCustomerByPhone` (plan 1609) inside a transaction; `POST /api/customers` is untouched | That helper already existed and matches a phone stored either way (`+91-…` from deliveries, bare 10 digits from this import). The old import looked up the bare form only, so a customer first met at delivery was created twice. Consequence: a **new** customer from `/receivables` is now written `+91-XXXXXXXXXX`, like every other new customer. |
| B3 receivables | — | A receivable that cannot be written (no phone, zero total) is reported in `errors`, its preview stays PENDING, and no delivery is created for it | Before, the page skipped such an invoice silently but still created its delivery. |
| C4 deliveries | import on `canFetch("deliveries")` | the panel's separate `canImport` prop is removed | With one tick it was always equal to `canFetch` wherever the panel shows. |
| C10 settlement | Fetch POS and Re-fetch on `pos.fetch` | the day-range selector is hidden with them | It only drives the fetch. |
| F7 | `apiFetch` on the lines touched | done for every pull / review / approve / lookup call on `/bills`, `/receivables`, `/prebookings`, `/second-hand/new`, `/vendor-issues/new` | The list loads on those pages (`/api/vendor-bills`, `/api/customer-invoices`, aging summary) still use raw `fetch` — not touched by this plan. |
| Notifications | recipients | also the start notification's text now says "bills pull" or "invoices pull" — it said "bills & invoices" for either | |

**New files:** `src/lib/zoho/pull-modules.ts` (the four pull screens and their record kind; the two lookup screens), `src/lib/customers/zoho-receivable.ts`.

**Checks run**

| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean (one stale `.next/types` entry from another branch, regenerated by the build) |
| `npx eslint` on the 34 touched files | 0 errors; 8 warnings, all on untouched lines |
| `npm run build` (local DB) | passes |
| Catalog diff vs `origin/main` and `origin/test` | exactly the ten new `*.fetch` permissions; **nothing removed** vs either — seeding `test` or production from this branch only adds |
| Seeder, local DB, run 1 | ten permissions created; copies printed per module (with two temporary source grants added for the test, then removed) |
| Seeder runs 2 and 3 | no copies; a revoked copied tick stayed revoked |
| End-to-end, local app `:3100` + local DB, throwaway role | **61/61 pass** — every route: without its tick 403, with only its tick past the guard; cross-screen refusals; F2; the receivables import (match by either phone form, new customer `+91-`, due +30 days, balance note, zero-total refused and retryable, delivery as today, re-import creates nothing); POS settlement on fetch or create; `my-permissions` carries the ticks. Everything it created was deleted. |
| Pages as ADMIN | 14 touched pages → 200 |
| Headless Chrome | role editor shows the Fetch chip; a role without Bills › Fetch sees no fetch controls on `/bills`; with Inbound › Fetch it sees them on `/inbound`; without POS › Fetch, Settlement shows no Fetch POS / Re-fetch; no horizontal overflow at 390 px; no page errors |

Local side effect, reported: running this branch's seed on the local database removed the `bank_recon` module, which an earlier local seed from `feat/1210-bank-accounts-suspense` had created. Local only; re-seeding from that branch restores it.

**Released — 14 Oct 2026.**

- The owner, 14 Oct 2026: *"The Fetch permission change isn't on production yet. I update with respect to this too and tell me which command should i run related to it"*.
- `main` was merged into the branch first (`8b47431`) to clear one conflict in `docs/implementation/README.md`: PR #79's plan had moved to `completed/` on `main`. Then PR #80 went into `main`.
- **Production, compared read-only before the merge:** 55 modules and 193 permissions, against this catalog's 55 and 203. The seed adds exactly the ten `*.fetch` ticks and removes nothing. The seed's admin user on production is `admin@bch.local`, so the seed must run with `ADMIN_ACCESS_CODE` set to that account's real code, or it resets the code to `ADMIN123`.
- The order is §3's: seed production, then Actions ▸ Deploy to VPS ▸ `main`.

## 5. Out of scope, deliberately

- **F1** if Q2 is (a); **F4** page access on `/accounts/settlement`; **F5** settlement delete; **F8** the stock import creating brands and categories. Each is raised, none is fixed here.
- Removing `zoho.fetch` — next release (Q5).
- The unmerged branches on `test` (`feat/1210-credit-notes-and-payables`, `feat/1210-bank-accounts-suspense`, `feat/1310-ledger-prompted-import`) add Zoho pull steps guarded by `zoho.fetch` / `zoho.approve`. When they reach `main` after this, those steps must move to `bills.fetch` / `customers.fetch` the same way. Noted here so the merge does not re-introduce a `zoho.fetch` guard.
- A Fetch tick for anything that is not a Zoho / Zakya read (§2.3).
