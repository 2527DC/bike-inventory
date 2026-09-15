# Database migrations — how to handle them in BCH-Management

Written 15 Sep 2026 for the owner, after the evening's drift fix. Plain language first, commands
after. Everything here was checked against this repository on that date (`package.json`,
`scripts/db/`, `prisma/schema.prisma`, the local database). CLAUDE.md → "Database changes go
through Prisma Migrate" is still the rulebook; this guide explains it.

---

## 0. The 30-second version

Every time you change `prisma/schema.prisma`:

```
npm run db:migrate -- --create-only --name what_i_changed   # 1. Prisma WRITES the migration file (not applied)
#   2. open prisma/migrations/<date>_what_i_changed/migration.sql and READ it
npm run db:migrate                                          # 3. apply it to your LOCAL database
#   4. test the app, then commit schema.prisma + the new migration folder TOGETHER
```

On release day, for production / the test database:

```
npm run db:snapshot            # 1. backup first — Prisma has no "undo"
npm run db:migrate:status      # 2. what is waiting?
npx prisma migrate deploy      # 3. run only the waiting files — never resets, never asks
npm run db:migrate:status      # 4. must say "Database schema is up to date!"
#   5. point .env back at localhost, then deploy the code
```

`npm run db:migrate` refuses to run unless `.env` points at localhost (`scripts/db/assert-localhost.mjs`),
so it is safer than typing `npx prisma migrate dev` yourself.

---

## 1. The three databases in your world

| Database | What it is | Here | Can it be wiped? |
|---|---|---|---|
| **Local** | Your own copy on this laptop, for building and testing | `bch_local` on `localhost:5432` | It would hurt, but it is only your copy |
| **Shadow** | A **temporary, empty scratch database** Prisma uses for a few seconds, then deletes | e.g. `prisma_migrate_shadow_db_4f2a…` | **Always** — that is its job |
| **Production / test** | The real one the running app uses | Supabase | **Never.** Only `prisma migrate deploy` touches it |

---

## 2. What a shadow database is, and how it is created

Prisma sometimes needs to answer: *"If I ran all my migration files on an EMPTY database, what
would the tables look like?"* It cannot work that out by reading SQL text. So it actually
**runs** the files somewhere safe and looks at the result. That place is the shadow database.

Think of a spare test kitchen: before changing the real menu, the chef cooks every recipe there,
looks at what came out, then scrubs the kitchen clean.

What Prisma does with it, every time:

```
1. take an EMPTY database            (the shadow)
2. WIPE it                           (in case anything is in it)
3. run all migration files on it
4. look at the tables it produced
5. compare with schema.prisma / with your real database
6. throw it away
```

**Step 2 is why it is dangerous.** Whatever database you hand Prisma as the shadow gets wiped.
On 8 Sep 2026 someone passed local `bch` as the shadow URL, and `bch` was emptied.

### How it gets created

**A. `prisma migrate dev` (and `npm run db:migrate`) — automatic, you do nothing.**
Prisma creates a temporary database itself, uses it, drops it. You never see it. It works on the
laptop because the local `postgres` user may create databases. It would NOT work on Supabase —
another reason `migrate dev` never runs there.

**B. `prisma migrate diff --from-migrations …` — manual, you must give it one.**
This is the "do my migration files match the schema?" check. Prisma will not create the shadow
here; you pass an empty database with `--shadow-database-url`:

```
psql -U postgres -h localhost -c "CREATE DATABASE bch_shadow_check"          # 1. make an empty db

npx prisma migrate diff \
  --from-migrations prisma/migrations \
  --to-schema-datamodel prisma/schema.prisma \
  --shadow-database-url "postgresql://postgres:PASSWORD@localhost:5432/bch_shadow_check" \
  --exit-code                                                                   # 2. exit 0 = files match the schema

psql -U postgres -h localhost -c "DROP DATABASE bch_shadow_check"             # 3. delete it
```

The one rule: **the name after `localhost:5432/` must be a throwaway database** — never
`bch_local`, `bch`, or anything real. (Suggestion 1 in §15 makes this a single safe command.)

