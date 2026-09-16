# Reorder moves inside Purchase Orders; a new PO pulls the vendor's below-level items at their reorder quantity

Status: completed — 16 Sep 2026, `/reorder` is now the Reorder tab of `/purchase-orders` (the old route 307s, catalog `route: null`), New PO gained "Add reorder items" offering the vendor's at-or-below-level products at their reorder quantity, and `/stock/[id]` gained a Reorder card. Committed `efb1e0c` on `feat/remove-static-team-health`; tsc + eslint clean, query verified on `bch_local`. Still owed by the owner: `npm run build`, the §4 browser walk and `npm run db:seed:rbac`.
Branch: **`feat/remove-static-team-health`** (Q0).

Every `file:line` below was read from disk on 15 Sep 2026. The data counts in §2.1 were
queried from local `bch_local` the same day. Check them rather than trust them.

---

## 0. Requirement

### 0.1 The owner's words, verbatim (15 Sep 2026)

> i need u to create a implmenation where /reorder screen in the  purchase order sressn where the reorder for the product will be done in the /stock screen or insid the item details where    it must be invokend or utilized that is we provide the   redored  level and the reorder quantity  where this must be usefull for me where if in the new purchare order screen while creating the new purchase order what must happen is that when i select the vendor and it must also search  think that it must get the first 10 data where like pagenation while creating the new purchase order like when i selct the vendor if any product is attached to that vendor with the product of the reorder i need to get that item in the po list where with the quantity where i have mentioned in the reorder quantity and only i must see the reoreder item  only when its bellow the reorder level   this is my requiremnt and i also want to shift the /reorder screen inside the p op/purchase-orders screen lets have the top navigation bar  and  its listing   give me the implmenation plan for this and ask me any doubts if u have  on this  wrie the implmenation plan like fist it must list the requiremnt and afterthat the question that u need for clarification and  and the plan

### 0.2 Restated as requirements

| # | Requirement | Part |
|---|---|---|
| R1 | A product's **reorder level** and **reorder quantity** are entered on `/stock` (the list) or on the product's **details page** (`/stock/[id]`). | C |
| R2 | On **New Purchase Order**, choosing a **vendor** brings up the reorder items for that vendor: the products **attached to that vendor**. | A |
| R3 | A product appears there **only when its stock is below its reorder level**. | A |
| R4 | Each one comes in with the quantity = the product's **reorder quantity**. | A |
| R5 | Those items go into **the PO's list of lines**. | A |
| R6 | The list can be **searched** and loads **10 at a time** (pagination). | A |
| R7 | The `/reorder` screen **moves inside `/purchase-orders`**, behind a **top navigation (tab) bar**, and keeps its **listing**. | B |
| R8 | (process) The plan lists the requirement first, then the questions, then the build. | — |

---

## 1. Questions and clarifications — answer before build

Each of these changes what gets built. Every question has a recommended default, so you can
reply "defaults" in one word. For anything else, give the number and your answer.

