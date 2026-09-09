// Copy `integration_config` from one database to ANOTHER HOST — the case
// restore-integrations.mjs deliberately refuses.
//
//     SOURCE_DATABASE_URL="postgresql://postgres:pw@localhost:5432/bch" \
//     TARGET_DATABASE_URL="postgresql://postgres.ref:pw@aws-0-….pooler.supabase.com:5432/postgres" \
//     node scripts/db/push-integrations.mjs --dry-run
//
//     …same two vars…  node scripts/db/push-integrations.mjs --yes
//
//   --dry-run          read and report, write nothing
//   --yes              required when the TARGET is not localhost
//   --provider=ZOHO_BOOKS   copy one provider instead of all (repeatable)
//
// WHY A SECOND SCRIPT
// -------------------
// `restore-integrations.mjs` is localhost-only by design, and its reader borrows the TARGET's
// host and credentials to open the source database by name (it only ever switches `-d`). Both
// facts make it structurally unable to cross machines. This script takes two complete URLs
// instead, and never reads either one from `.env` — a copy of live credentials into a cloud
// database should require you to type the destination, not inherit whatever `.env` happened
// to point at that morning.
//
// WHAT IS BEING COPIED, PLAINLY
// -----------------------------
// `integration_config` holds clientSecret, refreshToken and accessToken in PLAINTEXT
// (schema.prisma:988-1003). These are credentials for the real Zoho organisation. Sending
// them to a hosted database is a deliberate act with a real consequence, which is why the
// non-localhost path is gated behind --yes and prints the destination first.
//
// Nothing is written to disk. No secret is ever printed — only its LENGTH, so you can tell a
// populated field from an empty one without the value appearing in a terminal or a scrollback
// buffer.

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const ASSUME_YES = args.includes("--yes");
const ONLY_PROVIDERS = args
  .filter((a) => a.startsWith("--provider="))
  .map((a) => a.slice("--provider=".length).trim())
  .filter(Boolean);

const SOURCE = process.env.SOURCE_DATABASE_URL;
const TARGET = process.env.TARGET_DATABASE_URL;

if (!SOURCE || !TARGET) {
  console.error(
    "push-integrations: SOURCE_DATABASE_URL and TARGET_DATABASE_URL must both be set.\n\n" +
      "  Neither is read from .env on purpose — copying live credentials into a cloud\n" +
      "  database should name its destination explicitly.\n\n" +
      "  PowerShell:\n" +
      '    $env:SOURCE_DATABASE_URL="postgresql://postgres:pw@localhost:5432/bch"\n' +
      '    $env:TARGET_DATABASE_URL="postgresql://…pooler.supabase.com:5432/postgres"\n' +
      "    node scripts/db/push-integrations.mjs --dry-run",
  );
  process.exit(1);
}

// ── Parse both URLs, and catch the unencoded `@` before psql does ─────────────────────────
//
// A Supabase password containing `@` (this project's does) makes the connection string
// ambiguous. Node's URL parser splits on the LAST `@` and appears to succeed, while libpq
// splits differently and fails with a host it invented. The result is a confusing
// "could not translate host name" for what is really an encoding problem — so name it here.
function parse(label, raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    console.error(`push-integrations: ${label} is not a valid connection URL.`);
    process.exit(1);
  }
  const userinfo = raw.slice(raw.indexOf("//") + 2, raw.lastIndexOf("@"));
  if (userinfo.includes("@")) {
    console.error(
      `push-integrations: ${label} has an unencoded "@" in its password.\n\n` +
        '  Replace it with %40 — a password of "Pa@ss" is written "Pa%40ss" in the URL.\n' +
        "  Left as-is, psql and Prisma disagree about where the host name starts.",
    );
    process.exit(1);
  }
  return u;
}

const src = parse("SOURCE_DATABASE_URL", SOURCE);
const tgt = parse("TARGET_DATABASE_URL", TARGET);

