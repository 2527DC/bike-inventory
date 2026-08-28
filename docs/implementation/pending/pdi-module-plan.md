# PDI module — per-unit bicycle readiness tracking

Status: pending — nothing built, no schema changed. Two blocking questions (Q11, Q17)
**Origin:** `F:\bharath  Cycle\BUILDLINE-MERGE-UNDERSTANDING.md` — the analysis of the
standalone `Buildline` app that led to this. Read §0.1 of that document for how the decisions
below were reached.
**Prerequisites:**
1. `npm run build` green on `feat/storage-settings` before phase 1 starts — this plan depends
   on `src/lib/storage/`, which lands on that branch.
2. **A decision on Q17** — `serialCode` allocation collides with
   `pending/sequence-race-fix-plan.md`. See §2.5. This gates phase 2, not phase 1.

---

## 0. Decisions taken

These override anything below that contradicts them.

| # | Decision | Rationale |
|---|---|---|
| **D1** | **Requirement-driven, not a port.** Buildline is a reference design; ~80% of it is discarded. | BCH already does receiving, auth, storage and locations better. Porting feature-by-feature would import weaknesses back into BCH. |
| **D2** | **Activate `SerialItem`** as the unit. No parallel unit table. | It already exists, is wired to `Product`/`Bin`/transfers, and has never had a row created in it. |
| **D3** | **Enforce readiness by withholding sellability, not by blocking a bill.** | Invoicing is in Zoho; BCH cannot block it. ⚠️ **The stated mechanism does not exist — see §2.1 and Q11.** |
| **D4** | **Every incoming bicycle is tracked.** | One rule, no per-line judgement at inbound. |
| **D5** | **No QC stage.** The 3-item checklist is the quality control. | Buildline's own author deleted QC in migration `011`. |
| **D6** | **Shared pull queue.** No assignment stage. | Matches how `/services/assembly` already behaves. |
| **D7** | **Named PDI** — `PdiUnit`, module `pdi`, `/pdi`. | `assembly` is taken by the workshop piecework module (`AssemblyLog`, `service_assembly`). |

### Carried-in defaults (from the analysis §8; overrule here if wrong)

| # | Default | Rationale |
|---|---|---|
| **D8** | **No `Location` table.** PDI uses `Bin` only. | The three-way location muddle (`Bin.location` string vs `StockLocation` enum vs a would-be table) is pre-existing debt owned by `store-hierarchy-and-team-plan.md`. Coupling it here doubles scope. |
| **D9** | **PDI gets its own audit table** (`PdiEvent`), not `OpsActivityLog`. | Same call the service merge made. A transition has typed fields (from-state, to-state, unit, technician, bin) that a generic log flattens into untyped JSON — and the bottleneck report queries exactly those fields. |
| **D10** | **Bins: suggest-then-confirm**, never silent auto-move. | Keeps the useful half of Buildline's auto-assign (find a free slot in the right zone) without asserting a physical movement nobody made. |

---

## 1. What this is

Give BCH the ability to answer: **"is *this specific bicycle* ready to sell?"**

Today BCH tracks quantities (`StockLevel`, `Product.currentStock`) and shipments
(`InboundShipment` → `InboundLineItem`) but has no per-unit row between *"12 units delivered"*
and *"a customer walks out with one"*. Bicycles arrive ~50% assembled; nothing records which
individual bikes have been finished.

**In scope:** minting units at inbound, a technician queue and checklist, a supervisor board,
bin occupancy and zones, throughput/bottleneck stats.

**Out of scope:** QC (D5), a locations table (D8), any Buildline UI or backend code, the
Buildline inward forms, Buildline's photo pipeline.

### Size estimate

| | Count | Notes |
|---|---:|---|
| Prisma models added | 2 | `PdiUnit`, `PdiEvent` |
| Prisma enums added | 2 | `PdiState`, `PdiZone` |
| Existing models changed | 2 | `SerialItem` (+2 fields), `Bin` (+2 fields) |
| API routes new | ~10 | under `/api/pdi/*` + one on `/api/inbound` |
| Existing routes touched | ~7 | every `serialItem` mutation site — see §2.2 |
| Screens new | 2 | `/pdi` board, `/pdi/queue` |
| Screens extended | 3 | `/scanner`, `/stock/[id]`, `/more/bins` |
| RBAC modules added | 1 | `pdi` |

