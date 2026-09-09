# Raise a purchase order from an uploaded document — AI extraction, a review step, and the end of /brand-stock

**Status:** in-progress — 9 Sep 2026, P1–P4 building on branch feat/0909-stock-po-expense (four plans share it); P5 drop migration is a later release
**Branch:** **`feat/po-ai-upload`** — create it with exactly this name. **The base branch is
not assumed:** the owner names it before anything is checked out (the current tip of this line
of work is `feat/taxonomy-inactive-and-audit-approval`).

Everything in §2, §3 and §6 was read from the code on disk on **9 Sep 2026**. No claim is
carried over from an earlier session, and nothing has been changed yet.

---

## 1. The requirement

### 1.1 As the owner wrote it, verbatim

> i need to improve the implemntation that i need to remove the brand-stock screen and its
> related logic what i need to do is in the creation of the po what we can do is use the ai
> where on upload it must extarct the product data where those extracted data must show the
> review in the review where i need to select product or item name list of selcetd from the
> preview must be shown check showu store the preview or selcetd data of product in the
> databse and where the sekected product must be show with the related things Qty , Unit
> Price * ,GST % in the ui where the user can write the related data of it and can be saved
> as draft or subbmit for approval where i need to implment the email thing where it has to
> send the email with the po with the pdf as attachment

### 1.2 The same requirement, as sentences

| # | Requirement |
|---|---|
| **R1** | Remove the `/brand-stock` screen and all of its related logic — pages, API routes, matching code, and its permission module. |
| **R2** | Move that capability into **purchase order creation**: while raising a PO the user uploads a file (a vendor quotation, price list or catalogue) and **AI extracts the product data from it**. |
| **R3** | The extracted data is shown in a **review step**. |
| **R4** | In the review the user **selects the products / item names** to order, and the selection is shown back to them. |
| **R5** | **Decide whether the preview (all extracted rows) or only the selection is stored in the database** — the owner asked for a recommendation, not an assumption. Answered in §4 Q3. |
| **R6** | Each selected product appears on the PO form with **Qty · Unit Price\* · GST %**, editable by the user. |
| **R7** | The PO can be **saved as a draft** or **submitted for approval**. |
| **R8** | **Email**: the purchase order is emailed out with the **PO PDF attached**. |

---

## 2. What already exists — verified on disk, 9 Sep 2026

This matters, because most of R6, R7 and R8 are **already built**. The work is much smaller
than the requirement reads.

| Requirement | Already implemented at |
|---|---|
| **R2** AI extraction from PDF / PNG / JPG / WebP | `src/lib/pdf-parser.ts:25-47` — one `runAi({ purpose: "catalogue.pdf_extract", json: true, maxTokens: 16000 })` call returning `ParsedItem[]` |
| **R2** deterministic extraction from XLSX / CSV | `src/lib/excel-parser.ts:83` `parseExcelBuffer` — no AI call, no cost |
| the AI layer itself | `src/lib/ai/` (10 files, 1223 lines). Provider, model and key are **rows in `AiProvider`**, switchable at Settings → AI with no redeploy; retries, `max_tokens` refusal and JSON parsing are all handled in `src/lib/ai/index.ts` `runAi` |
| matching an extracted row to one of our products | `src/lib/brand-stock-matcher.ts:47,72,91` — saved mappings → exact SKU → fuzzy name |
| **R6** the Qty / Unit Price / GST % line editor | `src/app/(dashboard)/purchase-orders/new/_components/vendor-section.tsx:193-238` |
| **R7** save as draft vs submit for approval | `src/lib/purchase-orders/create.ts:298` — `input.submit === false ? "DRAFT" : "PENDING_APPROVAL"`; the two buttons are `vendor-section.tsx:312-321` |
| **R8** email the PO with the PDF attached | `src/app/api/purchase-orders/[id]/send/route.ts` + `src/lib/purchase-orders/pdf.ts` + `src/lib/purchase-orders/email.ts` — renders the PDF, sends over SMTP, writes a `PurchaseOrderSend` row per **attempt** including failures, with a 60 s resend cooldown and a stale-PENDING sweep |
| one and only one way to create a PO | `src/lib/purchase-orders/create.ts` `createPurchaseOrder` — per-vendor advisory lock, duplicate check, number allocation, insert and activity row |

