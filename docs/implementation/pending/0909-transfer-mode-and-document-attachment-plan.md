# Transfer mode is chosen, the document is attached, and GST leaves the store form

Status: in-progress — 9 Sep 2026 evening, building on branch feat/0909-stock-po-expense after the owner answered Q2–Q14 (see §7, second round)
Branch: **not cut yet** — tell me which branch to base it on before I create one.

---

## 1. The requirement, verbatim

> need to update this where the gst attachment should be like file or photo where not respect
> to the store setting it in the databse with calumn where same for the like gst for store to
> store and Dc file when rranswering from store to warehosue and also seletion of the store to
> store ( gst ) store to warehouse ( dc file uplod ) store the file in aws s3 buckets -> check
> weathere is there any provider --> we need to remove the gst things ui related in /store on
> edit in the creaton of the storck transfer where i need two button like store to stor or
> store to warehosue on selecting the store to store in the left and right it yst show the
> stores and on selecting the store to warehouse i need to get in the left i need store listing
> and in the right side the warehouse all teh ware house not only the store specific warehouse
> --> this is my requiremnt create a implmenation plan for this requiremnt and ask any doubts
> if u have regarding the requremnets and clarification if u needed where while stock transfer
> we need to attach the gst and bc file upload that is attach it it must not validate weathere
> the store has the gst written in the store scoped data in the databse that is different check
> the existing code and make a review and create a proper implmenation

### How I read it

1. `/transfers/new` gets **two mode buttons** — **Store → Store** and **Store → Warehouse**.
2. **Store → Store** — left panel lists stores, right panel lists stores. Document = the **GST document (tax invoice)**.
3. **Store → Warehouse** — left panel lists stores, right panel lists **every warehouse**, not only the picked store's. Document = the **delivery challan (DC)**.
4. The document is a **file or a photo**, attached while the transfer is being created, its URL kept in a column.
5. The document is **never** gated on whether the store has a GSTIN saved. Store GST and transfer GST are different things.
6. The **GST inputs come off `/stores`** (create and edit).
7. The file goes to an **S3 bucket** — and first, check whether a provider already exists.

---

## 2. Questions — please answer these before I build

Everything below was read off the code and the live database on 9 Sep 2026. Each question is one
the code genuinely cannot answer for me, and each carries my recommendation.

### Q1 — BLOCKING. When you pick a **store** on the left, which warehouse does stock leave from?

This is the one thing that stops me writing code today.

**Stock does not live in a `Store`. It lives in a `Warehouse`** (`StockLevel.warehouseId`), and
every warehouse belongs to exactly one store (`prisma/schema.prisma:287,292`). A transfer's lane
is `TransferOrder.fromWarehouseId → toWarehouseId` (`:1768-1771`). There is no `fromStoreId`
column anywhere.

I read the live database (read-only) and there are **two stores with exactly one warehouse each**:

| Store | code | its warehouses |
|---|---|---|
| BCH Store | `BCH_STORE` | `BCH_WAREHOUSE` — "BCH Warehouse" |
| BCC Store | `BCC_STORE` | `BCC_WAREHOUSE` — "BCC Warehouse" |

So on today's data **"BCH Store → BCH Warehouse" is one stock location moving to itself**, and
the two modes would pick the same pair of places. Which of these is the real shop?

- **(a) — RECOMMENDED, if it matches the shop.** A store has a **shop floor** and a **godown**,
  and those should be two warehouse rows (`BCH Floor`, `BCH Godown`). "Store" on the left means
  that store's **floor**; "warehouse" on the right means any godown. The 0409 plan already
  assumed this shape — *"a floor is just a warehouse named 'BCH Floor'. No enum, no column"* —
  but the rows were never created. Pick this and tell me the warehouse names; I will seed them.
- **(b)** A store resolves to its **primary warehouse** (lowest `sortOrder`, then name), and
  Store → Warehouse just means the destination may be any warehouse in the business, including
  one belonging to another store. Buildable today with no new rows — but until a second warehouse
  exists per store, the modes differ only in which document they demand.
