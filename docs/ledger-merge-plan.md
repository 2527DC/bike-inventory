# Merging `ledgers` into BCH Management

**Status:** decisions taken (§0). Schema, RBAC seed, backend and frontend implemented — see §12. PDF statement import and the 219-gap migration still pending.
**Scope:** `F:\bharath  Cycle\ledgers` → this app. `bch-service` is out of scope (already merged).

---

## 0. Decisions taken

These override anything below that contradicts them.

| # | Decision | Rationale |
|---|---|---|
| **D1** | **Store both sides separately.** `BrandLedgerEntry` holds the brand's statement exactly as received; `VendorBill`/`VendorPayment`/`VendorCredit` hold BCH's books. An import **never** edits the brand's numbers. | A merged ledger gives a number; two ledgers give a case you can prove. Also the safer failure mode — a misread row corrupts a copy of their claim, not your accounting record. |
| **D2** | **New `LedgerGap` table**, not an extension of `VendorIssue`. | A faulty brake and a missing ₹1.3L credit have different lifecycles, audiences and permissions. |
| **D3** | *(open)* WhatsApp archives — recommend keeping in a repo, only cited evidence in R2. | ~190 MB of `.zip` is not application data. |
| **D4** | **Migrate the 219 existing gaps.** | 199 are still live (`open`/`verify`/`promised`), carrying ~₹3.9cr of claims. Months of chat-reading went into them. |
| **D5** | **Two RBAC modules** — `brand_ledger` and `brand_ledger_gaps`, gaps visible to fewer people. | Live disputes and negotiating positions are more sensitive than the ledger itself. |
| **D6** | **CSV/XLSX import first, PDF extraction second.** | PDF extraction is net-new with real accuracy risk; prove the ledger first. |
| **D7** | **Auto-populate BCH's side from `VendorBill`/`VendorPayment`/`VendorCredit`, one-directional**, with three safeguards (below). | Those payments are already recorded; entering them twice guarantees drift. |
| **D8** | **Ledger hangs off `Vendor`**, with an optional many-to-many `Brand` link. Statement upload matches **GSTIN first**, then name, and always asks before creating. | You pay the billing entity, not the brand — Raleigh is billed via Naren International, EMotorad via Inkodop Technologies. Silent auto-create would fragment payables. |
| **D9** | **Add `VendorDiscountTerm`.** | Turns the discount audit from hand-typed into computed. See §2.3. |

### D7's three safeguards

Without these, auto-population is dangerous when the books are patchy — an unmatched row is
ambiguous between *"they never posted our payment"* and *"we never recorded it."*

1. **`NEEDS_REVIEW` never means "discrepancy."** An unmatched row is surfaced, not concluded. A
   human classifies it: *they haven't posted it* / *we never recorded it* / *not a real entry*.
2. **Manual escape hatch.** Ledger-side entries may be added with `source: MANUAL` for payments
   not yet in Accounts, so incomplete books never block the tool.
3. **Coverage indicator.** Compare volumes before flagging anything — *"your books: 3 payments ·
   their statement: 26 receipts → records look incomplete for this vendor"* — so the tool doesn't
   cry wolf and get ignored.

With these, the same design works whether the books are complete or patchy, and it doubles as a
prompt showing which suppliers aren't being recorded properly.

### Settled by reading the code, not opinion

**`Vendor.cdPercentage` is authoritative; `Brand.cdPercentage` is dead.** 50 usages of
`cdPercentage`/`cdTermsDays` across `src/` — every one reads `Vendor`. The brands admin page
doesn't expose the fields and `/api/brands` doesn't write them. The `Brand` pair should be
dropped in a later cleanup.

---

## 1. What the ledgers app is

A **supplier-dispute reconciliation tool**. Not inventory, not accounting. One job:

> Every brand promised BCH discounts, credit notes and support payments. Did they actually
> credit them? What do we *really* owe?

Its own formula:

```
Net payable = Ledger due − unrecorded payments − promised discounts not yet credited
```

### Features

| Feature | What it does |
|---|---|
| Per-brand ledger | Invoices, payments, credit notes, discounts as a running balance |
| **Gap register** | The core. Numbered disputes: what was promised, by whom, when, in which message, status, next action |
| Per-invoice discount audit | Tags each invoice `ok / short / missing / era20` — e.g. *"18% via DIS-90, group short ₹539"* |
| Evidence | WhatsApp screenshots + credit-note PDFs pinned to each gap |
| Bank matching | Payments BCH sent vs. payments the brand admits receiving |
| Views | Ledger · Monthly · Table · Gaps · Share |
| Cloud sync | One JSON document shared across devices |

