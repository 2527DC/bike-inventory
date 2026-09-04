# Prisma Migrate adoption — baseline production, migrate on deploy, replicate to local

Status: pending
Branch: **`chore/prisma-migrations`** — create it with exactly this name, off `main`.
Prepared 2 Sep 2026, the day before the application goes into production use.

---

## 0. The decision

**Use Prisma Migrate. Retire `prisma db push` the moment production holds real data.**

`db push` was the right tool while the database was disposable: it diffs the schema against
the live database and applies whatever it takes to make them match. That is exactly what makes
it wrong from tomorrow on:

| | `prisma db push` | `prisma migrate` |
|---|---|---|
| What it applies | Whatever SQL Prisma computes **at that moment**, against **that database** | SQL files that were **written, read and committed** before anyone ran them |
| Record of what ran | None | `_prisma_migrations` table — every change, when, by which file |
| A column drop | Asks interactively; in CI needs `--accept-data-loss`, which is the flag that deletes columns without asking | Visible as `DROP COLUMN` in the pull request diff before it can reach production |
| A column rename | Impossible — drop + create, data gone | Hand-edit the file to `ALTER TABLE … RENAME COLUMN` |
| Backfill (new NOT NULL on a populated table) | Fails, or you accept data loss | `ADD COLUMN … NULL; UPDATE …; ALTER COLUMN … SET NOT NULL` in the same file |
| Runs non-interactively on Vercel | Only with `--accept-data-loss` | `migrate deploy` — that is what it is for |
| Two people's changes | Last push wins; nobody sees the other's | Two migration folders; ordering is explicit and both are in git |
| Rollback | None | None either (Prisma has no down migrations) — a **snapshot** is the rollback in both cases, see §11 |

Every prior plan in this repo that touched the schema wrote a paragraph explaining why
`db push` was risky *this time* and how the author would read the SQL first
(`analytics-merge-plan.md` §3.4, `app-logic-and-problems-removal-plan.md` §7,
`store-hierarchy-and-team-plan.md` Phase 4, `stock-management-module-and-zoho-item-removal-plan.md`
§17.2). Migrate makes that paragraph the mechanism instead of a promise.

**What `db push` remains good for:** nothing in this repo. Throwaway prototyping on a
database nobody cares about is the only honest use, and a local replica of production (§8) is
not that database.

## 1. What exists today (verified 2 Sep 2026)

- No `prisma/migrations/` directory. Every table in production was created by `db push`.
- `prisma` / `@prisma/client` **6.19.3**. `migrate diff --output`, `migrate resolve --applied`
  and `migrate deploy` are all available.
- `schema.prisma` datasource already declares `directUrl = env("DIRECT_URL")`. Migrate uses
  `DIRECT_URL`; the app uses `DATABASE_URL`.
- `.env` points both URLs at **`localhost:5432`** (local Postgres). The Supabase URLs are in
  `.env.bak-partB`: `DATABASE_URL` on the **6543 transaction pooler** with `pgbouncer=true`,
  `DIRECT_URL` on the **5432 session pooler**. Production on Vercel is assumed to use the same
  pair (Q1).
- `package.json` `build` = `prisma generate && next build`. `vercel.json` sets only the
  region (`bom1`); the build command is Vercel's default, `npm run build`.
- `npm run build` no longer opens a database connection
  (`ci-build-database-dependency-plan.md`, 29 Aug 2026). After this plan, `migrate deploy` is
  the **only** thing that touches the database during a build.
- CI (`.github/workflows/typecheck.yml`) runs typecheck + build on pull requests, with no
  Postgres service. It cannot currently tell whether the schema and the database agree.
- `pg_dump` / `psql` **17.6** are on the owner's PATH (`C:\Program Files\PostgreSQL\17`).
- `prisma/seed-rbac.ts` is idempotent (8 upserts) but **deletes** modules and permissions
  that left the catalog, with cascades into `RolePermission`. It is data, not schema, and
  stays a manual post-deploy step.