- **(c)** Add `Warehouse.kind { FLOOR, GODOWN }` and drive the left panel from `FLOOR` rows and
  the right panel from every row. More schema, same result as (a).

> **Decision on record — 9 Sep 2026.** Answered by
> `0909-stock-store-and-warehouse-scoping-plan.md` (its D1 + D2), which ships **first**: the
> shop floor is a second `Warehouse` row per store (`BCH_FLOOR`, `BCC_FLOOR`) and
> `Warehouse.kind { FLOOR, GODOWN }` is a real column — option **(c)**. A store picked on the
> left resolves to its first `FLOOR` warehouse by `sortOrder`, then name; the right panel in
> Store → Warehouse lists every active warehouse of any kind except the resolved source (Q7).
> `resolveStoreWarehouse` in §4.2 becomes a one-line lookup on `kind`. This plan is unblocked
> once that plan's Part A has landed; nothing else in it changes.

### Q2 — Does the **mode alone** decide the document?

Store → Store ⇒ **tax invoice (GST)**. Store → Warehouse ⇒ **delivery challan**. The GSTIN is
never consulted again.

**Recommended: yes.** That is what "it must not validate whether the store has the GST written"
means, and it lets `src/lib/transfers/policy.ts:44-80` go — the function that today *refuses*
every store-to-store transfer while a GSTIN is blank.

### Q3 — Is the attachment **mandatory to create** the transfer?

Today the document is attached **later**, on the detail page, and **dispatch is blocked** until it
is there (`api/transfer-orders/[id]/dispatch/route.ts:100-111`).

**Recommended: optional at creation, still required before dispatch.** The tax invoice is often
raised in Zoho Books minutes after the order is keyed, and making it mandatory at create would
strand a transfer that is otherwise ready to go. Say the word and I will make it mandatory.

### Q4 — Do we still ask for the **document number** and **date**?

`POST /api/transfer-orders/[id]/document` requires `docNumber` (1–40 chars) and takes an optional
`docDate` (`document/route.ts:15-21`).

**Recommended: keep both on the create form beside the file** — number required whenever a file is
attached, date optional. The number is what a tax officer matches against; a bare file with no
number is much less useful.

### Q5 — How is the mode recorded in the database?

Today there are two *derived* columns: `transferType TransferType?` (`INTRA_STORE | INTER_STORE`)
and `requiredDocType TransferDocType?` (`DELIVERY_CHALLAN | TAX_INVOICE`) —
`prisma/schema.prisma:1776-1777`.

**Recommended:** add `enum TransferMode { STORE_TO_STORE, STORE_TO_WAREHOUSE }` and
`TransferOrder.mode`; keep writing `requiredDocType` (it already drives the dispatch gate, the
detail chip and the Document card) but set it **from the mode**; stop writing `transferType` and
drop that column a release later, per CLAUDE.md rule 7.

**`TransferOrder` has 0 rows** (verified), so no backfill is needed and no history is at risk. If
you would rather not add an enum, the alternative is to add the two values to `transferType` — but
then `INTRA_STORE`/`INTER_STORE` linger as dead values forever.

### Q6 — On `/stores`, remove exactly what?

**Recommended:** remove the **GSTIN input**, the **state-code input**, the explanatory line under
them, and the GSTIN on each store row including the amber **"No GSTIN"** badge —
`src/app/(dashboard)/stores/page.tsx:217-231`, `:247-249`, `:313-319`, plus the `gstin`/`stateCode`
members of `Draft` at `:48`, `:160`, `:332`. **Keep the `Store.gstin` / `Store.stateCode` columns
and the API** (rule 7: a column is dropped a release after the code stops using it).

Two things worth knowing before you answer:

- **The form already never saved the GSTIN.** `save()` at `:98-104` posts only
  `code, name, address, phone, invoicePrefix`. `draft.gstin` is typed, upper-cased on every
  keystroke, and then thrown away. That is why both stores have `gstin: null` — and why **every
  store-to-store transfer is refused today** with *"Set the GSTIN for BCH Store on /stores…"*.
  Your requirement clears a live blocker, not just a preference.
