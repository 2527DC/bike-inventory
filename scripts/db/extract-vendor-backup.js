// Extract Vendor / VendorContact / VendorIssue / VendorIssueNote (+ the users they reference)
// from a pg_dump --inserts file and re-emit them as INSERTs with EXPLICIT column lists that
// match prisma/schema.prisma today. Positional INSERTs from the backup cannot be pasted as-is:
// column order is a property of the OLD table definition.
//
// Usage: node extract-vendor-backup.js <backup.sql> <schema.prisma> <out.sql> <out.md> [--user=<id>]
//
// --user=<id>  Point EVERY VendorIssue.createdById and VendorIssueNote.authorId at this one
//              existing user in the target database, and do not insert the old users at all.
//              Authorship is lost (every issue and note shows as created by that user), but the
//              file then depends on nothing except the four vendor tables. The id MUST exist in
//              the target's "User" table or the paste fails on the foreign key.
// (without)    Carry the referenced old users across, inactive, so authorship survives.

const fs = require("fs");
const args = process.argv.slice(2);
const REMAP_USER = (args.find((a) => a.startsWith("--user=")) || "").slice("--user=".length) || null;
const [BACKUP, SCHEMA, OUT_SQL, OUT_MD] = args.filter((a) => !a.startsWith("--"));
if (!BACKUP || !SCHEMA || !OUT_SQL || !OUT_MD) {
  console.error("usage: node extract-vendor-backup.js <backup.sql> <schema.prisma> <out.sql> <out.md> [--user=<id>]");
  process.exit(1);
}
if (REMAP_USER && !/^[A-Za-z0-9_-]+$/.test(REMAP_USER)) {
  console.error(`--user must be a plain id, got: ${REMAP_USER}`);
  process.exit(1);
}

const backup = fs.readFileSync(BACKUP, "utf8");
const schema = fs.readFileSync(SCHEMA, "utf8");

