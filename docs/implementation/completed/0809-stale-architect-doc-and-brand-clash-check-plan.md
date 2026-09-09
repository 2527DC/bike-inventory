# Two small holes: a stale architect doc, and a brand that can be created twice

Status: completed — 9 Sep 2026, both findings are closed on `main` (`b158aa3`). Finding 2’s route code shipped inside `ddf0092`, and the blocker this status carried — `prisma/migrations/20260908151058_brand_name_ci_unique/` untracked while the later `20260908161249` was committed — is gone: the folder is in git, so a fresh clone gets the case-insensitive unique index in order. The architect doc no longer describes a constraint the database does not have.
Branch: the work did **not** land on `fix/architect-doc-and-brand-clash`. That branch exists and
holds none of it; Finding 2's route changes travelled inside the unrelated taxonomy commit
`ddf0092` on `feat/taxonomy-inactive-and-audit-approval`, and the doc edit is still uncommitted.

**What blocks `completed`** (verified on disk 9 Sep 2026): Part B step 6 says "commit the
migration folder with the Part A code". `prisma/migrations/20260908151058_brand_name_ci_unique/`
is untracked — it is not gitignored, it was simply never added. Because the *later*
`20260908161249_brand_category_is_active` **is** committed, git's migration history is now out
of order: a fresh clone or deploy gets the `isActive` columns and never gets the case-insensitive
unique index, while `src/app/api/brands/route.ts:45` — which is committed — cites it. This
violates CLAUDE.md's "a schema change is two things committed together".

To close it: `git add prisma/migrations/20260908151058_brand_name_ci_unique/` (plus
`docs/agents/database-architect.md` and `prisma/migrations/migration_lock.toml`), commit, then
flip this line to `completed`.

Two smaller gaps, neither blocking:
- A3 asked the race-loss log line to carry the attempted name's length;
  `src/app/api/brands/route.ts:61` logs no metadata at all.
- Finding 1 says the architect doc was "the one place still asserting the opposite". It was not:
  `.claude/skills/db-designer/SKILL.md:10` still says migrations are "applied to production by
  `migrate deploy` from the Vercel build", while `:36` names the corrected doc as its authority.
  Out of this plan's letter, inside its purpose.

See the Implementation record at the end, including the local-database wipe it caused. Clarified
with the owner on 8 Sep (see Clarifications). Finding 2 ships the database constraint as well,
overriding the earlier "later, in its own migration" answer.

Two unrelated findings raised 8 Sep 2026 while filing the 0709 Zoho taxonomy plan. Both were
verified against the code on disk, file and line, on 8 Sep, and re-verified the same evening
before this revision.

They are in one document because they were found together, not because they share a cause.
They can ship as separate commits, in either order. Finding 2 is now the larger of the two
because it carries a migration.

---

## Clarifications (owner, 8 Sep 2026)

Three questions were put to the owner before this revision. The answers are binding.

1. **The Vercel build step stays removed.** The owner removed `prisma migrate deploy` from
   the build on purpose on 7 Sep and does not want it back. Finding 1 therefore **corrects
   the doc to describe that reality**; it does not, and must not, restore the step. The
   scale figures on the same doc's line 10 are corrected too.
2. **"The brand must never be created twice" means the database enforces it.** An
   application-layer pre-check alone leaves a race open, so Finding 2 now ships **both**
   halves: the pre-check (for a clean sentence) and a unique index on the lowercased,
   trimmed name (for the guarantee). This overrides the 8 Sep answer recorded in the 0709
   plan's §3.1 that the index would come later in its own migration.
3. **Update the plan, then build it.** The owner first asked for the plan only, then the same
   evening asked for the implementation to proceed at once with several agents in parallel.
   Built on the branch named above.

---

## Finding 1 — `docs/agents/database-architect.md` tells the schema reviewer something untrue

### The line

`docs/agents/database-architect.md:8`

> **ORM**: Prisma with **Prisma Migrate** — `prisma/migrations/` is applied to production by
> `prisma migrate deploy` from the Vercel build.

### Why it is wrong

That wiring was removed on 7 Sep 2026 on the owner's instruction. `scripts/vercel-build.mjs`
is now two steps:

```js
// scripts/vercel-build.mjs:37-38
["prisma generate", "generating the Prisma client"],
["next build",      "building the app"],
```

The file says so itself at `:7` — "`prisma migrate deploy` used to run as the FIRST step
here" — and the build prints `NO migrations were applied` at `:65`. `CLAUDE.md` rule 4 now
carries the same correction, struck through and dated.

So three files agree that nothing applies migrations automatically, and the agent doc is the
one place still asserting the opposite.

### Why this is not merely cosmetic

`.claude/settings.json:185` fires a `PostToolUse` agent hook on **every** edit to
`prisma/schema.prisma`. Its prompt says, in full:

> Act as the schema-reviewer defined in `.claude/agents/schema-reviewer.md`: read that file
> first and follow it exactly, **including reading `docs/agents/database-architect.md`** …

So the one automated check that looks at schema changes takes this line as its premise. The
concrete failure: a migration is committed, the PR merges, the app deploys — and the reviewer
has no reason to raise *"nothing will apply this"*, because its own context says the build
will.

That is exactly the risk `CLAUDE.md` rule 4 was rewritten to warn about, now that the safety
net is gone: a committed-but-unapplied migration reaches a deployed app as new code against
an old schema, and fails at the first query rather than at build time. The stale line quietly
disarms the reviewer for the one risk that got *worse* last week.

Finding 2 of this very plan carries a migration, so the corrected doc is the first thing the
reviewer needs when that schema edit fires the hook.

### Second staleness in the same file

`docs/agents/database-architect.md:10`

> **Scale**: ~500 products, ~2000 transactions/month, ~50 deliveries/week, 10 concurrent users

Measured 8 Sep 2026 (evening) on the database `.env` points at — the Supabase cloud **test**
project, after `npm run db:import` seeded the real catalog:

| table | rows |
|---|---|
| Product | 5,745 |
| Brand | 115 |
| Category | 32 |
| Vendor | 83 |

An order of magnitude out on products, in the direction that makes an architect agent say
"an index is not worth it here" and "a sequential scan is fine at this size". The other three
figures on that line (transactions, deliveries, concurrent users) were never measured and
stay as labelled estimates.

### The change

Two lines in one file. **It does not touch `scripts/vercel-build.mjs`, `vercel.json` or
`package.json`** — the build step stays removed (Clarification 1).

