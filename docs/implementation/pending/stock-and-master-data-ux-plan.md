# Stock and master-data UX — five phases, one branch

Status: pending — **four questions in §2, none of which block a start.** Defaults are stated for each; answering only changes a detail, not the shape.
Suggested branch: `feat/stock-master-data-ux` off `main`. **One branch, five commits — one per phase**, so any phase can be reverted alone.
Prepared 30 Aug 2026. Every claim checked against the tree and the live database.

---

## 0. Phase 0 — the application is slow, and it is mostly geography

Added 30 Aug 2026. The owner reports slow screen loads **both locally and in production**.
This phase outweighs the other five combined and should go first.

### Measured, from the owner's machine

```
SELECT 1        median 355 ms      min 306   max 412
```

That is the round trip alone — no query work, no parsing. Because:

```
app deployed        vercel.json  "regions": ["bom1"]        Mumbai
active database     ap-southeast-1                          SINGAPORE
sitting unused      ap-south-1, COMMENTED OUT in .env       Mumbai
```

A Mumbai Supabase URL is already in `.env`, commented. Someone started this and stopped.

### It is multiplied by the permission system

Every guarded route does **two** database reads before its own work:

```
requireAuth()  -> getCurrentUser()   1 query
userCan()      -> getAccess()        1 query, 170 RolePermission rows, 3-table join
```

**167 routes** are guarded. `getAccess` is wrapped in React `cache()`, but that dedupes
**within a single request only** — deliberately, so a revoked grant applies immediately
rather than surviving in a cross-request cache. So the cost is real and repeats per call.

One API call therefore costs ~2 round trips before it starts. The dashboard fires **7 in
parallel**, each paying that toll; parallelism hides some of it, but the slowest gates the
screen.

### And almost nothing is cached

```
204 routes   export const dynamic = "force-dynamic"    no caching at all
  7 routes   export const revalidate                   cached
```

### The fix, in order of impact

| | Change | Expected effect |
|---|---|---|
| **0a** | **Move the database to Mumbai (`ap-south-1`)** | 355 ms -> ~20 ms. **15-20x on every query in the app.** |
| 0b | Merge the two auth reads into one | removes 1 round trip from all 167 guarded routes |
| 0c | Cache what is genuinely static — modules, categories, brands | removes repeat reads of data that changes weekly |
| 0d | Batch the remaining N+1s | the import 504 is one instance of this |

**0a dwarfs the rest.** No amount of query tuning beats moving the data 3,000 km closer, and
everything else in this list is a smaller multiple of the same constant.

### 0a is a migration, not a config change — treat it as one

Repointing `DATABASE_URL` at an empty Mumbai project loses everything. The sequence:

```
1  confirm the ap-south-1 project exists and whether it holds anything
2  pg_dump the Singapore database                  (small: 171 products, 911 previews)
3  restore into ap-south-1
4  verify row counts match, table by table
5  repoint DATABASE_URL and DIRECT_URL, locally AND in Vercel
6  re-measure SELECT 1
7  keep the Singapore project untouched for a few days as the rollback
```

> **There is downtime**, and both Vercel deployments read this database. The data is small
> enough that the window is minutes, but it is a cutover and wants a quiet moment.

> **The 355 ms figure is from the owner's laptop.** Vercel's `bom1` has better peering to
> Singapore, so production is likely 40-80 ms rather than 355 — still bad, and still the
> dominant cost, but the local experience is markedly worse. Both were reported as slow.
> Vercel's function logs give the production number precisely; worth reading before and
> after so the improvement is measured rather than assumed.

### 0b, concretely

`requireAuth()` and `getAccess()` both read the same `User` row. They could be one query
returning the user and their role's permissions together, halving the auth cost on every
guarded route without weakening anything — the per-request freshness that makes a revoked
grant apply immediately is preserved, because it is still read per request.

---
## 1. The five, and what is already true

| # | Phase | Status today |
|---|---|---|
| 1 | **S3 upload fix** | ✅ **DONE** — `6050bb0` on `fix/zoho-import-reliability`, awaiting a real-bucket test |
| 2 | **Stock audit screen** | ✅ **likely DONE** — `a578aac` on `main`; see §3 |
| 3 | **Filter as a side drawer** | not started — one component, **12 screens** |
| 4 | **Brands + lead time on one page** | not started — needs `BrandLeadTime` folded first |
| 5 | **Product soft / hard delete + restore** | not started — API is closer than expected |

Two of the five are already fixed. What follows is the other three, plus verification for the first two.

---

## 2. Questions — answer to refine, not to unblock

**Q1 — ANSWERED: fixed.** The owner confirms `/stock-audit/new` is working after `a578aac`. This phase is verification only.
`/stock-audit/new` crashed with *"This page couldn't load"* and was fixed in `a578aac`: it rendered `role` — an object from `/api/users` — directly as a React child, which throws *"Objects are not valid as a React child"* and trips the error boundary. It painted first and died when the user list arrived, which matches the report exactly.
**Default: treat it as fixed and verify only.** If a different screen or symptom is meant, this phase reopens.

