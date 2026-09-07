// Take a restorable snapshot of the database `.env` points at.
//
// WHY THIS EXISTS
// ---------------
// Prisma has no down migrations. When a migration folder is merged there is no `migrate
// undo` — the ONLY way back is a dump taken before it ran. CLAUDE.md rule 9 therefore makes
// this mandatory before merging any PR that carries a migration, and this script is what
// that rule refers to.
//
// `-Fc` (custom format), not plain SQL: it is compressed, and `pg_restore` can restore it
// selectively — one table out of a bad migration, rather than all or nothing.
//
// Uses DIRECT_URL, never DATABASE_URL. On Supabase that is the 5432 SESSION pooler; the 6543
// transaction pooler drops the session state a long dump depends on.
//
// Writes into backups/, which is gitignored. A snapshot carries every customer phone number
// and every price in the business — it does not belong in git and does not leave the machine.
//
// Prints the hostname and the database name. NEVER the URL, which carries the password.
//
//     npm run db:snapshot

import { readFileSync, mkdirSync, existsSync, statSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

// ── The connection, read the same way assert-localhost.mjs reads it ────────────────────────
let env;
try {
  env = readFileSync(".env", "utf8");
} catch {
  console.error("db:snapshot: .env not found — run this from the project root.");
  process.exit(1);
}

const match = env.match(/^DIRECT_URL="?([^"\n]+)/m) || env.match(/^DATABASE_URL="?([^"\n]+)/m);
if (!match) {
  console.error("db:snapshot: neither DIRECT_URL nor DATABASE_URL is set in .env");
  process.exit(1);
}
const url = match[1];

let parsed;
try {
  parsed = new URL(url);
} catch {
  console.error("db:snapshot: the connection string is not a valid URL");
  process.exit(1);
}

const dbName = decodeURIComponent(parsed.pathname.replace(/^\//, "")) || "postgres";
console.log(`snapshotting ${dbName} at ${parsed.hostname}:${parsed.port || 5432}`);

// A Supabase password containing `@` or `#` must already be percent-encoded in .env for the
// URL to parse at all. Saying so here turns a confusing pg_dump auth failure into a hint.
if (/[@#?]/.test(parsed.password ? decodeURIComponent(parsed.password) : "")) {
  console.log("note: the password contains a character that must stay percent-encoded in .env");
}

// ── Find pg_dump ───────────────────────────────────────────────────────────────────────────
// It is routinely not on PATH on Windows, where the installer puts it under a versioned
// directory. Try PATH first, then the usual PostgreSQL install locations, newest first.
function findPgDump() {
  if (process.env.PGDUMP) return process.env.PGDUMP;

  const onPath = spawnSync("pg_dump", ["--version"], { encoding: "utf8" });
  if (!onPath.error && onPath.status === 0) return "pg_dump";

  const roots = ["C:/Program Files/PostgreSQL", "C:/Program Files (x86)/PostgreSQL"];
  const found = [];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const version of readdirSync(root)) {
      const candidate = join(root, version, "bin", "pg_dump.exe");
      if (existsSync(candidate)) found.push({ version: Number(version) || 0, candidate });
    }
  }
  found.sort((a, b) => b.version - a.version);
  return found.length ? found[0].candidate : null;
}

const pgDump = findPgDump();
if (!pgDump) {
  console.error(
    "db:snapshot: pg_dump not found.\n" +
      "  Install the PostgreSQL client tools, or set PGDUMP to its full path:\n" +
      '  PGDUMP="C:/Program Files/PostgreSQL/17/bin/pg_dump.exe" npm run db:snapshot',
  );
  process.exit(1);
}

// ── Dump ───────────────────────────────────────────────────────────────────────────────────
mkdirSync("backups", { recursive: true });

const stamp = new Date()
  .toISOString()
  .replace(/[-:]/g, "")
  .replace(/\..+/, "")
  .replace("T", "-");
const outFile = join("backups", `${dbName}-${stamp}.dump`);

// The URL goes in argv, not the shell, so the password is never interpolated into a command
// line the shell would echo or a history file would keep.
const result = spawnSync(pgDump, ["-Fc", "--no-owner", "--no-acl", "-f", outFile, url], {
  stdio: ["ignore", "inherit", "inherit"],
});

if (result.error) {
  console.error(`db:snapshot: could not run pg_dump — ${result.error.message}`);
  process.exit(1);
}
if (result.status !== 0) {
  console.error(`db:snapshot: pg_dump exited ${result.status}. Nothing was written.`);
  process.exit(result.status ?? 1);
}

const bytes = statSync(outFile).size;
if (bytes === 0) {
  console.error(`db:snapshot: ${outFile} is empty. Treat this as a FAILED snapshot.`);
  process.exit(1);
}

console.log(`\nwrote ${outFile}  (${(bytes / 1024 / 1024).toFixed(1)} MB)`);
console.log("this file is the ONLY rollback for the migration in this PR — keep it until the deploy is proven.");
