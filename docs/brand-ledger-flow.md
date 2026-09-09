# The Brand Ledger — a story of one supplier statement

**Date:** 9 Sep 2026
**Question this answers:** what is the ledger in this application, how does a supplier's
statement become a claim we can press, and which tables move when it does?
**Verified against:** `6cbdf4b` (branch `docs/plan-requirements-rule`) — every claim below carries a `file:line`.

**Companion doc:** [`bank-statement-upload-flow.md`](./bank-statement-upload-flow.md) — the
same shape of problem (an outside party sent us a list of money movements; do they agree with
ours?) solved a completely different way.
**Older audit:** [`ledger-and-reconciliation-flow.md`](./ledger-and-reconciliation-flow.md)
(31 Aug 2026), which first identified the hole described in §5. Its **§8.1** carries the
finding register (L1–L15) with today's status for each.

**The plan that owns this module:**
[`implementation/pending/ledger-merge-plan.md`](./implementation/pending/ledger-merge-plan.md)
— status *in-progress*. Its decisions **D1** (two sides, stored separately), **D4** (migrate
the 219 gaps), **D6** (CSV/XLSX before PDF) and **D7** (our side auto-populates, one
directional) are the reasons behind most of what follows. Its *"Re-verified 9 Sep 2026"*
section lists what is still missing.

---

## 0. "Ledger" means three different things here

Before the story, the disambiguation — this is the single biggest source of confusion in the
app:

| # | Name | Screen | What it compares | Is it a reconciliation? |
|---|---|---|---|---|
| 1 | **Vendor Ledger** (simple) | `/accounts/vendor-ledger`, and the *Ledger* tab at `/vendors/[id]` | nothing — a running balance of **our own books** | No. A report. |
| 2 | **Brand Ledger** | `/ledger`, `/ledger/[id]` | **their statement vs our books**, plus a register of what they owe us | Yes — this document |
| 3 | **Bank Reconciliation** | `/accounts/bank-upload` → `/accounts/reconcile/[id]` | **the bank's statement vs our books** | Yes — the companion document |

### #1 in one paragraph, so it stops confusing you

`api/vendors/[id]/ledger/route.ts` pulls the last 50 `VendorBill` and last 50 `VendorPayment`
rows (`:22-40`), flattens them into one timeline (a bill is a **debit**, a payment is a
**credit** — and the credit includes `cdDiscountAmount` at `:74`, so a cash discount settles
the bill instead of leaving a stub), sorts ascending, and walks forward from
`vendor.openingBalance` accumulating `debit − credit` (`:88-93`). It returns the **first 20**
rows (`:105`). Guarded by `vendors.view`.

Two quirks worth knowing: the running balance is computed over the 50+50 cap, so a vendor with
longer history gets a wrong starting point for the visible window; and the summary
(`currentBalance`, `totalBills`, `totalPayments`) covers all fetched rows while the list shows
only twenty. Nothing else in this document applies to it.

---

## 1. Why the brand ledger exists

Straight from the schema's own header (`prisma/schema.prisma:2465-2483`):

> Every brand promised discounts and credit notes. Did they actually credit them, and what do
> we really owe?
>
> `Net payable = ledger due − unrecorded payments − promised discounts not yet credited`

And the rule the whole design hangs on:

> **Two sides, stored separately.** `BrandLedgerEntry` is what the **brand** says, transcribed
> from their statement. `VendorBill`/`VendorPayment`/`VendorCredit` are **BCH's** books.
> `LedgerGap` is the difference worth chasing.
>
> An import NEVER edits the brand's numbers and NEVER writes into BCH's books. If their
> statement is wrong, that wrongness IS the finding — "correcting" it on import destroys the
> evidence needed to prove it.

The comment names the incident behind it: the **EMotorad two-folio problem**, where invoices
were posted to one account and payments to another, so neither folio alone was ever right.

One more design decision, easy to trip over: the ledger attaches to **Vendor, not Brand** —
you pay the billing entity, and brand ≠ entity. Raleigh is billed via Naren International,
EMotorad via Inkodop Technologies.

---

## 2. The story, act by act

### Act 1 — a statement arrives … and stops at the door

**This is where the story breaks today.** A brand emails a PDF or Excel statement. There is no
screen to upload it and no route to receive it.