**Q2 — Fold `BrandLeadTime` into `Brand.leadDays`?**
It has **0 rows**, one meaningful column, and all three readers already collapse a missing row to `?? 7`.
**Default: yes, fold it** (Phase 4a). Building the inline editor against a surviving 1:1 table means rewriting it the moment the fold happens anyway.

**Q3 — On a permanent delete, also delete the product's S3 images?** *(still open)*

> The owner's reply — *"by default make it soft delete not hard delete, and in that screen
> I must be able to see the soft deleted listing so I can delete it hard"* — answers the
> DELETE UX, which §6 already specifies and now states as the default. It does not answer
> the images question, which is narrower:
`Product.imageUrls` is a `String[]` of S3 URLs and **nothing cleans them up** — no product route calls `storage.delete` or `keyFromUrl`.
**Default: leave them.** A hard delete already refuses whenever anything references the product, so this only ever affects a product with no history; orphaned objects cost pennies, and deleting the wrong key is unrecoverable. Worth revisiting as a sweep, not inside a delete handler.

**Q4 — ANSWERED: no. Use the side drawer at every width.** The owner wants one consistent filter surface across all screen sizes for flexibility, rather than two presentations to reason about.
Considered and rejected: a bottom sheet below `sm`. It is the more conventional mobile pattern, but two presentations means two sets of behaviour to keep correct across twelve screens, and the owner would rather have one. Below `sm` the drawer takes the full width, which is the same thing a bottom sheet does with a different animation.

---

## 3. Phase 2 — stock audit: verify, do not rebuild

`a578aac` already changed:

```
stock-audit/new:342   {u.name} ({ROLE_LABELS[u.role] || u.role})    ← rendered an object
                      {u.name} ({u.role?.name ?? "No role"})
```

and deleted `ROLE_LABELS`, a hardcoded `ADMIN → "Owner / Director"` map — both redundant now that `Role.name` is the editable display label, and the kind of role-name table CLAUDE.md bans.

**Verification, not code:** open `/stock-audit/new`, confirm the assignee dropdown lists all three users with role names, and that the page does not error once the list loads.

If it still fails, the browser console message is what decides the next step — *"This page couldn't load"* is the error boundary, never the error itself.

---

## 4. Phase 3 — the filter drawer

### What it is now

```tsx
// components/filter-sheet.tsx:85
<div className="fixed inset-0 z-[60] flex flex-col justify-end">
  <div className="relative bg-white rounded-t-2xl p-4 pb-safe max-h-[80vh] overflow-y-auto">
```

`justify-end` + `rounded-t-2xl` is a **mobile bottom sheet**, rendered on desktop too. That is the whole complaint.

### ⚠️ Twelve screens, not one

```
bills · expenses · inbound · prebookings · purchase-orders · receivables
reorder · second-hand · stock-audit · transfers · vendor-issues · vendors
```

Fixing the component moves all twelve. That is the *reason* to fix it there — same props, same state, same call sites, **zero changes to any page** — but it must be a deliberate choice rather than a surprise.

### The shape

**One presentation at every width** — a right-hand drawer. Decided 30 Aug 2026: the owner
wants a single consistent filter surface rather than two behaviours to reason about.

| Width | Presentation |
|---|---|
| all | right drawer, full height, slides in from the right; `w-80` at `sm` and up, full width below |

Required behaviour, all of it:

- **`X` in the drawer header.** The backdrop must not be the only way out.
- `Esc` closes.
- Backdrop click closes — a second route, not the only one.
- Focus moves into the drawer on open and **returns to the Filter button** on close.
- The drawer scrolls internally; the page behind does not.
- Active-filter chips keep today's behaviour, so nothing has to be relearned.

No page changes, no API changes, no schema. This is the lowest-risk of the three and goes first.

---

## 5. Phase 4 — brands and lead time on one page

### 4a — fold `BrandLeadTime` into `Brand` (prerequisite)

Specified in full in `product-type-and-brand-lead-time-plan.md` **Part B**. Summary:

```prisma
model Brand { ... leadDays Int @default(7) }
// model BrandLeadTime — deleted
```

Five files. **No data migration — the table has 0 rows**, and `?? 7` already means what `@default(7)` will mean.

Carries a real guard bug worth fixing with it: `api/brand-lead-time/route.ts:38` requires `brands.create` for what is an **edit** to an existing brand. So `brands.edit` cannot save a lead time today and `brands.create` can — backwards.

Also deletes a query from inside the Zoho import loop: `approve:344` refetches a brand already in scope at `:337`.

### 4b — `/more/brands` becomes the brand master

Today it does **merge and nothing else** — no create, no rename, no delete, and the whole page is gated on `canCreate("brands")`.

```
api/brands/route.ts     GET, POST
api/brands/[id]/merge   POST
                        ← no PATCH, no DELETE, no [id] route at all
```