---

## 2. Findings that shape this plan

### 2.1 ⚠️ D3 cannot be implemented as stated — there is no stock push to gate

D3 was decided as *"an un-built unit is never pushed to Zoho as sellable stock."* **That push
does not exist.**

Verified across the whole source tree:

- Every reference to `stock_on_hand` is a **read** — `zoho/import/items/route.ts:83`,
  `zoho/trigger-pull/route.ts:101,131,150,179`, `zoho/import/clean/route.ts:37,86`.
- BCH writes to Zoho in exactly **five** places:
  `books.ts` → `POST /items`, `POST /contacts`, `POST /invoices`, `POST /bills`;
  `inventory.ts` → `POST /items`;
  plus `stock/price-check/[productId]/route.ts:78` → `PUT /items/{id}` (price only).
- `ZakyaConfig` exists as a model, but `src/lib/integrations/zakya.ts` defines **no methods**
  and there are **no `/api/zakya` routes**. It is dead configuration, not a POS integration.

Stock flows **Zoho → BCH**. For a new bicycle the Zoho item already exists — it arrived via the
brand's bill — so BCH has no lever over whether it can be sold.

**This does not block the module.** Phases 1–5 deliver the tracking, the queue, the board and
the stats regardless. Only the *enforcement* is affected, and it is isolated in phase 6.
**Q11 must be answered before phase 6 is scoped.** Options are in §9.

### 2.2 Activating `SerialItem` makes a dormant model load-bearing

`SerialItem` has never had a row created in it — there is no `serialItem.create` or
`createMany` anywhere in `src/`. Every existing site only *updates*, *reads* or *deletes*. The
moment D4 starts minting rows, code that has only ever run against an empty table starts
running against a populated one.

**Every one of these must be re-read and re-tested before phase 2 ships**, per `CLAUDE.md`
(*"Check every file that uses the code you changed"*):

| File | Line | What it does today |
|---|---|---|
| `src/app/api/transfers/route.ts` | 112 | `updateMany` on transfer |
| `src/app/api/transfers/[id]/approve/route.ts` | 59 | `updateMany` on approve |
| `src/app/api/transfer-orders/route.ts` | 188 | `updateMany` |
| `src/app/api/transfer-orders/[id]/approve/route.ts` | 79 | `updateMany` |
| `src/app/api/inventory/outwards/route.ts` | 98 | `updateMany` — marks sold |
| `src/app/api/serials/[id]/route.ts` | 67 | single `update` |
| `src/app/api/bins/[id]/route.ts` | 42 | blocks bin delete if `serialItems > 0` |
| `src/app/api/zoho/import/clean/route.ts` | 43 | `deleteMany({})` — **wipes all serials** |

**`zoho/import/clean` is the dangerous one.** It currently deletes every `SerialItem` as part
of a clean re-import. Once units exist, that route silently destroys PDI history. It must
either refuse to run when `PdiUnit` rows exist, or be made to cascade deliberately with a
confirmation. **This is a data-loss bug waiting to happen and is tracked as risk R1.**

### 2.3 D6 introduces a concurrency hazard Buildline never had

Under Buildline's supervisor-assignment model only one technician could ever hold a unit. With
a shared pull queue (D6), two technicians tapping "start" at the same moment can both claim the
same bicycle.

The claim must be a **conditional update inside a transaction**:

```ts
const claimed = await prisma.pdiUnit.updateMany({
  where: { id, state: "RECEIVED", technicianId: null },
  data:  { state: "IN_PROGRESS", technicianId: user.id, startedAt: new Date() },
});
if (claimed.count === 0) return errorResponse("Already started by someone else", 409);
```

This is the same class of bug the `TokenCounter` model already carries a warning about
(*"a concurrent read-then-write hands two jobs the same token"*). Never read-then-write.

### 2.4 The state machine collapses from six stages to four

D5 removes `completed` and `qc_review`; D6 removes `assigned`. Of Buildline's six stages, two
were already dead before this plan started.

