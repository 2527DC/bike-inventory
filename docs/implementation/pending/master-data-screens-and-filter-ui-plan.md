# Master data screens, product delete, and the filter drawer

Status: pending — **Q1 and Q3 answered 30 Aug 2026; only Q2 and Q4 remain and neither blocks a start.** All four parts are specified.
Suggested branch: `feat/master-data-screens` off `main`.
Prepared 30 Aug 2026. Every claim below was checked against the tree and the live database.

---

## 1. What is being asked for

Four things, of which three are the same underlying gap: **the taxonomy tables Zoho fills have no management screen.**

| Part | Ask | Today |
|---|---|---|
| **A** | Delete a product from `/stock` — **soft and hard, both** | `DELETE /api/products/[id]` exists, **no screen calls it**, and it soft-deletes while claiming otherwise |
| **B** | Categories listing + actions, in the sidebar | **No screen, no RBAC module, no PATCH, no DELETE** |
| **C** | Brands listing + actions, with lead time on the same page | `/more/brands` does **merge only** |
| **D** | `/receivables` filter is a bottom sheet and reads badly | `FilterSheet` opens upward from the bottom, on **12 screens** |

Parts B and C are the direct consequence of a finding already recorded in `zoho-import-reliability-and-observability-plan.md` §9: **`Category` is a mirror of Zoho's vocabulary, and you cannot correct it from the app.** 151 products sit in "Uncategorized" and the only non-blank values Zoho sent were wheel sizes (`12`, `14`, `16`, `20`, `24 SS`, `29 MS`). Without a screen there is nowhere to fix that.

---

## 2. Part A — delete a product

### What exists

```ts
// api/products/[id]/route.ts:112
await requireFeature("stock", "delete");
await prisma.product.update({ where: { id }, data: { status: "INACTIVE" } });
return successResponse({ message: "Product deactivated" });
```

Note what it is: **a soft delete**. It sets `status: "INACTIVE"` and the row stays. The response says "deactivated" while the HTTP verb says DELETE — and **no UI calls it**, so nobody has ever seen that mismatch.

### What it must not do

A product is referenced by `StockLevel`, `InventoryTransaction`, `SerialItem`, `InboundLineItem`, `TransferOrderItem`, `StockCountItem`, `PreBooking` and more. A hard delete of a product with history is not a tidy-up, it is **destroying the audit trail** — the same reasoning that makes `/team` refuse to delete a user with transactions.

### The rule this should follow — decided by precedent, not invented

`/team` already solved this exact problem and its shape is the one to copy:

- Count what references the row.
- **Nothing references it** → hard delete, and say so.
- **Something does** → refuse, name the counts, and offer deactivation instead.
- Render the API's `message` verbatim; never report a deactivation as a deletion.

```
"BSA REVX 14T has 3 transactions and 1 stock row. Deactivated instead of deleted
 to preserve records."
```

### Scope

| File | Change |
|---|---|
| `api/products/[id]/route.ts` | DELETE returns `{ deleted, deactivated, name, message }`; hard-deletes only when every `_count` is zero |
| `(dashboard)/stock/page.tsx` | a delete action per row behind `canDelete("stock")`, `confirm()` first, result through `ActionConfirmation` |
| `(dashboard)/stock/[id]/page.tsx` | the same action on the detail screen |

**Blocked on §7 Q1** — whether a hard delete should ever be possible, and for whom.

---

## 3. Part B — Categories management

### The gap, precisely

```
/api/categories        GET (stock.view), POST (stock.create)      ← no PATCH, no DELETE
screen                 none
RBAC module            none — it borrows `stock`
Category.parentId      exists, and NOTHING has ever written it (all 7 create
                       sites pass only name + description, so the tree is flat)
```

Seven places create a `Category` and **five are Zoho routes** that mirror `category_name` verbatim. `POST /api/categories` exists and nothing in the UI calls it. So the taxonomy is entirely Zoho's, and unfixable from the app.

### What to build

A screen at `/more/categories` — list, create, rename, merge, deactivate — plus the missing verbs:

| Route | Guard |
|---|---|
| `PATCH /api/categories/[id]` | `categories.edit` |
| `DELETE /api/categories/[id]` | `categories.delete` — refuse when products reference it |
| `POST /api/categories/[id]/merge` | `categories.edit` — move products, then delete the source |

**Merge is the one that actually matters here.** With 9 categories, several of which are wheel sizes, the useful operation is "move everything in `16` into `Bicycles` and delete `16`". `/more/brands` already implements exactly this for brands (`api/brands/[id]/merge`) — copy that shape rather than invent one.

### RBAC

A new `categories` module rather than borrowing `stock`:

```ts
{
  key: "categories",
  label: "Categories",
  description: "Product categories — the taxonomy Zoho imports into",
  icon: "Tag",
  route: "/more/categories",
  group: "Purchase",       // beside `brands` (220)
  sortOrder: 225,
  actions: CRUD,
}
```

> **Seed BEFORE guarding any route on it.** `userCan` resolves `undefined === true` for an unknown module key — false for **everyone including ADMIN**. Guarding first denies the screen to its own administrator and looks like an ungranted permission rather than a missing seed. Same trap as `stores` in the store-hierarchy plan.

`GET /api/categories` stays on `stock.view`, deliberately: every product form reads it for a dropdown, and re-guarding it on `categories.view` would empty those for anyone who is not a taxonomy admin — a silent empty list, not a 403.

---

## 4. Part C — Brands management, with lead time inline

### What `/more/brands` does today

**Merge, and nothing else.** The whole page is gated on `canCreate("brands")` and offers a source → target merge. There is no create, no rename, no delete, and no lead time.

```
api/brands/route.ts        GET, POST
api/brands/[id]/merge      POST
                           ← no PATCH, no DELETE, no [id] route at all
```

Meanwhile `/more/brand-lead-times` is a **separate screen** for one integer per brand.

### What to build

**One screen.** `/more/brands` becomes the brand master: list with product counts, create, rename, merge, deactivate — and `leadDays` edited **inline on the row**, not on its own page.

`/more/brand-lead-times` is then deleted, and `brands.description` in the catalog already says *"Brand master, lead times and stock files"*, so no catalog change is needed for it.

### This overlaps an existing plan — do not do it twice

`product-type-and-brand-lead-time-plan.md` **Part B** already specifies folding `BrandLeadTime` into `Brand.leadDays`:

- `BrandLeadTime` has **0 rows** and one meaningful column
- all three read sites already collapse a missing row to `?? 7`
- it carries a real guard bug: `api/brand-lead-time/route.ts:38` requires `brands.create` for what is an **edit**

**Do that plan's Part B first.** Once `leadDays` is a column on `Brand`, showing it inline here is a field on a row rather than a second fetch and a second screen. Doing this part first would mean building the inline editor against a 1:1 table and then rewriting it.

### Also worth fixing while here

`Brand.cdTermsDays` / `cdPercentage` are on the brand row and **four brands carry values** (BSA 1.5%/10d, Firefox 3%/20d, Hero 2%/15d, Trek 2.5%/30d) that no code reads — every cash-discount calculation reads `Vendor`. Owner's decision 30 Aug 2026: **do not drop the columns.** A brand screen is the natural place to at least *show* them, so the data stops being invisible. Whether they should drive anything is a separate question.

---

## 5. Part D — the filter drawer

### The complaint and the cause

`FilterSheet` opens **upward from the bottom**:

```tsx
// components/filter-sheet.tsx:85
<div className="fixed inset-0 z-[60] flex flex-col justify-end">
  <div className="relative bg-white rounded-t-2xl p-4 pb-safe max-h-[80vh] overflow-y-auto">
```

`justify-end` + `rounded-t-2xl` is a mobile bottom sheet. On a desktop `/receivables` it slides up from the bottom of a wide screen, which is where "not proper and good" comes from — it is a phone pattern rendered on a monitor.

### ⚠️ It is used on TWELVE screens

```
bills · expenses · inbound · prebookings · purchase-orders · receivables
reorder · second-hand · stock-audit · transfers · vendor-issues · vendors
```

**This is not a `/receivables` change.** Any edit to that component moves all twelve. That is an argument for changing it once and well, not for special-casing one screen — but it must be a deliberate decision, not a surprise.

### Proposed shape — responsive, not a replacement

Keep the bottom sheet **below `sm`**, where it is the correct mobile pattern. Above `sm`, render a **right-hand drawer**:

```
below sm     bottom sheet, unchanged        the pattern phones expect
sm and up    right drawer, w-80, full height, slides in from the right
```

Same props, same state, same call sites — twelve screens get a better desktop filter with **no changes to any of them**. That is the whole reason to fix it in the component rather than in `/receivables`.

Details worth getting right: `Esc` closes, focus moves into the drawer and returns on close, the backdrop stays clickable, and the active-filter chips keep their current behaviour so nothing relearns.

**§7 Q3** asks whether a right drawer is the shape wanted, or something else.

---

## 6. Sidebar entries

Both new screens need to appear. The sidebar is built from the `modules` table, so this is catalog plus seed, not a component change:

| Module | Route | Group | sortOrder |
|---|---|---|---|
| `categories` *(new)* | `/more/categories` | Purchase | 225 |
| `brands` *(exists)* | `/more/brands` | Purchase | 220 |

`brands` already renders in the sidebar. `categories` appears the moment `db:seed:rbac` runs.

---

## 7. Open questions

**Q1 — ANSWERED 30 Aug 2026: both. Two distinct actions, not one button that guesses.**

The owner wants a soft delete AND a hard delete, chosen deliberately rather than inferred from
whether the product happens to have history.

| Action | Does | Guard | Available when |
|---|---|---|---|
| **Deactivate** | `status: "INACTIVE"` — hides it from pickers, keeps every record | `stock.edit` | always |
| **Delete permanently** | removes the row | `stock.delete` | **only when nothing references it** |

Two things this pins down:

- **Hard delete stays refusable.** A product with `InventoryTransaction`, `StockLevel`,
  `SerialItem`, `InboundLineItem`, `TransferOrderItem`, `StockCountItem` or `PreBooking` rows
  cannot be removed — the foreign keys forbid it and, more importantly, deleting it would
  destroy the audit trail. The API refuses with the counts and points at Deactivate:

  ```
  "BSA REVX 14T has 3 transactions and 1 stock row and cannot be deleted.
   Deactivate it instead to hide it while keeping its history."
  ```

- **Deactivate becomes its own verb.** Today `DELETE /api/products/[id]` *says* delete and
  *does* deactivate. That lie is removed: `PATCH` deactivates, `DELETE` deletes, and each
  button does what its label says.

The UI shows both, with the destructive one styled as destructive and confirmed separately.
Rendering the API's `message` verbatim still applies — never report a refusal as a success.

**Q2 — what happens to a category or brand that products still reference?**
Refuse with a count and offer merge? Or force a merge target as part of the delete? Merge is the operation that actually cleans up wheel-size categories, so it may be worth making it the *primary* action and delete the rare one.

**Q3 — ANSWERED 30 Aug 2026: a right-hand drawer, with an explicit close button.**

Opens on clicking Filter, slides in from the right, and carries an **X in its header** —
clicking the backdrop must not be the only way out. Applies to **all twelve screens** that use
`FilterSheet`, which the owner confirmed is wanted.

Required behaviour:

- `X` in the drawer header, and `Esc` closes it
- backdrop click still closes, as a second route out and not the only one
- focus moves into the drawer on open and returns to the Filter button on close
- the drawer scrolls internally; the page behind it does not
- active-filter chips keep their present behaviour so nothing has to be relearned

**Q4 — should `/more/brand-lead-times` be deleted, or kept as a redirect?**
It will have no reason to exist once lead time is inline on `/more/brands`. Anyone with it bookmarked gets a 404 unless it redirects.

---

## 8. Execution order

```
0  product-type-and-brand-lead-time-plan.md Part B    leadDays onto Brand  (prerequisite for C)
1  D  filter drawer          component-only, 12 screens benefit, zero call-site changes
2  B  categories screen      catalog + seed FIRST, then routes, then screen
3  C  brands screen          absorbs lead time; delete /more/brand-lead-times
4  A  product delete         Deactivate + Delete permanently, Q1 answered
```

**D first** because it touches one component, needs no schema or catalog change, and is the lowest-risk way to confirm the approach. **A last** because it is the only destructive one.

---

## 9. Verification

- **A** — **Deactivate** on a product with transactions succeeds and the product leaves the pickers but keeps its history. **Delete permanently** on that same product is **refused** with the counts. Delete permanently on a product with no history removes the row. The dialog says which of the three happened, in the API's own words.
- **B** — merging `16` into `Bicycles` moves its products and removes `16`; `/stock` category filters still populate for a user **without** `categories.view` (proves `GET` stayed on `stock.view`).
- **C** — changing a lead time on `/more/brands` changes the expected delivery date on the next inbound shipment for that brand. A user with `brands.edit` and **not** `brands.create` can save it — that is the guard bug the other plan fixes, and testing only as ADMIN proves nothing.
- **D** — the filter opens as a right drawer at desktop width and as a bottom sheet on a phone, on `/receivables` **and** on at least two other screens that were not touched. The **X** closes it, `Esc` closes it, and focus returns to the Filter button.
- `npm run build` passes after each part.

## 10. Board of Agents

- `docs/agents/frontend-engineer.md` — the drawer, the inline lead-time editor, twelve affected screens
- `docs/agents/inventory-consultant.md` — whether a product may be deleted at all, and what a category merge means for stock history
- `docs/agents/backend-engineer.md` — the new category verbs, the delete rule, guards
- `docs/agents/database-architect.md` — referential counts behind the delete refusals
