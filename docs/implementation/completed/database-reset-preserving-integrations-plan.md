# Database reset, preserving the Zoho integration config — plan

Status: completed — 29 Aug 2026, closed WITHOUT implementation: only `ZOHO_BOOKS` was ever connected and its row is already backed up by hand in `.env`, so the export/restore scripts this plan designed are unnecessary. See §0.
Suggested branch: none — no code was written.
Prepared 29 Aug 2026. Closed 29 Aug 2026.

---

## 0. Outcome — NOT IMPLEMENTED, and it never needs to be

**No code from this plan was written.** No `backups/` directory, no `db:export:integrations`,
no `db:restore:integrations`, no `.gitignore` change. Sections 1–10 below are preserved as the
record of the approach that was designed and then found unnecessary — read them as history,
not as instructions.

### Why it was dropped

The plan exists to solve one problem: **a refresh token cannot be regenerated from the client
id and secret** (§2), so wiping `IntegrationConfig` would mean redoing the self-client
grant-token flow in the Zoho console. Two facts, both confirmed 29 Aug 2026, dissolve it.

**1. There is only one connection to lose, not three.** §2 assumes all three providers hold
live credentials. They do not — **`ZOHO_BOOKS` is the only one ever connected.** `ZAKYA_POS`
and `ZOHO_INVENTORY` have never been synced, so they hold no refresh token and a reset costs
nothing for either. (`trigger-pull/route.ts:475-477` writes `lastSyncAt` to all three, which is
what made the three-provider assumption look right on paper.)

**2. That one connection is already backed up, by hand.** The owner copied the full
`IntegrationConfig` row for `ZOHO_BOOKS` into `.env` as a commented JSON block — all twelve
columns including `clientId`, `clientSecret`, `refreshToken`, `accessToken`,
`organizationId` and `organizationName`. Restoring it is one `INSERT`, pasted back.

### Why the manual method is *better* than the scripted one

This is not a shortcut that trades safety for speed. §4 is the longest warning in this
document, and its subject is that the export writes live secrets to
`backups/integration-config.json` while **`.gitignore` has no rule that would catch that
path** — so step 1 of the runbook had to be creating the ignore rule *before the file existed*,
because a secret committed once stays in git history.

Putting the same data in `.env` removes that failure mode entirely. `.gitignore:34` is
`.env*`, and `git check-ignore -v .env` confirms the match. The file is already ignored, has
always been ignored, and needs no new rule. **The hand-rolled approach has a smaller attack
surface than the tooling this plan proposed**, which is the honest reason to prefer it —
not that it was less work.

### What the reset actually is now

```
1.  stop the dev server
2.  npx prisma db push --force-reset     <- DESTRUCTIVE: drops every table
3.  npm run db:seed                       <- RBAC, roles, admin user
4.  paste the ZOHO_BOOKS row back as one INSERT (block at the end of .env)
5.  verify Settings -> Integrations shows ZOHO_BOOKS Connected
```

Three sections below still apply and are the reason this file is kept rather than deleted:

- **§8 — which database.** `DATABASE_URL` points at the hosted Supabase instance both Vercel
  deployments read. Confirm it is the one you mean to wipe. A reset aimed at the wrong
  database cannot be undone, and no script in this plan could have caught that either.
- **§7 "Two things the reset also destroys."** Every non-admin user is gone and must be
  recreated at `/team`; the admin login is recreated from `ADMIN_ACCESS_CODE`.
- **§3.** There is no "unseed". `npm run db:seed` only ever writes — `--force-reset` is the
  only thing that removes the old sample rows.

### ⚠️ One standing obligation

**The commented block at the end of `.env` is now the only copy of that refresh token outside
Zoho's console.** It is not backed up anywhere else, and `.env` is — correctly — never
committed. Do not delete it, and do not lose the file. If `ZAKYA_POS` or `ZOHO_INVENTORY` is
ever connected, copy its row into the same block, or this plan's problem comes back for a
provider that is genuinely at risk.

---

## 1. Goal

Empty the database completely and reseed RBAC, **without losing the three Zoho connections**.

Confirmed with the owner, 29 Aug 2026: nothing in the database is worth keeping except
`IntegrationConfig`. The sample products, brands, bins, serial items, transactions and Staff
LMS rows written by earlier seeds are all disposable, and there is no real business data yet.

## 2. Why `IntegrationConfig` is the one exception