- `.claude/hooks/ask-git-npm.js` gates git and denies writes to `main`. It says nothing about
  Prisma.

## 2. Questions that change the build — answer before §3

- **Q1.** Is the production database the Supabase project whose URLs are in `.env.bak-partB`,
  and does Vercel's **Production** environment carry exactly those two URLs? (§3 and §4
  assume yes.)
- **Q2.** Does Vercel deploy `main` automatically through the GitHub integration? (§4 assumes
  yes; if deploys are triggered by hand, the build command still applies unchanged.)
- **Q3.** Do **Preview** deployments today point at the production database? If yes, §4's
  build script must keep skipping migrations on preview (it does by default) until a staging
  database exists (§9). If preview already has its own database, set `MIGRATE_ON_PREVIEW=1`
  in the Preview environment and preview URLs will migrate their own database.
- **Q4.** Has `feat/notifications-and-settings-rbac` already been `db push`ed into production?
  §3 step 1 answers this mechanically; it decides whether that branch's first migration is
  *applied* by the build or *marked applied* by hand (§3 step 8).

## 3. One-time baseline — production keeps every row

> **Status, 2 Sep 2026 (late evening).** Q4 = **yes**: the notifications branch was `db push`ed into
> production earlier that day, so the baseline was generated from **`feat/notifications-and-settings-rbac`**
> (step 2 below, `--from-empty`, no database contact): `prisma/migrations/0_init/migration.sql` — 98 tables,
> 39 types, 237 indexes, 145 FKs, no DROP — plus `migration_lock.toml`. It **includes the five notification
> tables**, so step 8 is moot: there is no separate notifications migration. **Local** `bch` was created
> (it did not exist), `migrate deploy` applied `0_init`, `migrate status` is up to date, and RBAC + stores
> are seeded. **Production is NOT baselined yet** — steps 0, 1, 3 and 4 are still to run against the
> session pooler, and step 1’s diff must come back empty against the branch schema before step 3.
>
> **Later the same night — the CLOUD TEST database is baselined.** The Supabase project in
> `.env.bak-partB` turned out to hold test data only (0 vendors, 0 products, 7 customers, 3 users). With
> `.env` pointed at it: step 1’s diff printed `-- This is an empty migration.` (27 s), step 3
> `migrate resolve --applied 0_init` → "marked as applied", step 4 `migrate status` → up to date, and
> `migrate deploy` → "No pending migrations to apply." Step 0’s snapshot was skipped because the database
> holds no production data. **Whether a separate production project exists, and its state, is still Q1.**
> Gotcha recorded: the Supabase password contains `@`, so `psql`/`pg_dump` need it percent-encoded.

Prisma's own procedure for a database that predates migrations: write one migration that
recreates the current schema from nothing, then tell the database it has already run. No DDL
executes against production; the only write is one row in a new `_prisma_migrations` table.

Do this on `chore/prisma-migrations`, cut from `main`, **with `.env` temporarily pointing
`DIRECT_URL` at the production session pooler (port 5432)**. Restore `.env` to localhost at
the end. Run in Git Bash — PowerShell's `>` writes UTF-16, and `--output` avoids the shell
redirect anyway.

