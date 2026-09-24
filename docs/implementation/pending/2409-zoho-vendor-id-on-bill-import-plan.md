# The bill import saves Zoho's vendor id, and resolves the vendor by that id instead of by name

Status: pending — built 24 Sep 2026 on `feat/zoho-vendor-id`; Q1–Q4 answered. Migration
`20260924034908_vendor_zoho_vendor_id` applied to the test database; verified there by a real
fetch + approve (4 bills → 2 vendors, each with its Zoho id and GSTIN). Not yet merged or on production.
Branch: `feat/zoho-vendor-id`.

Every `file:line` below was read from disk on 24 Sep 2026.

---

## 0. Requirement

### 0.1 The owner's words, verbatim (24 Sep 2026)

> "ok then make this like at the time of import we need to save the zoho vendor id and i think
> we shoudl not create the vendor by the name matching we cna create it by chceking the vendor
> id which are uinque with there related details insded of namematching which is more time
> taken for search and check"

Context from the same conversation: the goal behind it is "to create a invoice in zoho of the
vendor to track the po" — every Zoho write about a vendor (bill, purchase order) needs Zoho's
`vendor_id`, and the app does not keep it.

### 0.2 Restated as requirements

- **R1** — When bills are fetched from Zoho for the inbound import, save each bill's Zoho
  `vendor_id`.
- **R2** — On import, find the app's vendor by that Zoho vendor id, not by name.
- **R3** — When no vendor has that id, create the vendor with the id stored on it, together with
  its related details from Zoho (GSTIN, address, phone, email and so on) — not just a name.
- **R4** — Stop creating vendors by name matching in the import.

---

## 1. Questions and clarifications — answer before build

| # | Question | Why it changes the build | Options | Recommended | Answer |
|---|---|---|---|---|---|
| Q1 | Vendors that **already exist** in the app were created by name and have no Zoho id. The first import after this ships will look for the id, find nothing, and try to create a vendor — but `Vendor.name` is `@unique` (`prisma/schema.prisma:1095`), so the create fails for every one of them. How are existing vendors linked? | Without an answer, the first import after deploy fails for every known vendor. | **(a)** One-time link in the import: id miss → a vendor with the **same name AND no Zoho id yet** gets the id written onto it, once. After that it is id-only for that vendor forever. **(b)** A separate "Link vendors to Zoho" button that pulls every Zoho vendor (`listAllContacts`, `books.ts:141`) and links by GSTIN, then name; the import stays strictly id-only and **fails** a bill whose vendor is unlinked. **(c)** Both. | **(a)** — the name check only ever runs for a vendor that has never been linked, so it disappears on its own and needs no extra screen. | |
| Q2 | Bills can come from **Zakya** when Books is not connected (`trigger-pull/route.ts:258-262`). A Zakya `vendor_id` is from a different Zoho product and is **not** the Books vendor id that a Books bill or PO needs. | Storing it as the Zoho vendor id would silently put a wrong id on the vendor. | **(a)** Save the id only when the source is Books; a Zakya bill keeps today's name behaviour with a warning. **(b)** Refuse to import Zakya bills. | **(a)** | |
| Q3 | When an import finds a vendor **by id** and Zoho's details differ from the app's (new phone, GSTIN corrected), should the app overwrite its copy? | Overwriting on every import undoes edits made on `/vendors`. | **(a)** Details are copied only when the vendor is created; never overwritten. **(b)** Refresh from Zoho on every import. | **(a)** | |

### 1.1 Decisions on record

| Date | Q | Decision |
|---|---|---|
| 24 Sep 2026 | Q2 | **Owner: "where ever it fetch the flow must be same."** The vendor id is saved and resolved identically for Books and Zakya bills — (a) is rejected. Known consequence, recorded not argued: a Zakya-sourced id is not a Books contact id, so a later Books bill/PO push for such a vendor would need re-linking. §3.3 changes accordingly. |
| 24 Sep 2026 | Q3 | **Owner: "no vendor details in aplication will be changed manually as of now."** Zoho is the source of vendor details; the app does not edit them. Open: copy at creation only, or refresh on every import — see Q4. |
| 24 Sep 2026 | Q1 | **Moot.** On the owner's instruction every vendor and every inbound record was deleted from the test database (snapshot `backups/postgres-2026-09-24T03-03-51-before-vendor-inbound-wipe.dump`); production has never received inbound. No vendor exists without a Zoho id, so §3.4 step 3 (one-time name link) is **dropped**: the import resolves strictly by `zohoVendorId`, and a name collision with a different id is an error. |
| 24 Sep 2026 | Q4 | **Owner: "let the details what it is be at the time of first creation and dont need to change the details every time that it only once."** Details are copied from Zoho once, when the vendor is created, and never refreshed by an import. A vendor found by id is used as-is — no `getContact` call. |

