// Load the two data sets this application cannot be seeded without: the CATALOG
// (Category -> Brand -> Product, from the Zoho item export) and the VENDORS
// (Vendor -> VendorContact -> VendorIssue -> VendorIssueNote, from the old database).
//
//     npm run db:import                  both sets, in dependency order
//     npm run db:import -- --only=catalog
//     npm run db:import -- --only=vendors
//     npm run db:import -- --yes         confirm a target that is not localhost
//     npm run db:import -- --allow-drift acknowledge the two columns catalog.sql adds
//
// WHY THIS EXISTS
// ---------------
// Both data sets already exist as generated SQL under prisma/data/. Neither could simply be
// pasted:
//
//   1. ORDER. Product carries a required `categoryId` and `brandId`; issues and notes point
//      at vendors. Run the files in the wrong order and it fails on a foreign key. The order
//      is fixed here so nobody has to remember it.
//
//   2. THE AUTHOR. `vendor-and-issues-backup.sql` hardcodes ONE user id (AUTHOR_IN_FILE
//      below) on every VendorIssue.createdById and VendorIssueNote.authorId, because the
//      three original authors do not exist here. That id came from the machine the file was
//      generated on and exists in no other database — a straight paste fails on the `User`
//      foreign key. This script looks the admin up in the TARGET at run time (the oldest user
//      holding the ADMIN role) and rewrites the id as the file streams into psql. The file on
//      disk is never modified.
//
// Prints the hostname and database name. NEVER the URL, which carries the password.
//
// Re-runnable. Every statement in both files is ON CONFLICT DO NOTHING / DO UPDATE, and each
// file is one transaction: it all lands or none of it does.

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const args = process.argv.slice(2);
const ONLY = (args.find((a) => a.startsWith("--only=")) || "").slice("--only=".length) || "both";
const ASSUME_YES = args.includes("--yes");
const ALLOW_DRIFT = args.includes("--allow-drift");

if (!["both", "catalog", "vendors"].includes(ONLY)) {
  console.error(`db:import: --only must be catalog, vendors or both — got "${ONLY}"`);
  process.exit(1);
}

/** The id `extract-vendor-backup.js --user=` baked into every issue and note. */
const AUTHOR_IN_FILE = "cmt8hr7hq00ecw2n8gymzo7t5";

const CATALOG = [
  // Category + Brand + Product — one file, already in that order internally.
  { file: "prisma/data/catalog.sql", what: "categories, brands and products" },
  // Re-files products a PREVIOUS import left on Unbranded/Uncategorized. A no-op on a
  // database seeded by catalog.sql alone, which already writes the real brand and category.
  {
    file: "prisma/data/catalog-backfill.sql",
    what: "re-file existing products onto their real brand/category",
  },
];
const VENDORS = {
  file: "prisma/data/vendor-and-issues-backup.sql",
  what: "vendors, contacts, issues and notes",
};

/**
 * Columns `catalog.sql` creates with `ALTER TABLE … ADD COLUMN IF NOT EXISTS` that are in NO
 * migration and NOT in prisma/schema.prisma. Adding them puts the database ahead of Prisma's
 * idea of it — `prisma migrate dev` sees drift and offers to RESET. CLAUDE.md's migration
 * rules say a schema change is the schema edit plus a migration folder, committed together;
 * this file is neither. So it is surfaced, not swallowed.
 */
const DRIFT_COLUMNS = [
  ["Brand", "zohoBrandId"],
  ["Category", "zohoCategoryId"],
];

// ── The connection, read the same way assert-localhost.mjs and snapshot.mjs read it ────────
let env;
try {
  env = readFileSync(".env", "utf8");
} catch {
  console.error("db:import: .env not found — run this from the project root.");
  process.exit(1);
}

// DIRECT_URL, never DATABASE_URL: on Supabase that is the 5432 session pooler. The 6543
// transaction pooler drops the session state a long multi-statement transaction depends on.
const match = env.match(/^DIRECT_URL="?([^"\n]+)/m) || env.match(/^DATABASE_URL="?([^"\n]+)/m);
if (!match) {
  console.error("db:import: neither DIRECT_URL nor DATABASE_URL is set in .env");
  process.exit(1);
}
const url = match[1];