---

## 3. Three different questions — and which command answers each

This is why `migrate status` said "up to date" while `migrate dev` said "drift".

| Question | Command | Looks at |
|---|---|---|
| Have all my migration **files** been run on this database? | `npx prisma migrate status` | Only file names vs rows in the `_prisma_migrations` table. **Never looks at the tables.** |
| Do my migration **files** build exactly what `schema.prisma` says? | `npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url <throwaway> --exit-code` | Runs the files on the shadow, compares with the schema |
| Does this **real database** look like `schema.prisma`? | `npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script` | The real tables vs the schema. Read-only, no shadow needed |

Words you will see:
- **Pending** — a migration file this database has not run yet. Normal after new work. Fix: `migrate deploy`.
- **Drift** — the database's real tables differ from what its already-run migrations should have
  built. Only `migrate dev` / `migrate diff` notice it. `migrate dev` then offers to **reset** — say **No**.
- **Mismatch** (our word) — the migration files themselves do not build the schema. Every database
  built from them inherits it. Caught only by the `--from-migrations … --exit-code` check.

`--exit-code` makes a check a yes/no: **0** = identical, **2** = differences, **1** = error.
`--script` prints the SQL difference instead.

---

## 4. Everyday routine — on your laptop

1. **Check `.env` points at localhost.** `DATABASE_URL` should read `…@localhost:5432/bch_local…`.
   (`npm run db:migrate` refuses otherwise.)
2. **Edit `prisma/schema.prisma`.**
3. **Let Prisma write the migration, without applying it:**
   `npm run db:migrate -- --create-only --name add_assembly_level`
4. **Open the new `migration.sql` and read it.** Stop and think when you see:
   - `DROP` — something is deleted. A **rename** also shows up as DROP + ADD (data loss!).
   - `SET NOT NULL` — fails if existing rows are empty.
   - `ALTER COLUMN … TYPE` — a type change; check the data converts.
5. **Apply it locally:** `npm run db:migrate`
6. **Stop the dev server first on Windows** if you see `EPERM … query_engine` — `prisma generate`
   cannot replace the engine file while `next dev` holds it.
7. **Test the app locally.**
8. **Commit `schema.prisma` and the migration folder in the SAME commit.** One without the other
   is a bug (CLAUDE.md rule 1).

---

## 5. Release routine — production and the test database

Nothing applies migrations automatically any more — the Vercel build stopped running
`prisma migrate deploy` on 7 Sep 2026. **If you skip this, the new code fails at its first query.**

1. **Backup:** `npm run db:snapshot` — dumps the database `.env` points at into `backups/`
   (gitignored), using `DIRECT_URL`.
