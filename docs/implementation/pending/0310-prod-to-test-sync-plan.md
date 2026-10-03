# Production data overrides the test database — `npm run db:sync:test`

Status: pending — approved 3 Oct 2026 by the owner's answers (secrets wiped in test; npm script on the laptop); building.
Branch: `fix/0310-audit-delete-reversal` (the 0310 repair is rehearsed on the result, R2).

---

## 0. Requirement

### 0.1 The owner's words, verbatim (3 Oct 2026)

Passwords are redacted here — this file is committed. Nothing else is changed.

> after this i need u  u to completely DATABASE_URL="postgresql://postgres.izighywsutktzarkfbiv:<redacted>@aws-0-ap-south-1.pooler.supabase.com:6543/postgres?pgbouncer=true"
> DIRECT_URL="postgATABASEresql://postgres.izighywsutktzarkfbiv:<redacted>@aws-0-ap-south-1.pooler.supabase.com:5432/postgres"
> data to test # DATABASE_URL=postgresql://postgres.unsrnmykucotyoxnhdka:<redacted>@aws-0-ap-south-1.pooler.supabase.com:6543/postgres?pgbouncer=true
> # DIRECT_URL=postgresql://postgres.unsrnmykucotyoxnhdka:<redacted>@aws-0-ap-south-1.pooler.supabase.com:5432/postgres
>  databse  create a scrip or  pipe line where the production data must override the test databse data

> dont aply it to product i need to to take the production data to the  test dataase and to perform the anction tell me what happend on this

### 0.2 Restated as requirements

| # | Requirement |
|---|---|
| R1 | **A script copies production's data over the test database** (Supabase `unsrnmykucotyoxnhdka`), replacing everything test's app tables hold. Production (`izighywsutktzarkfbiv`) is only read. |
| R2 | **The 0310 stock repair is NOT applied to production.** It runs on the test copy, and what it did is reported. |

---

## 1. Questions and clarifications

### 1.1 Decisions on record

| Date | Question | Answer |
|---|---|---|
| 3 Oct 2026 | Credentials in the test copy (Zoho / Google `integration_config`, storage keys, SMTP password, FCM service account, AI keys, push devices)? | **Wiped in test.** Test holds real stock, products and customers, and cannot reach the real Zoho books, Google contacts, mailbox or staff phones. |
| 3 Oct 2026 | How is it run? | **An npm script on the laptop.** No GitHub Action, no schedule (CLAUDE.md: no cron). |

Defaults taken without a question, each reversible:

- **Scope is the `public` schema only** — every app table, enum and `_prisma_migrations`. Supabase's own schemas (`auth`, `storage`, `realtime`, …) on test are left alone.
- **The URLs are typed, not inherited** — read from a gitignored `.env.sync` (or the environment), never from `.env`, like `push-integrations.mjs`. A copy that destroys a database should not depend on what `.env` pointed at that morning.

---

## 2. How it works today

- `npm run db:snapshot` (`scripts/db/snapshot.mjs`) dumps the database `.env` points at into `backups/`. There is no restore-to-another-database script.
- CLAUDE.md migrations rule 10 describes `npm run db:restore:local`, which "nulls the stored Zoho, storage and SMTP credentials and deletes push devices". **It was never written** — `scripts/db/restore-integrations.mjs:11-16` says so and lists what it must also null (`google_contacts` tokens).
- Production `public` (snapshot `backups/postgres-20261003-143830.dump`, `pg_restore -l`): 116 tables, 56 enum types, constraints, FKs and indexes — no functions, views, sequences, triggers or row-security policies. So dropping tables and enums and reloading them reproduces the schema exactly.
- Credential-bearing tables, columns read from the database: `integration_config` (`clientSecret`, `refreshToken`, `accessToken`, `accessTokenExpiresAt`, `isConnected`), `"StorageConfig"` (`accessKeyId`, `secretAccessKey`, `isConnected`), `notification_config` (`smtpPassword`, `fcmServiceAccount`, `emailConnected`, `pushEnabled`, `pushConnected`), `ai_provider` (`apiKey`, `isActive`, `isConnected`), `push_devices` (every row is a real phone or browser).

