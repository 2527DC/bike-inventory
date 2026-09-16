# Deliveries — save contact, self-fill link, status flow and the outward invoice

Written 16 Sep 2026 from the owner's request. This is a **requirements document, not an
implementation plan.** Nothing has been built and no code has been changed. It has six parts:

1. **The requirements** — the owner's words, verbatim, then each one restated as `R1…Rn`.
2. **The module as it is today** — the tables, the screens, the routes, with `file:line`.
3. **What each thing the owner asked about actually does today** — Save Contact, the link,
   WhatsApp, the fill form, the status, the two captured responses.
4. **The questions** — `Q1…Q22`. **Eight block a plan** and are marked ⛔.
5. **The permission map** — data for the RBAC catalog, never code.
6. **Out of scope** and the work record.

Lines marked *Today:* describe what the app does now, so the reader can see what is new.

---

## 1. The requirements

### 1.1 The owner's words, verbatim (16 Sep 2026)

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

### 1.1a The owner's change, verbatim (16 Sep 2026, later the same day)

> in the plan i need to change this like  i need to keep the scheduled time and as teh customer
> confirsms the and submits teh form by choosing that is scheduled time and must be named as
> schedules no need of progress option and  /deliveries/blr & 'f:\bharath  Cycle\BCH-Management\docs\asset\image.png'
> when i clict teh listin  i see this i need to be imporved i need to show the detaisl of paid
> and balace things  and i dont need this Estimated Delivery * at all remove it where the
> schedule time if taken by the customer not the  staff the staff must see the  scheduled time
> in the details

**This supersedes R16 and R17 below** — there is no "in progress" status. See R25–R28 and §4.0.

### 1.1b The owner's second change, verbatim (16 Sep 2026) — which stock an outward reduces

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

Asked after this explanation of today's code: the store is resolved from `Store.invoicePrefix`
at import (`zoho-invoice.ts:39-56`), falls back to the primary store, and `deductFromStore`
drains that store's FLOOR then GODOWN (`stock-location.ts:90-144`). **This replaces Q26.**

### 1.2 Restated

**Explain first**

- **R1** — Explain how `/deliveries` works: it lists the invoices that are to be delivered.
  **List every table this module touches.**
- **R2** — Explain what the **Save Contact** button on the delivery-details screen does today,
  and **where it saves now**.
- **R3** — Explain `outwordfetch.js` — the data fetched from the delivery-dispatch fetch.
- **R4** — Explain `outwordapproevresponse.js` — the response when **Import** is clicked.

**Save Contact → the Customer table**

- **R5** — Clicking **Save Contact** must **save to the database**. It must **not download
  anything**.
- **R6** — The record is saved into the **`Customer` table**.
- **R7** — **Phone number is the search key**, for both lookup and insert.
- **R8** — **No duplicate saving.** If the customer already exists, skip the insert — that
  already counts as saved.

**The self-fill link**

- **R9** — **Only if the customer is saved** may the link be generated. Saving is mandatory.
  If the customer was already present, the link may still be generated.
- **R10** — **Fix the WhatsApp issue**: the send must use **the phone number that is in the
  delivery details**.
- **R11** — The link must also be **copyable**.

**The customer's form at `/fill/<token>`**

- **R12** — The **alternate number is mandatory**.
- **R13** — The **primary number and the alternate number must not be the same**.

**Status after the customer submits**

- **R14** — After the customer submits the delivery details the status must change. *Today it
  stays `PENDING`.*
- **R15** — Those rows must be **listed under the matching filter** on `/deliveries`.
- **R16** — The status after the customer's submission is **not** `SCHEDULED` — the store does
  not yet know whether it can meet that date. It goes to an **in-between "in progress"**
  status. *(The owner asks whether this reading is correct — see Q9.)*
- **R17** — A **user holding the scheduling permission** reviews it and moves it to
  **`SCHEDULED`**. After that the **dispatch** is made, and then it is **marked delivered**.

**Bangalore vs outstation**

- **R18** — The listing must follow what the customer chose — **Bangalore** or **outside
  Bangalore**.
- **R19** — The `/deliveries` list must **tag each row** "Bangalore" or "Outstation".
- **R20** — Opening a row from `/deliveries/blr` must **not** land on the `/deliveries/<id>`
  route with its top nav. The Bangalore and Outstation lists need **their own detail route**.
- **R21** — On that detail screen, when **Schedule Delivery** is clicked from the Bangalore
  list, the **"Outside Bangalore"** option must not be shown; from **Outstation Deliveries**,
  **"Inside Bangalore"** must not be shown.
- **R22** — **Remove the "Estimated Delivery \*" picker** from the schedule form. The customer
  has already chosen a date — **show that date** instead.

**The details screen**

- **R23** — The details screen shows too little. It must show the **important details —
  payment status and the balance**. **No new tab**: put it in the **Details tab that already
  exists**.
- **R24** — When looking at the details of an **outward invoice**, the **items in that outward**
  must be visible.

**The change (§1.1a) — supersedes R16 and R17**

- **R25** — **No "in progress" status.** When the customer submits the form with a chosen date,
  the delivery becomes **`SCHEDULED`** and that date **is** the scheduled time.
- **R26** — The scheduled time is **taken by the customer, not the staff**. Staff **see** it in
  the details.
- **R27** — **Remove "Estimated Delivery \*" completely** — not a read-only fallback, gone.
- **R28** — The detail screen opened from `/deliveries/blr` (screenshot
  `docs/asset/image.png`) must be improved: it must show **paid and balance**.

**Which stock an outward reduces (§1.1b) — replaces Q26**

- **R29** — A store does not hold stock; its **warehouses** do. A warehouse tagged **FLOOR** is,
  for the business, "the store holding stock".
- **R30** — The **invoice prefix moves from the Store to the FLOOR warehouse.** It is not set
  on a store any more.
- **R31** — At **import**, the invoice is matched to a FLOOR warehouse by its prefix, and the
  outward **reduces that warehouse's stock**.
- **R32** — The prefix is **mandatory in the application** (a FLOOR warehouse cannot be saved
  without one) but **nullable in the database**.
- **R33** — Each store must have **one primary FLOOR warehouse**, and choosing it is
  **mandatory** when the store has **more than one** FLOOR warehouse.
- **R34** — **Walk-out is a straight action**: no Schedule Delivery or other steps in the way —
  mark it Walk-out and the **stock is reduced**.
