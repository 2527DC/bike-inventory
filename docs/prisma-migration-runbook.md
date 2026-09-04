# Prisma migration runbook — what was run, why, and when to use each command

Written 2 Sep 2026, the night before go-live, from the actual session that baselined both
databases. Two audiences: whoever runs the next schema change, and whoever has to work out
later what happened tonight.

Companion documents: `docs/implementation/pending/prisma-migrations-adoption-plan.md` (the
decision and the full plan), `CLAUDE.md` → "Database changes go through Prisma Migrate" (the
rules), `docs/vendor-backup-issues.md` (the vendor data restore).

---

## The one idea everything below depends on

Prisma has **two different ways** to get a schema into a database, and they are not
interchangeable:

| | `prisma db push` | `prisma migrate` |
|---|---|---|
| What it does | Compares the schema to the live database and applies whatever SQL closes the gap, right now | Applies `.sql` files that were written, reviewed and committed beforehand |
| Record of what happened | none | `_prisma_migrations` table — one row per migration |
| Can it lose data? | **Yes** — silently in some cases, or by asking for `--accept-data-loss` | Only if the committed SQL says so, and you read it in the pull request first |
| Safe for production | **No.** Banned in this repo from go-live | Yes — `migrate deploy` is built for it |

Everything tonight was about moving this project from the first column to the second **without
losing a row**, on a database that already had all 98 tables.

---

## Part 1 — the local test database (`localhost:5432/bch`)

This database did not exist. Starting from nothing is the easy case: there is no data to
protect, so the migration can simply run.

### Step 1.1 — create the database

```bash
psql "postgresql://…@localhost:5432/postgres" -c 'CREATE DATABASE "bch";'
```

**What it does:** creates an empty database named `bch`.
**Why here:** `.env` named `bch` but the local PostgreSQL server did not have it — only unrelated
databases (`bch-local`, `bch-production`, `bch-lms`, …). Prisma will not create a database for
you; it fails with "database does not exist".
**When you need this:** first time on a new machine, or after dropping a local database to start
clean. Never on a cloud database — those are created in the provider's dashboard.

### Step 1.2 — generate the baseline migration

```bash
mkdir -p prisma/migrations/0_init

npx prisma migrate diff \
  --from-empty \
  --to-schema-datamodel prisma/schema.prisma \
  --script \
  --output prisma/migrations/0_init/migration.sql

printf 'provider = "postgresql"\n' > prisma/migrations/migration_lock.toml
```

**What it does:** writes the SQL that turns *nothing* into *the current schema* — 3023 lines,
98 `CREATE TABLE`, 39 `CREATE TYPE`, 237 indexes, 145 foreign keys, and **no `DROP` anywhere**.
`migration_lock.toml` pins the database engine so nobody generates PostgreSQL migrations and
applies them to MySQL.

**Why `--from-empty` matters:** it means "compare against an empty database", so the command
**never connects to any database**. It reads `schema.prisma` and writes a file. It is impossible
for this step to change data anywhere. That is why it was safe to run before anything else was
decided.

**Why this file is called a "baseline":** this project's tables were all created by `db push`
over months, with no migration files. Prisma's documented way to adopt Migrate on such a database
is to write one migration describing the schema as it stands today, then tell each existing
database "you already have this". Every future change is a normal migration on top of it.

**When you need this:** exactly once per project, ever. You will not run it again — from now on
new migrations come from `migrate dev` (step 4.1).

### Step 1.3 — apply it

```bash
npx prisma migrate deploy
npx prisma migrate status
```

**What `migrate deploy` does:** reads `prisma/migrations/`, checks `_prisma_migrations` for what
has already run, and executes the ones that have not — each inside a transaction. It never
prompts, never resets, never drops anything the SQL does not tell it to.
**Why here:** `bch` was empty, so `0_init` genuinely had to run. It created all 98 tables.
**What `migrate status` does:** read-only. Prints "Database schema is up to date!" or lists what
is pending. Run it whenever you are unsure.
**When you need `migrate deploy`:** on every deployment, and on any database that is behind. It
is the *only* migration command that should ever run automatically in a build.

### Step 1.4 — seed the data the app cannot start without

```bash
npm run db:seed:rbac      # 49 modules, 180 permissions, 8 roles, the admin user
npm run db:seed:stores    # 2 stores, 2 warehouses
```

**Why this is separate from migration:** migrations create *structure*; seeds create *rows*.
Permissions in this app are data, not code (`CLAUDE.md`), so they arrive by seed and can be
changed by an admin at runtime without a deploy. `seed-rbac` is idempotent — safe to re-run — but
it **deletes** modules that have left `prisma/rbac-catalog.ts`, cascading into role grants, so
read its output: a `stale removed` line means something was renamed by mistake.

