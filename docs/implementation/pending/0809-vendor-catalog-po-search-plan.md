# Vendor availability catalog — upload the vendor's sheet, then raise a PO from what the vendor actually has

**Status:** pending · **Raised:** 8 Sep 2026 · **Branch base:** to be confirmed by the owner

Today a purchase order is built by searching **our** `Product` catalog. That answers "what do
we stock", not "what can this vendor sell me right now" — and it cannot answer the second
question at all for an item we have never bought. This plan makes the vendor's own stock
sheet the thing you search while raising a PO.

Everything below was read from the code and from the owner's actual file on 8 Sep 2026.
No claim here is carried over from an earlier session.

---

## 1. The file, decoded

`docs/asset/Stock as on 04.09.2026 (Pargaon Wh & Ludhiana Wh)-ALL.xlsx`

| | Pargaon WH | Ludhiana WH |
|---|---|---|
| Header row index | **17** | **10** |
| Item rows | 267 | 122 |
| Distinct item codes | 267 | 122 |
| Brands present | KEYSTO 130, SCHNELL 114, DODGE 11, GOLDIE 6, TRINX 6 | KEYSTO 64, DODGE 47, SCHNELL 11 |

**One workbook = one vendor (TRINITY CYCLES INDIA PVT LTD), two warehouses, five brands,
389 rows.**

Columns: `<WH> Item Name` · `Item Code` · `UOM` · `BDP` · `MRP` · `Scheme` ·
`SEPTEMBER SCHEME` · `Size` · `SS/MS`. Item codes are all `FGBI04…` and unique.

Two column headers are unstable and must never be matched literally: the first is
`Pargaon Item Name` / `Ludhiana Item Name` (it carries the tab name), and `SEPTEMBER SCHEME`
carries the month, so it is renamed on every upload.

### 1.1 Availability is a fill colour, and the legend ships inside the file

Verified by reading cell styles: the swatch is in column **J**, its label in column **K**.

| Fill | Legend cell | Meaning | Pargaon rows | Ludhiana rows |
|---|---|---|---|---|
| `FF0000` red | K1 | Stock Can Finish any time | 85 | 13 |
| `FFFF00` yellow | K2 | Moderate Qty Available | 126 | 72 |
| `92D050` green | K3 | Ample Qty Available | 31 | 31 |

The colour sits on the **item-name cell (column A)**. Because the legend is inside the sheet,
the parser can *read* the mapping rather than hardcode it — falling back to the three colours
above only when a sheet carries no legend block.

**There is no quantity column anywhere.** Availability is the colour and nothing else. Any
design that expects a number for "how many does the vendor have" is designing for a sheet
this vendor does not send.

### 1.2 The header block is trading terms, and it is currently thrown away

Rows 0-16 of the Pargaon sheet carry the vendor's address plus:
`MINIMUM BILLING 40K WITHOUT GST` · `NO BILLING IF O.S MORE THAN 60 DAYS` ·
`SP RATES ARE SUB TO CHANGE W/O ANY INTIMATION` · `SCHEMES SEPTEMBER VARY DEPENDING ON STOCKS`
and the month's scheme list (`Buy 1 Get 1 SS Free 24/26 KS000…`, `BUY 4 GET 1 SS FREE`,
`Rs.300 / 600 / 1500 / 2000 Less Per Cycle`).

That is exactly the context a buyer needs while deciding quantities. It should be captured
and shown on the PO screen, not discarded.

---

## 2. Three gaps, verified

### Gap 1 — the current parser cannot read this file at all

`src/lib/excel-parser.ts:37` scores only the **first 8 rows** looking for the header. This
file's headers are at rows 17 and 10. Running the parser's exact logic against the real file:

```
detectHeaderRow -> row index 2 (score 2)   [TRUE header is index 17]
row it thinks is the header: ["TALUKA KHANDALA, DIST SATARA - 412802.", ...]
colMap: { sku: null, name: null, category: null, qty: 10, price: 6, mrp: null, size: null }
>>> THROWS: "Could not detect a product name column." <<<
```

It picks the vendor's **street address** as the header row and fails. Three further faults:

- **`excel-parser.ts:95` reads only `workbook.SheetNames[0]`.** The entire Ludhiana sheet —
  122 rows — is invisible.
- **`excel-parser.ts:92` never passes `cellStyles: true`.** Fill colour is never read, so
  availability cannot be recovered. `grep` for `fgColor|rowColor|colorLegend` across `src/`
  returns **zero matches**.
- **`excel-parser.ts:120` drops any row whose detected qty is `<= 0`**, silently and with no
  trace in the database. Harmless on this sheet (no qty column, so `qty` stays null) but a
  live hazard on any sheet that has one.

### Gap 2 — the data is scoped to a Brand; the sheet belongs to a Vendor

`BrandStockUpload.brandId` is **non-null** (`schema.prisma:2148-2149`) and the upload screen
makes you pick one brand first. This workbook spans five brands. Under today's model the
operator must either lie about the brand or split the file by hand five ways, twice.

A purchase order is raised against a **Vendor** — `PurchaseOrder.vendorId`
(`schema.prisma:802-803`) is the only counterparty FK, and there is no `brandId` on
`PurchaseOrder` or `PurchaseOrderItem` at all. So the sheet's natural owner is the Vendor,
with brand derived per row.

Related and blocking: **`brand_vendors` is effectively empty.** `resolve-vendor.ts:51-64`
records that nothing ever wrote it; `PUT /api/vendors/[id]/brands` is its first and only
writer and is driven by hand. So tiers 2 and 3 of vendor resolution never fire, and
`generate-po` falls back to a fuzzy `vendor.name contains brand.name` match that its own
comment calls "the weakest link in this route" (`generate-po/route.ts:84,119-124`).

### Gap 3 — a PO line cannot exist for an item we have not catalogued

```prisma
model PurchaseOrderItem {          // schema.prisma:899-914
  productId String                 // NON-NULL. No rawName, no rawSku, no description.
  product   Product @relation(fields: [productId], references: [id])
}
```

`generate-po/route.ts:73` filters rows with `productId: { not: null }`, so every unmatched
sheet row is dropped **silently** — the route reports `skipped` for priceless lines but says
nothing about unmatched ones. This is the exact wall behind the phrase *"new product from the
vendor side"*: today, a vendor item that is not already a `Product` can never be ordered.

### What already works, and should be reused rather than rebuilt

`BrandStockItem` (`schema.prisma:2181-2213`) already stores **one typed row per sheet line**,
with a **nullable** `productId`, plus `rawSku`, `rawName`, `rawSize`, `brandPrice`,
`brandMrp`, `matchStatus`, `matchConfidence`, `selected`, `orderQty` — and, unimplemented,
`rowColor` + `availability`. `BrandSkuMapping` (`:2215-2228`) already remembers a human's
match across future uploads, keyed `@@unique([brandId, brandName])`. The three-phase matcher
(`brand-stock-matcher.ts:40-119`: saved mapping → exact SKU → fuzzy name ≥ 0.6) already works.

**The staging model this plan needs is 90% built and partly dead. Extend it; do not rebuild it.**

---

## 3. Design

### 3.1 Scope the upload to a Vendor, derive the Brand per row

```prisma
model BrandStockUpload {
  brandId     String?  // was non-null; now the OPTIONAL single-brand case
  brand       Brand?   @relation("BrandStockUploads", fields: [brandId], references: [id])
  vendorId    String?  // NEW — the sheet's real owner
  vendor      Vendor?  @relation("VendorStockUploads", fields: [vendorId], references: [id])
  headerNotes Json?    // NEW — trading terms and scheme list from rows 0..header-1
  @@index([vendorId])
}
```

Nullable on both sides so existing brand-scoped uploads keep working unchanged (rule 7,
additive first). "At least one of brandId/vendorId is set" belongs in the route, not the
database, so old rows stay legal.