let parsed;
try {
  parsed = new URL(url);
} catch {
  console.error("db:import: the connection string is not a valid URL");
  process.exit(1);
}
const dbName = decodeURIComponent(parsed.pathname.replace(/^\//, "")) || "postgres";
const host = parsed.hostname;
const LOCAL_HOSTS = ["localhost", "127.0.0.1", "::1"];

console.log(`target: ${dbName} at ${host}:${parsed.port || 5432}`);

// ── Find psql ──────────────────────────────────────────────────────────────────────────────
// Routinely not on PATH on Windows, where the installer puts it under a versioned directory.
function findPsql() {
  if (process.env.PSQL) return process.env.PSQL;
  const onPath = spawnSync("psql", ["--version"], { encoding: "utf8" });
  if (!onPath.error && onPath.status === 0) return "psql";

  const roots = ["C:/Program Files/PostgreSQL", "C:/Program Files (x86)/PostgreSQL"];
  const found = [];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const version of readdirSync(root)) {
      const candidate = join(root, version, "bin", "psql.exe");
      if (existsSync(candidate)) found.push({ version: Number(version) || 0, candidate });
    }
  }
  found.sort((a, b) => b.version - a.version);
  return found.length ? found[0].candidate : null;
}

const psql = findPsql();
if (!psql) {
  console.error(
    "db:import: psql not found.\n" +
      "  Install the PostgreSQL client tools, or set PSQL to its full path:\n" +
      '  PSQL="C:/Program Files/PostgreSQL/17/bin/psql.exe" npm run db:import',
  );
  process.exit(1);
}

// ── Helpers ────────────────────────────────────────────────────────────────────────────────
// The URL goes in argv, not the shell, so the password is never interpolated into a command
// line the shell would echo or a history file would keep.
function query(sql) {
  const r = spawnSync(psql, [url, "-v", "ON_ERROR_STOP=1", "-t", "-A", "-c", sql], {
    encoding: "utf8",
  });
  if (r.error) {
    console.error(`db:import: could not run psql — ${r.error.message}`);
    process.exit(1);
  }
  if (r.status !== 0) {
    console.error(`db:import: query failed\n${r.stderr || ""}`);
    process.exit(r.status ?? 1);
  }
  return r.stdout.trim();
}

/** Run a .sql file through psql's stdin. `transform` rewrites the text on the way. */
function runFile({ file, what }, transform) {
  if (!existsSync(file)) {
    console.error(
      `db:import: ${file} is missing.\n` +
        "  prisma/data/ is not in the repository — those files carry real prices, GSTINs and\n" +
        "  phone numbers. Copy or regenerate them before running this.",
    );
    process.exit(1);
  }
  console.log(`\n-> ${file}  (${what})`);
  const sql = readFileSync(file, "utf8");
  const r = spawnSync(psql, [url, "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"], {
    input: transform ? transform(sql) : sql,
    stdio: ["pipe", "inherit", "inherit"],
    maxBuffer: 512 * 1024 * 1024,
  });
  if (r.error) {
    console.error(`db:import: could not run psql — ${r.error.message}`);
    process.exit(1);
  }
  if (r.status !== 0) {
    console.error(
      `\ndb:import: psql exited ${r.status} on ${file}. That file is one transaction, so\n` +
        "  nothing from it was written. Fix the error above and re-run — the files are\n" +
        "  re-runnable and whatever landed earlier is left alone.",
    );
    process.exit(r.status ?? 1);
  }
}

// ── Guard: a target that is not localhost is confirmed, not assumed ────────────────────────
// Not a hard block — restoring vendors onto the cloud test database is a real thing to do.
// But .env has pointed at both localhost and a Supabase pooler in the same week.
if (!LOCAL_HOSTS.includes(host) && !ASSUME_YES) {
  console.error(
    `\nrefusing to run unattended: ${host} is not localhost.\n` +
      "  This writes thousands of rows. Confirm the target, then re-run with --yes:\n" +
      "    npm run db:import -- --yes",
  );
  process.exit(1);
}

