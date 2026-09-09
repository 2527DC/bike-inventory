# The ledger app's vendor screens, exactly as they are, behind a Ledger button on the vendor page — with a one-time JSON import, S3 uploads and AI extraction

Status: pending — 9 Sep 2026, every question in §1 answered by the owner the same day; **not started** until the owner says "implement" and names the base branch (Q9).
Branch: **to be named by the owner** before anything is checked out (see Q9). The working tree
on `feat/0909-stock-po-expense` carries **uncommitted** PO-sheet work in `prisma/schema.prisma`,
`src/lib/ai/*`, `src/lib/validations.ts` and `src/lib/po-extraction/*`; this plan touches the
first three, so it cannot start until that work is committed.

Everything in §2 and §3 was read from the code on disk on **9 Sep 2026**: the ledger app at
`F:\bharath  Cycle\ledgers\app`, and this repository. Nothing is carried over from
`ledger-merge-plan.md`; where the two disagree, this plan wins and says so.

---

## 0. Requirement

### 0.1 The owner's words, verbatim (9 Sep 2026)

First message:

> I.  Get to know the legdger flow       implmenattion plan : where i need the the ui of the
> legder app where in the vendor listing and whren i selct the  one vendore i see the details
> and i need the button  as ledgere wheee in clicking it i must  get the screen taht the
> legeger aplication has respected to the vendor        --> need to know how are all the data
> stored and shown in the ledger aplication        -->  and i should rnd regarding should i add
> any  table  if what type should i use the json  body data  which will be stored in s3  or
> which type i can use in the aplication of bch managemnt        ---> the screen ans  the
> actions remains the ui must remain same the legedger application    the leger aplication
> that i was saying is & 'f:\bharath  Cycle\ledgers'   --> i need the& 'f:\bharath
> Cycle\BCH-Management'  where in the  vendor details screen i need a button whch must take
> to the screen  that this & 'f:\bharath  Cycle\ledgers' takes to the respected details screen
> i need the exact screen that the leger aplication has for the respected vendore in  its
> aplication   completed all the respced screen not even i need to miss on i donly dont waht
> the listing of the vendore  taht is used in the ledger aplication  tell me this how can i
> implment this reuiremnet  and i have quetition from my bch managemnt aplication i want to use
> the ai api key  because thet legere aplication was  used locally and pushed to git and the
> aplication reflected but in cbch mangemnt aplication i want to upload teh file from the ui
> and perfrom operation where after uploading let the user must be able to give the prm for
> teh uploaded files and perfrom ai work  and my question is how can we store the data shoukd
> we use the databse or how if databse in what way are we storing the details because teh
> leger aplication is not using the databse

Answers to the eight questions (voice-transcribed, verbatim):

> For the first question replace or add use the recommended one like to replace all the end of
> I need to remove the/lecture side bar and with respect to that screen. No for the second
> question is the UI must remain the same. It has to match hundred to 400 400% detailed
> lecture, UI and related to deleting role the apps you delete and entry with okay boss, the
> ship refuse to delete a imported draw as of now make it has safeguard like ignoring these
> things and with respect permission of a fourth question, I would recommend like giving the
> respected module permission for only the admin for not for any other roles where it can't
> be assignable for any other roles. One time, migration and offer the fifth question I prefer
> like I will select the respected vendor and I will let me have an import button in the UI
> with respect to vendor in the screen of details. It should only take the Jason file when it
> when I give it and with respect to that window, where I input the data from Jason, it has
> to be avoided to the database, which is one time done till the set up of the application.
> After that we can remove that and the source of truth of micro is like I'll be uploading the
> files to you like I'll be uploading the Jason file manually from the UI so that the source
> of truth can be anything like blog. No, I don't want it to be as blob or export from the
> device. I think we can make a Jason export from my device for the first release and I need
> a scope to be implemented everything everywhere where it is needed in within the first face
> itself, and I need to use the S3 as the storage where we can store the uploaded files, and I
> need an option of Collection deleting the files from the itself after the any extraction or
> the complete process Completed at any time after the upload

### 0.2 Restated as requirements

| # | Requirement |
|---|---|
| **R1** | Document how the ledger app stores and shows its data (done — §2.1). |
| **R2** | On the vendor detail screen (`/vendors/[id]`) add a **Ledger** button. Clicking it opens the screen the ledger app shows for that vendor. |
| **R3** | That screen reproduces the ledger app's per-vendor screen **completely**: every tab (Ledger, Monthly, Table, Gaps, Share), every action, the same UI. Nothing left out. |
| **R4** | The ledger app's own brand **listing is not wanted**. The BCH-side `/ledger` list page and its sidebar entry are removed; the vendor page is the only way in. |
| **R5** | Decide the storage: which tables to add, whether any JSON body belongs in S3, which column types. Answered in §1 (Q3 of the first round) and built in §3 Part A: rows in Postgres, files in S3, raw AI output in a Json column. |
| **R6** | Deleting: a hand-added entry deletes after a confirm, as in the app. An **imported** row is never deleted; the × marks it ignored instead. |
| **R7** | The two ledger permission modules are **admin-only**: they cannot be assigned to any role other than the system role. |
| **R8** | A **one-time JSON import** on the vendor's ledger screen: the owner picks the vendor, uploads the ledger app's JSON export, chooses which brand in it is this vendor, and the data is written to the database. It exists until setup is done and can be removed afterwards. |
| **R9** | The source of truth for that import is a JSON export taken from the owner's device (Data → Export JSON in the ledger app), not the Vercel Blob. |
| **R10** | AI: upload files from the UI, optionally give a prompt, run AI over them, review, and commit. Both jobs ship in **this** phase: statement import (PDF, XLSX, CSV → ledger rows) and prompt-driven extraction over chat exports and screenshots (→ draft claims). |
| **R11** | Uploaded files are stored in **S3**. |
| **R12** | Any uploaded file can be **deleted from S3** from the UI at any time after upload, including after extraction has finished. |