```
RECEIVED ──claim──> IN_PROGRESS ──complete──> READY
                         │  ▲
                      pause  resume
                         ▼  │
                       PAUSED
```

`READY` is terminal for PDI. What happens next is Q11.

### 2.5 Minting `serialCode` is a sixth instance of the sequence race — do not reinvent it

`SerialItem.serialCode` is documented as `{SKU}-{sequence}` — e.g. `HRO-MTB26-0001`. Allocating
that sequence by reading the highest existing value and adding one is **exactly** the bug
`docs/implementation/pending/sequence-race-fix-plan.md` was written about. That plan documents
five sites with this defect (`shipmentNo` ×2, `orderNo`, `countNo`, `issueNo`) and proposes a
single counter table behind a `nextSequence(tx, prefix)` helper.

Minting under D4 creates **N units in one go** from a shipment, which is the worst possible
shape for a read-then-write allocator — a whole batch collides, not just two concurrent
requests.

**This plan must not hand-roll sequence allocation.** Two ways forward, and this needs deciding
(Q17):

- **Land `nextSequence()` first**, as part of that plan or as a prerequisite here, and call it.
- **Sidestep sequences entirely** — if `serialCode` does not have to be human-readable, a cuid
  or a `{SKU}-{cuid-suffix}` avoids the allocator altogether. Barcodes are scanned, not typed.
  This is cheaper, but loses the readable ordering that `{SKU}-0001` gives a person holding
  a label.

Either way the allocation happens **inside** the minting transaction, never before it.

### 2.6 D4 makes barcode labelling an operational dependency

Every bicycle needs a scannable code at receipt, or the queue cannot be worked. This is a
**shop-floor process change, not just code** — someone must physically label bikes as they come
off the truck. `/api/barcode`, `src/lib/barcode.ts`, `src/lib/label-template.ts` and
`SerialItem.barcodeData` / `barcodeFormat` already exist to serve this, but the human step is
new. Flagged as risk R4.

---

## 3. Schema changes

### 3.1 New enums

```prisma
enum PdiState {
  RECEIVED     // minted at inbound delivery, nobody has started it
  IN_PROGRESS  // a technician has claimed it
  READY        // checklist complete — sellable
  PAUSED       // blocked; see pauseReason
}

// Which workflow stage a bin holds. Deliberately three, not Buildline's five —
// D5 removes the QC and completion zones.
enum PdiZone {
  INWARD
  ASSEMBLY
  READY
}
```

### 3.2 New models

```prisma
// One row per physical bicycle being prepared for sale. Hangs off SerialItem, which
// is the unit of identity (D2) — PdiUnit carries only the workflow state, so that
// stock concerns and build concerns stay separable.
model PdiUnit {
  id           String     @id @default(cuid())
  serialItemId String     @unique
  serialItem   SerialItem @relation(fields: [serialItemId], references: [id], onDelete: Cascade)

  state    PdiState @default(RECEIVED)
  priority Boolean  @default(false)

  // The 3-item checklist. Explicit columns rather than JSON so the board can filter
  // and the bottleneck report can aggregate without JSON path queries. See Q12.
  checkTyres  Boolean @default(false)
  checkBrakes Boolean @default(false)
  checkGears  Boolean @default(false)

  // NULL until a technician claims it (D6 — no assignment stage). Written on claim,
  // never before. See §2.3 for the concurrency requirement.
  technicianId String?
  technician   User?   @relation("PdiTechnician", fields: [technicianId], references: [id])

  // Provenance: which delivery minted this unit. The only way units are created.
  shipmentId String?
  shipment   InboundShipment? @relation(fields: [shipmentId], references: [id])

  receivedAt DateTime  @default(now())
  startedAt  DateTime?
  readyAt    DateTime?

  pausedAt    DateTime?
  pauseReason String?

  notes     String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  events PdiEvent[]

  @@index([state])
  @@index([technicianId])
  @@index([shipmentId])
  @@index([state, priority])   // the queue query: open work, priority first
  @@map("pdi_units")
}

// Typed audit trail (D9). Kept out of OpsActivityLog because the bottleneck report
// queries fromState/toState/createdAt directly, which untyped JSON would not serve.
model PdiEvent {
  id     String  @id @default(cuid())
  unitId String
  unit   PdiUnit @relation(fields: [unitId], references: [id], onDelete: Cascade)

  fromState PdiState?
  toState   PdiState
  fromBinId String?
  toBinId   String?

  actorId String
  actor   User   @relation("PdiEventActor", fields: [actorId], references: [id])

  reason    String?
  createdAt DateTime @default(now())

  @@index([unitId])
  @@index([createdAt])
  @@map("pdi_events")
}
```

