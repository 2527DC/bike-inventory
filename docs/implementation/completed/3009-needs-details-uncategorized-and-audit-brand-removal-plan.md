# "Needs details" also collects Uncategorized products; the stock audit loses its brand picker

Status: completed — 30 Sep 2026, Needs details also collects Uncategorized products; stock audit brand picker and brand-apply removed end to end (Q2 kept all three brand placeholders)
Branch: `feat/3009-needs-details-and-audit-brand`

Every `file:line` below was read from disk on 30 Sep 2026.

---

## 0. Requirement

### 0.1 The owner's words, verbatim (30 Sep 2026)

> in the /stock screen i have the need details filter where i need that filter to work like if the product or a item doesnt have the any one  of category and brand are as uncategorized then i need to  show all thore related products but  if the product  dont have uncategrized in both brand and categry dont show it basically its nrg but  show me all the  uncategorized  category and uncategorized brand data and aso inside the  stock autit  after the creation of stock audit inside it when we start the stock aduit it the listing item has a feature of choosing brand i need u to remove it   i  dont need to change the brand from the listing  auditing items

Answers given the same day (§1.1):

> Keep the bin rule too
>
> for the brand its unbranded  and category  uncategorized
>
> Remove it completely (Recommended)

### 0.2 Restated as requirements