```prisma
model BrandStockItem {
  brandId        String?  // NEW — resolved per row from the item name
  brand          Brand?   @relation("BrandStockItemBrand", fields: [brandId], references: [id])
  warehouseLabel String?  // NEW — "Pargaon WH" / "Ludhiana WH", the sheet tab name
  uom            String?  // NEW — "NOS"
  schemeText     String?  // NEW — the "Scheme" column
  monthScheme    String?  // NEW — the "<MONTH> SCHEME" column, whatever it is called
  speedClass     String?  // NEW — "SS" / "MS"
  dealerPrice    Decimal? @db.Decimal(12, 2)  // NEW — BDP. Decimal, not Float: money.
  @@index([brandId])
  @@index([warehouseLabel])
}
```

`dealerPrice` is `Decimal(12,2)` per `docs/agents/database-architect.md:56-59` — "Never add
another one" of the 83 `Float` money columns. It sits beside the existing `Float`
`brandPrice`/`brandMrp`, which is inconsistent but is the rule; those two are not touched.

**`rowColor` and `availability` already exist and stay as they are.** This plan finally
populates them.

### 3.2 The parser

`src/lib/vendor-sheet-parser.ts`, fixing all four faults in §2 Gap 1:

1. **Every sheet, not just the first.** Each tab becomes a `warehouseLabel`.
2. **Header found by anchor, scanning every row** — locate the row containing a cell equal to
   `Item Code` (or `SKU` / `Item Cd`), rather than scoring keywords over the first 8 rows.
3. **`cellStyles: true`**, reading the fill of the **item-name cell** into `rowColor`.
4. **Legend read from the sheet**: scan for adjacent (filled swatch, text label) pairs and
   build `colour → availability`, falling back to red/yellow/green from §1.1. Store the map
   in the existing `BrandStockUpload.colorLegend`, and set `legendConfirmedAt` when a person
   confirms it — which is what that column was designed for (`schema.prisma:2134-2139`).
5. **Stop at `TOTAL`**, and keep the preamble rows as `headerNotes`.
6. **Never drop a row for `qty <= 0`** in vendor mode. Availability here is a colour; a red
   row is information, not an absent row.

`src/lib/excel-parser.ts` is left alone, so existing brand-stock uploads do not change
behaviour.

### 3.3 Brand per row

The brand is the leading token of the item name (`KEYSTO ARCHER 24*13…` → `KEYSTO`), matched
case-insensitively against `Brand.name`. Unresolved rows keep `brandId: null` and are shown
for a person to set — never guessed silently. Confirmed against the file: 5 distinct leading
tokens across 389 rows, all of them real brands.

**Measured against the populated database on 8 Sep**, four of the five already exist as
`Brand` rows — `KEYSTO`, `SCHNELL`, `DODGE`, `TRINX` — and **`GOLDIE` does not**. So on this
very file 6 rows land unresolved on day one. That is the case the review step exists for, and
it confirms the rule: offer to create, never create silently.

### 3.3.1 The vendor is picked by a person, not read from the sheet

The sheet header says `TRINITY CYCLES INDIA PVT LTD`. The `Vendor` row is
`TRINITY CYCLES INDIA PRIVATE LIMITED`. **Exact matching fails, and it is the only vendor in
the table that is even close.** Do not infer the vendor from the header block: offer it as a
suggestion beside the vendor picker at most, and let a person confirm. Guessing here attaches
389 rows and every PO built from them to the wrong counterparty.

### 3.4 The PO search — the point of the whole plan

New: `GET /api/vendor-catalog/search?vendorId=…&q=…`, guard `purchase_orders.create`.

Searches `BrandStockItem` rows belonging to the **latest `REVIEWED` upload for that vendor**,
matching `q` against `rawName`, `rawSku` and the resolved brand name. Returns per row:

```jsonc
{ "id": "...", "rawSku": "FGBI04001272",
  "rawName": "TRINX MAJES 100 MS 27*16 IX (BLACK BLUE WHITE)",
  "brandName": "TRINX", "warehouseLabel": "Pargaon WH", "size": "27", "speedClass": "MS",
  "uom": "NOS", "dealerPrice": 14290, "mrp": 25690, "availability": "AMPLE",
  "schemeText": "NOT IN SCHEME", "monthScheme": "-",
  "productId": "..." | null, "matchStatus": "AUTO_MATCHED" | "UNMATCHED",
  "bchCurrentStock": 3 | null }
```