**Two constraints that follow from the existing code and shape the design:**

1. **A PO cannot be emailed before it is approved.** `send/route.ts:123` refuses any status
   other than `APPROVED` or `SENT_TO_VENDOR`. That is deliberate — the PDF is a written offer
   to the vendor.
2. **A ₹0 line is refused on the manual screen** (`create.ts:240-241`) and skipped for the
   brand-stock caller (`create.ts:44-53`). Which of the two this new flow picks is a decision,
   not a default (§4 Q7).

---

## 3. What is genuinely new

1. Lift **upload → AI extract → review → map to products** out of `/brand-stock` and into PO
   creation.
2. **Generalise the matcher.** Its fuzzy phase searches only products of one brand
   (`brand-stock-matcher.ts:91-95`, `where: { brandId, status: "ACTIVE" }`) because a
   brand-stock upload is scoped to a brand. A vendor quotation is not.
3. **Decide where the extraction lives** (R5 / §4 Q3). Today a brand-stock upload is persisted
   in `BrandStockUpload` + `BrandStockItem`, but the uploaded **file itself is never stored** —
   `api/brand-stock/upload/route.ts` reads the buffer, parses it, and drops it.
4. **Delete brand-stock.** The full removal surface is §6.

---

## 4. Questions for the owner

**Answered by the owner on 9 Sep 2026** — the answers are in the *Clarifications* section at the
end, and §5–§8 were edited the same day to match. The recommendations are kept as written so
the reasoning stays visible; where the owner chose differently it is marked inline.

**Q1 — Where does the upload live?**
*Recommended:* a second mode on `/purchase-orders/new` ("Upload a quotation") beside the
existing product search, so both paths end in the same per-vendor section editor.
*Alternative:* its own `/purchase-orders/import` screen that hands off.

**Q2 — Is the vendor chosen before the upload, or derived from it?**
*Recommended:* **before.** A PO goes to one vendor; the file is normally that vendor's own
quotation; and `createPurchaseOrder` verifies the vendor supplies each product
(`create.ts:191`) as well as running a per-vendor duplicate check. Deriving the vendor from
matched products is exactly what forced brand-stock to turn that verification off
(`create.ts:56-63`). *If your files routinely mix vendors, say so — the answer changes the
whole screen.*

**Q3 — Do we store the extraction in the database?** (this is R5)
*Recommended:* **yes — store every extracted row, not only the selection.** Two new tables,
`PoExtraction` + `PoExtractionItem`. Reasons: the AI call costs money and takes 30–60 s, so a
refresh or a locked phone must not throw it away; and keeping the unselected rows is what lets
you answer later "what else was on that quotation".
*Alternative:* browser-only state — no migration, but one reload loses the extraction.

> **Owner, 9 Sep 2026 — different from the recommendation.** Stored **only while the review is
> open**, so a refresh or a 30–60 s AI call is not lost. The moment the PO is created (draft or
> submitted) the extraction rows **and the uploaded file are deleted**. Nothing of the upload
> outlives the PO; the PO's own lines are the record. Consequence: `PoExtraction` is a
> review-time scratch table, not provenance, and it has no `purchaseOrderId`. The same applies
> to Q4: the file is stored for the review and deleted with the rows.

**Q4 — Do we keep the uploaded file itself?** (`src/lib/storage`, Supabase/S3)
*Recommended:* **yes**, stored and linked from the extraction, so months later you can open the
quotation a price came from. Costs one storage write per upload. The send route already keeps
the sent PDF this way (`PurchaseOrderSend.pdfUrl`).