`BrandStatement` is only ever **read** — the single reference in `src/` is
`api/ledger/vendors/[id]/route.ts:80`, a `findFirst`. Nothing anywhere creates one. The model
has `fileUrl`, `extractionModel`, `claimedClosing`, `computedClosing` and `tiesOut` all ready
(`schema.prisma:2635-2666`), and every one of them stays null in practice.

The app even tells the user to do the impossible. `/ledger`'s empty state
(`ledger/page.tsx:101`) reads:

> *"Import a supplier statement from a vendor's page to start reconciling."*

There is no such import on the vendor page.

**What exists instead:** `POST /api/ledger/vendors/[id]/entries` adds **one row at a time**
(`entries/route.ts:27`), guarded by `brand_ledger.create`. Its own comment names the two
legitimate uses — transcribing a row off a statement that was not imported, and the `MANUAL`
escape hatch for a real payment Accounts has not recorded yet, so an incomplete Accounts module
never blocks the reconciliation.

So today the ledger is populated by hand, or not at all.

### Act 2 — a row is classified

Whether typed in or (one day) imported, every row passes through pure functions in
`src/lib/brand-ledger/reconcile.ts` — no Prisma, no I/O, so the rules can be reasoned about
and tested alone.

**Dates** (`parseLedgerDate:24`) handle `2026-06-10`, `10-Jun-26`, `10 Jun 2026` and
`10/06/2026`. The slash form is **day-first** — these are Indian statements, and guessing wrong
"silently shifts an invoice by months and breaks the ageing".

**Type** (`classifyEntry:64`) matches intent rather than a fixed vocabulary, because brands
write `RCPT`, `Receipt`, `NEFT` and `HDFC` for the same thing. Order matters: opening → credit
note → debit note → discount → payment → invoice. An unrecognised label falls back on the sign
— negative becomes `ADJUSTMENT`, positive becomes `INVOICE`.

**Direction** is a stored column, not derived from the type (`schema.prisma:2594-2596`):

> Stored rather than derived from `type` because brands occasionally post a credit on a sales
> voucher, and the running balance depends on the sign rather than the label.

`+1` increases what BCH owes (invoice, debit note, opening); `−1` decreases it
(`directionForType:81`). The API lets a caller override the sign for exactly that case
(`entries/route.ts:37`).

### Act 3 — the numbers are checked against themselves

`GET /api/ledger/vendors/[id]` assembles both sides and compares them **per request**. The
route writes nothing (`vendors/[id]/route.ts:19-23`) — matching is recomputed every time so it
always reflects the current state of Accounts, and a match is only persisted when a human
confirms it.

1. **Running balance** (`runningBalance:104`, called at `route.ts:89`) — walks the rows from
   `vendor.openingBalance`.
2. **The tie-out check** (`checkBalance:122`, called at `route.ts:90`) — the most valuable
   check in the whole module:

   > If a brand's own rows do not add up to their own stated closing, the statement is wrong —
   > and that is a finding worth more than any individual row.

   Tolerance is **₹1** (`TIE_TOLERANCE:102`) — a statement that ties to within a rupee has
   tied. **This check is currently inert**, because `claimedClosing` only ever arrives with an
   imported statement, and there are none. It compares against `null` and reports
   `tiesOut: false`.

### Act 4 — their rows are matched to our books

`matchEntries:183`, called at `route.ts:92`. Our side is assembled first: every `VendorBill`,
`VendorPayment` and `VendorCredit` for that vendor, normalised into one `BookRecord[]`
(`route.ts:55-78`).

Two passes, deliberately in this order:

1. **Reference first** — a normalised ref of 6+ characters (non-alphanumerics stripped, folded
   to lowercase) with amounts within ₹0.01. "A UTR is far stronger evidence than a date
   proximity."
2. **Amount + nearest date** for what is left, capped at **30 days** (`MAX_DAY_GAP:170`):
   "statements post a payment days after the bank does; beyond this it is probably a different
   one."

Each book record is consumed by **at most one** entry, and anything unplaceable is returned
with `confidence: "none"` rather than force-fitted — "an unmatched row is a question for a
human, not a conclusion."