### 3.3 Changes to existing models

```prisma
model SerialItem {
  // ... existing fields unchanged ...
  frameNumber String?   // manufacturer's frame/chassis number — legally significant
                        // for a bicycle, and absent from BCH today
  pdiUnit     PdiUnit?
}

model Bin {
  // ... existing fields unchanged ...
  currentOccupancy Int      @default(0)  // maintained in app code, never a trigger
  pdiZone          PdiZone?              // NULL = not a PDI zone; ordinary stock bin
}

model User {
  // ... existing relations ...
  pdiUnits  PdiUnit[]  @relation("PdiTechnician")
  pdiEvents PdiEvent[] @relation("PdiEventActor")
}

model InboundShipment {
  // ... existing relations ...
  pdiUnits PdiUnit[]
}
```

### 3.4 Deliberate departures from Buildline

| Buildline | Here | Why |
|---|---|---|
| `model_sku TEXT` free text | `SerialItem.productId` FK | Unlocks brand, category, cost, GST, reorder for free |
| `checklist JSONB` + CHECK constraint | three `Boolean` columns | Queryable without JSON paths; no constraint gymnastics. See Q12 |
| 6 row triggers | explicit transaction code | BCH has zero DB triggers; app code is visible, testable, loggable |
| `current_occupancy` maintained by trigger | maintained in app code | Same. Buildline's version also increments *before* checking capacity |
| `UNIQUE(location_id, bin_code)` | `Bin.code` stays globally unique | Not changing it — relied on by four existing bin pickers. See Q13 |
| `damage_reported` / `parts_missing` booleans | creates a `VendorIssue` | Damage on arrival is a commercial claim against the brand, already modelled |
| 5 zones | 3 (`PdiZone`) | D5 removes QC and completion zones |
| `qc_*` columns, `qc_checklists` | none | D5 |
| `assigned` stage, `supervisor_id` | none | D6 |

**Schema review required.** This repo has a `schema-reviewer` agent and a schema-review hook
(commit `e454b36`). Run it on the `PdiUnit`/`PdiEvent`/`Bin`/`SerialItem` diff before migrating.

---

## 4. RBAC

New module in `prisma/rbac-catalog.ts` — **seed input only, never imported from `src/`**.

```ts
{
  key: "pdi",
  name: "PDI",
  description: "Per-unit bicycle readiness — queue, checklist, board.",
  route: "/pdi",
  actions: ["view", "create", "edit", "approve", "delete"],
}
```

| Action | Grants |
|---|---|
| `view` | See the board, the queue, unit detail, stats |
| `create` | Mint units from a delivered shipment |
| `edit` | Claim a unit, tick the checklist, complete, pause, move bin |
| `approve` | Set priority, force-complete, reassign a stuck unit, override state |
| `delete` | Void a unit minted in error |

**Default grants** (added to the existing roles in `prisma/rbac-catalog.ts` — **no new roles**):

| Role | Grant |
|---|---|
| `SERVICE_MECHANIC` | `view`, `edit` |
| `SERVICE_SUPERVISOR` | `view`, `create`, `edit`, `approve` |
| `SERVICE_MANAGER` | full |
| `SERVICE_VIEWER` | `view` |

Minting is also reachable from `/inbound`, which is gated by `inbound.approve`. **A user needs
both** `inbound.approve` and `pdi.create` to mint — checked explicitly, not inferred.

**Non-negotiable, per `CLAUDE.md`:** no role-name comparisons, no allow-lists in guards,
`requireFeature(module, action)` takes exactly two arguments, and the API re-checks everything
the UI hides.

---

## 5. Route map

All under `src/app/api/pdi/`, following BCH conventions: `requireFeature`, zod schemas from
`src/lib/validations.ts`, `successResponse`/`errorResponse` from `src/lib/api-utils.ts`,
`createLogger("pdi:<area>")`, and every `catch` logs before it returns.

