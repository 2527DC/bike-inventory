# Imported products arrive with invented brand, category and no size

Status: in-progress — 1 Sep 2026, Parts 0, A, C and E shipped; Part B waits on Part 0's measurement being run against a live Zoho pull

Part B is deliberately not built: its shape — a one-line mapping fix, or one Zoho call per
item — is exactly what Part 0 measures, and the instrumentation has been written but not yet
read. Part D remains a recorded root cause, not a task.

Branch: **`fix/import-data-quality`**, cut from `refactor/zoho-endpoint-registry` rather than
`main` — see "Decisions taken at implementation" below.
Prepared 30 Aug 2026. Field-level causes below are read off the code.

## What remains after this branch

1. **Fix `autoType`.** Measured against a real pull, **89 of 132 items are typed `ACCESSORY`
   while plainly being bicycles**, and two accessories are typed `BICYCLE`. This now caps
   Part C at 5 recovered sizes where ~94 are available, and it corrupts the type filter,
   reorder grouping and every by-type report. Belongs with
   `product-type-and-brand-lead-time-plan.md`. **Biggest single win left in this area.**
2. **Run the Part 0 measurement.** The instrumentation is shipped; nobody has read it yet.
   Run a Zoho item pull with `LOG_LEVEL=0` and answer the three questions in §3.
3. **Then Part B**, whose shape that answer decides — and which has *two* sites, not one
   (§5).

Nothing else in this document is outstanding.

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
| `bin` = null | nothing writes `binId` on any import path either (`grep binId src/app/api/zoho` is empty) | `Product.binId` is **nullable** (`schema.prisma:478`), so unlike brand and category nothing is invented — the shelf is simply unknown. Zoho has no bin concept and never will: bins are this warehouse's physical shelves. See Part E |
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

**Shipped — instrumentation only. The measurement itself has not been run.**

`trigger-pull/route.ts`, in `buildItemPreviews`, immediately after the dedupe and before the
`createMany`:

```ts
log.debug("raw zoho item sample", { pullId, keys: Object.keys(unique[0]), sample: unique[0] });
```

One item, not a loop, at `debug`. Placed after the `unique.length === 0` guard so it can
never read `items[0]` on an empty pull, and reading `unique[0]` rather than `items[0]` so it
reports an item that will actually be written. `IntegrationItem` is a narrowing type, not a
runtime filter, so `Object.keys` shows the real Zoho payload including fields the type omits
— which is the entire point of the exercise.

An item record carries no secret, but it stays `debug` and stays one item — the rule about
logging identifiers rather than payloads exists for a reason.

**To run it:** set `LOG_LEVEL=0`, press **Fetch Stock** on `/stock`, and read the server log
for `zoho:trigger-pull raw zoho item sample`. Then answer:

- Does the list carry `brand` / `manufacturer`? Are they populated?
- Does it carry `category_name`?
- Is there anything size-shaped (`package_details`, a custom field)?

**Write the answers here when you have them.** The answer decides Part B: if the fields
arrive populated, the bug is in the mapping and it is a one-line fix. If they do not arrive
at all, Part B costs one Zoho call per item and is bounded by the rate limit in
`zoho-provider-endpoint-registry-plan.md` §10.

### Partial answer already in hand — and why it is not enough

`docs/stock-fetch-previw-response.js` captures a real pull (`pull-1788250299559`, 132 items,
1 Sep 2026). In it, **`brand` is empty on 132 of 132 and `categoryName` is empty on 132 of
132** — not one item in the batch carries either. So whatever the mapping reads is uniformly
empty, and the placeholders are not a per-item accident.

That is the *preview*, though — the app's own output after mapping. It cannot tell
`item.brand` **absent from Zoho's response** apart from `item.brand` **present and empty**,
and those two have completely different fixes. Only the raw log settles it. Run it.

> A third answer is now cheap to check and worth checking: if a size-shaped field *does*
> exist, Part C's name parse becomes a fallback rather than the only source, and the two
> should be compared before either is trusted.

## 4. Part A — stop presenting invented values as facts — **SHIPPED**

Independent of Part 0, and the fastest visible improvement.

- **Card styling.** A placeholder brand renders muted italic (`text-slate-400 italic`)
  instead of the blue a real brand gets; a placeholder category renders italic against the
  same muted grey. `Imported` no longer reads like `Atlas`.