- The **purchase-order PDF and email** print the store's GSTIN when it is set
  (`src/lib/purchase-orders/pdf.ts:125`, `email.ts:81,106`). They print nothing today. After this
  change there is no UI that could ever fill it. **Do you want one company GSTIN under Settings for
  the PO document?** Recommended: not in this plan — flagged, separate.

### Q7 — Store → Warehouse: does the right panel really list **every** warehouse?

**Recommended: yes** — every active warehouse in the business, including ones under the store you
picked on the left, with only the resolved **source** warehouse removed so a transfer cannot go to
itself. That is what "all the warehouses, not only the store specific warehouse" says.

### Q8 — **Storage is not configured at all right now.** How do you want it set up?

You asked me to check for a provider. There is one, and it is good — no S3 code needs writing:

- `src/lib/storage/s3.ts:20` — a full **S3 provider**: SigV4 signing via `aws4fetch`
  (`package.json:33`), presigned PUT (`:69`), `put` (`:79`), `exists` (`:112`), `delete` (`:117`),
  and even bucket-CORS read/apply (`:140`, `:178`). There is **no `@aws-sdk` dependency**; the
  provider talks to S3 over plain signed HTTP. It is a rename of the old R2 provider — R2 was
  S3-compatible, so it carried over.
- `src/lib/storage/index.ts:1-5` — which provider is live is **data, not config-at-boot**: it comes
  from the `StorageConfig` row and is switched at **Settings → Storage** with no redeploy.
- `src/lib/storage/upload-policy.ts:21,57` — the `transfers/` key prefix already exists and is **the
  only prefix that accepts `application/pdf`** as well as images.
- `src/lib/media-upload.ts:55` — the browser helper: presigned PUT to the bucket, `POST /api/upload`
  as the fallback when the provider cannot presign or CORS fails (under 4 MB, `:31`).
- Supabase storage is **gone** — `@supabase/supabase-js` is still in `package.json:23` but is
  imported nowhere in `src/`.

But:

> **There is no `StorageConfig` row in the database, and `.env` carries stale `R2_*` names while
> the bootstrap path reads `S3_*` (`storage/index.ts:63`). So `getStorage()` throws
> `StorageNotConfiguredError` and every upload in the whole app answers 501 today.**

**Recommended:** you open **Settings → Storage** and enter the S3 bucket, region, access key,
secret and public base URL, then run its test and activate. That is a data change, no deploy.
Tell me if you would rather I add `S3_*` to `.env` instead — but the database row wins over env
once it exists, so the screen is the honest place.

### Q9 — Two panels on a phone?

`/transfers/new` is used on mobile. "Left and right" becomes **stacked cards, source then
destination**, on a narrow screen and a true two-column grid from `sm:` up.
**Recommended: yes.** Say so if you want a side-by-side split even on a phone.

### Q10 — Wording on the detail page

The chip at `transfers/[id]/page.tsx:227-238` says *"Inter-store" / "Within one store"*.
**Recommended:** it becomes *"Store → Store" / "Store → Warehouse"*, matching the buttons.

### Q11 — E-way bill

`EWAY_BILL_THRESHOLD = 50_000`, the dispatch warning and the `eWayBillNo` field
(`policy.ts:87-98`, `dispatch/route.ts:206-213`) are untouched by this change.
**Recommended: leave them exactly as they are.**

---

## 3. Where the code stands today

Read on disk 9 Sep 2026. File and line are given so the next reader can check rather than trust.

### 3.1 The create form is two flat warehouse dropdowns — there is no store picker

`src/app/(dashboard)/transfers/new/page.tsx`