| Method | Route | Permission | Purpose |
|---|---|---|---|
| `POST` | `/api/inbound/[id]/mint-pdi` | `inbound.approve` + `pdi.create` | Mint units for `BICYCLE` line items on a delivered shipment |
| `GET` | `/api/pdi` | `pdi.view` | Board — filter by state, zone, technician, priority |
| `GET` | `/api/pdi/queue` | `pdi.view` | Open work, priority first — the technician's list |
| `GET` | `/api/pdi/scan/[code]` | `pdi.view` | Resolve a barcode to a unit + its next action |
| `POST` | `/api/pdi/[id]/claim` | `pdi.edit` | `RECEIVED` → `IN_PROGRESS`. **Conditional update — §2.3** |
| `PATCH` | `/api/pdi/[id]/checklist` | `pdi.edit` | Tick/untick an item |
| `POST` | `/api/pdi/[id]/complete` | `pdi.edit` | `IN_PROGRESS` → `READY`. Rejects unless all three ticked |
| `POST` | `/api/pdi/[id]/pause` | `pdi.edit` | → `PAUSED` with a reason; and resume |
| `POST` | `/api/pdi/[id]/bin` | `pdi.edit` | Move to a bin; adjusts occupancy in the same transaction |
| `POST` | `/api/pdi/[id]/issue` | `pdi.edit` | Creates a **`VendorIssue`**, not a boolean |
| `POST` | `/api/pdi/[id]/priority` | `pdi.approve` | Flag/unflag |
| `DELETE` | `/api/pdi/[id]` | `pdi.delete` | Void a mistaken unit |
| `GET` | `/api/pdi/stats` | `pdi.view` | Daily counts, stuck >24h, bottleneck by state |

**Not built** (BCH already has these, or D-decisions removed them): locations CRUD, technicians
CRUD, inward forms, photo upload, anything QC, assignment.

**No cron, no `setInterval`, no polling.** Stuck->24h is computed on load. Per `CLAUDE.md`.

---

## 6. Screens

### New

| Route | For | Contents |
|---|---|---|
| `/pdi` | supervisor | Board by state, priority flags, stuck highlight, zone occupancy summary |
| `/pdi/queue` | technician | Mobile-first. Scan-to-act, big-target 3-item checklist, one-tap complete |

### Extended

| Existing | Change |
|---|---|
| `/inbound/[id]` | After "delivered", a **Mint PDI units** action; shows units already minted |
| `/scanner` | Scanning a bicycle barcode resolves to build state and the next action, not just stock |
| `/stock/[id]` | The Serial Items panel — currently always empty — shows real units with PDI state |
| `/more/bins` | Occupancy and `pdiZone` columns; zone utilisation |

Design system: **BCH OPS, not Buildline's.** The service merge's known follow-up
(*ported screens "still carry the old styling rather than the BCH OPS design system"*) is not
to be repeated. Nothing from `Buildline/frontend/src/components/` is copied as a file — only
four interaction ideas survive: scan-to-act, the three-tap checklist, the state board, and the
zone occupancy view.

Reuse the client-side image compressor already in
`src/app/(dashboard)/services/assembly/page.tsx` (canvas → 1200px → JPEG 0.85) if photos are
attached to issues.

---

## 7. Phases

Each phase ends with `npm run build` green and the screen opened in a browser, per `AGENTS.md`.

| # | Phase | Delivers | Depends on |
|---|---|---|---|
| **1** | Schema + RBAC | Models, enums, `Bin`/`SerialItem` fields, `pdi` module seeded, permissions visible in `/roles` | — |
| **2** | Minting | `POST /api/inbound/[id]/mint-pdi`, the `/inbound/[id]` action, **plus the §2.2 regression sweep over all 8 `SerialItem` sites** | 1, **Q17** |
| **3** | Technician flow | `/pdi/queue`, claim / checklist / complete / pause, `/scanner` extension | 2 |
| **4** | Board + stats | `/pdi`, `/api/pdi/stats`, stuck >24h, bottleneck | 3 |
| **5** | Bins | Occupancy in app code, `pdiZone`, suggest-then-confirm move (D10), `/more/bins` extension | 3 |
| **6** | **The gate** | ⚠️ **Not scoped.** Blocked on Q11 | 4, Q11 |

