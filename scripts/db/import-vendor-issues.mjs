// Re-attach the old vendor issues (and their notes) to the vendors imported from Zoho, and copy
// each old vendor's opening balance onto the matching current vendor.
//
//     npm run db:import:vendor-issues -- --dry-run          report only, nothing written
//     npm run db:import:vendor-issues                        write (localhost only)
//     npm run db:import:vendor-issues -- --yes               confirm a target that is not localhost
//     npm run db:import:vendor-issues -- --file=other.sql    another backup (default bch-local.sql)
//     npm run db:import:vendor-issues -- --rollback=backups/vendor-issues-rollback-<time>.sql [--yes]
//                                                            undo a run, from the file it saved
//
// Plan 2409-zoho-vendor-sync-and-issue-restore, Part B (R2). Run AFTER Part A — the vendors
// have to exist, carrying their Zoho vendor id, before the issues can be pointed at them.
//
// THE INPUT
// ---------
// A pg_dump of the old database, data-only, `--inserts` style: `INSERT INTO public."X" VALUES
// (...), (...);` with NO column list. So a row is positional, and its meaning depends on the
// column order of the database it was dumped from. This script reads only three tables from it:
//
//   Vendor           — `id`, `name`, `gstin` map old vendor -> current vendor; `openingBalance`
//                      is copied across (see OPENING BALANCES). Nothing else is read from it.
//   VendorIssue      — written, positionally, in this database's own column order
//   VendorIssueNote  — written, positionally, likewise
//
// Before writing, the width of every row is compared with the column count of the table in
// THIS database. A mismatch means the dump came from a different schema version and the
// positions cannot be trusted — the script stops rather than put a description in a status.
//
// The old `Vendor` / `VendorContact` rows are never inserted: the vendors come from Zoho now.
//
// THE MAPPING, old vendor -> current vendor (a one-time data migration step, not a runtime rule)
// ----------------------------------------------------------------------------------------------
//   1. GSTIN, uppercased, when exactly ONE current vendor carries it;
//   2. else exact name, case-insensitive (this also settles a GSTIN several vendors share);
//   3. else the issue goes in with vendorId NULL and is listed in the report (plan Q4a).
//
// THE REST OF THE ROW
// -------------------
//   - billId      -> NULL. The old bills were deleted with the old vendors.
//   - createdById / authorId -> kept when that user exists here; otherwise the oldest active
//                    user holding a system role (`roles.isSystem`) — never a role NAME.
//   - issueNo / id already present -> the issue (and its notes) is SKIPPED and reported, never
//                    overwritten. So a re-run writes nothing.
//   - each `ISS-YYYYMM` counter is raised to the highest number now in VendorIssue for that
//     month. The allocator (src/lib/vendor-issues/sequence.ts) only seeds a MISSING counter
//     row, so without this the next new issue could be handed a number that was just imported.
//
// OPENING BALANCES
// ----------------
// `Vendor.openingBalance` (BCH's payable as of 1 Apr 2026, where the vendor ledger starts) is set
// on the mapped current vendor ONLY while it is still 0 — a figure already entered by hand is
// never overwritten, and a re-run changes nothing. Copied exactly as the backup has it, including
// ALPHA INDIA and ALPHAVECTOR carrying the same ₹2,44,356 (owner's decision, 25 Sep 2026).
//
// One transaction: it all lands or none of it does. `--dry-run` runs the same transaction and
// rolls it back, so the report it prints is exactly what a real run would do.
//
// Prints the host and database name only, never the URL (it carries the password).

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { PrismaClient, Prisma } from "@prisma/client";

const TAG = "db:import:vendor-issues";
function fail(message) {
  console.error(`${TAG}: ${message}`);
  process.exit(1);
}

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const ASSUME_YES = args.includes("--yes");
const FILE = (args.find((a) => a.startsWith("--file=")) || "").slice("--file=".length) || "bch-local.sql";
const ROLLBACK = (args.find((a) => a.startsWith("--rollback=")) || "").slice("--rollback=".length);

