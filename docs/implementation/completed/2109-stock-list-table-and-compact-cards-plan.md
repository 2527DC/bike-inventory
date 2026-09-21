# /stock product list: a table on PC, compact cards on phone

Status: completed — 21 Sep 2026, /stock lists as a sortable table on PC (≥ 1024 px, sort kept in the URL) and compact three-line cards with a ⋮ action menu on phone; on `feat/2109-inbound-bins-audit-fixes`, tsc clean, no new lint findings; owner owes `npm run build` + browser walk at 1366 px and 390 px.

---

## 0. Requirement

### 0.1 The owner's words, verbatim (21 Sep 2026)

> see this screen /stock screen where the product listing is going on can i have the ui of liting
> better like which do u prefer the most the card ot the table listing type where it must be
> usefull and match able for phone sceens to

Screenshot: `docs/asset/image copy.png`. The desktop `/stock` screen shows about **2½ products**
per screen, as tall cards with most of the width empty.

Choice, 21 Sep 2026: **"Table on PC, cards on phone"**, in the preview offered:

```
PC (≥ 1024px)
│ Product              │ Brand · Cat.   │ Bin  │ MRP    │ A / U │ Stock│        │
│ EMBC/VIPER APEX BLU  │ EMOTORAD      │ L1   │ 76,000 │ 2/78  │ 80 ●│ ↻ 🔧 ⊘ │
│ 9173                 │ E CYCLE       │      │        │       │      │        │
  click a row → product details · click a header → sort

PHONE (< 1024px)
│▌EMBC/VIPER APEX BLU        80 │
│▌EMOTORAD · E CYCLE · L1    OK │
│▌₹76,000 · A 2 / U 78    ⋮     │
  ⋮ = the 3 actions in a small menu
```

### 0.2 Restated as requirements

| # | Requirement |
|---|---|
| R1 | At **≥ 1024 px** the list is a **table**, one row per product: Product (name + SKU) · Brand · Category · Bin · Price · Assembled / Unassembled · Stock + status · actions. |
| R2 | At **< 1024 px** each product is a **compact card of three lines**: name + stock; brand · category · bin + status; price · A / U + a **⋮** menu holding the actions. |
| R3 | Clicking a row or card opens `/stock/[id]`, as today. |
| R4 | Clicking a column header **sorts**, and a second click reverses. |
| R5 | Nothing the current card shows or does is lost: placeholder brand/category styling, MRP strike-through, cost (only with `cost_price.view`), reorder level, assembly level, the three actions (Reorder settings, Assembly level, Deactivate / Restore), Select mode with bulk actions, Load more, and Excel / PDF. |
| R6 | The stock colour accent (green / amber / red) stays visible in both layouts. |

---

## 1. Questions and clarifications

| # | Req | Question | Why it changes the build | Options | Default |
|---|---|---|---|---|---|
| Q1 | R1 | Which **secondary facts** get their own column on PC, and which fold into the Product cell as a small second line? Candidates: cost, MRP, reorder level (@ 75 · order 20), assembly level. | Too many columns crowd a 1,280 px laptop. | (a) **Columns:** Product, Brand, Category, Bin, Price, A / U, Stock, actions. **Folded under the name:** reorder level and assembly level. **Under the price:** cost (only for `cost_price` holders) and MRP when it differs. (b) every fact its own column | **(a)** |
| Q2 | R4 | Which columns **sort**? The API sorts only by `name`, `sku`, `currentStock`, `sellingPrice`, `costPrice` (`src/lib/api-utils.ts:99`). | Sorting by brand, bin or A / U would need an API change. | (a) **Product (name), Price, Cost, Stock**; the other headers are plain (b) also brand / category / bin, which needs an API change | **(a)**. The default stays Stock, high → low, as today. |
| Q3 | R2 | The phone **actions**: behind ⋮, or kept as three small buttons? | Three buttons take the third line's width. | (a) **⋮ opens a small menu** with the three actions (b) keep the 3 buttons | **(a)** |
| Q4 | R1 | The breakpoint: **1024 px** (`lg`)? Tablets in portrait (768 px) would get cards. | Decides what an iPad sees. | (a) **1024 px** (b) 768 px | **(a)** |
| Q5 | R4 | Remember the chosen sort after a reload? | Small, but noticeable. | (a) **yes, in the URL** (`?sort=stock&dir=desc`, replace not push) (b) no | **(a)** |

### 1.1 Decisions on record

| Date | Q | Answer |
|---|---|---|
| 21 Sep 2026 | — | **Table on PC (≥ 1024 px), compact cards on phone.** |
| 21 Sep 2026 | Q1–Q5 | **Go with defaults** (owner): folded secondary facts, sort Product/Price/Cost/Stock, ⋮ menu on phone, 1024 px, sort kept in the URL. Build with parallel agents. |

---

## 2. How it works today — verified against the code (21 Sep 2026)

- `src/app/(dashboard)/stock/page.tsx` is 1,231 lines. The list is `:740–958`: one `Card` per
  product in a `Link` to `/stock/[id]`, or a `div` toggling selection in Select mode (`:938–946`).
- The card shows the following, in order:
  - name (2-line clamp, `:774–779`)
  - SKU, and brand and category chips, with placeholders muted and italic (`:780–824`)
  - price: selling, MRP struck when it differs, cost when `showCost` (`:830–843`)
  - bin (`:844–848`)
  - reorder @ level · order qty, only when set (`:852–857`)
  - Assembled / Unassembled / No assembly, only when any units exist (`:861–870`)
  - assembly level, only when set (`:873–878`)
  - stock number and badge (`:881–882`)
  - three `RowBtn` actions, gated by `mayReorder`, `mayAssemblyLevel` and `mayDeactivate`
    (`:885–932`), hidden in Select mode