### 1.2 A correction to the premise, for the record

The ask says name matching "is more time taken for search and check". Measured against the
code, speed is not the real problem: the vendor table is small and the name lookup is one
query. The real problem is **correctness** — `"Hero Cycles"` and `"Hero Cycles Ltd"` are two
different names for one Zoho vendor, and today that produces a second vendor row. Matching by
id fixes that. The build is the same either way; the reason is recorded so nobody later
"optimises" the id lookup back into a name lookup.

---

## 2. How it works today — verified against the code

### 2.1 The `Vendor` table has no Zoho id

`prisma/schema.prisma:1093-1133`. `name` and `code` are `@unique`; nothing stores a Zoho
identifier. (Brands and categories already have theirs — `zohoBrandId` / `zohoCategoryId`,
plan `0709-zoho-brand-category-sync-plan.md` — this plan follows that precedent.)

### 2.2 Fetch: Zoho sends `vendor_id`, the app drops it

- The bill list is `GET /bills` (`src/lib/integrations/base.ts:354-376`). Its row type,
  `IntegrationBill` (`base.ts:43-53`), declares `vendor_id`.
- `src/app/api/zoho/trigger-pull/route.ts:347-365` writes each new bill into
  `ZohoPullPreview.data` as `billNumber, vendorName, date, dueDate, total, balance, status,
  lineItems` — **`vendor_id` is not copied**.

### 2.3 Approve: the vendor is found or created by name

`src/app/api/zoho/pull-review/approve/route.ts:194-206`:

```ts
let vendor = await prisma.vendor.findFirst({
  where: { name: { equals: String(d.vendorName), mode: "insensitive" } },
});
if (!vendor) { vendor = await prisma.vendor.create({ data: { name: String(d.vendorName), code } }); }
```

Only a name and a generated code are written. No GSTIN, address, phone or email, and no
error handling for the unique-name race. The same branch runs for the accounting import
(`source === "accounting"`), so both paths get the fix.

### 2.4 The Zoho client can already read vendors — but not one by id

`src/lib/integrations/books.ts`: `createContact` (:79), `searchContacts` (:98),
`listContacts` / `listAllContacts` (:118, :141). There is no `getContact(id)`; R3 needs one.

### 2.5 Other places that create vendors by name — not touched here

- `src/app/api/inbound/[id]/issues/route.ts:152-176` — find-or-create by **brand** name when
  an issue is raised on a shipment. No Zoho bill is involved, so there is no id to use.
- `src/lib/inbound/complete-shipment.ts:195` — `createBill` pushes a manual shipment's bill to
  Zoho with `vendor_name` only (`books.ts:186`). Zoho needs `vendor_id`, so this push fails
  and is logged at `warn`. Fixing it needs this plan first; see §5.

### 2.6 The vendor forms cannot write the new column

`vendorSchema` / `vendorUpdateSchema` (`src/lib/validations.ts`) are `z.object` whitelists,
which strip unknown keys, so `POST /api/vendors` and `PATCH /api/vendors/[id]` cannot set or
clear the Zoho id. That is correct — the id comes from Zoho only.

---

## 3. Implementation plan

### 3.1 Schema and migration

- `Vendor.zohoVendorId String? @unique` — nullable, additive (rule 7). The unique index is the
  lookup index, so no extra `@@index`.
- `npx prisma migrate dev --name vendor_zoho_vendor_id` **on localhost only** (rule 2).
  **Blocker:** `.env` `DATABASE_URL` currently points at the Supabase pooler, not localhost.
  It must be switched to a local restore (rule 10) before the command runs.
- Expected SQL: `ALTER TABLE "Vendor" ADD COLUMN "zohoVendorId" TEXT;` plus a unique index.
  No drop, no type change, no `NOT NULL`.

### 3.2 Zoho client — `src/lib/integrations/books.ts`