Becomes: list with product counts, create, rename, merge, deactivate, and **`leadDays` edited inline on the row**. New `PATCH` and `DELETE` on `/api/brands/[id]`, guarded `brands.edit` / `brands.delete`.

`/more/brand-lead-times` is then deleted. The catalog already describes `brands` as *"Brand master, lead times and stock files"*, so no catalog change is needed.

**Worth surfacing while here:** `Brand.cdTermsDays` / `cdPercentage` carry real values on four brands (BSA 1.5%/10d, Firefox 3%/20d, Hero 2%/15d, Trek 2.5%/30d) that **no code reads** — every cash-discount calculation reads `Vendor`. Owner's decision: do not drop the columns. Showing them read-only stops the data being invisible.

---

## 6. Phase 5 — product delete, restore, and finding the deactivated

### What already exists

```ts
// api/products/[id]/route.ts:112
await requireFeature("stock", "delete");
await prisma.product.update({ where: { id }, data: { status: "INACTIVE" } });
return successResponse({ message: "Product deactivated" });
```

**It is a soft delete wearing a DELETE verb**, and **no screen calls it** — which is why nobody has noticed it says one thing and does another.

And a genuine head start: `api/products/route.ts:26` is already
`searchParams.get("status") || "ACTIVE"`. **The status filter exists server-side.** Only the UI has no way to reach it.

### The four actions

| Action | Effect | Verb | Guard | Available when |
|---|---|---|---|---|
| **Deactivate** | `status: "INACTIVE"` | `PATCH` | `stock.edit` | product is ACTIVE |
| **Restore** | `status: "ACTIVE"` | `PATCH` | `stock.edit` | product is INACTIVE |
| **Delete permanently** | row removed | `DELETE` | `stock.delete` | **nothing references it** |
| *(list)* | show Active / Inactive / All | — | `stock.view` | always |

Each button does what its label says. The current lie — DELETE that deactivates — is removed.

### Hard delete must refuse, with counts

A product is referenced by `StockLevel`, `InventoryTransaction`, `SerialItem`, `InboundLineItem`, `TransferOrderItem`, `StockCountItem` and `PreBooking`. Deleting one with history is not tidying up, it is **destroying the audit trail** — the same reasoning `/team` already applies to a user with transactions.

```
"BSA REVX 14T has 3 transactions and 1 stock row and cannot be deleted.
 Deactivate it instead to hide it while keeping its history."
```

Copy `/team`'s shape: count the references, hard-delete only when every count is zero, otherwise refuse and name them. **Render the API's `message` verbatim** — never report a refusal as a success.

### Why the status filter is not optional

Without it a deactivated product **vanishes with no way back**: `/stock` filters to ACTIVE and no screen anywhere lists inactive products. Restore would exist and be unreachable.

> A deactivated product **keeps its SKU**, so creating a new product with that SKU still fails the unique constraint. Correct — but baffling unless the screen can show the deactivated row holding it.

---

## 7. Commit plan

One branch, five commits, each independently revertable:

```
0a ops           database -> Mumbai           NOT a code change. Migration + cutover.
0b perf          one auth query, not two      167 routes
1  fix(storage)   S3 Content-Length            ALREADY DONE on fix/zoho-import-reliability
2  test           stock audit — verify only    no commit unless it reopens
3  feat(ui)       filter becomes a side drawer 1 file, 12 screens benefit
4a refactor       BrandLeadTime -> Brand.leadDays + the guard bug
4b feat(brands)   /more/brands is the master, lead time inline
5  feat(stock)    deactivate / restore / delete + status filter
```

Order is deliberate: **3 first** (no schema, no catalog, reversible), **4a before 4b** (or the editor gets written twice), **5 last** (the only destructive one).

## 8. Verification

- **3** — the filter opens as a right drawer at desktop width and a bottom sheet on a phone, on `/receivables` **and** two screens that were not touched. `X` closes it, `Esc` closes it, focus returns to the Filter button.
- **4a** — a lead time saved on `/more/brands` sets the expected delivery date on the next inbound shipment for that brand. A user with `brands.edit` and **not** `brands.create` can save it — testing only as ADMIN proves nothing, since ADMIN holds both.
- **4b** — merging brand A into B moves A's products and removes A. Renaming a brand does not disturb its products.
- **5** — Deactivate a product with transactions: it leaves the default list, keeps its history, and appears under the Inactive filter. Restore returns it to Active with stock levels intact. Delete permanently on it is **refused with counts**; on a product with no history it removes the row. The dialog says which of the four happened.
- `npm run build` passes after every commit.

## 9. Board of Agents

- `docs/agents/frontend-engineer.md` — the drawer (12 screens), inline editing, the status filter
- `docs/agents/inventory-consultant.md` — whether a product may ever be hard-deleted, and what that means for stock history
- `docs/agents/backend-engineer.md` — PATCH/DELETE split, the refusal rule, guards
- `docs/agents/database-architect.md` — the `BrandLeadTime` fold and the referential counts behind the refusals