| # | Question | Why it changes the build | Options | Recommended default | **Answer** |
|---|---|---|---|---|---|
| **Q0** | Which branch does this go on? | You are on `feat/remove-static-team-health` with 4 uncommitted files. One of them is `purchase-orders/page.tsx` (a loading refactor), and this plan edits that file. | (a) a new branch off this branch's tip, after those 4 files are committed; (b) a new branch off `origin/main` | (a) — otherwise the PO list page conflicts with itself | |
| **Q1** | **Nothing is set up yet.** On `bch_local`, **0 of 5,744** active products have a reorder level, 0 have a reorder qty, 0 have a reorder vendor, and `brand_vendors` has 0 rows (§2.1). After the build, the new-PO panel will be **empty for every vendor** until those are entered. Is that expected? | Decides whether this plan also gives you a quick way to enter them for many products at once. | (a) yes — enter them per product with the existing `/stock` sheet; the bulk bar already sets the vendor for many rows; (b) also add **level + qty** to the `/stock` bulk bar (select rows → set level 5, qty 10); (c) an Excel import of level/qty/vendor | (a). Say (b) if you have hundreds to enter | |
| **Q2** | What does "**product attached to that vendor**" mean? | The PO create API **already refuses** a product that resolves to a different vendor (`create.ts:184-217`). The panel must use the same rule, or it will offer items that Create then rejects. | (a) the app's existing rule: the product's own **reorder vendor**; if none, the **brand's primary vendor**; if none, the **brand's only vendor** (`resolve-vendor.ts:103-148`); (b) only the product's own reorder vendor | (a) | |
| **Q3** | "**Below** the reorder level" — strictly below, or **at or below**? | Every screen in the app uses **at or below** (`lib/reorder.ts:53-55`): the `/stock` Low badge, the `/reorder` Low filter, the dashboard. | (a) at or below (`stock ≤ level`); (b) strictly below (`stock < level`) — this panel would then disagree with `/stock` | (a) | |
| **Q4** | Stock counted **across the whole business**, or **per store**? | A reorder level is one number per product, and a PO has **no store** (`schema.prisma:1066-1083` has no `storeId`). | (a) whole business — `Product.currentStock`, all stores and warehouses; (b) per store — needs a store picker on the new-PO screen and per-store levels (a schema change) | (a) | |
| **Q5** | A product is below its level but its **reorder qty is 0** (not set). What quantity? | 0 is the column default, so it means "nobody chose one". | (a) order up to the level (`level − stock`, at least 1). This is the existing `suggestedOrderQty` rule (`lib/reorder.ts:70-72`); the row says "qty not set"; (b) leave the product out of the panel; (c) show it with the qty box empty, to be typed | (a) | |
| **Q6** | How do the items reach the PO lines? | "Get that item in the PO list" could mean added automatically, or offered for you to pick. | (a) a **"Below reorder level" panel** under the vendor picker: 10 rows per page, a search box, a tick box on each row with the qty filled in (editable), then **"Add N to order"**. Nothing is added until you press it; (b) **all** of the vendor's below-level items are added as lines the moment you pick the vendor; the panel is only for paging/searching | (a) — with (b), a vendor with 60 low items puts 60 lines on the order before you have looked at one | |
| **Q7** | A below-level product is **already on an open PO** for this vendor (Draft → Partially received). What should happen? | Create refuses it with a 409 (`create.ts:251-257`, `duplicates.ts:58-86`). | (a) show it greyed out, "on PO-0012 · sent", and don't let it be ticked; (b) hide it; (c) show it normally and let the 409 catch it | (a) | |
| **Q8** | Where does the Reorder listing live? | Decides the URL and which files move. | (a) **`/purchase-orders?tab=reorder`** — one page, top tab bar **Orders \| Reorder**; `/reorder` redirects there; (b) **`/purchase-orders/reorder`**, its own route, with the same tab bar drawn on both pages | (a) | |
| **Q9** | The **sidebar** entry "Reorder & AI Insights". | Moving the screen inside Purchase Orders makes a separate entry a second door into the same place. | (a) remove it (catalog `route: null`; the module stays, so the permission still works) and rename the module to "Reorder"; (b) keep an entry that opens the tab | (a) | |
| **Q10** | Who sees the **Reorder tab**? | Today `/reorder` needs `reorder.view` (`api/reorder/route.ts:13`). | (a) `reorder.view` — same as today, nobody gains or loses access; (b) `purchase_orders.view` | (a) | |
| **Q11** | The Reorder listing today has **inline "Reorder Level" boxes and a Save Levels button** (`reorder/page.tsx:460-470, 327-333`). R1 says levels are entered on `/stock` or the details page. | Keeping them means three screens set the same number. | (a) remove inline editing; each row gets the same **Reorder settings** button `/stock` has, which opens the same sheet (level, qty, vendor); (b) keep it as it is; (c) listing only — no way to edit from the tab | (a) | |
| **Q12** | The listing's **default filter**. | Today it opens on **All**: every active product (5,744), in one request, with no paging. | (a) open on **Low stock**; (b) keep **All** | (a) | |
| **Q13** | The **details page** (`/stock/[id]`). Today reorder level/qty/vendor are fields inside the big product **Edit** form (`stock/[id]/page.tsx:384-407`), and the read view shows only the level (`:491-494`). | Decides whether there is one way to set them on that page or two. | (a) add a **Reorder** card to the details page (level, qty, vendor, Low/OK) with a **Set** button that opens the same sheet (`reorder.edit`); leave the Edit form fields as they are; (b) the same card, **and** remove the three fields from the Edit form | (a) — removing them takes the level away from roles that hold `stock.edit` without `reorder.edit` (`api/products/[id]/route.ts:80-83`) | |
| **Q14** | The listing's existing **tick → Create PO** (several vendors at once, `reorder/page.tsx:154-186`). | Still useful for "order everything low"; the new panel handles one vendor at a time. | keep / remove | keep, unchanged | |

### 1.1 Decisions on record

Asked one at a time, 15 Sep 2026.