- **R1** — On `/stock`, the "Needs details" filter shows every active product whose **category is `Uncategorized`**.
- **R2** — It also shows every active product whose **brand is the "no brand" placeholder** (`Unbranded`, see Q2).
- **R3** — Either condition is enough (OR). A product with a real category **and** a real brand is not shown for that reason.
- **R4** — The existing "no bin" condition stays in the filter (owner's answer to Q1).
- **R5** — In a started stock audit, the per-item **brand picker is removed** from the counting list.
- **R6** — A stock audit can no longer change a product's brand by any path: not saved on the line, not applied on approval, not shown on the review screen.

---

## 1. Questions and clarifications

| # | Question | Why it changes the build | Options | Default | Answer |
|---|---|---|---|---|---|
| Q1 | Keep the "no bin" condition? | Decides whether the filter is 2 or 3 OR branches | drop / keep | drop | **keep** (30 Sep) |
| Q2 | Which brand names count as "uncategorized brand"? | Defines the brand branch | `Unbranded` only / all three placeholders (`Imported`, `Unbranded`, `General`) | all three | owner said "unbranded" — **see note** |
| Q3 | How much of the audit brand feature goes? | UI-only vs. end-to-end | dropdown only / completely | completely | **completely** (30 Sep) |

**Q2 note — please confirm.** The owner named `Unbranded`. The code treats three names as "no brand"
(`src/lib/import-placeholders.ts:43`): `Unbranded` (the catalog import), plus `Imported` and
`General` (older rows). The `/stock` card already greys all three out. **This plan keeps all
three**, so `Unbranded` is included and no older placeholder row drops out of the filter while
its card still says it needs a brand. If you want `Unbranded` **only**, say so. It is a one-line
change, but the card and the filter would then disagree for `Imported`/`General` rows.

### 1.1 Decisions on record

| Date | Q | Decision |
|---|---|---|
| 30 Sep 2026 | Q1 | Keep the bin rule |
| 30 Sep 2026 | Q2 | "for the brand its unbranded and category uncategorized". Plan keeps all three brand placeholders, pending confirmation |
| 30 Sep 2026 | Q3 | Remove completely |

---

## 2. How it works today

### 2.1 "Needs details" filter

- `src/app/(dashboard)/stock/page.tsx:319`: the chip sends `status=ACTIVE&needsDetails=true`.
- `src/app/api/products/route.ts:85-110`: `needsDetails` pushes `OR: [brand name ∈ placeholders, productHasNoBinWhere()]`.
  The comment at `:94-97` says category is **deliberately** excluded, because every product was once `Uncategorized`.
- `src/lib/import-placeholders.ts:59-80`: `isPlaceholderCategory` says that is no longer true (665 of 5,738 products),
  and that the card tests category while the filter does not *on purpose*. It adds: *"If that queue is ever widened
  to include category, change both together."* The card already tests it, so only the filter changes.
- `stock-card.tsx:221,228` and `stock-table.tsx:193,204` already render both placeholders muted. No change is needed there.
- The explanatory line at `stock/page.tsx:704-716` already says "brand or category". It stays correct.

### 2.2 Stock audit brand picker (end to end)

| Where | What |
|---|---|
| `stock-audit/[id]/page.tsx:154-155` | `brands`, `brandList` state |
| `stock-audit/[id]/page.tsx:290-304` | fetches `/api/brands` just for the picker |
| `stock-audit/[id]/page.tsx:377, 411` | sends `suggestedBrand` on auto-save and manual save |
| `stock-audit/[id]/page.tsx:1009-1030` | the amber "Brand (current: …)" `<select>` |
| `api/stock-counts/[id]/items/route.ts:30, 236` | accepts and stores `suggestedBrand` |
| `lib/validations.ts:227` | `suggestedBrand` on the approve schema's items |
| `api/stock-counts/[id]/route.ts:311, 404-434, 656` | on apply, overwrites a placeholder brand; `brandNotices` in response (no client reads it; verified by grep) |
| `stock-audit/[id]/review/page.tsx:92, 223, 460-462` | "Suggested Brand" export column and "(Sug: …)" label |
| `prisma/schema.prisma:1078` | `StockCountItem.suggestedBrand String?` |

---

## 3. Implementation plan

### Part A: filter (R1–R4)

**A1. `src/app/api/products/route.ts`**: add a third OR branch and rewrite the comment block:
```ts
{ category: { name: { equals: PLACEHOLDER_CATEGORY, mode: "insensitive" } } },
```
Import `PLACEHOLDER_CATEGORY`. The brand and bin branches are unchanged. A `log.debug` goes on the
filter branch (`needsDetails`, `search`, `storeId`) so the query mode is visible.

**A2. `src/lib/import-placeholders.ts`**: update the `isPlaceholderCategory` doc comment. The filter now tests
category, so the card and the filter agree again. Comment only, no code change.

### Part B: remove audit brand (R5–R6)

**B1. `stock-audit/[id]/page.tsx`**: delete the `brands`/`brandList` state, the `/api/brands` fetch effect,
both `suggestedBrand` spreads, and the `<select>` block. Keep the read-only `| Brand` text in the row header (`:899, :950`).
The "dirty with only a brand suggestion" comment at `:415` is reworded.

**B2. `api/stock-counts/[id]/items/route.ts`**: remove `suggestedBrand` from `lineSchema` and from the update.
zod strips unknown keys, so an old tab that still sends it is silently ignored and not refused.

**B3. `api/stock-counts/[id]/route.ts`**: remove the brand-apply block (`:404-434`), `brandNotices`, and the
`isPlaceholderBrand` import. The response keeps `{ ...result, applied }`. Drop `brandId`/`brand` from the product
select at `:373` if nothing else there reads them.
**Effect on audits already in progress:** any `suggestedBrand` saved before this deploy is **not** applied. That is intended (R6).

**B4. `lib/validations.ts:227`**: remove `suggestedBrand` from the approve items schema.

**B5. `stock-audit/[id]/review/page.tsx`**: remove the "Suggested Brand" export column, its mapping, the
"(Sug: …)" span, and `suggestedBrand` from the local type.

**No schema change.** `StockCountItem.suggestedBrand` stays as an unused nullable column (additive-first,
CLAUDE.md rule 7). Dropping it is a separate, later migration if wanted.

### RBAC
None. No permission is added or changed.

### Logging
A1 adds `log.debug`. B3 removes two log lines that belonged to the deleted block. No `catch` is added or removed.

### Board of agents
- **Inventory consultant**: Needs details is a data-quality queue, and widening it to category matches its purpose.
- **Backend engineer**: zod stays strict on the fields that remain. No client is the only gate.
- **Frontend engineer**: removes one network call per audit screen load. No layout change beyond one row fewer per item.

---

## 4. Verification

1. `npm run build` passes.
2. `/stock` → **Needs details**: an `Uncategorized` product with a real brand and a bin appears; an `Unbranded`
   product appears; a product with a real brand, a real category and a bin does not; a product with no bin still appears.
   Search inside the filter still narrows the results.
3. `/stock-audit/<id>` (in progress): item rows have no brand dropdown; counting and auto-save still work.
4. Approve with "apply to stock": stock is corrected and no product's brand changes.
5. Review page: the export has no "Suggested Brand" column.

---

## 5. Out of scope

- Dropping the `StockCountItem.suggestedBrand` column (needs a migration; do later if wanted).
- Making `Product.brandId` / `categoryId` nullable (the root cause described in `import-placeholders.ts`).
- The brand-count audit (`stock-audit/brand-count`), which has no per-item brand picker.
- Changing the bin branch of the filter.
