# Deliveries: the floor warehouse sells, the customer is saved, the customer schedules, and one detail screen shows what was paid

Status: pending — written 16 Sep 2026. **Phase 1 built** on `feat/1609-deliveries-p1-floor-warehouse` and **Phase 2 built** on `feat/1609-deliveries-p2-contact-self-fill` and **Phase 3 built** on `feat/1609-deliveries-p3-detail-zones-payment`, all 16 Sep 2026 (§6). All three phases built; `npm run build` and the browser walk (§4) outstanding.
Branch: Phase 1 on `feat/1609-deliveries-p1-floor-warehouse` (off `376fa13`, Q0); Phase 2 on
`feat/1609-deliveries-p2-contact-self-fill` (off Phase 1 `9974e9a`, owner); Phase 3 on `feat/1609-deliveries-p3-detail-zones-payment` (off Phase 2 `d3dd3d0`, owner).

Source of every decision: `docs/implementation/requiremnts/deliveries-outward-and-self-fill-requirements.md`
§4.0 — answers **A1–A46** and **B1–B5**, asked one at a time on 16 Sep 2026. Where that document's
§4.1 recommendations disagree with §4.0, §4.0 wins.

Every `file:line` in §2 was read from disk on 16 Sep 2026 (HEAD `376fa13`) by three Explore
agents and one schema review, and re-checked by hand where it decides the design. Check rather
than trust.

---

## 0. Requirement

### 0.1 The owner's words, verbatim (16 Sep 2026)

**First message**

> i need to tel me this where u are a senior developer where on this aplication  the reuirwmnt
> is that /deliveries screren we list the invoices  for delivery where  and i need u to list me
> out the related tables for this modeule  and the requremnt is that  in the screen where i see
> the deatils of the delivery item in that i  have a  save contact   tell me what is it doing
> is  i need it to save in databse aplication i dont want to download any thing whe i click
> the  save contact  and i need this like after saving the details  i need the details to be
> shaved in the customer table and tell me where is irt saving now and  only if the cutomer is
> saved then only i must be able to generate the link ie one thing mit must be save  and no
> duplication saving  if ts  already present   let me able to generate the link and after
> generating the link  fix the whats app issue where  it must use the phone number  that is
> there in the details  and also be able to copy the  link annd after the customer open the
> link they need to fill the form which is like this /fill/z2FSBN024dZanGOxRXUc2rlJ3ewwN33b
> in that form make teh alternative number as mandidtory and the normal number and alternative
> number must not be  same  and after te customer subbmit the delevery details   the status  of
> the delevery item must be  schedule  but still its pending  and it must be listing those in
> the scheuled filter items   and once  customer make the confiermation of the schedule  i thnik
> we can have some status we can have progress because we cant set that as the scheduled because
> we many not  know things  is the thing correct and let it  be in the progress and the user
> with the related permission will  check things  and make it schedule that  anotehr thing is i
> need to list the thing properly where if the customer choose the bengolore or outsidde
> bengalore it must list as per that aalso in the /deleveris listing it mist show with tagginng
> like bangalore and outstationed  and i dont  need the top navbar where when i list te
> deliveries/blr when i see the details of this then it  showing in the deliveries/ rout but i
> dont need in that make a saparate rouet and in that details screen i dont need the Outside
> Bangalore option  when teh schedule delevery cliccked same vice versa for  out stanfOutstation
> Deliveries  Inside Bangalore should not be seen  when the schedule delevery in the details is
> clicked  and Estimated Delivery * also i think we n dont need ths because the customer would
> have choosen the related date  and that date must be shown   and as the status will be in the
> progeress and the user with the scheduling permission can schedule the  delevery and after
> that the dispatch is made  and marked as develary made  and i thinnk and i need u to tell me
> & 'f:\bharath  Cycle\BCH-Management\outwordfetch.js'  and this is the data that are fetched
> form the devery dispatch and  when i go inside se the details where i only see the insffecient
> i need a top nav were inside the details where it must show the related importsant details
> like payment sattus the balance  i think  i dont need  the tab to show related one e can show
> in the detils tab that is already present  and while saving the customer it must save in the
> custiomer tabele  and ignore  to save if the customer is already present  use phone numer as
> search ans inserting things   and when i see the details of the outward invoice  i need to see
> the items  that are in that outward too    this is my requiremnt create a folder inside the
> docs and  move this fole to it where the  file must contain the reuiremnts  listing first and
> doubts and clarification qustion in the file and i need u to look at the
> & 'f:\bharath  Cycle\BCH-Management\outwordapproevresponse.js' the response when i clicked import

**Second message — the status change**

> in the plan i need to change this like  i need to keep the scheduled time and as teh customer
> confirsms the and submits teh form by choosing that is scheduled time and must be named as
> schedules no need of progress option and  /deliveries/blr & 'f:\bharath  Cycle\BCH-Management\docs\asset\image.png'
> when i clict teh listin  i see this i need to be imporved i need to show the detaisl of paid
> and balace things  and i dont need this Estimated Delivery * at all remove it where the
> schedule time if taken by the customer not the  staff the staff must see the  scheduled time
> in the details

**Third message — which stock an outward reduces**

> what we will do is as the store dont hold the stoc where its warehouse where if the warehouse
> as a tag of  floor then  which holds the stock i think we need to give the prifix for the
> warehouse  which has the floore tag to add the invoice prefix not to the store where the
> warehouse with this tag acts as storeand while importing and   the invoice it should use the
> warehouse and reduce from the related stock and i think addind the prefix must be manditory
> in the aplication level let keep  it null in databse level and in the deleveries when i make
> it walk out i think i dont need the have  it has  schedule deletry and other things ijust makr
> it as the   walkout and  stock must be resuced  and  the cutomer data must be added first and
> then  mared as the walkout  and lets have the thing of setting the primary store   in the
> store for the warehouse with the floore tag as manditory which one as primary for the floor
> tag if it has more than one floor tag warehose ware for  us its store holding stock  this is
> my requiremnt   update the related requiremnt and ask any question if u need clarity

**Fourth message — this plan**

> i need u to creta e implmenation file inside the  pending foler for this requiremnt
> and use that for implmenting

### 0.2 Restated as requirements

R1–R4 asked for explanations; they were answered in the requirements document and build nothing.
R16, R17 and R22 were **withdrawn** by the second message and are listed so nothing is lost.