const name = (u) => decodeURIComponent(u.pathname.replace(/^\//, "")) || "postgres";
const LOCAL_HOSTS = ["localhost", "127.0.0.1", "::1"];

console.log(`source: ${name(src)} at ${src.hostname}:${src.port || 5432}`);
console.log(`target: ${name(tgt)} at ${tgt.hostname}:${tgt.port || 5432}`);

if (src.hostname === tgt.hostname && name(src) === name(tgt)) {
  console.error("\npush-integrations: source and target are the same database — nothing to do.");
  process.exit(1);
}

// ── Find psql. Same lookup db:import uses — it is routinely off PATH on Windows ───────────
function findPsql() {
  if (process.env.PSQL) return process.env.PSQL;
  const onPath = execFileSyncSafe("psql", ["--version"]);
  if (onPath !== null) return "psql";

  const found = [];
  for (const root of ["C:/Program Files/PostgreSQL", "C:/Program Files (x86)/PostgreSQL"]) {
    if (!existsSync(root)) continue;
    for (const version of readdirSync(root)) {
      const candidate = join(root, version, "bin", "psql.exe");
      if (existsSync(candidate)) found.push({ version: Number(version) || 0, candidate });
    }
  }
  found.sort((a, b) => b.version - a.version);
  return found.length ? found[0].candidate : null;
}

function execFileSyncSafe(cmd, argv) {
  try {
    return execFileSync(cmd, argv, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch {
    return null;
  }
}

const psql = findPsql();
if (!psql) {
  console.error(
    "\npush-integrations: psql not found.\n" +
      '  Set PSQL to its full path, e.g. PSQL="C:/Program Files/PostgreSQL/17/bin/psql.exe"',
  );
  process.exit(1);
}

// ── Read the source rows ──────────────────────────────────────────────────────────────────
// The URL goes in argv rather than the shell, so the password never reaches a command line
// the shell would echo or a history file would keep.
let out;
try {
  out = execFileSync(psql, [SOURCE, "-Atc", "SELECT row_to_json(t) FROM integration_config t;"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
} catch (err) {
  const msg = String(err.stderr || err.message).split("\n")[0];
  console.error(`\npush-integrations: could not read integration_config from the source — ${msg}`);
  process.exit(1);
}

let rows = out.trim() ? out.trim().split("\n").map((l) => JSON.parse(l)) : [];
if (ONLY_PROVIDERS.length) {
  rows = rows.filter((r) => ONLY_PROVIDERS.includes(r.provider));
}

if (rows.length === 0) {
  console.error(
    ONLY_PROVIDERS.length
      ? `\npush-integrations: the source has no integration_config row for ${ONLY_PROVIDERS.join(", ")}.`
      : "\npush-integrations: the source integration_config table is empty — nothing to copy.",
  );
  process.exit(1);
}

// Length only. Never the value.
const shape = (v) => (v == null ? "null" : `set(${String(v).length})`);

console.log("");
for (const r of rows) {
  console.log(
    `  ${r.provider.padEnd(15)} connected=${r.isConnected} org=${r.organizationName ?? "-"} ` +
      `clientId=${shape(r.clientId)} secret=${shape(r.clientSecret)} refresh=${shape(r.refreshToken)}`,
  );
}

if (DRY_RUN) {
  console.log("\n--dry-run: nothing written.");
  process.exit(0);
}

// ── The guard: a cloud target is confirmed, never assumed ─────────────────────────────────
if (!LOCAL_HOSTS.includes(tgt.hostname) && !ASSUME_YES) {
  console.error(
    `\nrefusing to run unattended: ${tgt.hostname} is not localhost.\n\n` +
      "  This writes PLAINTEXT Zoho credentials — clientSecret, refreshToken, accessToken —\n" +
      "  for the live organisation into a hosted database. Confirm the target above, then:\n\n" +
      "    node scripts/db/push-integrations.mjs --yes",
  );
  process.exit(1);
}

// ── Write, through Prisma against the TARGET, which parameterises every value ─────────────
const prisma = new PrismaClient({ datasourceUrl: TARGET });
try {
  let written = 0;
  for (const r of rows) {
    // accessToken rides along even though it has almost certainly expired. The client
    // refreshes it on first use from refreshToken, which is the field that actually matters;
    // carrying it costs nothing and avoids a NULL that looks like a failed copy.
    const data = {
      clientId: r.clientId,
      clientSecret: r.clientSecret,
      refreshToken: r.refreshToken,
      accessToken: r.accessToken,
      accessTokenExpiresAt: r.accessTokenExpiresAt ? new Date(r.accessTokenExpiresAt) : null,
      organizationId: r.organizationId,
      organizationName: r.organizationName,
      isConnected: r.isConnected,
      lastSyncAt: r.lastSyncAt ? new Date(r.lastSyncAt) : null,
      // Deliberately NOT copied: lastAuthErrorAt. It records a refusal that happened against
      // the SOURCE environment, and carrying it over would paint the target's badge red for
      // a failure that never happened there.
    };
    await prisma.integrationConfig.upsert({
      where: { provider: r.provider },
      update: data,
      create: { provider: r.provider, ...data },
    });
    written++;
  }
  console.log(`\nwrote ${written} row${written === 1 ? "" : "s"} into ${name(tgt)}.integration_config`);
  console.log("Open /settings/integrations on the target and confirm each provider reads Connected.");
  console.log("A first Zoho call will refresh the access token automatically.");
} catch (err) {
  console.error(`\nwrite failed: ${String(err.message).split("\n")[0]}`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