---

## 1. Questions and clarifications — answer before build

### 1.1 Decisions on record (owner, 9 Sep 2026)

| # | Question | Answer | Consequence |
|---|---|---|---|
| D1 | Replace the shipped `/ledger/[id]` or add beside it? | **Replace.** Remove the `/ledger` list page and its sidebar entry. | `brand_ledger.route` becomes `null` (the `bills` precedent, `prisma/rbac-catalog.ts:369-394`); `ledger/page.tsx` and `GET /api/ledger/vendors` are deleted; `/ledger/[id]` keeps its URL and is reached only from the vendor button. |
| D2 | How exact is "same UI"? | **100 %.** | `styles.css` is ported as a scoped stylesheet; the JSX structure, labels, chips, tab order and copy are kept verbatim (§3 Part C). |
| D3 | Delete rules | Keep the safeguard. Imported rows → ignored; hand-added rows → deleted after confirm. | The × on a row calls the review endpoint with `IGNORED` when `source ≠ MANUAL`, and the delete endpoint otherwise (§3 Part B.6). |
| D4 | Permissions | Admin-only; not assignable to any other role. | `Module.assignable` column, enforced at the two role-write routes by `role.isSystem`, never by role name (§3 Part A.3). |
| D5 | Migration of existing data | A one-time **Import JSON** button on the vendor's ledger screen; JSON only; removable afterwards. | §3 Part D. |
| D6 | Source of truth for it | A JSON export from the device. | The import reads the ledger app's export shape (`store.js:47-55`, same document as `loadState`). |
| D7 | AI scope | Everything in phase one. | §3 Part E builds statement import **and** the prompt flow. |
| D8 | Storage | S3, with delete-from-S3 at any time. | §3 Part E.1 and E.5. |

### 1.2 Answered one by one, 9 Sep 2026 — the Answer column is the decision

| # | Question | Why it changes the build | Options | Recommended default | Answer |
|---|---|---|---|---|---|
| **Q1** | **Stored files are world-readable today.** `S3Provider.publicUrl` (`src/lib/storage/s3.ts:51-53`) is the URL saved in the database and nothing signs a GET; `src/lib/po-extraction/store.ts:226-228` states objects are "world-readable by design". A supplier statement or a WhatsApp export is not a product photo. | Gating reads means a new `read(key)` on `StorageProvider` and an authenticated proxy route; not gating means anyone with the URL opens the file. | (a) gate every ledger file behind `GET /api/ledger/files/[id]` (`requireFeature("brand_ledger","view")`, streams from S3, URL never leaves the server); (b) accept public URLs. | **(a).** The key is only as secret as `Date.now()` + six random characters (`upload-policy.ts:95-99`). | **Public URLs.** Owner, 9 Sep 2026: "dont worry store it  we will delete after some time". No gated route; B.9 dropped; the stored S3 URL is used directly, and the R12 delete is the control. |
| **Q2** | WhatsApp exports arrive as `.zip` (the `chat/` folders and the root zips). No zip library is a direct dependency; `fflate@0.8.2` is on disk only transitively via `xlsx` and `jspdf`. | A new dependency, or `.zip` refused at upload. | (a) add `fflate` as a direct dependency and read `_chat.txt` out of the zip on the server; (b) accept `.txt` only and ask the owner to unzip. | **(a).** | **(a)** — add `fflate`, accept `.zip`. |
| **Q3** | The JSON export carries **no image bytes**. The five evidence files (`app/public/evidence/cultsport/*`) are referenced by name in `evidence.gen.js`, not in the export. | Whether the import creates evidence rows. | (a) the import creates no evidence rows; the five files are attached by hand on gaps CULT-2, CULT-3, CULT-4, CULT-6, CULT-13 through the new evidence upload; (b) extend the import to accept a zip of evidence. | **(a).** Five files, once. | **(a)** — attached by hand after import. |
| **Q4** | Brand → vendor. Seven of the eight brands match a vendor on local `bch` (aoki → AOKI MOBILITY, cultsport → CULTSPORT PVT LTD, hornback → HORNBACK E MOBILITY, lucifer → LUCIFER BIKES, raleigh → NAREN INTERNATIONAL, trinity → TRINITY CYCLES, emotorad → INKODOP TECHNOLOGIES). **Tata Stryder has no vendor row.** CULTGEAR PVT LTD also exists beside CULTSPORT. | The import needs a target vendor per brand; the picker in §3 Part D makes the owner choose, so the code never guesses. | Create the Tata Stryder vendor at `/vendors/new` before importing; confirm CULTSPORT (not CULTGEAR) and Inkodop for EMotorad. | As stated. | **Confirmed** as stated; the owner creates the Tata Stryder vendor before its import. |
| **Q5** | EMotorad has two folios in the app (Centre 121, Hub 666) but one ledger thread and one vendor. | Nothing in the schema; noted so the import is not expected to split them. | Import as one vendor. | Import as one. | **One vendor** (Inkodop). |
| **Q6** | Chat extraction is not one call. A 9,343-message export is far beyond a single prompt, and `runAi` has **no attachment or prompt size cap** (`src/lib/ai/index.ts:201` only logs the size). | Chunk size and model effort decide cost and quality. | Chunk by message count with a running summary; `effort: "high"`; the active provider's default model. | Chunks of ~1,500 messages, each producing candidate claims with the quoted message and line number; results are **proposals**, never rows, until accepted. | **Chunks of ~1,500 messages.** |
| **Q7** | The ledger screen's opening balance. The app uses `brand.ledger.opening.amount` (`store.js:123`); the shipped API uses `vendor.openingBalance` (`api/ledger/vendors/[id]/route.ts:89-90`), which is BCH's own book figure as of 1 Apr 2026. EMotorad's ledger opens at ₹64,78,990 on 1 Apr 2025. | Which number seeds the running balance. | A new `ledgerOpeningAmount`/`ledgerOpeningDate` on the profile table; `Vendor.openingBalance` untouched. | The profile fields. | **Profile fields.** |
| **Q8** | Gap IDs like `CULT-3` come from a hardcoded map (`App.jsx:16`). | Display only. | `VendorLedgerProfile.code` (4 letters), defaulting to the first four letters of `Vendor.code` on import. | The profile column. | **Profile column**, set from the app's map on import (CULT, LUCI, EMOT, AOKI, RALE, HORN, TRIN, TATA). |
| **Q9** | **Which branch is this built on?** The uncommitted PO-sheet work must be committed first. | Base and ordering. | The owner names the base (memory rule: ask before each new branch). | — | **The owner names it when saying "implement"** — "i will tell u when i mention and tell implemt". Nothing is checked out before that. |