| # | Requirement | Phase |
|---|---|---|
| R1 | Explain `/deliveries` and list every table it touches. | done (doc §2) |
| R2 | Explain what Save Contact does today and where it saves. | done (doc §3.1) |
| R3 | Explain `outwordfetch.js`. | done (doc §3.9) |
| R4 | Explain `outwordapproevresponse.js`. | done (doc §3.10) |
| R5 | Save Contact saves to the database and downloads nothing. | 2 |
| R6 | It saves into the `Customer` table. | 2 |
| R7 | Phone is the key for lookup and insert. | 2 |
| R8 | No duplicate: an existing customer is skipped and counts as saved. | 2 |
| R9 | The link can be generated only once the customer is saved. | 2 |
| R10 | WhatsApp uses the phone number on the delivery, and works. | 2 |
| R11 | The link can be copied. | 2 (exists; kept) |
| R12 | The alternate number is mandatory on the customer's form. | 2 |
| R13 | Main and alternate numbers must differ. | 2 |
| R14 | The customer's submit changes the status. | 2 |
| R15 | Those rows appear under the matching filter. | 2 |
| ~~R16~~ | ~~An in-between "in progress" status.~~ Withdrawn by R25. | — |
| ~~R17~~ | ~~A permission holder moves it to SCHEDULED.~~ Withdrawn by R25. | — |
| R18 | Lists follow the customer's Bangalore / outside-Bangalore choice. | 3 |
| R19 | `/deliveries` rows are tagged Bangalore or Outstation. | 3 |
| R20 | Opening a row from `/deliveries/blr` (or outstation) uses its own detail route, without the Actions/Details tabs. | 3 |
| R21 | The schedule form shows only the side that applies. | 3 |
| ~~R22~~ | ~~Replace the picker with the customer's date.~~ Superseded by R27. | — |
| R23 | The detail shows payment status and balance. | 3 |
| R24 | The detail shows the outward invoice's items. | 3 |
| R25 | No "in progress": the customer's submit makes the delivery **SCHEDULED**, and their chosen date is the scheduled date. | 2 |
| R26 | The customer, not the staff, takes the scheduled time; staff see it in the detail. | 2, 3 |
| R27 | "Estimated Delivery \*" is removed completely. | 2 |
| R28 | The detail opened from `/deliveries/blr` is improved and shows paid and balance. | 3 |
| R29 | Stock is held by warehouses; a FLOOR warehouse is "the store holding stock". | 1 |
| R30 | The invoice prefix is set on the FLOOR warehouse, not the store. | 1 |
| R31 | Import matches the invoice to a FLOOR warehouse, and the outward reduces that warehouse. | 1 |
| R32 | The prefix is mandatory in the application and nullable in the database. | 1 |
| R33 | A store with more than one FLOOR warehouse must mark one primary. | 1 |
| R34 | Walk-out is a straight action that reduces stock — no Schedule Delivery in the way. | 1 |
| R35 | The customer is saved before Walk-out. | 1 (gate), 2 (database save) |
| R36 | (process) This plan lives in `docs/implementation/pending/` and is what the build follows. | — |

---

## 1. Questions and clarifications — answer before build

Every business question is **answered**. The full wording, options and answers are in the
requirements document §4.0; they are summarised in §1.1 so this plan can be checked on its own.

| # | Question | Why it changes the build | Recommended default | **Answer** |
|---|---|---|---|---|
| **Q0** | Which branch does each phase start from? | B5 stacks three branches; the first one's base decides what Phase 1 is built on. The requirements are on `docs/1609-deliveries-and-priority-requirements` (`376fa13`, not pushed). | Phase 1 off that docs branch so the plan and the code travel together; Phase 2 off Phase 1's tip; Phase 3 off Phase 2's tip | **Phase 1 off `docs/1609-deliveries-and-priority-requirements` (`376fa13`) as `feat/1609-deliveries-p1-floor-warehouse` — owner, 16 Sep 2026; choosing it approved this plan and T1–T10.** Phases 2 and 3 are asked again before each. |

### 1.1 Decisions on record — owner, 16 Sep 2026

| # | Decision |
|---|---|
| A1, A4 | Save Contact: look up by phone; present → skip and link; absent → insert. No WALKIN special case. Guard `deliveries.edit`. |
| A2 | Store the link: `Delivery.customerId`. |
| A3, A12b, B3, B3b | Phones in this flow are written `+91-XXXXXXXXXX`. A wrong-length number keeps its digits (`+91-89512050058`). Existing delivery rows convert only when touched (Save Contact or staff edit); new imports are formatted. |
| A13 | Customer lookup tries `+91-XXXXXXXXXX` **and** the bare 10-digit form; old `Customer` rows are not rewritten. |
| A5 | "Customer saved" is enforced by the server on link generation, and by the button. |
| A6 | Schedule, Walk-out and Generate Link all require the saved customer. |
| A7, A8 | Link lasts **24 h**; once submitted the form is **locked**; staff correct mistakes themselves, no re-send. |
| A9 | WhatsApp uses the main phone only. |
| A10, A11, A12 | Customer form: main phone read-only; alternate mandatory on both branches; main ≠ alternate, client and server. |
| A14–A21 | Withdrawn with R16/R17 — no `IN_PROGRESS`, no requested-date column, no `deliveries.approve` gate. |
| A17 | A `VERIFIED` delivery's customer submit also goes to `SCHEDULED`. |
| A22, A34 | Bangalore / Outstation / **Not chosen**. Existing rows keep their value if the customer filled or the status is `SCHEDULED` or later; unfilled `PENDING`/`VERIFIED` become Not chosen. |
| A23 | Tags on `/deliveries` only (mobile cards + desktop table). |
| A24, A25 | The "top navbar" is the Actions/Details tab switcher: **removed**; one scrolling screen with a summary card on top. |
| A26, A37 | Every move to `SCHEDULED` tries to hold stock and **never fails** on a shortage: it is accepted without the hold and shows a red warning. |
| A27, A27b | Outstation customers get no date picker; their submit → `SCHEDULED` with no date. |
| A28 | Staff can still schedule, without a date. |
| A29 | New routes `/deliveries/blr/[id]` and `/deliveries/outstation/[id]`; `/deliveries/[id]` stays. |
| A30 | The row decides which side of the schedule form shows; both only when Not chosen. |
| A31, A32 | Zoho `status` and `balance` saved at import; a `CustomerInvoice` row overrides; old rows show "Payment: not available". |
| A33 | Items on the one-screen detail only. |
| A36 | The date editor uses the 10-per-day slot calendar. |
| A38 | "Reserve stock now" button on the short warning; Delivered still refuses without floor stock. |
| A39 | "Scheduled by customer – confirmation not sent" banner with a send button. |
| A40, A40b | An outward reduces **only the matched FLOOR warehouse**, never a godown; if short it is **refused**. |
| A41b, A41c | No prefix match → **Dummy**: no warehouse, **no actions**. |
| A41d, B1 | Primary FLOOR warehouse: mandatory to mark when a store has 2+; its only use is B1 — a pre-booked arrival's delivery takes the receiving store's primary floor. |
| A42, A42b | `INVOICE-003951` is a duplicate. The owner types `INV/` and `BCC/` on `/stores` after the build. |
| A43, A43b | Existing open deliveries are linked by a **"Match warehouses"** button on `/deliveries` (`deliveries.edit`), re-runnable, never overwriting. |
| A44, A45 | Walk-out keeps the handover checklist, on a **focused walk-out screen**. |
| A46 | The stock hold is counted on the matched FLOOR warehouse. |
| B2 | Staff can type or correct the phone in the Customer card before saving. |
| B4 | Every existing hold is **released once**; deliveries re-hold with "Reserve stock now". |
| B5 | One plan, three stacked phases, one commit per phase. |

### 1.2 Technical decisions taken for this plan (Claude, 16 Sep 2026 — object before Phase 1)

