# Link the app's vendors to their Zoho vendors — a Link step on /vendors, and bill approval that links by GSTIN

Status: completed — 14 Oct 2026, released: PR #86 merged into `main` at the owner's instruction and deployed to the VPS by hand. No migration. Left for the owner on production: `/vendors` ▸ Import from Zoho ▸ review ▸ **Link**, then **Retry** the five failing bills on Inwards; seeding the test database (§6).
Branch: **`feat/1410-vendor-zoho-link`** — off `origin/main` @ `d93da76`. Released the same way as the other 14 Oct features: PR into `main`, Deploy to VPS, then merged into `test`.

Every `file:line` below was read at `origin/main` @ `d93da76` on 14 Oct 2026. The production figures were read the same day, read-only.

---

## 0. Requirement

### 0.1 The owner's words, verbatim (14 Oct 2026)

> What is the solution for this issue? How can I manage the vendors respected? I think you can run a script from the Zoho to match the related vendors that are present in my system by write a script so that it can drag up the related primary case and attach it to my application.

The issue is the error shown when approving Zoho bills on Inwards. The owner pasted it the same day:

> bill 1593656000017246318: Vendor "NAREN INTERNATIONAL" already exists in the app but is not linked to Zoho (it was added by hand or from an inbound issue). Rename it on /vendors and approve this bill again. …

The same error appeared for GURU MAHIMA DISTRIBUTORS, HORNBACK E MOBILITY PRIVATE LIMITED and INKODOP TECHNOLOGIES PRIVATE LIMITED (two bills): five bills from four vendors.

The owner answered four questions the same day:

| Question | Answer, verbatim |
|---|---|
| How should the linking run? | "Button on /vendors (Recommended)" |
| How should a Zoho vendor be matched to an app vendor? | "GSTIN auto, name for review (Recommended)" |
| Should bill approval also link by GSTIN from now on? | "Yes (Recommended)" |
| What should be written to the app vendor? | "Only the Zoho id (Recommended)" |

"Primary case" is read as **primary key**: the Zoho vendor id, saved on the app's vendor.

### 0.2 Restated as requirements

| # | Requirement |
|---|---|
| R1 | Each existing app vendor can be linked to its Zoho vendor by saving the Zoho vendor id on it. No new vendor is created and nothing is renamed. |
| R2 | The linking runs from `/vendors` (the Import from Zoho sheet), on the server's Zoho connection. It is not a script, and it can be used again later. |
| R3 | The same GSTIN links automatically (pre-ticked). A match on the name only is listed and linked only when a person ticks it. Different GSTINs under the same name are shown and never linked. |
| R4 | At bill approval, a Zoho vendor that is not linked yet is linked to the existing app vendor with the same GSTIN, and the bill carries on. Anything ambiguous stops with a message that says what to do. It no longer says "rename", which would create a duplicate. |
| R5 | Only `zohoVendorId` is written. The app vendor's name, GSTIN, phone and the rest stay as they are; differences from Zoho are shown, not copied. |
| R6 | After release, today's five failing bills approve. |

---

## 1. Questions and clarifications — answer before build

The four answers in §0.1 settle the shape. Each question below has a **default** that the build follows unless the owner says otherwise.

| # | Question | Default |
|---|---|---|
| Q1 | Who may link? | **`vendors.fetch`**, the tick that already runs this sheet's preview and import (plan 1410-per-module-fetch-permissions). No new permission. |
| Q2 | **5 GSTINs are shared by 2–4 app vendors** in production (§2.3). Which one is linked? | The one whose name is also the same is linked automatically. Otherwise the row is listed for review with the candidates to choose from, and nothing is linked until someone picks one. |
| Q3 | Inactive app vendors (25 of the 79 with a GSTIN). | They are matched and linked like active ones, and the sheet marks them "inactive". A bill for one then attaches to it rather than failing. |
| Q4 | Two Zoho vendors match the same app vendor (duplicates in Zoho). | Neither is linked automatically; both are listed for review. `zohoVendorId` is unique, so one app vendor can hold one Zoho id. |
| Q5 | How GSTINs are compared. | Upper-case, with spaces removed. One production GSTIN is stored with different case or spacing. |
| Q6 | Activity log. | Each link is recorded under module `vendors`, action "linked to Zoho", naming the vendor and the match it was linked on. |