| # | Decision | Date |
|---|---|---|
| Q0 | **Build on `feat/remove-static-team-health`** — no new branch. The 4 uncommitted files stay the owner's; this plan's commit stages only its own files, and `purchase-orders/page.tsx` is edited on top of the uncommitted refactor already in the tree. | 15 Sep 2026 |
| Q1 | **One by one.** Levels and quantities are entered per product with the existing `/stock` row button (`ReorderSheet`); no bulk level/qty action and no import. | 15 Sep 2026 |
| Q2 | **(b) the product's own reorder vendor only.** Owner's words: *"the product where the product are attavjed by the vendor at the time of reorder those products"* — the vendor attached in the product's reorder settings (`Product.reorderVendorId`). Brand ↔ vendor links (`brand_vendors`) are **not** used for this list. A1 collapses to `reorderVendorId = V` (V active); step 1 and the brand `OR` are dropped. No clash with PO save: a product whose reorder vendor is V resolves to V at tier 1 of `resolveVendors` (`resolve-vendor.ts:105-110`), so `verifyVendorSupplies` accepts it. | 15 Sep 2026 |
| Q3 | **(a) at or below** — `currentStock <= reorderLevel` with `reorderLevel > 0`, the existing `isLowStock` rule (`lib/reorder.ts:53-55`). Level 5, stock 5 → shown. The modal and the `/stock` Low badge agree. | 15 Sep 2026 |
| Q4 | **(a) total of all stores** — `Product.currentStock` (the cached sum of every `StockLevel`) against the product's one `reorderLevel`. No store picker, no per-store level, no schema change. | 15 Sep 2026 |
| Q5 | **The modal carries `reorderQty` exactly as set — 0 when it was never set.** Owner's words: *"by default let it be 0 only where at the time of po we can change the quantity as needed"*. So `suggestedOrderQty`'s "up to the level" fallback is **not** used here; qty = `Product.reorderQty`. A 0 line can be added to the PO. Because PO save refuses it (`quantity: z.number().int().min(1, "Quantity must be at least 1")`, `validations.ts:469`), the new-PO screen marks every 0-qty line "set a quantity" and keeps Submit / Save disabled until each line is ≥ 1. The server rule is unchanged. Not a question: the screen must not let a person press a button the API will refuse. | 15 Sep 2026 |
| Q7 | **(a) shown greyed, not tickable, "on PO-0012 · sent"** with a link to that PO — when the product is on an open PO (`OPEN_PO_STATUSES`, `duplicates.ts:80`) for the same vendor. | 15 Sep 2026 |
| Q6 | **A button that opens a modal**, beside the AI sheet upload — not an inline panel, not auto-added. Owner's words: *"when i selcet the vendor in po i must be able to add the item for the po through the ai and also have a button where on clicking it it must get me that vendor matched product at the time of reorder where it must list me a model with the list of the products and the related quantity where that reorder quantity must be taken in th po and even i must be able to ad the item in the po from ai the vendors reorder product be if the product goes below the reorder level"*. So: after the vendor is chosen, the manual section offers **both** the AI sheet upload (unchanged) **and** an "Add reorder items" button; the modal lists that vendor's below-level products with their reorder quantity (10 per page, searchable — R6); the ticked ones become PO lines at that quantity. **§3 A3 is rewritten from panel to modal once all questions are answered.** | 15 Sep 2026 |
| Q8 | **(a) `/purchase-orders?tab=reorder`** — one page, top tab bar **Orders \| Reorder**; the tab is read from and written to the URL; `/reorder` redirects there (B3); the dashboard tiles link there (B4). | 15 Sep 2026 |
| Q9 | **(a) remove the sidebar entry.** Catalog `reorder` module: `route: null`, `label: "Reorder"` (B5); the module and its `view` / `edit` actions stay, so no grant moves. Owner runs `npm run db:seed:rbac` after the deploy; the `navTabs` count query in B5 runs on production first. | 15 Sep 2026 |
| Q10 | **(a) `reorder.view`** shows the Reorder tab — the grant that opens `/reorder` today (`api/reorder/route.ts:13`); nobody gains or loses access. The Orders tab stays on `purchase_orders.view`; with only one of the two granted, no tab bar. | 15 Sep 2026 |
| Q11 | **Keep both** (owner: *"keep both"*). The inline Reorder Level box on each row and the Save Levels bar stay as they are today (`reorder/page.tsx:102-130, 327-333, 460-470` → `PUT /api/reorder/update-levels`), **and** every row also gets the `/stock` Reorder settings button opening the same `ReorderSheet` (level, qty, vendor), which the page already mounts for "No vendor · Set" (`:246-253, 441-449`). Builder detail: a sheet save clears any unsaved inline edit for that product before the refetch, so the two cannot fight over one row. | 15 Sep 2026 |
| Q12 | **(a) the Reorder tab opens on Low stock.** Total / Zero stay one tap away. `GET /api/reorder` is unchanged. | 15 Sep 2026 |
| Q0 (again) | Owner, mid-questions: *"change it implment the implmentaion in the same branch"* — confirms Q0: build on `feat/remove-static-team-health`, and proceed to implementation once the remaining questions are answered. | 15 Sep 2026 |
| Q13 | **(a) a Reorder card on `/stock/[id]`** — level, qty, vendor, Low/OK, and a Set button (`reorder.edit`) opening `ReorderSheet`. The Edit form keeps its three fields. | 15 Sep 2026 |
| Q14 | **Keep** the Reorder tab's tick → Create PO (multi-vendor, `/api/purchase-orders/prepare`), unchanged. | 15 Sep 2026 |

---

## 2. How it works today — verified against the code

### 2.1 The data

| Where | What |
|---|---|
| `Product.reorderLevel`, `reorderQty` | `Int @default(0)` — `prisma/schema.prisma:558-559`. 0 means "not set". |
| `Product.reorderVendorId` | nullable FK to `Vendor` — `:576-577`, indexed `:605`. |
| `@@index([status, currentStock])` | `:608` — serves a "low stock" filter. |
| `Category.reorderLevel` | `:478` — exists; **not read** by `lib/reorder.ts`. Not used by this plan. |
| `PurchaseOrder` | `:1066-1083` — vendor, status, dates. **No store.** |

**Local `bch_local`, queried 15 Sep 2026:**

| Count | Value |
|---|---|
| active products | 5,744 |
| with `reorderLevel > 0` | **0** |
| with `reorderQty > 0` | **0** |
| with `reorderVendorId` set | **0** |
| below level (any vendor) | **0** |
| `brand_vendors` rows | **0** |
| active vendors | 57 |
| stores | 2 |
| open POs | 2 |
| users with `/reorder` pinned in the bottom nav | 0 |

So today the feature has **nothing to show** until levels and vendors are entered (Q1). This is
the local restore. **Production must be counted the same way before the deploy** (§4, item 0).

### 2.2 The two rules everything uses

- **Low:** `isLowStock` = `reorderLevel > 0 && currentStock <= reorderLevel` — `src/lib/reorder.ts:53-55`.
  On hand, not available. The dashboard counts available stock instead, a known and filed
  disagreement (`:15-20`).