```bash
# 0. Freeze. From this line on nobody runs `db push` against anything.
#    Snapshot production first (§8) — this file is the rollback for every step below.
npm run db:snapshot

# 1. Prove production == schema.prisma on main. Read-only.
npx prisma migrate diff \
  --from-schema-datasource prisma/schema.prisma \
  --to-schema-datamodel    prisma/schema.prisma \
  --script
#    Expected output, exactly:   -- This is an empty migration.
#    Anything else means the deployed database and main's schema disagree. STOP and read it:
#      * additive only (CREATE TABLE / ADD COLUMN)  -> the notifications branch was pushed
#        already (Q4 = yes). Baseline from the branch's schema instead: check it out, re-run
#        this diff, expect empty, continue.
#      * contains DROP                                -> a table exists in production that the
#        schema no longer names. Decide what it is before going on; do not baseline over it.

# 2. Write the baseline migration. Read-only against the database (it uses --from-empty).
mkdir -p prisma/migrations/0_init
npx prisma migrate diff \
  --from-empty \
  --to-schema-datamodel prisma/schema.prisma \
  --script \
  --output prisma/migrations/0_init/migration.sql
printf 'provider = "postgresql"\n' > prisma/migrations/migration_lock.toml

# 3. Tell production the baseline has already run. Creates _prisma_migrations, inserts 1 row.
npx prisma migrate resolve --applied 0_init

# 4. Verify.
npx prisma migrate status
#    Expected:   Database schema is up to date!
#    and step 1's diff must still print "-- This is an empty migration."

# 5. Restore .env to localhost. Then bring local under the same history:
npm run db:restore:local -- backups/<the file from step 0>
#    _prisma_migrations travels with the dump, so local is baselined by the restore.
#    (Alternative if you would rather keep local's rows: repeat step 1 against localhost,
#     expect empty, then `npx prisma migrate resolve --applied 0_init`.)

# 6. Commit prisma/migrations/ (both files) with the §4 wiring, push the branch, open the PR.
```

**Step 7 — first deploy.** Merge. In the Vercel build log expect
`No pending migrations to apply.` followed by `prisma generate` and `next build`. That line
is the proof that production, the migrations folder and the build agree.

**Step 8 — the notifications branch.** Rebase `feat/notifications-and-settings-rbac` onto
`main`. With `.env` on localhost run `npx prisma migrate dev --name notifications`; it
writes the migration for the five notification tables and applies it locally. Then:

- Q4 = no (production lacks the tables): commit it; the build applies it on merge. Normal path.
- Q4 = yes (the tables are already in production because the branch was pushed): the build
  would fail with `relation "NotificationConfig" already exists`. Before merging, run
  `npx prisma migrate resolve --applied <its folder name>` against production, once, the same
  way as step 3. Say so in the PR.

## 4. Vercel — migrate first, then build, then swap

Vercel's Git integration builds on every push and swaps traffic only when the build succeeds.
Putting `migrate deploy` at the front of the build gives the ordering the owner asked for:
**the migration must succeed or the deploy does not happen.** A migration failure fails the
build, production keeps running the previous code on the previous schema, and nothing is
half-done from the app's point of view.

`vercel.json`:

```json
{
  "regions": ["bom1"],
  "buildCommand": "node scripts/vercel-build.mjs"
}
```

`scripts/vercel-build.mjs` (new; outside `src/`, so the `console.log` ban does not apply —
there is no other channel in a build container, and it must never print a URL):

```js
// Vercel build entry. Order matters: migrate -> generate -> build.
// A failed step fails the build, and a failed build is never deployed.
import { execSync } from "node:child_process";

const env = process.env.VERCEL_ENV ?? "local"; // production | preview | development
const say = (m) => console.log(`[vercel-build] ${m}`);
const run = (cmd) => { say(cmd); execSync(cmd, { stdio: "inherit" }); };

const migrate =
  env === "production" ||
  (env === "preview" && process.env.MIGRATE_ON_PREVIEW === "1");

if (migrate) {
  const url = process.env.DIRECT_URL ?? "";
  if (!url) throw new Error("DIRECT_URL is not set for this environment; migrate deploy needs it");
  if (/:6543(\/|\?|$)/.test(url)) {
    throw new Error("DIRECT_URL points at the 6543 transaction pooler; migrate deploy hangs there. Use the 5432 session pooler.");
  }
  run("npx prisma migrate deploy");
} else {
  say(`${env}: migrations skipped (preview migrates only with MIGRATE_ON_PREVIEW=1)`);
}
run("npx prisma generate");
run("npx next build");
```

`npm run build` stays `prisma generate && next build` for CI and local, where there is no
database to migrate.