On `/purchase-orders/new`, once a vendor is chosen the picker switches from
`/api/products/search` to this. Each result shows the availability colour, the vendor's BDP,
the MRP, the scheme, and **our** current stock where the row is matched — which is the whole
decision a buyer is making, on one line.

`/api/products/search` is untouched; it is still used by `/stock-audit/brand-count`
(`products/search/route.ts:10`) and by the manual no-vendor path.

### 3.5 Ordering an item that is not in the catalogue

`PurchaseOrderItem.productId` is non-null, and making it nullable would touch receiving, the
PDF, bills, duplicate detection and the transfer flow. **Recommendation: create the `Product`
on demand, at the moment the buyer adds an uncatalogued vendor row to a PO.**

- `name` ← `rawName`; `sku` ← vendor item code if free, else `<vendorCode>-<itemCode>`;
  `brandId` ← the row's resolved brand; `categoryId` ← `Uncategorized`;
  `costPrice` ← BDP; `mrp` ← MRP; `size` ← `rawSize`; `currentStock` 0.
- Guarded by `stock.create` **in addition to** `purchase_orders.create`, and the UI says
  plainly *"not in your catalogue yet — it will be added"* before it happens.
- Writes a `BrandSkuMapping` at the same time, so the next upload auto-matches it.

This keeps the PO schema untouched, so no existing reader changes. The alternative — a
nullable `productId` plus raw columns on `PurchaseOrderItem` — is architecturally cleaner and
substantially larger; it is offered as Q3 in §6.

`ProductStatus` is `ACTIVE | INACTIVE | DISCONTINUED` — there is no `DRAFT`. These rows are
created `ACTIVE`, because a product you are raising a PO for is a product you sell.

---

## 4. Files

**New**
- `src/lib/vendor-sheet-parser.ts` — §3.2
- `src/app/api/vendor-catalog/search/route.ts` — §3.4
- `src/app/api/vendor-catalog/adopt/route.ts` — §3.5, create-product-from-row

**Changed**
- `prisma/schema.prisma` + one migration — §3.1
- `src/app/api/brand-stock/upload/route.ts` — accept `vendorId`, call the new parser,
  persist `rowColor` / `availability` / brand-per-row
- `src/lib/brand-stock-matcher.ts` — match across all brands on the sheet, not one
- `src/app/(dashboard)/brand-stock/upload/page.tsx` — vendor picker beside the brand picker
- `src/app/(dashboard)/brand-stock/[id]/page.tsx` — availability colour, warehouse, scheme
- `src/app/(dashboard)/purchase-orders/new/page.tsx` — the picker switch, §3.4

**Deliberately untouched**: `src/lib/excel-parser.ts`, `/api/products/search`,
`PurchaseOrderItem`, `src/lib/purchase-orders/create.ts`.

---

## 5. Phases

| Phase | What | Ships without the next phase? |
|---|---|---|
| **P1** | `vendor-sheet-parser.ts` — multi-sheet, anchor header, cell fills, legend, TOTAL stop, header notes. Pure library. | yes — verifiable against the real file with no schema change |
| **P2** | Schema + migration (§3.1). Additive, all nullable. | yes |
| **P3** | Upload route on vendor scope; persist colour, availability, per-row brand; matcher across brands; review screen shows them. | yes — this alone makes the file uploadable |
| **P4** | `/api/vendor-catalog/search` + the picker switch on `/purchase-orders/new`. **The point of the plan.** | yes |
| **P5** | Adopt-on-demand for uncatalogued rows (§3.5). | yes |
| **P6** | Header-block trading terms surfaced on the PO screen. | yes |

Each phase builds and is useful on its own. P1 is worth doing first regardless of how §6 is
answered, because the parser faults are real on any sheet of this shape.

---

## 6. Questions for the owner

Each carries options and the default that will be taken if nothing is said. **Blocking** means
a phase cannot start without an answer.

**P1 is blocked by nothing.** The parser faults in §2 Gap 1 are real on any sheet of this
shape, and the parser's output shape does not change with any answer below. It can start
while these are open.

---

**Q1 — Is the upload scoped to a Vendor or a Brand?** · blocks **P2, P3**