// ── The connection, read the way backfill-vendor-contact.mjs reads it ─────────────────────────
let env;
try {
  env = readFileSync(".env", "utf8");
} catch {
  fail(".env not found — run this from the project root.");
}
// DIRECT_URL first: on Supabase that is the 5432 session pooler, which holds a transaction.
const match = env.match(/^DIRECT_URL="?([^"\n]+)/m) || env.match(/^DATABASE_URL="?([^"\n]+)/m);
if (!match) fail("neither DIRECT_URL nor DATABASE_URL is set in .env");
const url = match[1].trim();
let parsed;
try {
  parsed = new URL(url);
} catch {
  fail("the connection string in .env is not a valid URL");
}
const dbName = decodeURIComponent(parsed.pathname.replace(/^\//, "")) || "postgres";
const host = parsed.hostname;
console.log(`\ntarget: ${dbName} at ${host}:${parsed.port || 5432}${DRY_RUN ? "   (dry run — nothing is kept)" : ""}`);

// ── Guard: a target that is not localhost is confirmed, not assumed ──────────────────────────
// A dry run writes nothing (it rolls back), so it is allowed anywhere.
const LOCAL_HOSTS = ["localhost", "127.0.0.1", "::1"];
if (!DRY_RUN && !LOCAL_HOSTS.includes(host) && !ASSUME_YES) {
  fail(
    `refusing to write: ${host} is not localhost.\n` +
      (ROLLBACK ? `  Confirm the rollback with --yes:\n    npm run db:import:vendor-issues -- --rollback=${ROLLBACK} --yes\n` : "") +
      "  Dry-run first, take a snapshot (npm run db:snapshot), then confirm with --yes:\n" +
      "    npm run db:import:vendor-issues -- --dry-run\n" +
      "    npm run db:import:vendor-issues -- --yes",
  );
}

const prisma = new PrismaClient({ datasourceUrl: url });

if (ROLLBACK) {
  await runRollback(ROLLBACK)
    .catch((e) => {
      console.error(`${TAG}: rollback failed and was undone — nothing changed. ${e.message}`);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
  process.exit();
}

// ── Read the dump ────────────────────────────────────────────────────────────────────────────
if (!existsSync(FILE)) {
  fail(`${FILE} not found. Pass the backup with --file=<path>. It carries real GSTINs and phone numbers — never commit it.`);
}
const dump = readFileSync(FILE, "utf8");

/**
 * Every row of `INSERT INTO public."<table>" VALUES (...), (...);` blocks, as arrays of
 * string | null. pg_dump writes standard-conforming literals: '' is an escaped quote, a
 * backslash is literal, NULL is bare. Numbers and booleans come back as their text, which
 * Postgres casts on insert.
 */
function dumpRows(table) {
  const out = [];
  const header = new RegExp(`^INSERT INTO public\\."${table}" VALUES\\n`, "gm");
  let m;
  while ((m = header.exec(dump))) {
    let row = null;
    let val = "";
    let quoted = false;
    let inStr = false;
    for (let i = m.index + m[0].length; i < dump.length; i++) {
      const c = dump[i];
      if (inStr) {
        if (c !== "'") val += c;
        else if (dump[i + 1] === "'") {
          val += "'";
          i++;
        } else inStr = false;
        continue;
      }
      if (row === null) {
        if (c === "(") {
          row = [];
          val = "";
          quoted = false;
        } else if (c === ";") break;
        continue;
      }
      if (c === "'") {
        inStr = true;
        quoted = true;
        val = "";
      } else if (c === "," || c === ")") {
        const t = val.trim();
        row.push(quoted ? val : t === "NULL" ? null : t);
        val = "";
        quoted = false;
        if (c === ")") {
          out.push(row);
          row = null;
        }
      } else if (!quoted) val += c;
    }
  }
  return out;
}

const oldVendors = dumpRows("Vendor");
const oldIssues = dumpRows("VendorIssue");
const oldNotes = dumpRows("VendorIssueNote");
console.log(`\n${FILE}: ${oldVendors.length} vendors, ${oldIssues.length} issues, ${oldNotes.length} notes`);
if (oldIssues.length === 0) fail(`${FILE} has no VendorIssue rows — is this the right backup?`);

/** This database's columns for a table, in physical order, with the SQL type to cast to. */
async function columnsOf(table) {
  const cols = await prisma.$queryRaw`
    SELECT column_name AS name,
           CASE WHEN data_type = 'USER-DEFINED' THEN format('%I', udt_name)
                WHEN data_type = 'ARRAY' THEN format('%I', ltrim(udt_name, '_')) || '[]'
                ELSE format_type(a.atttypid, a.atttypmod) END AS type
    FROM information_schema.columns c
    JOIN pg_attribute a ON a.attrelid = format('public.%I', c.table_name)::regclass
                       AND a.attname = c.column_name
    WHERE c.table_schema = 'public' AND c.table_name = ${table}
    ORDER BY c.ordinal_position`;
  return cols;
}

function assertWidth(table, rows, cols) {
  const widths = [...new Set(rows.map((r) => r.length))];
  if (widths.length !== 1 || widths[0] !== cols.length) {
    fail(
      `${table}: the dump's rows have ${widths.join("/")} values but this database's "${table}" has ` +
        `${cols.length} columns.\n  The backup is from a different schema version, so its positions cannot be ` +
        "trusted. Nothing was written.",
    );
  }
}

/** Rows -> one multi-row INSERT, each value cast to its column's type. */
function insertSql(table, cols, rows) {
  const colList = Prisma.raw(cols.map((c) => `"${c.name}"`).join(", "));
  const tuples = rows.map(
    (r) => Prisma.sql`(${Prisma.join(r.map((v, i) => Prisma.sql`${v}::${Prisma.raw(cols[i].type)}`))})`,
  );
  return Prisma.sql`INSERT INTO ${Prisma.raw(`"${table}"`)} (${colList}) VALUES ${Prisma.join(tuples)}`;
}

class DryRunRollback extends Error {}

// ── Rollback ─────────────────────────────────────────────────────────────────────────────────
// This import only INSERTS issues and notes and raises the ISS-YYYYMM counters; it never edits
// an existing row. So the exact undo is known before anything is written, and it is saved
// BEFORE the transaction runs — a full pg_dump is not needed for this step.
//
// One statement per line, so --rollback can run it line by line (Prisma runs one statement per
// call). It also pastes as-is into the Supabase SQL editor.
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

async function writeRollback(issueIds, months, balances) {
  const before = await prisma.counter.findMany({ where: { key: { in: months } } });
  const prev = new Map(before.map((c) => [c.key, c.current]));
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
  const file = `backups/vendor-issues-rollback-${stamp}.sql`;
  const ids = issueIds.map(q).join(", ");
  const lines = [
    `-- Undo of: npm run db:import:vendor-issues  (${new Date().toISOString()}, ${dbName} at ${host})`,
    `-- Deletes the ${issueIds.length} imported issues (their notes cascade), restores the ISS counters and`,
    `-- puts the ${balances.length} copied opening balances back to 0 (only where still the copied figure).`,
    "-- Run:  npm run db:import:vendor-issues -- --rollback=" + file + "   (or paste into the Supabase SQL editor)",
    "-- Caution: an issue created in the app AFTER the import has taken a counter number; restoring the",
    "-- counter below it would hand that number out again. Roll back before new issues are raised.",
    "BEGIN;",
    ...(issueIds.length
      ? [`DELETE FROM "VendorIssueNote" WHERE "issueId" IN (${ids});`, `DELETE FROM "VendorIssue" WHERE id IN (${ids});`]
      : []),
    ...months.map((k) =>
      prev.has(k)
        ? `UPDATE counter SET current = ${prev.get(k)} WHERE key = ${q(k)};`
        : `DELETE FROM counter WHERE key = ${q(k)};`,
    ),
    ...balances.map(
      (b) => `UPDATE "Vendor" SET "openingBalance" = 0 WHERE id = ${q(b.id)} AND "openingBalance" = ${b.amount};`,
    ),
    "COMMIT;",
  ];
  mkdirSync("backups", { recursive: true });
  writeFileSync(file, lines.join("\n") + "\n");
  console.log(`\nrollback saved: ${file}`);
}

async function runRollback(file) {
  if (!existsSync(file)) fail(`${file} not found`);
  const statements = readFileSync(file, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("--") && l !== "BEGIN;" && l !== "COMMIT;");
  const results = await prisma.$transaction(
    statements.map((s) => prisma.$executeRawUnsafe(s.replace(/;$/, ""))),
  );
  statements.forEach((s, i) => console.log(`  ${String(results[i]).padStart(4)} row(s)  ${s.slice(0, 70)}${s.length > 70 ? "…" : ""}`));
  console.log("\nrolled back.\n");
}

async function main() {
  const issueCols = await columnsOf("VendorIssue");
  const noteCols = await columnsOf("VendorIssueNote");
  assertWidth("VendorIssue", oldIssues, issueCols);
  assertWidth("VendorIssueNote", oldNotes, noteCols);

  const at = (cols, name) => {
    const i = cols.findIndex((c) => c.name === name);
    if (i < 0) fail(`this database's table has no "${name}" column`);
    return i;
  };
  const I = {
    id: at(issueCols, "id"),
    vendorId: at(issueCols, "vendorId"),
    issueNo: at(issueCols, "issueNo"),
    billId: at(issueCols, "billId"),
    createdById: at(issueCols, "createdById"),
  };
  const N = { id: at(noteCols, "id"), issueId: at(noteCols, "issueId"), authorId: at(noteCols, "authorId") };

  // The dump predates `zohoVendorId` (migration 20260924034908, the last column of "Vendor"), so
  // the old rows are one column narrower than the table here. Positions come from this database's
  // column order with that column taken out; the width check and the GSTIN check guard it.
  const vendorCols = (await columnsOf("Vendor")).filter((c) => c.name !== "zohoVendorId");
  assertWidth("Vendor", oldVendors, vendorCols);
  const V = {
    id: at(vendorCols, "id"),
    name: at(vendorCols, "name"),
    gstin: at(vendorCols, "gstin"),
    openingBalance: at(vendorCols, "openingBalance"),
  };
  const oldVendorById = new Map(
    oldVendors.map((r) => [
      r[V.id],
      { name: r[V.name], gstin: r[V.gstin], openingBalance: Number(r[V.openingBalance] ?? 0) },
    ]),
  );
  for (const v of oldVendorById.values()) {
    if (v.gstin && !/^[0-9A-Z]{15}$/i.test(v.gstin.trim())) {
      fail(`old Vendor "${v.name}" has "${v.gstin}" where the GSTIN should be — the Vendor columns are not in the expected order.`);
    }
  }

  // ── The current vendors, indexed for the mapping ───────────────────────────────────────────
  const current = await prisma.vendor.findMany({ select: { id: true, name: true, gstin: true, openingBalance: true } });
  const byGstin = new Map();
  const byName = new Map();
  for (const v of current) {
    if (v.gstin) {
      const k = v.gstin.trim().toUpperCase();
      byGstin.set(k, [...(byGstin.get(k) || []), v]);
    }
    byName.set(v.name.trim().toLowerCase(), v);
  }
  console.log(`this database: ${current.length} vendors`);

  const mapCache = new Map();
  function mapVendor(oldId) {
    if (mapCache.has(oldId)) return mapCache.get(oldId);
    const old = oldVendorById.get(oldId);
    let result;
    if (!old) result = { how: "unknown", vendor: null, old: { name: `(vendor ${oldId} not in the dump)`, gstin: null } };
    else {
      const g = old.gstin ? byGstin.get(old.gstin.trim().toUpperCase()) : undefined;
      const n = byName.get(old.name.trim().toLowerCase());
      if (g && g.length === 1) result = { how: "gstin", vendor: g[0], old };
      else if (n) result = { how: "name", vendor: n, old };
      else result = { how: "none", vendor: null, old, shared: g?.map((x) => x.name) };
    }
    mapCache.set(oldId, result);
    return result;
  }

  // ── Users: keep the original author when they exist here ───────────────────────────────────
  const authorIds = [...new Set([...oldIssues.map((r) => r[I.createdById]), ...oldNotes.map((r) => r[N.authorId])])];
  const present = new Set(
    (await prisma.user.findMany({ where: { id: { in: authorIds } }, select: { id: true } })).map((u) => u.id),
  );
  let fallbackAuthor = null;
  if (authorIds.some((id) => !present.has(id))) {
    const u = await prisma.user.findFirst({
      where: { isActive: true, role: { isSystem: true } },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true },
    });
    if (!u) fail("some authors in the dump are not users here, and no active user holds a system role to stand in.");
    fallbackAuthor = u;
    console.log(`authors not in this database -> ${u.name} (${u.id})`);
  }
  const author = (id) => (present.has(id) ? id : fallbackAuthor.id);

  // ── Already here: skip, never overwrite ────────────────────────────────────────────────────
  const existing = await prisma.vendorIssue.findMany({
    where: {
      OR: [{ issueNo: { in: oldIssues.map((r) => r[I.issueNo]) } }, { id: { in: oldIssues.map((r) => r[I.id]) } }],
    },
    select: { id: true, issueNo: true },
  });
  const existingNos = new Set(existing.map((e) => e.issueNo));
  const existingIds = new Set(existing.map((e) => e.id));

  const report = { gstin: [], name: [], unattached: [], skipped: [] };
  const issueRows = [];
  for (const r of oldIssues) {
    const no = r[I.issueNo];
    if (existingNos.has(no) || existingIds.has(r[I.id])) {
      report.skipped.push(no);
      continue;
    }
    const row = [...r];
    row[I.billId] = null;
    row[I.createdById] = author(r[I.createdById]);
    if (r[I.vendorId]) {
      const m = mapVendor(r[I.vendorId]);
      row[I.vendorId] = m.vendor?.id ?? null;
      if (m.vendor) report[m.how].push({ no, from: m.old.name, to: m.vendor.name });
      else report.unattached.push({ no, from: m.old.name, why: m.shared ? `GSTIN shared by ${m.shared.join(", ")}` : "no vendor with this GSTIN or name" });
    } else {
      report.unattached.push({ no, from: "(no vendor on the old issue)", why: "not a vendor issue" });
    }
    issueRows.push(row);
  }
  const insertedIssueIds = new Set(issueRows.map((r) => r[I.id]));
  const existingNoteIds = new Set(
    (await prisma.vendorIssueNote.findMany({ where: { id: { in: oldNotes.map((r) => r[N.id]) } }, select: { id: true } })).map(
      (n) => n.id,
    ),
  );
  const noteRows = oldNotes
    .filter((r) => insertedIssueIds.has(r[N.issueId]) && !existingNoteIds.has(r[N.id]))
    .map((r) => {
      const row = [...r];
      row[N.authorId] = author(r[N.authorId]);
      return row;
    });

  // ── Opening balances: only onto a current vendor still at 0 ────────────────────────────────
  const balances = [];
  const balReport = { unmatched: [], alreadySet: [] };
  const balanceTaken = new Set();
  for (const [oldId, old] of oldVendorById) {
    if (!Number.isFinite(old.openingBalance) || old.openingBalance === 0) continue;
    const m = mapVendor(oldId);
    if (!m.vendor) {
      balReport.unmatched.push({ from: old.name, amount: old.openingBalance, why: m.shared ? `GSTIN shared by ${m.shared.join(", ")}` : "no vendor with this GSTIN or name" });
    } else if (m.vendor.openingBalance !== 0 || balanceTaken.has(m.vendor.id)) {
      balReport.alreadySet.push({ from: old.name, to: m.vendor.name, amount: old.openingBalance, has: m.vendor.openingBalance });
    } else {
      balanceTaken.add(m.vendor.id);
      balances.push({ id: m.vendor.id, from: old.name, to: m.vendor.name, how: m.how, amount: old.openingBalance });
    }
  }

  // ── Write, in one transaction ──────────────────────────────────────────────────────────────
  const months = [...new Set(issueRows.map((r) => r[I.issueNo].split("-").slice(0, 2).join("-")))].sort();
  if (!DRY_RUN && (issueRows.length || balances.length)) {
    await writeRollback(issueRows.map((r) => r[I.id]), months, balances);
  }
  let counters = [];
  try {
    await prisma.$transaction(
      async (tx) => {
        if (issueRows.length) await tx.$executeRaw(insertSql("VendorIssue", issueCols, issueRows));
        if (noteRows.length) await tx.$executeRaw(insertSql("VendorIssueNote", noteCols, noteRows));
        for (const prefix of months) {
          // Same numeric read as issSeedSql() in src/lib/vendor-issues/sequence.ts.
          const [{ max }] = await tx.$queryRaw`
            SELECT COALESCE(MAX(NULLIF(regexp_replace(split_part("issueNo", '-', 3), '\\D', '', 'g'), '')::int), 0) AS max
            FROM "VendorIssue" WHERE "issueNo" LIKE ${prefix + "-%"}`;
          const [row] = await tx.$queryRaw`
            INSERT INTO counter (key, current) VALUES (${prefix}, ${max})
            ON CONFLICT (key) DO UPDATE SET current = GREATEST(counter.current, EXCLUDED.current)
            RETURNING key, current`;
          counters.push(row);
        }
        for (const b of balances) {
          // `= 0` again inside the transaction: a hand edit since the read above is not overwritten.
          const n = await tx.$executeRaw`
            UPDATE "Vendor" SET "openingBalance" = ${b.amount}, "updatedAt" = now()
            WHERE id = ${b.id} AND "openingBalance" = 0`;
          if (n !== 1) throw new Error(`opening balance for ${b.to} changed while this ran — nothing was kept; re-run.`);
        }
        if (DRY_RUN) throw new DryRunRollback();
      },
      { timeout: 120_000, maxWait: 20_000 },
    );
  } catch (e) {
    if (!(e instanceof DryRunRollback)) {
      console.error(`${TAG}: the write failed and was rolled back — nothing was kept.`);
      throw e;
    }
  }

  // ── Report ─────────────────────────────────────────────────────────────────────────────────
  const verb = DRY_RUN ? "would insert" : "inserted";
  const perVendor = (list) => {
    const m = new Map();
    for (const x of list) m.set(`${x.from} -> ${x.to}`, (m.get(`${x.from} -> ${x.to}`) || 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1]).map(([k, n]) => `    ${String(n).padStart(3)}  ${k}`).join("\n");
  };
  console.log(`\n${verb} ${issueRows.length} issues and ${noteRows.length} notes`);
  console.log(`\n  matched by GSTIN: ${report.gstin.length}`);
  if (report.gstin.length) console.log(perVendor(report.gstin));
  console.log(`\n  matched by name: ${report.name.length}`);
  if (report.name.length) console.log(perVendor(report.name));
  console.log(`\n  unattached (vendor left empty): ${report.unattached.length}`);
  for (const u of report.unattached) console.log(`    ${u.no}  ${u.from} — ${u.why}`);
  console.log(`\n  skipped, already here: ${report.skipped.length}`);
  if (report.skipped.length) console.log(`    ${report.skipped.join(", ")}`);
  if (counters.length) {
    console.log(`\n  issue counters ${DRY_RUN ? "would be raised" : "raised"} to:`);
    for (const c of counters) console.log(`    ${c.key} = ${c.current}`);
  }
  const inr = (n) => `₹${n.toLocaleString("en-IN")}`;
  console.log(`\n${DRY_RUN ? "would set" : "set"} ${balances.length} opening balances (total ${inr(balances.reduce((t, b) => t + b.amount, 0))})`);
  for (const b of balances) console.log(`    ${inr(b.amount).padStart(15)}  ${b.from} -> ${b.to}${b.how === "name" ? "  (by name)" : ""}`);
  if (balReport.alreadySet.length) {
    console.log(`\n  opening balance left alone, vendor already has one: ${balReport.alreadySet.length}`);
    for (const b of balReport.alreadySet) console.log(`    ${b.to}: has ${inr(b.has)}, backup says ${inr(b.amount)}`);
  }
  if (balReport.unmatched.length) {
    console.log(`\n  opening balance with no vendor to go on: ${balReport.unmatched.length}`);
    for (const b of balReport.unmatched) console.log(`    ${inr(b.amount)}  ${b.from} — ${b.why}`);
  }
  console.log(DRY_RUN ? "\ndry run — rolled back, nothing was written.\n" : "\ndone.\n");
}

main()
  .catch((e) => {
    console.error(`${TAG}: ${e.message}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