- **Qty:** `suggestedOrderQty` = `reorderQty || max(1, reorderLevel − currentStock)` — `:70-72`.
- **Vendor:** `resolveVendors` — `src/lib/purchase-orders/resolve-vendor.ts:62-158`. Tier 1 is the
  product's `reorderVendorId`, if that vendor is active. Tier 2 is the brand's single
  `isPrimary` vendor. Tier 3 is the brand's only vendor. Anything else is `NO_VENDOR` /
  `AMBIGUOUS` (`:103-148`). The file itself warns that `brand_vendors` is empty (`:47-56`).

### 2.3 Where reorder level and qty are entered today — R1 is mostly built already

| Place | How | Guard |
|---|---|---|
| `/stock` row button | `RefreshCw` button → `ReorderSheet` (`stock/page.tsx:797-806, 869-874`), patched in place (`:386-399`). The row shows "Reorder @ N · order M" (`:774-779`). | `canEdit("reorder")` (`:130`) ↔ `PUT /api/products/[id]/reorder`, `reorder.edit` (`products/[id]/reorder/route.ts:42`) |
| `/stock` bulk bar | sets **vendor only** on many rows (`stock/page.tsx:222-224, 948-951, 1066-1077`) → `api/products/bulk` | `reorder.edit` when the field is present |
| `/stock/[id]` Edit form | level, qty and vendor fields (`stock/[id]/page.tsx:384-407`) → `PUT /api/products/[id]`. The save uses raw `fetch(...).json()` (`:256-264`) | `stock.edit` (`api/products/[id]/route.ts:66`); the vendor also needs `reorder.edit` (`:84-90`); level/qty need only `stock.edit`, a deliberately kept inconsistency (`:80-83`) |
| `/stock/[id]` read view | shows the **level only** (`:491-494`) — not the qty, not the vendor | — |
| `/reorder` inline boxes | level only + Save Levels (`reorder/page.tsx:102-130, 460-470`) → `PUT /api/reorder/update-levels` | `reorder.edit` (`update-levels/route.ts:33`). The same route is also called by the brand-count wizard (`stock-audit/brand-count/page.tsx:397`) |

`ReorderSheet` (`src/components/reorder-sheet.tsx:56-291`) is the one component that edits all
three fields together. It lazy-loads vendors (`:79-103`) and hides the vendor picker when the
role cannot list vendors.

### 2.4 The `/reorder` screen

- **Page** `src/app/(dashboard)/reorder/page.tsx` (507 lines). It loads with raw
  `fetch().then(r => r.json())` (`:79-80`) and a bare `.catch(() => {})` (`:88`); both are
  CLAUDE.md violations. Group by brand / category / vendor; filter all / low / zero, default
  **all** (`:59`). The row shows the resolved vendor or a "No vendor · Set" button → `ReorderSheet`
  (`:435-450`). Tick → **Create PO** hands `{productId, quantity}` to `/purchase-orders/new`
  via `sessionStorage` (`:154-186`). WhatsApp share (`:188-233`).
- **API** `GET /api/reorder` (`src/app/api/reorder/route.ts`): guard `reorder.view` (`:13`), cost
  gated (`:18`). It loads **every active product** with no paging (`:39-57`) and applies the low
  filter **in memory** (`:59-62`) under the comment "Prisma cannot compare two columns". **That
  comment is out of date:** Prisma 6.19 generates field references
  (`node_modules/.prisma/client/index.d.ts:28263`, `readonly fields: ProductFieldRefs`), so
  `currentStock: { lte: prisma.product.fields.reorderLevel }` runs in the database. Part A depends
  on this.
- **Ways in:**
  - The sidebar, which is built from `modules.route`. The catalog has `route: "/reorder"`,
    group Purchase (`prisma/rbac-catalog.ts:394-402`). The sidebar and the More page both skip a
    module with no route (`app-sidebar.tsx:157`, `more/page.tsx:72`).
  - The bottom nav, which pins by route (`use-bottom-nav.ts:59-60`, `User.navTabs`
    `schema.prisma:391`).
  - Two dashboard tiles (`(dashboard)/page.tsx:357, 891`).
  - `db:seed:rbac` writes each module's `route` from the catalog on every run
    (`seed-rbac.ts:80, 115`).

### 2.5 The New Purchase Order screen

- The **manual section** has the vendor `<select>` (`new/_components/vendor-section.tsx:130-147`).
  Its lines come **only from an uploaded vendor sheet** (`new/page.tsx:91-98, 434-452`). This is
  plan 0909's R3, "no product search on this screen". **This plan deliberately adds a second
  source of lines to that section.**
- A line is `{ key, name, quantity, productId? }` (`vendor-section.tsx:19-26`). `productId` is set
  only by the `/reorder` handoff today (`new/page.tsx:49-60, 163-226`) and is POSTed as is
  (`:276-280`).
- The **server** re-checks every linked line:
  - `verifyVendorSupplies: true` (`api/purchase-orders/route.ts:89-94`) refuses a product that
    resolves to another vendor (`lib/purchase-orders/create.ts:184-217`).
  - The duplicate rule refuses a product already on an open PO for the vendor (`create.ts:251-257`).
- The hint under a blocked section reads "Add at least one item from a sheet to continue"
  (`vendor-section.tsx:283-287`).

### 2.6 The `/purchase-orders` list

