# A bin audit lists the products its home-bin rules match

Status: completed — 21 Sep 2026, a bin audit lists every active product matching BOTH brand and category of the bin's rules; rules now require brand + category (incomplete ones flagged); on `feat/2109-inbound-bins-audit-fixes`, tsc and lint clean, verified read-only on bch_local (L1 → 90, L2 → 15); owner owes `npm run build` + browser walk.
Follows `2109-inbound-bins-navigation-fixes-plan.md` (built and pushed on
`feat/2109-inbound-bins-audit-fixes`, tip `1c63d83`).

---

## 0. Requirement

### 0.1 The owner's words, verbatim (21 Sep 2026)

> now i need to update this tell me how can i do it like in the stock auditing when i create teh
> stock audit respect to the bin and when sers start the stock audit it will only list the STock
> of selected bin but as of now as i am initilizing the aplication there are lot of product so
> here what we can do is we can list the produst of respected bin like by getting the rules that
> are in that bin like there may be more than one rule like brand and respectde category and i
> must list all those products or else we can just list al the product in the audit listing and
> for the related or audited can be cosider as the in the bin because after the complet physical
> audit at teh first after that we will have the auditing like normla only list the bin items

> no its not happening like that where listing the product based on the rules that are set in
> the bin pls check the code and let me know

> or else i just need to list only the product that the bin holds the rules where the bin hold
> the rule and the rule has brand , category and in the user start the stock it must list all
> those product respecet to that brand and category

Answer to the follow-up question: when a bin already holds stock, what should its audit list?

> list the every matched products that the bin rule hs

Correction, same day:

> no no  the  stock audit listing must match both the  brand and the category not  brand + category rule: products of that brand in that category not  jsy category m not just by brand

### 0.2 Restated as requirements

| # | Requirement |
|---|---|
| R1 | Creating a stock audit for a bin fills its list with every **active** product that matches **both the brand and the category** of one of the bin's rules. A bin with several brand + category rules lists the products of all of them, each product once. **Brand-only, category-only and single-product rules do not list anything** (owner, 21 Sep correction). |
| R2 | This applies to **every** audit of the bin, the first and every later one. It is not an opening-count special case. |
| R3 | A bin with **no rules** starts with an empty list. The counter adds products by search, which exists today. |
| R5 | **A home-bin rule must have both a brand and a category** (Q6a). The rule form and `POST /api/bins/home-rules` refuse anything else. Existing rules of another kind are flagged on `/bins` to fix. Inbound placement and the audit list therefore always agree. |
| R4 | Unchanged: search-to-add, "mark all uncounted as 0", Assembled / Unassembled only in assemblable bins, codes created on approval, and a count changing only its own bin. |

---

## 1. Questions and clarifications