### Current data

| | Count |
|---|---:|
| Brands | 7 (aoki, cultsport, emotorad, hornback, lucifer, raleigh, trinity) |
| Gap records | **219** |
| Generated ledger entries | 215 KB of JS |
| Evidence / chat files | ~720 (aoki 104, lucifer 158, raleigh 453) |
| WhatsApp archives | ~190 MB of `.zip` |

The value is real. It found that EMotorad posted invoices to one folio and payments to another,
*"so neither folio alone was ever correct (the years of miscalculation)."*

---

## 2. Two findings that change the shape of this merge

### 2.1 PDF extraction does not exist there — but it already exists HERE

There is **no PDF library anywhere** in the ledgers app. `pdf-parse`, `pdfjs`, `pdf2json` — zero
matches. PDFs are only ever rendered as a link for a human to open:

```jsx
// App.jsx:772 — a PDF is a LINK, never read
s.doc ? <a href={`/evidence/${brand.id}/${s.file}`} target="_blank">…</a>
      : <img src={`/evidence/${brand.id}/${s.file}`} />
```

Ledger data comes from CSV/XLSX, and the PDFs behind it were **transcribed by hand** — the
script says so: `/* canonical timeline from Lucifer's own ledger PDFs (transcribed 13-Jul-26) */`.

**This app can already do what that one couldn't.** `src/lib/pdf-parser.ts` sends a PDF to Claude
as a `document` block and returns structured JSON. It is currently prompted for product/inventory
items; extracting a brand statement is the same mechanism with a different prompt and schema.

Two things to fix while reusing it:
- It is pinned to `claude-sonnet-4-20250514`. Use **`claude-opus-5`** — reconciling a supplier
  statement is exactly the kind of careful, high-stakes extraction that warrants the strongest
  model, and a mis-read figure here becomes a wrong number in a dispute with a supplier.
- Statements run to many pages. Use **streaming** with a generous `max_tokens`, and
  `thinking: {type: "adaptive"}` — the model has to reason about which column is debit vs credit,
  and whether a row is an invoice or a credit note.

So "PDF extraction" moves from *doesn't exist* to *a well-scoped new feature on top of code you
already own*.

### 2.2 Most of this is already modelled in your schema

| Ledger concept | Already exists as |
|---|---|
| Brand / supplier | `Vendor` — including **`cdTermsDays` and `cdPercentage`** (cash-discount terms — precisely what the ledger polices), `openingBalance`, `whatsappNumber` |
| Invoice | `VendorBill` — `billNo`, `billDate`, `amount`, `paidAmount`, `status` |
| Payment | `VendorPayment` — `amount`, `cdDiscountAmount`, `paymentMode`, `referenceNo` |
| Credit note | `VendorCredit` — `creditNoteNo`, `amount`, `usedAmount`, `reason` |
| **A "gap"** | **`VendorIssue`** — `issueType`, `status`, `priority`, `description`, `photoUrls`, `docLink`, `suggestedResolution`, `resolution` |

`VendorIssue` is strikingly close to a gap; it already carries photo URLs and a document link.

**This reframes the exercise.** The question is not "how do I import that app?" but:

> Should brand ledgers become a **reconciliation layer** over `VendorBill` / `VendorPayment` /
> `VendorCredit`, with a claim register on top?

**Recommendation: yes.** Port the *method*, not the SPA.

### 2.3 The disputes are mostly TRADE discounts, which nothing models

Your schema can express a **cash discount** — `cdTermsDays` + `cdPercentage`, i.e. *"2% if paid
within 15 days."* That drives the existing CD warnings and CD summary report. It is a deadline
feature.

But look at what the ledger actually argues about:

| Brand | The disputed discount |
|---|---|
| Lucifer | *"20% steel / 18% alloy / ₹150-per-cycle transport"* |
| Hornback | *"15% is being given (proven) but Syed says the deal was 20% → ~5% gap ≈ ₹1.3–1.4L"* |
| Aoki | *"₹1,200/bike billing incentive"*, *"₹2,000/unit on Flex GO"* |