**A recorded decision this changes.** Plan `2409-zoho-vendor-id-on-bill-import`, R4 ("Stop creating vendors by name matching"), and plan `2409-zoho-vendor-sync`, Part A ("clash — shown, never imported"), assumed every vendor would come from Zoho. `resolve-zoho-vendor.ts:34` says "Vendors were wiped on 24 Sep 2026, so no vendor exists that predates the id". In production that is not so (§2.3).

This plan keeps the intent of R4: nothing is ever created or linked on a name alone without a person ticking it. It adds GSTIN as the key that finds an existing vendor.

### 1.1 Decisions on record (14 Oct 2026)

- The four answers in §0.1.
- Q1–Q6: the owner approved the plan with these defaults on 14 Oct 2026 ("Yes, build it").

---

## 2. How it works today — verified against the code

### 2.1 Bill approval

`resolveBillVendor` (`src/lib/vendors/resolve-zoho-vendor.ts:41-132`, called from `src/app/api/zoho/pull-review/approve/route.ts`):

1. It looks the vendor up by `zohoVendorId` (`:49`).
2. If that misses, it reads the Zoho contact (`:59`) and **creates** a vendor carrying the id (`:74`).
3. `Vendor.name` is unique. When the name is already taken by a vendor with no Zoho id, the create fails (P2002) and the bill stops with "…already exists in the app but is not linked to Zoho… Rename it on /vendors and approve this bill again" (`:107-115`).
4. Renaming does not help: the next approval creates a second vendor with the same GSTIN.

### 2.2 The Import from Zoho sheet

`/vendors` ▸ Import from Zoho is `src/app/(dashboard)/vendors/_components/zoho-vendor-sheet.tsx`, 374 lines.

- **`GET /api/vendors/zoho-preview`** (`vendors.fetch`) reads every Zoho vendor, with `gst_no`, through `listAllContacts`. It classifies each one:
  - `linked`: a vendor here already has this id.
  - `new`: there is no such id and no such name.
  - `clash`: the same name, case-insensitive (`route.ts:79-91`).
- **`POST /api/vendors/zoho-import`** creates `new` vendors only. A `clash` is shown and skipped.

**Nothing in the app writes `zohoVendorId` onto a vendor that already exists.** So a vendor that predates the Zoho link can never become linked.

### 2.3 Production, 14 Oct 2026

| Fact | Figure |
|---|---|
| Vendors | 83, created 14 Apr (82) and 13 Aug (1) |
| Linked to Zoho | **0** |
| With a GSTIN | 79, of which 25 are inactive |
| GSTINs shared by 2+ vendors | 5: `29DDZPS7231C1ZW` (RALSON7221, BHARAT0184, BHARAT2383, UNISTA0790), `29AMVPI3949R1ZQ` (NEWBHA7221, SACHIN8404, BHARAT4803), `33AADCT1398N1ZX` (TUBEIN1764, TICYCL0756), `29AADCI7400C1ZX` (INERIA6429, INERTI6429), `29BPZPS8022K1ZT` (SHRITA6227, SHRITE8427) |
| GSTIN not upper-case / with spaces | 1 |
| Today's four vendors | each has a GSTIN, 0 bills and 0 POs |

`Vendor.gstin` is neither unique nor indexed; `Vendor.zohoVendorId` is unique.

---

## 3. Implementation plan

### Part A — one matcher

**A1. `src/lib/vendors/zoho-match.ts`** (new):

- `normaliseGstin(s)`: upper-case, spaces removed, empty → null.
- `matchZohoVendors(zohoVendors, unlinkedVendors)` classifies each Zoho vendor against the app vendors that have no Zoho id yet:

| Kind | When | Linked |
|---|---|---|
| `gstin` | exactly one app vendor has the same GSTIN | automatically (pre-ticked) |
| `gstin+name` | several share the GSTIN and exactly one also has the same name | automatically (pre-ticked) |
| `ambiguous` | several share the GSTIN and the name does not decide; or two Zoho vendors claim the same app vendor (Q4) | only when a person picks one |
| `name` | no GSTIN match; the same name (case-insensitive, trimmed); at most one side has a GSTIN | only when a person ticks it |
| `conflict` | the same name, but both sides have a GSTIN and they differ | never |
| `none` | nothing | — (importable as a new vendor, as today) |

One function serves the sheet, the link route and bill approval, so the three cannot disagree.

### Part B — the Link step on `/vendors`

**B1. `GET /api/vendors/zoho-preview`** returns the A1 kinds in place of `clash`. Each row carries both sides: the Zoho name and GSTIN, and the app vendor's name, code, GSTIN and active flag, with differences flagged. `linked` and `new` are unchanged.

**B2. `POST /api/vendors/zoho-link`** (new, `vendors.fetch`), body `{ links: [{ zohoId, vendorId }] }`, at most 50:

- It reads Zoho's vendor list once and re-checks every pair on the server.
- A pair is linked only if all of these hold:
  - the app vendor still has no Zoho id
  - no vendor has this Zoho id
  - A1 still pairs them (`gstin`, `gstin+name`, a `name` match, or one of an `ambiguous` row's candidates)
- The write is `updateMany({ where: { id, zohoVendorId: null } })`, so a second tab or a bill approval cannot double-link. Each link is recorded in the activity log (Q6).
- It answers per pair, `linked` or `skipped` with the reason.

**B3. The sheet.**

- A **Link** section lists the matches: `gstin` rows pre-ticked; `name` and `ambiguous` rows unticked, with a candidate picker for ambiguous rows; `conflict` rows shown, not tickable.
- A **Link N** button sends the ticked pairs. Once they are linked, the preview reloads.
- Importing `new` vendors works as today.

### Part C — bill approval links by GSTIN (R4)

**C1. `resolveBillVendor`.** After the `zohoVendorId` lookup misses and the contact has been read, it runs A1 for this one vendor against the unlinked app vendors:

- `gstin` / `gstin+name`: link it (the same guarded `updateMany`) and continue with that vendor. Add the notice "Linked existing vendor <name> to Zoho by GSTIN", log it at info, and record it in the activity log.
- `ambiguous`, `name` or `conflict`: stop, with a message naming the vendors involved and saying "Link the right vendor on /vendors ▸ Import from Zoho, then approve this bill again."
- `none`: create the vendor as today.

**C2.** The name-clash message (`:112-115`) no longer says "Rename"; it points to the Link step.

**C3.** The comment at `:34` is corrected to say what is true in production.

### RBAC, schema, logging

- **No schema change and no migration.** No new permission: `vendors.fetch` exists.
- **Logging:** the new route and matcher log under `vendors:zoho-link`. They log ids and counts (`vendorId`, `zohoVendorId`, `kind`); names are not logged and no Zoho payload is.
- **Consulted before build:** accounting consultant (vendors, bills), integration architect (the Zoho reads), database architect (the guarded write, the GSTIN comparison), backend engineer (the route, the 400s, re-checking on the server), frontend engineer (the sheet at 375 px).

---

## 4. Verification

1. `npm run build` passes; `tsc` is clean; `eslint` shows 0 errors on the changed files.
2. **The matcher on production-shaped cases** (a script over fixtures):
   - one shared GSTIN group decided by name
   - the 4-vendor group with no name match → `ambiguous`
   - a name-only match
   - a GSTIN conflict
   - one app vendor claimed by two Zoho vendors
   - GSTIN case and spaces
3. **The branch run locally against the TEST database.** Since 12 Oct it holds live Zoho credentials, but **Zoho is only read**: the preview reads the vendor list and the bill fetch reads bills. Links are written to the test database only; nothing is written to Zoho and production is not touched.
   - Open the preview: the four vendors from §0.1 come back as `gstin` matches.
   - Link them, and check the activity rows.
   - Fetch the bills for a window that holds one of today's five, and approve it. It attaches to the existing vendor, with no new vendor.
   - The shared-GSTIN groups: a row whose Zoho name matches one of the group is pre-ticked (`gstin+name`). A row whose name matches none of them is listed for review and nothing is linked automatically (`ambiguous`).
4. **After the release, on production:** `/vendors` ▸ Import from Zoho ▸ review ▸ **Link**, then Retry the five bills on Inwards.

---

## 6. Build record — 14 Oct 2026

Built on `feat/1410-vendor-zoho-link`, from `origin/main` @ `d93da76`.

**Built.**

- **A1:** `src/lib/vendors/zoho-match.ts`, a pure matcher (`matchOne`, `matchAll`, `pairAllowed`).
- **The write:** `src/lib/vendors/zoho-link.ts`, `linkVendorToZoho`. A guarded `updateMany` on `zohoVendorId: null` maps a unique violation to `id-taken` and writes the activity row.
- **B1:** the preview's statuses `linked` / `match` / `review` / `conflict` / `new`, with the candidates and the conflict reason.
- **B2:** `POST /api/vendors/zoho-link`.
- **B3:** the sheet's "Link to vendors already here" section and the **Link N** button.
- **C1–C3:** in `resolve-zoho-vendor.ts`. The approve route passes the approver.

**Changed after the independent review (CLAUDE.md and the accounting, integration, database, backend and frontend docs).** Each was a real gap in the first build:

| Finding | Was | Now |
|---|---|---|
| The matcher saw only unlinked vendors | A GSTIN already on a linked vendor was invisible. A second Zoho record for the same business showed as **new** and was created again at bill approval, splitting payables. In a 2-vendor shared-GSTIN group, once one was linked the other was linked by elimination, without the name or a person deciding. | The matcher gets **every** vendor. A GSTIN or name held by a vendor linked to another Zoho id is a `conflict` ("linked-elsewhere"): never new, never created at approval. A shared-GSTIN group is decided by the name or by a person, over its unlinked members only. |
| Contact read fails at approval | A vendor was created from the bill's name, taking the Zoho id and blocking the real vendor from ever being linked. | For a Books bill the approval **stops with a retryable message**. A Zakya bill keeps plan 2409's behaviour. |
| The Import route did not match | A sheet left open from before the release could import a vendor that is already here. | The import runs `matchOne` against every vendor after the contact read and skips anything that is not `none`. Vendors created in the batch join the list. |
| Zakya bills | C1 would link a vendor to a Zakya contact id. | C1 runs for Books bills only (`vendorSource !== "pos"`). |
| Silent risk on a GSTIN-only link | The approval notice did not say when the names differ or the vendor is inactive. | The notice names both. The sheet shows the vendor here on its own line, with an "inactive" badge. |
| Link route vs preview | The route matched all Zoho vendors, the preview only the unlinked ones, so they could disagree. | Both match the same set. |
| Smaller points | — | The request-body catch logs. The sheet compares names with the server's folding. The single-candidate label is right. The footer buttons do not wrap. |

**Known and left:**
- The sheet file is about 640 lines against the frontend doc's 300-line guide. It was not split here.
- If Zoho holds two vendors for one GSTIN and the business really is two vendors here, the second needs a person: it shows as a conflict, and its bills stop with a message to merge them in Zoho.

**One more rule, from the end-to-end run.** On the test data, Zoho's SOLID INDUSTRIES shares GSTIN `29AMVPI3949R1ZQ` with three vendors here, and each of the three has its own same-name Zoho vendor (`gstin+name`, pre-ticked). Its ambiguous row offered all three, so a person could take one away from its real Zoho vendor. `matchAll` now leaves out of an ambiguous row's choices any vendor that another row matches automatically by GSTIN. With nothing left to offer, the row is a conflict, "matched-elsewhere".

**Checks run.**

| Check | Result |
|---|---|
| `npx tsc --noEmit`, `eslint` on the 8 changed files | clean |
| `npm run build` (local database) | exit 0; `ƒ /api/vendors/zoho-link` listed |
| Matcher tests (fixtures) | **43/43 pass**: every A1 kind; GSTIN case and spaces; shared groups; Zoho duplicates (Q4); a linked vendor's GSTIN or name gives a conflict, never new; a 2-vendor group with one linked is decided by name or by a person; folded duplicate names. The SOLID case passes too. |
| Production-shaped run (the local copy's 83 vendors, each with a simulated Zoho twin) | 66 `gstin`, 13 `gstin+name`, 4 `name` (no GSTIN). Every one paired to itself, never to another. Today's four vendors come out `gstin`. With those four linked and a duplicate HORNBACK in Zoho, the duplicate is a conflict ("linked-elsewhere"). |
| End-to-end: the branch on the **test** database, Zoho read-only | **All pass.**<br>• The preview over 100 real Zoho vendors: 78 match, 7 review, 15 new, 0 conflicts.<br>• Today's four come out `match` / `gstin` to the right vendors. Linking them changed only their `zohoVendorId` (and `updatedAt`) and wrote 4 activity rows. Linking them again links nothing.<br>• Every refusal names its reason: a non-candidate, a vendor already linked, an unknown id, 51 links, no body.<br>• **One real bill approved** (262700646, AOKI MOBILITY, unlinked): the notice was "Linked existing vendor … to Zoho by GSTIN", no vendor was created, and only its Zoho id changed.<br>• Zoho calls were reads only: contact lists and gets, one bill list and get, token refreshes. |

**Left in the test database by the run:** 5 vendors linked (NARENI7221, GURUMA6429, HORNBA6429, INKODO6429, AOKIMO9182), their activity rows, and bill 262700646 approved as a pending VendorBill. The temporary user, role and permission rows were deleted.

**Found on test, not caused by this change:** the test database has **no `vendors.fetch`, `bills.fetch` or `inbound.fetch` rows**, because `npm run db:seed:rbac` has not been run there since plan 1410-per-module-fetch-permissions. Every fetch route on the test site answers 403 to everyone until it is seeded.

## 5. Out of scope, deliberately

- **Copying Zoho's details into existing vendors** (R5). Differences are shown only.
- **Merging the app's own duplicate-GSTIN vendors** (the 5 groups in §2.3). The Link step will show them for review; whether, say, RALSON and UNISTA are really one business is the owner's call.
- **Zakya (POS) vendors.** The sheet reads Zoho Books, as today. At bill approval, C1 runs for **Books** bills only (§6): a Zakya bill carries Zakya's contact id, and linking a vendor to it would block that vendor's Books id for good.
- **A one-off script.** The owner chose the button (§0.1).

## 7. Released — 14 Oct 2026

- The owner, 14 Oct 2026: *"Okay, I need you to update the related operations to the main production branch. After you do it, let me know. create a PR means related updations create a PR and merge it to the main branch and after the updation let me know"*.
- Before the release the owner tried the branch locally on `:3100` against the test database.
- PR #86 was merged into `main` once its Type check and Build passed, then Deploy to VPS ran from `main`. There is no migration, so the migrate job finds nothing to apply.
- `vendors.fetch` already exists in production's catalog (seeded for plan 1410-per-module-fetch-permissions), and ADMIN holds it. No seed is needed.
- **Still the owner's, on production:**
  1. `/vendors` ▸ **Import from Zoho**: check the ticked GSTIN matches and the review rows, then tap **Link**.
  2. On Inwards, **Retry** the five bills: NAREN INTERNATIONAL, GURU MAHIMA DISTRIBUTORS, HORNBACK E MOBILITY PRIVATE LIMITED, and INKODOP TECHNOLOGIES PRIVATE LIMITED ×2.