It holds `clientId`, `clientSecret`, `refreshToken`, `accessToken`, `organizationId` and
`isConnected` for `ZOHO_BOOKS`, `ZAKYA_POS` and `ZOHO_INVENTORY`.

**A refresh token cannot be regenerated from the client id and secret.** Losing it means
redoing the self-client grant-token flow in the Zoho console for all three integrations —
`zoho-config-consolidation-plan.md` §7 records this as the one practical cost of that
refactor, and there is no reason to pay it twice.

`IntegrationConfig` has no foreign key to any other table (`provider` is the primary key and
nothing references it), so it can be restored at any point after the schema exists. Order
does not matter.

## 3. Why the seed cannot do this

Repeated for the record, because it is the wrong turn this task invites:

| Command | Effect on the sample rows |
|---|---|
| `npm run db:seed` | none — a seed only ever writes, and it no longer mentions products |
| `prisma generate` | none — regenerates the TypeScript client, touches no data |
| `prisma db push` | none — syncs tables and columns, not rows |
| `prisma db push --force-reset` | **drops every table**, which is what this plan wants |

There is no "unseed". Removing the arrays from `seed.ts` stopped future writes; it could not
reach back and delete rows an earlier run had already committed.

## 4. ⚠️ The backup file holds live secrets

The export writes `clientSecret` and `refreshToken` to disk in plaintext. That file is as
sensitive as `.env`.

`.gitignore` currently has a blanket `.env*` rule and **nothing that would catch
`integration-config.json`**. The ignore rule is therefore step 1 of the runbook, before the
file exists — not after. A secret committed once stays in git history even if deleted later.

### The file is kept, not deleted

**Owner's decision, 29 Aug 2026:** the backup file and both scripts stay on disk. They are
kept out of git by the ignore rule, not by being deleted.

The reason is practical: the export is the only copy of those refresh tokens outside Zoho's
console. Keeping it means a future reset — or a botched restore — is a single
`npm run db:restore:integrations` away, instead of re-authorising three integrations by hand.

The trade-off, stated plainly so it is a choice rather than an accident: **a plaintext file
containing three client secrets and three refresh tokens lives in your working directory
indefinitely.** Anything with read access to that folder can use those credentials against
your Zoho account. That is acceptable on a single-developer machine with the git ignore in
place; it would not be on a shared or synced one. Note that `backups/` sitting inside the
repo folder means any cloud-sync tool covering that folder (OneDrive, Dropbox, Google Drive)
will copy the secrets off the machine — git is not the only way a file escapes.

If the tokens are ever rotated in Zoho, re-run the export so the backup does not go stale.

## 5. Files

### New

| File | Purpose |
|---|---|
| `prisma/export-integration-config.ts` | read every `IntegrationConfig` row, write `backups/integration-config.json` |
| `prisma/restore-integration-config.ts` | read that file, upsert the rows back |

They live in `prisma/` rather than `scripts/` because `prisma/tsconfig.json` declares
`"include": ["./**/*.ts"]` — it covers that directory and no other. Putting them there means
the existing `ts-node --project prisma/tsconfig.json` invocation works unchanged, with no new
tsconfig. `scripts/` holds one plain `.js` file and has no TypeScript setup at all.

### Modified

| File | Change |
|---|---|
| `.gitignore` | add `/backups/` |
| `package.json` | add `db:export:integrations` and `db:restore:integrations` scripts |

## 6. The scripts

**`prisma/export-integration-config.ts`** — read-only against the database.

```ts
import { PrismaClient } from "@prisma/client";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const prisma = new PrismaClient();
const OUT_DIR = join(__dirname, "..", "backups");
const OUT = join(OUT_DIR, "integration-config.json");

async function main() {
  const rows = await prisma.integrationConfig.findMany();

  // Refuse to write an empty backup. An empty file looks like a successful export and would
  // green-light the reset, destroying the only copy of the refresh tokens.
  if (rows.length === 0) {
    throw new Error(
      "No IntegrationConfig rows found. Refusing to write an empty backup — " +
        "check DATABASE_URL points at the database you mean to reset."
    );
  }

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT, JSON.stringify(rows, null, 2), "utf8");

  // Providers and connection state only. Never print a secret, per CLAUDE.md.
  for (const r of rows) {
    console.log(`  ${r.provider.padEnd(16)} connected=${r.isConnected}`);
  }
  console.log(`\nWrote ${rows.length} row(s) to ${OUT}`);
  console.log("This file contains client secrets and refresh tokens. Do not commit it.");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
```