**Vercel environment variables** (Settings → Environment Variables):

| Variable | Production | Preview |
|---|---|---|
| `DATABASE_URL` | 6543 pooler, `?pgbouncer=true` (unchanged) | staging's, once §9 exists |
| `DIRECT_URL` | **5432 session pooler** — the script refuses 6543 | staging's, once §9 exists |
| `MIGRATE_ON_PREVIEW` | unset | `1` only after Preview has its own database |

Why the session pooler and not the direct `db.<ref>.supabase.co` host: the direct host is
IPv6-only on Supabase's free tier and Vercel's builders are not guaranteed IPv6. The 5432
session pooler is IPv4 and holds a real session, which is what Migrate's advisory lock needs.
§17.2 of the stock-management plan records the 6543 hang first-hand.

## 5. The workflow from the day the baseline lands

1. Edit `prisma/schema.prisma`.
2. `npx prisma migrate dev --name <what-changed>` — **on localhost only**. It writes
   `prisma/migrations/<timestamp>_<name>/migration.sql`, applies it locally and regenerates
   the client. (Stop the dev server first: `prisma generate` fails with `EPERM` while it runs.)
3. **Read the SQL.** If it contains `DROP`, `ALTER COLUMN … TYPE`, or `SET NOT NULL` on a
   populated table, edit the file by hand before committing: rename instead of drop+create,
   add nullable → backfill → set not null. `migrate dev` will apply your edited version.
4. Commit the schema and the migration folder **in the same commit**. Never one without the
   other — the CI check in §7 fails the PR if they disagree.
5. Pull request. The reviewer's job includes reading `migration.sql`.
6. Merge → Vercel build → `migrate deploy` → `next build` → swap.
7. If the change added modules or permissions, the owner runs `npm run db:seed:rbac` against
   production after the deploy, as today. It is data; it is not a migration.

**Never, against any URL that is not localhost:** `db push`, `migrate dev`, `migrate reset`,
`--force-reset`, `--accept-data-loss`. **Never** edit a migration that has been merged; add a
new one. **Never** change production through the Supabase SQL editor — the next
`migrate deploy` will either fail on the object you created or silently diverge from it.

## 6. The ordering rule that keeps deploys zero-downtime

The migration runs **before** the new code is live. For the one to three minutes between
`migrate deploy` finishing and the swap, the **previous** deployment is serving requests
against the **new** schema. So every migration must be something the previous code survives:

- Adding a table, adding a nullable column, adding a column with a default, adding an index:
  fine.
- Dropping or renaming a column the previous code still reads: **not fine** — it will 500
  until the swap. Do it in two releases: first ship code that stops using the column, then
  ship the migration that drops it.
- Making a column NOT NULL: the previous code may still insert without it. Ship the
  code that always writes it first; add the constraint in the next release.

## 7. CI — prove the migrations folder matches the schema

The one failure mode Migrate introduces: someone edits `schema.prisma`, forgets step 2, and
the build deploys a Prisma client that expects a column no migration creates. Catch it on the
pull request. New job in `.github/workflows/typecheck.yml`, parallel to `typecheck`:

```yaml
  migrations:
    name: Migrations match schema
    runs-on: ubuntu-latest
    timeout-minutes: 10
    services:
      postgres:
        image: postgres:17
        env:
          POSTGRES_PASSWORD: ci
          POSTGRES_DB: ci
        ports: ["5432:5432"]
        options: >-
          --health-cmd pg_isready --health-interval 5s --health-timeout 5s --health-retries 10
    env:
      DATABASE_URL: postgresql://postgres:ci@localhost:5432/ci
      DIRECT_URL: postgresql://postgres:ci@localhost:5432/ci
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      # Apply every committed migration to an empty database …
      - run: npx prisma migrate deploy
      # … then ask whether schema.prisma still wants anything more. Exit 2 = it does =
      # someone changed the schema without running `migrate dev`. Fails the PR.
      - run: >-
          npx prisma migrate diff
          --from-schema-datasource prisma/schema.prisma
          --to-schema-datamodel prisma/schema.prisma
          --exit-code
```