**Q5 — What happens to an extracted row that matches no product in our catalogue?**
*Recommended:* show it, let the user search the catalogue by hand, and leave it off the PO if
they do not map it. **Should the review screen also be able to create a new product on the
spot?** That pulls in SKU, category, HSN and GST and is real extra scope — the pending
`0809-vendor-catalog-po-search-plan.md` §3.5 designs exactly that, so the two must agree.

**Q6 — Should the mapping be remembered?** `BrandSkuMapping` today learns "this brand's line
name = this product" and is phase 1 of the matcher.
*Recommended:* keep the idea, **re-keyed to vendor**, so the second upload from the same vendor
auto-matches nearly everything.

> **Owner, 9 Sep 2026 — no.** Match fresh every time: exact SKU, then fuzzy name. No mapping
> table. Consistent with nothing from an upload persisting past the PO.

**Q7 — Where do Qty, Unit Price and GST % default from, and what about a ₹0 line?**
*Recommended:* Qty = the file's quantity if present, else the reorder shortfall, else 1 ·
Unit Price = the file's price, else the product's cost price · GST % = the product's `gstRate` ·
and a line still at ₹0 **blocks submission** on this screen the way the manual one does,
because the PDF goes to the vendor.

**Q8 — Keep the Excel/CSV path?**
*Recommended:* **yes** — XLSX/CSV parsed locally by `excel-parser.ts` (free, deterministic),
PDF and images through AI. Dropping it makes every spreadsheet cost an AI call.

**Q9 — How deep does the brand-stock removal go, and in one release or two?**
*Recommended:* remove the screens, routes, RBAC module and matcher **now**; drop
`BrandStockUpload` / `BrandStockItem` / `BrandSkuMapping` and their three enums in a **second**
migration once no code references them (AGENTS rule 7, additive first).
*Needed from you:* is there any upload on the cloud test database worth keeping, or is it all
disposable?

> **Answered by the data, 9 Sep 2026:** `BrandStockUpload`, `BrandStockItem`, `BrandSkuMapping`
> and `PurchaseOrder` all hold **zero rows** on both local `bch` and the Supabase cloud test
> project. There is nothing to keep. The two-release order still stands (AGENTS rule 7).

**Q10 — Any permission changes?**
*Recommended:* gate the whole import on the existing **`purchase_orders.create`** — no new
module, therefore no `npm run db:seed:rbac` and no re-granting on `/team/permissions` after
deploy. A new `po_import` module would have to be granted to every role by hand.

**Q11 — On email (R8), what is actually missing for you?** Pick one:
  (a) nothing — the existing "Send to vendor" button on the PO detail screen is enough;
  (b) the email should fire **automatically the moment a PO is approved**;
  (c) the creator should be able to email a **draft or pending** PO too — *this weakens the
  approval gate, since the PDF is the offer.*
*Recommended:* **(a)**, and if you want less clicking, **(b)**.

**Q12 — Approval notifications.** When a PO is submitted for approval, should the approver be
emailed or pushed? There are no cron jobs or timers in this application, so it would be sent
inline on submit.
*Recommended:* out of scope for this plan; raise it separately if you want it.

---

## 5. Design — assuming the recommended answers

Rewrite this section if any answer differs.

### 5.1 The flow

```
/purchase-orders/new
  ├── pick vendor              (Q2 — before the upload)
  ├── Upload a quotation       PDF / image → AI    ·    XLSX / CSV → local parser
  │      └── POST /api/purchase-orders/extract     (guard: purchase_orders.create)
  │             stores PoExtraction + PoExtractionItem, runs the matcher, returns the rows
  ├── REVIEW                   every extracted row with its match; tick to select
  ├── the ticked rows become the section's lines: Qty · Unit Price* · GST %
  └── Save as draft   |   Submit for approval   → existing createPurchaseOrder
                │                                     ↓
                │                    approve → Send to vendor (PDF attached, already built)
                └── on success: DELETE the PoExtraction, its items and the stored file
                    (owner, 9 Sep — nothing from the upload outlives the PO)
```