| # | Decision | Why |
|---|---|---|
| T1 | The Store → Warehouse prefix cutover ships **in Phase 1 in one go**: the resolver, both import paths, the preview and both deduction routes switch together. `Store.invoicePrefix` is no longer read or written and leaves the `/stores` form; the column is dropped in a later release (CLAUDE.md rule 7). | Schema review: `Store.invoicePrefix` is the whole resolution mechanism today (6 files). Half a cutover leaves imports with no warehouse. |
| T2 | "Dummy" is **derived**: an open delivery with `warehouseId IS NULL`. No flag column. `DELETE` stays allowed on a Dummy (`deliveries.delete`) so duplicates such as `INVOICE-003951` can be cleared; every other write is refused. | One source of truth; B1 and the Match button set the warehouse, which ends Dummy without a second write. |
| T3 | `Delivery.storeId` stays and is **derived from `warehouse.storeId`** at the same write. | Every existing `storeId` reader (store delete blockers, reports) keeps working. |
| T4 | Holds: `StockLevel.reservedQuantity` on the floor warehouse is the truth; `Product.reservedStock` becomes a **cache** recomputed from it in the same transaction (`recomputeReservedStock`, the twin of `recomputeCurrentStock`). | `dashboard/stats`, `lib/reorder.ts`, `inventory/outwards` and `/stock/[id]` read `Product.reservedStock` and stay untouched. |
| T5 | A delivery's hold is **all or nothing**: if any line is short on the floor, no line is held, `stockReservedAt` stays null. "Not held" is derived: status in `SCHEDULED, PACKED, OUT_FOR_DELIVERY, SHIPPED, IN_TRANSIT` and `stockReservedAt IS NULL`. No `stockShortAt` column. | B4 produces exactly the same state without a shortage, and both must show the same "Reserve stock now" button. A partial hold would need a per-line ledger the schema does not have. |
| T6 | Three-state zone is a **new enum column** `deliveryZone DeliveryZone?` (`BANGALORE`, `OUTSTATION`; null = Not chosen). `isOutstation` is written alongside it for one release and read nowhere new. | Schema review option (b): `isOutstation` is a bare boolean in ~15 files with no null handling. |
| T7 | `Delivery.balance` is `Decimal? @db.Decimal(12, 2)`; `Delivery.paymentStatus` is `String?`, a Zoho snapshot like `invoiceType`. | `database-architect.md` — no new `Float` money; `invoiceType` is the local precedent for Zoho-owned values. |
| T8 | The primary floor is a hand-written **partial unique index** `("storeId") WHERE "isPrimary" AND "kind" = 'FLOOR'`, the same technique as `Brand_name_ci_key` (`20260908151058_brand_name_ci_unique`). | Prisma cannot express a partial index; the database still guarantees one primary per store. |
| T9 | Slot counting moves into one helper used by the public slot calendar, the public submit and the staff date editor. | Three places counting "10 per day" today or after A36 would drift. |
| T10 | Every browser call in a file this plan touches moves to `apiFetch` / `apiTry`; every touched route gets a `createLogger` scope. | CLAUDE.md non-negotiables; all detail components use raw `fetch().then(r => r.json())` today. |

---

## 2. How it works today — verified against the code

### 2.1 Which store an outward reduces

- `Store.invoicePrefix String? @unique` — `prisma/schema.prisma:262`. The `Warehouse` model
  (`:307-346`) has no prefix, no primary flag and no deliveries relation. `WarehouseKind` is
  `FLOOR | GODOWN` (`:299-302`); `kind` defaults to `GODOWN` (`:317`).
- `storeIdForInvoice` (longest prefix, case-insensitive) and `resolveStoreIdOrPrimary` (falls back
  to the lowest-`sortOrder` active store with a `log.warn`) — `src/lib/deliveries/zoho-invoice.ts:39-56`, `:68-90`.
- Callers: `api/zoho/trigger-pull/route.ts:441-443, 485-488, 509` (preview `storeId`, an
  `unmatchedPrefix` bucket read by `zoho-import-flow.tsx:221, 237-241`);
  `api/zoho/pull-review/approve/route.ts:153-155, 612-613, 630`; `api/deliveries/import-zoho/route.ts:44, 95`;
  `api/deliveries/batch/route.ts:50-52, 80-85`; `api/deliveries/[id]/route.ts:207-219`.
- `deductFromStore` drains every FLOOR then every GODOWN of the store and refuses if the **store
  total** is short — `src/lib/stock-location.ts:90-144` (cascade `:113-129`). Other callers:
  `api/inventory/outwards/route.ts:98`, `api/stock-counts/[id]/route.ts:439`.
- A single-warehouse, refuse-if-short helper already exists: `moveOutOfWarehouse` —
  `src/lib/transfers/stock.ts:38-67`. It is not reservation-aware.
- The captured import: `storeId` null on 100 of 100 rows (`docs/deliveries/outwordapproevresponse.js`).

### 2.2 Stock holds

- `Product.reservedStock` (`schema.prisma:555`) is the only hold. `StockLevel.reservedQuantity`
  (`:625`) exists and **nothing in `src/` reads or writes it**.
- Reserve on `SCHEDULED`/`PACKED`, **throwing** when short — `api/deliveries/[id]/route.ts:165-191`
  (throw `:181-183`). Release to `VERIFIED` `:288-307`; release on `DELETE` `:342-360`.
- Deduct on `DELIVERED`/`WALK_OUT` — `:193-286`; idempotency on an `OUTWARD` transaction with the
  invoice number `:198-200`. Batch: `api/deliveries/batch/route.ts:64-149`; it never clears `stockReservedAt`.
- Other `reservedStock` readers: `api/inventory/outwards/route.ts:72-74`,
  `api/dashboard/stats/route.ts:29, 32, 71, 125-129`, `api/stock-reset/route.ts:57`,
  `(dashboard)/stock/[id]/page.tsx:494-495`, comment in `lib/reorder.ts:15-18`.

### 2.3 Stores and warehouses screens

- `/stores`: `src/app/(dashboard)/stores/page.tsx` — draft union `:53-55`, `save()` `:98-128`, the
  kind picker `:200-222`, the store's prefix input `:237-242`, its badge `:306-310`, new warehouse
  defaults to `GODOWN` `:373`.
- `api/stores/route.ts` POST `stores.create` `:73`, prefix clash `:81-93`; `api/stores/[id]/route.ts`
  PUT `stores.edit` `:15`, clash `:30-44`, write `:57-59`.
- `api/warehouses/route.ts` POST `warehouses.create` `:61`, `kind ?? "GODOWN"` `:87`;
  `api/warehouses/[id]/route.ts` PUT `warehouses.edit` `:15`, update `:46-60`.
- Schemas: `storeSchema` `src/lib/validations.ts:1198-1243` (prefix `:1215`), `warehouseSchema`
  `:1249-1256`, `warehouseUpdateSchema` `:1258-1260`.
- "The store's floor" is guessed as the first FLOOR by `sortOrder`: `src/lib/transfers/mode.ts:40-61`,
  `transfers/new/_components/route-picker.tsx:24, 170, 229`. `src/lib/warehouses.ts` `WarehouseRef` `:6-18`.
- RBAC: `stores` `prisma/rbac-catalog.ts:813-823`, `warehouses` `:824-838`, `deliveries` `:161-171`.

### 2.4 Pre-booked arrivals

- `api/inbound/[id]/route.ts:347-367` creates a `PENDING` delivery named
  `preBookedInvoiceNo || "PB-<lineItemId>"`, with no store and line items **without a SKU** (so no
  stock is ever deducted for it). The receiving warehouse is in scope as `warehouse.id` (`:208, :233`).

### 2.5 Walk-out

- Entry points: `delivery-card.tsx:152-156` and `deliveries/page.tsx:306` link to
  `/deliveries/<id>?action=walkout`; `deliveries/[id]/page.tsx:59-67` turns it into
  `initialAction` and strips the param.
- `detail-actions.tsx:139-165` shows Schedule + Walk-out for `PENDING`/`VERIFIED`, hidden behind a
  **localStorage** "contact saved" flag (`page.tsx:33-42`). With no phone the gate is skipped.
- `handover-checklist.tsx:42-105` PUTs `{ status }`; confirm disabled until every item,
  accessories and salesperson are ticked (`:195-222`).
- Server: walk-out requires only a phone — `api/deliveries/[id]/route.ts:95-97`.

### 2.6 Save Contact, the link, WhatsApp

- `customer-info-card.tsx:16-44` builds a vCard and shares or downloads it; no request. Prompt only
  for `PENDING` with a phone (`:78-90`).
- `Customer.phone String @unique` — `schema.prisma:1695`. Writers: `api/customers/route.ts:83-127`
  (`customers.create`, bare 10 digits via `customerSchema` `validations.ts:679-689`) and
  `api/services/jobs/create/route.ts:21, 49-55` (first 10 digits, upsert). No `+91-` is written anywhere.
- `generate-token/route.ts:11` guard `deliveries.create`, 48 h `:31`, reuses a valid token `:21-27`,
  **clears `selfFillCompletedAt`** `:38`; no customer check.
- `self-fill-link-button.tsx:57-64` builds `wa.me/` by removing only a leading `+` — 58 of 100
  captured phones are `+91-XXXXXXXXXX`, so the link breaks. Text says "48 hours" `:61`.