---

## 3. Implementation plan

`scripts/db/sync-prod-to-test.mjs`, `npm run db:sync:test`.

- **Inputs:** `SOURCE_DATABASE_URL` and `TARGET_DATABASE_URL` from the environment, else from `.env.sync`. Both must be **session** URLs (port 5432) — the 6543 transaction pooler is refused, as for `db:snapshot`.
- **Refusals, before anything is read:** source = target; a target whose user or host names a production project ref (`izighywsutktzarkfbiv`, listed in the script); a 6543 URL.
- **Default run = plan only:** prints both ends (host and project, never a URL) and row counts of the key tables on each side. Writes nothing.
- **`--yes <target-ref>`** — the target's project ref typed back (`unsrnmykucotyoxnhdka`), so swapped URLs cannot destroy the wrong database. Then:
  1. snapshot the target's `public` schema → `backups/test-<ref>-<stamp>-before-sync.dump` — the rollback;
  2. dump the source's `public` schema → `backups/prod-<ref>-<stamp>.dump`;
  3. turn it into SQL (`pg_restore -f`), without the `SCHEMA public` entries — the schema itself stays;
  4. run, with `psql --single-transaction -v ON_ERROR_STOP=1`, **in one transaction**: drop every table and enum in the target's `public` → the restore → the credential wipe. Any error rolls the whole thing back and test is left exactly as it was;
  5. compare row counts source vs target and confirm the wipe; delete the temporary SQL.
- **Logging:** plain console lines, as every `scripts/db/*` script; host and ref only, never a URL or a secret.
- Both dumps stay in `backups/` (gitignored). The production one contains plaintext credentials — it never leaves the machine (CLAUDE.md rule 10).

Schema, migration, RBAC: none.

Board of agents: `docs/agents/database-architect.md` (transactions, idempotency), `docs/agents/integration-architect.md` (the integrations the wipe disconnects).

---

## 4. Verification

- Local, two scratch databases on localhost: plan run writes nothing; `--yes` with the wrong ref refused; a production ref as target refused; `--yes <ref>` → counts equal, credentials null, push devices 0; a forced failure mid-restore leaves the target unchanged.
- Test (`unsrnmykucotyoxnhdka`): sync, then `db:repair:stock-total` dry run and `--apply` against test only — expected 13 products, +49, 7002 → 6 — and the result reported (R2).

### 4.1 Done 3 Oct 2026

- **Local** (`bch_investigate_1003` → `bch_sync_target`): plan run wrote nothing; `--yes` with the wrong ref,
  a production ref as target and a 6543 URL were each refused before anything was read; `--yes` → all 11
  counted tables equal, 5 stored secrets and 6 push devices in the source wiped in the target; `--restore`
  put the before-sync snapshot back (5753 → 5738 products, 27 → 26 migrations); with a planted
  `sql_drop` event trigger raising mid-transaction, the run failed and the target was unchanged
  (5738 / 26).
- **Test** (`unsrnmykucotyoxnhdka`), 14:50 UTC: before — test 5753 products, 471 deliveries, 14 customers,
  17 stock counts (test-only data, removed by the override; kept in the rollback snapshot); after — all 11
  counted tables equal to production (5784 products, 204 units, 0 deliveries, 0 customers, 27 migrations);
  credentials left: none. Rollback: `backups/test-unsrnmykucotyoxnhdka-20261003-145020-before-sync.dump`.
- **R2 on test:** `db:repair:stock-total` dry run 13 products / +49 → `--apply --user admin@bch.local` →
  13 repaired → dry run 0. 7002 shows 6 with one `REPAIR-0310` row (0 → 6). Production checked in a
  read-only transaction afterwards: 0 `REPAIR-0310` rows, 7002 still shows 0 — untouched.

---

## 5. Out of scope

- `db:restore:local` (production → a laptop database). The same wipe applies; it can reuse this script with a localhost target later.
- Supabase Storage objects (files, images) — they live in a separate Supabase project and are not copied.
- Re-connecting test to a sandbox Zoho / Google — done from Settings › Integrations on test when needed.