**Abandoned reviews.** There are no cron jobs, so an extraction whose PO is never raised is not
swept by a timer. Two things cover it: a **Discard** button on the review that deletes the
extraction and its file, and `POST /api/purchase-orders/extract` deleting the **caller's own
earlier unfinished extractions** before it creates a new one. One user therefore never holds
more than one open extraction, and an orphan can only be as old as that user's last upload.
The delete of the stored file is best-effort and logged at `warn` if it fails; the rows go
regardless.

### 5.2 Schema (Q3, Q4)

Additive only — nothing existing is altered.

```prisma
model PoExtraction {
  id              String   @id @default(cuid())
  vendorId        String                  // Q2 — the vendor is chosen before the upload
  fileName        String
  fileType        String                  // "pdf" | "xlsx" | "csv" | "png" | ...
  fileUrl         String?                 // Q4 — the stored original
  source          String                  // "ai" | "excel" — which parser produced the rows
  aiModel         String?                 // provider + model, for "why did it read it that way"
  totalItems      Int      @default(0)
  matchedItems    Int      @default(0)
  createdById     String
  createdAt       DateTime @default(now())
  // No purchaseOrderId: the row is deleted when the PO is created (owner, 9 Sep 2026), so it
  // never coexists with the PO it produced. Items cascade from the extraction (onDelete:
  // Cascade on PoExtractionItem.extractionId) so the delete is one statement.
}

model PoExtractionItem {
  id              String   @id @default(cuid())
  extractionId    String
  rawName         String
  rawSku          String?
  rawCategory     String?
  rawSize         String?
  qty             Int?
  price           Decimal? @db.Decimal(12, 2)  // Decimal, not Float — database-architect.md:56-59
  mrp             Decimal? @db.Decimal(12, 2)
  productId       String?                      // the match, when there is one
  matchStatus     String                       // AUTO | FUZZY | MANUAL | UNMATCHED
  matchConfidence Float?
  selected        Boolean  @default(false)
  orderQty        Int?
}
```

Money as `Decimal(12,2)` per `docs/agents/database-architect.md:56-59` — the brand-stock tables
used `Float`, and this plan does not add an 84th float money column.

### 5.3 The matcher

`src/lib/po-extraction/matcher.ts`, derived from `brand-stock-matcher.ts` with two changes:

1. **Phase 1 (saved mappings) is removed** — Q6 was answered "no" on 9 Sep 2026. The matcher is
   exact SKU, then fuzzy name.
2. **Phase 3** fuzzy-matches across **what that vendor supplies** — the product's own
   `reorderVendorId`, plus products of brands linked to that vendor — which is the scope
   `/api/products/search` already applies when it is given a `vendorId`. It falls back to the
   whole active catalogue when the vendor supplies nothing yet.

The scoring itself (`normalize` / `fuzzyScore`, `brand-stock-matcher.ts:3-25`) moves across
unchanged; it is the part of brand-stock worth keeping.

### 5.4 Email (R8) — no new code under the recommended answer

The chain already exists end to end. What this plan adds is **one sentence on the PO screen**
saying the PDF goes out from the detail screen after approval, because that is the step people
cannot currently guess.

If Q11 is answered **(b)**, the addition is: `api/purchase-orders/[id]/approve/route.ts` calls
the same send path inline after the status flip, and a failure to send must **not** roll back
the approval — it becomes a `PurchaseOrderSend` FAILED row, which is what that table exists for.

---

## 6. The brand-stock removal surface (R1) — every reference, verified

**Delete outright**

