# Vendors come from Zoho by id; the old vendor issues are re-attached to them

Status: pending — **Part A built 24 Sep 2026** on `feat/zoho-vendor-sync` (from `origin/main` @ `045c89d`);
`tsc`, `eslint`, `npm run build` pass; the preview logic was run read-only against the test
database's Zoho: **100 Zoho vendors — 2 already here, 98 new, 0 clashes, 97 with a GSTIN.**
Not yet clicked through in the browser. **Part B not built** — blocked on
`prisma/data/vendor-and-issues-backup.sql`, which is not on this machine.
Branch: `feat/zoho-vendor-sync`.

Every `file:line` below was read from disk on 24 Sep 2026.

---

## 0. Requirement

### 0.1 The owner's words, verbatim (24 Sep 2026)

> "check is this possible that let me insert the vendor and the vendor issue and for the vendor
> id we can make or else how can we make this or else we can jsut fetch the vendor and insert the
> vendor details only vendor and we will have the vendors and we can insert the vendor issuse with
> respect to the vendors so that when even at the time of inbound it will check the vendor id as
> it alerdy there it wont create agian and this way it can be handled"

### 0.2 Restated as requirements

- **R1** — Fetch the vendors from Zoho and create them in the app **with their Zoho vendor id**
  and their details.
- **R2** — Insert the old vendor issues **against those vendors**.
- **R3** — The bill import then finds every such vendor by its Zoho id and never creates it
  again (already true since plan `2409-zoho-vendor-id-on-bill-import` — this plan only fills the
  table it reads).

---

## 1. Questions and clarifications

| # | Req | Question | Options | Answer (24 Sep 2026) |
|---|---|---|---|---|
| Q1 | R1 | How are vendors pulled from Zoho? | (a) a button on `/vendors`, preview then import, re-runnable (b) a one-time script | **(a) button** |
| Q2 | R1 | How much detail is copied? | (a) full — one detail read per new vendor (b) list fields only | **(a) full** |
| Q3 | R2 | Where do the issues come from? | (a) this morning's snapshot (b) the old app's backup file | **(b) `prisma/data/vendor-and-issues-backup.sql`** |
| Q4 | R2 | An issue whose old vendor matches no Zoho vendor? | (a) keep it, unattached, and report it (b) skip and report (c) recreate the vendor without an id | **(a) keep, unattached** |

### 1.1 Decisions that follow from earlier plans (not re-asked)

- Details are copied **once, at creation**, never refreshed (plan 2409-zoho-vendor-id, Q4).
- The everyday bill import never matches by name (R4 there). The **one-time** issue move in
  Part B does match old vendor → Zoho vendor by GSTIN then exact name; that is a data migration
  step, run once, not a runtime rule.

---

## 2. How it works today — verified against the code

- **Vendors table:** 2 rows, both from today's bill import, both with `zohoVendorId` and GSTIN.
  All 83 older vendors and 186 issues were deleted on 24 Sep 2026 (snapshot
  `backups/postgres-2026-09-24T03-03-51-before-vendor-inbound-wipe.dump`).
- **Zoho vendor list:** `BooksClient.listAllContacts()` (`src/lib/integrations/books.ts:141`)
  pages `GET /contacts?contact_type=vendor` 200 at a time; each row has `contact_id,
  contact_name, gst_no, email, phone, billing_address{city,state}`. **No caller today.**