- The left accent comes from `getStockAccent(p)`, and the colours from `getStockColor` /
  `getStockBadge`.
- Fetch: `PAGE_SIZE` rows at a time, `sortBy=currentStock&sortOrder=desc` hard-coded (`:329`),
  Load more (`:949–955`). The Low-stock chip filters client-side (`:456`).
- Sorting is server-side: `/api/products` accepts `sortBy` from `ALLOWED_SORT`
  (`api-utils.ts:99`). `currentStock` is sorted in code on the scoped number
  (`products/route.ts:181–184`); the others use `orderBy`.

---

## 3. Implementation plan

Front end only. **No API change** under Q2a, and no schema or RBAC change.

- **Extract the row data** into one mapping, `stockRowView(p)`, with the labels, colours and flags
  already worked out, so the table row and the card cannot drift apart.
- **New `src/app/(dashboard)/stock/_components/stock-table.tsx`** (shown at `lg` and above):
  - `<table>`, sticky header, `tabular-nums` on numbers.
  - Row click → `router.push(/stock/[id])`.
  - The action buttons stop propagation.
  - Select mode puts a checkbox in the first column.
  - Headers from Q2 are buttons with an arrow and `aria-sort`.
- **New `stock-card.tsx`** (below `lg`): the three-line card, the left colour accent, and the ⋮
  menu (Q3).
- **`page.tsx`:**
  - Renders both behind `hidden lg:block` / `lg:hidden`, with a single list of data.
  - Keeps `sortBy` / `sortOrder` in state and in the URL (Q5), and passes them to the fetch that
    is hard-coded today (`:329`). A sort change resets to page 1.
  - Select mode, bulk actions, Load more, Excel / PDF, and the sheets are unchanged.
  - The old inline card JSX is removed, which shrinks `page.tsx`.
- **Logging:** `log.debug` on a sort change `{ sortBy, sortOrder }`.
- **Board of agents:** frontend engineer (responsive layout, loading/empty states, accessibility
  of a table with row links).

---

## 4. Verification

- `npx tsc --noEmit`. `npm run build` is run by the owner.
- Browser, at 1366 px:
  - the table shows about 12–15 rows
  - a header click sorts and flips
  - a row click opens the product
  - the actions work without opening the product
  - Select mode ticks rows
- At 390 px (phone): three-line cards, and ⋮ opens the actions. There is no sideways scroll.
- A user without `cost_price.view` sees no cost in either layout.

---

## 5. Out of scope

- A per-user choice of table or card (the owner chose automatic).
- Sorting by brand, category or bin (Q2b needs an API change).
- Any change to filters, chips, search or the export.

---

## 6. Build record — 21 Sep 2026

Built by two parallel agents (table, card) against a shared contract written first, with
`page.tsx` wired by the orchestrator.

- **`_components/stock-row.tsx`** (the contract): `StockProduct`, `stockColor` / `stockBadge` /
  `stockAccent`, `formatInr`, `hasUnits`, `StockSort` / `StockSortKey` / `DEFAULT_STOCK_SORT`, and
  `StockRowContext` (permissions, select mode, busy row, action callbacks, `hrefFor`).
- **`_components/stock-table.tsx`:**
  - Columns: [select] · Product (name as a link, then SKU / reorder / assembly on a muted line) ·
    **Brand · Category** stacked in one column, as in the owner's preview · Bin · Price (MRP
    struck) · Cost (only with `cost_price`) · A / U (+ NA) · Stock + badge · actions.
  - Sortable headers are Product, Price, Cost and Stock, each a `<button>` with `aria-sort`.
  - Row click opens the product; action clicks stop propagation.
  - Sticky header from 1280 px. **Between 1024 and 1279 px the table scrolls sideways inside its
    own box.** The ~720 px content area beside the sidebar cannot fit every column, and the page
    itself never scrolls sideways.
- **`_components/stock-card.tsx`:**
  - Line 1: name + stock. Line 2: **SKU** · brand · category · bin + badge. Line 3: price / MRP /
    cost · A / U · ⋮. An optional muted line 4 shows reorder and assembly level.
  - ⋮ opens a menu with only the permitted actions. It closes on an outside click, Escape, or a
    choice, and every click stops propagation.
  - The SKU was added back after the agent's first cut left it off (R5).
- **`page.tsx`** (1,231 → 1,027 lines):
  - The type and colour helpers moved to the contract. Sort state is read from `?sort=&dir=`, and
    `changeSort` writes it back with `history.replaceState`. The same column flips the order; a
    new column starts names A→Z and numbers high→low.
  - The fetch uses the sort, and the existing effect reloads page 1.
  - One `rowCtx` object is built, and the page renders `hidden lg:block` table + `lg:hidden`
    cards. Select all, bulk actions, Load more, export and the sheets are unchanged.
  - The old card JSX, `formatCurrency` and `RowBtn` were removed.
- `tsc --noEmit`: 0 source errors. ESLint on the stock screen: 0 errors and 2 warnings, both
  already on `main` (the unused `session`, and the ternary statement in `toggleSelect`).
- Not done: `npm run build`, browser walk.