### 2.7 The customer's form and its submit

- Public `GET/PUT api/public/delivery/[token]/route.ts` (no auth by design; `middleware.ts:62`).
  PUT `:51-135`: no zod, no lock on `selfFillCompletedAt`, **never writes `status`**, accepts a new
  `customerPhone` `:87-90`, silently drops a non-10-digit alternate `:91-94`, slot re-check and
  `scheduledDate = slotStart` `:105-124`.
- Slots: `api/public/delivery-slots/route.ts` — 10 per day `:7`, 13:00 IST cutoff `:8`, 14 days `:9`,
  `groupBy scheduledDate` excluding `PREBOOKED`, `WALK_OUT` `:41-51`.
- `fill/[token]/page.tsx`: phone editable `:372-383`, `:507-518`; alternate "Optional" `:384-395`,
  `:519-530`; outstation has no date `:131-138`; validity rules `:223-233`.

### 2.8 Staff scheduling and the date

- `schedule-form.tsx`: both Inside/Outside buttons always `:139-159`; "Estimated Delivery \*"
  presets `:278-320`; submit disabled without a date `:337`; sends `status: "SCHEDULED"` `:67`.
- `delivery-date-editor.tsx`: same presets `:47-71`, PUT response never checked `:24-40`.
- Staff PUT copies `scheduledDate` only when truthy — `api/deliveries/[id]/route.ts:114`. No slot limit.

### 2.9 The detail screen, lists and payment

- Tabs `deliveries/[id]/page.tsx:187-205`; Actions tab `:208-251`; Details tab `:254-301`.
  `detail-header.tsx:23` always goes back to `/deliveries`.
- `delivery-list-view.tsx:150-153` pushes `/deliveries/<id>`; its `DeliveryItem` has no
  `isOutstation` (`:25-40`). BLR/Outstation pages pass `outstation: "false" | "true"` (`blr/page.tsx:11`,
  `outstation/page.tsx:11`) → `api/deliveries/route.ts:41-42`. Every import lands `isOutstation=false`.
- Tags: only "Outstation" — `delivery-card.tsx:105-109`, `deliveries/page.tsx:274`.
- Payment: `GET api/deliveries/[id]/route.ts:29-45` reads only `CustomerInvoice` by `invoiceNo`;
  `payment-warning.tsx:13` renders only when pending. Zoho's `balance`/`status` are on the preview
  (`trigger-pull/route.ts:500-501`) and on the invoice **detail** type (`src/lib/integrations/base.ts:93-94`),
  but `deliveryFieldsFromInvoiceDetail` (`zoho-invoice.ts:118-170`) drops them and `Delivery` has no column.

---

## 3. Implementation plan

Three phases, each on its own branch stacked on the previous (B5), one commit per phase. Each
phase ends green on `npx tsc --noEmit` and `npx eslint` for the touched files; the owner runs
`npm run build` (21–45 min) and the browser walk in §4.

**Migrations** (one per phase, `npx prisma migrate dev --name …` against **local `bch` only**;
the owner runs `migrate deploy` elsewhere; `npm run db:snapshot` before merging each):

| Phase | Migration | Contents |
|---|---|---|
| 1 | `delivery_floor_warehouse_and_holds` | `Warehouse.invoicePrefix TEXT UNIQUE`; `Warehouse.isPrimary BOOLEAN NOT NULL DEFAULT false` + hand-written partial unique index `Warehouse_one_primary_floor_per_store`; `Delivery.warehouseId` FK `Restrict` + index; **data**: release every hold — `UPDATE "Product" SET "reservedStock" = 0`, `UPDATE "Delivery" SET "stockReservedAt" = NULL` (B4) |
| 2 | `delivery_customer_link` | `Delivery.customerId` FK `Restrict` + index; `Customer.deliveries` back-relation |
| 3 | `delivery_zone_and_payment` | enum `DeliveryZone`; `Delivery.deliveryZone` + A34 backfill; `Delivery.paymentStatus TEXT`; `Delivery.balance DECIMAL(12,2)` |

All additive (rule 7). The Phase 1 data step is intentional and irreversible except by the
snapshot; the migration file says so in a comment.

**RBAC:** no catalog change and no re-seed. Guards used: `deliveries.view/edit/delete`,
`warehouses.create/edit`, `zoho.fetch/approve`. The public routes stay public.

### Phase 1 — the floor warehouse sells (R29–R35, A40–A46, B1, B4)

#### 1.1 Schema — `prisma/schema.prisma`

- `Warehouse`: `invoicePrefix String? @unique`, `isPrimary Boolean @default(false)`,
  `deliveries Delivery[]`. Comments name FLOOR-only use and the partial index.
- `Delivery`: `warehouseId String?`, `warehouse Warehouse? @relation(… onDelete: Restrict)`,
  `@@index([warehouseId])`. Comment: null on an open delivery = Dummy (T2); `storeId` derived (T3).
- `Store.invoicePrefix`: comment marks it **not read since this migration**, to be dropped.

#### 1.2 Resolver — `src/lib/deliveries/zoho-invoice.ts`

- Replace `storeIdForInvoice` and `resolveStoreIdOrPrimary` with
  `floorWarehouseForInvoice(invoiceNo, warehouses): { warehouseId, storeId } | null` — active
  FLOOR warehouses with a prefix, longest match, case-insensitive, trimmed. **No fallback.**
- `listFloorWarehousesWithPrefix(client)` loader, selecting `id, storeId, invoicePrefix`.

#### 1.3 Stock helpers — `src/lib/stock-location.ts`

- `recomputeReservedStock(tx, productId)` — `Product.reservedStock = SUM(StockLevel.reservedQuantity)` (T4).
- `holdDeliveryStock(tx, delivery): Promise<{ held: boolean; short: Array<{ name, sku, available, needed }> }>`
  — for each SKU line, `available = quantity − reservedQuantity` on `delivery.warehouseId`; if every
  line fits, increment each `reservedQuantity`, recompute, set `stockReservedAt`; otherwise hold
  nothing (T5). **Never throws on shortage.**
- `releaseDeliveryStock(tx, delivery)` — decrement `reservedQuantity` (clamped at 0), recompute,
  clear `stockReservedAt`.
- `deductFromFloor(tx, productId, warehouseId, qty, { wasHeld, label })` — refuses with
  *"Not enough stock on <warehouse> (has X, needs Y). Transfer from godown first."* when
  `quantity − (wasHeld ? 0 : reservedQuantity) < qty`; decrements `quantity` (and
  `reservedQuantity` when held); recomputes both caches. Never touches a GODOWN (A40).
- The product lookup stays SKU-based as today (`route.ts:171-177`); it moves into one shared
  `findDeliveryProduct(tx, sku)` so the four copies stop drifting.
- `deductFromStore` is **unchanged** — still used by manual outwards and store audits (§5).

#### 1.4 Delivery routes

- `api/deliveries/[id]/route.ts` PUT:
  - Dummy (`warehouseId` null and status not terminal) → **409** *"Dummy delivery: no warehouse matched this invoice number. No actions are allowed."*
  - `SCHEDULED`/`PACKED` → `holdDeliveryStock`; a short result is **accepted**; the response carries
    `stockShort` lines; `log.warn("hold short", { deliveryId, lines })`.
  - `DELIVERED`/`WALK_OUT` → idempotency as today, then `deductFromFloor` per line; refusal rolls back.
  - → `VERIFIED` → `releaseDeliveryStock`. `DELETE` releases the same way and stays allowed on a Dummy (T2).
  - Walk-out gate: keep the phone check in Phase 1; Phase 2 replaces it with `customerId`.
- `api/deliveries/batch/route.ts:64-149` — the same `deductFromFloor` path and Dummy refusal; clears `stockReservedAt`.
- New `POST api/deliveries/[id]/reserve/route.ts` (`deliveries.edit`) — "Reserve stock now" (A38):
  only when not held (T5 rule); returns `{ held, short }`.
