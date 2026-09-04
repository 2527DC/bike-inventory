// Copy the Zoho integration credentials from one LOCAL database into another, so a
// `prisma migrate reset` does not cost you a re-connect through Settings > Integrations.
//
// Why this is a script and not a seed: a seed file lives in git. `integration_config` holds
// clientSecret, refreshToken and accessToken in PLAINTEXT (schema.prisma:988-1003), and a
// committed seed would put live Zoho credentials into the repository history permanently.
// This script reads them database-to-database at run time. Nothing is written to disk, no
// secret is ever printed, and there is no file to gitignore.
//
// Usage:
//   node scripts/db/restore-integrations.mjs                  # bch-local  ->  DATABASE_URL
//   node scripts/db/restore-integrations.mjs --from=bch-other
//   node scripts/db/restore-integrations.mjs --dry-run
//
// Safety: refuses to write anywhere that is not localhost. These are real credentials for the
// live Zoho organisation, and pushing them at a cloud database from a dev machine is never
// what you meant.

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

const args = process.argv.slice(2);
const SOURCE_DB = (args.find((a) => a.startsWith("--from=")) || "--from=bch-local").slice("--from=".length);
const DRY_RUN = args.includes("--dry-run");

// ── Read the target from .env, and refuse anything that is not local ──────────────────────
function targetUrl() {
  const m = readFileSync(".env", "utf8").match(/^DATABASE_URL="?([^"\n]+)/m);
  if (!m) {
    console.error("DATABASE_URL not found in .env");
    process.exit(1);
  }
  return new URL(m[1]);
}

const target = targetUrl();
const LOCAL_HOSTS = ["localhost", "127.0.0.1", "::1"];
if (!LOCAL_HOSTS.includes(target.hostname)) {
  console.error(`refusing to write to ${target.hostname} — this script is localhost-only.`);
  console.error("These are live Zoho credentials. Point .env at localhost first.");
  process.exit(1);
}

const targetDb = decodeURIComponent(target.pathname.slice(1));
if (targetDb === SOURCE_DB) {
  console.error(`source and target are the same database (${targetDb}) — nothing to do.`);
  process.exit(1);
}

// ── Read the source rows with psql (the project has no `pg` dependency) ───────────────────
// Values come back as JSON on stdout and stay in memory. PGPASSWORD is passed through env,
// never on the command line, so it does not show up in the process list.
function readSource(table) {
  const env = {
    ...process.env,
    PGHOST: target.hostname,
    PGPORT: target.port || "5432",
    PGUSER: decodeURIComponent(target.username),
    PGPASSWORD: decodeURIComponent(target.password),
  };
  let out;
  try {
    out = execFileSync("psql", ["-d", SOURCE_DB, "-Atc", `SELECT row_to_json(t) FROM ${table} t;`], {
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    const msg = String(err.stderr || err.message).split("\n")[0];
    console.error(`could not read ${table} from "${SOURCE_DB}": ${msg}`);
    if (/does not exist/i.test(msg)) {
      console.error(`\nDatabases on this server:`);
      try {
        console.error(
          execFileSync("psql", ["-d", "postgres", "-Atc", "SELECT datname FROM pg_database WHERE datistemplate=false ORDER BY 1;"], {
            env,
            encoding: "utf8",
          }).trim().split("\n").map((d) => `  ${d}`).join("\n"),
        );
      } catch {
        /* listing is a convenience; its failure must not mask the real error */
      }
    }
    process.exit(1);
  }
  return out.trim() ? out.trim().split("\n").map((l) => JSON.parse(l)) : [];
}

// Length only — never the value itself.
const shape = (v) => (v == null ? "null" : `set(${String(v).length})`);

const rows = readSource("integration_config");
if (rows.length === 0) {
  console.error(`"${SOURCE_DB}".integration_config has no rows — nothing to copy.`);
  process.exit(1);
}

console.log(`source "${SOURCE_DB}" -> target "${targetDb}" (${target.hostname})`);
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

// ── Upsert into the target through Prisma, which parameterises every value ────────────────
const prisma = new PrismaClient();
try {
  let written = 0;
  for (const r of rows) {
    // accessToken is deliberately carried across even though it has almost certainly expired:
    // the client refreshes it on first use from refreshToken, which is the field that matters.
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
    };
    await prisma.integrationConfig.upsert({
      where: { provider: r.provider },
      update: data,
      create: { provider: r.provider, ...data },
    });
    written++;
  }
  console.log(`\nwrote ${written} row${written === 1 ? "" : "s"} into "${targetDb}".integration_config`);
  console.log("Open /settings/integrations to confirm each provider reads Connected.");
} catch (err) {
  console.error(`\nwrite failed: ${err.message.split("\n")[0]}`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