- New `getContact(contactId)` → `GET /contacts/{id}`, typed to the fields R3 copies:
  `contact_name, gst_no, pan_no, email, phone, mobile, billing_address{address, street2, city,
  state, zip}, payment_terms`. Registered in `src/lib/integrations/endpoints.ts` like its
  siblings. Read with the client's existing `apiCall`, so the `readJson` rule holds.

### 3.3 Fetch — `src/app/api/zoho/trigger-pull/route.ts`

- Add `vendorId: bill.vendor_id` to the preview data for **every** source, Books and Zakya
  alike (Q2, owner 24 Sep). Only previews fetched before this ships have no `vendorId`.
  `getContact` in §3.4 is called on whichever client fetched the bill.

### 3.4 Approve — one resolver, `src/lib/vendors/resolve-zoho-vendor.ts` (new)

Replaces `approve/route.ts:194-206`. In order:

*Revised 24 Sep 2026 after Q1–Q4 were answered and the vendor/inbound wipe — this is what was
built.*

1. **No `vendorId` on the preview** (only a preview fetched before this shipped — all were
   deleted in the wipe) → the bill **fails** with "reject this pull and fetch again". No name
   fallback (R4).
2. **`findUnique({ where: { zohoVendorId } })`** → found: use it as-is. No Zoho call, no
   refresh (Q4).
3. ~~One-time name link~~ — **dropped** (Q1 moot after the wipe).
4. **Create:** `getContact(vendorId)` on the client that fetched the bill (`vendorSource`:
   Books, or Zakya for `"pos"` — Q2), then create the vendor with `zohoVendorId` and name,
   GSTIN, PAN, address lines, city, state, pincode, phone (`+91-` form when parseable), email,
   primary contact person + designation, payment-term days. If the read fails, create with the
   bill's name and the id only, and push a notice to complete the details on `/vendors`.
5. **P2002 on create:** on `zohoVendorId` → a parallel approve won, re-read it; on `code` →
   retry once with a fresh code; on `name` → a different Zoho vendor already owns this name,
   the bill fails with a sentence saying so.

`vendorCodeFor` moves from `inbound/[id]/issues/route.ts:86` to `src/lib/vendors/code.ts` so
both callers share one code generator.

### 3.5 Vendors screen

Read-only: show "Zoho vendor id" on `/vendors/[id]` when set. Not editable (§2.6).

### 3.6 RBAC

None. The approve route is already `requireFeature("zoho", "approve")`
(`approve/route.ts:86`); no new route.

### 3.7 Logging

`createLogger("vendors:zoho-resolve")`. `debug` for the `getContact` call; `info` for linked
and created (with `vendorId`, `zohoVendorId`, `billNo`); `warn` for the name fallback and a
failed `getContact`; `error` for the conflicting-id case. Identifiers only — never the
contact payload.

### 3.8 Board of agents — to check at build

database-architect (the column, the index, the migration SQL), integration-architect
(`getContact`, the Books-vs-Zakya id rule), accounting-consultant (vendor identity feeds
bills and payments), backend-engineer (the resolver and its errors).

---

## 4. Verification

1. `npx prisma migrate dev` on a localhost restore; read the SQL (§3.1).
2. `npm run build` passes.
3. On `/inbound` → Fetch a date window that includes:
   - a bill from a vendor that **already exists** by name → after approve, that vendor has a
     Zoho id and no second vendor was created;
   - a bill from a vendor the app has **never seen** → a new vendor exists with the Zoho id
     **and** GSTIN / address / phone filled from Zoho;
   - a second bill from the same vendor → matched by id (log line `vendor resolved by id`).
4. Re-fetch the same window → no duplicate vendors, bills reported as already imported.
5. `/vendors/[id]` shows the Zoho vendor id.

---

## 5. Out of scope, deliberately

- **Pushing a bill or a purchase order to Zoho with `vendor_id`** (`complete-shipment.ts:195`,
  `books.ts:179-197`). That is the next plan, and it is the reason this one exists — it can
  only be written once vendors carry the id.
- **Manually entered inbound shipments** — they never pass through a Zoho bill, so there is
  no id to save. Linking their vendor to Zoho belongs to the next plan.
- **The inbound-issue auto-create by brand name** (`inbound/[id]/issues/route.ts:152-176`).
- **A bulk "link every vendor to Zoho" button** — only if Q1 is answered (b) or (c).