Also add `Migrations match schema` to the branch-protection contexts listed at the top of
that file.

## 8. Production → local replica, so decisions are made on real data

Two scripts, Node so they run the same from PowerShell and Git Bash, shelling out to the
PostgreSQL 17 tools already installed. `pg_dump` 17 can dump any Supabase Postgres version.

**`scripts/db/snapshot-prod.mjs`** — `npm run db:snapshot`

- Reads `PROD_DIRECT_URL` from the environment (NOT from `.env`, so a snapshot cannot be
  taken by accident from whatever `.env` happens to hold). Refuses a URL on port 6543.
- Runs `pg_dump "<url>" --format=custom --schema=public --no-owner --no-privileges --file backups/prod-<YYYYMMDD-HHMM>.dump`.
  `--schema=public` leaves out Supabase's `auth`, `storage`, `extensions` schemas, which do
  not exist locally and would fail the restore. `_prisma_migrations` is in `public`, so the
  migration history travels with the data.
- Prints the path and size. Never prints the URL.

**`scripts/db/restore-local.mjs <dump>`** — `npm run db:restore:local -- backups/<file>`

- Target is `DATABASE_URL` from `.env`. **Refuses unless the host is `localhost`,
  `127.0.0.1` or `::1`.** This is the guard that makes the script safe to have in the repo.
- `DROP SCHEMA public CASCADE; CREATE SCHEMA public;` then
  `pg_restore --no-owner --no-privileges --dbname "<url>" <dump>`.
- **Scrubs stored credentials** unless `--keep-secrets` is passed, because a replica with live
  tokens can act on the real world from a laptop:

  | Table | Columns nulled | What it would otherwise do from local |
  |---|---|---|
  | `IntegrationConfig` | `clientSecret`, `refreshToken`, `accessToken` | pull from and **push to** the real Zoho Books org |
  | `StorageConfig` | `secretAccessKey` | write test uploads into the production bucket |
  | `NotificationConfig` | `smtpPassword`, `fcmServiceAccount` | email and push real staff |
  | `PushDevice` | every row deleted | push to staff phones |

  Pass `--keep-secrets` only for a scenario that genuinely needs Zoho, and know that the
  Zoho writes revived by `zoho-provider-endpoint-registry-plan.md` Part B are real.
- Ends with `npx prisma migrate status` (must say up to date) and `npx prisma generate`.

**Rules**

- `backups/` is gitignored. A dump holds every customer phone number and every plaintext
  secret in the config tables. It never leaves the owner's machine and never goes into a
  chat or a ticket.
- Take a snapshot **before merging any PR that contains a migration**. Supabase's free tier
  keeps no backups; on Pro it keeps daily ones. Either way the snapshot is the only rollback
  that is under the project's control (§11).
- Refresh local from a snapshot **before designing a schema change or reproducing a bug**.
  Seed data is for an empty database; a decision about production is made on production's
  shape.

## 9. Staging — recommended, not required for tomorrow

A second Supabase project (`bch-staging`, free tier) restored from a snapshot gives Preview
deployments a database that is production-shaped and disposable. Then:

- Vercel Preview env: `DATABASE_URL` / `DIRECT_URL` → staging, `MIGRATE_ON_PREVIEW=1`.
- Every PR's preview URL runs against migrated staging data, so a screen can be walked on
  real-shaped rows before merge.
- `restore-local.mjs` gains a `--to staging` mode that reads `STAGING_DIRECT_URL` and
  refuses any host that appears in `PROD_DIRECT_URL`.

Until it exists, previews skip migrations and may 500 on screens that use new columns.
That is the honest state and is preferable to previews migrating production.

## 10. Guard rails — make the rules mechanical

- **`package.json`**: delete `db:push`. Add
  `db:migrate:status` (`prisma migrate status`), `db:snapshot`, `db:restore:local`.
  `db:migrate` stays `prisma migrate dev`.