A single list with no tabs (`purchase-orders/page.tsx:108-241`). It has an **uncommitted**
refactor in the working tree that derives `loading` from the request key (Q0). A top tab bar
already exists in the house style: `assembly/page.tsx:526-560` (`role="tablist"`, scrolls
sideways on a phone, count badge, 44 px buttons).

### 2.7 Gaps against the requirement

| # | Gap | R |
|---|---|---|
| G1 | New PO cannot pull a vendor's below-level products at all; its only line source is a sheet. | R2–R6 |
| G2 | Reorder is its own screen and sidebar entry. | R7 |
| G3 | The details page does not show the reorder qty or vendor, and has no quick way to set them outside the full Edit form. | R1 |
| G4 | The reorder screen breaks the logging rules (raw `.json()`, bare catch). It is fixed because the file is being moved anyway. | — |

---

## 3. Implementation plan

**No migration. No new permission. No cron.** One RBAC catalog edit (B5), which means
`npm run db:seed:rbac` after the deploy.

### Part A — the vendor's below-level items on New Purchase Order (R2–R6)

> **Rewritten to the answers (15 Sep 2026) — this box overrides A1–A3 below where they differ.**
>
> - **Match (Q2 b):** `where = { status: ACTIVE, reorderVendorId: V, reorderLevel > 0, currentStock <= fields.reorderLevel, search }`. V must be an active vendor (400 otherwise). No brand lookup, no `resolveVendors` cross-check — a product whose reorder vendor is V resolves to V at tier 1, so PO save's vendor check always accepts it.
> - **Low (Q3 a, Q4 a):** at or below, `Product.currentStock` across all stores.
> - **Qty (Q5):** `quantity = reorderQty` exactly — **0 when unset**. `suggestedOrderQty` is not used. No `qtySource`.
> - **Already ordered (Q7 a):** `openPo { id, poNumber, status }` on the row; greyed, not tickable.
> - **UI (Q6):** not an inline panel. The manual section shows, once a vendor is picked, the AI sheet upload (unchanged) **and** an **"Add reorder items"** button. It opens a **modal** (`reorder-items-modal.tsx`, the `ReorderSheet` shape: bottom sheet on a phone, centred card from `sm:`) listing the vendor's below-level products, 10 per page, Prev/Next, a search box, a tick per row with the qty (editable, starts at `reorderQty`), and **"Add N to order"**. Ticks survive paging.
> - **Zero-qty lines (Q5):** a PO line with qty 0 is outlined amber with "Set a quantity"; Submit / Save / Create all are disabled while any line of that section is below 1, with the reason under the buttons. The server rule (`validations.ts:469`, min 1) is unchanged.
> - **Vendor change:** reorder lines (those carrying `productId` on the manual section) are removed after a confirm.
> - **Route:** `GET /api/purchase-orders/reorder-items?vendorId&page&limit&search`, `purchase_orders.create`, limit default 10, max 50.

#### A1 — `src/lib/purchase-orders/reorder-suggestions.ts` (new, server-only)

One function, `findReorderSuggestions({ vendorId, search, page, limit })`, that pages in the
database.

```
1. brands that resolve to V (mirrors resolve-vendor.ts tiers 2–3):
     linked   = brandVendor.findMany({ vendorId: V })              → brandIds
     all      = brandVendor.findMany({ brandId in linked, vendor.isActive })
     per brand: exactly one primary and it is V         → include
                no primary and exactly one vendor, V    → include
2. where = status ACTIVE
         AND reorderLevel > 0
         AND currentStock <= prisma.product.fields.reorderLevel        (Q3 a)
         AND ( reorderVendorId = V
               OR ( (reorderVendorId IS NULL OR reorderVendor.isActive = false)
                    AND brandId IN brandSet ) )                        (Q2 a)
         AND (search → name / sku contains, insensitive)
3. [total, rows] = count(where), findMany(where, orderBy name, skip, take)
4. cross-check: resolveVendors(rows); a row that does not resolve to V is dropped
   and log.warn'ed. This should never happen, and it keeps the panel and
   create.ts's verifyVendorSupplies from ever disagreeing.
5. openPo: one PurchaseOrderItem query for the page's productIds on V's open POs
   (reuse OPEN_PO_STATUSES from duplicates.ts; export it if it is not exported)  (Q7)
6. quantity = suggestedOrderQty(p); qtySource = reorderQty > 0 ? "REORDER_QTY" : "UP_TO_LEVEL"   (R4, Q5 a)
```

Q2 = (b) collapses step 1 and the `OR` to `reorderVendorId = V`. Q5 = (b) adds
`reorderQty > 0` to `where`.

#### A2 — `GET /api/purchase-orders/reorder-suggestions` (new)

- Guard `requireFeature("purchase_orders", "create")`, the same as `prepare`
  (`prepare/route.ts:39`). This is a helper for creating a PO, not the Reorder screen.
- Zod query: `vendorId` required, `page ≥ 1`, `limit` 1–50 (default **10**, R6),
  `search` optional. An unknown or inactive vendor returns a 400 with a sentence.
- Response:

  ```
  { items: [{ productId, sku, name, currentStock, reorderLevel, reorderQty,
              quantity, qtySource, openPo: { id, poNumber, status } | null }],
    total, page, limit, hasMore }
  ```

  No cost price anywhere: a PO carries no money (plan 1509-po-product-and-quantity-only).