**Phase 2 is the risky one** — not because minting is hard, but because of the regression sweep.
Budget for it properly.

Phases 1–5 are independently useful: they deliver visibility, throughput reporting and bin
utilisation even if Q11 concludes that no hard gate is reachable.

---

## 8. Risks

| # | Risk | Mitigation |
|---|---|---|
| **R1** | **`zoho/import/clean` `deleteMany`s all serials** (§2.2) — silently destroys PDI history | Make it refuse while `PdiUnit` rows exist, or cascade deliberately behind a confirmation. **Fix in phase 1, before any unit exists.** |
| **R2** | Two technicians claim the same unit (§2.3) | Conditional `updateMany` in a transaction; assert `count === 1`; return 409 otherwise |
| **R3** | Activating `SerialItem` regresses transfers / outwards / stock-audit (§2.2) | The phase-2 sweep. Eight named files. Test each with rows present |
| **R4** | Barcode labelling is a shop-floor process change (§2.5) | Confirm with the team *before* phase 2. If bikes are not labelled at receipt, the queue is unworkable and D4 needs revisiting |
| **R5** | Row volume — every bicycle now gets two rows (`SerialItem` + `PdiUnit`) | Indexes in §3.2 are sized for the queue and board queries. Revisit if volume is much larger than expected (Q14) |
| **R6** | Bin occupancy drifts from reality | Counter is app-maintained inside the same transaction as the move; add a reconcile query to `/more/bins`. Never trust it as the sole truth for a physical count |
| **R7** | The gate turns out unreachable (§2.1) | Phases 1–5 stand alone. Q11 answered before phase 6 is scoped |
| **R8** | `prisma generate` fails `EPERM` with the dev server running; `npm run build` needs a live DB | Known environment gotchas — stop the dev server; start Postgres. See `CLAUDE.md` |
| **R9** | **Batch minting collides on `serialCode`** (§2.5) — a read-then-write allocator fails hardest on exactly this shape | Use `nextSequence(tx, prefix)` from `sequence-race-fix-plan.md`, or drop readable sequences entirely. Decide via Q17 **before** phase 2 |

---

## 9. Open questions

### ⚠️ Q11 — What is the readiness gate, given §2.1? **Blocks phase 6.**

D3 assumed a stock push that does not exist. What is actually reachable:

| Option | Mechanism | Enforceable? | Cost |
|---|---|---|---|
| **A. Advisory** | Scan at the counter; screen says NOT READY | ❌ no — human can ignore | Small. One screen |
| **B. Item active/inactive in Zoho** | `PUT /items/{id}` — proven to work (`price-check:78`). Mark a SKU inactive while **no** unit of it is ready | ⚠️ partially | Medium. **Granularity mismatch:** Zoho items are per-SKU, PDI is per-unit. If 12 arrive and 3 are built, the item cannot be "partly active". Only meaningful for a genuinely new model; useless for a SKU already selling |
| **C. Zoho inventory adjustment** | Push a negative adjustment holding un-built units out of sellable stock, reverse when ready | ✅ yes | **High.** New sync surface, and it fights the existing Zoho → BCH pull. Two writers on one quantity |
| **D. No gate** | Track for visibility, throughput and bottleneck only | n/a | Zero |

**My read:** B is the only option that is both enforceable and affordable, and it only works
for SKUs not already on sale. If most arrivals are restocks of existing models, B buys little
and the honest answer is **A + D** — accept that PDI is a visibility and throughput tool, not
a hard lock. That is still worth building; it is just a different promise.

**This needs your answer, and it may be worth a conversation with whoever raises invoices.**

### Q12 — Checklist: three fixed columns, or configurable?

§3.2 proposes `checkTyres` / `checkBrakes` / `checkGears` as columns. Simple and queryable, but
adding a fourth item later is a migration. Buildline used JSON with a CHECK constraint and
documented changing it in three places. **Is the 3-item list stable, or will it change per
brand / bike type?** If it will change, this becomes a `PdiChecklistItem` table and the plan
grows a small amount in phase 1 — much cheaper now than later.