*Why it is open:* `BrandStockUpload.brandId` is non-null (`schema.prisma:2148-2149`) and the
upload screen picks one brand. The file is one vendor across five brands.

- **A. Vendor-scoped, brand derived per row** *(default)* — the upload picks a Vendor; each
  row's brand comes from the leading token of the item name. The brand picker stays for
  genuine single-brand sheets.
- **B. Keep brand-scoped** — the operator splits this workbook into five files, twice.
- **C. Both required** — vendor AND brand on every upload; wrong for a multi-brand sheet.

**Answer:**

---

**Q2 — Extend the existing tables, or a new `VendorStock*` family?** · blocks **P2**

*Why it is open:* `BrandStockItem` already has nullable `productId`, `rawSku`, `rawName`,
`rawSize`, `matchStatus`, `selected`, `orderQty`, `rowColor`, `availability`.

- **A. Extend `BrandStockUpload` / `BrandStockItem`** *(default)* — 7 additive nullable
  columns. The matcher, review screen and PO generator keep working as-is.
- **B. New `VendorStockUpload` / `VendorStockItem` family** — cleaner naming, but duplicates
  the matcher, the review screen and the generator, and leaves two staging systems to keep
  in step.

**Answer:**

---

**Q3 — How is an uncatalogued vendor item ordered?** · blocks **P5** · *the biggest decision*

*Why it is open:* `PurchaseOrderItem.productId` is non-null (`schema.prisma:899-914`) and
`generate-po/route.ts:73` drops unmatched rows silently.

- **A. Create the `Product` on demand when the buyer adds the row** *(default)* — PO schema
  untouched, so no existing reader changes. Cost: pressing "add" writes a catalogue row.
- **B. Make `PurchaseOrderItem.productId` nullable, add `rawName`/`rawSku`** — architecturally
  cleaner; touches receiving, the PO PDF, bills, duplicate detection and transfers.
- **C. Keep blocking them** — contradicts the stated goal of seeing new vendor products.

**Answer:**

---

**Q4 — Is a red "Stock Can Finish any time" row orderable?** · blocks **P4**

*Why it is open:* 85 of 267 Pargaon rows and 13 of 122 Ludhiana rows are red.

- **A. Yes, shown in red** *(default)* — red means hurry, not gone.
- **B. Yes, but hidden behind a filter** — off by default, opt in to see them.
- **C. No** — red rows are not selectable at all.

**Answer:**

---

**Q5 — Is `BDP` the price the PO carries?** · blocks **P4**

*Why it is open:* the sheet has `BDP` and `MRP`. BDP reads as the dealer/basic price
(TRINX MAJES: BDP 14,290 / MRP 25,690), but nothing in the file says so outright.

- **A. BDP → `PurchaseOrderItem.unitPrice`** *(default)*, MRP stored for reference only.
- **B. BDP is pre-scheme** — the real price needs the scheme applied first, so the buyer
  must be able to override per line.
- **C. Something else** — say what.

**Answer:**

---

**Q6 — Does a vendor ever send a partial sheet?** · blocks **P4** · *decides one table*

*Why it is open:* §3.4 searches the **latest `REVIEWED` upload per vendor**. If a vendor
sends one brand or one warehouse at a time, that silently loses the rest.

- **A. Every sheet is a full refresh, like this one** *(default)* — the simple design holds,
  no extra table.
- **B. Partial sheets happen** — a persistent `VendorCatalogItem` table keyed
  `(vendorId, vendorItemCode)` is needed, refreshed per upload rather than replaced.

**Answer:**

---

**Q7 — Does uploading a sheet ever change `Product` prices?** · blocks **P3**

- **A. No** *(default)* — the sheet is the vendor's quote, not our cost. Cost changes on
  receipt, not on a price list.
- **B. Yes, update `Product.costPrice` from BDP on approval.**
- **C. Yes, but only for products that have never been received.**

**Answer:**

---

**Q8 — Populate `brand_vendors` from the sheet?** · non-blocking, but fixes dead code