- **`Needs details` quick filter**, sixth chip on `/stock`, between *Low Stock* and
  *Inactive*. Matched **server-side** via a new `needsDetails=true` parameter on
  `GET /api/products` — the list is paginated at 100 and the affected rows are spread across
  the whole catalog, so filtering the loaded page would have reported "3 need details" out
  of 151 and looked like good news.
- Selecting the chip **widens the type filter to All**. It defaults to `BICYCLE`, and
  leaving it set would have silently answered "which *bicycles* need details", hiding the
  spare parts and accessories that need them just as much. The change is visible in the
  control and the person can narrow it again.
- A one-line explanation renders above the list while the filter is active, because the rows
  it returns look ordinary — the muted brand is otherwise the only clue.
- It feeds the tool that already exists: `/stock` bulk assign for brand, category and status.
  No new API for the fix-up itself.

**Constants.** `src/lib/import-placeholders.ts` now owns `PLACEHOLDER_BRAND`,
`PLACEHOLDER_CATEGORY`, `isPlaceholderBrand()` and `isPlaceholderCategory()`. All five import
write sites and every detection site now read from it:

| Site | Was |
|---|---|
| `zoho/pull-review/approve/route.ts` | `"Uncategorized"` ×2, `"Imported"` ×2 |
| `zoho/import/items/route.ts` | `"Uncategorized"`, `"Imported"` |
| `stock/page.tsx` | `brands.filter(b => b.name !== "Imported")` |
| `more/categories/page.tsx` | `c.name === "Uncategorized"` |
| `stock-counts/[id]/route.ts` | `["Imported", "Unbranded", "General"]` |

The helpers compare case-insensitively and the `needsDetails` query uses
`mode: "insensitive"` to match. They have to agree: a brand renamed from /more/brands could
otherwise render as a placeholder on the card and still escape the filter meant to collect it.

Display-only fallbacks that happen to produce the same strings — `reorder/route.ts`,
`brand-stock/[id]`, `stock-audit/brand-count` — were **left alone**. They mean "no category
on this row", not "the import invented one", and collapsing the two would make the constant
mean two different things.

## 5. Part B — capture the real brand and category (after Part 0) — **NOT BUILT**

Held deliberately: which of the two branches below applies is exactly what Part 0 measures,
and Part 0 has not been run. Building either now would be a guess wearing a commit message.

**Two sites, not one.** Reading the code for this branch turned up a second import path the
original plan does not mention:

- `zoho/pull-review/approve/route.ts` reads `d.brand` from the preview and resolves a real
  Brand when it is non-empty. This is the path the **Fetch Stock** button uses.
- `zoho/import/items/route.ts` **never reads `item.brand` or `item.manufacturer` at all** —
  every product it creates gets the placeholder brand even when Zoho has a real one. That is
  a mapping bug independent of what Zoho sends, but it is still Part B's to fix, and it was
  left in place with a comment saying so. (This route has no caller in the UI today; it is
  reachable only directly. Whether it should exist at all is a separate question.)

**If the list carries them:** fix the mapping — in both sites — and re-pull. Nothing else to do.

**If it does not:** fetch item details at approve time, exactly as the bill branch already
does (`approve/route.ts:250`, `zohoForItems.getItem`). Cost per item: 1 Zoho call. Under
Zoho's 100 requests/minute that caps an approve batch at ~90 items, well below the ~250 the
60 s function budget allows — so the batch-size guidance in the other plan's §10 changes
for items, and Part E there must say so.

Do **not** re-run this for products that already exist: existing items are frozen on purpose
(`trigger-pull/route.ts:88`), and that rule is business logic, not an optimisation.

## 6. Part C — derive `size` from the name — **SHIPPED**

Built ahead of Part 0 by decision: a leading-wheel-size parse is the right reading of these
names regardless of what the Zoho list response turns out to contain. If Part 0 finds a
size-shaped field, this becomes the fallback rather than the only source.

`src/lib/product-size.ts` holds `parseBicycleSize()` and `BICYCLE_SIZES`, which moved here
from `stock/page.tsx`. Same list, one definition — the regex alternation is **built from**
`BICYCLE_SIZES` rather than repeating it, so the sizes the filter offers and the sizes an
import can write cannot drift apart, and a parsed size can never be a badge the filter cannot
select.

The known-size list is the whole contract. A number in a product name that is not a wheel
size this shop sells is part of a model name, and guessing it into `size` is worse than the
blank: a wrong badge, and the product filed under a size filter it does not belong to.

