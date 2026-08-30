# Stock and master-data UX — five phases, one branch

Status: pending — **four questions in §2, none of which block a start.** Defaults are stated for each; answering only changes a detail, not the shape.
Suggested branch: `feat/stock-master-data-ux` off `main`. **One branch, five commits — one per phase**, so any phase can be reverted alone.
Prepared 30 Aug 2026. Every claim checked against the tree and the live database.

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

**Q1 — Stock audit: which screen, and what symptom?**
`/stock-audit/new` crashed with *"This page couldn't load"* and was fixed in `a578aac`: it rendered `role` — an object from `/api/users` — directly as a React child, which throws *"Objects are not valid as a React child"* and trips the error boundary. It painted first and died when the user list arrived, which matches the report exactly.
**Default: treat it as fixed and verify only.** If a different screen or symptom is meant, this phase reopens.

**Q2 — Fold `BrandLeadTime` into `Brand.leadDays`?**
It has **0 rows**, one meaningful column, and all three readers already collapse a missing row to `?? 7`.
**Default: yes, fold it** (Phase 4a). Building the inline editor against a surviving 1:1 table means rewriting it the moment the fold happens anyway.

**Q3 — On a permanent delete, also delete the product's S3 images?**
`Product.imageUrls` is a `String[]` of S3 URLs and **nothing cleans them up** — no product route calls `storage.delete` or `keyFromUrl`.
**Default: leave them.** A hard delete already refuses whenever anything references the product, so this only ever affects a product with no history; orphaned objects cost pennies, and deleting the wrong key is unrecoverable. Worth revisiting as a sweep, not inside a delete handler.

**Q4 — Keep the bottom sheet on phones?**
**Default: yes.** Bottom sheet below `sm`, right drawer at `sm` and up. A right drawer on a 375 px screen is a full-screen overlay with extra animation — the bottom sheet is what phones expect and it already works.

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

| Width | Presentation |
|---|---|
| below `sm` | bottom sheet, unchanged |
| `sm` and up | right drawer, `w-80`, full height, slides in from the right |

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
