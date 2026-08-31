# Imported products arrive with invented brand, category and no size

Status: pending — Part 0 is a measurement that must run before Parts B and C can be
specified exactly. Parts A and D are ready as written.
Branch: **`fix/import-data-quality`** — create it with exactly this name, off `main`.
Prepared 30 Aug 2026. Field-level causes below are read off the code.

---

## 1. The symptom

A product card on `/stock` after a Zoho import:

```
26''BICYCLE S/S(NYTRO NON-IBC)D/DISC
6765        Imported        Uncategorized
```

Four fields, and only two carry real information. `6765` is Zoho's SKU (correct), the name
is Zoho's name (correct), **`Imported` and `Uncategorized` are values this application
invented**, and `size` — which for this product is literally the first three characters of
its own name — is blank, so no size badge renders.

The card itself is fine: `stock/page.tsx:942-953` renders name, SKU, brand, category and a
size badge. It is printing exactly what the import wrote.

## 2. Where each value comes from

| Field | Source | Why it is wrong |
|---|---|---|
| `brand` = "Imported" | `api/zoho/pull-review/approve/route.ts:75` — `defaultBrand` is found-or-created as a Brand literally named `Imported`, used whenever the preview's `brand` field is empty | `Product.brandId` is **required** (`schema.prisma:451`), so the import cannot leave it blank. It invents a brand instead |
| `category` = "Uncategorized" | same route, `resolveCategory()` — `(d.categoryName \|\| "").trim() \|\| "Uncategorized"` | `Product.categoryId` is **required** (`schema.prisma:449`). Same forced invention |
| `size` = null | **nothing writes `size` on any import path.** `grep "size:" src/app/api/zoho` returns no writes | Zoho has no size field; for bicycles the size is inside the name (`26''`, `24 SS`, `29 MS`) |
| `type` | regex on the name in the approve route | Works for this row — `bicycl` matches — but it is a guess, and no one is told it was guessed |

The preview built at pull time **already carries** `brand` and `categoryName`
(`trigger-pull/route.ts:113-118`, from `item.brand \|\| item.manufacturer` and
`item.category_name`). So the placeholders mean one of two things, and we do not currently
know which:

1. Zoho's **item list** response does not include those fields (the detail call does — the
   bill branch calls `getItem` for exactly this reason at `approve/route.ts:250`), or
2. Zoho has them and they are empty for this catalog.

**Part 0 settles that.** Nothing downstream should be built on a guess about it.

## 3. Part 0 — measure what Zoho actually sends (do this first)

Log one complete raw item from the list response at `debug` level, once per pull, in
`buildItemPreviews`:

```ts
log.debug("raw zoho item sample", { keys: Object.keys(items[0] ?? {}), sample: items[0] });
```

An item record carries no secret, but keep it `debug` and keep it to the FIRST item, not a
loop — the rule about logging identifiers rather than payloads exists for a reason.

Run a pull with `LOG_LEVEL=0`, then answer:

- Does the list carry `brand` / `manufacturer`? Are they populated?
- Does it carry `category_name`?
- Is there anything size-shaped (`package_details`, a custom field)?

The answer decides Part B: if the fields arrive populated, the bug is in the mapping and it
is a one-line fix. If they do not arrive at all, Part B costs one Zoho call per item and is
bounded by the rate limit in `zoho-provider-endpoint-registry-plan.md` §10.

## 4. Part A — stop presenting invented values as facts (ready now)

Independent of Part 0, and the fastest visible improvement.

- On the card, render a placeholder brand/category in the muted style used for absent data
  rather than the blue brand style — `Imported` currently looks exactly like a real brand
  name such as `Atlas`.
- Add a quick filter beside the existing ones (`ALL / IN_STOCK / NO_STOCK / LOW_STOCK /
  INACTIVE`) for **Needs details** — products on the `Imported` brand or the
  `Uncategorized` category. There are 151 in `Uncategorized` today.
- Point it at the tool that already exists: `/stock` already has bulk assign for brand,
  category and status (`stock/page.tsx:191, 229-231`). The filter plus bulk assign is a
  complete fix-up workflow with no new API.

Match the placeholder names to constants rather than string literals scattered across
files — the import writes `"Imported"` and `"Uncategorized"` in five places today.

## 5. Part B — capture the real brand and category (after Part 0)

**If the list carries them:** fix the mapping and re-pull. Nothing else to do.

**If it does not:** fetch item details at approve time, exactly as the bill branch already
does (`approve/route.ts:250`, `zohoForItems.getItem`). Cost per item: 1 Zoho call. Under
Zoho's 100 requests/minute that caps an approve batch at ~90 items, well below the ~250 the
60 s function budget allows — so the batch-size guidance in the other plan's §10 changes
for items, and Part E there must say so.

Do **not** re-run this for products that already exist: existing items are frozen on purpose
(`trigger-pull/route.ts:88`), and that rule is business logic, not an optimisation.

## 6. Part C — derive `size` from the name (after Part 0)

Zoho has no size field. For bicycles the name begins with it: `26''`, `24 SS`, `29 MS`,
`20`. A deterministic parse at approve time — wheel size at the start of the name, written
to `size`, left null when no match — costs nothing and populates the badge the card already
renders.

Two rules: only apply it when `type === "BICYCLE"`, and never overwrite a `size` a person
typed. Offer it as a one-off backfill for existing rows behind `stock.edit`, not as an
automatic migration.

## 7. Part D — the root cause, and why it is not being fixed here

`Product.brandId` and `Product.categoryId` are non-null. That is the reason the import
invents values at all: it has nothing else to write. Making them nullable would let an
import say "unknown" honestly, and the UI could then render absence as absence.

**Not proposed here.** It touches every screen and query that assumes a brand and a category
exist, and it is a schema change that deserves the database architect's review on its own
terms rather than as a side effect of a display fix. Recorded so the next person knows the
placeholders are a symptom of a constraint, not carelessness.

## 8. Verification

- Part 0: a pull logs one item's keys; the answer is written into this document before
  Parts B or C are built.
- Part A: a product with the `Imported` brand is visually distinguishable from one with a
  real brand; the **Needs details** filter returns the 151 `Uncategorized` products; bulk
  assign moves a selection to a real category and the cards update.
- Part B: import a known item whose brand and category are set in Zoho, and confirm both
  land — verified against the Zoho record, not against the preview.
- Part C: `26''BICYCLE S/S(NYTRO NON-IBC)D/DISC` imports with `size = "26"`; a spare part
  with a number in its name does not get a size.
- `npm run build` passes.

## 9. Board of Agents

- **Inventory consultant** — brand and category drive reorder grouping and every stock
  report; a merged or corrected taxonomy changes those numbers.
- **Integration architect** — Part B adds a Zoho call per item; the rate limit and the
  approve batch size are the constraint.