Then `unclaimedBooks:245` (called at `route.ts:99`) inverts it: **things we hold that never
appeared on their statement.** The route's own comment calls this "the most valuable output".

### Act 5 — the safeguard against crying wolf

`assessCoverage:269`, called at `route.ts:131` and again on the list page at
`vendors/route.ts:72`. Before anything is called a discrepancy, it compares volumes:

> If their statement lists 26 receipts and our books hold 3 payments, the problem is almost
> certainly our record-keeping, not their honesty — and reporting 23 discrepancies would be
> noise that trains people to ignore the tool.

| Level | Condition | Message shown |
|---|---|---|
| `empty` | we have 0, they have some | "Differences below are almost certainly gaps in our records, not theirs." |
| `good` | ours/theirs ≥ 0.85 | "Our records look complete for this vendor." |
| `partial` | ≥ 0.5 | "some of ours may be missing" |
| `sparse` | < 0.5 | "Treat unmatched rows as our gap until Accounts is caught up." |

The list page colour-codes every vendor by this level (`ledger/page.tsx:35-41`), so the screen
opens by telling you how much to trust itself.

### Act 6 — a human says *why* it did not match

`PUT /api/ledger/entries/[id]/review`, guarded by `brand_ledger.edit`. This is the pivot of the
whole design, and its comment says it best:

> The matcher can say "no match found"; only a person can say WHY. `THEY_MISSING` ("we paid,
> they haven't posted it") is a claim against the brand; `WE_MISSING` ("it's on their
> statement, not in our books") is a gap in our own record-keeping. Guessing between them
> would either accuse a supplier wrongly or hide a bookkeeping hole, so the system refuses to
> guess.

The full vocabulary is `LedgerMatchStatus` (`schema.prisma:2510-2518`): `UNMATCHED`,
`MATCHED`, `NEEDS_REVIEW`, `THEY_MISSING`, `WE_MISSING`, `DISPUTED`, `IGNORED`. Note
`NEEDS_REVIEW` deliberately does **not** mean "discrepancy".

The route also refuses to link across vendors (`review/route.ts:31-51`): every `billId`,
`paymentId`, `creditId` and `gapId` is checked to belong to the same vendor, because a mistyped
id "could attach one supplier's payment to another's statement row and silently corrupt both".

And deletion is asymmetric (`entries/route.ts:67-72`): a hand-entered `MANUAL` row can be
deleted; an imported one cannot —

> "This row came from an imported statement and cannot be deleted. Mark it IGNORED instead —
> the brand's record stays intact."

### Act 7 — the difference becomes a claim

`LedgerGap` is described in the schema as "the claim register — the heart of the tool". One row
per unresolved money claim, numbered per vendor (#1, #2 …) continuing the register that existed
before the app (`vendors/[id]/gaps/route.ts:58-68`).

Three fields carry most of the judgement:

- **`gapType`** — 12 kinds, from `DISCOUNT_PENDING` to `OPERATIONAL_WARRANTY`.
- **`tier`** — how hard the claim can be pressed: `FIRM` (provable in writing), `LEVERAGE`
  (use in negotiation, not provable), `VERIFY` (needs a document first), `CONDITIONAL` (only
  worth raising if contested).
- **`amountNote`** — free text for amounts that are not one number, e.g. "10,300 claimed /
  9,900 itemised". The schema is explicit: "the imprecision is the point; forcing it into a
  Float would invent certainty."

The GET also counts **unevidenced open claims** (`gaps/route.ts:35`):

> A claim you cannot evidence is one you cannot press, and you want to know that before the
> conversation, not during.

Three rules are enforced in code, not documentation:

| Rule | Where | Why |
|---|---|---|
| Closing a claim (`RESOLVED`/`REJECTED`) needs **`approve`**, not `edit` | `gaps/[id]/route.ts:28-34` | "writing off money owed is an approval, not an edit" |
| A claim with evidence or linked rows **cannot be deleted** (409) | `gaps/[id]/route.ts:80-84` | set it `REJECTED` with a reason — "that keeps why it was dropped" |
| Claims are a **separate permission** from the ledger | `rbac-catalog.ts:493-518` | "'they owe us ₹1.3L and we have no written agreement' is not something everyone who can read a statement should see" |

### Act 8 — what the discount *should* have been

`VendorDiscountTerm` is the missing half of the audit. `Vendor.cdPercentage`/`cdTermsDays`
models only a cash discount ("2% within 15 days"); it cannot express "18% on alloy, 20% on
steel, from July 2025, plus ₹150/cycle transport" — and the schema notes that is what the
Hornback and Lucifer disputes are actually about.

`expectedDiscount:330` computes what should have been credited on an invoice from the terms in
force on its date. `CASH` terms are skipped (time-dependent, not a per-invoice entitlement).
Unproven terms still count toward the expectation but are **reported separately** — you may be
owed the money and still be unable to prove the agreement, and that changes the tier.

> An empty `agreedBy`/`evidenceUrl` is itself the signal: the term is unproven.

Terms are **read** at `route.ts:115`. Nothing in `src/` creates one.

---

## 3. Which tables are affected

### Written directly

| Table | When | Where |
|---|---|---|
| `BrandLedgerEntry` | manual add · human review | `entries/route.ts:27` (create) · `:74` (delete, MANUAL only) · `review/route.ts:56` (match status, links, `reviewedAt`) |
| `LedgerGap` | raising / updating / closing a claim | `vendors/[id]/gaps/route.ts:64` · `gaps/[id]/route.ts:38` · `:87` |

**That is the entire write surface of this module — two tables.** By design: the ledger records
a dispute, it does not move money.

### Read but never written

| Table | Role |
|---|---|
| `Vendor` | the subject; `openingBalance` starts the running balance |
| `VendorBill`, `VendorPayment`, `VendorCredit` | **our side** of the reconciliation (`route.ts:55-78`) |
| `BrandStatement` | provenance and `claimedClosing` — read at `route.ts:80`, **never written** |
| `VendorDiscountTerm` | expected-discount computation — read at `route.ts:115`, **never written** |
| `Brand` | labels a row when a vendor supplies several |
| `User` | `createdById` on a claim |

### Declared but completely unused

| Table | Status |
|---|---|
| `BrandStatement` | zero writers |
| `LedgerGapEvidence` | **zero references in `src/`** — no upload route, no read |
| `LedgerGapNote` | read via `include` at `gaps/route.ts:20`; **no route creates one** |
| `VendorDiscountTerm` | read only |

### Affected indirectly — in one direction only

The critical asymmetry: **the brand ledger reads the accounts tables and never writes them.**
Money flows *into* this module and never out.

| Upstream writer | Effect here |
|---|---|
| `api/payments` (manual payment) | a new `VendorPayment` joins our side; a statement row that was `WE_MISSING` may now match |
| `api/bank-statements/[id]/review` (**bank flow**) | same — confirming a bank transaction improves this module's `assessCoverage` and can resolve an unmatched row |
| `api/bills`, the Zoho bill import | new `VendorBill` rows on our side |
| any `VendorCredit` writer | credit notes on our side |

| Downstream reader | What it takes |
|---|---|
| `/ledger` list | per-vendor coverage, open claim count and value (`vendors/route.ts:49-58`) |
| `/ledger/[id]` | the three tabs: Ledger, Claims, Terms (`ledger/[id]/page.tsx:13`) |

```
   supplier's statement (email / PDF / Excel)
            │
            ╳  NO IMPORT EXISTS — the story starts by hand
            │
            ▼
      BrandLedgerEntry ─────────── their side, never edited
            │
            │  matched per request, never stored
            ▼
      matchEntries ◄──── VendorBill + VendorPayment + VendorCredit   ← our side
            │                        ▲                                 (read-only)
            │                        └── written by /accounts, the bank flow, Zoho
            ▼
   unmatched? → a human classifies (THEY_MISSING / WE_MISSING / …)
            │
            ▼
        LedgerGap ──► LedgerGapEvidence (no writer) · LedgerGapNote (no writer)
```

---

## 4. Access control

Two modules, split on purpose (`rbac-catalog.ts:493-518`):

| Module | Route | Actions | Guards |
|---|---|---|---|
| `brand_ledger` | `/ledger` | view, create, edit, delete | list, detail, entry add/delete, review |
| `brand_ledger_gaps` | *(none — lives inside a vendor's ledger)* | view, create, edit, delete, **approve** | the claim register; `approve` closes a claim |

The detail route checks the second permission separately and returns `gaps: []` with
`canSeeGaps: false` when it fails (`route.ts:103-113`), so the Claims tab simply does not
render. That is the correct pattern — the API decides, the client only hides.

---

## 5. What is built and what is not

| Piece | Status |
|---|---|
| Schema (5 models, 8 enums) | ✅ complete and unusually well reasoned |
| RBAC modules | ✅ seeded |
| Reconciliation engine (`reconcile.ts`) | ✅ complete, pure, deterministic |
| Read API + list/detail screens | ✅ working |
| Manual entry, human review, claim CRUD | ✅ working |
| **Statement import (CSV / XLSX / PDF)** | ❌ **does not exist** — no screen, no route, no writer |
| **Evidence upload** | ❌ `LedgerGapEvidence` has zero references in `src/` |
| **Claim notes** | ❌ read-only; no route creates one |
| **Discount term CRUD** | ❌ read-only |
| Migration of the existing 219-gap register | ❌ not done |

The plan file records the same:
`docs/implementation/pending/ledger-merge-plan.md:3` — *"schema, RBAC, backend and frontend
shipped; PDF statement import and the 219-gap migration remain."* Its decision **D6** is the
reason for the order: "CSV/XLSX import first, PDF second — PDF extraction is net-new with real
accuracy risk; prove the ledger first."

**The practical consequence:** every safeguard that depends on an imported statement is
currently dormant. `tiesOut` is always false. `claimedClosing` is always null. The balance
check compares against nothing. `LedgerEntrySource.BCH_BOOKS` is declared and never used.

---

## 6. The comparison that matters

Both modules answer the same question. They answer it in opposite styles, and the contrast is
the most useful thing in these two documents.

| | **Brand ledger** | **Bank statement** |
|---|---|---|
| Extraction | none built | AI, two hardcoded prompts |
| Parsing rules | pure, deterministic, testable (`reconcile.ts`) | delegated to the model |
| Matching | explicit two-pass, ref-then-date, 30-day cap | one prompt, "match by name / amount / reference" |
| Confidence | `exact` / `likely` / `none` from stated rules | a float the model chooses |
| Balance tie-out | **yes** — the core check | **none** |
| Volume safeguard | **yes** — `assessCoverage` | none |
| Unmatched row | a question for a human, never a conclusion | `MATCHED` if the AI liked it |
| Writes to the books | **never** | creates payments and expenses |
| Provenance | `BrandStatement` with the source file | file name only; original discarded |

Neither is wrong for its job — the bank flow has to move money, the ledger has to build a case.
But the deterministic engine already written in `reconcile.ts` is exactly what the bank flow
lacks, and the AI extraction already working in the bank flow is exactly what the ledger lacks.
Each module has the half the other is missing.

---

## 7. CLAUDE.md compliance

| Rule | Status |
|---|---|
| Use `apiFetch` / `apiTry` in the browser | ❌ raw `fetch().then(r => r.json())` at `ledger/page.tsx:50`, `ledger/[id]/page.tsx:94`, `:107`, `ledger/[id]/gaps/new/page.tsx:56` |
| Logging is mandatory | ❌ **no `createLogger` anywhere** in `api/ledger/*` or `lib/brand-ledger/*` |
| Every `catch` logs | ❌ every route ends in `catch (error) { … errorResponse(…) }` with no log |
| Permission checks, never role names | ✅ clean throughout — `requireFeature` and `userCan` only |
| Frontend checks are cosmetic; the API re-checks | ✅ `canSeeGaps` is computed server-side |

---

## 8. Open questions

1. **Build the import next?** It is the one missing link, and everything downstream of it is
   already written and waiting.
2. **Reuse the bank flow's AI extraction for it?** Same problem shape, and `pdf-parser.ts`
   already does base64 `document` blocks properly. If yes, `BrandStatement.extractionModel` and
   `extractionNote` exist to record what was returned, and the tie-out check must **block the
   import** on a mismatch rather than warn.
3. **Fix the empty state now**, regardless — `ledger/page.tsx:101` currently instructs the user
   to use a feature that does not exist.
4. **Evidence upload** — without it, `tier: FIRM` ("provable in writing") cannot be
   substantiated inside the app, which undercuts the register's main purpose.