- **`.claude/hooks/ask-git-npm.js`**, new Rule 3, same pattern as Rule 2: **deny**
  `prisma db push`, `prisma migrate reset`, `--force-reset`, `--accept-data-loss`
  regardless of URL. Nobody needs them from this session, and a prompt gets approved by
  reflex. `prisma migrate resolve` and `prisma migrate deploy` are run from this session only
  during §3 — prompt (`ask`) rather than deny, so the one-time baseline can happen.
- **`.gitignore`**: `/backups/`.
- **`docs/agents/database-architect.md`**, **`.claude/skills/db-designer/`**: say
  "migration" where they said `db push` (done alongside this plan on 2 Sep 2026).
- **`CLAUDE.md`**: the "Database changes go through Prisma Migrate" section (done 2 Sep 2026).

## 11. When it goes wrong

- **Build fails in `migrate deploy`.** Production is untouched by the code; the previous
  deployment is still live. `_prisma_migrations` has the migration marked *failed*. Read the
  Vercel log; fix the SQL **in a new migration or by hand on the database**, then
  `npx prisma migrate resolve --rolled-back <name>` (if you undid its effects) or
  `--applied <name>` (if you completed them by hand), and redeploy. Prisma's guide:
  <https://www.prisma.io/docs/orm/prisma-migrate/workflows/patching-and-hotfixing>.
- **Migration applied, new code is wrong.** Roll the code back in Vercel (Instant Rollback)
  — the schema is additive by §6, so the previous code runs on it. Fix forward.
- **Data was lost.** Restore the pre-merge snapshot into a fresh Supabase project (or the
  same one after a `DROP SCHEMA public`), repoint Vercel, redeploy. This is the reason §8
  says snapshot **before** the merge, not after.
- **Drift appears** (`migrate status` reports it, or `migrate deploy` fails on an object that
  exists): someone changed production outside a migration. Find it with the §3 step-1 diff,
  write a migration that matches what is there, `migrate resolve --applied` it.

## 12. Files

| File | Change |
|---|---|
| `prisma/migrations/0_init/migration.sql`, `prisma/migrations/migration_lock.toml` | new — §3 |
| `vercel.json` | `buildCommand` — §4 |
| `scripts/vercel-build.mjs` | new — §4 |
| `scripts/db/snapshot-prod.mjs`, `scripts/db/restore-local.mjs` | new — §8 |
| `package.json` | scripts — §10 |
| `.github/workflows/typecheck.yml` | `migrations` job — §7 |
| `.claude/hooks/ask-git-npm.js` | Rule 3 — §10 |
| `.gitignore` | `/backups/` |
| Vercel dashboard | `DIRECT_URL` on 5432 for Production; `MIGRATE_ON_PREVIEW` unset |

Nothing under `src/` changes. No runtime behaviour changes.

## 13. Verification

- [ ] §3 step 1 diff printed `-- This is an empty migration.` against production
- [ ] `npx prisma migrate status` against production: `Database schema is up to date!`
- [ ] `_prisma_migrations` in production has exactly one row, `0_init`, `finished_at` set
- [ ] A row count on `Product`, `Customer`, `User` before and after §3 is identical
- [ ] `npm run db:restore:local` on the step-0 dump; `migrate status` on localhost up to date
- [ ] First Vercel build log shows `No pending migrations to apply.`
- [ ] CI `Migrations match schema` is green on the PR, and goes red on a throwaway commit
      that edits `schema.prisma` without a migration
- [ ] `npm run db:push` no longer exists; the hook denies `prisma db push`

## 14. Knowingly given up

- No down migrations. Rollback is a snapshot, which is what it was with `db push` too.
- Previews without a staging database cannot exercise new columns.
- The RBAC catalog stays a manual seed after deploy, not a data migration. Turning
  `seed-rbac.ts` into migrations would put permissions back in files, which CLAUDE.md forbids.