> **Written without lookbehind** — `(?:^|[^\w.])` rather than the `(?<![\w.])` it obviously
> wants to be. `/stock` imports this module for `BICYCLE_SIZES`, so the regex is constructed
> in the browser bundle too, and Safari before 16.4 throws on lookbehind at module load —
> which would take the whole page down rather than degrade. On a phone-first app that is not
> a theoretical browser.

> **Open, minor:** `BICYCLE_SIZES` is `12 14 16 20 24 26 27.5 29`. If the shop sells **18"**
> or **28"** bicycles, add them to that array — it widens the parse and the /stock size filter
> together, which is the reason they share one list.

### Measured against a real pull — the "at the start" premise was only half true

Run over the 132 items in `docs/stock-fetch-previw-response.js` (pull `pull-1788250299559`,
1 Sep 2026). The parse originally read a **leading** size only, as the plan describes, and
reached **1 bicycle in 12**. The older `26''BICYCLE S/S(…)` naming puts the size first; the
newer brand-first naming does not:

```
FFBC /E-BICYCLE HERO LECTRO 27.5  7SP MS Y5 PLUS BLU/BLK      -> 27.5, mid-name
HSBC/E BICYCLE HERCULES BRUTE 27.5T SS AQUAHAZE/BLK           -> 27.5T, mid-name, T suffix
POLYGON BRAND BICYCLE XTRADA 7 29 2024-PURPLE WHITE M(18)'    -> 29, mid-name, beside a year
```