| Line | What is there |
|---|---|
| `:112` | `useWarehouses()` → `GET /api/warehouses` with **no** `storeId` filter (`src/hooks/use-sites.ts:53`) |
| `:117-118` | `chosenFrom` / `chosenTo` — two warehouse ids |
| `:139-143` | effective `fromWarehouseId` / `toWarehouseId`, defaulted to the first two warehouses |
| `:305-311` | the **From** `<select>`; options labelled `${w.store.name} · ${w.name}` |
| `:316-321` | the **To** `<select>`; the only filter is `w.id !== fromWarehouseId` at `:318` |
| `:77-104` | `previewPolicy()` — a browser mirror of the GSTIN rule |
| `:88-95` | reads `from.store.gstin` / `to.store.gstin`; a blank one returns `kind: "blocked"` |
| `:328-352` | the three policy banners — blocked / tax invoice / delivery challan |
| `:452` | *"Set the missing GSTIN before raising this transfer."* — the submit-blocked hint |
| `:39-64`, `:145-162` | the `sessionStorage` draft, key `"transfer-order-draft-v2"` |
| `:239-244` | the POST body: `{ fromWarehouseId, toWarehouseId, items, notes }` — **no mode, no document** |

The store name is a label prefix on the dropdown, nothing more. It filters nothing.

### 3.2 The document type is derived from the GSTIN, and that is what refuses

`src/lib/transfers/policy.ts:44-80` — `deriveTransferPolicy(from, to)`:

- same `storeId` → `INTRA_STORE` + `DELIVERY_CHALLAN`; the GSTIN is not consulted (`:45-51`)
- different stores, **either GSTIN blank** → `{ error: "Set the GSTIN for … on /stores …" }` (`:58-68`)
- different stores, GSTINs equal case-insensitively → `DELIVERY_CHALLAN`; different → `TAX_INVOICE` (`:70-79`)

Called at `api/transfer-orders/route.ts:204-206` (create, 400 on error) and
`api/transfer-orders/[id]/approve/route.ts:149-158` (re-derived on approve, 400 on error).

**Both stores have `gstin = null`**, so every store-to-store transfer is a 400 today and the form
disables the button before you can even try.

### 3.3 The document plumbing already exists and works

| Piece | Where |
|---|---|
| columns `docType`, `docNumber`, `docDate`, `docUrl`, `docUploadedById/At`, `eWayBillNo`, `consignmentValue` | `prisma/schema.prisma:1780-1787` |
| attach route — `docNumber` required, URL must start `transfers/<orderNo>/` | `api/transfer-orders/[id]/document/route.ts:15-21`, `:82-94`, `:105-116` |
| replace allowed only while `PENDING`/`APPROVED` | `document/route.ts:73-80` |
| dispatch gate — no `docUrl`, or the wrong `docType`, refuses | `dispatch/route.ts:100-111` |
| upload card, `accept="application/pdf,image/*"` | `transfers/[id]/_components/document-card.tsx:91-131`, `:235-238` |
| key shape | `document-card.tsx:101` — `transfers/${orderNo}/tax-invoice-${Date.now()}.pdf` |
| prefix + mime allowlist | `src/lib/storage/upload-policy.ts:21`, `:57` |

**One document per order** — scalar columns, no attachments table, no multi-file support.

### 3.4 `/stores` and GST

Covered in Q6. Short version: the inputs exist, are never submitted, and both stores are blank.
`Store.stateCode` is loaded in four places and **read by no logic anywhere** — its only appearance
on screen is `stores/page.tsx:316`.

### 3.5 Storage

Covered in Q8. The provider code is ready; the configuration row is missing.

---

## 4. The build — assuming the recommended answer to every question

Nothing here is written until §2 comes back. Q1 in particular reshapes §4.2.

### 4.1 Schema — one migration, additive only

`prisma/schema.prisma`:

```prisma
/// Chosen on the form, not derived. Store to store carries a tax invoice; store to warehouse
/// carries a delivery challan. The GSTIN is deliberately NOT consulted — a store's tax
/// registration is master data, and the document that travels with a van is not.
enum TransferMode {
  STORE_TO_STORE
  STORE_TO_WAREHOUSE
}
```

On `TransferOrder`, beside `transferType` at `:1776`:

```prisma
mode        TransferMode?  // null = raised before the mode existed
fromStoreId String?        // the store the user actually picked, kept because the
toStoreId   String?        // warehouse it resolved to can be re-pointed later
```