None of those are cash discounts. They are **trade discounts** — off list price, varying by frame
material, model, period or volume, with nothing to do with payment timing.

| | Cash discount | Trade discount |
|---|---|---|
| Trigger | Paying within N days | The product / the deal |
| Varies by | nothing — one rate | frame material, model, period, volume |
| Modelled today | `cdTermsDays` + `cdPercentage` ✓ | **not at all** ✗ |

The EMotorad notes list *"CD disputes (10)"* separately from *"credit notes (22)"*, so both kinds
exist in the data and only one has a home.

`VendorDiscountTerm` (D9) fills that hole. It is the highest-leverage table in the design: with
agreed terms stored, the app **computes** the expected discount per invoice and flags the
shortfall, replacing hand-typed annotations like *"18% via DIS-90, group short ₹539"*. Its
`agreedBy` / `evidenceUrl` fields also surface the warning your Hornback notes already call out —
*"**Need: written 20% agreement** to claim Dispute #1"* — **before** you go into the negotiation.

---

## 3. Why this is harder than the bch-service merge

`bch-service` was the same stack — Next.js, Prisma, Postgres. It was a port. This shares nothing.

| | bike-inventory | ledgers |
|---|---|---|
| Framework | Next.js 16 App Router | **Vite SPA**, no server |
| React | 19 | **18** |
| Database | Postgres + Prisma | **none** |
| Persistence | Postgres | **localStorage + one JSON blob** |
| Auth | NextAuth + RBAC | **client-side PIN + shared header key** |
| Data origin | Runtime DB writes | **build-time codegen from repo files** |

Three genuine incompatibilities:

1. **No database.** State is one JSON document rewritten wholesale on save. Multi-user editing is
   last-writer-wins — one person silently overwrites another.
2. **Build-time codegen.** `entries.gen.js` is produced by a Node script reading repo files. In a
   DB app that data must live in tables.
3. **Auth is decorative.** `PinGate` is a client-side check, bypassed with devtools. Sync uses a
   shared `SYNC_KEY` header. **This is the third weak-auth system found in this codebase**, after
   bch-service's forgeable cookie and its seven unauthenticated routes.

---

## 4. Libraries

**Nothing new to install.**

| Need | Already present |
|---|---|
| XLSX/CSV parsing | `xlsx@0.18.5` ✓ |
| PDF extraction | `@anthropic-ai/sdk@0.90.0` ✓ + `src/lib/pdf-parser.ts` ✓ |
| PDF export | `jspdf` + `jspdf-autotable` ✓ |
| Storage | `src/lib/r2.ts` ✓ |
| Validation | `zod` ✓ |
| State | `zustand` ✓ |

**Dropped:** `vite`, `@vitejs/plugin-react`, `react@18`, `@vercel/blob`.

---

## 5. Database

Assuming decision **D1 = "store both sides"** (see §8):