### Q13 — Bin codes: leave globally unique?

§3.4 keeps `Bin.code @unique` as-is because four existing pickers rely on it. Buildline scoped
uniqueness per location so two warehouses can both have `A1-01`. **Do BCH and BCC use
overlapping rack labels?** If yes, this constraint is already wrong and should be fixed here
rather than worked around.

### Q14 — Roughly how many bicycles arrive per month?

Sizes R5 and confirms the indexes. A few hundred is nothing; several thousand a month changes
how the board query should paginate.

### Q15 — Is Buildline running in production with real data?

*(Carried from the analysis, Q10 — still unanswered.)* If there are live journeys in that
Supabase project, this becomes a build **plus** a migration, and barcodes already issued must
survive into `SerialItem.serialCode`. If it is a prototype, it can be abandoned in place and
this plan is unaffected. **Answer before phase 1** — it changes the schema's identity strategy.

### Q16 — Where does a `READY` unit go in the sidebar?

`/pdi` under which nav group — Inventory, Service, or its own entry? Affects
`src/lib/nav-config.ts` and `src/lib/module-icons.ts` only, but worth deciding before phase 4
so the board is discoverable.

### ⚠️ Q17 — `serialCode` allocation: use `nextSequence()`, or drop readable sequences? **Gates phase 2.**

§2.5. Minting N units at once is the worst shape for the read-then-write allocator that
`pending/sequence-race-fix-plan.md` already documents at five other sites.

- **(a)** Land that plan's `nextSequence(tx, prefix)` helper first and call it — correct, and
  fixes five existing bugs on the way. Larger critical path.
- **(b)** Make `serialCode` a cuid or `{SKU}-{cuid-suffix}` and skip sequences entirely —
  cheapest, no allocator, but loses readable ordering on a printed label.

**Does anyone read a serial code off a label and act on it, or is it only ever scanned?** That
answers this. If only scanned, take (b).

---

## 10. Verification

Per `AGENTS.md`, after every phase:

```bash
npm run build          # must pass; needs a reachable DATABASE_URL
```

Plus, specific to this module:

- **Phase 1** — `pdi` module and its five permissions appear in `/roles`; the schema-reviewer
  agent has run on the diff; `zoho/import/clean` is guarded (R1).
- **Phase 2** — mint from a test shipment; then exercise **all eight** `SerialItem` sites from
  §2.2 with rows present. Transfers, outwards and bin-delete are the ones most likely to break.
- **Phase 3** — two browsers claim the same unit simultaneously; exactly one wins, the other
  gets a 409 (R2).
- **Phase 4** — a unit left in `IN_PROGRESS` over 24h shows as stuck without any cron.
- **Phase 5** — move a unit between bins; occupancy on both bins is correct; a reconcile query
  agrees with the row count (R6).

**Board of agents to consult before marking done**, per `CLAUDE.md`:
`docs/agents/warehouse-consultant.md` (bins, inbound receiving),
`docs/agents/database-architect.md` (schema, indexes, transactions),
`docs/agents/backend-engineer.md` (route handlers, zod, status transitions),
`docs/agents/frontend-engineer.md` (mobile layout for `/pdi/queue`),
`docs/agents/integration-architect.md` (Q11, if the gate proceeds).

---

## 11. What is explicitly not being built

For the record, so it is not re-litigated later:

| Not built | Because |
|---|---|
| QC stage, `qc_checklists`, rework routing | D5 — Buildline's author deleted it in migration `011` |
| Assignment stage, supervisor assign screen | D6 — shared pull queue |
| A `Location` table | D8 — belongs to `store-hierarchy-and-team-plan.md` |
| PDI inward forms | `InboundShipment` is far stronger; a second receiving path would bypass the vendor bill |
| Locations CRUD, technicians CRUD | `/team`, `/roles` already do this correctly |
| PDI photo upload pipeline | `src/lib/storage/` + `/api/media/presign` already exist |
| `damage_reported` / `parts_missing` flags | Becomes a `VendorIssue` — a real commercial claim |
| Any Buildline `.jsx`, Express route or SQL view | D1 — reference design, not a source tree |