`fromStoreId`/`toStoreId` are a **snapshot of what was chosen**, for the same reason
`transferType` is a column and not a computed property (`policy.ts:30-32`). Relations to `Store`
are `onDelete: Restrict`, matching every other lane FK. No `@@index([mode])` until a query needs
one.

`npx prisma migrate dev --name transfer_mode_and_store_lane` on **localhost only** (rule 2), SQL
read before committing (rule 3), `npm run db:snapshot` before the PR merges (rule 9).

### 4.2 A mode resolver replaces the GSTIN policy

New `src/lib/transfers/mode.ts`. `src/lib/transfers/policy.ts` loses `deriveTransferPolicy` and
keeps `docTypeLabel` and `EWAY_BILL_THRESHOLD`, which have other callers.

```ts
export function docTypeForMode(mode: TransferMode): TransferDocType {
  return mode === "STORE_TO_STORE" ? "TAX_INVOICE" : "DELIVERY_CHALLAN";
}
```

plus `resolveStoreWarehouse(storeId)` — **whose shape is Q1**. Under (a) it returns that store's
floor warehouse; under (b) the lowest-`sortOrder` active warehouse; and it refuses with a message
naming the store when it has none.

Every refusal calls `log.warn` with `{ storeId, mode }` before it returns.

### 4.3 API

`src/app/api/transfer-orders/route.ts`

- `createSchema` (`:50-58`) becomes a **discriminated union on `mode`**:
  - `STORE_TO_STORE` → `{ fromStoreId, toStoreId }`
  - `STORE_TO_WAREHOUSE` → `{ fromStoreId, toWarehouseId }`
  - both keep `items` and `notes`.
  A union, not four optional fields, so the server cannot be handed a half-filled body.
- `:204-206` — `deriveTransferPolicy(...)` is deleted; `requiredDocType = docTypeForMode(mode)` and
  the lane comes from `resolveStoreWarehouse`.
- `:260-261` — persist `mode`, `requiredDocType`, `fromStoreId`, `toStoreId`; stop writing
  `transferType`.
- The same-warehouse guard at `:180-182` stays, and now also catches "the store you picked resolves
  to the warehouse you picked", with a message naming both.

`src/app/api/transfer-orders/[id]/approve/route.ts:149-158` — the re-derivation block goes. Any
order created after this change already carries `requiredDocType`; a null one (there are none) is
left alone rather than guessed at.

`src/app/api/transfer-orders/[id]/document/route.ts` — **unchanged**. It already validates the key
prefix, the doc type against `requiredDocType`, and the status window.

### 4.4 `/transfers/new`

`src/app/(dashboard)/transfers/new/page.tsx`

1. **Mode buttons** at the top — two segmented buttons, `STORE_TO_STORE` / `STORE_TO_WAREHOUSE`.
   Switching mode clears the destination and never the item list.
2. **Two panels.** Left is always the store list (`useStores()`, the hook `/stock-audit/new` already
   uses). Right is stores in mode 1 and **every active warehouse** in mode 2 — grouped under their
   store's name, so `BCC Warehouse` is legible when the source store is BCH. Selected cards get the
   same treatment as the audit screen's chips (`stock-audit/new/page.tsx:204-244`), so this looks
   like the rest of the app rather than a new dialect.
3. **`previewPolicy()` (`:77-104`) is deleted**, along with the blocked banner (`:328-336`) and the
   hint at `:452`. One line under the panels states which document the mode requires.
4. **Document block** — a file input (`application/pdf,image/*`), a document-number field and an
   optional date, reusing the copy already in `document-card.tsx`.
5. **Submit order matters.** The upload key needs `orderNo`, which does not exist until the order is
   created. So: `POST /api/transfer-orders` → read `orderNo` from the response → `uploadMedia` to
   `transfers/<orderNo>/…` → `POST /api/transfer-orders/[id]/document`. One button, three steps,
   each logged. If step 2 or 3 fails, the order still exists and the screen says *"Transfer TRF-…
   was created. The document did not upload — attach it on the transfer."* with a link. This is
   honest behaviour only while the document is optional, which is why Q3 matters.