---

## 2. How it works today — verified against the code

### 2.1 The ledger app (`F:\bharath  Cycle\ledgers\app`)

**One JSON document, no database.** `store.js:3` names the localStorage key `bch-ledgers-v1`;
`saveState` (`store.js:36-40`) rewrites the whole document `{ ...state, version, savedAt }` on
every edit. `sync.js:69-72` pushes it two seconds after any change to `PUT /api/state`;
`api/state.js:26-37` writes it to Vercel Blob as `bch/state-<timestamp>.json` and keeps the five
newest. `initialSync` (`sync.js:75-89`) pulls on launch and the newer `savedAt` wins, so two
editors overwrite each other silently. Access is a shared PIN in the `x-sync-key` header
(`api/state.js:7-10`); the lock screen (`App.jsx:88-124`) is client-side only.

**"Push to git and the app reflects."** The starting data is compiled into the bundle:
`src/seed.js` (428 lines, brand cards and gaps hand-transcribed from `brands/<brand>/gaps.md`)
imports `src/entries.gen.js` (215 KB), which `scripts/extract-entries.mjs` generates from the
CSV/XLSX statements in the repo and `bank-statements/normalized.json`. A push rebuilds on Vercel;
`store.migrate` (`store.js:6-21`) merges the new seed entries with manual (`man-*`) entries on
each device when `SEED_VERSION` bumps.

**The document shape** (dumped from the seed on 9 Sep 2026: 8 brands, 219 gaps, 1,498 entries,
329,772 bytes):

| Level | Fields | Read at |
|---|---|---|
| brand | `id, name, sub, updated, lastReviewed, position, notes, theirBal{amount,label}, ourBal{amount,label}, recov{amount,text}, deadline{label,date}, ledger{opening{date,amount}, coverage, matchable, note}` | `App.jsx:227-263, 537-564, 590, 910, 1015` |
| entry | `id, date, type, ref, amount, dir, side, note, audit{s,t,g}` — `type` ∈ payment, invoice, credit-note, debit-note, discount, adjustment, **note**; `audit.s` ∈ ok, short, missing, kids, era20, info; `audit.g` = gap number | `App.jsx:508-529, 600-634`, `store.js:106-130` |
| gap | `n, title, type, amt, amtText, status, tier, evidence, action, result, progress[{date,text}]` — `status` ∈ open, promised, verify, resolved, rejected; `tier` ∈ firm, conditional, leverage, verify | `App.jsx:346-381, 1013-1019` |
| evidence | `evidence.gen.js` — `{brandId: {gapN: [{file, doc?, date, source, note}]}}`, files under `public/evidence/<brand>/` | `App.jsx:764-786` |

**The per-vendor screen** is `BrandPage` (`App.jsx:223-282`) with five tabs. The complete
component inventory, every field each reads, and every field each writes, is in §3 Part C.

### 2.2 What this repository already has (commit `e3d1e60`, on every branch)

`ledger-merge-plan.md` chose "port the method, not the app" and built a **different** UI. On
disk today:

| Piece | Where | State |
|---|---|---|
| 7 models | `prisma/schema.prisma:2622-2848` — `BrandLedgerEntry`, `BrandStatement`, `LedgerGap`, `LedgerGapEvidence`, `LedgerGapNote`, `VendorDiscountTerm`, `BrandVendor` | shipped; **0 rows** in every one on local `bch` |
| enums | `LedgerEntryType:2530` (OPENING, INVOICE, PAYMENT, CREDIT_NOTE, DEBIT_NOTE, DISCOUNT, ADJUSTMENT — **no NOTE**), `GapType:2569` (12 values, all 10 of the app's present), `GapTier:2589`, `GapStatus:2596` (OPEN, PROMISED, VERIFY, RESOLVED, REJECTED), `EvidenceKind:2604`, `LedgerEntrySource:2561` | shipped |
| RBAC | `prisma/rbac-catalog.ts:460-469` `brand_ledger` (route `/ledger`), `:470-480` `brand_ledger_gaps` (route `null`, has `approve`) | seeded |
| engine | `src/lib/brand-ledger/reconcile.ts` — `parseLedgerDate:24`, `classifyEntry:64`, `directionForType:81`, `runningBalance:104`, `checkBalance:122`, `matchEntries:183`, `unclaimedBooks:245`, `assessCoverage:269`, `expectedDiscount:330` | pure, reusable |
| API | `api/ledger/vendors/route.ts` (list), `vendors/[id]/route.ts` (detail, read-only, `:22-140`), `vendors/[id]/entries/route.ts` (POST `:15`, DELETE `:53`), `entries/[id]/review/route.ts` (PUT `:16`), `vendors/[id]/gaps/route.ts` (GET `:10`, POST `:48`), `gaps/[id]/route.ts` (PUT `:16` with the `approve` check at `:31`, DELETE `:69`) | shipped; no `createLogger`, every `catch` silent |
| screens | `(dashboard)/ledger/page.tsx` (179 lines), `ledger/[id]/page.tsx` (440 lines, tabs Ledger · Claims · Terms, `:13`), `ledger/[id]/gaps/new/page.tsx` (231 lines) | shipped; raw `fetch().then(r => r.json())` at `page.tsx:50`, `[id]/page.tsx:94,107`, `gaps/new/page.tsx:56` |
| not built | statement import, evidence upload, claim notes writer, discount-term writer, the 219-gap migration | `docs/brand-ledger-flow.md` §5 |

The vendor detail page `src/app/(dashboard)/vendors/[id]/page.tsx` has six tabs
(`:148-155`, bar at `:296-309`) and no link to `/ledger/[id]`. Its own "Ledger" tab
(`:684-735`, fed by `GET /api/vendors/[id]/ledger`) is BCH's own bills-and-payments running
balance and stays as it is. The action-button row is `:202-218` (Call, WhatsApp).

### 2.3 Field-by-field: the app's document against the shipped tables

| App field | Shipped home | Gap |
|---|---|---|
| entry `date, type, ref, amount, dir, side, note` | `BrandLedgerEntry.entryDate, type, ref, amount, direction, side, note` | `type: note` (dir 0) has no enum value |
| entry `audit.s / audit.t / audit.g` | `auditStatus, auditNote, gapId` | `g` is a number; resolve to the gap's id by `(vendorId, number)` |
| entry `id` (`lu-0001`, `man-…`) | none | not needed; the import refuses a vendor that already has rows |
| gap `n, title, type, amt, amtText, status, tier, evidence, action, result` | `LedgerGap.number, title, gapType, amount, amountNote, status, tier, evidenceText, action, result` | none |
| gap `progress[{date,text}]` | `LedgerGapNote.body, createdAt` | `createdAt` must be set explicitly on import |
| evidence `{file, doc, date, source, note}` | `LedgerGapEvidence.url, kind, capturedOn, source, note` | `date` is free text ("2024-08 orders"); `capturedOn` is a DateTime |
| brand `sub, updated, lastReviewed, position, notes, theirBal, ourBal, recov, deadline, ledger{opening, coverage, matchable, note}` | **none** | a new 1:1 table |
| brand `id` → `CULT` code | `BRAND_CODE` map in code | a profile column |

### 2.4 Storage and AI, as they are on disk

- **Storage** is a provider resolved from the `StorageConfig` row — S3 via aws4fetch or the
  local filesystem — behind `src/lib/storage/index.ts` (`getStorage:94`, `tryGetStorage:126`).
  Contract `types.ts:27-57`: `put`, `delete`, `exists`, `publicUrl`, `keyFromUrl`, `presignPut`.
  **No `read` and no signed GET**; see Q1. Browser uploads are bound by
  `upload-policy.ts` (`ALLOWED_PREFIXES:10-22`, PDF only under `transfers/`, `:56-58`); a
  server-side `storage.put` bypasses it, which is how `purchase-orders/quotations/` works
  (`po-extraction/store.ts:193-216`). Delete pattern: `keyFromUrl` then `storage.delete`,
  warn-only (`store.ts:275-299`).
- **AI** is one entry point, `runAi` (`src/lib/ai/index.ts:171`), reading the active
  `AiProvider` row (`schema.prisma:1192-1210`; one row on local `bch`). `AiRequest`
  (`types.ts:21-53`) takes `prompt`, `system`, `attachments` (kind `pdf` | `image` only — **no
  text attachment**, `types.ts:12-19`), `maxTokens`, `json`, and — **uncommitted on disk** —
  `jsonSchema` and `effort` (`types.ts:39-52`, `index.ts:203-204, 233`). Retries `index.ts:41-42`;
  `max_tokens` and `refusal` throw (`:221-230`). Errors map to HTTP in `http.ts:9-36`.
- **The pattern to copy** is the untracked `src/lib/po-extraction/prompts.ts`: fixed system
  prompts, a JSON schema with `additionalProperties: false` and every key in `required`
  (`:74-79`), the user's free text sanitised (`sanitizeHint:28-46`, 200 chars, refuses
  "ignore/system/prompt/instruction") and inserted **as data inside a tag**, never as an
  instruction (`:144`).
- **Do not copy** `api/bank-statements/route.ts:109` — `text.slice(0, 50000)` silently drops
  the tail of a statement (audit finding F1, still open).
- `xlsx@0.18.5` is a direct dependency; CSV goes through it (`excel-parser.ts:90`). No zip
  library (Q2).

---

## 3. Implementation plan

Six parts, one commit each, in this order: **A** schema and RBAC → **B** API → **C** UI port →
**D** JSON import → **E** uploads and AI → **F** removal and docs. A–B are prerequisites for
everything; C, D and E are independent of each other once B exists and can be built by three
agents in parallel.

### Part A — schema and RBAC

**A.1 One additive migration**, folder `prisma/migrations/2026MMDDhhmmss_vendor_ledger_profile_uploads/`
(sorting after `20260909145100_po_sheet_extraction_and_line_name`), written by
`npx prisma migrate dev --name vendor_ledger_profile_uploads` against **localhost only**. The
owner applies it elsewhere by hand.