| Path | Lines |
|---|---|
| `src/app/(dashboard)/brand-stock/page.tsx` | 165 |
| `src/app/(dashboard)/brand-stock/[id]/page.tsx` | 509 |
| `src/app/(dashboard)/brand-stock/upload/page.tsx` | 218 |
| `src/app/api/brand-stock/upload/route.ts` | 139 |
| `src/app/api/brand-stock/uploads/route.ts` | — |
| `src/app/api/brand-stock/uploads/[id]/route.ts` | — |
| `src/app/api/brand-stock/uploads/[id]/items/route.ts` | — |
| `src/app/api/brand-stock/uploads/[id]/generate-po/route.ts` | 177 |
| `src/lib/brand-stock-matcher.ts` | 142 — `normalize` / `fuzzyScore` move to the new matcher first |

**Edit**

- `prisma/rbac-catalog.ts:154-181` — remove the whole `brand_stock` module entry (a child of
  `stock_management`, sortOrder 102, actions view/create/edit). **After deploy the owner runs
  `npm run db:seed:rbac`**. Checked 9 Sep 2026: the seeder **does** remove it —
  `prisma/seed-rbac.ts:143-147` deletes modules whose key is not in the catalog (children first),
  `:169` deletes their permissions, and `RolePermission` cascades on both sides
  (`schema.prisma:107-108`), so the grants go with them. Also reword the `purchase_orders`
  module description at `rbac-catalog.ts:271`, which still reads "POs and brand stock uploads".
- `src/app/api/brands/[id]/merge/route.ts:60-70,82-83` — the merge route re-points
  `brandSkuMapping` rows (with a clash check) and moves `stockUploads` + `skuMappings` between
  brands. Four references, not one; they go when the models do (P5), and the merge response
  loses two counts.
- `src/app/api/products/[id]/route.ts:180` — a comment naming `BrandSkuMapping` in the old
  nine-table cascade; reword with the others below.
- `src/lib/purchase-orders/create.ts:50,61,113` · `duplicates.ts:26-30` · `sequence.ts:14` ·
  `api/purchase-orders/route.ts:75-88` · `api/purchase-orders/[id]/pdf/route.ts:67` ·
  `reorder.ts:26-30` · `validations.ts:386` — **comments only.** Every one explains a design
  decision by naming the brand-stock caller that forced it. They get reworded to name the new
  caller; the decisions themselves (`onPricelessLine`, `verifyVendorSupplies`) stay, because
  the new import flow is the caller they were written for.
- **No navigation link to `/brand-stock` exists anywhere in `src/`** — the menu is built from
  the `modules` table, so removing the catalog entry and re-seeding is what removes the menu
  item.

**Schema — second migration only (Q9)**

`prisma/schema.prisma`: models at `2189` (`BrandStockUpload`), `2224` (`BrandStockItem`),
`2258` (`BrandSkuMapping`); enums at `2163`, `2170`, `2183`; and the four back-relation blocks
at `400` (User), `479-480` (Brand), `541-542` (Product). Those relation fields must go in the
same migration as the models or the schema will not validate.

**Snapshot before merging the migration PR: `npm run db:snapshot` (AGENTS rule 9). Prisma has
no down migrations — the snapshot is the rollback.** Nothing applies migrations automatically
any more (CLAUDE.md, migrations rule 4), so `npx prisma migrate status` then
`npx prisma migrate deploy` are run by hand against the target before the code goes live.

---

## 7. Conflict to settle before P1: `0809-vendor-catalog-po-search-plan.md`

> **Settled 9 Sep 2026 — option (a).** The owner deleted that plan from the working tree
> deliberately ("I have dropped the 0809-vendor-catalog-po-search-plan.md plan"). The
> fill-colour availability idea goes with it. Excel/CSV keep the plain `excel-parser.ts` path
> (Q8). Q5's cross-reference to that plan's §3.5 is void: unmatched rows can be hand-mapped to
> an existing product, and creating a product from the review is out of scope.

That plan **was pending, and it designed the opposite move.** It *keeps* the brand-stock tables
and extends them — `BrandStockUpload` gains `vendorId` and `headerNotes`, `BrandStockItem`
gains seven columns (§3.1), a new `vendor-sheet-parser.ts` reads Excel **fill colours** as
availability, and `/purchase-orders/new` searches that catalogue instead of `Product` (§3.4).
It was written on 8 Sep against the owner's real Trinity Cycles workbook, whose availability is
a fill colour with **no quantity column at all** — something an AI text extraction cannot see.