1. Replace `:8` with wording to this effect, so the doc states the current reality and points
   at `CLAUDE.md` rule 4 rather than restating its history:

   > **ORM**: Prisma with **Prisma Migrate**. `prisma/migrations/` is applied **by hand**
   > against the target before the code that needs it goes live — `npx prisma migrate status`,
   > then `npx prisma migrate deploy`. **Nothing applies migrations automatically**: the Vercel
   > build is `prisma generate → next build` only (the deploy step was removed 7 Sep 2026 on the
   > owner's instruction), so a committed-but-unapplied migration reaches a deployed app as new
   > code against an old schema. `prisma db push` is banned from 2 Sep 2026. Rules and history:
   > CLAUDE.md "Database changes go through Prisma Migrate" (rule 4); adoption and baseline:
   > `docs/implementation/pending/prisma-migrations-adoption-plan.md`.

2. Replace `:10` with the measured table above, dated, and mark the unmeasured three as
   estimates:

   > **Scale** (measured 8 Sep 2026 on the cloud test database after the catalog import):
   > 5,745 products, 115 brands, 32 categories, 83 vendors. Unmeasured estimates:
   > ~2000 transactions/month, ~50 deliveries/week, 10 concurrent users.

No code, no schema, no build impact. The only consumer is the schema-reviewer hook.

### What to check afterwards

Edit `prisma/schema.prisma` trivially (or let Finding 2's edit do it) and let the hook fire;
the reviewer should no longer describe the Vercel build as applying migrations, and should
reason about a ~5,700-row product table.

---

## Finding 2 — `POST /api/brands` can create a duplicate brand, and reports the failure badly

### The code

`src/app/api/brands/route.ts:23-33`

```ts
export async function POST(req: NextRequest) {
  try {
    await requireFeature("brands", "create");
    const body = await req.json();
    const data = brandSchema.parse(body);

    const brand = await prisma.brand.create({ data });   // :29 — no lookup, no trim
    return successResponse(brand, 201);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to create brand", 400);
  }
}
```

It is the only writer of Brand in the tree with no pre-check. Both of its siblings have one:

| route | check | on clash |
|---|---|---|
| `api/categories/route.ts:43-47` | case-insensitive `findFirst` | `"X" already exists` — **409** |
| `api/brands/[id]/route.ts:38-46` (PATCH) | case-insensitive `findFirst` | `"X" already exists. Merge into it instead of renaming.` — **409** |
| `api/brands/route.ts:29` (POST) | **none** | raw Prisma P2002 text — **400** |
| `api/brands/zoho-import/route.ts:52-64` | one read inside the transaction | skipped and reported |
| `api/zoho/pull-review/approve/route.ts:52-58` | case-insensitive `findFirst` | creates once, catches the race |

Note the fourth row: the Zoho import already defends itself, and says why in its own comment
at `:25-26` — creation is *"behind a case-insensitive name check that `POST /api/brands` does
not have and that this path must not inherit the lack of."* The import is careful. The **New
Brand** button on `/more/brands` is not.

### Gap (a) — the error is a Prisma internal

`Brand.name` is `@unique` (`prisma/schema.prisma:453`). Creating an exact duplicate throws
P2002, and the catch returns `error.message` verbatim as a **400**: a multi-line *"Unique
constraint failed on the fields: (`name`)"*. Renaming a brand to a taken name gives a clean
sentence naming the holder; creating one gives the constraint's own words. Same table, same
constraint, two experiences.

### Gap (b) — the one that matters: it lets a duplicate through

`@unique` on a Postgres text column is a **case-sensitive** btree. Every brand lookup in the
codebase is `mode: "insensitive"`.

So `hero` inserts happily alongside `Hero`. No constraint fires. No error is shown. There are
now two rows meaning one brand, and from that point
`findFirst({ where: { name: { equals: x, mode: "insensitive" } } })` returns whichever row
Postgres yields first — which is not deterministic and not stable across queries.

That is precisely the duplicate the whole 0709 / 0809 taxonomy effort exists to prevent, and
it is reachable from a button on the brand screen.

### Gap (c) — no trim

`brandSchema` (`src/lib/validations.ts:140-147`) does not trim, and `:29` passes `data`
straight to `create`. So `" Hero"` is a third distinct row, and `"   "` passes `min(1)`.
Category POST trims (`name: data.name.trim()`); brand PATCH trims; brand POST does not.
`brandSchema` has exactly one consumer — this route — so it can be fixed at the schema.

### Gap (d) — the race, which only the database can close

An application-layer check is a read followed by a write. Two requests that both read "no
such brand" both insert, and the btree does not consider `hero` and `Hero` equal, so both
succeed. The pre-check narrows the window to milliseconds; it does not close it. Clarification
2 says the owner wants it closed.

### The change — Part A, the route (application layer)

About ten lines across two files.

1. `src/lib/validations.ts:141` — `name: z.string().trim().min(1, "Name is required").max(100)`.
   Zod 4 (`package.json:57`) applies `.trim()` before `.min`, so whitespace-only names are
   refused as "Name is required" and every downstream read sees the trimmed value.
2. `src/app/api/brands/route.ts` POST — after `parse`, mirror `POST /api/categories` exactly:

   ```ts
   // Brand.name is unique on lower(btrim(name)) — see migration <timestamp>_brand_name_ci_unique.
   // Answer with the brand that already holds the name rather than a raw constraint violation.
   const clash = await prisma.brand.findFirst({
     where: { name: { equals: data.name, mode: "insensitive" } },
     select: { name: true },
   });
   if (clash) return errorResponse(`"${clash.name}" already exists.`, 409);
   ```

   Wording is brand PATCH's sentence minus the rename clause, so the two brand routes agree.
3. Same file, the `catch` — map the race to the same sentence instead of Prisma's text, using
   the idiom the sibling importer already uses at `api/brands/zoho-import/route.ts:168`:

   ```ts
   if ((error as { code?: string } | null)?.code === "P2002") {
     return errorResponse("A brand with that name already exists.", 409);
   }
   ```

   The name of the holder is not known in this branch (the pre-check missed it by a
   millisecond), so the sentence is generic. Log at `warn` with the attempted name's length,
   not the name, before returning.
4. `src/app/api/brands/[id]/route.ts:66-69` PATCH `catch` — the same three-line P2002 mapping.
   PATCH already has the pre-check; without this its race path returns the raw P2002 as a 400,
   which is Gap (a) reappearing on the other route once the new index makes case clashes a
   constraint violation too.

### The change — Part B, the constraint (database)

A second unique index on the normalised name, **added alongside** `Brand_name_key`, never
replacing it:

```sql
CREATE UNIQUE INDEX "Brand_name_ci_key" ON "Brand" (lower(btrim("name")));
```

**Why alongside, not the 0709 §3.1 `DROP … CREATE` form.** `Brand.name @unique` stays in
`prisma/schema.prisma`, so:

- `findUnique({ where: { name } })` and `upsert({ where: { name } })` keep compiling.
  Callers: `scripts/import-products.ts:256`, `prisma/seed.ts:101` and `:105`. Dropping
  `@unique` would break all three and put a schema edit on the critical path of a seed script.
- CLAUDE.md rule 7 (additive first) holds: code running before the migration survives the
  new schema unchanged, because nothing it does becomes invalid — only a *new* insert that
  clashes case-insensitively is refused, which is the point.
- `btrim` is in the key so `" Hero"` collides with `Hero` at the database as well as at the
  route. Zoho names arrive untrimmed in principle; this makes a forgotten `.trim()` in some
  future writer a 409, not a duplicate.
- The 0709 §3.1 SQL (`DROP INDEX "Brand_name_key"; CREATE UNIQUE INDEX "Brand_name_key" ON
  "Brand"(lower(name))`) is **superseded** by this form. Reusing the Prisma-managed name for
  an expression index would make the next `migrate dev` try to recreate the plain index under
  the same name.

**Prisma cannot express an expression index**, so the migration is created empty and the SQL
is written by hand — the documented workflow for unsupported features. Steps, all on
localhost (CLAUDE.md rule 2):

1. `.env` points at the Supabase test project (`.env:9-10`); the localhost pair is commented
   at `:13-14`. **Do not edit `.env`** — the running dev server reloads it and would switch
   databases under whoever is using it. Export the localhost pair into the environment for
   the commands below instead (Prisma's dotenv never overrides a variable that is already
   set), print the masked hostname, and abort unless it is localhost. This bypasses
   `scripts/db/assert-localhost.mjs`, which reads the file rather than the environment, so the
   printed hostname is the gate.
2. `npx prisma migrate status` — local `bch` must show every migration applied and nothing
   pending.
3. `npx prisma migrate dev --create-only --name brand_name_ci_unique` — Prisma writes an
   **empty** `prisma/migrations/<timestamp>_brand_name_ci_unique/migration.sql` because the
   schema has not changed. `--create-only` does not run `prisma generate`, so it is safe with
   the dev server up.
4. Write the file: a `WHY` header in the house style of
   `prisma/migrations/20260908090622_zoho_brand_category_ids/migration.sql`, then the single
   `CREATE UNIQUE INDEX` above. Say in the header that it is additive, that `Brand_name_key`
   stays, and that the migration **fails on purpose** if the target already holds a
   case-insensitive duplicate — the fix for that is the Merge action on `/more/brands`, not
   editing the migration.
5. `npx prisma migrate dev --skip-generate` — applies it to local `bch`. `--skip-generate`
   because `prisma generate` fails with EPERM while the dev server holds the query engine,
   and nothing in the generated client changes anyway. Then the check that decides whether
   Prisma will fight the index on the next schema change:

   ```
   createdb -h localhost -U postgres bch_shadow
   npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url "postgresql://postgres:<password>@localhost:5432/bch_shadow"
   dropdb -h localhost -U postgres bch_shadow
   ```

   **The shadow URL must be a throwaway database. Never pass `bch` itself.**
   `migrate diff --from-migrations` RESETS whatever database the shadow URL names and replays
   every migration into it. On 8 Sep 2026 this step was run with local `bch` as the shadow
   URL, and it wiped `bch`: every row gone, `_prisma_migrations` gone, schema rebuilt from the
   seven migration files. The check answered as hoped, and the cost was the local database.
   See the Implementation record.

   Expected: `No difference detected.` Prisma's Postgres describer does not model expression
   indexes, so neither side of the diff sees it and no later migration tries to drop it. **If
   the diff instead proposes `DROP INDEX "Brand_name_ci_key"`, stop and raise it** — the
   fallback is a real `nameKey` column kept in step by a trigger, which is a different plan.
6. Commit the migration folder with the Part A code — CLAUDE.md rule 1 wants the folder and
   the schema edit together, and here the "schema edit" is nil by design; the commit message
   must say so.

**Pre-flight on any target before `migrate deploy`** — run this read-only query; the
migration is safe only when both counts are zero:

```sql
select
  (select count(*) from (select lower(btrim(name)) from "Brand" group by 1 having count(*) > 1) s) as ci_dupe_groups,
  (select count(*) from "Brand" where name <> btrim(name)) as padded;
```

Measured 8 Sep 2026 on the Supabase test project: `ci_dupe_groups = 0`, `padded = 0`, 115
brands. The index applies cleanly there today.

### Every writer of Brand, and what the new index does to it

| writer | today | after |
|---|---|---|
| `api/brands/route.ts` POST | no check | pre-check → 409; race → P2002 → 409 |
| `api/brands/[id]/route.ts` PATCH | pre-check; race → raw 400 | pre-check; race → P2002 → 409. Case-only rename of the same row (`Hero` → `HERO`) is an UPDATE of one row and passes |
| `api/brands/zoho-import/route.ts:131` | in-transaction name check | unchanged; a race aborts the transaction and its existing catch at `:168` already answers it |
| `api/zoho/pull-review/approve/route.ts:58` | `findFirst` insensitive, then create, race caught at `:60-62` | unchanged |
| `scripts/import-products.ts:256` | `upsert` by exact name | a case-variant of an existing brand now **throws** instead of inserting a duplicate. Correct: the script is run by hand on one machine, and the answer to a clash is to fix the data, not to import it |
| `prisma/seed.ts:105` | `upsert` of one placeholder constant | unchanged |
| `api/brands/[id]/merge/route.ts` | moves products, deletes the source; never inserts | unchanged |

### What this deliberately does NOT do

- **Does not touch `Category`.** `Category.name @unique` has the identical case-sensitivity
  hole, guarded only by its route's pre-check. It is out of scope by the owner's wording
  ("the brand must never be duplicate created"). Note it for a follow-up; the same additive
  index applies.
- **Does not switch the column to `citext`** or add a `CHECK (name = btrim(name))`. The
  expression index covers both without a column type change (CLAUDE.md rule 3).
- **Does not drop or rename `Brand_name_key`.** See "why alongside" above.
- **Does not restore `prisma migrate deploy` to the Vercel build.** The migration is applied
  by hand (rule 4). This plan is the first migration filed since that step was removed, so
  the deploy checklist below is written out in full rather than assumed.

### What to check afterwards

Local, before committing:

1. `npx tsc --noEmit`.
2. `npm run build` (needs a reachable database; ~45 min, run it in the background).
3. On `/more/brands`, create `Hero`. Then try `hero` — expect a 409 and a sentence, not a new
   row. Before this change, that produced a second row silently.
4. Try `" Hero"` with a leading space — same refusal. Try `"   "` — "Name is required".
5. Rename an existing brand to a case-variant of another (`Atlas` → `hero`) — expect PATCH's
   409 sentence. Rename `Hero` → `HERO` — expect success (same row).
6. The race, once: fire two identical `POST /api/brands` at the same instant (two `curl`
   in the background, same body, a fresh name). Expect one 201 and one 409. Before Part B,
   that could be two 201s.
7. Confirm the Zoho import path still behaves: Fetch, import, Fetch again, `new` must be 0.
8. `psql` on local `bch`: `\d "Brand"` shows both `Brand_name_key` and `Brand_name_ci_key`.

Before merging the PR (CLAUDE.md rule 9): `npm run db:snapshot` (`scripts/db/snapshot.mjs`
exists; confirm it runs against the intended target before relying on it).

On the Supabase test project, by hand, after the PR merges and before the code is deployed:

1. The pre-flight query above — both counts must be 0.
2. `npx prisma migrate status` against the 5432 session URL (`DIRECT_URL`, never 6543 — rule
   8). Expect **two** pending: `20260908143858_ai_provider` (applied locally only, per the
   8 Sep note) and this one.
3. `npx prisma migrate deploy`.
4. `npx prisma migrate status` again — up to date.

---

## Implementation record — 8 Sep 2026, evening

Built on `fix/architect-doc-and-brand-clash`, created off `chore/brand-stock-module-and-tooling`
at `b140957`. Three agents in parallel: one on the migration, one on the route code, one on the
doc. Nothing is committed yet.

### What landed

| file | change |
|---|---|
| `docs/agents/database-architect.md:8,10` | ORM line says migrations are applied by hand and nothing applies them automatically; scale line carries the measured figures |
| `src/lib/validations.ts` | `brandSchema.name` is `z.string().trim().min(1).max(100)` |
| `src/app/api/brands/route.ts` | logger scoped `api:brands`; POST does the case-insensitive pre-check → 409 naming the holder; `log.info("brand created")`; P2002 in the catch → 409 with a sentence |
| `src/app/api/brands/[id]/route.ts` | `await params` moved above the `try` so the catch can log `brandId`; P2002 in the catch → 409 |
| `prisma/migrations/20260908151058_brand_name_ci_unique/migration.sql` | hand-written; WHY header, pre-flight query, `CREATE UNIQUE INDEX "Brand_name_ci_key" ON "Brand" (lower(btrim("name")))` |
| `prisma/migrations/migration_lock.toml` | Prisma re-added its two comment lines during `migrate dev`; kept, it rewrites them every time |

`prisma/schema.prisma` is untouched by this plan. (It shows as modified in the tree because
another piece of work, the AI-provider settings, is in progress in the same checkout.)

### What was verified

- `npx tsc --noEmit` — exit 0, no output.
- Local `bch` before the migration: `migrate status` up to date, pre-flight query
  `ci_dupe_groups = 0`, `padded = 0` with 115 brands.
- `migrate dev --skip-generate` applied `20260908151058_brand_name_ci_unique`.
- `\d "Brand"` lists `Brand_name_key` and `Brand_name_ci_key` side by side.
- Constraint proof in one rolled-back transaction: `ZZ CI Test` inserts; `zz ci test` and
  ` ZZ CI Test ` are both refused by `Brand_name_ci_key` ("Key (lower(btrim(name)))=(zz ci
  test) already exists"); an exact repeat is refused by `Brand_name_key` first. Zero rows left.
- `migrate diff --from-migrations … --to-schema-datamodel` — `No difference detected.` Prisma
  will not try to drop the expression index on the next schema change.

### What went wrong — local `bch` was wiped

The `migrate diff` check above was run with local `bch` itself as `--shadow-database-url`.
Prisma resets the shadow database before replaying migrations into it, so `bch` was dropped
and rebuilt from the seven migration files. Afterwards: 100 tables, 0 rows in every one of
them, and no `_prisma_migrations` table, so `migrate status` now lists all seven migrations
as not applied even though every table and index physically exists.

The Supabase test project was never touched and `.env` was never edited.

**Recovered the same evening, on the owner's choice of the re-seed route** (the alternative
was restoring `backups/bch-local-20260905-115944.dump`, which predates the catalog import):

1. `npx prisma migrate resolve --applied <name>` for each of the seven folders — the name
   must be the bare folder name; `ls` appends a `/` and Prisma then answers P3017 "could not
   be found". `migrate status`: 7 found, up to date.
2. `npm run db:seed:rbac` — 50 modules, 179 permissions, ADMIN with all 179, `admin@bch.local`.
3. `npm run db:seed:stores` — 2 stores, 2 warehouses.
4. `npm run db:import` — 32 categories, 115 brands, 5,738 products, 83 vendors, 18 contacts,
   183 issues, 289 notes; 473 author references rewritten onto the seeded admin. The import
   ran with `Brand_name_ci_key` already in place and raised no clash, which is a second proof
   that the catalog has no case-variant brands.

After: 7 migrations recorded, `\d "Brand"` shows both unique indexes, pre-flight query 0/0.
What is not back: anything entered by hand on local `bch` after the 5 Sep dump (test service
jobs, customers, stored integration credentials — `npm run db:restore:integrations` exists for
the last of those).

Two observations from the recovery, for whoever works in this checkout next:

- Steps 1–3 ran with the localhost URLs exported into the environment. Step 4 could not:
  `scripts/db/import-catalog-and-vendors.mjs` reads `.env` itself, like `assert-localhost.mjs`.
- `.env` was found already switched to the localhost pair (lines 13–14 active, 9–10
  commented) when step 4 started, by another session working in the same checkout. This plan
  did not change `.env` at any point; a byte-for-byte comparison against a backup taken before
  step 4 confirms it.

### Not verified

- `npm run build` — **not run for this change.** Its first step is `prisma generate`, which
  fails with EPERM while the dev server on port 3000 holds the query engine, and that server
  belongs to another session. `npx next build` on its own was attempted instead (Next 16
  writes dev output to `.next/dev`, so build and dev do not collide) and Next refused it:
  "Another next build process is already running" — the other session had a full
  `npm run build` in flight from 20:44, and started another at 21:22. Those builds compile
  this same working tree, so they exercise this change, but their output is not visible
  here. That 21:22 build **completed** — `.next/BUILD_ID` was written at 21:41:42 — with
  every change in this plan already in the tree, which is the strongest compile-level
  evidence available. A full `npm run build` run from this plan's session at 21:43, once the
  dev server was gone, got through `prisma generate` and died at 21:49 inside Turbopack:
  `node process exited before we could connect to it with exit code: 0xc0000142` while
  spawning the PostCSS worker for `globals.css`, with under 1 GB of the machine's 8 GB free
  and the other session about to start a third build. That is a process-spawn failure under
  memory pressure, not a compile error. A second retry compiled in 3.3 min and then died with
  `write EPIPE` in the TypeScript step when the harness closed its stdout pipe. **The third
  attempt, with output redirected to a file, passed:** started 21:55:21, `✓ Compiled
  successfully in 2.7min`, TypeScript step ran, `✓ Generating static pages using 3 workers
  (155/155) in 10.6s`, exit 0, `.next/BUILD_ID` = `7QkDUOcEEZsRjMAtm8SJd` written 22:01:05.
  `npx tsc --noEmit` is clean as well.
- The `/more/brands` screen checks (`Hero`, `hero`, `" Hero"`, the parallel-request race)
  were not driven through the browser. The route logic is covered by the constraint proof and
  the typecheck; the screen still needs a person to click it.

---

## Appendix — the branch's merge state on 8 Sep 2026

Recorded here because it explains a GitHub error the owner hit, and it is easy to lose.

`chore/brand-stock-module-and-tooling` was **rebase-merged** into `main` once already. A
rebase merge replays commits onto the base as new objects and does not update the source
branch, so main and the branch now hold the same five commits under different hashes:

| on `main` | on the branch | subject |
|---|---|---|
| `e902059` | `a5e6c01` | docs(zoho): the brand & category sync plan… |
| `7fac34d` | `9bd64a4` | chore(deploy): the Vercel build no longer applies migrations |
| `74b1fbd` | `181154c` | feat(brand-stock): Brand Stock becomes a module of its own… |
| `82332f2` | `c4a3ac2` | chore(claude): read-only git stops prompting… |
| `25d54ae` | `103117f` | feat(nav): the pinned bottom-nav tabs actually reach the phone |

`git cherry -v origin/main HEAD` marks all five `-` (already upstream by patch-id) and the
seven newer commits `+`.

Main also gained `0addf67` — *Merge pull request #36 from 2527DC/feat/purchasing-transfers-p5-p15* —
which the branch does not have. The merge base is still `b2062b8`.

**"Base branch was modified. Review and try the merge again."** is GitHub refusing to merge
against a page whose base SHA has since changed. Reloading clears that message, but a second
rebase merge would then replay all twelve commits onto a main that already holds five of
them.

The clean route is to rebase locally first — git drops already-applied patches by patch-id —
then force-push with lease:

```
git fetch origin
git rebase origin/main
git push --force-with-lease origin chore/brand-stock-module-and-tooling
```

Expect one conflict on `CLAUDE.md` rule 4: main still carries the old wording, and
`b140957 docs(plans)` replaces it with the struck-through version. Keep the struck-through
version — it is the one that matches `scripts/vercel-build.mjs`.