- **Zoho vendor detail:** `getContact(id)` (`src/lib/integrations/base.ts`, added by PR #62) and
  the mapping `vendorDataFrom()` in `src/lib/vendors/resolve-zoho-vendor.ts` — GSTIN, PAN,
  address, pincode, phone (+91 form), email, primary contact person, payment terms.
- **The pattern to copy:** the Zoho brand / category import — `api/brands/zoho-preview` +
  `api/brands/zoho-import`, `api/categories/zoho-*`, one sheet component
  `src/components/zoho-taxonomy-sheet.tsx` used on `/more/brands` and `/categories`.
- **RBAC:** `vendors` has `view, create, edit, delete` (`prisma/rbac-catalog.ts:320-328`).
- **The old issues:** `npm run db:import -- --only=vendors` (`scripts/db/import-catalog-and-vendors.mjs`)
  loads Vendor → VendorContact → VendorIssue → VendorIssueNote from the backup file **as-is** —
  old vendors by name, no Zoho id. **It is not used by this plan** (it would re-create exactly
  the vendors the wipe removed). The file itself is gitignored and absent here (`:161`).
- **VendorIssue:** `vendorId` is **nullable** (Q4a needs this); `issueNo` is `@unique`
  (`ISS-YYYYMM-NNNN`); `createdById` is required; `billId` points at a `VendorBill` that no
  longer exists. **VendorIssueNote:** `issueId`, `text`, `authorId` required.

---

## 3. Implementation plan

No schema change, no migration, no RBAC catalog change.

### Part A — "Import vendors from Zoho" on `/vendors` (R1, R3)

- **`GET /api/vendors/zoho-preview`** — `requireFeature("vendors","create")`. `listAllContacts()`
  on Books; classifies each Zoho vendor as:
  - **new** — no Vendor has this `zohoVendorId`, and no Vendor has this name;
  - **already here** — a Vendor carries this `zohoVendorId` (skipped, never updated — Q4 of 2409);
  - **name clash** — a Vendor has this exact name but no / another Zoho id (shown, not imported;
    the person renames one side).
  Returns counts and rows. Only reads.
- **`POST /api/vendors/zoho-import`** — same guard; body = the Zoho ids to import (from the
  preview). Processes in **batches of 25** so one request stays well inside `maxDuration` and
  Zoho's ~100 calls/min; the screen calls it repeatedly with the next batch and shows progress
  ("Imported 75 of 212"). Per vendor: `getContact(id)` → `vendorDataFrom()` → `vendor.create`
  with `zohoVendorId`. Re-reads by id first, so a re-run or a double click creates nothing
  twice; P2002 handled as in `resolve-zoho-vendor.ts`. `getContact`'s mapping is **reused, not
  copied** — `vendorDataFrom` is exported for it.
- **Screen:** an "Import from Zoho" button on `/vendors` (visible with `vendors.create` —
  cosmetic; the API re-checks) opening the preview sheet: three tabs (New / Already here / Name
  clash), Import runs the batches with a progress bar and a final summary.
- **Logging:** `createLogger("vendors:zoho-sync")` — `debug` per Zoho call, `info` per batch
  `{ created, skipped }`, `warn` per clash / failed detail read, `error` on a failed batch.

### Part B — re-attach the old vendor issues (R2)

A script, because the input is a local, gitignored file:
`npm run db:import:vendor-issues -- [--dry-run] [--yes]`
(`scripts/db/import-vendor-issues.mjs`, new).

1. Reads `prisma/data/vendor-and-issues-backup.sql`. Stages its Vendor / VendorIssue /
   VendorIssueNote rows into **temporary tables** inside one transaction — the real `Vendor`
   and `VendorContact` tables are never written by this script.
2. Maps each old vendor → a current vendor: **GSTIN** first (exact, uppercased), then **exact
   name** (case-insensitive). No match → the issue goes in with `vendorId: null` (Q4a).
3. Inserts the issues and their notes:
   - `vendorId` = the mapped vendor or null;
   - `billId` = null (the old bills were deleted);
   - `createdById` / `authorId` = the oldest active user whose role is a **system role**
     (`role.isSystem`, as `pull-review/approve` does) — never a role name (CLAUDE.md rule 1);
   - `issueNo` kept; an `issueNo` that already exists is **skipped and reported**, not
     overwritten (re-runnable).
4. Raises each `ISS-YYYYMM` counter row to the highest imported number of that month, so the
   next new issue does not collide with an imported one.
5. Prints a report: matched by GSTIN / by name / unattached (issue no. + old vendor name), and
   skipped duplicates. `--dry-run` does steps 1–3 and rolls back.
6. Refuses a non-localhost target without `--yes`, prints host and database name only, never
   the URL (same as `db:import`).

**Order matters:** Part A first (so the vendors exist), then Part B.

### Board of agents — to check at build

integration-architect (list + detail reads, batching, rate limit), database-architect (the
staging tables, counter bump), accounting-consultant (vendor master from Zoho), frontend-engineer
(the sheet and progress).

---

## 4. Verification

1. `npx tsc --noEmit`, `npm run build`.
2. `/vendors` → Import from Zoho → the preview shows INKODOP and SHRI TAJ under **Already here**;
   import the rest → each new vendor has its Zoho id, GSTIN and address; re-open the preview →
   everything is **Already here**; a second import creates nothing.
3. `npm run db:import:vendor-issues -- --dry-run --yes` → report only, nothing written.
4. Without `--dry-run` → issues appear on `/vendor-issues` under the right vendors; unattached
   ones are listed in the report and visible with no vendor; a re-run skips every issue.
5. Fetch + approve a Zoho bill from an imported vendor on `/inbound` → no new vendor is created.

---

## 5. Out of scope, deliberately

- Old **vendor contacts** (`VendorContact`) — the Zoho detail read supplies the contact person.
- Old **vendor ledgers / bills / payments** — not asked for; they were deleted with the vendors.
- Updating vendors already here from Zoho (details are copied once — 2409 Q4).
- Creating vendors in Zoho from the app.