*Why it is open:* `resolve-vendor.ts:51-64` — the table has one manual writer
(`PUT /api/vendors/[id]/brands`) and is otherwise empty, so vendor-resolution tiers 2 and 3
never fire and `generate-po` falls back to fuzzy name matching.

- **A. Yes, on upload approval** *(default)* — every distinct brand on a vendor's sheet
  becomes a `BrandVendor` row. Five rows for Trinity; retires the fuzzy fallback.
- **B. Yes, but only as a suggestion** a person ticks on the review screen.
- **C. No** — leave `brand_vendors` to the manual screen.

**Answer:**

---

**Q9 — Which branch does this stack on?** · blocks everything

Current tip is `chore/brand-stock-module-and-tooling` @ `a5e6c01`, but the working tree is
**not clean**: another session has landed uncommitted work that this plan's P2 sits directly
on top of — `prisma/schema.prisma` (+10, the two Zoho id columns), a new migration
`20260908090622_zoho_brand_category_ids/`, `src/lib/import-placeholders.ts`, `package.json`
(`db:import`), and `scripts/db/import-catalog-and-vendors.mjs`.

P2 adds relations to `Brand` and `Vendor`, so it must be built on top of that work, not
beside it. Confirm whether it is committed to this branch, moved to its own, or still in
flight.

**Answer:**

---

## 7. Measured against the database — 8 Sep 2026

Local `bch` (`localhost:5432`) after the other session's `npm run db:import`:

| Table | Rows |
|---|---|
| `Product` | 5,738 |
| `Brand` | 115 (114 carrying a `zohoBrandId`) |
| `Category` | 32 |
| `Vendor` | 83 |
| `brand_vendors` | **0** |
| `BrandStockUpload` / `BrandStockItem` | 0 / 0 |
| `PurchaseOrder` | 0 |

- Top brands by product count: Unbranded 1,289 · HERO 366 · STRYDER 279 · RALEIGH 267 ·
  SPARES 240 · LUCIFIRE 232 · **KEYSTO 190** · GURU MAHIMA 182.
- `brand_vendors` is still empty, which keeps **Q8** live and makes it the cheapest real fix
  in this plan.
- The vendor exists as `TRINITY CYCLES INDIA PRIVATE LIMITED`; the sheet says
  `TRINITY CYCLES INDIA PVT LTD` — see §3.3.1.
- Of the sheet's five brands, `GOLDIE` has no `Brand` row; the other four do.

So every phase of this plan can now be built and tested against real data, which was not true
when it was drafted.

---

## Verified against code — 8 Sep 2026

- `excel-parser.ts:37` first-8-rows header scan; `:92` no `cellStyles`; `:95` first sheet
  only; `:120` drops `qty <= 0`. Simulated against the owner's file: throws
  "Could not detect a product name column."
- `BrandStockUpload` `schema.prisma:2146-2179`; `BrandStockItem` `:2181-2213`;
  `BrandSkuMapping` `:2215-2228`. `rowColor` / `availability` / `colorLegend` /
  `legendConfirmedAt` exist, are documented, and have **zero references in `src/`**.
- `PurchaseOrderItem.productId` non-null, `schema.prisma:899-914`.
- `generate-po/route.ts:73` excludes `productId: null`; `:84,119-124` the fuzzy vendor
  fallback; `:64-65` the deliberate double guard.
- `purchase-orders/new/page.tsx:183-193` the picker calls `/api/products/search`;
  `products/search/route.ts:26` guard `stock.view`, `take: 20`, `status: "ACTIVE"`.
- `resolve-vendor.ts:51-64` — `brand_vendors` has one manual writer and is otherwise empty.
- `PurchaseOrder.vendorId` `schema.prisma:802-803`; no `brandId`, no store/warehouse FK.
- Money rule `docs/agents/database-architect.md:56-59`; the only two `Decimal(12,2)` columns
  in the schema are `TransferOrder.consignmentValue` `:1744` and
  `TransferOrderItem.unitCost` `:1798`.
- `ProductStatus` is `ACTIVE | INACTIVE | DISCONTINUED` — no `DRAFT`.
- Matcher: `brand-stock-matcher.ts:40-119`, fuzzy threshold `0.6` at `:111`.