---

## Part 2 — the cloud database (Supabase)

The hard case, and the one worth understanding. This database **already had all 98 tables**,
created by `db push` earlier the same day. Running `migrate deploy` here would have tried
`CREATE TABLE "Brand"` and failed with *relation already exists* — and a failed migration writes
a failure row that blocks every later deploy until it is cleaned up.

So the goal was the opposite of "run the migration": it was to make the database **agree** that
the migration had already happened, without executing a single line of its SQL.

### Step 2.1 — prove the database and the schema already match

```bash
npx prisma migrate diff \
  --from-schema-datasource prisma/schema.prisma \
  --to-schema-datamodel    prisma/schema.prisma \
  --script
```

**What it does:** connects to the live database named by `.env` (`--from-schema-datasource` means
"the real database this schema points at"), compares it to `schema.prisma`, and prints the SQL
that would close the gap. **Read-only — it changes nothing.**

**The only acceptable output:**

```
-- This is an empty migration.
```

That is what it printed (in 27 s). It means the live database is *exactly* the schema, so
declaring `0_init` already applied is truthful.

**Why this step is non-negotiable:** step 2.2 tells the database "you already have this
migration" without checking. If that were a lie — if the database were missing a column — nothing
would ever create it, and the app would fail at runtime on a column that no migration is left to
add. This diff is the check that makes the next step honest.

**If it prints anything else:** stop. Additive output (`CREATE TABLE`, `ADD COLUMN`) means the
database is behind the schema. Output containing `DROP` means the database has something the
schema no longer knows about. Either way, understand it before continuing.

### Step 2.2 — record the baseline as already applied

```bash
npx prisma migrate resolve --applied 0_init
```

**What it does:** creates the `_prisma_migrations` table if absent and inserts **one row** saying
`0_init` ran successfully. **It executes none of the migration's SQL.** That is visible
afterwards in the row itself: `applied_steps_count = 0`.

**Why here:** the tables already existed. This is Prisma's documented procedure for adopting
Migrate on a database that predates it.

**When you need it — two situations, and only these:**
1. **Baselining**, as here: an existing database adopting Migrate for the first time.
2. **Repairing a failed migration**: if `migrate deploy` fails halfway in production, you fix the
   database by hand and then use `--applied` (you completed it) or `--rolled-back` (you undid it)
   to tell Prisma what you did.

**When NOT to use it:** never as a way to "skip" a migration you do not want to run. That leaves
the database permanently out of step with the code, and nothing will ever notice.

### Step 2.3 — verify

```bash
npx prisma migrate status     # expect: Database schema is up to date!
npx prisma migrate deploy     # expect: No pending migrations to apply.
```

**Why run `deploy` when there is nothing to deploy:** it is the command the Vercel build will run
on every future deployment. Running it once by hand proves it is now a safe no-op instead of the
failure it would have been an hour earlier.

**Verified afterwards, read-only:** `_prisma_migrations` holds exactly one row, `0_init`,
`finished_at` set, `rolled_back_at` NULL, checksum matching the file on disk; 99 base tables
(98 + `_prisma_migrations`); 39 enum types; and the row counts unchanged — 3 users, 7 customers,
8 roles, 49 modules, 180 permissions.

---

## Part 3 — command reference: which one, when

| Command | Touches data? | Where it may run | Use it when |
|---|---|---|---|
| `migrate diff --from-empty --to-schema-datamodel` | **No** — never connects | anywhere | Generating the one-time baseline file |
| `migrate diff --from-schema-datasource …` | **No** — reads only | anywhere | Checking whether a live database matches the schema |
| `migrate dev --name <x>` | **Yes**, and may offer to **reset** | **localhost only** | Authoring a new migration after editing `schema.prisma` |
| `migrate deploy` | Yes — applies pending SQL | anywhere, incl. production | Deploying; bringing any database up to date |
| `migrate resolve --applied <x>` | Metadata row only | anywhere | Baselining; repairing a failed migration |
| `migrate status` | **No** | anywhere | Any time you are unsure |
| `db push` | Yes, **can destroy** | nowhere — **banned** from go-live | Throwaway prototypes only |
| `migrate reset`, `--force-reset`, `--accept-data-loss` | **Destroys everything** | **never** | Never in this project |

**The rule in one line:** author on localhost with `migrate dev`, commit the folder with the
schema change in the same commit, apply everywhere else with `migrate deploy`.

---

## Part 4 — the workflow from tomorrow