```prisma
// The brand-level header of the ledger app's document, one row per vendor. Typed columns,
// not Json: the header card, the "review due" chip and the Table tab's gap anchor all read
// individual fields.
model VendorLedgerProfile {
  vendorId   String   @id
  vendor     Vendor   @relation(fields: [vendorId], references: [id], onDelete: Cascade)
  code       String   // "CULT" — the prefix of CULT-3 (Q8)
  sub        String?  // "Aoki Mobility Pvt Ltd · POC Prashant"
  position   String?  @db.Text
  notes      String?  @db.Text
  theirBalAmount Float?
  theirBalLabel  String?
  ourBalAmount   Float?
  ourBalLabel    String?
  recovAmount    Float?
  recovText      String?  @db.Text
  deadlineLabel  String?
  deadlineDate   DateTime?
  ledgerOpeningAmount Float?     // Q7 — NOT Vendor.openingBalance
  ledgerOpeningDate   DateTime?
  ledgerCoverage String?
  ledgerMatchable Boolean @default(false)
  ledgerNote     String?  @db.Text
  updatedOn      DateTime? // the app's `updated`
  lastReviewed   DateTime?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  @@map("vendor_ledger_profiles")
}

// A file uploaded on the ledger screen. The row outlives the object: deleting the file (R12)
// nulls fileUrl and stamps deletedAt, so the AI run that read it keeps its provenance.
model LedgerUpload {
  id           String   @id @default(cuid())
  vendorId     String
  vendor       Vendor   @relation(fields: [vendorId], references: [id], onDelete: Cascade)
  kind         LedgerUploadKind
  fileName     String
  contentType  String
  sizeBytes    Int
  fileUrl      String?
  deletedAt    DateTime?
  uploadedById String
  uploadedBy   User     @relation("LedgerUploadedBy", fields: [uploadedById], references: [id])
  createdAt    DateTime @default(now())
  runs         LedgerAiRun[]
  @@index([vendorId, createdAt])
  @@map("ledger_uploads")
}

enum LedgerUploadKind { STATEMENT CHAT SCREENSHOT DOCUMENT JSON_EXPORT }

// One AI call over one upload. `reply` is the raw model output and `proposals` the validated
// candidate rows — Json on purpose: provenance nobody queries. Rows land in the real tables
// only when a person accepts them (acceptedAt).
model LedgerAiRun {
  id          String   @id @default(cuid())
  uploadId    String
  upload      LedgerUpload @relation(fields: [uploadId], references: [id], onDelete: Cascade)
  vendorId    String
  task        LedgerAiTask
  userPrompt  String?  @db.Text   // sanitised, ≤ 500 chars
  provider    String
  model       String
  usageIn     Int?
  usageOut    Int?
  latencyMs   Int?
  reply       Json?
  proposals   Json?
  status      LedgerAiRunStatus @default(RUNNING)
  error       String?  @db.Text
  acceptedAt  DateTime?
  statementId String?  // set when a STATEMENT run is accepted
  createdById String
  createdBy   User     @relation("LedgerAiRunCreatedBy", fields: [createdById], references: [id])
  createdAt   DateTime @default(now())
  @@index([vendorId, createdAt])
  @@map("ledger_ai_runs")
}

enum LedgerAiTask { STATEMENT_ROWS CLAIMS_FROM_CHAT CLAIMS_FROM_IMAGE }
enum LedgerAiRunStatus { RUNNING DONE FAILED ACCEPTED DISCARDED }
```