- New `POST api/deliveries/match-warehouses/route.ts` (`deliveries.edit`) — every delivery not
  `DELIVERED`/`WALK_OUT` with `warehouseId` null, matched by `floorWarehouseForInvoice`; sets
  `warehouseId` + `storeId`; never overwrites; returns `{ checked, matched, stillDummy }`;
  `log.info` with those counts (A43, A43b).
- `api/deliveries/[id]/flag/route.ts`, `[id]/generate-token/route.ts` — refuse on a Dummy.
- `api/deliveries/route.ts` GET — include `warehouse: { select: { id, name } }`.

#### 1.5 Import paths

- `api/zoho/trigger-pull/route.ts:441-516` — load FLOOR warehouses; preview `data` carries
  `warehouseId` and `storeId`; the `unmatchedPrefix` bucket is renamed **"Dummy (no prefix matched)"**
  in `zoho-import-flow.tsx:221, 237-241`.
- `api/zoho/pull-review/approve/route.ts:612-631` and `api/deliveries/import-zoho/route.ts:44, 95` —
  write `warehouseId` + `storeId` from the resolver (re-resolved at approve, not trusted from the preview).
- `api/deliveries/search-zoho/route.ts:87` — comment only, updated.

#### 1.6 Pre-booked arrival — `api/inbound/[id]/route.ts:347-367` (B1)

- Resolve the receiving warehouse's store; take its **primary FLOOR** (or its only FLOOR); write
  `warehouseId` + `storeId`. No floor at all → leave null (Dummy) and `log.warn`.
- New helper `primaryFloorWarehouse(tx, storeId)` in `src/lib/warehouses.ts`.

#### 1.7 `/stores` — prefix and primary on the FLOOR warehouse (R30, R32, R33)

- `validations.ts`: `warehouseSchema` gains `invoicePrefix: z.string().trim().max(20).optional()`
  and `isPrimary: z.boolean().optional()`; `storeSchema` stops accepting `invoicePrefix`.
- `api/warehouses/route.ts` POST and `[id]/route.ts` PUT, in one `$transaction`:
  - the resulting kind is FLOOR and the prefix is blank → **400** *"A floor warehouse needs an invoice prefix."*
  - a GODOWN never stores a prefix or `isPrimary` (cleared if the kind changes to GODOWN);
  - prefix clash with another warehouse → **409** naming it (the pattern of `stores/[id]/route.ts:30-44`);
  - `isPrimary: true` clears the flag on the store's other FLOOR warehouses first;
  - after the write, a store with **2+ active FLOOR** warehouses and **no primary** → **400**
    *"Mark one floor warehouse of <store> as primary."* (rolls back).
- `api/stores/route.ts`, `api/stores/[id]/route.ts` — stop reading and writing `invoicePrefix`.
- `stores/page.tsx` — the store form loses the prefix input (`:237-259`) and badge (`:306-310`); the
  warehouse form, **only when FLOOR**, shows "Invoice prefix \*" and "Primary floor for this store";
  warehouse rows show the prefix badge and "Primary". `save()` moves to `apiFetch` if not already.
- `src/lib/warehouses.ts` `WarehouseRef` gains `invoicePrefix`, `isPrimary`; `clearWarehouseCache()` after writes.

#### 1.8 Screens

- `/deliveries` (`page.tsx`, `delivery-card.tsx`): a **Dummy** badge; Schedule, Walk-out and
  Pre-book buttons hidden on a Dummy; a **"Match warehouses"** button beside the filters for
  `canEdit("deliveries")`, showing the returned counts.
- Detail (`deliveries/[id]/page.tsx`, `detail-actions.tsx`): a Dummy banner and no actions; a red
  **"Stock not reserved — <floor> is short"** card with **"Reserve stock now"** when not held (T5);
  the warehouse name in the header.
- **Focused walk-out screen** (A44, A45): new `src/app/(dashboard)/deliveries/[id]/walkout/page.tsx`
  — invoice, items, `PaymentWarning`, the customer card with Save, `HandoverChecklist`, Confirm.
  No link, Schedule, Flag or zone. `delivery-card.tsx:152`, `page.tsx:306` and the Walk-out button
  in `detail-actions.tsx:153-161` go there; the `?action=walkout` handling (`page.tsx:59-67`) is removed.
- `handover-checklist.tsx` — shows the server's refusal text (floor short) instead of a generic error; `apiFetch`.

#### 1.9 Logging

`createLogger` scopes: `deliveries:floor-warehouse` (resolver, match route), `stock:hold`
(hold/release/deduct), `deliveries:api` ([id], batch, reserve), `warehouses:api`. Identifiers only:
`deliveryId`, `invoiceNo`, `warehouseId`, `productId`, counts.

### Phase 2 — the customer is saved, the customer schedules (R5–R15, R25–R27, A1–A13, A26–A28, A36–A39, B2, B3)

#### 2.1 Schema

`Delivery.customerId String?` → `Customer` `onDelete: Restrict`, `@@index([customerId])`;
`Customer.deliveries Delivery[]`.

#### 2.2 Phone — new `src/lib/phone.ts`

- `toPlus91(raw)`: strip non-digits; if longer than 10 and starting `91`, drop that `91`; empty →
  `null`; else `"+91-" + digits`. `"9964288130"` → `+91-9964288130`; `"+91 9986282818"` →
  `+91-9986282818`; `"+91-89512050058"` → unchanged (A3).
- `bare10(plus91)`: the 10 digits when there are exactly 10, else `null` (A13 lookup).
- `whatsappDigits(raw)`: `"91" + digits` for `wa.me` / `api.whatsapp.com`.
- Replaces the local helpers in `whatsapp-actions.tsx:25-29`, `schedule-form.tsx:33-37`,
  `self-fill-link-button.tsx:57-64`, `handover-checklist.tsx:75`, `dispatch-form.tsx:44`,
  `courier-info-card.tsx:56`, `flag-section.tsx:35`.
- Import writes (B3b): `trigger-pull/route.ts:497`, `pull-review/approve/route.ts:620-639`,
  `import-zoho/route.ts:91-99` format with `toPlus91`.

#### 2.3 Save Contact — new `POST api/deliveries/[id]/customer/route.ts` (`deliveries.edit`)

- Body `{ phone?: string }` (zod). Refuse a Dummy (409) and a terminal status (409).
- Phone = body phone (B2) or the delivery's; `toPlus91`; none → **400** *"Enter the customer's phone number."*
- In a `$transaction`: find `Customer` where `phone IN (plus91, bare10)` → link; else create
  `{ name: customerName.trim(), phone: plus91, type: WALK_IN }`, re-finding on `P2002`. Update the
  delivery's `customerPhone` to `plus91` (B3 "touched") and `customerId`.
- Returns `{ customerId, name, alreadyExisted }`. `log.info("customer linked", { deliveryId, customerId, alreadyExisted })`.
- Shared core `src/lib/customers/find-or-create-by-phone.ts`. `POST /api/customers` is **not**
  changed (it serves the receivables import under `customers.create`).

#### 2.4 Gates on the server

- `api/deliveries/[id]/route.ts`: → `WALK_OUT` and → `SCHEDULED` require `customerId` (409
  *"Save the customer first."*), replacing the phone check `:95-97` (A6).
- Staff `customerPhone`/`alternatePhone` edits are written through `toPlus91`.
- Staff `scheduledDate`: validated against the slot limit (T9); `null` clears it.

#### 2.5 The link — `generate-token/route.ts`

- Guard stays `deliveries.create`. Refuse without `customerId` (409), on a Dummy (409), and once
  `selfFillCompletedAt` is set (409 *"The customer has already submitted; edit the delivery instead."*, A7/A8).
