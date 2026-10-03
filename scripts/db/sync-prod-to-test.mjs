// Production data overrides the test database.
//
//     npm run db:sync:test                                      plan only — reads both ends, writes nothing
//     npm run db:sync:test -- --yes <target-ref>                replaces test's app tables with production's
//     npm run db:sync:test -- --restore <file> --yes <target-ref>   puts a "before-sync" snapshot back (rollback)
//
// Plan 0310-prod-to-test-sync (owner, 3 Oct 2026).
//
// THE TWO URLS ARE TYPED, NEVER INHERITED
// ---------------------------------------
// `SOURCE_DATABASE_URL` (production) and `TARGET_DATABASE_URL` (test) come from the environment,
// else from `.env.sync` in the project root (gitignored by `.env*`). Never from `.env`: a copy that
// destroys a database must not depend on whatever `.env` pointed the app at that morning.
// Both must be SESSION urls (port 5432) — pg_dump and a long transaction need a real session, which
// the 6543 transaction pooler does not give. A password containing `@` or `#` must be
// percent-encoded (`@` → `%40`). `--restore` needs only the target.
//
// WHAT IT DOES WITH --yes
// -----------------------
//   1. snapshots the target's `public` schema → backups/test-<ref>-<stamp>-before-sync.dump (rollback);
//   2. dumps the source's `public` schema   → backups/prod-<ref>-<stamp>.dump;
//   3. in ONE transaction on the target: drops every table and enum in `public`, restores the
//      source's, then WIPES the credentials (below). Any error rolls all of it back — test is then
//      exactly as it was;
//   4. compares row counts and confirms the wipe.
// Only `public` is touched — every app table, enum and `_prisma_migrations`. Supabase's own schemas
// (auth, storage, realtime, …) on the target are left alone. Production's public schema holds only
// tables, enums, indexes and constraints (no functions, views or triggers), so dropping tables and
// enums and reloading them reproduces it exactly.
//
// THE WIPE (owner, 3 Oct 2026: "wipe them in test")
// --------------------------------------------------
// Production stores live credentials in plaintext. Copied as-is, the test app could write to the
// real Zoho books, the real Google contacts, send mail from the shop's mailbox and push to staff
// phones. So in the target: integration_config secrets and tokens nulled and disconnected (Zoho,
// Google Contacts — every provider), StorageConfig keys, the SMTP password and FCM service account,
// AI provider keys — all nulled — and every push device deleted. Reconnect a sandbox from
// Settings › Integrations on test when one is needed.
//
// REFUSES: source = target; a target naming a production project ref (PRODUCTION_REFS); a 6543
// / pgbouncer URL; `--yes` with anything but the target's own ref typed back.
//
// The production dump keeps plaintext credentials. It stays in backups/ and never leaves the
// machine (CLAUDE.md migrations rule 10). Prints hosts and project refs only, never a URL.