// ── Guard: the schema drift catalog.sql would introduce ────────────────────────────────────
if ((ONLY === "both" || ONLY === "catalog") && !ALLOW_DRIFT) {
  const already = query(
    "SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND (" +
      DRIFT_COLUMNS.map(([t, c]) => `(table_name = '${t}' AND column_name = '${c}')`).join(" OR ") +
      ")",
  );
  if (Number(already) < DRIFT_COLUMNS.length) {
    console.error(
      "\nrefusing to run: catalog.sql adds columns Prisma does not know about.\n\n" +
        DRIFT_COLUMNS.map(([t, c]) => `    ALTER TABLE "${t}" ADD COLUMN "${c}"`).join("\n") +
        "\n\n  Neither is in prisma/schema.prisma and no migration creates them. Applying them\n" +
        "  puts the database ahead of the schema, and the next `prisma migrate dev` will see\n" +
        "  drift and offer to RESET the database.\n\n" +
        "  Two ways forward:\n" +
        "    a) Add both fields to schema.prisma and `npx prisma migrate dev --name\n" +
        "       zoho_brand_category_ids` FIRST, then re-run this. (The proper fix — see\n" +
        "       docs/implementation/pending/0709-zoho-brand-category-sync-plan.md.)\n" +
        "    b) Accept the drift knowingly, on a throwaway database:\n" +
        "         npm run db:import -- --allow-drift",
    );
    process.exit(1);
  }
}

// ── The catalog ────────────────────────────────────────────────────────────────────────────
if (ONLY === "both" || ONLY === "catalog") {
  for (const step of CATALOG) runFile(step);
}

// ── The vendors, with the author resolved against THIS database ────────────────────────────
if (ONLY === "both" || ONLY === "vendors") {
  // The oldest user holding the ADMIN role. Resolved through `roles.key`, not through a role
  // NAME in code: roles are rows an admin can rename at runtime, and `key` is the stable
  // handle the seed writes (prisma/seed-rbac.ts, ADMIN_ROLE_KEY).
  const adminId = query(
    'SELECT u.id FROM "User" u JOIN roles r ON r.id = u."roleId" ' +
      "WHERE r.key = 'ADMIN' ORDER BY u.\"createdAt\" ASC LIMIT 1",
  );
  if (!adminId) {
    console.error(
      "\ndb:import: no user holds the ADMIN role in this database.\n" +
        "  Every VendorIssue.createdById and VendorIssueNote.authorId has to point at a real\n" +
        "  user. Seed first:  npm run db:seed",
    );
    process.exit(1);
  }
  console.log(`\nissue/note author -> ${adminId} (the ADMIN user in this database)`);

  runFile(VENDORS, (sql) => {
    const hits = sql.split(AUTHOR_IN_FILE).length - 1;
    if (hits === 0) {
      console.error(
        `db:import: ${VENDORS.file} does not carry the expected author id.\n` +
          "  It was regenerated with a different --user=. Check which user it points at\n" +
          "  before running it, or it will fail on the User foreign key.",
      );
      process.exit(1);
    }
    console.log(`   rewriting ${hits} author reference(s) onto this database's admin`);
    return sql.split(AUTHOR_IN_FILE).join(adminId);
  });
}

// ── What landed ────────────────────────────────────────────────────────────────────────────
const counts = query(
  "SELECT (SELECT count(*) FROM \"Category\") || ' categories, ' ||" +
    " (SELECT count(*) FROM \"Brand\") || ' brands, ' ||" +
    " (SELECT count(*) FROM \"Product\") || ' products, ' ||" +
    " (SELECT count(*) FROM \"Vendor\") || ' vendors, ' ||" +
    " (SELECT count(*) FROM \"VendorContact\") || ' contacts, ' ||" +
    " (SELECT count(*) FROM \"VendorIssue\") || ' issues, ' ||" +
    " (SELECT count(*) FROM \"VendorIssueNote\") || ' notes'",
);
console.log(`\ndone: ${counts}`);
console.log(
  "no StockLevel rows were written and every product's currentStock is 0 — quantities come\n" +
    "from a stock audit, never from the item export.",
);