- 24 h expiry; reuse a valid token; **no longer clears `selfFillCompletedAt`**. `createLogger("deliveries:self-fill")`.

#### 2.6 The public submit — `api/public/delivery/[token]/route.ts` (stays public)

- GET adds `alternatePhone` and whether it is locked.
- PUT, zod-validated, in one `$transaction`:
  - 404 / 410 as today; **409 if `selfFillCompletedAt` is set** (locked); 409 unless status is `PENDING` or `VERIFIED`.
  - `customerPhone` in the body is **ignored** (A10).
  - `alternatePhone` required, exactly 10 digits, `toPlus91`; equal to the delivery's `toPlus91(customerPhone)` → **400** (A11, A12).
  - Bangalore: `requestedDate` required, slot check via the T9 helper, `scheduledDate` set.
    Outstation: no date (A27).
  - Writes address fields, `isOutstation`, `selfFillCompletedAt`, **`status: SCHEDULED`** (R25, A17),
    then `holdDeliveryStock` — a shortage never fails the customer's submit (A26).
  - Logs `deliveryId` only — never the phone or address.

#### 2.7 Slots — new `src/lib/deliveries/slots.ts` (T9)

`countBookedOn(tx, dateIST, excludeId?)` and the calendar builder, lifted from
`api/public/delivery-slots/route.ts:31-85`; that route, the public PUT and the staff PUT use it.

#### 2.8 The customer's form — `src/app/fill/[token]/page.tsx`

- Main phone shown read-only on both branches (`:372-383`, `:507-518` become text).
- Alternate: required, 10 digits, inline error when equal to the main number; Submit disabled until
  valid (`:223-233`).
- Submitted screen: Bangalore shows the date; outstation says the store will confirm dispatch.
- A locked link (GET says so) shows the submitted screen. `apiTry` replaces raw fetch.

#### 2.9 Staff screens

- `customer-info-card.tsx`: vCard and download removed. Not saved → a phone input (prefilled, B2)
  and **Save Customer**; saved → "Saved as <name>" (and "already existed" when true). `apiFetch`.
- `deliveries/[id]/page.tsx`: the localStorage flag (`:33-42`) is removed; "saved" = `data.customerId`.
- `self-fill-link-button.tsx`: disabled with *"Save the customer first"* when not saved; "24 hours";
  WhatsApp via `whatsappDigits`; Copy kept (R11).
- `schedule-form.tsx`: the "Estimated Delivery \*" block `:278-320` and the date requirement `:337`
  are **removed** (R27, A28); the confirmation and WhatsApp text say "date to be confirmed" when
  there is none; a `stockShort` response shows the red warning.
- `delivery-date-editor.tsx`: presets `:47-71` replaced by the slot calendar (A36); errors surfaced.
- `whatsapp-actions.tsx`: when `SCHEDULED` with `selfFillCompletedAt` and not
  `whatsAppScheduledSent`, the banner *"Scheduled by customer – confirmation not sent"* above the
  existing send button (A39).
- The walk-out screen from 1.8 uses the new customer card.

### Phase 3 — one detail screen, its own routes, zones and payment (R18–R24, R26, R28, A22–A25, A29–A34)

#### 3.1 Schema

- `enum DeliveryZone { BANGALORE OUTSTATION }`; `Delivery.deliveryZone DeliveryZone?` (null = Not chosen).
- Migration backfill (A34): `deliveryZone` from `isOutstation` where `selfFillCompletedAt IS NOT NULL`
  or status not in (`PENDING`, `VERIFIED`); the rest stay null.
- `Delivery.paymentStatus String?`, `Delivery.balance Decimal? @db.Decimal(12, 2)` (T7).

#### 3.2 Writers of the zone (T6)

`validations.ts` `deliveryUpdateSchema` gains `deliveryZone`; the staff PUT and the public PUT
write `deliveryZone` **and** `isOutstation` together; the schedule form sends `deliveryZone`.

#### 3.3 Payment at import (A31, A32)

- `zoho-invoice.ts` `deliveryFieldsFromInvoiceDetail` reads `balance` and `status` (declared on
  `IntegrationInvoiceDetail`, `src/lib/integrations/base.ts:93-94`) and returns them.