```prisma
enum LedgerEntryType { OPENING INVOICE PAYMENT CREDIT_NOTE DEBIT_NOTE DISCOUNT ADJUSTMENT }
enum LedgerSide      { VENDOR BCH }
enum MatchStatus     { UNMATCHED MATCHED DISPUTED IGNORED }
enum GapType         { DISCOUNT_PENDING CREDIT_NOTE_PENDING SHORT_CREDIT DISPUTE
                       RECONCILIATION_DIFFERENCE DOCUMENTATION_GAP BALANCE_UNCONFIRMED
                       OPERATIONAL_WARRANTY }
enum GapTier         { FIRM LEVERAGE VERIFY CONDITIONAL }
enum GapStatus       { OPEN PROMISED VERIFY RESOLVED DROPPED }
enum EvidenceKind    { SCREENSHOT PDF EMAIL DOCUMENT }

// What the BRAND says, transcribed from their statement. NEVER edited to match our books —
// the entire method depends on their numbers staying pristine, so a difference is provable.
model BrandLedgerEntry {
  id          String          @id @default(cuid())
  vendorId    String
  vendor      Vendor          @relation(fields: [vendorId], references: [id])
  entryDate   DateTime
  type        LedgerEntryType
  ref         String?         // their voucher number
  amount      Float
  direction   Int             // +1 increases what BCH owes, -1 decreases
  side        LedgerSide
  note        String?

  // Per-invoice discount audit (the "short ₹539" annotations)
  auditStatus String?         // ok | short | missing | era20 | info
  auditNote   String?
  gapId       String?         // links an annotated row to the claim it evidences

  // Reconciliation against OUR books — null until matched
  billId      String?
  paymentId   String?
  creditId    String?
  matchStatus MatchStatus @default(UNMATCHED)

  statementId String?
  statement   BrandStatement? @relation(fields: [statementId], references: [id])

  @@index([vendorId, entryDate])
  @@index([matchStatus])
  @@map("brand_ledger_entries")
}

// The claim register — the heart of the tool.
model LedgerGap {
  id           String    @id @default(cuid())
  vendorId     String
  vendor       Vendor    @relation(fields: [vendorId], references: [id])
  number       Int       // per-brand #1, #2 … (their existing numbering)
  title        String
  gapType      GapType
  tier         GapTier?
  amount       Float?
  amountNote   String?   // "10,300 claimed / 9,900 itemised" — the text form matters
  status       GapStatus @default(OPEN)
  promisedBy   String?   // who at the brand
  promisedOn   DateTime?
  evidenceText String?   // the curated citation string
  action       String?   // next step
  resolution   String?
  resolvedAt   DateTime?
  createdById  String
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt

  evidence     LedgerGapEvidence[]

  @@unique([vendorId, number])
  @@index([vendorId, status])
  @@map("ledger_gaps")
}

model LedgerGapEvidence {
  id         String       @id @default(cuid())
  gapId      String
  gap        LedgerGap    @relation(fields: [gapId], references: [id], onDelete: Cascade)
  url        String       // R2
  kind       EvidenceKind
  capturedOn DateTime?
  source     String?      // "Mani WhatsApp chat (L1600)"
  note       String?      // what it proves
  createdAt  DateTime     @default(now())

  @@index([gapId])
  @@map("ledger_gap_evidence")
}

// Provenance — which statement produced these rows, so a re-import is auditable
// and a brand's revised statement can supersede an older one.
model BrandStatement {
  id             String    @id @default(cuid())
  vendorId       String
  vendor         Vendor    @relation(fields: [vendorId], references: [id])
  statementDate  DateTime
  periodFrom     DateTime?
  periodTo       DateTime?
  closingBalance Float?    // what THEY claim — checked against our computed sum
  fileUrl        String?   // the original PDF/XLSX in R2
  sourceKind     String    // PDF_AI | XLSX | CSV | MANUAL
  importedById   String
  importedBy     User      @relation("StatementImportedBy", fields: [importedById], references: [id])
  createdAt      DateTime  @default(now())

  entries        BrandLedgerEntry[]

  @@index([vendorId, statementDate])
  @@map("brand_statements")
}
```

**No new brand table** — `Vendor` is reused. That is the point of the whole design.