- Logger `purchase-orders:reorder-suggestions`: `debug` for the request and the counts, `error`
  on failure with `vendorId`.

#### A3 — the panel: `purchase-orders/new/_components/reorder-suggestions.tsx` (new)

Mounted in the **manual section**, above `SheetImport` (`new/page.tsx:434-452`), once a vendor is
chosen. It is keyed on `vendorId`, so choosing another vendor starts it fresh.

```
Below reorder level · 23 items                         [ search name or SKU      ]
┌──────────────────────────────────────────────────────────────────────────────┐
│ ☑ Hero Sprint 26T            SKU H-S26   stock 2 · level 5      qty [ 10 ]  │
│ ☑ Hero Kid 16T               SKU H-K16   stock 0 · level 3      qty [  3 ]  │
│                                              qty not set — up to the level    │
│ ☐ Hero Ranger 24T (greyed)   on PO-0012 · sent                                │
│ ✓ Hero Jet 20T               already on this order                           │
└──────────────────────────────────────────────────────────────────────────────┘
[ Select all on this page ]            ‹ Prev   Page 1 of 3   Next ›
[ Add 2 to order ]
```

- 10 per page with Prev / Next (R6). Ticks and edited quantities are kept across pages in a
  `Map<productId, qty>`. The search box uses `useDebounce`.
- **Add** merges into the manual section's lines as `{ key: productId, productId, name, quantity }`.
  It skips a product already on the order, and skips a line whose normalised name matches an
  existing sheet line, saying which ones it skipped.
- **Changing the vendor** after reorder lines were added asks for confirmation first, then removes
  those lines. They belong to the old vendor, and the server would refuse them
  (`create.ts:184-217`).
- States:
  - loading: a skeleton;
  - error: `ErrorBanner` with Retry;
  - empty: *"No products for <vendor> are below their reorder level. Levels are set on Stock."*
    with a link to `/stock`.
- `apiTry`, never raw `.json()`. Logger `purchase-orders:reorder-panel`.

Q6 = (b) instead: on vendor select, fetch every page and add all of them. Keep the panel for
review.

#### A4 — small edits so the rest of the screen agrees

- `vendor-section.tsx:283-287`: the hint becomes "Add items from the reorder list or a sheet".
- `vendor-section.tsx:19-26` and the `new/page.tsx:49-60, 91-98` comments: `productId` now comes
  from the handoff **or** the panel.
- Submit is unchanged; `productId` is already sent (`new/page.tsx:276-280`).

### Part B — Reorder moves into `/purchase-orders` (R7)

#### B1 — tab bar on `purchase-orders/page.tsx`

- A top tab bar, **Orders | Reorder**, in the `assembly/page.tsx:526-560` pattern.
- The tab lives in the URL (`?tab=reorder`, via `useSearchParams` + `router.replace`), so the
  dashboard and the redirect can land on it. **Read `node_modules/next/dist/docs/` on
  `useSearchParams`** first. A client page that reads it may need a `<Suspense>` boundary to
  prerender.
- Tabs follow permissions: Orders if `canView("purchase_orders")`, Reorder if `canView("reorder")`
  (Q10). If only one is granted, no bar is shown.
- "New PO" and the export buttons stay with the Orders tab.

#### B2 — `purchase-orders/_components/reorder-tab.tsx` (the old page, moved)

The body of `reorder/page.tsx`, with these changes:
- loads through `apiTry` / `apiFetch` (fixes `:79-89` and the raw save at `:116-121`) with logger `purchase-orders:reorder-tab`;
- default filter **Low** (Q12 a);
- **Q11 = keep both:** the inline level boxes and Save Levels stay; every row **also** gets the **Reorder settings**
  button that opens `ReorderSheet`, already mounted at `:246-253`; a sheet save drops that product's unsaved inline edit;
- Create PO and WhatsApp unchanged (Q14).

`GET /api/reorder` and `PUT /api/reorder/update-levels` are **unchanged**. The brand-count wizard
still uses the latter.

#### B3 — `/reorder` becomes a redirect

`reorder/page.tsx` → a server `redirect("/purchase-orders?tab=reorder")`, so bookmarks and old
links still work. (Check the Next 16 docs for `redirect` in a page.)

#### B4 — dashboard links

`(dashboard)/page.tsx:357` and `:891` → `/purchase-orders?tab=reorder`.

#### B5 — RBAC catalog (Q9 a) — data, not a migration

In `prisma/rbac-catalog.ts:394-402`:
- `route: null`, so the sidebar and More skip the module (`app-sidebar.tsx:157`, `more/page.tsx:72`);
- `label: "Reorder"` (the `/ai` page it once shared is gone, `(dashboard)/page.tsx:353-354`);
- the `⚠ RUN npm run db:seed:rbac AFTER DEPLOY` comment.

Actions are unchanged (`view`, `edit`), so no grant moves. Before the seed on production, run:

```sql
SELECT count(*) FROM "User" WHERE '/reorder' = ANY("navTabs");
```

A pinned `/reorder` tab disappears once the route is null (`use-bottom-nav.ts:59-60`). The count
is 0 locally. The builder also greps for every other reader of `module.route`.

### Part C — set level and qty on `/stock` and the details page (R1)