- Both creates write `paymentStatus` and `balance` (approve falls back to the preview's `d.status`/`d.balance`).
- `GET api/deliveries/[id]` returns `payment: { source: "receivables" | "zoho", status, total, paid, balance } | null`
  — `CustomerInvoice` first (`:29-45`), else the snapshot (paid = `invoiceAmount − balance`), else null.

#### 3.4 One detail component and its routes (A24, A25, A29)

- Move the body of `deliveries/[id]/page.tsx` into `deliveries/_components/delivery-detail.tsx`
  with props `id` and `backHref`. **No tabs.** Order: header → **summary card** (amount, paid,
  balance, payment status or "Payment: not available", scheduled date with "chosen by customer"
  when `selfFillCompletedAt`, zone, floor warehouse or Dummy, "not reserved" warning) → customer →
  items → delivery details / date / courier / accessories → link → actions → WhatsApp.
- New `summary-card.tsx`; `payment-warning.tsx` folds into it.
- Pages: `deliveries/[id]/page.tsx` (`backHref="/deliveries"`), new `deliveries/blr/[id]/page.tsx`
  and `deliveries/outstation/[id]/page.tsx`, each `params: Promise<{ id }>` + `use(params)`.
- `detail-header.tsx:23` uses `backHref`; the walk-out page and the not-found link keep their list.
- The component stays under ~300 lines by extraction (frontend red flag).

#### 3.5 Lists and tags (A22, A23, A30)

- `api/deliveries/route.ts:41-42`: `outstation` is replaced by `zone=BANGALORE|OUTSTATION|NONE`.
- `blr/page.tsx`, `outstation/page.tsx` pass `zone` and a detail href; `delivery-list-view.tsx:150-153`
  takes `detailHref(id)`.
- `/deliveries` only: `delivery-card.tsx:105-109` and `page.tsx:274` show **Bangalore**,
  **Outstation** or **Not set** (plus Dummy from Phase 1).
- `schedule-form.tsx:139-159`: zone set → only that side's fields; null → both buttons.

---

### Phases and dependencies

| Phase | Depends on | Branch (Q0) |
|---|---|---|
| 1 | — | asked before creating |
| 2 | Phase 1: Dummy refusal, `holdDeliveryStock`, the walk-out screen | stacked on Phase 1's tip |
| 3 | Phase 2: the customer card, the schedule form without a date | stacked on Phase 2's tip |

Within a phase, the schema and `lib/` helpers are built first; routes and screens after, one
agent per independent area where they do not share files.

### Board of agents — checked 16 Sep 2026

| Doc | Check | Result |
|---|---|---|
| inventory-consultant | no negative stock (`:13`, `:43`); deduct only on confirmed delivery (`:46`) | `deductFromFloor` refuses rather than clamps; holds never deduct |
| warehouse-consultant | handover checklist before release (`:16`, `:45`); tracking for outstation (`:46`) | checklist kept on walk-out and delivered; SHIPPED tracking guard untouched. Its `:8` ("deducted on WALK_OUT, SCHEDULED or PACKED") is stale — §5 |
| accounting-consultant | payment shown is a snapshot, not a ledger | receivables row overrides; nothing posts money |
| gst-consultant | no tax field touched | n/a |
| database-architect | additive migrations, no new `Float` money, indexed FKs | T7, `Restrict` + index on both new FKs, partial index hand-written (T8) |
| backend-engineer | zod at the boundary (`:73`), transitions map (`:76`), transactions (`:71`), idempotency (`:77`) | public PUT gets zod + transaction; idempotency on OUTWARD kept |
| frontend-engineer | loading / error / disabled states (`:56-61`), 375 px, components under 300 lines (`:63`) | apiFetch everywhere touched (T10); detail split into components |
| integration-architect | no extra Zoho calls | payment comes from the detail call Import already makes |

---

## 4. Verification

**Every phase:** `npx tsc --noEmit`; `npx eslint` on touched files; `npx prisma migrate status`
clean on local `bch`; `npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url <throwaway db>`
shows no drift (never `bch` as the shadow). The owner runs `npm run build`.

**Phase 1 — browser walk**
1. `/stores`: a FLOOR warehouse without a prefix will not save; a GODOWN shows no prefix field; two
   FLOOR warehouses in one store will not save until one is Primary; a duplicate prefix is refused by name.
2. Set `INV/` and `BCC/`. Fetch + Import: `INV/…` rows show their floor; `INVOICE-003951` shows **Dummy** with no buttons.
3. "Match warehouses" on `/deliveries`: counts shown; existing open rows gain a floor; delivered rows unchanged.
4. Floor has 1, godown has 3, delivery needs 2: Walk-out is **refused** with the floor message;
   godown unchanged. Transfer 1 to the floor; Walk-out succeeds; floor 0, godown 2.
5. Schedule with the floor short → accepted, red warning, "Reserve stock now" refuses until stock
   exists, then holds; `StockLevel.reservedQuantity` and `Product.reservedStock` agree.
6. After the migration every old hold is gone: `SELECT SUM("reservedStock") FROM "Product"` = 0.
7. Receive a pre-booked cycle: its delivery shows the store's primary floor, not Dummy.

**Phase 2 — browser walk**
1. Save Customer with no download; a second delivery with the same phone (either format) links to
   the same row; `SELECT count(*) FROM "Customer" WHERE phone IN (…)` = 1.
2. A delivery with no phone: type it, save, phone shows `+91-XXXXXXXXXX`.
3. Generate Link disabled before saving; `curl -X POST …/generate-token` before saving → 409.
4. WhatsApp opens a chat for a `+91-` number.
5. Customer form: main phone not editable; alternate required; same number refused on screen and
   by `curl -X PUT …/api/public/delivery/<token>` → 400.
6. Bangalore submit → `SCHEDULED` with the date, listed under Scheduled; outstation submit → `SCHEDULED`, no date.
7. Reopen the link → locked; `curl` a second PUT → 409.
8. Staff schedule without a date works; date editor shows the slot calendar and refuses a full day.
9. Banner "Scheduled by customer – confirmation not sent" until the send button is pressed.

**Phase 3 — browser walk**
1. `/deliveries/blr` shows only Bangalore rows and opens `/deliveries/blr/<id>` with a back arrow to
   the BLR list and **no tabs**; same for outstation.
2. Summary card: an imported paid invoice shows paid = amount, balance 0; an old row shows "Payment: not available".
3. `/deliveries` cards and desktop table show Bangalore / Outstation / Not set.
4. Schedule form on a Bangalore row shows no "Outside Bangalore"; a Not-chosen row shows both.
5. 375 px width: no horizontal scroll on the detail and walk-out screens.

---

## 5. Out of scope, deliberately

- **Other stock paths keep `deductFromStore`** (floor then godown): manual outwards
  `api/inventory/outwards/route.ts:98` and whole-store audits `api/stock-counts/[id]/route.ts:439`.
  The "outward never reduces a godown" rule is applied to deliveries only.
- **Transfers still guess "the store's floor"** as the first FLOOR by `sortOrder`
  (`lib/transfers/mode.ts:40-61`, `route-picker.tsx:24, 170, 229`). `isPrimary` is used only by B1 (A41d).
- **Dummy deliveries have no actions** except delete (A41c, T2). Assigning a warehouse by hand is not built.
- **Dropping `Store.invoicePrefix` and `Delivery.isOutstation`** — the release after this one.
- **Payment refresh and backfill** — A31 is a snapshot, A32 no backfill.
- **Live defect found while mapping, not fixed here:** inbound receiving in **bin mode** writes
  `Product.currentStock` directly without a `StockLevel` row — `api/inbound/[id]/route.ts:281-284`
  (only the non-bin branch calls `adjustWarehouseQty` at `:301`). The next recompute will drop those
  units. Raise separately.
- `/desktop/deliveries` (own list, detail is a "coming soon" stub) — A23 limits tags to `/deliveries`.
- The batch dispatch screen's batching rules — the older questions in `docs/deliveries/requirement.md`.
- Stale agent docs: `warehouse-consultant.md:8` (deduction timing) and the raw-fetch example in
  `frontend-engineer.md:31-46`.

---

## 6. Build record

### Phase 1 — 16 Sep 2026, branch `feat/1609-deliveries-p1-floor-warehouse` (off `376fa13`)

Built by Claude plus four parallel agents (API routes; import paths + pre-booked; `/stores`;
screens), on the owner's instruction "use multiple agent".

**Migration** `20260916173617_delivery_floor_warehouse_and_holds` — applied to local `bch_local`
only; `migrate diff` against the database reports no difference, and the partial index
`Warehouse_one_primary_floor_per_store` is present and not proposed for drop. **Owner owes:**
`npm run db:snapshot`, then `npx prisma migrate deploy` on the cloud test db (it releases every
existing hold — run the two count queries in the migration header first).

**Deviations from §3, on record**
- The delivery stock functions live in a new `src/lib/deliveries/floor-stock.ts`
  (`holdDeliveryStock`, `releaseDeliveryStock`, `deductDeliveryFromFloor`, `isDummy`); only
  `recomputeReservedStock` went into `stock-location.ts`.
- `Product.sku` is `@unique`, so the four "Bharath Cycle Hub bin first, then any" product lookups
  collapsed into one `findUnique` (`findDeliveryProduct`).
- The trigger-pull response's `skipped.counts.byStore` is now `byWarehouse` + `dummy`; its only
  reader, `zoho-import-flow.tsx`, was updated with it.
- `api/stock-reset/route.ts` now also zeroes `StockLevel.reservedQuantity` — without it T4 would
  bring reset holds back (found by the API agent).
- On `/deliveries` a Dummy also hides Dispatch and Mark Ready (A41c: no actions), not only
  Schedule / Walk-out / Pre-book. Delete stays (T2).
- Warehouse rules: deactivating a FLOOR without a prefix is allowed; the primary check runs only
  when a FLOOR is involved; deleting a primary floor is not guarded.

**Verified**
- `npx tsc --noEmit -p .` — exit 0, whole project. `npx eslint` — clean on every touched file
  (2 pre-existing warnings in `zoho-import-flow.tsx:394, 414`, untouched code).
- The stock rules against `bch_local` inside a rolled-back transaction, 15 checks: prefix match
  (`INV/`, case/trim `BCC/`, longest wins, `INVOICE-` → Dummy); short hold → not held and
  `stockReservedAt` null; handover refused with the floor message and the godown untouched; hold
  after a transfer updates `reservedQuantity` and the `reservedStock` cache together; an unheld
  delivery cannot take another's hold; deducting a held delivery consumes the hold; release; Dummy
  refused; the partial index refuses a second primary (Postgres 23505). No rows left behind.

**Not verified** — no `npm run build` (owner), no browser walk of §4 Phase 1.

**Found, not fixed**
- `src/app/(dashboard)/receivables/page.tsx`, `deliveries/dispatch/page.tsx`, `bins/page.tsx:231`,
  `self-fill-link-button.tsx` and the Details-tab editors still use raw `fetch().then(r => r.json())`.
- A VERIFIED delivery with a phone cannot be walked out: the customer card offers Save only for
  PENDING. Pre-existing; Phase 2's database save replaces that gate.

### Phase 2 — 16 Sep 2026, branch `feat/1609-deliveries-p2-contact-self-fill` (off Phase 1 `9974e9a`)

Owner: "yes continue phase 2 from this branch with multiple agents". Claude wrote the schema,
migration and shared helpers; four agents built in parallel (staff API + import phones; public
submit + customer form; customer card + link + gates; schedule form + date editor + WhatsApp).

**Migration** `20260916181032_delivery_customer_link` — `Delivery.customerId` → `Customer`,
Restrict + index. Applied to local `bch_local` only; `migrate diff` reports no difference.
**Owner owes** `migrate deploy` on the cloud test db (additive, no data step).

**Shared helpers** — `src/lib/phone.ts` (`toPlus91`, `bare10`, `isValidMobile`, `samePhone`,
`whatsappDigits`), `src/lib/customers/find-or-create-by-phone.ts` (both phone forms, never edits an
existing row, savepoint on the unique race), `src/lib/deliveries/slots.ts` (one slot rule for the
public calendar, the public submit and the staff date editor).

**Built**
- `POST /api/deliveries/[id]/customer` (`deliveries.edit`): Save Contact → Customer, links `customerId`,
  writes the phone `+91-`. The customer card lost the vCard/download and the localStorage flag;
  staff can type a missing phone (B2).
- `PUT /api/deliveries/[id]`: → `SCHEDULED` / `WALK_OUT` need `customerId` (409 "Save the customer
  first."); phones through `toPlus91`; changing the phone of a saved delivery unlinks the customer;
  staff `scheduledDate` checked against the slot limit, `null` clears it.
- `generate-token`: needs the saved customer, 24 h, refuses after submit, no longer re-opens a filled form.
- Public `GET/PUT /api/public/delivery/[token]` (still public): zod; locked after one submit;
  `customerPhone` in the body ignored; alternate mandatory, different from the main number;
  Bangalore needs a slot date, outstation has none; submit → `SCHEDULED` and tries to hold stock,
  never failing on a shortage; a conditional update closes the double-submit race.
- `/fill/[token]`: main phone read-only, "Alternate Phone \*", submitted screen per branch.
- Schedule form: "Estimated Delivery \*" removed, schedules without a date. Date editor: slot
  calendar, and "Set delivery date" when a scheduled delivery has none. WhatsApp: `whatsappDigits`
  everywhere, "Scheduled by customer – confirmation not sent" banner (A39).
- Import paths write phones `+91-` (B3b).

**Deviations, on record**
- The public GET still returns address, area and pincode (the form pre-fills from them).
- Staff re-sending a delivery's current day skips the slot check; PREBOOKED / WALK_OUT skip it too.
- The default "scheduled" WhatsApp text (no saved template) was corrected — it said "shipped" / "out
  for delivery" and carried no date.
- The red-flag alert WhatsApp now adds the `91` country code it was missing.

**Verified**
- `npx tsc --noEmit -p .` exit 0 (whole project); `npx eslint` exit 0 on every changed file.
- 17 checks of the helpers on `bch_local` in a rolled-back transaction: every captured phone format
  (`9964288130`, `+91-9986282818`, `+91 …`, `91…`, `0…`, the 11-digit `+91-89512050058` kept), a
  bare-10 legacy customer matched without renaming it, a second save links the same row, the
  savepoint leaves the transaction usable, past / cutoff slot refusals.
- 15 checks calling the real public `GET`/`PUT` handlers against `bch_local` (test rows deleted
  afterwards, verified 0 left): alternate missing / invalid / same as main → 400; past date → 409;
  valid Bangalore submit → `SCHEDULED`, chosen IST day, alternate `+91-`, main phone untouched,
  stock held on the floor; second submit → 409 locked; GET reports locked; outstation with short
  stock → `SCHEDULED`, no date, not held.

**Not verified** — no `npm run build`, no browser walk of §4 Phase 2.

**Found, not fixed**
- Two different deliveries booking the last slot of a day at the same instant can both succeed —
  the count is not locked (pre-existing).
- `src/lib/api-client.ts` logs request bodies at debug level (`NEXT_PUBLIC_LOG_LEVEL=0`), which on
  `/fill` would print the alternate phone and address in the customer's own browser console.
  Default level does not print it.
- Raw `fetch` remains in `delivery-details-card.tsx`, `free-accessories-editor.tsx`,
  `service-invoice-section.tsx` and the courier save in `courier-info-card.tsx` (it never checks
  the response).

### Phase 3 — 16 Sep 2026, branch `feat/1609-deliveries-p3-detail-zones-payment` (off Phase 2 `d3dd3d0`)

Owner: "yes continue phase 3 from this branch with multiple agents". Claude wrote the schema,
migration and shared helpers; three agents built in parallel (API zone + payment; one-screen
detail + routes; lists + tags).

**Migration** `20260916183558_delivery_zone_and_payment` — enum `DeliveryZone`,
`Delivery.deliveryZone`, `Delivery.zohoPaymentStatus`, `Delivery.zohoBalance Decimal(12,2)`, and
the A34 backfill (filled or scheduled-and-later rows keep their side; unfilled PENDING / VERIFIED /
PREBOOKED / FLAGGED become Not chosen). Applied to local `bch_local` only (all 232 local rows are
unfilled PENDING → Not chosen); `migrate diff` reports no difference. **Owner owes** `migrate deploy`
on the cloud test db.

**Shared helpers** — `src/lib/deliveries/zone.ts` (`zoneColumns`, `zoneFromOutstation`, `zoneLabel`,
`parseZoneFilter`), `src/lib/deliveries/payment.ts` (`deliveryPayment`: receivables row → Zoho
snapshot → null).

**Built**
- Import (both paths) stores Zoho's `status` and `balance`. `GET /api/deliveries/[id]` returns
  `payment { source, status, total, paid, balance, hasPending }` (old `paymentStatus` kept for the
  handover checklist). Staff and public PUT write `deliveryZone` and `isOutstation` together.
  `GET /api/deliveries?zone=BANGALORE|OUTSTATION|NONE`; the legacy `?outstation=` maps onto it.
- One detail component `deliveries/_components/delivery-detail.tsx`, **no tabs**, rendered by
  `/deliveries/[id]`, and new `/deliveries/blr/[id]` and `/deliveries/outstation/[id]`, each with a
  back arrow to its own list. Order: header → Dummy banner → **summary card** (amount / paid /
  balance / payment word and source or "Payment: not available"; delivery date with "chosen by
  customer"; zone; floor) → customer → items → stock hold → link → actions → editors → WhatsApp.
- Schedule form: a delivery with a zone shows only that side, labelled; only Not chosen shows both.
- `/deliveries/blr` and `/deliveries/outstation` list only their zone and open their own route;
  `/deliveries` cards and table tag Bangalore / Outstation / Not set.

**Deviations, on record**
- Columns are `zohoPaymentStatus` / `zohoBalance`, not `paymentStatus` / `balance` (§3.1): the detail
  API already returns a computed `paymentStatus` object, and spreading the row would have collided.
- `payment-warning.tsx` deleted; the walk-out screen uses the summary card's payment part.
- The duplicate big call button of the old Actions tab was dropped (the customer card has the same
  tap-to-call).
- Actions sit above the editors (the plan listed them after).
- `delivery-list-view.tsx` moved to `apiTry` with an error state and ignores stale responses.

**Verified**
- `npx tsc --noEmit -p .` exit 0 (whole project); `npx eslint` exit 0 on every changed file.
- 7 checks of the helpers: no data → "not available"; a Zoho partial payment (paid = amount −
  balance, Decimal input); paid; a receivables row overrides; zone columns; zone labels / filter
  parsing; the invoice-detail mapping carries status and balance.

**Not verified** — no `npm run build`, no browser walk of §4 Phase 3 (or of Phases 1–2).

**Noted**
- The walk-out screen's back arrow always returns to `/deliveries/<id>`, also when reached from a
  BLR / Outstation detail.
- A reverse-pickup Bangalore row shows two blue badges (Reverse and Bangalore).
- `GET /api/deliveries` rows serialise `zohoBalance` as a string; the lists do not read it.
