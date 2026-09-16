// Empty the delivery / dispatch data of the database `.env` points at.
//
//     npm run db:snapshot            <- first, always
//     npm run db:wipe:deliveries
//
// WHAT IT DELETES (owner, 16 Sep 2026)
// ------------------------------------
// - every `Delivery` row, in every status (pending, scheduled, dispatched, delivered, walk-out);
// - every `PreBooking` row;
// - every `ZohoPullPreview` row whose entityType is "invoice" — the Bulk Fetch previews that turn
//   into deliveries. Item, bill and contact previews are left alone;
// - every stock HOLD: `StockLevel.reservedQuantity` and `Product.reservedStock` go to 0. Since
//   plan 1609 the only thing that holds stock is a delivery, so once the deliveries are gone
//   every hold is an orphan that would block stock nobody is waiting for.
//
// WHAT IT KEEPS, deliberately
// ---------------------------
// - stock quantities and the OUTWARD `InventoryTransaction` rows of walk-outs and deliveries
//   already handed over: those cycles really left the shop, so the numbers stay true;
// - `Customer` rows, including the ones Save Customer created (the table is shared with the
//   workshop and receivables);
// - `ZohoPullLog` (it also records item, bill and contact pulls);
// - the floor warehouses' invoice prefixes and primary flags, WhatsApp templates, alert settings.
//
// SAFETY
// ------
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

function fail(message) {
  console.error(`db:wipe:deliveries: ${message}`);
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

async function counts() {
  const [deliveries, byStatus, preBookings, invoicePreviews, heldLevels, heldProducts, heldDeliveries] =
    await Promise.all([
      prisma.delivery.count(),
      prisma.delivery.groupBy({ by: ["status"], _count: { _all: true } }),
      prisma.preBooking.count(),
      prisma.zohoPullPreview.count({ where: { entityType: "invoice" } }),
      prisma.stockLevel.count({ where: { reservedQuantity: { not: 0 } } }),
      prisma.product.count({ where: { reservedStock: { not: 0 } } }),
      prisma.delivery.count({ where: { stockReservedAt: { not: null } } }),
    ]);
  return { deliveries, byStatus, preBookings, invoicePreviews, heldLevels, heldProducts, heldDeliveries };
}

function printCounts(c) {
  const status = c.byStatus
    .sort((a, b) => a.status.localeCompare(b.status))
    .map((s) => `${s.status} ${s._count._all}`)
    .join(", ");
  console.log(`  Delivery                     ${String(c.deliveries).padStart(6)}${status ? `   (${status})` : ""}`);
  console.log(`  PreBooking                   ${String(c.preBookings).padStart(6)}`);
  console.log(`  ZohoPullPreview (invoice)    ${String(c.invoicePreviews).padStart(6)}`);
  console.log(`  StockLevel with a hold       ${String(c.heldLevels).padStart(6)}`);
  console.log(`  Product with reservedStock   ${String(c.heldProducts).padStart(6)}`);
}

async function main() {
  const before = await counts();
  console.log("\nwill delete / clear:");
  printCounts(before);

  const outward = await prisma.inventoryTransaction.count({ where: { type: "OUTWARD" } });
  console.log(`\nkept: ${outward} OUTWARD stock movement(s), all stock quantities, customers, pull logs, warehouse prefixes.`);

  const total = before.deliveries + before.preBookings + before.invoicePreviews + before.heldLevels + before.heldProducts;
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
  const [levels, products, previews, preBookings, deliveries] = await prisma.$transaction(
    [
      prisma.stockLevel.updateMany({ where: { reservedQuantity: { not: 0 } }, data: { reservedQuantity: 0 } }),
      prisma.product.updateMany({ where: { reservedStock: { not: 0 } }, data: { reservedStock: 0 } }),
      prisma.zohoPullPreview.deleteMany({ where: { entityType: "invoice" } }),
      prisma.preBooking.deleteMany({}),
      prisma.delivery.deleteMany({}),
    ],
    { timeout: 120_000 }
  );

  console.log(`\ndone on ${where} in ${((Date.now() - started) / 1000).toFixed(1)} s:`);
  console.log(`  deleted ${deliveries.count} delivery, ${preBookings.count} pre-booking, ${previews.count} invoice preview row(s)`);
  console.log(`  released holds on ${levels.count} stock level(s) and ${products.count} product(s)`);

  const after = await counts();
  const left = after.deliveries + after.preBookings + after.invoicePreviews + after.heldLevels + after.heldProducts;
  if (left !== 0) {
    console.error("\nWARNING: rows remain — something wrote while this ran:");
    printCounts(after);
    process.exitCode = 1;
    return;
  }

  // Pull logs whose only previews were invoices now point at nothing. Harmless (the review screen
  // shows an empty pull), reported so it is not a surprise.
  const emptyPending = await prisma.$queryRaw`
    SELECT count(*)::int AS n FROM "ZohoPullLog" l
    WHERE l.status = 'PENDING_REVIEW'
      AND NOT EXISTS (SELECT 1 FROM "ZohoPullPreview" p WHERE p."pullId" = l."pullId")`;
  const n = emptyPending[0]?.n ?? 0;
  if (n > 0) console.log(`  note: ${n} pull log(s) still marked PENDING_REVIEW now have no previews left`);
  console.log("verified: every delivery table is empty.");
}

main()
  .catch((e) => {
    // Prisma errors can echo the connection target; print the message only, never the URL.
    console.error("\ndb:wipe:deliveries failed — nothing was deleted (the transaction rolled back):");
    console.error(`  ${e instanceof Error ? e.message.split("\n").slice(-3).join(" ").slice(0, 400) : String(e)}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
