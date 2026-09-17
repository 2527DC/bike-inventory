// Clear the category taxonomy of the database `.env` points at, so the Zoho import can rebuild it.
//
//     npm run db:snapshot            <- first, always
//     npm run db:wipe:categories
//     then /categories -> Fetch from Zoho -> Import
//
// Plan 1709-priority-build-and-stock-flow, P12a (b) — owner, 17 Sep 2026: "database level clearing".
//
// WHAT IT DOES, in one transaction
// --------------------------------
// 1. every `Product` is filed under `Uncategorized` (see below — it cannot be null);
// 2. every `InboundShipment.categoryId` -> null (that FK is Restrict and would block the delete);
// 3. every `HomeBinRule` that names a category is deleted (brand-only and product rules stay);
// 4. every `Category.parentId` -> null;
// 5. every `Category` row is deleted EXCEPT `Uncategorized`, which is kept as a clean top-level,
//    active row with no Zoho link.
//
// WHY `Uncategorized` SURVIVES
// ----------------------------
// `Product.categoryId` is NOT NULL (schema.prisma, Product; `0_init` migration), so "detach the
// products" cannot be written as null. `Uncategorized` is the codebase's existing marker for "no
// category" (`src/lib/import-placeholders.ts`), and the Zoho import files a product with no
// Zoho category under it too. Keeping that one row is what lets every other row be deleted.
//
// WHAT IT KEEPS
// -------------
// Products (and their status), stock levels, units, bins, BinStock, brand-only and product
// home-bin rules, inbound shipments (without their category), activity logs.
//
// Other relations checked in prisma/schema.prisma (17 Sep 2026): Category is referenced by
// Product.categoryId (Restrict), InboundShipment.categoryId (Restrict), HomeBinRule.category_id
// (Cascade) and its own parentId (SetNull). Nothing else holds a Category id. `rawCategory`
// columns and ActivityLog.entityId are plain strings and are left alone.
//
// SAFETY — copied from wipe-deliveries.mjs
// ----------------------------------------
// - Prints the host, the database and the row counts, then deletes only after you type the
//   database name (or pass `--yes <database name>`).
// - Refuses unless `backups/` holds a `db:snapshot` of THIS database taken in the last 60 minutes
//   (`--no-snapshot` overrides; do not use it on anything that matters). The snapshot is the
//   only way back.
// - One transaction: all of it happens or none of it does.
// - Prints hostnames only, never a URL (it carries the password).
//
// Run it once per database: switch `.env` to the other database and run it again.

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { PrismaClient } from "@prisma/client";

const SNAPSHOT_MAX_AGE_MIN = 60;
// Must equal PLACEHOLDER_CATEGORY in src/lib/import-placeholders.ts (a .ts file this script cannot import).
const PLACEHOLDER_CATEGORY = "Uncategorized";

function fail(message) {
  console.error(`db:wipe:categories: ${message}`);
  process.exit(1);
}

// ── Arguments ──────────────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const yesIndex = args.indexOf("--yes");
const yesName = yesIndex >= 0 ? args[yesIndex + 1] : null;
const skipSnapshotCheck = args.includes("--no-snapshot");

// ── The connection, read the way snapshot.mjs reads it ─────────────────────────────────────
let env;
try {
  env = readFileSync(".env", "utf8");
} catch {
  fail(".env not found — run this from the project root.");
}

// `^KEY=` only: a commented-out line (`# DIRECT_URL=…`) is not the active database.
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
const where = `${dbName} at ${parsed.hostname}:${parsed.port || 5432}`;

console.log(`\ntarget: ${where}`);

// ── Snapshot check ─────────────────────────────────────────────────────────────────────────
if (!skipSnapshotCheck) {
  const cutoff = Date.now() - SNAPSHOT_MAX_AGE_MIN * 60 * 1000;
  const recent = existsSync("backups")
    ? readdirSync("backups")
        .filter((f) => f.startsWith(`${dbName}-`) && f.endsWith(".dump"))
        .map((f) => ({ f, t: statSync(join("backups", f)).mtimeMs, size: statSync(join("backups", f)).size }))
        .filter((x) => x.t >= cutoff && x.size > 0)
        .sort((a, b) => b.t - a.t)
    : [];
  if (recent.length === 0) {
    fail(
      `no snapshot of "${dbName}" in backups/ from the last ${SNAPSHOT_MAX_AGE_MIN} minutes.\n` +
        "  Run `npm run db:snapshot` first — it is the only way back after this runs."
    );
  }
  console.log(`snapshot: backups/${recent[0].f}`);
} else {
  console.log("snapshot: CHECK SKIPPED (--no-snapshot)");
}

// DIRECT_URL, not the 6543 transaction pooler: one long transaction needs a real session.
const prisma = new PrismaClient({ datasourceUrl: url });

const placeholderWhere = { name: { equals: PLACEHOLDER_CATEGORY, mode: "insensitive" } };