2. **Point `.env` at the target.** `DIRECT_URL` must be the **5432 session pooler, never 6543**
   (the transaction pooler never releases Prisma's lock).
3. **See what is waiting:** `npm run db:migrate:status`
4. **Apply:** `npx prisma migrate deploy` — runs only the waiting files, in order. It never resets,
   never asks, never uses a shadow database.
5. **Confirm:** `npm run db:migrate:status` → *"Database schema is up to date!"*
6. **Optional but good:** the real-database check from §3 should print nothing.
7. **Point `.env` back at localhost immediately.** It has been left pointing at Supabase before.
8. **Deploy the code.** Migrations go first, code second — so a migration must never break the
   code that is still running (see §8 "additive first").

---

## 6. Generate, don't hand-write

**Always let Prisma generate the migration file. Edit it when you have to. Never write one from scratch.**

| | OK? | Example in this repo |
|---|---|---|
| Write the whole file by hand | ❌ | `20260912040000_assembly_audit_build_line` — did not match the schema, unnoticed for 3 days |
| Generate, then edit a few lines | ✅ | `20260915201206_fix_assembly_fk_and_bins_drift` — Prisma's output + `IF EXISTS` + a safety check + `BEGIN/COMMIT` |
| Generate and use unchanged | ✅ | `20260915192349_product_assembly_level` |

Edit the generated file when:
- a **rename** was generated as DROP + ADD → change it to `RENAME COLUMN` / `RENAME TO`;
- a **required column** is added to a table with rows → add nullable, `UPDATE` to fill, then `SET NOT NULL`;
- **data** has to move or be filled in;
- the file must run on databases in **different states** (use `IF EXISTS`, as the drift fix does);
- you want it **all-or-nothing**: wrap it in `BEGIN; … COMMIT;` — except statements that cannot
  run in a transaction (`CREATE INDEX CONCURRENTLY`), which go in their own file.

After ANY edit, prove the files still build the schema — the §3 `--from-migrations … --exit-code`
check must print exit 0.

---

## 7. "Can I use `db push` while developing and make one migration at the end?"

**It is allowed for local experiments, but the last step has a trap.**

`db push` changes your local database directly and writes **no file**. At the end, `migrate dev`
sees tables that no migration explains — **drift** — and offers to **wipe the local database**.
That is exactly the message you saw on 15 Sep.

**If you did use `db push`, finish without a wipe:**

```
# 1. write the file: from "what the migrations build" to "what the schema says"
mkdir prisma/migrations/20260916100000_my_change
npx prisma migrate diff --from-migrations prisma/migrations \
  --to-schema-datamodel prisma/schema.prisma \
  --shadow-database-url "<throwaway db>" --script \
  > prisma/migrations/20260916100000_my_change/migration.sql
# 2. your local db already has the change (db push did it) — only RECORD it as applied
npx prisma migrate resolve --applied 20260916100000_my_change
# 3. prove the local database matches the schema (exit 0)
npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --exit-code
```

**Better: don't `db push` at all.** Run `npm run db:migrate -- --name x` for each change — it is
just as quick, and five small migrations are fine. If you want ONE clean migration before
merging, squash — only while none of them has run anywhere except your laptop:

1. `npm run db:snapshot` (local backup)
2. delete your **unmerged** migration folders
3. `npx prisma migrate reset` (localhost only — it wipes the local db and replays the rest)
4. `npm run db:migrate -- --name my_feature` → one combined file
5. restore your local data if you need it

**Never** squash or edit a migration that has already run on the test or production database.

---

## 8. Scenarios

| # | Scenario | Right move |
|---|---|---|
| 1 | **Add an optional column or a new table** | `db:migrate`, deploy any time — old code ignores it |
| 2 | **Add a required column** to a table with rows | Add nullable → fill with `UPDATE` → `SET NOT NULL` (one edited file, or two). Or give it a `@default` |
| 3 | **Rename a column** | `--create-only`, turn DROP + ADD into `RENAME COLUMN`. Zero downtime: add new → write both → backfill → switch reads → drop old a release later |
| 4 | **Drop a column or table** | Release 1: code stops using it. Release 2: the migration drops it. Snapshot first. ("Additive first", CLAUDE.md rule 7) |
| 5 | **Change a column type** (e.g. money `Float` → `Decimal(12,2)`) | `--create-only`, check the `USING` cast, try it on a copy of production. Big tables lock while it runs |
| 6 | **Index on a big production table** | `CREATE INDEX CONCURRENTLY` alone in its own file, no `BEGIN/COMMIT` |
| 7 | **Add an enum value** | Its own migration — a new value cannot be used in the transaction that adds it |
| 8 | **Data-only change** (backfill, clean-up) | `npm run db:migrate -- --create-only --name backfill_x` gives an empty file; write the `UPDATE`, make it safe to run twice |
| 9 | **A migration failed on production** | `migrate status` shows it failed. Fix the data or undo the half-done part, then `migrate resolve --rolled-back <name>` (it did not apply) or `--applied <name>` (you finished it by hand), then `deploy` again. Never delete `_prisma_migrations` rows by hand |
| 10 | **`migrate dev` says drift / wants a reset** | Say **No**. Look: `migrate diff --from-schema-datasource … --script`. Local data disposable → reset + restore. Otherwise write a fix migration (what we did on 15 Sep) |
| 11 | **Someone changed production by hand** (e.g. a hotfix index) | Compare with `migrate diff --from-schema-datasource`, put the change into a migration, then `migrate resolve --applied <name>` on production so it does not run twice |
| 12 | **A deployed migration is wrong** | Never edit it — its checksum changes and every database disagrees. Add a NEW migration that corrects it |
| 13 | **Two branches both add migrations** | After merging, `npm run db:migrate` locally replays them in timestamp order. If both touched one table, regenerate the later one |
| 14 | **Start migrations on an existing database** (baseline) | `migrate diff --from-empty --to-schema-datamodel … --script` into `0_init/migration.sql`, then `migrate resolve --applied 0_init` on each existing database (done here on 2 Sep) |
| 15 | **Stop this ever happening again** | A CI job runs the `--from-migrations … --exit-code` check on every PR (§15, suggestion 2) |

---

## 9. Command cheat-sheet

| Command | What it does | Where |
|---|---|---|
| `npm run db:migrate -- --create-only --name x` | Generate a migration file, do NOT apply | local only (guarded) |
| `npm run db:migrate` | Apply pending migrations locally + regenerate the client. Asks to reset on drift | local only (guarded) |
| `npm run db:migrate:status` / `npx prisma migrate status` | Which files have / have not run. **Not** the tables | anywhere, read-only |
| `npx prisma migrate deploy` | Run pending files in order. Never resets, never asks | production, test |
| `npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url <throwaway> --exit-code` | Do the files build exactly the schema? | local, CI |
| `npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script` | Does this real database match the schema? | anywhere, read-only |
| `npx prisma migrate resolve --applied <name>` | Record a file as done without running it | where needed |
| `npx prisma migrate resolve --rolled-back <name>` | Clear a failed migration so it can run again | where it failed |
| `npx prisma migrate reset` | **Wipes** the database and replays everything | local only, never elsewhere |
| `npx prisma db push` | Push the schema with no migration file | local experiments only |
| `npx prisma db pull` | Rewrite `schema.prisma` FROM the database | investigating only |
| `npx prisma validate` / `npx prisma format` | Check / tidy `schema.prisma` | anywhere |
| `npm run db:generate` | Rebuild the Prisma client (stop the dev server first on Windows) | local |
| `npm run db:snapshot` | Backup of the database `.env` points at → `backups/` | before every `deploy` |

---

## 10. Never do

1. Never run `migrate dev`, `migrate reset` or `db push` while `.env` points at Supabase.
2. Never answer **Yes** to *"We need to reset the database … All data will be lost"*. Say No, then ask.
3. Never pass a real database as `--shadow-database-url`.
4. Never edit a migration that has already run on the test or production database.
5. Never write a migration completely by hand — generate, then edit.
6. Never commit `schema.prisma` without its migration folder, or the other way round.
7. Never deploy code before its migration has been applied to that database.

---

## 11. When something looks strange

| You see | It means | Do |
|---|---|---|
| `following migrations have not yet been applied` | Files waiting to run — normal after new work | Snapshot → `migrate deploy` |
| `We need to reset the "public" schema` | Drift: the database differs from what the files say | **No.** Then §8 scenario 10 |
| `migrate status` shows a **failed** migration | It stopped halfway | Run nothing else. §8 scenario 9 |
| `The migration … was modified after it was applied` | Someone edited an applied file | Put the file back exactly as it was; add a new migration instead |
| `EPERM … query_engine-windows.dll.node` | The dev server holds Prisma's engine file | Stop the dev server (and any leftover `next` process), run again |
| `P1001 Can't reach database server` | Postgres is not running / wrong host | Start Postgres; check `.env` |
| `warn The configuration property package.json#prisma is deprecated` | Harmless today; Prisma 7 will need `prisma.config.ts` | §15 suggestion 6 |

---

## 12. Things specific to this project

- **`.env` flips** between localhost and Supabase. Look at it before every database command. Safer:
  set the URL for one command only instead of editing `.env`.
- **The Supabase password contains `@`.** In any URL you hand to `psql` / `pg_dump` it must be
  written `%40`. Prisma tolerates the raw `@`; libpq does not.
- **`DIRECT_URL` = 5432 session pooler.** Never 6543 for migrations or dumps.
- **The Vercel build does not run migrations** (since 7 Sep 2026). Applying them is a manual step.
- **`npm run build` takes 20–45 minutes** and needs a reachable database.
- **Backups live in `backups/`** (gitignored). They contain customer phone numbers and prices — they
  never leave the machine.

---

## 13. What went wrong here, and the lessons

| Date | What happened | Lesson |
|---|---|---|
| 8 Sep 2026 | Local `bch` wiped: it was passed as the shadow database to `migrate diff` | The shadow URL is always a throwaway database |
| 12 Sep 2026 | `20260912040000_assembly_audit_build_line` was **hand-written** with `IF NOT EXISTS` guards. It kept the old pkey name `Bin_pkey`, left `bins.warehouse_id` nullable, misnamed one index, and wrote 9 foreign keys **without `ON DELETE`**. On `bch_local` (a 14 Sep copy) those 9 keys were missing entirely | Generate, don't hand-write. Run the `--from-migrations … --exit-code` check before committing |
| 15 Sep 2026 | `migrate dev` on `bch_local` wanted a reset. Refused. Diagnosed, then fixed with `20260915201206_fix_assembly_fk_and_bins_drift` | Never reset on reflex; a fix migration repairs without losing data |

The 9 keys (all now fixed locally): `inventory_units` → InboundShipment, User (assembled by);
`assembly_tasks` → User (assigned to / by); `bin_movement_logs` → bins (from / to), User (moved by);
`complaints` → User (fault mechanic / attributed by). Without them the database accepts rows that
point at nothing — e.g. deleting a mechanic who still has a task would leave the task pointing at
nobody, and /assembly would fail with *"Field assignedTo is required to return data, got null"*.
Before the fix, `bch_local` had 0 such broken rows and 0 bins without a warehouse.

---

## 14. State right now (15 Sep 2026, night)

- **Local `bch_local`:** 18 migrations, up to date. Files-vs-schema = exit 0, database-vs-schema = exit 0.
  `migrate dev` says "Already in sync".
- **Test / production database:** **3 migrations pending** —
  1. `20260915121500_ai_call_log` (committed, `c0f437b`) — until applied, Settings → AI analytics fails there
  2. `20260915192349_product_assembly_level` (not committed yet) — one optional column, safe early
  3. `20260915201206_fix_assembly_fk_and_bins_drift` (not committed yet) — the key/name fix. It
     **refuses, and changes nothing,** if a bin there has no warehouse or a row points at a deleted
     user / shipment / bin. If it refuses: fix that data, `npx prisma migrate resolve --rolled-back
     20260915201206_fix_assembly_fk_and_bins_drift`, deploy again.
- **Your to-do:** snapshot → `migrate status` → `migrate deploy` on the test database, then the §3
  real-database check should print nothing. Commit the two new migration folders with their code.

---

## 15. My suggestions, most useful first

1. **One safe command for the "do my files match?" check** — a permanent empty `bch_shadow`
   database plus `npm run db:check`, which creates/cleans the shadow itself and exits 0/2. No long
   command, no chance of pointing the shadow at a real database.
2. **Run that check in CI on every PR** (a Postgres service container). It would have caught the
   12 Sep migration the day it was written. The `migrations` CI job in
   `docs/implementation/pending/prisma-migrations-adoption-plan.md` is still unbuilt.
3. **Build `npm run db:restore:local`** (CLAUDE.md rule 10) so the local database is always a clean
   restore of a production snapshot — not an ad-hoc copy like the 14 Sep `bch_local`.
4. **Stop editing `.env` to switch databases.** Keep localhost in `.env`; for a production command,
   set the URL for that one command only. `.env` has pointed at the wrong database more than once.
5. **Make the release checklist a habit** (§5): snapshot → status → deploy → status → `.env` back → code.
   Nothing does it for you any more.
6. **Move the Prisma config from `package.json#prisma` to `prisma.config.ts`** before upgrading to
   Prisma 7 (the warning on every command).
7. **Remove temptation:** keep `db push` for experiments on a throwaway database only, and treat any
   "reset" prompt as a stop sign.