6. Draft key `"transfer-order-draft-v2"` → **`-v3`** (`:39`): the stored shape changes, and a v2
   draft would restore warehouse ids into store fields.

### 4.5 `/stores`

`src/app/(dashboard)/stores/page.tsx` — delete `:217-231` (both inputs), `:247-249` (the helper
line), `:313-319` (the row display and the amber badge), and the `gstin`/`stateCode` members of
`Draft` at `:48`, `:160`, `:332`. `save()` at `:98-104` is already correct and is not touched.

`storeSchema` (`src/lib/validations.ts:1036-1050`) and both stores API routes keep their `gstin`
handling. Nothing sends it; removing it would be a second, unrelated change.

### 4.6 Detail and list screens

- `transfers/[id]/page.tsx:227-238` — the chip reads `mode`, worded per Q10.
- `transfers/[id]/page.tsx:30` and `api/transfer-orders/[id]/route.ts:53,56` — the
  `store: { gstin, stateCode }` selects come out; nothing renders them.
- `src/lib/warehouses.ts:53-62` and `src/lib/stores.ts:32-36` — `gstin`/`stateCode` come out of both
  cached selects and `WarehouseRef`/`StoreRef` shrink. `src/hooks/use-sites.ts:24` and
  `src/app/api/warehouses/route.ts:38-40` follow.
- `transfers/page.tsx:62-63` already types `requiredDocType`/`docUrl`; unchanged.

### 4.7 Logging

`createLogger("transfers:create")` in the route, `createLogger("transfers:new")` on the page.
`log.info` on a created order with `{ orderId, orderNo, mode, itemCount }`; `log.warn` on every
refusal with the ids; `log.error` around each of the three submit steps. No payload bodies, and
never the presigned PUT URL — it is a credential.

### 4.8 RBAC

Unchanged. `transfers.create` still guards creation, and the document route still accepts the
creator or `transfers.edit` (`document/route.ts:68-71`). No role name is introduced anywhere.

---

## 5. What this plan deliberately does not do

- **Does not drop `Store.gstin` / `Store.stateCode`.** Rule 7. A later release drops them, once the
  PO-document question in Q6 is settled.
- **Does not drop `TransferOrder.transferType`.** It stops being written; it is dropped a release
  later.
- **Does not touch the e-way bill logic** (Q11).
- **Does not add multi-file attachments.** One document per order, as today.
- **Does not configure storage.** That is Q8, and it is data, not code.
- **Does not fix the two storage gaps found on the way** — four routes write keys under `service/`
  and `purchase-orders/`, prefixes that are not in `ALLOWED_PREFIXES`, because they call
  `storage.put()` directly and skip `checkUpload()`; and size/MIME limits are duplicated across five
  routes with different caps. Both are real, neither is this requirement. Say the word and I will
  file them as their own plan.

---

## 6. Verification

1. `npm run build` — must pass. (You run this; it takes 21–45 minutes.)
2. `npx prisma migrate status` against the target, then `npx prisma migrate deploy` **by hand** —
   nothing applies migrations automatically since 7 Sep (CLAUDE.md rule 4).
3. Browser walk:
   - **Settings → Storage** — configure S3, run the test, activate, and apply bucket CORS
     (`/api/settings/storage/cors`) so the direct-to-bucket PUT works from the browser.
   - `/stores` → edit a store: **no GSTIN field, no state code, no amber badge**; saving still works.
   - `/transfers/new` → **Store → Store**: both panels list stores, the note says tax invoice,
     attach a PDF, submit, land on the detail page with the document showing.
   - `/transfers/new` → **Store → Warehouse**: left lists stores, right lists **every** warehouse
     grouped by store, the note says delivery challan, attach a **photo**, submit.
   - Approve, then **dispatch with no document** → refused; with the right document → allowed.
   - Confirm no transfer is refused anywhere for a missing GSTIN.

---

## 7. Clarifications — 9 Sep 2026

Run of `/clarify-plan` against the code on disk. Nothing in this section is carried over from
an earlier session; every row was re-read the same day.