**`prisma/restore-integration-config.ts`** — writes only this one table.

```ts
import { PrismaClient } from "@prisma/client";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const prisma = new PrismaClient();
const IN = join(__dirname, "..", "backups", "integration-config.json");

async function main() {
  if (!existsSync(IN)) throw new Error(`No backup at ${IN}. Run db:export:integrations first.`);

  const rows = JSON.parse(readFileSync(IN, "utf8"));
  if (!Array.isArray(rows) || rows.length === 0) throw new Error("Backup is empty — refusing to continue.");

  for (const r of rows) {
    // Dates come back from JSON as strings; Prisma needs Date objects.
    const data = {
      ...r,
      accessTokenExpiresAt: r.accessTokenExpiresAt ? new Date(r.accessTokenExpiresAt) : null,
      lastSyncAt: r.lastSyncAt ? new Date(r.lastSyncAt) : null,
      createdAt: new Date(r.createdAt),
      updatedAt: new Date(r.updatedAt),
    };
    // upsert, not create: makes the script safely re-runnable if a later step fails.
    await prisma.integrationConfig.upsert({
      where: { provider: r.provider },
      update: data,
      create: data,
    });
    console.log(`  restored ${r.provider}`);
  }
  console.log(`\nRestored ${rows.length} row(s).`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
```

### package.json

```json
"db:export:integrations":  "ts-node --project prisma/tsconfig.json prisma/export-integration-config.ts",
"db:restore:integrations": "ts-node --project prisma/tsconfig.json prisma/restore-integration-config.ts"
```

## 7. Runbook — in this order, no skipping

Every step is gated and prompts. **Step 3 is the point of no return.**

```
1.  add /backups/ to .gitignore          <- BEFORE the file exists
2.  npm run db:export:integrations       <- read-only
3.  ── verify the file: 3 providers, refreshToken present, non-empty ──
4.  stop the dev server
5.  npx prisma db push --force-reset      <- DESTRUCTIVE: drops all 93 tables
6.  npm run db:seed                        <- RBAC, roles, admin user
7.  npm run db:restore:integrations
8.  verify Settings -> Integrations shows all three Connected
9.  KEEP backups/integration-config.json — it stays, ignored by git
```

**Do not run step 5 until step 3 is done with your own eyes.** The export refuses to write an
empty file, but it cannot tell you it read the *wrong database* — only you can confirm
`DATABASE_URL` points where you think it does.

### Two things the reset also destroys

- **Your admin login is recreated by step 6** with `ADMIN_ACCESS_CODE`, default `ADMIN123`.
  If `.env` overrides it, that value is used. You will be signed out and must log in again.
- **Any user account other than admin is gone.** Team members must be recreated at `/team`.

## 8. Which database

`.env` has one `DATABASE_URL`, pointing at
`aws-0-ap-southeast-1.pooler.supabase.com` — the hosted Supabase instance that
`bike-inventory-delta.vercel.app` and `bike-inventory.vercel.app` both read.

**Confirm before step 5 that this is the database you mean to wipe.** The owner mentioned a
"test database url"; if a different `DATABASE_URL` is intended, it must be set in `.env`
first, and the export in step 2 re-run against it. A reset pointed at the wrong database
cannot be undone.

Both Vercel deployments will show an empty application between steps 5 and 6.

## 9. Verification

- `git status` shows **no** `backups/` entry — the ignore rule works. Check this *before*
  step 2, not after.
- Step 2 prints three providers.
- After step 6: `/team` shows one user, `/stock` shows no products, and Staff LMS screens are
  empty. That is the point.
- After step 7: Settings → Integrations shows Books, Zakya and Inventory as **Connected**,
  and each survives a page reload — proving the restored refresh tokens work, not just that
  the rows exist.
- A Zoho pull runs end to end.
- `git status` still shows nothing under `backups/` **after** the file exists. This is the
  check that matters and it is easy to skip — run it once the export has written the file,
  not only before.

## 10. If the restore fails

The backup file stays on disk permanently, so `npm run db:restore:integrations` can be re-run
at any time — it upserts rather than creates, so a partial or repeated restore is safe.

If the file is lost or the tokens no longer work, the fallback is the manual path: reconnect
all three in Settings → Integrations using the self-client grant-token flow in the Zoho
console. Keep the three client ids and secrets to hand before starting step 5, so that
fallback is available and does not depend on the backup.