**The parse was therefore widened to search the whole name** (owner's decision, 1 Sep 2026),
taking it to **5 of 12**. The remaining seven genuinely have no size to find
(`AOKI E-BICYCLE STREET MAMBA BLUE`, `POCKET BIKE`).

Widening is where a wrong badge would come from, so the guard rails are in the regex and are
tested. `27.5T` reads through its trailing `T`; a model year never becomes a size; and first
match wins so a leading size is still preferred and `MODEL 2024 26T` resolves to `26"` rather
than to `20"`:

| Name | Result | |
|---|---|---|
| `2600 SERIES CYCLE` | `null` | `26` is followed by a digit |
| `V26 SPECIAL` | `null` | preceded by a letter — a model code, not a size |
| `MODEL 2024 GT`, `XTRADA 7 2024` | `null` | `20` followed by a digit; `24` preceded by one |
| `700C ROAD BIKE` | `null` | not on the list |
| `MODEL 2024 26T MTB` | `26"` | the year is skipped, the size is found |

All 19 cases, positive and negative, are in
`scratchpad/size-test.mjs` and pass.

**What the widening costs:** the leading-position rule was self-limiting, and it is gone. A
whole-name search reads `BRAKE CABLE 26 INCH` and `TUBE 26X1.75` as `26"` quite happily,
because in isolation it cannot tell a wheel from a cable that fits one. **The
`type === "BICYCLE"` gate now carries the weight the regex used to** — which makes the next
finding the important one.

### The finding that actually gates this: `autoType` is wrong on most of the catalog

The same run shows the approve route's type regex — `/\bcycl|bicycl|bike\b/` on the product
name — getting the type wrong in **both** directions:

- **89 of 132 items are classed `ACCESSORY` while plainly being bicycles.**
  `ALLWYN 20T SS BERLIN IBC`, `BSA LADYBIRD HAZEL SS 26T SILKY BLU MTB`,
  `DAUNTLESS 29T GREY MS`, `EMBC/TREX AIR 29T ECLIPSE BLACK`. Every one carries a wheel size
  in its name that the widened parse reads correctly — and every one is skipped, because the
  gate says they are accessories. The name simply never contains the word "cycle".
- **`CYCLE COVER.` and `CYCLE HANDEL STEM` are classed `BICYCLE`.** An accessory and a spare
  part, matched on the word "CYCLE".

So the size work reaches 5 rows where roughly 94 have a size sitting in the name. **The
bottleneck is not the parse, it is the type.** Nothing here is worth tuning further until
`type` is right.

Untouched by this branch — it is a different fix with a different blast radius (`type` drives
the /stock type filter, reorder grouping and every by-type report), and it belongs with
`product-type-and-brand-lead-time-plan.md`, which is already about making `ProductType` real.
`T`/`IBC`/`IC`/`SS`/`MS` in a name are a far stronger bicycle signal than the word "cycle",
and that is the shape of the fix.

**Rules, as specified and as implemented:** `type === "BICYCLE"` only, applied at create time
in both import paths, and it only ever fills a blank.

**Backfill:** `POST /api/products/backfill-size`, behind `stock.edit`, surfaced as a **Fill
Sizes** button that appears only while the *Needs details* filter is on screen — a one-off
correction does not belong next to Export on every visit. Not a migration and not scheduled.

It is safe to press twice, and safe to press while someone is editing: the "size is blank"
test is repeated **on the write**, not just the read, so a size typed between the two is
never overwritten. Bounded at 5 000 rows per run (`hasMore` in the response says to press
again), and grouped by parsed size so N products cost at most one `updateMany` per distinct
wheel size rather than one per product. It reports `unmatched` — bicycles whose name begins
with nothing recognisable — because that is the number that says whether the parse earns its
place.

## 6a. Part E — the bin, which no import can ever fill — **SHIPPED, behind the flag**

**`BIN_TRACKING_ENABLED` is `false`** (`src/lib/inventory-config.ts`). Bin tracking is
dormant by design, not broken: the Bin model and its routes all remain, the bin UI is hidden
everywhere, and inbound / transfers / counts operate on **warehouses**. The original plan
does not mention this, and building Part E visibly would have shipped a control nobody can
see and a filter nobody can act on.

So it is built and gated, exactly like the bin filter already on `/stock`:

- **Bin** joins Category / Brand / Status in bulk assign, wrapped in `BIN_TRACKING_ENABLED`.
- `POST /api/products/bulk` accepts `binId`, validates the bin exists, and **refuses it with
  a 400 while bin tracking is off** rather than accepting it quietly. A binId written in that
  state would be invisible in the UI meant to show it. The client gate is not the only gate.
- `needsDetails` includes `binId: null` **only when the flag is on** — with it off, every
  product would qualify and swamp the filter with rows nobody has a screen to fix.

The moment `BIN_TRACKING_ENABLED` flips to `true`, all three become live together. That is
the whole reason to build it now rather than leave a note.

While rewriting that route it also gained the logger it never had. It rewrites a field on up
to 500 products in one statement and left no record that it ran — "which rows changed, and to
what" is precisely the question asked afterwards.

### The original argument, unchanged


Listed in `zoho-provider-endpoint-registry-plan.md` §8 as "location never written", and it
is a different kind of problem from the three above: **there is nothing to import.** A bin
is a physical shelf in this warehouse; Zoho has never heard of it. No mapping, no detail
call and no parse will produce one.

So the fix is not on the import side at all — it is the same fix-up workflow as Part A.
Add bin to the **Needs details** filter and to the bulk assign that `/stock` already
carries for brand, category and status, so a newly imported batch can be walked to a shelf
in one action rather than one product at a time.

Do **not** invent a placeholder bin to match the brand and category behaviour. `binId` is
nullable precisely so absence can be recorded honestly, and a fake `Unassigned` bin would
show up in every by-bin count and pick list as though it were a real location.

## 7. Part D — the root cause, and why it is not being fixed here

`Product.brandId` and `Product.categoryId` are non-null. That is the reason the import
invents values at all: it has nothing else to write. Making them nullable would let an
import say "unknown" honestly, and the UI could then render absence as absence.

**Not proposed here.** It touches every screen and query that assumes a brand and a category
exist, and it is a schema change that deserves the database architect's review on its own
terms rather than as a side effect of a display fix. Recorded so the next person knows the
placeholders are a symptom of a constraint, not carelessness.

## 7a. Decisions taken at implementation

Four points where the plan as written did not match the code as it stands. Each was put to
the owner before any code was written, and each answer is recorded here because the plan text
above still reads the old way in places.

**1 — Branch base: `refactor/zoho-endpoint-registry`, not `main`.** The plan says off `main`,
but `main` does not contain the code this plan quotes: the approve route's `getBooks()`
factory, `/stock`'s bulk category and status assign, `/more/categories`, or this document.
All of it is on the registry branch, 64 files ahead and not yet merged. Branching off `main`
would have meant implementing against line references that do not exist there and a
guaranteed conflict in both changed files afterwards.

**2 — Scope: Part 0 + A + C + E now, Part B held.** Part 0 is instrumentation *plus a
measurement someone has to run*; only the instrumentation can be written. Part C was brought
forward because a leading-wheel-size parse is correct regardless of Part 0's answer. Part B
was held because its shape — one-line mapping fix, or one Zoho call per item — is precisely
what Part 0 decides.

**3 — Size is written as `26"`, not `26`.** §8 originally expected a bare `26`. Every other
part of this application stores the inch mark: the schema comment
(`size String? // For bicycles: 16", 20", 24", 26", etc.`), `BICYCLE_SIZES` behind the /stock
size filter, the second-hand intake's wheel-size picker, and the product edit field's
`e.g. 26"` placeholder. A bare `26` would have rendered a badge that the size filter — which
sends `26"` and matches exactly — could never select, and would not have matched a single
hand-typed row. §8 below is corrected.

**4 — Part E is built behind `BIN_TRACKING_ENABLED`.** See §6a.

### Found on the way, not fixed, needs your call

`POST /api/products/bulk` is guarded by `requireFeature("stock", "create")`, but `/stock`
gates the **Select** button on `canEdit("stock")` and the operation is an *update* to rows
that already exist. A user holding `stock.edit` without `stock.create` therefore sees the
bulk-assign workflow and gets a 403 from it — which is the whole of Part A's fix-up path, for
exactly the role most likely to be doing the fixing. ADMIN holds both, which is why this has
not bitten yet.

`edit` is almost certainly the correct guard, but changing a permission check widens access
for one set of roles and removes it from another, and that is a decision about who may do
what — not a detail to slip into a display fix. **Left exactly as it was.** The new
`backfill-size` route, having no such precedent to preserve, is guarded on `stock.edit`.

### Raised by the board

**Integration architect — `zoho/import/items/route.ts` bypasses Pull → Preview → Approve.**
It writes straight into `Product` from a Zoho list response with no preview step, which is
the pattern's first red flag ("direct write to production table from Zoho data"). It also
writes `currentStock` from `stock_on_hand`, where the approve path deliberately writes `0`
because the app manages its own stock. Nothing in the UI calls it. This branch touched it
only to keep the two paths' placeholder and size handling identical, and changed neither of
those behaviours. **Whether the route should exist at all is the real question, and it is
not this plan's** — it belongs with Part B, which has to visit the same file anyway.

**Inventory consultant — reassignment moves the reports.** Brand and category drive reorder
grouping (`api/reorder/route.ts` groups by category name) and the by-brand and by-category
stock reports. Walking 151 products out of `Uncategorized` in one bulk action will change
those numbers, in some cases sharply. That is the correction working, not a regression — but
anyone comparing a reorder report across the fix-up should know why it moved.

## 8. Verification

- **Part 0** — *not verified; the measurement has not been run.* The log line is in place and
  fires once per item pull at `LOG_LEVEL=0`. Running it, and writing the answer into §3, is
  the first outstanding item.
- **Part A** — the parser and filter are built and the build type-checks. **Not yet verified
  in the browser** against live data: confirm an `Imported` product renders muted-italic
  beside a real brand, that **Needs details** returns the 151 `Uncategorized` products, and
  that bulk assign moves a selection to a real category and the cards update.
- **Part B** — not built. When it is: import a known item whose brand and category are set in
  Zoho and confirm both land, verified against the Zoho record rather than against the preview.
- **Part C** — parse verified against 19 cases, 11 positive and 8 negative, all passing
  (`scratchpad/size-test.mjs`); the tables in §6 are that run.
  `26''BICYCLE S/S(NYTRO NON-IBC)D/DISC` yields **`26"`** — see decision 3. Measured against
  the real 132-item pull it recovers **5 of 12** type-BICYCLE rows, and would recover ~94 if
  `autoType` were right — see the `autoType` finding in §6, which is the real limit. Still to
  confirm end to end: a real approve writes the size, and **Fill Sizes** populates existing
  rows.
- **Part E** — invisible until `BIN_TRACKING_ENABLED` is `true`, by design. What *is*
  verifiable now: `POST /api/products/bulk` with a `binId` returns 400 while the flag is off.
- **`npm run build` passes** — compiled successfully in 3.8 min, no new warnings (the Prisma
  `package.json#prisma` deprecation notice predates this branch).

## 9. Board of Agents

- **Inventory consultant** — brand and category drive reorder grouping and every stock
  report; a merged or corrected taxonomy changes those numbers.
- **Integration architect** — Part B adds a Zoho call per item; the rate limit and the
  approve batch size are the constraint.