### Verified against code

| Claim | Verdict | Evidence |
|---|---|---|
| Create form: two flat warehouse selects, GSTIN preview, draft key v2, POST body without mode or document | CONFIRMED | `transfers/new/page.tsx:39,77-104,112,239-244,305-321,452` |
| `deriveTransferPolicy` refuses store-to-store on a blank GSTIN | CONFIRMED | `src/lib/transfers/policy.ts:44-77`; both stores `gstin: null` (live) |
| Approve route re-derives the policy | **DRIFTED** | `approve/route.ts:151` runs it only when `requiredDocType` is null — a backfill. §4.3 deletes a backfill branch, not a re-derive. |
| Document route requires the URL to *start* with `transfers/<orderNo>/` | **DRIFTED** | `document/route.ts:91` is `includes`, not `startsWith` |
| Upload key `tax-invoice-<ts>.pdf` | **DRIFTED** | `document-card.tsx:101` already switches tax-invoice / delivery-challan by doc type; extension from the compressor. §4.4 reuses it verbatim. |
| Document route: docNumber 1–40 required, docDate optional, PENDING/APPROVED only, creator or `transfers.edit` | CONFIRMED | `document/route.ts:17-18,68-70,73-79` |
| Dispatch gate and e-way warning | CONFIRMED | `dispatch/route.ts:100-111,210-213` |
| `/stores` inputs exist; `save()` never sends `gstin`/`stateCode` | CONFIRMED | `stores/page.tsx:98-104,217-229,313-319` |
| Schema: `TransferOrder` columns; no `Warehouse.kind`; no `TransferMode`; newest migration `20260908161249` | CONFIRMED | `prisma/schema.prisma:285-317,1768-1787` |
| Two stores, one warehouse each; 0 `TransferOrder`; 0 `StorageConfig` rows | CONFIRMED | live query, `.env` → localhost `bch` |
| Storage: S3 provider via aws4fetch; `transfers/` accepts PDF; `uploadMedia` fallback; Settings → Storage and the CORS route exist | CONFIRMED | `storage/s3.ts:10,20`, `upload-policy.ts:21,55-56`, `media-upload.ts:31,55`, `settings/storage/page.tsx`, `api/settings/storage/cors/route.ts` |
| `.env` has `R2_*` only; bootstrap reads `S3_*` | CONFIRMED | `storage/index.ts:63-71` |
| A `LOCAL` provider exists (not mentioned in Q8) | NOTED | `storage/local.ts`; `StorageConfig.provider` default `LOCAL` (`schema.prisma:1132-1140`) |
| Any partial implementation on disk | **NONE** | `git status` clean under transfers, transfer-orders API, `src/lib/transfers`, stores page, schema; repo-wide grep for `TransferMode`/`STORE_TO_*`/`fromStoreId` empty |
| Q1 dependency | CONFIRMED | `0909-stock-store-and-warehouse-scoping-plan.md` D1/D2/§6: `enum WarehouseKind { FLOOR, GODOWN }`, `Warehouse.kind @default(GODOWN)`, migration `warehouse_kind`, seed `BCH_FLOOR`/`BCC_FLOOR` at `sortOrder` 5. None of it exists on disk yet. The scoping plan's own requirement (R1–R5) does **not** contain any of this plan's requirement; it only supplies the column §4.2 reads. |

### Answers — owner, 9 Sep 2026

- Q1 floor model — settled by the scoping plan (option c). The two earlier stock plans that disagreed on the enum were replaced by the scoping + screens split the same day.
- Q8 storage — **S3, configured at Settings → Storage** (bucket, region, keys, public URL; test; activate). No `.env` change, no code.
- Sequencing — the scoping plan's **Part A ships first**; this plan follows. Branch naming is deliberately **not** decided here (owner: "don't include the branch in this ask").
- Q2–Q11 — recommendations stand; **not yet accepted or changed by the owner**. Open.

### Open — need the owner's answer before code