- **C1 `/stock`:** already built: the row button, the sheet, and "Reorder @ N · order M" on the row
  (§2.3). **No change**, unless Q1 = (b). In that case the bulk bar gains "Set reorder level / qty",
  sent to `api/products/bulk` under `reorder.edit`.
- **C2 `/stock/[id]`:** a **Reorder** card below the stock card (`stock/[id]/page.tsx:478-499`)
  showing:
  - the level;
  - the reorder qty ("not set — orders up to the level" when 0);
  - the reorder vendor (name, or "not set");
  - a Low / OK chip from `isLowStock`;
  - a **Set** button, shown when `canEdit("reorder")`, that opens `ReorderSheet` and patches the
    product in place.

  The builder checks that `GET /api/products/[id]` returns `reorderVendor { name }`, and adds it if
  not. Q13 = (b) also removes the three fields from the Edit form (`:384-407`, `startEdit :232-234`,
  the `:255` null rule).

### Files

| File | Part | Change |
|---|---|---|
| `src/lib/purchase-orders/reorder-suggestions.ts` | A1 | **new** |
| `src/app/api/purchase-orders/reorder-suggestions/route.ts` | A2 | **new** |
| `src/app/(dashboard)/purchase-orders/new/_components/reorder-suggestions.tsx` | A3 | **new** |
| `src/app/(dashboard)/purchase-orders/new/page.tsx` | A3, A4 | mount panel, vendor-change confirm, comments |
| `src/app/(dashboard)/purchase-orders/new/_components/vendor-section.tsx` | A4 | hint + comment |
| `src/lib/purchase-orders/duplicates.ts` | A1 | export `OPEN_PO_STATUSES` if not exported |
| `src/app/(dashboard)/purchase-orders/page.tsx` | B1 | tab bar (after Q0 settles the uncommitted diff) |
| `src/app/(dashboard)/purchase-orders/_components/reorder-tab.tsx` | B2 | **new** — moved from `reorder/page.tsx` |
| `src/app/(dashboard)/reorder/page.tsx` | B3 | becomes a redirect |
| `src/app/(dashboard)/page.tsx` | B4 | two links |
| `prisma/rbac-catalog.ts` | B5 | reorder module route/label |
| `src/app/(dashboard)/stock/[id]/page.tsx` | C2 | Reorder card + sheet |
| `src/app/api/products/[id]/route.ts` (GET) | C2 | only if `reorderVendor` is not already returned |

**Callers checked, unchanged:** `ReorderSheet` (used by `/stock`, the reorder tab and now the
details page, with the same props), `GET /api/reorder`, `PUT /api/reorder/update-levels`
(brand-count), `POST /api/purchase-orders/prepare`, `createPurchaseOrder`.

### Phases and dependencies

| Phase | Work | Depends on |
|---|---|---|
| A1–A2 | query + route | Q2, Q3, Q5, Q7 |
| A3–A4 | panel on New PO | A2, Q6 |
| B1–B2 | tab bar + moved listing | Q0, Q8, Q10–Q12, Q14 |
| B3–B5 | redirect, links, catalog | B1, Q9 |
| C2 | details-page card | Q13 |

A and B touch different files and can be built in parallel. C is small and independent.

### Logging

| Scope | Lines |
|---|---|
| `purchase-orders:reorder-suggestions` | `debug` request `{ vendorId, page, search: !!search }` and `{ total, returned }`; `warn` on a cross-check drop `{ vendorId, productId }`; `error` on failure |
| `purchase-orders:reorder-panel` | `debug` page loads; `info` "reorder lines added" `{ vendorId, added, skipped }`; `error` on load failure |
| `purchase-orders:reorder-tab` | `error` on load failure (replaces the bare catch) |
| `purchase-orders:new` | `info` "reorder lines removed on vendor change" `{ from, to, removed }` |

Ids and counts only, never payloads. Every `catch` logs.

### Board of agents — checked

- **inventory-consultant.** Its rule is reorder point = avg daily sales × lead time + safety stock.
  This plan uses the level **you enter by hand**, as asked. Nothing suggests a level from sales.
  **Flagged here, not built** (§5). Its red flag "stock below reorder point" is exactly what the
  panel surfaces.
- **backend-engineer.** Zod on the new route; the guard matches `prepare`; no role names; the panel
  and the server share one vendor rule (A1 step 4), so the list cannot offer what Create refuses.
- **database-architect.** No schema change. The low filter is one indexed query
  (`[status, currentStock]`, `[reorderVendorId]`) instead of loading 5,744 rows.
- **frontend-engineer.** Loading, error and empty states; 44 px targets; the tab bar scrolls
  sideways at 375 px; `apiTry` only.

---

## 4. Verification

The owner runs `npm run build`. Before handing over: `npx tsc --noEmit` and `npx eslint` on the
touched files.

0. **Production counts first:** the §2.1 queries, plus the `navTabs` query in B5.
1. On `/stock`, set product P: level 5, qty 10, vendor V, stock 3. The row shows
   "Reorder @ 5 · order 10".
2. New PO → pick V. P is listed with qty 10. Add it, create the PO. The PO line carries P's
   `productId`.
3. Set P's stock to 5: still listed (Q3 a). Set it to 6: gone.
4. Product P2 below its level with qty 0 is listed with qty `level − stock` and "qty not set" (Q5 a).
5. Twelve low products on V: page 1 shows 10, Next shows 2. A search narrows the list. Ticks
   survive paging.