`Vendor` gains back-relations plus, if wanted, `ledgerOpeningBalance` / `ledgerOpeningDate`
(distinct from the existing `openingBalance`, which is BCH's own book figure).

---

## 6. Backend

### RBAC

Two new modules in `prisma/rbac-catalog.ts`:

| key | Label | Actions | Why separate |
|---|---|---|---|
| `brand_ledger` | Brand Ledgers | view, create, edit, delete, fetch | Statement import + ledger views |
| `brand_ledger_gaps` | Ledger Claims | view, create, edit, delete, approve | Live disputes and negotiating positions — more sensitive than the ledger itself |

`approve` on gaps = authority to mark a claim resolved or dropped, which is a financial decision.

### Routes (`/api/brand-ledger/*`)

| Route | Module · action |
|---|---|
| `GET/POST /vendors/[id]/entries` | `brand_ledger` view / create |
| `POST /vendors/[id]/import` | `brand_ledger` create |
| `POST /vendors/[id]/reconcile` | `brand_ledger` edit |
| `GET/POST /vendors/[id]/gaps` | `brand_ledger_gaps` view / create |
| `PUT/DELETE /gaps/[id]` | `brand_ledger_gaps` edit / delete |
| `POST /gaps/[id]/evidence` | `brand_ledger_gaps` edit |
| `GET /vendors/[id]/summary` | `brand_ledger` view |

All guarded with `requireFeature`, all zod-validated, all returning `successResponse`.
`api/state.js` is deleted — tables replace the JSON blob.

### The reconciliation engine — `src/lib/brand-ledger/`

This is the valuable part. Port it out of `extract-entries.mjs` into real modules:

| Module | From | Does |
|---|---|---|
| `normalise.ts` | `parseDate`, `num` | `10-Jun-26` / `10/06/2026` / `2026-06-10` → ISO; strips `₹`, commas |
| `classify.ts` | `typeFromLabel`, `sideFor` | Row → entry type + direction + side |
| `balance.ts` | the closing-sum loop | Recomputes the running balance and **checks it ties to the brand's claimed closing** |
| `match.ts` | the bank-matching pass | Nearest-date, same-amount matching against `VendorPayment` |
| `import.ts` | new | Orchestrates CSV / XLSX / PDF → `BrandLedgerEntry[]` |

`balance.ts` deserves emphasis: recomputing the chain and comparing it against the brand's own
stated closing is how you catch a statement that doesn't add up. That check should run on every
import and be surfaced, not logged.

### PDF import

New `src/lib/brand-ledger/extract-statement.ts`, modelled on `pdf-parser.ts`:

```ts
const response = await client.messages.create({
  model: "claude-opus-5",
  max_tokens: 16000,
  thinking: { type: "adaptive" },
  messages: [{ role: "user", content: [
    { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 }, title: fileName },
    { type: "text", text: STATEMENT_EXTRACTION_PROMPT },
  ]}],
});
```

Long statements should use `client.messages.stream(...)` with `.finalMessage()` so a big document
doesn't hit the HTTP timeout.

**Extraction must never be trusted silently.** Every import lands as a `BrandStatement` with its
rows `UNMATCHED`, and the recomputed closing balance is compared against the brand's stated
closing. A mismatch blocks the import for human review. An AI mis-read that quietly becomes a
number in a supplier dispute is the worst failure mode this feature has.

---

## 7. Frontend

### Pages — `/brand-ledger/*`

Keep the five-tab structure; it works.

| Route | Tab |
|---|---|
| `/brand-ledger` | Dashboard — every brand, their balance vs ours, open claim value |
| `/brand-ledger/[vendorId]` | Ledger — running balance with inline audit annotations |
| `…/monthly` | Monthly rollup |
| `…/table` | Flat table + export |
| `…/gaps` | Claim register (the main working screen) |
| `…/share` | Brand-facing consolidated view |
| `…/import` | Upload a statement (PDF/XLSX/CSV) and review before commit |

### The real work

`App.jsx` is **1,355 lines in one file** — React 18, no TypeScript, its own CSS. It must be:

1. Split into components (`LedgerTab`, `GapsTab`, `GapForm`, `EntryExplain`, `GapShots`, …)
2. Converted to TypeScript
3. Restyled onto BCH OPS
4. Rewired from `localStorage` to API calls
5. Permission-gated (`canEdit("brand_ledger_gaps")` etc.)

**This is the single largest chunk of the merge.**

Deleted: `PinGate` (RBAC replaces it), `store.js`, `sync.js`, `seed.js`, `entries.gen.js`,
`evidence.gen.js` — all superseded by the database.

Worth preserving: the `Evidence` component that highlights dates, `L-line` refs and quotes inside
a citation string. Small, and it makes the register readable.

---

## 8. Decisions needed before any code

| # | Question | Why it blocks | My recommendation |
|---|---|---|---|
| **D1** | **Store the brand's numbers separately from ours, or reconcile into one ledger?** | *The* decision — everything else follows. Their README is explicit: *"`ledger.csv` mirrors what the brand sent. Our corrections live in `reconciliation.md`."* | **Store both.** `BrandLedgerEntry` = their claim, `VendorBill`/`VendorPayment` = our books, the gap is the difference. Collapsing them destroys your ability to prove a discrepancy. |
| **D2** | **Gaps: extend `VendorIssue` or a new `LedgerGap` table?** | `VendorIssue` fits ~80% but lacks `amount`, `tier`, `promisedBy`, `promisedOn`. | **New table.** Operational issues (a faulty brake) and financial claims (a missing ₹1.3L credit) have different lifecycles, different audiences and different permissions. |
| **D3** | **Do the research artifacts come along?** ~190 MB of WhatsApp zips, plus `findings.md`, `open-items-register.md`, `reconciliation.md` per brand. | These are analysis documents, not app data. But gaps cite them. | **Keep them in a repo/drive.** Put only the *cited* evidence files in R2 and link the rest. Postgres is not a document store. |
| **D4** | **Migrate the existing 219 gaps and all ledger entries, or start fresh?** | Determines whether a one-off import script is needed. | **Migrate.** That register is months of work and the reason the tool exists. |
| **D5** | **Who may see this?** | Brand ledgers expose supplier pricing, margins and live disputes — more sensitive than stock. | **A narrow role.** Not everyone with `vendors.view`. Consider gaps being visible to fewer people than the ledger. |
| **D6** | **Build the PDF statement import now, or import CSV/XLSX first?** | PDF extraction is net-new work with a real accuracy risk. | **CSV/XLSX first**, PDF as a second phase once the ledger and reconciliation are proven. |
| **D7** | **Should the ledger auto-sync from `VendorBill`/`VendorPayment`?** | If BCH's own books live in this app, half the reconciliation becomes automatic. | **Yes, one-directional:** our side auto-populates from our records; their side only ever from an imported statement. |
| **D8** | **`Vendor` vs "brand".** Ledgers uses brand names (`lucifer`, `raleigh`); this app has both a `Vendor` and a `Brand` table, and Raleigh is billed via distributor *Naren International*. | Wrong mapping breaks the ledger — you owe the distributor, not the brand. | **Map to `Vendor`** (who you pay), and note the brand in a field. Confirm each of the 7 maps to an existing vendor. |

---

## 9. Phases

| # | Phase | Depends on | Size |
|---|---|---|---|
| 0 | Resolve D1–D8 | — | small |
| 1 | Schema + RBAC modules + seed | 0 | small |
| 2 | Reconciliation engine → `src/lib/brand-ledger/` | 1 | medium |
| 3 | API routes (entries, gaps, evidence, summary) | 2 | medium |
| 4 | CSV/XLSX import + balance-tie check | 3 | medium |
| 5 | Migrate 7 brands' entries + 219 gaps + evidence to R2 | 4 | medium |
| 6 | **UI port** — 1,355-line SPA → TypeScript components on BCH OPS | 3 | **large** |
| 7 | PDF statement extraction (`claude-opus-5`) | 4 | medium |
| 8 | Verify — build, permissions, balance ties, click-through | all | medium |

Comparable to the bch-service merge, possibly larger — no shared framework to lean on.

---

## 10. Risks

**Silent AI mis-extraction.** A wrong figure from a PDF becomes a wrong number in a supplier
negotiation. Mitigate: always compare the recomputed closing against the brand's stated closing;
block the import on a mismatch; keep the source file linked so any row can be traced back.

**Losing the two-sided principle.** The strongest pressure during implementation will be to
"just merge the numbers." Resist it — the separation is the product.

**Concurrent editing.** Today one person edits a JSON file. In the merged app several people edit
rows, so the last-writer-wins model must not survive the port.

**Scope creep from the research artifacts.** The markdown analyses are genuinely valuable but are
not application data. Pulling them in turns a schema migration into a document-management project.

---

## 11. Recommendation

**Port the method, not the app.**

The React SPA is a working file that one person edits. What matters is (a) the reconciliation
logic in `extract-entries.mjs`, (b) the gap-register discipline, and (c) the two-sides principle.
Rebuild those on `Vendor`/`VendorBill`/`VendorPayment`/`VendorCredit` — which already exist and
already carry `cdTermsDays`/`cdPercentage`, the exact terms the ledger exists to police.

The result is better than either app today: a brand ledger where their claim and your books sit
side by side, gaps computed rather than transcribed, every promised discount tracked against a
real bill — and, with `pdf-parser.ts` extended, statements read automatically instead of
transcribed by hand.

**Answer D1 first.** Everything else follows from it, and getting it wrong means rebuilding the
schema.

---

## 12. What is implemented

Built and verified: `prisma validate` passes, `db push` applied, `tsc --noEmit` reports 0 errors.

### Database — 7 models, 8 enums

`BrandLedgerEntry` · `BrandStatement` · `LedgerGap` · `LedgerGapEvidence` · `LedgerGapNote` ·
`VendorDiscountTerm` · `BrandVendor`

Six choices worth knowing:

- **`direction` is stored, not derived from `type`.** Brands occasionally post a credit on a
  sales voucher; the running balance depends on the sign, so the sign is data.
- **`amountNote` sits beside `amount`.** The register holds entries like
  *"10,300 claimed / 9,900 itemised"*. Forcing that into a Float would invent certainty.
- **`BrandStatement` stores `claimedClosing` AND `computedClosing`, plus `tiesOut`.** If their
  own rows do not sum to the closing balance they quote, the statement is wrong — a finding in
  itself, and it blocks the import.
- **`LedgerMatchStatus` separates `NEEDS_REVIEW`, `THEY_MISSING` and `WE_MISSING`.** Safeguard 1
  encoded in the type: the matcher may say "no match", but only a person may say which side is
  missing it.
- **`LedgerEntrySource.MANUAL`** is safeguard 2 — a real payment not yet in Accounts, so patchy
  books never block the tool.
- **`VendorDiscountTerm.isProven` + `agreedBy` + `evidenceUrl`** make an unproven term visible
  before a negotiation rather than during it.

### RBAC — seeded

| Module | Route | Actions |
|---|---|---|
| `brand_ledger` | `/ledger` | view, create, edit, delete, fetch |
| `brand_ledger_gaps` | *(inside a vendor's ledger)* | view, create, edit, delete, approve |

System total is now **35 modules / 134 permissions**, and ADMIN holds **134/134** — verified by
query, not assumed. The sidebar picks `/ledger` up automatically because it renders from the
`modules` table.

`brand_ledger_gaps` is deliberately routeless: claims live inside a vendor's ledger, and the
separate module exists so dispute data can be withheld from people who may read a statement.

### Backend

| Route | Guard |
|---|---|
| `GET /api/ledger/vendors` | `brand_ledger.view` |
| `GET /api/ledger/vendors/[id]` | `brand_ledger.view` (+ `brand_ledger_gaps.view` for claims) |
| `POST/DELETE /api/ledger/vendors/[id]/entries` | `brand_ledger.create` / `.delete` |
| `PUT /api/ledger/entries/[id]/review` | `brand_ledger.edit` |
| `GET/POST /api/ledger/vendors/[id]/gaps` | `brand_ledger_gaps.view` / `.create` |
| `PUT/DELETE /api/ledger/gaps/[id]` | `brand_ledger_gaps.edit` / `.delete` |

`src/lib/brand-ledger/reconcile.ts` is the engine ported out of `extract-entries.mjs` — date
normalisation, entry classification, running balance, the balance tie-out check, payment
matching (reference first, then amount + nearest date), the coverage assessment, and the
expected-discount calculation. Pure functions, no I/O.

Four rules enforced in the routes rather than left to convention:

1. **Imported rows cannot be deleted.** They are a record of what the brand sent; deleting one
   rewrites history. Mark them `IGNORED` instead.
2. **A match must belong to the same vendor.** A mis-typed id could otherwise attach one
   supplier's payment to another's statement row and corrupt both silently.
3. **Closing a claim needs `approve`, not `edit`.** Writing off money owed is a financial
   decision, not a text change.
4. **A claim with evidence attached cannot be deleted** — reject it with a reason, so the
   reasoning survives.

### Frontend

| Route | Screen |
|---|---|
| `/ledger` | Every vendor with ledger activity: their claim vs our books, open claim value, coverage warnings |
| `/ledger/[id]` | Tabs — Ledger · Claims · Terms |
| `/ledger/[id]/gaps/new` | Raise a claim |

The vendor page leads with **both balances side by side** — what their statement says, and what
their own rows add up to — because that difference is the product. Below it: a tie-out warning
when the statement does not add up, the coverage banner, and the records we hold that never
reached their statement.

Unmatched rows offer four one-click classifications — *they haven't posted ours* / *we never
recorded it* / *matched* / *ignore* — which is safeguard 1 in the interface: the app surfaces,
the person decides.

### Not yet done

- **PDF statement import** (D6 — deliberately second). `src/lib/pdf-parser.ts` already does
  AI extraction; it needs a statement-shaped prompt, `claude-opus-5`, and streaming.
- **CSV/XLSX import UI.** Entries can be added via the API; there is no upload screen yet.
- **Migrating the 219 gaps and 7 brands' entries** (D4).
- **Evidence upload to R2.** The model and API shape exist; no upload flow.
- **Vendor matching on upload** (D8 — GSTIN first, then name, always confirm).
- **Monthly / Table / Share tabs** from the original app.
- **Not click-tested.** Verified by build and typecheck only.