import { readFileSync, mkdirSync, writeFileSync, existsSync, statSync, mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

/** Supabase project refs that are production. Never a target. */
const PRODUCTION_REFS = ["izighywsutktzarkfbiv"];

/** Tables compared after the copy — what the shop would notice missing. */
const COUNTED_TABLES = [
  "Product", "StockLevel", "inventory_units", "bin_stocks", "InventoryTransaction",
  "TransferOrder", "StockCount", "Delivery", "Customer", "User", "_prisma_migrations",
];

function fail(message) {
  console.error(`\ndb:sync:test: ${message}`);
  process.exit(1);
}
const hideUrls = (s) => String(s ?? "").replace(/postgres(ql)?:\/\/[^\s'"]+/g, "<url>");

// ── Arguments ──────────────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const valueAfter = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] ?? "" : undefined;
};
const confirmRef = valueAfter("--yes");
const restoreFile = valueAfter("--restore");
if (confirmRef === "") fail("--yes needs the target's project ref typed after it, e.g. --yes unsrnmykucotyoxnhdka");
if (restoreFile === "") fail("--restore needs a dump file, e.g. --restore backups/test-<ref>-<stamp>-before-sync.dump");
if (restoreFile !== undefined && !existsSync(restoreFile)) fail(`${restoreFile} does not exist.`);

// ── The URLs ───────────────────────────────────────────────────────────────────────────────
function fromSyncFile(key) {
  if (!existsSync(".env.sync")) return undefined;
  const m = readFileSync(".env.sync", "utf8").match(new RegExp(`^${key}="?([^"\\n]+)`, "m"));
  return m?.[1].trim();
}
const sourceUrl = process.env.SOURCE_DATABASE_URL || fromSyncFile("SOURCE_DATABASE_URL");
const targetUrl = process.env.TARGET_DATABASE_URL || fromSyncFile("TARGET_DATABASE_URL");
if (!targetUrl || (!sourceUrl && restoreFile === undefined)) {
  fail(
    "set SOURCE_DATABASE_URL (production) and TARGET_DATABASE_URL (test), in the environment or in .env.sync:\n" +
      '   SOURCE_DATABASE_URL="postgresql://postgres.<prod-ref>:<password>@<host>:5432/postgres"\n' +
      '   TARGET_DATABASE_URL="postgresql://postgres.<test-ref>:<password>@<host>:5432/postgres"'
  );
}

function describe(url, label) {
  let u;
  try {
    u = new URL(url);
  } catch {
    fail(`${label} is not a valid URL — a password with @ or # must be percent-encoded (@ → %40).`);
  }
  if (!/^postgres(ql)?:$/.test(u.protocol)) fail(`${label} is not a postgresql:// URL.`);
  if (u.port === "6543" || u.searchParams.has("pgbouncer")) {
    fail(`${label} is the 6543 transaction pooler. Use the 5432 session URL (DIRECT_URL).`);
  }
  const user = decodeURIComponent(u.username);
  const db = decodeURIComponent(u.pathname.replace(/^\//, "")) || "postgres";
  // Supabase pooler users are `postgres.<project-ref>`; elsewhere the database name identifies it.
  const ref = user.includes(".") ? user.split(".").slice(1).join(".") : db;
  return { url, host: u.hostname, port: u.port || "5432", user, db, ref };
}
const target = describe(targetUrl, "TARGET_DATABASE_URL");
const source = restoreFile === undefined ? describe(sourceUrl, "SOURCE_DATABASE_URL") : null;

if (PRODUCTION_REFS.some((r) => target.ref === r || target.user.includes(r) || target.host.includes(r))) {
  fail(`the target ${target.ref} is PRODUCTION. This script only ever writes to test.`);
}
if (source && source.host === target.host && source.port === target.port && source.user === target.user && source.db === target.db) {
  fail("source and target are the same database.");
}

if (source) console.log(`\nsource (read):        ${source.ref}  at ${source.host}:${source.port}/${source.db}`);
else console.log(`\nsource (file):        ${restoreFile}`);
console.log(`target (overwritten): ${target.ref}  at ${target.host}:${target.port}/${target.db}\n`);

// ── Tools ──────────────────────────────────────────────────────────────────────────────────
for (const tool of ["pg_dump", "pg_restore", "psql"]) {
  const r = spawnSync(tool, ["--version"], { encoding: "utf8" });
  if (r.status !== 0) fail(`${tool} not found on PATH — install the PostgreSQL client tools (17+).`);
}

function run(tool, toolArgs, what) {
  const r = spawnSync(tool, toolArgs, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0) fail(`${what} failed:\n${hideUrls(r.stderr || r.stdout).trim().split("\n").slice(-8).join("\n")}`);
  return r.stdout;
}
const sql = (end, query, what) => run("psql", [end.url, "-X", "-tA", "-v", "ON_ERROR_STOP=1", "-c", query], what).trim();

const tableList = COUNTED_TABLES.map((t) => `'${t}'`).join(",");
const COUNT_QUERY = `
  SELECT t || '=' || (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM public.%I', t), false, true, '')))[1]::text
  FROM unnest(ARRAY[${tableList}]) AS t
  WHERE to_regclass(format('public.%I', t)) IS NOT NULL`;

function counts(end) {
  const out = sql(end, COUNT_QUERY, `counting rows on ${end.ref}`);
  return new Map(out.split("\n").filter(Boolean).map((l) => l.split("=")).map(([t, n]) => [t, Number(n)]));
}
function printCounts(header, tgtCounts, srcCounts, compare) {
  console.log(header);
  for (const t of COUNTED_TABLES) {
    const g = tgtCounts.has(t) ? String(tgtCounts.get(t)) : "—";
    if (!srcCounts) {
      console.log(`   ${t.padEnd(22)} test ${g.padStart(7)}`);
      continue;
    }
    const s = srcCounts.has(t) ? String(srcCounts.get(t)) : "—";
    const mark = compare ? (s === g ? "  ok" : "  DIFFERENT") : "";
    console.log(`   ${t.padEnd(22)} prod ${s.padStart(7)}   test ${g.padStart(7)}${mark}`);
  }
}

/**
 * Replace the target's `public` app tables with a dump's, in ONE transaction: drop every table and
 * enum → restore → (optionally) wipe the credentials. Any error rolls back all three.
 */
function replaceTarget(dumpFile, { wipe }) {
  const work = mkdtempSync(join(tmpdir(), "bch-sync-"));
  try {
    // The restore as SQL, without the `public` schema's own entries — the schema stays.
    const listFile = join(work, "restore.list");
    const list = run("pg_restore", ["-l", dumpFile], "listing the dump")
      .split("\n")
      .filter((l) => !/ SCHEMA - public /.test(l) && !/ COMMENT - SCHEMA public /.test(l))
      .join("\n");
    writeFileSync(listFile, list);
    const restoreSql = join(work, "restore.sql");
    run("pg_restore", ["--no-owner", "--no-acl", "-L", listFile, "-f", restoreSql, dumpFile], "preparing the restore");

    const dropSql = join(work, "drop.sql");
    writeFileSync(
      dropSql,
      `DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('DROP TABLE IF EXISTS public.%I CASCADE', r.tablename);
  END LOOP;
  FOR r IN SELECT t.typname FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
           WHERE n.nspname = 'public' AND t.typtype = 'e' LOOP
    EXECUTE format('DROP TYPE IF EXISTS public.%I CASCADE', r.typname);
  END LOOP;
END $$;
`
    );
    const files = ["-f", dropSql, "-f", restoreSql];

    if (wipe) {
      // Schema-qualified: the restore ends with search_path set to ''.
      const wipeSql = join(work, "wipe.sql");
      writeFileSync(
        wipeSql,
        `UPDATE public.integration_config SET "clientSecret" = NULL, "refreshToken" = NULL, "accessToken" = NULL, "accessTokenExpiresAt" = NULL, "isConnected" = false;
UPDATE public."StorageConfig" SET "accessKeyId" = NULL, "secretAccessKey" = NULL, "isConnected" = false;
UPDATE public.notification_config SET "smtpPassword" = NULL, "fcmServiceAccount" = NULL, "emailConnected" = false, "pushEnabled" = false, "pushConnected" = false;
UPDATE public.ai_provider SET "apiKey" = NULL, "isActive" = false, "isConnected" = false;
DELETE FROM public.push_devices;
`
      );
      files.push("-f", wipeSql);
    }

    run(
      "psql",
      [target.url, "-X", "-q", "-v", "ON_ERROR_STOP=1", "--single-transaction", ...files],
      "replacing test's data (nothing was changed — the transaction rolled back)"
    );
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

function snapshotTarget(stamp) {
  mkdirSync("backups", { recursive: true });
  const file = join("backups", `test-${target.ref}-${stamp}-before-${restoreFile === undefined ? "sync" : "restore"}.dump`);
  run("pg_dump", ["-Fc", "--no-owner", "--no-acl", "-n", "public", "-f", file, target.url], "snapshotting test");
  console.log(`   ${file}  (${(statSync(file).size / 1024 / 1024).toFixed(1)} MB)`);
  return file;
}

// ── Plan ───────────────────────────────────────────────────────────────────────────────────
const targetVersion = sql(target, "SHOW server_version", `reading ${target.ref}`);
if (source) {
  const sourceVersion = sql(source, "SHOW server_version", `reading ${source.ref}`);
  console.log(`server versions: prod ${sourceVersion}, test ${targetVersion}`);
  if (parseInt(sourceVersion, 10) !== parseInt(targetVersion, 10)) {
    fail("the two servers are on different major PostgreSQL versions — a dump of one may not restore into the other.");
  }
}
const before = counts(target);
printCounts("\nbefore:", before, source ? counts(source) : null, false);

if (confirmRef === undefined) {
  console.log(`\nPlan only — nothing written. To go ahead:`);
  console.log(
    restoreFile === undefined
      ? `   npm run db:sync:test -- --yes ${target.ref}`
      : `   npm run db:sync:test -- --restore ${restoreFile} --yes ${target.ref}`
  );
  process.exit(0);
}
if (confirmRef !== target.ref) fail(`--yes ${confirmRef} does not match the target's ref (${target.ref}). Nothing written.`);

const d = new Date();
const pad = (n) => String(n).padStart(2, "0");
const stamp = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;

// ── Rollback mode ──────────────────────────────────────────────────────────────────────────
if (restoreFile !== undefined) {
  console.log("\n1. snapshot of test as it is now");
  snapshotTarget(stamp);
  console.log(`2. test: drop app tables → restore ${restoreFile} (one transaction, no wipe — it is test's own)`);
  replaceTarget(restoreFile, { wipe: false });
  printCounts("\nafter:", counts(target), null, false);
  console.log("\nDone: test is back to the snapshot.");
  process.exit(0);
}

// ── 1–2. The rollback and the source ────────────────────────────────────────────────────────
console.log("\n1. snapshot of test (the rollback)");
const rollbackFile = snapshotTarget(stamp);

const sourceFile = join("backups", `prod-${source.ref}-${stamp}.dump`);
console.log("2. dump of production");
run("pg_dump", ["-Fc", "--no-owner", "--no-acl", "-n", "public", "-f", sourceFile, source.url], "dumping production");
console.log(`   ${sourceFile}  (${(statSync(sourceFile).size / 1024 / 1024).toFixed(1)} MB)`);

// ── 3. One transaction: drop, restore, wipe ─────────────────────────────────────────────────
console.log("3. test: drop app tables → restore production's → wipe credentials (one transaction)");
replaceTarget(sourceFile, { wipe: true });

// ── 4. Check ────────────────────────────────────────────────────────────────────────────────
const afterSource = counts(source);
const after = counts(target);
printCounts("\nafter:", after, afterSource, true);

const leftSecrets = Number(
  sql(
    target,
    `SELECT (SELECT count(*) FROM public.integration_config WHERE "clientSecret" IS NOT NULL OR "refreshToken" IS NOT NULL OR "accessToken" IS NOT NULL)
          + (SELECT count(*) FROM public."StorageConfig" WHERE "accessKeyId" IS NOT NULL OR "secretAccessKey" IS NOT NULL)
          + (SELECT count(*) FROM public.notification_config WHERE "smtpPassword" IS NOT NULL OR "fcmServiceAccount" IS NOT NULL)
          + (SELECT count(*) FROM public.ai_provider WHERE "apiKey" IS NOT NULL)
          + (SELECT count(*) FROM public.push_devices)`,
    "checking the wipe"
  )
);
console.log(`\ncredentials left in test: ${leftSecrets === 0 ? "none (wiped)" : `${leftSecrets} — CHECK BY HAND`}`);
const differ = COUNTED_TABLES.filter((t) => afterSource.get(t) !== after.get(t));
console.log(
  differ.length === 0
    ? "Done: test now holds production's data."
    : `Done, but ${differ.join(", ")} differ — production may have changed during the copy; run again to be exact.`
);
console.log(`To undo: npm run db:sync:test -- --restore ${rollbackFile} --yes ${target.ref}`);