- **Q12 — Godown → floor has no mode.** Under Q1(c) the left panel's store resolves to its FLOOR. Store → Warehouse can therefore move floor → godown (the right panel lists every warehouse), but nothing can move **godown → floor**, which is the most frequent movement in a shop. Scoping-plan D3 uses two audits for the one-time opening split only. Options: (a) accept, restock the floor by audit; (b) a third button **Warehouse → Store** (source = any warehouse, destination = a store's floor, delivery challan); (c) keep today's plain **Warehouse → Warehouse** as a third button. Recommended: **(b)**.
- **Q13 — `/stores` scope.** Owner's words were "on edit"; the page is one form for create and edit, so §4.5 removes the inputs from both. Default: both.
- **Q14 — `document/route.ts:91` `includes`.** Tighten to `startsWith` while touching the create flow, or leave and file it in §5 with the storage gaps. Default: leave.
- **Q3 timing note.** After scoping Part A the floor holds 0 until the D3 audits run, so the §6 browser walk needs the opening split done first or every Store → Store transfer is refused for stock.

### Answers — owner, 9 Sep 2026, second round (verbatim, then applied)

> see this implmenation is not done properly /transfers/new in this Set the GSTIN for BCH Store
> and BCC Store on /stores before transferring between stores. Open /stores where it must be
> document uploding where it must not be there where in the in the /store edit when i edit the
> store and enter the store gst nmuber then it not saving teh gst why after saving and if seee
> edidt the gst data is not here the requiremnet is that in the /transfer/new while creating if
> the transfer is from the store to store i must attach a file where as a gstn and store to
> warehouse means dc file upload i need in that screen a required filed of file upload of kind
> and not the store gst filed must not make any validation in the transfer sceen its just we
> upload a file related to shope store to store means gts and stor to warehosue menas dc file
> upload update respeceted to this requiremnt use multiple agent and complete the requiremnet fast

- **Why the GSTIN never saved** — §3.4 already had it: `save()` on `/stores` posted only code,
  name, address, phone and invoice prefix; the typed GSTIN was discarded. Not fixed — removed,
  as the requirement asks (Q6 below).
- **Q2** — yes. The mode alone decides the document; the GSTIN is never consulted.
- **Q3** — **the file is REQUIRED when the transfer is created** ("a required field of file
  upload"). Different from the recommendation. Consequence for §4.4 step 5: the browser uploads
  the file FIRST (key `transfers/new/<ts>-<rand>.<ext>`) and then creates the order with
  `document.url` in the same request, so a transfer can never exist without its document and
  the "created but the document did not upload" state cannot occur.
- **Q4** — the document **number is optional**, date optional ("it's just we upload a file").
  `document/route.ts` relaxes `docNumber` to optional to match.
- **Q5** — as recommended: `TransferMode` enum, `mode`, `fromStoreId`, `toStoreId`; migration
  `transfer_mode_and_store_lane`, applied to local `bch` by Claude, to the cloud test database by
  the owner.
- **Q6 / Q13** — remove the GSTIN and state-code inputs, helper line and the amber badge from
  `/stores`, create and edit alike. Columns, API and the lib selects stay (the PO PDF reads
  `Store.gstin`; there is no UI to fill it — still flagged for a Settings field).
- **Q7** — yes, every active warehouse, grouped by store, minus the resolved source.
- **Q9** — stacked on a phone, two columns from `sm:`.
- **Q10** — "Store → Store" / "Store → Warehouse"; old rows with `mode = null` keep today's wording.
- **Q11** — untouched.
- **Q12 (godown → floor)** — **not decided by the owner; two modes only were built**, exactly as
  the requirement lists them. Consequence: nothing moves stock from a godown to a floor except a
  warehouse-scoped audit, and a store picked as the source resolves to its **floor**, which holds
  0 until the opening split (scoping plan D3) is done. Raised again in the manual-testing file;
  option (b), a third button Warehouse → Store, is still the recommendation.
- **Q14** — leave `includes`.
- **Storage** — still data, not code: Settings → Storage must have an active provider before any
  upload works; without it the create screen shows the helper's "Storage is not configured" line
  and no transfer is created.