```bash
# 1. edit prisma/schema.prisma

# 2. with .env pointing at LOCALHOST, and the dev server stopped (prisma generate
#    fails with EPERM while it holds the query engine):
npx prisma migrate dev --name what_changed

# 3. READ prisma/migrations/<timestamp>_what_changed/migration.sql before committing.
#    DROP, ALTER COLUMN … TYPE, or SET NOT NULL on a populated table means hand-editing it:
#    rename instead of drop-and-create; add nullable, backfill, then set not null.

# 4. commit the schema change and the migration folder TOGETHER — one without the other is a bug

# 5. merge -> the build runs `migrate deploy` -> the new code goes live

# 6. if the change added modules or permissions:
npm run db:seed:rbac
```

**Additive first.** The migration runs a minute or two before the new code is live, so for that
window the *old* code is talking to the *new* schema. Adding a table, a nullable column or an
index is safe. Dropping or renaming a column the old code still reads will 500 until the swap —
do that in the *next* release, after the code stopped using it.

---

## Part 5 — why the `Product` table is empty

The question asked after the baseline: the migration was reported done, and `Product` has no
rows. Did the migration delete them?

### It was not the migration. Four independent pieces of evidence

1. **`applied_steps_count = 0`.** The `_prisma_migrations` row for `0_init` records that **zero
   SQL statements were executed**. `migrate resolve --applied` inserts a bookkeeping row; it has
   no mechanism to touch a table.
2. **`migrate deploy` printed "No pending migrations to apply."** It ran nothing.
3. **`Product` was already empty before any migrate command was run.** The first read of this
   database that night — taken *before* `migrate resolve` — already returned 0 products.
4. **The earlier `db push` was additive only.** Its SQL was previewed first with `migrate diff`:
   5 `CREATE TABLE`, 3 `CREATE TYPE`, 5 indexes, and **no `ALTER` or `DROP` on any existing
   table**. A non-interactive `db push` also refuses destructive changes unless
   `--accept-data-loss` is passed, which it was not.

### What the database's own statistics say

`pg_stat_user_tables` keeps lifetime counters per table. For `Product`:

```
rows inserted 6368    rows updated 12    rows deleted 68    rows live 0
```

Read that carefully. **6368 rows were inserted over this table's life, but only 68 were ever
`DELETE`d.** If something had deleted ~6300 products, the delete counter would read ~6368. It
reads 68.

That rules out a `DELETE`, and specifically rules out `npm run db:wipe:products` — that script
uses `deleteMany`, which increments the counter.

A **`TRUNCATE`** empties a table *without* incrementing the delete counter and sets live rows to
0 — which is exactly the pattern above. Every table that depends on a product is 0 too
(`InventoryTransaction`, `StockLevel`, `SerialItem`, `PurchaseOrderItem`, `Bin`), while
independent data survived: 3 brands, 1 category, 6 product types, 7 customers, 46 deliveries.

### The most likely reason, and it is documented

`Product.type` used to be a PostgreSQL enum. The stock-management work replaced it with a real
table: `Product.productTypeId TEXT **NOT NULL**` → `ProductType`. That plan says so in its own
§12.1 — **the product wipe had to run *before* the schema change**, because adding a required
column to a populated table is impossible without either a backfill or accepting data loss.

The cloud database shows that change was applied to it: `ProductType` exists and holds **6 rows**.
So this database went through exactly that sequence — empty the products, change the shape, and
reload the catalogue afterwards with the import script. The reload step evidently never ran here.

That is also why the plan describes the catalogue as *"ships empty and stays empty"* until
`scripts/import-products.ts` is run: after that change, the seed no longer creates products, and
the only way a SKU is born is the import.

### What cannot be established

PostgreSQL does not record *who* truncated a table or *when*. The counters above prove **how** the
rows left (not by `DELETE`) and the session log proves **it happened before this session touched
the database** — but the actor and the timestamp are unrecoverable. If that matters, Supabase's
own logs in the dashboard may still hold it.

### To reload the catalogue

```bash
npm run import:products     # scripts/import-products.ts — reads the .xlsx/.csv export
```

Run it against whichever database should hold the catalogue, and check `.env` first.

---

## Part 6 — still outstanding

From the adoption plan, not yet done:

- `scripts/db/snapshot-prod.mjs` and `scripts/db/restore-local.mjs` (`npm run db:snapshot`,
  `db:restore:local`) — **the snapshot is the only rollback that exists**, because Prisma has no
  down migrations. Take one before merging any PR that carries a migration.
- `scripts/vercel-build.mjs` and the `buildCommand` in `vercel.json`, so the deploy runs
  migrate → generate → build and a failed migration fails the build.
- The CI job that proves `prisma/migrations/` still matches `schema.prisma`.
- Removing `db:push` from `package.json` and denying it in `.claude/hooks/ask-git-npm.js`.
- `/backups/` in `.gitignore`.

Until the Vercel wiring exists, **no migration reaches the cloud database except by someone
running `migrate deploy` by hand.**