Plus, on existing models: `LedgerEntryType` gains `NOTE`; `LedgerGapEvidence` gains
`capturedLabel String?` (the app's free-text date); `Module` gains
`assignable Boolean @default(true)` (A.3); `Vendor` gains the three back-relations. Money
stays `Float` — the house convention (`docs/agents/database-architect.md` is consulted at
build time on this exact point; the schema already uses Float for every ledger amount).

Read the SQL before committing: every statement must be `ADD COLUMN`, `ADD VALUE` or
`CREATE TABLE`. Nothing drops.

**A.2 Catalog and seed.** `prisma/rbac-catalog.ts:465` `route: "/ledger"` → `route: null`
with a comment in the `bills` style; both ledger entries gain `assignable: false`.
`ModuleSeed` (`:25-47`) gains `assignable?: boolean`; `prisma/seed-rbac.ts:76-94` writes it in
both the update and the create. After deploy the owner runs `npm run db:seed:rbac`.

**A.3 Admin-only enforcement, as data.** In `src/app/api/roles/[id]/route.ts` between `:68`
and `:70`, and in `src/app/api/roles/route.ts` between `:44` and `:46`:

```ts
if (!role.isSystem) {
  const reserved = await prisma.permission.count({
    where: { id: { in: permissionIds }, module: { assignable: false } },
  });
  if (reserved > 0) return errorResponse("These permissions are reserved for the system role", 400);
}
```

`role.isSystem` is a column (`schema.prisma:87`); no role name is compared, so CLAUDE.md rules
1 and 2 hold. ADMIN keeps everything through `seed-rbac.ts:186-205`. `GET /api/modules`
(`route.ts:17-35`) returns `assignable`; `team/permissions/page.tsx` disables the module's
"Select all" (`:326`) and each action button (`:339`) when `!mod.assignable`, and shows an
"Admin only" badge beside the label (`:314`).

### Part B — API

Every route: `requireFeature`, zod, `successResponse`, a `createLogger("ledger:<area>")`
scope, `failure()` in every `catch`. The shipped routes are brought up to that bar in the same
commit (they have no logger today).

| # | Route | Guard | Does |
|---|---|---|---|
| B.1 | `GET /api/ledger/vendors/[id]` | `brand_ledger.view` | Extended to return the **view shape** the screen needs (§C.2): profile, entries (with `gapNumber` resolved), gaps with notes and evidence, plus everything it returns today. Opening balance now comes from `profile.ledgerOpeningAmount` (Q7). |
| B.2 | `PUT /api/ledger/vendors/[id]/profile` | `brand_ledger.edit` | Balances editor (`theirBal*`, `ourBal*`) and the Reviewed button (`lastReviewed`). One schema, partial. |
| B.3 | `POST /api/ledger/vendors/[id]/gaps` | `brand_ledger_gaps.create` | Exists; now also creates the `Added` note, and accepts `amountNote`/`evidenceText`/`action` exactly as the form sends them. |
| B.4 | `PUT /api/ledger/gaps/[id]` | `brand_ledger_gaps.edit`, `approve` for RESOLVED/REJECTED (`gaps/[id]/route.ts:31`, kept) | Exists; when the status becomes RESOLVED, appends the `Marked resolved` note in the same transaction. |
| B.5 | `POST /api/ledger/gaps/[id]/notes` | `brand_ledger_gaps.edit` | New — the progress note. `LedgerGapNote` has had no writer. |
| B.6 | `DELETE /api/ledger/vendors/[id]/entries?entryId=` | `brand_ledger.delete` | Exists; refuses non-MANUAL rows with the existing message. The screen routes an imported row's × to `PUT /api/ledger/entries/[id]/review { matchStatus: "IGNORED" }` instead (D3). |
| B.7 | `POST /api/ledger/vendors/[id]/entries` | `brand_ledger.create` | Exists; `ledgerEntrySchema` gains `NOTE`, and `amount` becomes nullable **only** when `type === NOTE` (the app's rule, `App.jsx:823`). |
| B.8 | `POST /api/ledger/gaps/[id]/evidence`, `DELETE /api/ledger/evidence/[id]` | `brand_ledger_gaps.edit` | New — multipart upload to `ledger/<vendorId>/evidence/`, row in `LedgerGapEvidence`; delete removes the object then the row. |
| B.9 | ~~gated file route~~ | — | **Dropped by Q1.** Files are opened by their stored public URL (`LocalProvider` issues `/api/media/<key>`, which already requires a session; S3 issues the bucket URL). |
| B.10 | `DELETE /api/ledger/vendors` (list route) | — | **Deleted** with its page (D1). Its only callers were the three screens (`ledger/page.tsx:50`, `[id]/page.tsx:94`, `gaps/new/page.tsx:56`). |

Deleting a gap: the app deletes after a confirm (`App.jsx:385-396`); the shipped route refuses
when evidence or linked rows exist (`gaps/[id]/route.ts:80-84`). Keep the refusal and show its
message — the same principle as D3.

### Part C — the UI port, 100 %

**C.1 Files.** `src/app/(dashboard)/ledger/[id]/page.tsx` is rewritten as a thin shell that
fetches B.1 with `apiFetch` and renders `<BrandPage>`; `gaps/new/page.tsx` is deleted (the
app's gap form is inline). New directory `src/app/(dashboard)/ledger/[id]/_components/`, one
file per component of the tree, each `"use client"`, each a line-for-line TypeScript port:

| Component | From `App.jsx` | Writes (→ route) |
|---|---|---|
| `brand-page.tsx` | `:223-282` | Reviewed → B.2 |
| `collapsible.tsx` | `:284-294` | — |
| `gaps-tab.tsx` | `:298-429` | add/edit → B.3/B.4 · status → B.4 · note → B.5 · delete → existing DELETE · share → `wa.me` |
| `progress-note.tsx`, `gap-form.tsx` | `:431-444`, `:446-487` | via parent |
| `ledger-tab.tsx` | `:496-694` | add entry → B.7 · × → B.6 or review IGNORED (D3) |
| `entry-explain.tsx`, `evidence.tsx`, `gap-shots.tsx`, `entry-form.tsx`, `balance-editor.tsx` | `:697-722`, `:726-759`, `:762-793`, `:802-831`, `:833-874` | balances → B.2 |
| `monthly-tab.tsx`, `table-tab.tsx`, `share-tab.tsx` | `:881-991`, `:998-1168`, `:1172-1218` | — (CSV, clipboard) |
| `ledger-helpers.ts` | `store.js:67-168` (`today, daysSince, fmtINR, fmtLakh, gapAmount, entryDir, entrySide, computeThread, openGaps, csvEscape, downloadCSV, brandSummaryText`, the constant lists) and `App.jsx:11-39, 491-494, 795-800` | — |

`GapShots` reads `gap.evidence[]` from the API instead of `EVIDENCE[brand.id][n]`, and its
`src` is the stored `url` (Q1). `‹ Back` (`App.jsx:233`) goes to `/vendors/[id]`. Nothing else in the
tree touches routing (`useHashRoute` and the `#/brand/` match live outside it).

**C.2 The view shape** is the app's `brand` object, so the ported components read the same
property names (`id, name, sub, updated, lastReviewed, position, notes, theirBal, ourBal,
recov, deadline, ledger, entries[], gaps[]`) and B.1 maps rows into it server-side: enum
values lowered and hyphenated (`CREDIT_NOTE` → `credit-note`), `direction` → `dir`, `side`
lowered, `auditStatus/auditNote/gapNumber` → `audit{s,t,g}`, `number` → `n`, `amount` → `amt`,
`amountNote` → `amtText`, `evidenceText` → `evidence`, notes → `progress[{date,text}]`. Mapping
on the server keeps the components a verbatim port.

**C.3 The stylesheet.** `styles.css` (381 lines) is copied to
`src/app/(dashboard)/ledger/[id]/ledger.css` and scoped: `:root` tokens, `* {box-sizing}`,
`html, body` and `body` rules (`styles.css:1-27`) become `.bch-ledger` / `.bch-ledger *`;
`#root` (`:28`, and in the `@media` blocks `:335-376`) becomes `.bch-ledger`, keeping the
720 px / 1200 px / 1320 px widths and the safe-area padding. The Dashboard-only groups
(`.summary`, `.brandcard`, `.brandgrid`, `.pingate*`, `.syncdot`, `.sectiontitle`,
`.alert.warn`, the legacy `.entry` rules at `:143-148`) are dropped. Tailwind v4's preflight
is the one thing that can still shift a pixel; the verification in §4 compares both apps side
by side, tab by tab.

**C.4 The vendor page.** In `vendors/[id]/page.tsx:202-218`, a third button beside Call and
WhatsApp — `Ledger`, `variant="outline"`, `BookOpen` icon, `href={/ledger/${id}}` — rendered
only when `canView("brand_ledger")` (cosmetic; the API re-checks). The page's own Ledger tab
is untouched.

**C.5 Permissions on the screen.** `canEdit("brand_ledger")` hides add/delete/balances/
Reviewed; `canEdit("brand_ledger_gaps")` hides the gap form, status row, note box and delete;
resolved/rejected buttons additionally need `canApprove("brand_ledger_gaps")`. Share, CSV and
the WhatsApp button are read-only actions and stay for anyone who can view.

### Part D — the one-time JSON import (R8, R9)

- `POST /api/ledger/vendors/[id]/import-json` — `brand_ledger.create` **and**
  `brand_ledger_gaps.create`; multipart, one `.json` file ≤ 5 MB, plus `brandId` (the app's
  brand id inside the file). Validated with `validateImport`'s rules (`store.js:57-65`) as a
  zod schema.
- Refuses when the vendor already has any `BrandLedgerEntry`, `LedgerGap` or profile row —
  the import is idempotent by refusal, not by upsert.
- One transaction: profile (§2.3 mapping, `code` from Q8), entries (type map incl. `note`,
  `source: STATEMENT_CSV` for `lu-`/`cu-`/`em-`/`ao-`/`ra-`/`ho-`/`tr-` ids and `MANUAL` for
  `man-` ids, so D3 treats hand-added rows correctly), gaps, notes (`createdAt` = the note's
  date, `authorId` = the importer), then a second pass linking `audit.g` → `gapId`.
- Counts returned and shown: brands in file, entries and gaps written, notes written, gaps
  whose `audit.g` pointed at a missing number (expected 0).
- UI: on the ledger screen, an **Import JSON** card visible only while the vendor has no rows
  and only to `brand_ledger.create`; file picker restricted to `application/json`; a select of
  the brands found in the file; a confirm listing the counts before writing. The upload is
  **not** stored in S3 — the file is the owner's export and stays on the device.
- Removal afterwards: the card and the route are behind one constant
  `LEDGER_JSON_IMPORT_ENABLED` in `src/lib/brand-ledger/import-json.ts`; flipping it removes
  the card and makes the route return 410. Deleting the files is a later, one-line cleanup.

### Part E — uploads, S3, AI (R10–R12)

**E.1 Upload.** (`fflate` becomes a direct dependency for `.zip`, Q2.) `POST /api/ledger/vendors/[id]/uploads` — `brand_ledger.create`; multipart
`file` + `kind`; ≤ 100 MB (`MAX_UPLOAD_BYTES`); accepted types by kind: STATEMENT pdf/xlsx/
xls/csv, CHAT txt/zip, SCREENSHOT png/jpg/jpeg/webp, DOCUMENT pdf/png/jpg. Server-side
`getStorage().put` under `ledger/<vendorId>/<kind>/` (a new prefix `ledger/` is added to
`ALLOWED_PREFIXES` and `PREFIX_TYPES` so a later presigned path stays consistent). Storage is
checked **before** any AI spend, as `purchase-orders/extract/route.ts:88-91` does. Row in
`LedgerUpload`.

**E.2 The Files card** on the ledger screen (a sixth card below the tabs, not a sixth tab —
the tab bar stays the app's five): each upload with name, size, kind, date, the runs it fed,
**Run AI**, **Delete file**. This card is the only addition to the app's screen, and it exists
because R10–R12 have no counterpart in the app.

**E.3 Run AI.** `POST /api/ledger/uploads/[id]/run` — `brand_ledger.create` for
`STATEMENT_ROWS`, `brand_ledger_gaps.create` for the claim tasks; body `{ task, prompt? }`.
`prompt` goes through a `sanitizeHint`-style filter (500 chars, same refusal list as
`po-extraction/prompts.ts:21`) and is inserted as data inside `<instructions>`; the system
prompt and JSON schema are fixed per task in `src/lib/brand-ledger/ai-prompts.ts`.
`maxDuration = 60` on the route.

| Task | Input | Output schema | Then |
|---|---|---|---|
| `STATEMENT_ROWS` | PDF → `runAi` with a `pdf` attachment; XLSX/CSV → **no AI**, `xlsx` grid → `classifyEntry`/`parseLedgerDate` (`reconcile.ts:24, 64`) | `{ statementDate, periodFrom, periodTo, claimedClosing, rows: [{date, label, ref, debit, credit, note}] }` | `checkBalance` (`reconcile.ts:122`) against `claimedClosing`; the run stores `tiesOut` and the difference in `proposals` |
| `CLAIMS_FROM_CHAT` | `.txt` (or `_chat.txt` from the zip, Q2) split into chunks (Q6), each chunk inlined in the prompt as data | per chunk `{ claims: [{title, type, amount, amountNote, promisedBy, promisedOn, quote, line}] }` | merged into one proposal list |
| `CLAIMS_FROM_IMAGE` | `image` attachment | same claim schema | — |

`jsonSchema` and `effort` are used **only after** the PO-sheet commit lands (Q9); until then
`json: true` with the shape described in the prompt, which is what OpenAI needs anyway
(`openai.ts:142-145`).

**E.4 Review and accept.** The run's proposals render in a review card: statement rows as a
table with the tie-out line at the top (a mismatch is shown in red and **blocks Accept** until
a person edits the claimed closing or a row); claims as gap cards with the quoted message.
`POST /api/ledger/runs/[id]/accept` writes, in one transaction: for a statement, a
`BrandStatement` (`fileUrl` = the upload, `extractionModel`, `sourceKind`) and its
`BrandLedgerEntry` rows (`source: STATEMENT_PDF|XLSX|CSV`, `matchStatus: UNMATCHED`); for
claims, `LedgerGap` rows with the next numbers, `status: VERIFY`, `evidenceText` = the quote,
and a note `From AI run <id>`. `POST …/discard` marks the run DISCARDED. Nothing is ever
written to `VendorBill`/`VendorPayment`/`VendorCredit` (the schema's own rule,
`schema.prisma:2465-2483`).

**E.5 Delete file (R12).** `DELETE /api/ledger/uploads/[id]` — `brand_ledger.delete`;
`keyFromUrl` → `storage.delete` (the `po-extraction/store.ts:275-299` pattern, but an S3
failure here **returns 502** rather than warn-only, because the owner asked for the delete
and must know it did not happen); then `fileUrl = null`, `deletedAt = now()`. Runs and their
proposals survive. A confirm names the file and says whether a run has been accepted from it.

### Part F — removal and docs

- Delete `src/app/(dashboard)/ledger/page.tsx`, `ledger/[id]/gaps/new/page.tsx`,
  `src/app/api/ledger/vendors/route.ts`.
- `docs/implementation/pending/ledger-merge-plan.md`: add a status line "§7 and §12 Frontend
  superseded 9 Sep 2026 by `0909-vendor-ledger-screens-and-ai-import-plan.md`; the schema,
  engine and API decisions stand". `docs/implementation/README.md:147` row updated.
- `docs/brand-ledger-flow.md` gets a dated note pointing here for the screen and the import.

### Phases and dependencies

| # | Part | Depends on | Size | Parallel? |
|---|---|---|---|---|
| 1 | A schema + RBAC | Q9 | small | — |
| 2 | B API | 1 | medium | — |
| 3 | C UI port | 2 | **large** | with 4 and 5 |
| 4 | D JSON import | 2 | medium | with 3 and 5 |
| 5 | E uploads + AI | 2 | large | with 3 and 4 |
| 6 | F removal + docs | 3 | small | — |
| 7 | Verification (§4) | all | medium | — |

### Logging

Scopes: `ledger:view`, `ledger:profile`, `ledger:gaps`, `ledger:entries`, `ledger:evidence`,
`ledger:import-json`, `ledger:uploads`, `ledger:ai`, `ledger:files`. `debug` for every AI
request (purpose, upload id, bytes, chunk index) and every storage call (key only);
`info` for import finished (counts), run finished (usage, tiesOut), accept (rows written),
file deleted; `warn` for a refused prompt, an unlinked `audit.g`, a run over the size limit;
`error` for a failed run, a failed S3 delete. Never the prompt text, never a URL with a
signature, never the API key (the logger's `SECRET_KEY` redaction covers `key`/`token`, so AI
context objects use `provider`/`model`, as `src/lib/ai/index.ts:50` does).

### Board of agents — checked at build time, before "done"

- **accounting-consultant**: the module never writes bills, payments or credits; Zoho stays
  the source of truth for financials; an AI-read figure reaches a table only after a person
  accepts it and only when the statement ties out.
- **database-architect**: one additive migration; `Float` money matches every existing ledger
  column; Json only for `reply`/`proposals`; indexes on `(vendorId, createdAt)`.
- **backend-engineer**: `requireFeature` on every route, zod on every body, `failure()` in
  every catch, `maxDuration` on the AI route, no `res.json()` on third-party responses.
- **frontend-engineer**: `apiFetch`/`apiTry` only; loading, empty and error states on the
  shell, the Files card and the review card; every stateful component `"use client"`.
- **integration-architect**: files stored before AI spend; delete verified, not assumed;
  no attachment or prompt sent without a size check (`runAi` has none).

---

## 4. Verification

1. `npx prisma migrate dev --name vendor_ledger_profile_uploads` on localhost; read the SQL;
   `npm run db:seed:rbac`; `/team/permissions` shows both ledger modules greyed with
   "Admin only" for a non-system role, and `PUT /api/roles/<non-system>` with a reserved
   permission id returns 400.
2. `npm run build` — the owner runs it (21–45 minutes); exit code reported, not an impression.
3. `/vendors/<AOKI id>` shows the Ledger button; a user without `brand_ledger.view` does not
   see it and gets 403 from `/api/ledger/vendors/<id>`.
4. Import JSON for aoki with the owner's export: counts reconcile with the file (aoki: 48
   entries, 18 gaps); the card disappears afterwards; a second import returns the refusal.
5. Side-by-side with the ledger app at `#/brand/aoki`, tab by tab: header, balances card,
   Ledger (thread, matchbar figure, audit bar, filters, search, show-earlier), Monthly (rows
   and totals), Table (ladder and totals), Gaps (filters, expand, status row, note, share),
   Share (text identical). Computed closing equals the app's to the rupee.
6. Actions: Reviewed flips the chip; add entry appears in the thread with the right sign;
   × on a `man-` row deletes after confirm, × on a `lu-` row marks it ignored and the row
   greys; add/edit/delete gap; status change to resolved writes the "Marked resolved" note
   and is refused without `approve`; balances editor persists after reload.
7. Upload a Lucifer statement PDF; Run AI → the review shows rows and the tie-out; force a
   mismatch by editing the claimed closing → Accept is blocked; restore → Accept writes a
   `BrandStatement` with `tiesOut = true` and rows appear in the Ledger tab as `statement`
   entries. Upload the aoki `_chat.txt` with the prompt "discounts promised by Prashant" → the
   claims review lists candidates with quotes; Accept creates VERIFY gaps numbered after the
   existing 18.
8. Delete file → the object is gone from the bucket (check in the S3 console), the row shows
   "deleted", the run's proposals still open, and the old URL now returns the bucket's 404.
9. `LOG_LEVEL=0` shows the debug lines from §3 Logging; no prompt text, no key.

---

## 5. Out of scope, deliberately

- The Vercel Blob state and the `sync.js` mechanism — not read, not migrated (D6).
- The WhatsApp zips, `findings.md`, `reconciliation.md`, `open-items-register.md` — research
  inputs, not application data; they may be uploaded as CHAT/DOCUMENT files if wanted.
- Per-invoice discount **computation** from `VendorDiscountTerm` and its editor — the app
  shows hand-typed audit verdicts, and those are what the port shows.
- Matching statement rows to BCH bills/payments in the screen — the engine still runs and the
  API still returns `match`, but the app's UI has no place for it and the UI is the app's.
- The `/accounts/vendor-ledger` screen and the vendor page's own Ledger tab — a different
  ledger (`docs/brand-ledger-flow.md` §0), untouched.
- Removing `LedgerEntrySource.BCH_BOOKS` (declared, unused) — a later cleanup.
- AI spend logging to a table (audit F9) — belongs to
  `ai-provider-config-and-task-routing-plan.md`; this plan records usage on `LedgerAiRun`
  only for its own runs.
- Production deployment, `migrate deploy` and `db:seed:rbac` on the cloud test database —
  the owner's, by hand.