// ── 1. Backup: CREATE TABLE column lists (ordered) ─────────────────────────────
function backupColumns(table) {
  const start = backup.indexOf(`CREATE TABLE public."${table}" (`);
  if (start < 0) throw new Error(`backup has no CREATE TABLE for ${table}`);
  const end = backup.indexOf("\n);", start);
  const body = backup.slice(backup.indexOf("(", start) + 1, end);
  const cols = [];
  for (const raw of body.split("\n")) {
    const line = raw.trim().replace(/,$/, "");
    if (!line || /^CONSTRAINT\b/i.test(line)) continue;
    const m = line.match(/^("?)([A-Za-z_][A-Za-z0-9_]*)\1\s+(.+)$/);
    if (!m) continue;
    const name = m[2];
    let type = m[3];
    const nullable = !/NOT NULL/.test(type);
    const def = (type.match(/DEFAULT (.+?)(?: NOT NULL)?$/) || [])[1] || null;
    type = type.replace(/ DEFAULT .*$/, "").replace(/ NOT NULL$/, "").trim();
    cols.push({ name, type, nullable, def });
  }
  return cols;
}

// ── 2. Backup: parse every `INSERT INTO public."T" VALUES (...)` into raw literals ──────
// Values are kept as the raw SQL text (NULL, 'quoted', 123, true, '{array}') so nothing is
// re-encoded. The tokenizer respects single quotes with '' escaping and E'' prefixes.
function backupRows(table) {
  const head = `INSERT INTO public."${table}" VALUES (`;
  const rows = [];
  let pos = 0;
  while (true) {
    const at = backup.indexOf(head, pos);
    if (at < 0) break;
    let i = at + head.length;
    const vals = [];
    let cur = "";
    let inStr = false;
    let depth = 0; // parentheses inside a value (e.g. function calls) — rare in dumps
    while (i < backup.length) {
      const ch = backup[i];
      if (inStr) {
        cur += ch;
        if (ch === "'") {
          if (backup[i + 1] === "'") { cur += "'"; i += 2; continue; }
          inStr = false;
        }
        i++;
        continue;
      }
      if (ch === "'") { inStr = true; cur += ch; i++; continue; }
      if (ch === "(") { depth++; cur += ch; i++; continue; }
      if (ch === ")") {
        if (depth === 0) { vals.push(cur.trim()); i++; break; }
        depth--; cur += ch; i++; continue;
      }
      if (ch === "," && depth === 0) { vals.push(cur.trim()); cur = ""; i++; continue; }
      cur += ch; i++;
    }
    rows.push(vals);
    pos = i;
  }
  return rows;
}

// ── 3. Current schema: scalar columns per model, in declaration order ─────────────────
const PRISMA_TO_PG = {
  String: "text", Int: "integer", Float: "double precision", Boolean: "boolean",
  DateTime: "timestamp(3) without time zone", Json: "jsonb", BigInt: "bigint", Bytes: "bytea",
};
const enumNames = new Set([...schema.matchAll(/^enum\s+([A-Za-z_]\w*)\s*\{/gm)].map((m) => m[1]));
const modelNames = new Set([...schema.matchAll(/^model\s+([A-Za-z_]\w*)\s*\{/gm)].map((m) => m[1]));

function schemaModel(model) {
  const start = schema.indexOf(`model ${model} {`);
  if (start < 0) throw new Error(`schema has no model ${model}`);
  const end = schema.indexOf("\n}", start);
  const body = schema.slice(start, end);
  let table = model;
  const map = body.match(/@@map\("([^"]+)"\)/);
  if (map) table = map[1];
  const cols = [];
  for (const raw of body.split("\n").slice(1)) {
    const line = raw.replace(/\/\/.*$/, "").trim();
    if (!line || line.startsWith("@@")) continue;
    const m = line.match(/^([A-Za-z_]\w*)\s+([A-Za-z_]\w*)(\[\])?(\?)?\s*(.*)$/);
    if (!m) continue;
    const [, name, type, isArr, isOpt, rest] = m;
    if (modelNames.has(type)) continue;           // relation field, not a column
    if (/@relation/.test(rest)) continue;
    let pg;
    if (enumNames.has(type)) pg = `"${type}"`;
    else if (type === "Decimal") pg = (rest.match(/@db\.Decimal\((\d+),\s*(\d+)\)/) ? `decimal(${RegExp.$1},${RegExp.$2})` : "decimal(65,30)");
    else pg = PRISMA_TO_PG[type] || type;
    if (isArr) pg += "[]";
    const dbName = (rest.match(/@map\("([^"]+)"\)/) || [])[1] || name;
    const def = (rest.match(/@default\(([^)]*)\)/) || [])[1] || null;
    cols.push({ name: dbName, prisma: type + (isArr ? "[]" : "") + (isOpt ? "?" : ""), pg, nullable: !!isOpt, def, updatedAt: /@updatedAt/.test(rest) });
  }
  return { table, cols };
}

// ── 4. The plan: which tables, in FK order, and how users are carried ──────────────────
const TABLES = ["Vendor", "VendorContact", "VendorIssue", "VendorIssueNote"];
const q = (s) => `"${s}"`;

const report = [];
const sql = [];
sql.push("-- Vendor + Vendor Issue backup, re-shaped to prisma/schema.prisma as of 2 Sep 2026.");
sql.push("-- Source: complete_database_backup.sql (pg_dump 17.6, --inserts). Generated by extract-vendor-backup.js.");
sql.push("-- Every INSERT names its columns, so this file does not depend on column ORDER in the target.");
sql.push("-- Safe to re-run: every statement is ON CONFLICT DO NOTHING. Paste into psql / the Supabase SQL editor");
sql.push("-- ONLY on a database whose schema already matches (migrate status: up to date) and whose roles are seeded.");
sql.push("BEGIN;");
sql.push("SET search_path = public;");
sql.push("");

// 4a. Users referenced by issues/notes — carried across INACTIVE, least-privileged role.
const bUserCols = backupColumns("User");
const bUsers = backupRows("User");
const idx = (cols, n) => { const i = cols.findIndex((c) => c.name === n); if (i < 0) throw new Error(`no column ${n}`); return i; };
const uid = idx(bUserCols, "id"), uname = idx(bUserCols, "name"), uemail = idx(bUserCols, "email"),
  upass = idx(bUserCols, "password"), ucode = idx(bUserCols, "accessCode"), ucreated = idx(bUserCols, "createdAt"),
  uupdated = idx(bUserCols, "updatedAt"), unav = idx(bUserCols, "navTabs"), urole = idx(bUserCols, "role");

const bIssueCols = backupColumns("VendorIssue");
const bNoteCols = backupColumns("VendorIssueNote");
const issues = backupRows("VendorIssue");
const notes = backupRows("VendorIssueNote");
const referencedUsers = new Set([
  ...issues.map((r) => r[idx(bIssueCols, "createdById")]),
  ...notes.map((r) => r[idx(bNoteCols, "authorId")]),
].filter((v) => v !== "NULL"));

const userTable = schemaModel("User").table;
const roleTable = schemaModel("Role").table;
let usersEmitted = 0;
const roleFallback = `(SELECT id FROM ${q(roleTable)} WHERE key = 'SERVICE_VIEWER')`;
for (const r of bUsers) {
  const id = r[uid];
  if (!referencedUsers.has(id)) continue;
  report.push({ kind: "user", id: id.replace(/'/g, ""), name: r[uname].replace(/'/g, ""), oldRole: r[urole].replace(/'/g, "") });
}
if (REMAP_USER) {
  sql.push(`-- ${userTable}: NOT inserted. Every VendorIssue.createdById and VendorIssueNote.authorId below is set to`);
  sql.push(`-- '${REMAP_USER}' (owner's instruction). That id must already exist in the target's "${userTable}" table.`);
  sql.push(`-- The ${referencedUsers.size} original authors (${report.map((u) => u.name).join(", ")}) are recorded in the companion .md only.`);
} else {
  sql.push(`-- ${userTable}: ${referencedUsers.size} of ${bUsers.length} backup users are referenced by an issue or a note.`);
  sql.push(`-- They are inserted INACTIVE with the least-privileged seeded role (SERVICE_VIEWER) so that createdById /`);
  sql.push(`-- authorId resolve and authorship survives, without granting anyone access. Reactivate and assign a real`);
  sql.push(`-- role at /team if a person is still on staff. Old password hashes and access codes are kept as-is.`);
  for (const r of bUsers) {
    const id = r[uid];
    if (!referencedUsers.has(id)) continue;
    usersEmitted++;
    sql.push(
      `INSERT INTO ${q(userTable)} ("id","name","email","password","roleId","accessCode","isActive","createdAt","updatedAt","navTabs") VALUES (` +
      `${id}, ${r[uname]}, ${r[uemail]}, ${r[upass]}, ${roleFallback}, ${r[ucode]}, false, ${r[ucreated]}, ${r[uupdated]}, ${r[unav] === "NULL" ? "'{}'" : r[unav]}` +
      `) ON CONFLICT DO NOTHING;`
    );
  }
}
sql.push("");

// 4b. The four tables, mapped column-by-column.
const tableReport = [];
let billIdNulled = 0;
const bBillIds = new Set(backupRows("VendorBill").map((r) => r[idx(backupColumns("VendorBill"), "id")]));

for (const model of TABLES) {
  const { table, cols: sCols } = schemaModel(model);
  const bCols = backupColumns(model);
  const rows = backupRows(model);
  const bIndex = new Map(bCols.map((c, i) => [c.name, i]));

  const emitCols = sCols.filter((c) => bIndex.has(c.name));
  const missingInBackup = sCols.filter((c) => !bIndex.has(c.name));
  const droppedFromSchema = bCols.filter((c) => !sCols.find((s) => s.name === c.name));
  const needValue = missingInBackup.filter((c) => !c.nullable && !c.def && !c.updatedAt);
  if (needValue.length) throw new Error(`${model}: schema requires ${needValue.map((c) => c.name).join(",")} which the backup lacks`);

  sql.push(`-- ${table}: ${rows.length} rows. Columns emitted: ${emitCols.length}/${sCols.length}.` +
    (droppedFromSchema.length ? ` Backup columns no longer in the schema (dropped): ${droppedFromSchema.map((c) => c.name).join(", ")}.` : "") +
    (missingInBackup.length ? ` Schema columns absent from the backup (left to defaults): ${missingInBackup.map((c) => c.name).join(", ")}.` : ""));

  for (const r of rows) {
    const vals = emitCols.map((c) => {
      let v = r[bIndex.get(c.name)];
      // VendorIssue.billId -> VendorBill is not part of this export. Null it rather than fail the FK.
      if (model === "VendorIssue" && c.name === "billId" && v !== "NULL") {
        billIdNulled++;
        return "NULL";
      }
      // --user=<id>: every author FK points at the one user the owner named.
      if (REMAP_USER && ((model === "VendorIssue" && c.name === "createdById") || (model === "VendorIssueNote" && c.name === "authorId"))) {
        return `'${REMAP_USER}'`;
      }
      return v;
    });
    sql.push(`INSERT INTO ${q(table)} (${emitCols.map((c) => q(c.name)).join(",")}) VALUES (${vals.join(", ")}) ON CONFLICT DO NOTHING;`);
  }
  sql.push("");

  tableReport.push({ model, table, rows: rows.length, sCols, bCols, emitCols, missingInBackup, droppedFromSchema });
}

sql.push("COMMIT;");
sql.push("");
sql.push("-- Verify after pasting:");
sql.push(`-- SELECT (SELECT count(*) FROM "Vendor") vendors, (SELECT count(*) FROM "VendorContact") contacts,`);
sql.push(`--        (SELECT count(*) FROM "VendorIssue") issues, (SELECT count(*) FROM "VendorIssueNote") notes;`);
fs.writeFileSync(OUT_SQL, sql.join("\n"), "utf8");

// ── 5. The data-type document ───────────────────────────────────────────────────────
const md = [];
md.push("# Vendor & Vendor Issue backup — column and data-type map");
md.push("");
md.push("Companion to the generated SQL file. For each table: every column in the current");
md.push("`prisma/schema.prisma`, its Prisma type, the PostgreSQL type it becomes, the type the");
md.push("backup (`complete_database_backup.sql`, pg_dump 17.6) had for it, and whether the value");
md.push("is carried across. Generated by `extract-vendor-backup.js`; do not hand-edit — regenerate.");
md.push("");
md.push("## How the SQL was shaped");
md.push("");
md.push("- The backup's `INSERT`s are **positional** (`INSERT INTO t VALUES (…)`) — their meaning depends");
md.push("  on the OLD table's column order. The generated file names every column explicitly, in the");
md.push("  current schema's order, so it pastes correctly regardless of order.");
md.push("- Every statement ends `ON CONFLICT DO NOTHING`, so the file can be pasted twice without error");
md.push("  and never overwrites a row that already exists (by id, or by any unique key such as");
md.push("  `Vendor.name`, `Vendor.code`, `VendorIssue.issueNo`, `User.email`).");
md.push("- Enum columns (`IssueType`, `IssueStatus`, `IssuePriority`, `IssueSource`) have **identical value");
md.push("  sets** on both sides; the text literal casts to the enum on insert.");
md.push("- `timestamp(3) without time zone`, `text[]` and `double precision` are the same on both sides.");
md.push("");
md.push("## Foreign keys and what was done about them");
md.push("");
md.push("| FK | Target | Decision |");
md.push("|---|---|---|");
if (REMAP_USER) {
  md.push(`| \`VendorIssue.createdById\`, \`VendorIssueNote.authorId\` | \`${userTable}\` | **Every value set to \`${REMAP_USER}\`** (owner's instruction, \`--user=\`). No user rows are inserted. That id must already exist in the target — otherwise the paste fails on this foreign key. Original authorship is lost in the database; the original authors are listed below for the record. |`);
} else {
  md.push(`| \`VendorIssue.createdById\`, \`VendorIssueNote.authorId\` | \`${userTable}\` | The ${usersEmitted} referenced users are inserted first, **inactive**, with role \`SERVICE_VIEWER\` resolved by subquery at paste time. Reactivate / re-role at /team. |`);
}
md.push(`| \`VendorIssue.billId\` | \`VendorBill\` | **Set to NULL** on ${billIdNulled} row(s) — bills are not part of this export (they pull PurchaseOrder, InboundShipment and payments with them). The issue text and notes are intact; only the link to the bill is dropped. |`);
md.push(`| \`VendorContact.vendorId\`, \`VendorIssue.vendorId\` | \`Vendor\` | Vendors are inserted first; ids are preserved. |`);
md.push(`| \`VendorIssueNote.issueId\` | \`VendorIssue\` | Issues are inserted before notes; ids are preserved. |`);
if (!REMAP_USER) {
  md.push(`| \`${userTable}.roleId\` | \`${roleTable}\` | Resolved by \`(SELECT id FROM ${roleTable} WHERE key = 'SERVICE_VIEWER')\` — the target must have run \`npm run db:seed:rbac\`. |`);
}
md.push("");
md.push(REMAP_USER ? "## Original authors in the backup (NOT inserted — for the record only)" : "## Users carried across (inactive)");
md.push("");
md.push("| id in the backup | name | role in the backup |");
md.push("|---|---|---|");
for (const u of report) md.push(`| \`${u.id}\` | ${u.name} | ${u.oldRole} |`);
md.push("");
md.push("The backup's `User` had `role` (an enum), `customRoleName` and `permissions jsonb` — the old");
md.push("file-based RBAC. The current schema has `roleId` → `" + roleTable + "`. There is no automatic mapping from");
md.push("an old enum value to a seeded role" + (REMAP_USER ? "." : ", which is why every carried user gets the least-privileged\nrole and `isActive = false`."));
md.push("");
md.push("**Why the raw backup could not simply be pasted** — the column-order and foreign-key problems,");
md.push("with the exact columns that error — is written up in `docs/vendor-backup-issues.md`.");
md.push("");

for (const t of tableReport) {
  md.push(`## \`${t.table}\` — ${t.rows} rows`);
  md.push("");
  md.push("| Column (schema order) | Prisma type | PostgreSQL type (schema) | Backup type | Nullable | Default | Carried? |");
  md.push("|---|---|---|---|---|---|---|");
  for (const c of t.sCols) {
    const b = t.bCols.find((x) => x.name === c.name);
    let carried = b ? "yes" : "no — left to default";
    if (t.model === "VendorIssue" && c.name === "billId") carried = "**NULL** (bill not exported)";
    const same = b && b.type.replace(/^public\./, "").replace(/"/g, "") === c.pg.replace(/"/g, "");
    md.push(`| \`${c.name}\` | \`${c.prisma}\` | \`${c.pg}\` | ${b ? "`" + b.type.replace(/^public\./, "") + "`" + (same ? "" : " ⚠ differs") : "—"} | ${c.nullable ? "yes" : "no"} | ${c.def ?? (c.updatedAt ? "@updatedAt" : "—")} | ${carried} |`);
  }
  if (t.droppedFromSchema.length) {
    md.push("");
    md.push(`Backup columns **not** in the current schema (dropped, not carried): ${t.droppedFromSchema.map((c) => "`" + c.name + "` (" + c.type + ")").join(", ")}.`);
  }
  md.push("");
}

md.push("## Prisma → PostgreSQL type reference used above");
md.push("");
md.push("| Prisma | PostgreSQL |");
md.push("|---|---|");
for (const [k, v] of Object.entries(PRISMA_TO_PG)) md.push(`| \`${k}\` | \`${v}\` |`);
md.push("| `Decimal @db.Decimal(p, s)` | `decimal(p, s)` |");
md.push("| `String[]` | `text[]` |");
md.push("| `enum X` | `\"X\"` (a PostgreSQL enum type) |");
md.push("");
md.push("## Regenerating the SQL, and where the files live");
md.push("");
md.push("The SQL file holds real data — GSTINs, phone numbers" + (REMAP_USER ? "" : ", staff password hashes") + " — so it lives");
md.push("**outside the repository**, next to the backup it came from, and must never be committed or");
md.push("pasted into a chat or a ticket:");
md.push("");
md.push("```");
md.push("F:\\bharath  Cycle\\complete_database_backup.sql        ← the full pg_dump (source, read-only)");
md.push("F:\\bharath  Cycle\\vendor-and-issues-backup.sql        ← the generated file to paste");
md.push("```");
md.push("");
md.push("To regenerate (for example after a schema change to any of the four tables), from the repo root:");
md.push("");
md.push("```");
md.push(`node scripts/db/extract-vendor-backup.js "F:\\bharath  Cycle\\complete_database_backup.sql" prisma\\schema.prisma "F:\\bharath  Cycle\\vendor-and-issues-backup.sql" docs\\vendor-issues-backup-restore.md${REMAP_USER ? " --user=" + REMAP_USER : ""}`);
md.push("```");
md.push("");
md.push("`--user=<id>` points every issue/note author at that one existing user and inserts no user rows;");
md.push("without it, the original authors are carried across as inactive users. It rewrites both the SQL and");
md.push("this document from the current `schema.prisma`. If the schema gained a required column the backup");
md.push("does not have, it stops and names the column instead of emitting SQL that would fail on paste.");
md.push("");
md.push("## Pasting it");
md.push("");
md.push("1. The target must be up to date (`npx prisma migrate status`)" + (REMAP_USER ? ` and the user \`${REMAP_USER}\` must exist in its \`${userTable}\` table.` : " and seeded (`npm run db:seed:rbac`) — the user rows need the `SERVICE_VIEWER` role to exist."));
md.push("2. `psql \"<url>\" -v ON_ERROR_STOP=1 -f \"F:\\bharath  Cycle\\vendor-and-issues-backup.sql\"`, or paste");
md.push("   the whole file into the Supabase SQL editor. It is one transaction: it all lands or none of it.");
md.push("3. Verify with the `SELECT` at the bottom of the file — expect 83 vendors, 18 contacts,");
md.push("   183 issues, 289 notes.");
md.push("");
fs.writeFileSync(OUT_MD, md.join("\n"), "utf8");

// ── 6. Console summary ───────────────────────────────────────────────────────────────
console.log(`users referenced: ${referencedUsers.size} (emitted ${usersEmitted}, inactive, SERVICE_VIEWER)`);
for (const t of tableReport) {
  console.log(`${t.table.padEnd(16)} rows=${String(t.rows).padStart(4)}  cols emitted ${t.emitCols.length}/${t.sCols.length}` +
    (t.droppedFromSchema.length ? `  dropped: ${t.droppedFromSchema.map((c) => c.name).join(",")}` : "") +
    (t.missingInBackup.length ? `  defaulted: ${t.missingInBackup.map((c) => c.name).join(",")}` : ""));
}
console.log(`VendorIssue.billId nulled on ${billIdNulled} rows (backup had ${bBillIds.size} VendorBill rows)`);
console.log(`wrote ${OUT_SQL} (${fs.statSync(OUT_SQL).size} bytes) and ${OUT_MD}`);