async function counts() {
  const placeholder = await prisma.category.findFirst({ where: placeholderWhere, select: { id: true } });
  const notPlaceholder = placeholder ? { not: placeholder.id } : undefined;
  const [categories, withParent, zohoLinked, productsToMove, shipments, categoryRules, otherRules] =
    await Promise.all([
      prisma.category.count({ where: notPlaceholder ? { id: notPlaceholder } : {} }),
      prisma.category.count({ where: { parentId: { not: null } } }),
      prisma.category.count({ where: { zohoCategoryId: { not: null } } }),
      prisma.product.count({ where: notPlaceholder ? { categoryId: notPlaceholder } : {} }),
      prisma.inboundShipment.count({ where: { categoryId: { not: null } } }),
      prisma.homeBinRule.count({ where: { categoryId: { not: null } } }),
      prisma.homeBinRule.count({ where: { categoryId: null } }),
    ]);
  return { placeholderExists: !!placeholder, categories, withParent, zohoLinked, productsToMove, shipments, categoryRules, otherRules };
}

function printCounts(c) {
  console.log(`  Category (deleted; ${PLACEHOLDER_CATEGORY} kept)   ${String(c.categories).padStart(6)}   (${c.withParent} with a parent, ${c.zohoLinked} linked to Zoho)`);
  console.log(`  Product -> ${PLACEHOLDER_CATEGORY}               ${String(c.productsToMove).padStart(6)}`);
  console.log(`  InboundShipment category -> null     ${String(c.shipments).padStart(6)}`);
  console.log(`  HomeBinRule naming a category        ${String(c.categoryRules).padStart(6)}`);
}

async function main() {
  const before = await counts();
  console.log("\nwill delete / clear:");
  printCounts(before);

  const products = await prisma.product.count();
  console.log(
    `\nkept: ${products} product(s) and their stock, units and bins; ${before.otherRules} brand-only / product home-bin rule(s); ` +
      `the ${PLACEHOLDER_CATEGORY} category${before.placeholderExists ? "" : " (created, it does not exist yet)"}.`
  );

  const total = before.categories + before.withParent + before.zohoLinked + before.productsToMove + before.shipments + before.categoryRules;
  if (total === 0) {
    console.log("\nAlready empty — nothing to do.");
    return;
  }

  let typed = yesName;
  if (typed === null) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    typed = (await rl.question(`\nThis cannot be undone except from the snapshot.\nType the database name (${dbName}) to continue: `)).trim();
    rl.close();
  }
  if (typed !== dbName) {
    console.log("Not confirmed — nothing was deleted.");
    process.exitCode = 1;
    return;
  }

  const started = Date.now();
  const done = await prisma.$transaction(
    async (tx) => {
      // The kept row, made clean: top level, active, no Zoho link. Found case-insensitively
      // because Category.name is unique and a second spelling would collide with it.
      const existing = await tx.category.findFirst({ where: placeholderWhere, select: { id: true } });
      const placeholder = existing
        ? await tx.category.update({
            where: { id: existing.id },
            data: { parentId: null, zohoCategoryId: null, isActive: true },
            select: { id: true },
          })
        : await tx.category.create({ data: { name: PLACEHOLDER_CATEGORY }, select: { id: true } });

      const products = await tx.product.updateMany({
        where: { categoryId: { not: placeholder.id } },
        data: { categoryId: placeholder.id },
      });
      const shipments = await tx.inboundShipment.updateMany({
        where: { categoryId: { not: null } },
        data: { categoryId: null },
      });
      const rules = await tx.homeBinRule.deleteMany({ where: { categoryId: { not: null } } });
      const parents = await tx.category.updateMany({
        where: { parentId: { not: null } },
        data: { parentId: null },
      });
      const categories = await tx.category.deleteMany({ where: { id: { not: placeholder.id } } });
      return { products, shipments, rules, parents, categories };
    },
    { maxWait: 10_000, timeout: 120_000 }
  );

  console.log(`\ndone on ${where} in ${((Date.now() - started) / 1000).toFixed(1)} s:`);
  console.log(`  deleted ${done.categories.count} categor(ies) and ${done.rules.count} category home-bin rule(s)`);
  console.log(`  moved ${done.products.count} product(s) to ${PLACEHOLDER_CATEGORY}; cleared ${done.parents.count} parent link(s) and ${done.shipments.count} shipment categor(ies)`);

  const after = await counts();
  const left = after.categories + after.withParent + after.zohoLinked + after.productsToMove + after.shipments + after.categoryRules;
  if (left !== 0) {
    console.error("\nWARNING: rows remain — something wrote while this ran:");
    printCounts(after);
    process.exitCode = 1;
    return;
  }
  console.log(`verified: only ${PLACEHOLDER_CATEGORY} is left, and every product is filed under it.`);
  console.log("\nnext:");
  console.log("  1. Run Fetch from Zoho on /categories (Import) — it rebuilds parent and child and files every product under its Zoho category.");
  console.log("  2. Re-create the category home-bin rules on /bins.");
}

main()
  .catch((e) => {
    // Prisma errors can echo the connection target; print the message only, never the URL.
    console.error("\ndb:wipe:categories failed — nothing was deleted (the transaction rolled back):");
    console.error(`  ${e instanceof Error ? e.message.split("\n").slice(-3).join(" ").slice(0, 400) : String(e)}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