**These two plans cannot both ship as written.** One of:

- **(a)** this plan wins — `0809-vendor-catalog-po-search-plan.md` is withdrawn and the
  colour-availability idea is lost; or
- **(b)** that plan owns Excel sheets, this one owns PDFs and images, and both write the same
  `PoExtraction` tables; or
- **(c)** that plan is deferred and revisited after this ships.

*Recommended:* **(b)** — the colour legend is real information from a real supplier, and the
two parsers already coexist today behind one route (`excel-parser.ts` and `pdf-parser.ts` in
`api/brand-stock/upload/route.ts:38-42`).

---

## 8. Phases

| Phase | What | Ships alone? |
|---|---|---|
| **P1** | `src/lib/po-extraction/` — the parser wrapper and the vendor-scoped matcher, lifted from `pdf-parser.ts` + `brand-stock-matcher.ts`. Pure library, no screen. | yes |
| **P2** | Schema + migration for `PoExtraction` / `PoExtractionItem` (§5.2). Additive. Two tables only — no mapping table (Q6 = no). | yes |
| **P3** | `POST /api/purchase-orders/extract` + the review UI on `/purchase-orders/new`, feeding the existing section editor. **The point of the plan (R2–R6).** | yes |
| **P4** | Remove brand-stock: screens, routes, RBAC module, matcher (§6, code only). | yes |
| **P5** | The drop migration for the three models, three enums and six relation fields. | yes |
| **P6** | ~~Only if Q11 = (b): send-on-approval.~~ **Dropped** — Q11 answered (a) on 9 Sep 2026. | — |

Each phase builds and is useful on its own. **`npm run build` after every phase** — it takes
21–45 minutes and needs a reachable database, so it is started early rather than at the end.

---

## 9. Verified against code — 9 Sep 2026

Read in full while writing this: `src/lib/purchase-orders/create.ts`,
`src/lib/purchase-orders/email.ts`, `src/lib/purchase-orders/status.ts`,
`src/app/api/purchase-orders/route.ts`, `src/app/(dashboard)/purchase-orders/new/page.tsx`,
`src/lib/pdf-parser.ts`, `src/lib/brand-stock-matcher.ts`,
`src/app/api/brand-stock/upload/route.ts`,
`src/app/api/brand-stock/uploads/[id]/generate-po/route.ts`, `src/lib/ai/index.ts`,
`src/lib/ai/types.ts`, and the PurchaseOrder and BrandStock blocks of `prisma/schema.prisma`.
Read in part: `src/app/api/purchase-orders/[id]/send/route.ts` (1-120, plus the status gate at
123 and the flip at 297-301), `vendor-section.tsx`, `excel-parser.ts`, `prisma/rbac-catalog.ts`,
`src/app/api/products/search/route.ts`,
`docs/implementation/pending/0809-vendor-catalog-po-search-plan.md`.

**Board of agents still to consult before P3 is called done:**
`docs/agents/inventory-consultant.md` (ordering rules), `docs/agents/backend-engineer.md` (the
extract route's zod schema and guard), `docs/agents/database-architect.md` (§5.2 — already
applied for the money columns), `docs/agents/frontend-engineer.md` (the review screen's loading
and error states: an AI call here runs for 30–60 s).

---

## Clarifications — 9 Sep 2026

Run of the clarify-plan gate against the code on disk. Nothing from an earlier session was
trusted; every row below was re-read today.