| # | Req | Question | Why it changes the build | Options | Default |
|---|---|---|---|---|---|
| ~~Q1~~ | R1 | **Moot 21 Sep:** only brand + category rules list products, and a warehouse can hold one rule per brand + category pair (saving the pair again moves it, `home-rules/route.ts:161–180`), so a product is listed in at most one bin's audit. Earlier text: ~~A product can match rules on **two bins**, for example a broad "Hero → A1" and a specific "Hero · Cycles › Kids → K1". Which bin's audit lists Hero Kids products? | Otherwise the same product appears in two bins' audits, and a count of 0 in the wrong bin looks like a loss. | (a) **only the bin inbound would put it in**, using the same matcher (`pickHomeBin`: product → brand + category → category → brand) (b) every bin whose rule matches it | — |
| Q2 | R2 | Items in a bin that **no rule covers**, placed there by hand at inbound or added by search, are **not** listed (the owner's answer). Nothing happens to their stock, since unlisted lines are never changed, but they are not re-counted unless added by search. | Confirms the owner accepts that. | (a) accept, as answered (b) also list what the bin holds | **(a)**, per the owner's answer. Raised once in chat on 21 Sep. |
| Q3 | R1 | Only **active** products? | Inactive products are not on shelves. | (a) active only (b) all | **(a)** |
| Q4 | R1 | Which rules count: the bin's rules, **in the bin's warehouse**? | Rules are per warehouse (`HomeBinRule.warehouseId`). | (a) the rules whose `binId` is this bin | **(a)** |
| ~~Q6~~ | R1, R5 | ~~What happens to brand-only / category-only / product rules?~~ **Answered 21 Sep: (a)** — a rule must have **both** a brand and a category (R5). | — | — | — |
| Q5 | R1 | The **brand-count** screen sends its own product list (the brand's products). Keep that as it is? | It is the one screen that already chooses its list. | (a) keep: a brand count lists the brand's products counted, in the chosen bin (b) apply the rules there too | **(a)** |

### 1.1 Decisions on record

| Date | Q | Answer |
|---|---|---|
| 21 Sep 2026 | R1 | **Match both brand AND category.** Brand-only / category-only / product rules list nothing. |
| 21 Sep 2026 | Q6 | **Rules require both a brand and a category** (R5). |
| 21 Sep 2026 | Q2 | The owner: "list the every matched products that the bin rule hs". Rule products only, on every audit. |

---

## 2. How it works today — verified against the code (21 Sep 2026)

- **Rules are not read when an audit is created.** `src/app/api/stock-counts/route.ts:166–193`
  lists either the caller's `productIds` (only the brand-count screen sends them) or
  `getBinQtyMap(bin)`: products with a `BinStock` row or live units in the bin
  (`src/lib/units/bin-qty.ts:22–60`). An empty bin starts with no lines. A search of the
  stock-count routes for `homeBinRule`, `pickHomeBin` or `loadHomeBinRules` finds nothing.
- **Home-bin rules are used only at inbound**: `pickHomeBin` / `matchHomeBin` in
  `src/lib/bins/rule-match.ts:115–150`, with precedence product → brand + category → category →
  brand. `loadHomeBinRules(db, warehouseId)` loads a warehouse's rules (`:89`).
- **A subcategory is mandatory** on a rule when the category has children (plan 2109 Q3,
  `api/bins/home-rules/route.ts:116–127`), and the tree is two levels deep. So a rule's
  `categoryId` equals a product's `categoryId` exactly; no descendant walk is needed.
- The line's system figure already comes from `getBinQtyMap`, so a rule product the bin does not
  hold shows **system 0**.
- `bch_local` has 4 rules, all brand + category (3 on bin L1, 1 on L2), and 5,744 active products (read-only query, 21 Sep).

---

## 3. Implementation plan

One route and one helper. No schema change, no migration, no RBAC change.

- **New helper `src/lib/bins/rule-products.ts`:** `productsForBinRules(db, binId)`.
  - Loads the rules whose `binId` is this bin.
  - Keeps only this bin's rules that have **both** `brandId` and `categoryId` (R1). If there are
    none, it returns `[]`.
  - Finds the active products in one query:
    `status: ACTIVE, OR: [{ brandId, categoryId }, …]`, one pair per rule.
  - Logs at debug `{ binId, rules, products }`.
- **`src/app/api/stock-counts/route.ts` (create):** when the caller sends no `productIds`, the
  list is `productsForBinRules(bin)` (R1, R2). The system figure stays `getBinQtyMap` (0 for a
  product the bin does not hold). The brand-count path is unchanged (Q5a). The Q26 comment is
  updated.
- **R5 — rules need brand + category:**
  - `POST /api/bins/home-rules`: replaces "at least brand, category, or product"
    (`route.ts:106–108`) with "Choose a brand and a category" (400) when either is missing. The
    subcategory-mandatory check stays. The product-rule option is no longer accepted.
  - The rule form in `src/components/bins/bins-manager.tsx`: brand and category are both
    required, and the product field is removed.
  - `GET /api/bins/home-rules` marks existing rules missing a brand or a category as
    `incomplete: true`. The rules list shows them in amber, "Needs a brand and a category — edit
    or delete". On `bch_local` there are none.
  - `pickHomeBin` is left as it is, so any old incomplete rule still places items until someone
    fixes it.
- **Count screen:** no change needed. A long list already works with the existing search and
  Uncounted tabs. The build confirms how the screen behaves with a few hundred lines, and adds
  paging or virtual scrolling only if it is slow.
- **Logging:** info on create `{ stockCountId, binId, lines, fromRules: true }`.

**Board of agents:** inventory consultant (what an audit lists); backend (the query shape, no
N+1).

---

## 4. Verification

- `npx tsc --noEmit`. `npm run build` is run by the owner.
- A script on localhost `bch_local` that always rolls back:
  1. Bin A1 with rules Hero · Kids and Hero · MTB → a new audit lists exactly those products,
     each once, at system 0.
  2. Add a brand-only rule (Hero → A1) → it adds nothing to A1's list. A product of brand Hero in
     a different category is not listed.
  3. A bin with no rules → the audit starts empty.
  4. After approving a count in A1, the next A1 audit lists the same rule products with their
     counted quantities as system figures.
- Browser: create a bin audit and see the rule products listed. Search-to-add and "mark all
  uncounted as 0" still work.

---

## 5. Out of scope

- Listing items a bin holds that no rule covers (Q2, the owner's answer).
- Changing how rules are created, or inbound placement.
- The camera-scan audit (plan 2109 R13).

---

## 6. Build record — 21 Sep 2026

- `src/lib/bins/rule-products.ts`: `productIdsForBinRules(binId)`. Takes the bin's rules that
  have both a brand and a category, then selects active products with
  `OR [{ brandId, categoryId }]` in one query.
- `src/app/api/stock-counts/route.ts`: a bin audit with no caller list is filled from that
  helper. The system figure stays `getBinQtyMap`; `fromRules` is logged.
- `src/app/api/bins/home-rules/route.ts`: POST refuses a rule without both a brand and a
  category ("Choose a brand and a category", 400, warn log). Product rules are no longer
  accepted. GET marks `incomplete` rules.
- `src/components/bins/bins-manager.tsx`: Brand * and Category * are required in the rule form;
  incomplete rules show amber with "delete it and add it again".
- Verified (read-only, `bch_local`):
  - bin **L1** has rules EMOTORAD · 20, EMOTORAD · E CYCLE and ACCESSORIES · Accessories → **90
    products**
  - bin **L2** has rule KIDZ AUTO BHARAT LLP · TOYS → **15 products**
- `tsc --noEmit`: 0 source errors. ESLint on the three files: clean.
- Not done: `npm run build`, browser walk.