- **R35** — Before Walk-out, the **customer data must be saved first** (consistent with A6).

---

## 2. The module as it is today

### 2.1 The tables (R1)

**The one table this module owns**

| Table | Role | Where |
|---|---|---|
| `Delivery` | One row per sales invoice to be delivered. Holds the customer's name, phone, alternate phone, address, area, pincode **as plain columns — copied from Zoho, not linked to anything**, the status, the dates, the courier fields, the WhatsApp flags, the self-fill token and `lineItems` as JSON. | `prisma/schema.prisma:1824-1906` |
| `DeliveryStatus` (enum) | `PENDING`, `VERIFIED`, `WALK_OUT`, `SCHEDULED`, `OUT_FOR_DELIVERY`, `DELIVERED`, `FLAGGED`, `PREBOOKED`, `PACKED`, `SHIPPED`, `IN_TRANSIT` — **11 values, and none of them is an "in progress"** | `prisma/schema.prisma:1810-1822` |

**Tables it reads or writes through a relation**

| Table | Why the delivery module touches it | Where |
|---|---|---|
| `Store` | `Delivery.storeId` — which store sold it, resolved from `Store.invoicePrefix` against the invoice number | `schema.prisma:1841-1842`, `src/lib/deliveries/zoho-invoice.ts:39-56` |
| `User` | `Delivery.verifiedById` — who verified it | `schema.prisma:1846-1848` |
| `Product` | stock deduction on `DELIVERED` / `WALK_OUT`, matched by the line item's **SKU** | `src/app/api/deliveries/[id]/route.ts:182,242` |
| `StockLevel` | the per-store / per-warehouse quantity that is actually decremented | `src/lib/stock-location.ts` |
| `Warehouse` | resolves which stock row inside the store to deduct from | `src/lib/stock-location.ts` |
| `InventoryTransaction` | the audit row written for every deduction | `src/app/api/deliveries/[id]/route.ts`, `batch/route.ts` |
| `CustomerInvoice` | the **only** source of the "Payment Pending" banner — matched by `invoiceNo` | `src/app/api/deliveries/[id]/route.ts:32-44` |
| `Customer` | **not referenced by `Delivery` at all today** — no foreign key, no join. It is reachable only indirectly, through `CustomerInvoice.customerId` | `schema.prisma:1692-1712` |
| `CustomerPayment` | what moves `CustomerInvoice.paidAmount`, which is what the banner computes the balance from | `schema.prisma:1735-1755` |
| `PreBooking` | "Convert to Pre-booking" creates one and flips the delivery to `PREBOOKED` | `src/app/(dashboard)/deliveries/page.tsx:134` |
| `ZohoPullPreview` | one row per fetched-but-not-yet-imported invoice — **this is what `outwordfetch.js` contains** | `schema.prisma:1918-1934` |
| `ZohoPullLog` | one row per fetch run — the `latest` object in `outwordfetch.js` | `schema.prisma:1936-1953` |
| `SyncLog` | the running/failed record of a pull | `schema.prisma:1669` |
| `NotificationOutbox` / `PushDevice` | below-reorder alerts fired after a deduction commits | `src/lib/notify/stock.ts` |

> **There is no `Customer` ↔ `Delivery` relationship in the schema.** That single fact is what
> R5–R8 are really asking to change. See Q1–Q5.

### 2.2 The screens

| Route | File | What it is |
|---|---|---|
| `/deliveries` | `src/app/(dashboard)/deliveries/page.tsx` | the main list: stats, status chips, search, the Zoho fetch/import panel, cards on mobile and a table on desktop |
| `/deliveries/blr` | `.../deliveries/blr/page.tsx` | Bangalore list — `DeliveryListView` with `outstation=false` |
| `/deliveries/outstation` | `.../deliveries/outstation/page.tsx` | outstation list — `outstation=true`, shows courier columns |
| `/deliveries/dispatch` | `.../deliveries/dispatch/page.tsx` | batch dispatch |
| `/deliveries/prebook`, `/deliveries/walkout` | — | the two side lists |
| `/deliveries/<id>` | `.../deliveries/[id]/page.tsx` | **the one detail screen every list pushes to** — two tabs, *Actions* and *Details* |
| `/fill/<token>` | `src/app/fill/[token]/page.tsx` | the customer's public form. No login |
| `/desktop/deliveries`, `/desktop/deliveries/<id>` | `src/app/desktop/...` | a separate desktop pair that already exists |

### 2.3 The API routes

| Route | Guard | What it does |
|---|---|---|
| `GET /api/deliveries` | `deliveries.view` | the list. Understands `status`, `outstation`, `area`, `search`, `date`, `dateRange` |
| `GET /api/deliveries/stats` | `deliveries.view` | the chip counts — 13 counts, one per status |
| `GET /api/deliveries/[id]` | `deliveries.view` | the row **plus** a computed `paymentStatus` read from `CustomerInvoice` |
| `PUT /api/deliveries/[id]` | `deliveries.edit` | every field edit **and** every status change, behind a transition table |
| `POST /api/deliveries/[id]/generate-token` | `deliveries.create` | mints the 48-hour self-fill token |
| `GET,PUT /api/public/delivery/[token]` | **none — public by design** | what `/fill/<token>` reads and writes |
| `GET /api/public/delivery-slots` | **none — public** | the 10-per-day slot calendar |
| `POST /api/deliveries/import-zoho` | `zoho.approve` | single-invoice import |
| `POST /api/zoho/trigger-pull` | `zoho.fetch` | the bulk fetch that writes `ZohoPullPreview` rows |
| `POST /api/zoho/pull-review/approve` | `zoho.approve` | **the Import button** — turns previews into `Delivery` rows |

### 2.4 The status transitions that exist today

`src/app/api/deliveries/[id]/route.ts:76-88` — a change not in this table is rejected:

```
PENDING          → VERIFIED, WALK_OUT, SCHEDULED, FLAGGED, PREBOOKED
VERIFIED         → WALK_OUT, SCHEDULED, PACKED
SCHEDULED        → OUT_FOR_DELIVERY, VERIFIED, PACKED, DELIVERED
PACKED           → SHIPPED, VERIFIED
SHIPPED          → IN_TRANSIT
IN_TRANSIT       → DELIVERED
OUT_FOR_DELIVERY → DELIVERED
FLAGGED          → PENDING
PREBOOKED        → VERIFIED
DELIVERED        → (terminal)
WALK_OUT         → (terminal)
```