### Verified against code
- AI extraction is one `runAi` call — CONFIRMED, `src/lib/pdf-parser.ts:25-47`
- Excel/CSV parser, no AI — CONFIRMED, `src/lib/excel-parser.ts:83`
- Matcher phases; fuzzy phase scoped to one brand — CONFIRMED, `src/lib/brand-stock-matcher.ts:47,72,91-95`
- Qty / Unit Price / GST editor and the two submit buttons — CONFIRMED, `vendor-section.tsx:191-238,312-321`
- DRAFT vs PENDING_APPROVAL from `input.submit` — CONFIRMED, `src/lib/purchase-orders/create.ts:298`
- ₹0 line: reject vs skip option; vendor-supplies check opt-in — CONFIRMED, `create.ts:44-53,56-63,191,240-241`
- Send refuses anything not APPROVED / SENT_TO_VENDOR — CONFIRMED, `send/route.ts:123`, flip at `297-301`
- Approve route exists — CONFIRMED, `approve/route.ts:45,66` (not needed now that Q11 = a)
- Product search scopes to `reorderVendorId` OR brand-linked vendor — CONFIRMED, `src/app/api/products/search/route.ts:59-64`
- Uploaded file is parsed and dropped, never stored — CONFIRMED, `api/brand-stock/upload/route.ts:34-42`
- Storage library present — CONFIRMED, `src/lib/storage/{index,s3,local}.ts`
- Nine files to delete, line counts — CONFIRMED, all present, counts match
- Schema lines for 3 models / 3 enums / 6 relation fields — CONFIRMED, `schema.prisma:400,479-480,541-542,2163,2170,2183,2189,2224,2258`
- Brand-stock money columns are Float — CONFIRMED, `schema.prisma:2232-2233`
- `brand_stock` RBAC entry — CONFIRMED, `prisma/rbac-catalog.ts:172-181`
- Merge route reference — DRIFTED: four lines (`merge/route.ts:60,65,82,83`), not one. §6 edited.
- Comment-only reference list — DRIFTED: missed `products/[id]/route.ts:180` and `rbac-catalog.ts:271`. §6 edited.
- No nav link to `/brand-stock` in `src/` — CONFIRMED by grep
- Seeder removes a vanished module — NOW ANSWERED: yes, `prisma/seed-rbac.ts:143-147,169`; `RolePermission` cascades (`schema.prisma:107-108`). §6 edited.
- Rows on the databases — NOW ANSWERED: 0 uploads / 0 items / 0 mappings / 0 purchase orders on both local `bch` and Supabase cloud test `nfemnakgiahcxbnmknjg` (read-only count, 9 Sep)
- Q6 mapping table in §5.2 — MISSING from the schema as written; moot now that Q6 = no
- `0809-vendor-catalog-po-search-plan.md` pending — DRIFTED: deleted from disk (uncommitted `D`), row removed from the README. §7 settled.
- `src/lib/po-extraction/`, `api/purchase-orders/extract`, `PoExtraction` in schema — CONFIRMED absent; no partial work exists
- Conflicts with CLAUDE.md — none: guard is a permission not a role, money is Decimal, no cron, additive migration first

### Answers
- §7 conflict — **(a)**: the owner deleted the vendor-catalog plan deliberately; this plan owns the whole flow.
- Q1 upload mode — recommended: a second mode on `/purchase-orders/new`.
- Q2 vendor — **before** the upload.
- Q3 store extraction — **only during the review**; deleted, with its file, when the PO is created. (Owner: "delete everything after the creation of PO, like the PDF with the data too.")
- Q4 keep the file — **during the review only**; deleted with the rows.
- Q5 unmatched rows — recommended: hand-map to an existing product; no product creation from the review.
- Q6 remember mappings — **no**; match fresh each time.
- Q7 defaults and ₹0 — recommended: file qty → reorder shortfall → 1; file price → cost price; product `gstRate`; ₹0 blocks submit.
- Q8 Excel/CSV path — keep.
- Q9 removal depth — recommended: code now, drop migration second; both databases empty.
- Q10 permission — `purchase_orders.create`; no new module.
- Q11 email — **(a)** nothing missing; P6 dropped.
- Q12 approver notifications — out of scope.