6. P already on an open PO for V: greyed out with the PO number, and cannot be ticked (Q7 a).
7. Add P, then switch the vendor: you are asked to confirm, and P's line is removed.
8. Link brand B to V as primary on the vendor's page. B's low products with no reorder vendor
   now appear under V (Q2 a).
9. `/purchase-orders` shows **Orders | Reorder**. The Reorder tab opens on Low, and a row's
   settings button opens the sheet. `/reorder` redirects to the tab. The dashboard tiles land on it.
10. A role with `purchase_orders.view` but not `reorder.view` sees no tab bar.
11. After `db:seed:rbac`, the sidebar and More no longer list Reorder, and `/team/permissions`
    still does.
12. On `/stock/[id]`, the Reorder card shows level, qty and vendor. Set opens the sheet, and the
    card updates without a reload.

---

## 6. Build record — 15 Sep 2026

Built on `feat/remove-static-team-health` (Q0), **uncommitted**. Written in the main session; then three agents in parallel: one ran `tsc`/`eslint` and was the only editor, one reviewed read-only against §1.1, one verified the query on `bch_local`.

**Results.** `npx tsc --noEmit` exit 0. `eslint` on the 13 touched files: 0 errors, 1 pre-existing warning (`stock/[id]/page.tsx` unused `session`). **`npm run build` NOT run** — the owner runs it.

**Query verified on `bch_local`** (read-only run of the real `findReorderItems` via jiti, then a rolled-back psql session with test data): Prisma emits `"currentStock" <= "public"."Product"."reorderLevel"`; below-level and equal-to-level rows returned, above-level excluded, another vendor's product excluded, a `reorderQty 0` row returned at qty 0. Database unchanged afterwards (reorder counts still 0).

**Files.**

| File | What |
|---|---|
| `src/lib/purchase-orders/reorder-items.ts` | **new** — the query (`reorderVendorId = V`, level > 0, stock ≤ level, search, paging) + open-PO lookup by product id **and** normalised name |
| `src/app/api/purchase-orders/reorder-items/route.ts` | **new** — `GET`, `purchase_orders.create`, zod, inactive vendor → 400, `paginatedResponse` |
| `purchase-orders/new/_components/reorder-items-modal.tsx` | **new** — the modal: 10/page, Prev/Next, search, ticks kept across pages, qty editable from `reorderQty` (0 allowed), open-PO rows greyed with a link |
| `purchase-orders/new/page.tsx` | "Add reorder items" button beside the AI upload; `addReorderLines`; vendor-change confirm removes reorder lines; `hasUnsetQty` blocks submit / Create all; sheet "Use selected" now also dedupes by name |
| `purchase-orders/new/_components/vendor-section.tsx` | 0-qty lines outlined amber with "Set a quantity"; buttons disabled with the reason |
| `purchase-orders/page.tsx` | Suspense + `?tab=` tab bar **Orders \| Reorder**; tabs by grant; Orders body unchanged (incl. the owner's uncommitted loading refactor) |
| `purchase-orders/_components/reorder-tab.tsx` | **new** — the old `/reorder` screen: opens on Low, `apiTry`/`apiFetch`, inline level + Save Levels kept, row settings button → `ReorderSheet` |
| `reorder/page.tsx` | server `redirect("/purchase-orders?tab=reorder")` |
| `(dashboard)/page.tsx` | both Low Stock tiles → the tab |
| `prisma/rbac-catalog.ts` | `reorder`: `route: null`, label "Reorder" — **needs `npm run db:seed:rbac`** |
| `stock/[id]/page.tsx` | Reorder card (level, qty, vendor, Low/OK, Set → `ReorderSheet`); the page's three raw `fetch().json()` calls moved to `apiTry`/`apiFetch` with logging |
| `api/products/[id]/route.ts` | GET includes `reorderVendor { id, name }` |
| `components/reorder-sheet.tsx` | `ReorderSaved.reorderVendor?` (optional; the API already returned it) |

**Found by review and fixed before hand-over:** open-PO detection now also matches by item name (a name-only sheet line on an open PO would otherwise have been tickable and then 409'd — Q7); a reorder line and a same-named sheet row can no longer both land on one PO; the modal no longer shows "no products" on an empty page past the end.

**Known and left alone:** the Reorder tab's Create PO still uses `suggestedOrderQty` (up-to-level fallback) while the modal uses `reorderQty` exactly — Q14 said unchanged. A bottom-nav tab pinned to `/reorder` stops resolving after the seed (0 locally; count production first, B5).

**Owner steps:** `npm run build`; browser walk (§4); `npm run db:seed:rbac` after deploy. No migration.

## 5. Out of scope, deliberately

- **Suggesting a reorder level from sales** (avg daily sales × lead time + safety stock), and EOQ.
  The level is entered by hand.
- **Per-store reorder levels** (Q4 b). That would be a schema change and a store on the PO.
- **`Category.reorderLevel`.** It is unused by any reorder rule and stays so.
- **Filling `brand_vendors`.** Linking brands to vendors is done on the vendor's page, as today.
- **Paging `GET /api/reorder`.** The listing keeps its current API; only its default filter changes.
- **The dashboard's "available vs on hand" low-stock disagreement** (`lib/reorder.ts:15-20`).
- **Moving `reorderLevel` / `reorderQty` in the product PUT behind `reorder.edit`**
  (`api/products/[id]/route.ts:80-83`).