---

## 3. What each thing the owner asked about does today

### 3.1 Save Contact — it writes nothing to the database (R2, R5, R6)

`src/app/(dashboard)/deliveries/[id]/_components/customer-info-card.tsx:16-44`

It builds a **vCard string in the browser** and hands it to the phone:

```ts
const vcard = `BEGIN:VCARD\r\nVERSION:3.0\r\nFN:${contactName}\r\nTEL;TYPE=CELL:+91${phone}\r\nEND:VCARD`;
const blob = new Blob([vcard], { type: "text/vcard" });
// 1. native share sheet if the device has one …
if (navigator.share && navigator.canShare?.({ files: [file] })) { … }
// 2. otherwise a programmatic <a download> — a .vcf file download
```

**Where it saves now — the answer to R2:**

| | |
|---|---|
| Database | **nowhere.** No `fetch`, no API call, no row written |
| The phone's contact list | yes — via the share sheet, or the downloaded `.vcf` |
| The app | one key in **`localStorage`**: `contact-saved-<deliveryId>` = `"1"` — `deliveries/[id]/page.tsx:33-42` |

So "the contact is saved" is, today, **a flag in one browser on one device**. Clearing site
data, or opening the same delivery on a different phone, and it is unsaved again. Nobody else
can see that it was ever done, and no `Customer` row exists afterwards.

### 3.2 The link generation gate (R9)

`detail-actions.tsx:141-144` — while `contactSaved` is false the screen shows *"Save customer
contact above to proceed"* and hides the Schedule / Walk-out buttons. But the **Generate Link**
card at `deliveries/[id]/page.tsx:230-236` is **not** behind that flag — the link can be
generated without ever pressing Save Contact. The server route
`generate-token/route.ts:9-42` checks `deliveries.create` and **nothing about a customer**.

### 3.3 The WhatsApp issue — the root cause is confirmed (R10)

There are **two different phone-normalisation routines in the same screen**, and only one of
them is correct.

**Correct** — `whatsapp-actions.tsx:25-29` and `schedule-form.tsx:33-37`:

```ts
const cleanPhone = phone.replace(/\D/g, "").slice(-10);   // strips +, -, spaces; keeps last 10
window.open(`https://api.whatsapp.com/send?phone=91${cleanPhone}&text=…`);
```

**Broken** — `self-fill-link-button.tsx:57-64`, the "Send via WhatsApp" that sends the link:

```ts
const phone = customerPhone.startsWith("+91") ? customerPhone.replace("+", "") : `91${customerPhone}`;
window.open(`https://wa.me/${phone}?text=${msg}`, "_blank");
```

It only removes a leading `+`. Everything else in the stored number survives. Run the real
data from `outwordapproevresponse.js` through it:

| Stored `customerPhone` | What the link becomes | Result |
|---|---|---|
| `9964288130` | `wa.me/919964288130` | works |
| `+91-9986282818` | `wa.me/91-9986282818` | **broken — the hyphen is still there** |
| `+91 9566843255` | `wa.me/91 9566843255` | **broken — a space in the URL** |
| `919741541309` (already prefixed) | `wa.me/91919741541309` | **broken — `91` twice** |
| `9999999999` (the WALKIN placeholder) | `wa.me/919999999999` | opens a chat with nobody |

`+91-` and `+91 ` forms are **not hypothetical** — 4 of the 100 rows in the captured import
response carry them. This is the bug.

### 3.4 The fill form (R12, R13)

| | Today | File |
|---|---|---|
| Alternate phone | **optional**, placeholder literally says "Optional" | `fill/[token]/page.tsx:384-395` (Bangalore), `:519-530` (outstation) |
| Primary vs alternate equal | **not checked**, on the client or the server | — |
| Server validation | accepts an alternate only if it matches `/^\d{10}$/`, otherwise **silently ignores it** | `api/public/delivery/[token]/route.ts:91-94` |
| Submit-enabled rule | address ≥ 5 chars + 6-digit pincode + a chosen date (Bangalore) / address + pincode (outstation) | `fill/[token]/page.tsx:223-233` |

### 3.5 The status after the customer submits — the bug is a missing line (R14, R15)

`api/public/delivery/[token]/route.ts:75-129`. The handler writes:

```
customerAddress, customerArea, customerPincode, customerPhone, alternatePhone,
deliveryNotes, isOutstation, mapsLink, scheduledDate, selfFillCompletedAt
```

**It never writes `status`.** The row therefore stays `PENDING`, exactly as the owner
reports — while `scheduledDate` **is** filled in. The screen then shows a delivery with a date
that appears under the *Pending* chip and nowhere else, which is the confusing state today.

Note the second consequence: only the **Bangalore** branch sends `requestedDate`
(`fill/[token]/page.tsx:129`). An **outstation** customer gets no slot picker at all, so an
outstation self-fill submits with **no date whatsoever** (`:131-138`).

### 3.6 Bangalore vs outstation (R18, R19, R20, R21)

- The API filter already exists: `?outstation=true|false` → `api/deliveries/route.ts:41-42`.
- `/deliveries/blr` and `/deliveries/outstation` already use it.
- **The tag on the main list:** the **desktop table** shows an `Outstation` badge
  (`deliveries/page.tsx:270`), and the detail header shows one (`detail-header.tsx:38-42`).
  The **mobile card** (`_components/delivery-card.tsx`) and the **BLR/Outstation list cards**
  (`delivery-list-view.tsx:149-229`) show **no Bangalore / Outstation tag at all**.
- **R20 confirmed:** `delivery-list-view.tsx:153` is `router.push('/deliveries/' + d.id)`.
  Both lists push into the one generic detail route, which is why the detail opens under
  `/deliveries/` with that section's header and back-arrow (`detail-header.tsx:23` goes to
  `/deliveries`, never back to the list you came from).
- **R21 confirmed:** `schedule-form.tsx:139-159` always renders **both** toggle buttons,
  "Inside Bangalore" and "Outside Bangalore", regardless of which list you came from and
  regardless of what the customer chose on the fill form.

### 3.7 "Estimated Delivery \*" (R22)

`schedule-form.tsx:278-320` — five preset buttons (Today / Tomorrow / After 3 days / After a
week / After a month) writing to `schedDate`, and the form **cannot be submitted without one**
(`:337`). The customer's own choice, already saved on `Delivery.scheduledDate` by the fill
form, is **not read into this form and not displayed**.

### 3.8 The details screen shows almost nothing (R23)

The *Details* tab renders `PaymentWarning` (`deliveries/[id]/page.tsx:269`), and that component
returns `null` unless `data.paymentStatus.hasPending` is true — `payment-warning.tsx:13`.

`paymentStatus` is computed in `api/deliveries/[id]/route.ts:32-44` from a **`CustomerInvoice`
row matched on `invoiceNo`**. `CustomerInvoice` rows are created only by the receivables
import. For a delivery brought in from a Zoho invoice **no such row exists**, so
`paymentStatus` is `null` and **nothing is rendered** — which matches the owner's description
of the tab.

Meanwhile the data the owner wants **is fetched from Zoho and then thrown away**:

- `api/zoho/trigger-pull/route.ts:500-501` writes `balance` and `status` (`"paid"`) into the
  preview — visible in `outwordfetch.js` on all 28 rows.
- `api/zoho/pull-review/approve/route.ts:618-637` creates the `Delivery` **without either
  field**, and `Delivery` has no column to put them in (`schema.prisma:1824-1906`).

### 3.9 `outwordfetch.js` — what the fetch returns (R3)

It is the response of the **Zoho fetch** step, before Import: `ZohoPullLog.latest` with its
`previews`. Read back mechanically:

| | |
|---|---|
| Pull id | `pull-1789543242446`, status `PENDING_REVIEW` |
| New rows found | **28 invoices**, 0 contacts, 0 items, 0 bills |
| Zoho API calls | **2** (it is a *listing* call, paged — not one call per invoice) |
| Provider | `pos` on all 28 → **Zakya**, not Books |
| Per-invoice fields | `date, phone, total, status, balance, storeId, provider, lineItems, salesPerson, customerName, invoiceNumber` |
| `lineItems` | **`[]` on all 28** — the Zoho *list* endpoint does not return line items |
| `status` / `balance` | `"paid"` / `0` on all 28 — **present here, dropped at import** |
| `storeId` | **`null` on all 28** |

Two findings worth naming:

1. **`lineItems: []` is why the review screen cannot show items.** The line items only arrive
   at Import, which makes **one `getInvoice` detail call per invoice**
   (`pull-review/approve/route.ts:586-600`) — 28 invoices = 28 further API calls. Showing items
   *before* import (if that is what R24 means) costs those calls at fetch time instead.
2. **`storeId: null` on every row** means no `Store.invoicePrefix` matched, even though the
   invoice numbers carry clear prefixes (`INV/25/…`, `BCC/24-25/…`). Every one of these
   deliveries will deduct stock from the **primary store** by fallback
   (`zoho-invoice.ts:68-90`) — including the `BCC/` ones, which belong to Bharath Cycle Centre.
   **This is a separate live defect, not part of this requirement.** See Q22.

### 3.10 `outwordapproevresponse.js` — what Import returns (R4)

This is **not** the import result itself. It is the shape of `GET /api/deliveries` — the
**refreshed delivery list** the screen loads after Import — `{ success, data[], pagination }`
with `total: 265, page 1 of 3, limit 100`. Every row is a full `Delivery`.

Read mechanically across the 100 rows on page 1:

| Fact | Count | Why it matters |
|---|---|---|
| `status` | `PENDING` on **100 / 100** | the whole import lands in one bucket |
| `lineItems` populated | **100 / 100** | the detail fetch at Import worked; **items exist on the row already** |
| `isOutstation` | `false` on **100 / 100** | nothing is tagged outstation at import; it is set later, by hand |
| `storeId` | `null` on **100 / 100** | confirms §3.9 finding 2 |
| `customerName` = `"WALKIN "` | **11 / 100** | all 11 share phone `9999999999` |
| phone `9999999999` | **11 / 100** | |
| phone `null` | 1 / 100 | |
| duplicate real phones | at least 4 numbers appear on 2 invoices each | the same human, two invoices |
| phone formats | plain `9964288130` **and** `+91-9986282818`, `+91 9566843255` | the WhatsApp bug in §3.3 |
| `alternatePhone` | `null` on every row | nothing fills it at import |
| `selfFillToken` | `null` on every row | |
| `verifiedBy` | `null` on every row | |

**The two numbers that decide the design of R5–R8:**

- **11 of 100 invoices are `WALKIN ` / `9999999999`.** If Save Contact writes that to
  `Customer`, one row named "WALKIN" becomes the customer of record for every walk-in in the
  business, for ever. `Customer.phone` is `@unique` (`schema.prisma:1695`), so there is no
  second one. ⛔ **Q1.**
- **The same phone already repeats across invoices**, which is precisely why R7/R8 ask for
  phone-keyed, non-duplicating saving.

### 3.11 The outward invoice's items (R24)

`lineItems` is a JSON column on `Delivery` and it **is** already rendered on the detail
screen — `LineItemsCard`, `deliveries/[id]/page.tsx:285`, but **only inside the *Details* tab**.
The places that do **not** show items: the import **review** list (they are `[]` there, §3.9),
the mobile delivery cards, and the *Actions* tab. **Which one R24 means is Q19.**

---

## 4. The questions

### 4.0 Answers from the owner (16 Sep 2026, asked one at a time)

The owner's answers **override** the recommendations written in §4.1 below. Where an answer
number (A-n) settles a §4.1 question, that question is marked in the table.

**Corrections to this document found in the same review** (code and captures re-read 16 Sep):

| Where | Was written | Actually |
|---|---|---|
| §3.3 | "4 of the 100 rows" carry `+91-` / `+91 ` | **58 of 100** are `+91-XXXXXXXXXX`, 41 are bare 10 digits, 1 is null. **No** `+91 ` (space) and **no** bare `91…` 12-digit form exists in the capture — those table rows were illustrative. 2 rows are **11 digits** after `+91-` (`+91-89512050058`, `+91-96322139817`). |
| §3.6 | the mobile card shows no Bangalore/Outstation tag | `delivery-card.tsx:105-109` **does** show an `Outstation` badge; only a "Bangalore" tag is missing. The BLR/Outstation list cards (`delivery-list-view.tsx`) show none. |
| §3.11, Q19(c) | list cards would need an item summary | Already there: `delivery-card.tsx:82-92` (all items), `delivery-list-view.tsx:184-190` (first + N more). |
| Q7 | reuse `POST /api/customers` guarded by `deliveries.edit` | That route is guarded by `customers.create` and is called by the receivables import (`receivables/page.tsx:208-212`). Changing its guard changes receivables. Needs a shared server helper instead. The route comment claiming the delivery import calls it is wrong — neither delivery import creates customers. |
| Q7 | — | `customerSchema` (`validations.ts:679-689`) normalises phone to the **last 10 digits** — which would turn `+91-89512050058` into a wrong number. |
| intro, R16, §3.9 | "Q1…Q22", "see Q9", "See Q22" | questions run Q1–Q26; R16's is Q14; §3.9's is Q26 |
| §6 files table | captures are "in this folder" | `outwordfetch.js`, `outwordapproevresponse.js`, `requirement.md` are still in `docs/deliveries/` |
| §2.2 | "top navbar" ambiguous (Q20) | the screenshot `docs/asset/image.png` shows it is the **Actions / Details tab switcher** on `/deliveries/<id>` |

**Answers**

| # | Question | Owner's answer | Settles |
|---|---|---|---|
| A1 | WALKIN / `9999999999` | **No special case.** Look up by phone; if present, don't save; if absent, save. (First walk-in creates one "WALKIN" row; later ones skip.) | Q1, Q4 |
| A2 | Link Delivery → Customer? | **Yes** — store `Delivery.customerId`. | Q2 |
| A3 | Wrong-length phone (`+91-89512050058`) | **Save as-is, as a string.** No refusal, no truncation. | — |
| A3b | Duplicate check comparison | **Exact text** comparison … | — |
| A12b | … made exact by one format | **Every phone in this flow is written `+91-XXXXXXXXXX`** (prefix `+91-` if missing; `+91 ` → `+91-`) — delivery phone, alternate, Customer save, duplicate check, main≠alternate check. Wrong-length numbers keep their digits. | Q13 |
| A13 | Existing `Customer` rows are bare 10 digits | **Also look up the bare 10-digit form** before inserting; if either exists, skip the insert and link to it. Old rows are not rewritten. | — |
| A4 | Permission for Save Contact | **`deliveries.edit`** | Q6 |
| A5 | Where "saved before link" is enforced | **Server + button** — the token route refuses without a linked customer. | Q8 |
| A6 | Walk-out gate | **Walk-out still requires the customer saved first.** | — |
| A7 | Link expiry | **24 hours** (was 48). **Once submitted, the form is locked** — not editable or re-submittable by the customer. | Q9 |
| A8 | Customer's mistake after submit | **Staff edit it on the details screen.** No re-send, the link stays locked. | — |
| A9 | WhatsApp number | **Main phone only**, cleaned to digits for the URL. | Q10 |
| A10 | Can the customer change the main phone on the form? | **No — read-only.** Customer types only the alternate. | — |
| A11 | Alternate mandatory where? | **Both** — Bangalore and outstation. | Q11 |
| A12 | Main ≠ alternate | Enforced client **and** server, compared in the `+91-` format (A12b). | Q12, Q13 |
| A14–A21 | In Progress status, requested-date column, approve permission, escape transitions, dashboard count | **Withdrawn by §1.1a.** No `IN_PROGRESS`. Customer submit → **`SCHEDULED`**, customer's date → `scheduledDate`. | Q14, Q15, Q16, Q17, Q18 void |
| A17 | Link sent while `VERIFIED` | Submitting moves it on the same way as from `PENDING` (now: → `SCHEDULED`). | — |
| A20 | Stock hold | Stock is reserved at `SCHEDULED`, as today. *(Now that the customer's submit makes it `SCHEDULED`, see open question N3.)* | — |
| A22 | Bangalore vs outstation before anyone chooses | **Three states: Bangalore / Outstation / Not chosen.** `/deliveries/blr` shows only Bangalore, `/deliveries/outstation` only Outstation. Needs a schema change (`isOutstation` is a boolean today). | Q23 (part) |
| A23 | Where the tag shows | **`/deliveries` only** (mobile cards + desktop table on that screen). | Q23 |
| A24 | "Top navbar" | Screenshot: the **Actions / Details tabs**. | Q20 (part) |
| A25 | Detail screen layout | **Remove the tabs. One scrolling screen**: summary card on top (amount, paid, balance, payment status, scheduled date "chosen by customer", Bangalore/Outstation), then customer, items, then actions. | Q25, R23, R28 |
| — | "Estimated Delivery \*" | **Removed completely** (R27). | Q22 superseded |
| A26 | Stock when the **customer's** submit makes it `SCHEDULED` | **Reserve if available; if short, still accept.** The delivery becomes `SCHEDULED` without the hold and the detail screen shows a red "Stock not reserved – short" warning. The public form never fails on stock. | — |
| A27 | Outstation date | **No date picker for outstation customers.** | — |
| A27b | Outstation status on submit | **`SCHEDULED`, no date.** Stock per A26. | — |
| A28 | Staff scheduling without the link | **Staff can still Schedule Delivery — without a date.** Only the customer's form sets a date. | Q22 |
| A29 | Separate route | **`/deliveries/blr/<id>` and `/deliveries/outstation/<id>`**, same one-screen layout (A25), back arrow returns to the list opened from. `/deliveries/<id>` stays for the main list. | Q20 |
| A30 | Inside/Outside toggle in the schedule form | **The row decides.** Bangalore → only Bangalore fields; Outstation → only outstation fields, on every route. **Only a Not-chosen row shows both buttons.** | Q21, R21 |
| A31 | Paid / balance source | **Save Zoho's `status` and `balance` on the delivery at import** (both import paths); paid = amount − balance. If a `CustomerInvoice` row exists for the invoice, show that instead. A snapshot — nothing refreshes it. | Q24 |
| A32 | Deliveries imported before this | **No backfill.** Show "Payment: not available". | — |
| A33 | Where items must show (R24) | **The one-screen detail is enough** (name, SKU, qty, amount). No items in the import review, no extra Zoho calls. | Q19 |
| A34 | Existing rows vs "Not chosen" | Rows the customer filled (`selfFillCompletedAt` set) or that reached `SCHEDULED` or later **keep** their Bangalore/Outstation value; unfilled `PENDING`/`VERIFIED` rows become **Not chosen**. | — |
| A35 | `storeId` null on all imports (Q26) | ~~Left open on purpose~~ — **superseded the same day by §1.1b (R29–R35) and A40–A46**: the prefix moves to the FLOOR warehouse. | Q26 → A40–A46 |
| A36 | The "change delivery date" editor (`delivery-date-editor.tsx`, same presets) | **Replace the presets with the 10-per-day slot calendar** the customer uses. Staff can change the date. | — |
| A37 | Stock when **staff** schedule and stock is short | **Same as A26** — accept, no hold, red warning. (Today it refuses.) | — |
| A38 | Short stock arrives later | **"Reserve stock now" button** on the warning. Mark Delivered still checks stock, so a short delivery cannot be delivered until stock exists. | — |
| A39 | WhatsApp confirmation when the customer scheduled | **Staff button on the detail:** "Scheduled by customer – confirmation not sent" + "Send confirmation on WhatsApp", which sets `whatsAppScheduledSent`. | — |

**Status flow after the owner's change**

```
PENDING / VERIFIED ──customer submits form (Bangalore: with date; Outstation: no date)──► SCHEDULED
PENDING / VERIFIED ──staff Schedule Delivery (no date)────────────────────────────────► SCHEDULED
SCHEDULED ──► dispatch / pack / ship … ──► DELIVERED        (unchanged)
```

Every move to `SCHEDULED` tries to reserve stock and never fails on a shortage (A26, A37).

**Which stock an outward reduces — answers to §1.1b (R29–R35)**

| # | Question | Owner's answer |
|---|---|---|
| A40 | Floor warehouse short, same store's godown has it | **An outward never reduces a GODOWN.** Only the matched FLOOR warehouse is reduced. (Today `deductFromStore` cascades FLOOR → GODOWN — `stock-location.ts:113-129`; that cascade goes for outward.) |
| A40b | Floor has too little at Walk-out / Delivered | **Refuse**: "Not enough stock on <floor warehouse> (has X, needs Y). Transfer from godown first." Nothing is saved. |
| A41 | What the primary FLOOR warehouse is for | Initially "fallback when no prefix matches" — **withdrawn by A41b**. |
| A41b | Invoice matching no prefix | **Imported with no warehouse, tagged "Dummy".** No fallback to any store or warehouse. |
| A41c | What staff can do with a Dummy delivery | **No actions, for now.** Listed only — no Schedule, Walk-out, Delivered, link. |
| A41d | Primary floor warehouse, now | **Mark it only.** A store with 2+ FLOOR warehouses must choose one primary on `/stores` (mandatory there), but **nothing uses it yet**. |
| A42 | `INVOICE-003951` | **A duplicate** — ignore it (it will simply be Dummy). |
| A42b | Which floor warehouse gets `INV/` and `BCC/` | **The owner sets the prefixes on `/stores` after the build.** Not recorded here. |
| A43 | The 265 already-imported deliveries | **Match them once**: open deliveries get their FLOOR warehouse from the prefix; unmatched become Dummy; `DELIVERED` / `WALK_OUT` rows are left untouched (their stock already moved). |
| A43b | Who starts that match (no cron allowed) | **A "Match warehouses" button on `/deliveries`** (`deliveries.edit`). Matches only open deliveries with no warehouse; re-runnable after prefix changes; never changes a delivery that already has one. |
| A44 | Walk-out handover checklist | **Keep the checklist** (items, accessories, salesperson ticks). |
| A45 | What the Walk-out screen shows | **A focused walk-out view only:** invoice, items, paid/balance, Save Customer (if not saved), the checklist, Confirm Walk-out. **No** self-fill link, Schedule, Flag, or Bangalore/Outstation. |
| A46 | Where the Scheduled stock hold is counted | **On the matched FLOOR warehouse** (`StockLevel.reservedQuantity`, which already exists), not product-wide. The A26 "short" warning means that floor is short. |

**Defaults taken without asking** (say if wrong):
- `Store.invoicePrefix` stops being read and is hidden on `/stores`; the column is dropped in a
  later release (CLAUDE.md rule 7).
- Prefixes are unique across FLOOR warehouses; a GODOWN has no prefix field. Matching stays
  "longest prefix wins", case-insensitive.
- `Product.reservedStock` is kept as the cached sum of the warehouse holds, the same way
  `currentStock` is the sum of `StockLevel.quantity`, so screens that read it keep working.
- The batch dispatch route (`api/deliveries/batch/route.ts:80-118`) follows the same rule as the
  single delivery route.

**Still open:** nothing. Everything needed for a plan is answered.

### 4.1 The original questions

⛔ = blocks a plan. The rest have a recommended default and can be answered while building.

### Save Contact and the Customer table

- ⛔ **Q1 — What happens when the customer is `WALKIN ` / `9999999999`?**
  11 of 100 imported invoices are exactly that. `Customer.phone` is unique, so saving them all
  produces **one** row that every walk-out in the business points at.
  *Recommended:* **block the save** for a known-placeholder number, show "enter the customer's
  real number first", and let the number be corrected on the details screen before saving.
  The alternative is to allow it and accept one shared WALKIN customer. Which?

- ⛔ **Q2 — Does saving the contact create a link between `Delivery` and `Customer`, or not?**
  There is no relation today (§2.1). Two options:
  **(a)** add `Delivery.customerId` (nullable, `@relation` to `Customer`) and stamp it on save —
  the delivery then *knows* its customer, and "is it saved?" is one field;
  **(b)** save the `Customer` row and keep matching by phone at read time — no schema change,
  but "is it saved?" is a query on every render, and the link breaks if the phone is edited.
  *Recommended:* **(a)**. It needs one migration. Confirm before a plan is written.

- **Q3 — Which fields go onto the `Customer` row?**
  *Recommended:* `name` = `Delivery.customerName`, `phone` = the 10-digit normalised number,
  `address` = `Delivery.customerAddress` if present, `type` = `WALK_IN`, `whatsapp` = same as
  phone. Confirm — especially `type`, which can also be `REGULAR` or `DEALER`.

- **Q4 — If the phone exists but under a different name, what wins?**
  Invoice says `CHANDU BCH1468`; the existing `Customer` says `Chandu`.
  *Recommended:* **do not touch the existing row.** R8 says "ignore if already present". Report
  "already saved as Chandu" on screen so the person can see what they matched.

- **Q5 — Is one button doing both jobs?** R5 says the click must save to the database and
  download nothing. Some staff genuinely want the number in their phone's contact list — that
  is what the vCard was for.
  *Recommended:* one button, **database only**, no vCard, no download — exactly as asked. Say
  so explicitly if a second "add to phone contacts" action should be kept somewhere.

- **Q6 — Which permission does saving need?** `customers.create` is the honest answer, but a
  dispatch clerk holding `deliveries.edit` may not hold it, and then the gate blocks the whole
  delivery flow. *Recommended:* the route checks **`deliveries.edit`** and writes the customer,
  because the act is "record this delivery's customer", not "administer customers". Confirm.

- **Q7 — Should the existing `POST /api/customers` be reused?** It already does exactly
  create-or-find by phone and returns `alreadyExisted: true` (`api/customers/route.ts:92-106`).
  *Recommended:* yes, reuse it, guarded per Q6 — do not write a second create-or-find.

### The link

- ⛔ **Q8 — What exactly does "customer is saved" mean to the Generate Link button?**
  Today the gate is `localStorage` on one device (§3.1) and it does not even cover this button
  (§3.2). *Recommended:* the **server** refuses to mint a token unless a `Customer` row exists
  for this delivery's phone (or `Delivery.customerId` is set, per Q2), and the button is
  disabled with the reason shown. A client-only check would be cosmetic — CLAUDE.md forbids
  leaving the client as the only gate.

- **Q9 — Is the 48-hour expiry still right** (`generate-token/route.ts:31`)? A customer who
  opens the message on Monday for a Thursday delivery is inside it; one who ignores it for a
  weekend is not. *Recommended:* leave 48 hours, and make "Generate Link" re-mint an expired
  token in place, which it already does.

- **Q10 — Which number does the WhatsApp send use if there are two?**
  R10 says "the phone number that is there in the details". *Recommended:* **`customerPhone`**,
  normalised as in §3.3. Say if the alternate should be offered as a second button.

### The fill form

- **Q11 — Is the alternate number mandatory on both branches** — Bangalore *and* outstation?
  *Recommended:* both, since R12 does not distinguish.

- **Q12 — Where is "must not be the same" enforced?** *Recommended:* **both** — the client
  disables Submit with the message, and the public `PUT` re-checks and returns 400. The public
  route has no auth, so client-only validation is bypassable with one `curl`.

- **Q13 — What is compared?** `9741541309` vs `+91 97415 41309` are the same human.
  *Recommended:* compare the **last 10 digits after stripping non-digits**, the same rule as
  the WhatsApp fix. Also fix `route.ts:87-94`, which currently **silently drops** any number
  that is not exactly 10 bare digits.

### The status

- ⛔ **Q14 — Confirm the new status, its name and its enum value.**
  The owner's reading is **correct**: the customer's submission is a *request*, not a
  commitment, so `SCHEDULED` would be a lie. `DeliveryStatus` has no value for it today.
  *Recommended:* add **`IN_PROGRESS`**, labelled **"In Progress"** — `getStatusLabel` and the
  amber colour already exist for that key (`status-colors.ts:17,63`), so only the enum, the
  transition table, the chips and the stats need the new value. It needs **one migration**
  (additive: a new enum value, safe under CLAUDE.md rule 7).
  Alternative names: `AWAITING_CONFIRMATION`, `REQUESTED`. Which?

- ⛔ **Q15 — Where does the customer's chosen date live before the store commits?**
  The public route writes it straight to **`scheduledDate`** today (`route.ts:122`) — the same
  column the store's committed date uses, and the same one the slot counter counts
  (`:112-118`). So a request the store has not accepted already consumes a slot and already
  looks scheduled. *Recommended:* add **`customerRequestedDate`** and write the customer's
  choice there; `scheduledDate` is set only when a person schedules it. This changes what the
  slot counter counts — say whether a *request* should hold a slot.

- **Q16 — What is the exact new flow?** *Recommended:*
  `PENDING → IN_PROGRESS` (customer submits the form, no login) →
  `IN_PROGRESS → SCHEDULED` (a person holding the scheduling permission accepts, and may change
  the date) → then dispatch → delivered, unchanged. Also allow `IN_PROGRESS → FLAGGED` and
  `IN_PROGRESS → PENDING` so a wrong submission can be undone. Confirm the escape routes.

- **Q17 — Which permission schedules?** *Recommended:* **`deliveries.approve`** — it exists in
  the catalog (`prisma/rbac-catalog.ts:170`) and CLAUDE.md is explicit that "who may confirm"
  is expressed as the module's `approve` grant, never a role name. A new
  `deliveries.schedule` action is possible but adds a catalog entry and a re-seed. Confirm.

- **Q18 — Does the customer's submission need to reach anyone?** There are no cron jobs and no
  polling in this application by design, so an *In Progress* delivery is seen only when someone
  opens the screen. *Recommended:* add the count to the chips and the stats so it is visible on
  open. A push notification is possible (`NotificationOutbox` exists) but is extra scope.

### Listing, routes and the details screen

- ⛔ **Q19 — R24: which screen must show the outward's items?**
  **(a)** the **import review list** — items are `[]` there and filling them costs one Zoho
  detail call per invoice at fetch time (§3.9);
  **(b)** the **delivery details** — items are already shown, but only in the *Details* tab;
  **(c)** the **list cards** — a one-line summary.
  *Recommended:* **(b) + (c)**, which need no extra API calls. If it is (a), the fetch cost
  must be accepted up front.

- ⛔ **Q20 — R20: what is the new route, and what should stop appearing?**
  *Recommended:* `/deliveries/blr/[id]` and `/deliveries/outstation/[id]`, both rendering the
  same detail component with a `scope` prop, with the back arrow returning to the list you came
  from instead of `/deliveries`. But "top navbar" is ambiguous — the dashboard layout has no
  per-section nav bar (`(dashboard)/layout.tsx`). Does it mean **(i)** the back-arrow row with
  the invoice number (`detail-header.tsx:22-47`), **(ii)** the **Actions / Details** tab
  switcher (`deliveries/[id]/page.tsx:188-205`), or **(iii)** the app's own mobile header? A
  screenshot settles this in one second.

- **Q21 — R21: what decides which toggle is hidden — the route, or the row?**
  *Recommended:* the **row**. If the customer chose "Outside Bangalore" on the fill form,
  `isOutstation` is already `true` on the row, and the schedule form should show only the
  outstation fields no matter which list it was opened from. Hiding by route alone would show
  the wrong form for a row that was opened from the other list. Confirm.

- **Q22 — R22: what happens when nobody filled the form?**
  Removing the "Estimated Delivery" picker removes the **only** way to set a date for a
  walk-in the staff schedules by phone, and `scheduledDate` is required by the submit rule
  (`schedule-form.tsx:337`). *Recommended:* show the customer's chosen date as read-only text
  **when one exists**, and fall back to the picker **only when it does not**. Confirm this
  rather than removing the picker outright.

- **Q23 — R19: which tag, and on which lists?** *Recommended:* a badge on the mobile delivery
  card and on the BLR/Outstation list cards, reading **"Bangalore"** or **"Outstation"** from
  `isOutstation`, matching the badge the desktop table already renders
  (`deliveries/page.tsx:270`). Note that **`isOutstation` is `false` on every freshly imported
  row** (§3.10) — until someone schedules it or the customer fills the form, *every* delivery
  tags as "Bangalore". Should an unfilled row read **"Not set"** instead?

- ⛔ **Q24 — R23: where do payment status and balance come from?**
  Two sources, and they disagree:
  **(a)** `CustomerInvoice` — what the screen reads today; absent for Zoho-imported deliveries,
  which is why the tab looks empty;
  **(b)** **Zoho's own `status` and `balance`**, already fetched into the preview and discarded
  at import (§3.8).
  *Recommended:* **(b)** — add `paymentStatus` and `balance` columns to `Delivery`, fill them at
  import from the preview, show them in the *Details* tab, and keep the `CustomerInvoice`
  banner as an override when a receivables row does exist. This needs **one migration** and a
  change to both import paths. Confirm before a plan.

- **Q25 — R23 says "i need a top nav … i think i dont need the tab".** Read as: **no new tab,
  no new nav — put payment status and balance into the existing *Details* tab.**
  *Recommended:* that reading. Say so if a compact strip under the header was meant instead.

- **Q26 — `storeId` is `null` on all 265 imported deliveries (§3.9, §3.10).** Every one of them
  will deduct stock from the primary store by fallback, including the `BCC/` invoices that
  belong to Bharath Cycle Centre. This is **outside this requirement** but it is live and it
  moves real stock. Fix it in this work, or raise it separately?

---

## 5. The permission map (data, not code)

Nothing here is a new module. Proposed grants, all existing actions on the existing
`deliveries` module (`prisma/rbac-catalog.ts:162-171`):

| Action | Guards |
|---|---|
| `deliveries.view` | the lists, the detail, the stats — unchanged |
| `deliveries.edit` | saving the customer (Q6), editing the phone, the address |
| `deliveries.create` | generating the self-fill link — unchanged, plus the new "customer must be saved" precondition (Q8) |
| ~~`deliveries.approve`~~ | ~~moving `IN_PROGRESS → SCHEDULED`~~ — withdrawn with the status (§1.1a); no new grant needed |
| *(public, no permission)* | `/fill/<token>` and `/api/public/delivery/<token>` — **must stay public**; CLAUDE.md names this route as one that has already been broken once by adding a check |

A new `deliveries.schedule` action is possible instead of reusing `approve`. It is a catalog
edit plus `npm run db:seed:rbac` after deploy — data, never code.

---

## 6. Out of scope, and the work record

**Out of scope for this document**

- The batch dispatch screen `/deliveries/dispatch` and its batching rules — those are the open
  questions in the older `requirement.md` in this folder, unanswered.
- Assembled vs unassembled stock, and the dashboard rework — also in `requirement.md`.
- The `BCC/` store-attribution defect (Q26), unless the owner folds it in.

**Migrations this work would need** (none written, none applied — CLAUDE.md: Claude may apply
to local `bch` only, and the owner runs `migrate deploy` by hand):

~~1. `DeliveryStatus` += `IN_PROGRESS`~~ — withdrawn (§1.1a).
2. `Delivery.customerId` → `Customer` — nullable (A2).
~~3. `Delivery.customerRequestedDate`~~ — withdrawn (§1.1a: the customer's date is `scheduledDate`).
4. `Delivery.paymentStatus` + `Delivery.balance` — nullable (A31).
5. **Bangalore / Outstation / Not chosen** (A22, A34) — `isOutstation` is a boolean. The shape
   (nullable boolean vs a new enum column) is a plan decision; either way it is additive first,
   with a backfill per A34, and the boolean is dropped only in a later release (rule 7).

A stock-reservation flag or "reserved short" marker may also be needed for A26/A37/A38 —
decided in the plan against the existing `stockReservedAt`.

6. `Warehouse.invoicePrefix` — nullable, unique (R30, R32).
7. `Warehouse.isPrimary` (or an equivalent per-store marker) — nullable/default false (R33, A41d).
8. `Delivery.warehouseId` → `Warehouse` — nullable; null + no prefix match = Dummy (R31, A41b).
   Whether "Dummy" is derived from `warehouseId IS NULL` or stored as its own flag is a plan
   decision.

**Work record**

| When | What |
|---|---|
| 16 Sep 2026 | Document written. Requirements listed, module mapped against the code at `file:line`, both captured responses parsed, 26 questions raised, 8 blocking. **No code changed. No plan written. Nothing built.** |
| 16 Sep 2026 (later) | Re-verified against code and captures; errors corrected in §4.0. Owner answered A1–A25 one at a time, then changed the flow (§1.1a, R25–R28): **no In Progress status**, customer submit → `SCHEDULED`, Estimated Delivery removed, tabs removed. Then answered A26–A39 (stock on schedule, outstation, routes, toggle, payment, items, Not-chosen backfill, date editor, WhatsApp confirm). **Only Q26 left open, by choice. Ready for a plan.** Still no code, no plan. |
| 16 Sep 2026 (evening) | Owner's second change §1.1b (R29–R35): invoice prefix on the FLOOR warehouse, outward reduces that floor only, Dummy for unmatched, primary floor warehouse, focused walk-out. Answered A40–A46. Q26 closed. **Nothing open.** No code, no plan. |

**Files in this folder**

| File | What it is |
|---|---|
| `deliveries-outward-and-self-fill-requirements.md` | this document |
| `requirement.md` | the owner's running notes on delivery/dispatch, incl. the unanswered batching questions |
| `outwordfetch.js` | captured response of the Zoho **fetch** — 28 previews (§3.9) |
| `outwordapproevresponse.js` | captured delivery list after **Import** — 100 of 265 rows (§3.10) |
