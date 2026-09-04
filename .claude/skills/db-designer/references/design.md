# Design mode — a new model

## The order of work

1. **Find the nouns.** Write the feature down in the business's own words, then underline
   every noun. Each distinct noun with its own identity and lifecycle is a candidate table.
   Nouns that only describe another noun are columns.
2. **Check it does not already exist.** `grep '^model ' prisma/schema.prisma`. This schema
   has 92 models and duplicates have happened — one `Customer`, one `User`, one
   `IntegrationConfig`. Extending an existing model usually beats adding a neighbour.
3. **Ask the 2–3 questions that change the shape** (below). Not more.
4. **Normalise to 3NF, then stop.** Every non-key column depends on the key, the whole key,
   and nothing but the key. Denormalise only where a business rule needs it, and when you do,
   say in a schema comment why, and where the value is kept in step.
5. **Write constraints before you write columns.** What must never be true? Each answer is a
   `@unique`, an enum, a NOT NULL, or an `onDelete`.
6. **Plan the indexes from the queries**, not from intuition. Name the actual `where` and
   `orderBy` you expect.
7. **Then write the Prisma model.**

## The intake questions

Ask only the ones whose answers would change the schema. Determine the rest by reading code.

**Identity and lifecycle**
- What uniquely identifies one of these in the business? (a bill number, a phone, a token) —
  if there is a natural business key, it needs a `@unique` even though the PK is a `cuid()`.
- What states does it move through, and which transitions are legal? If there is more than
  one state, that is an enum, and the illegal transitions belong in the route handler.
- Is it ever edited after creation, or is it an immutable event? **Documents get a lifecycle
  and their own table; events are append-only and can share one.**
- Can it be deleted? By whom? Or does it become `CANCELLED`/`INACTIVE`? Prefer a status over
  a hard delete for anything a person would ask about later.

**Relationships**
- One or many? Can this belong to two parents at once?
- If the parent is deleted, should this go too (`Cascade`), block the delete (`Restrict`), or
  be orphaned deliberately (`SetNull`)? **There is no default — pick one and say why.**
- Is any FK nullable? What is the real "gets linked later" story? If there is none, it is
  NOT NULL.

**Money and numbers** (this business is full of both)
- Is any column money? Then `Decimal(12, 2)`. Never `Float`.
- Is a total stored as well as its parts? Then name where it is recomputed and what happens
  if they disagree.
- Are there rounding rules? GST rounding and cash-discount rounding are business decisions,
  not implementation details — write them down.

**Scale and access** — sanity-check, do not over-engineer (see `bch-context.md`)
- How many rows in a year? Under ~100k means no partitioning, no archival, no caching.
- What is the busiest read? That query determines the index.
- Who reads it, and does that need a new RBAC module? Access control is **data** — a new
  feature model usually needs a row in `prisma/rbac-catalog.ts` and a `requireFeature`
  guard, never a role name in a condition.
- Does the data arrive from Zoho? Then it needs an idempotency key so a re-pull updates
  instead of duplicating, and its shape is partly dictated by what Zoho returns.

**The question people forget**
- What happens when the same operation runs twice? Design for idempotency with a unique
  constraint, not with a retry guard in application code.

## Data type table

| Business thing | Prisma | Why |
|---|---|---|
| Money | `Decimal @db.Decimal(12, 2)` | Exact. `Float` corrupts totals — see `docs/schema-review.md` §4 |
| Percentage / rate | `Decimal @db.Decimal(5, 2)` | Same reason; 18.00% must stay 18.00 |
| Quantity (whole units) | `Int` | Cycles are not sold in halves |
| Identifier | `String @id @default(cuid())` | House standard |
| Business key | `String` + `@unique` or `@@unique` | Bill number, phone, token |
| Fixed set under ~20 values | `enum` | Compile-time safety |
| Set the business edits at runtime | a table | An enum change needs a deploy |
| Date only (bill date, due date) | `DateTime` | Postgres `timestamptz`; keep it consistent |
| Free text | `String` | Postgres `text` — never guess a length |
| Structured but never queried | `Json` | If you ever filter on a key inside it, it should have been a relation |
| Flag | `Boolean @default(false)` | Never nullable |
| Phone | `String` | Never `Int`. Leading zeros, `+91` |
| GSTIN / PAN / HSN | `String` | Fixed-format text, not numbers |

## Model template

```prisma
model Thing {
  id String @id @default(cuid())

  // Relations — every FK gets an index below, and an explicit onDelete
  vendorId String
  vendor   Vendor @relation(fields: [vendorId], references: [id], onDelete: Restrict)

  // Business key
  thingNo String

  // Money — Decimal, never Float
  amount Decimal @db.Decimal(12, 2)

  // Lifecycle
  status ThingStatus @default(DRAFT)

  // Who did it — for anything a person triggers
  recordedById String
  recordedBy   User @relation(fields: [recordedById], references: [id])

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([vendorId, thingNo])  // the real-world uniqueness rule
  @@index([vendorId])            // FK index — Prisma does NOT add this
  @@index([status])              // if the list screen filters on it
}
```

## Before handing it over

- [ ] Every FK has an `@@index`
- [ ] Every relation has an explicit `onDelete`
- [ ] Every money column is `Decimal`
- [ ] Nothing nullable without a stated "linked later" reason
- [ ] The real-world uniqueness rule is a constraint, not a comment
- [ ] RBAC module + `requireFeature` guard identified, if it is a feature
- [ ] No dependency on anything running on a schedule — this app has no cron
- [ ] Said whether a migration and an RBAC re-seed are needed, and whether the migration SQL needs hand-editing

Then stop. **Do not run `prisma migrate dev`, `prisma db push`, `prisma generate`, `npm` or `git`** — print the
commands for the user (AGENTS.md gates git/npm; `prisma generate` fails with `EPERM` while
the dev server is running).
