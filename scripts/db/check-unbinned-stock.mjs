// Before go-live: is any stock sitting outside a bin?   READ-ONLY — this script never writes.
//
//     npm run db:check:unbinned
//
// Plan 2109 R37 (owner, 21 Sep 2026). Run once per database before go-live. The expected answer
// is "nothing listed". Anything listed is counted into bins once, bin by bin, before go-live.
//
// It reports two things:
//   1. per warehouse × product: StockLevel.quantity − live units that HAVE a bin, where > 0 —
//      quantity the warehouse claims that no binned unit covers (inbounds received while bins
//      were off, or older data);
//   2. live units with no bin (`bin_id IS NULL`).
//
// "Live" = the statuses in LIVE_UNIT_STATUSES (src/lib/units/constants.ts), i.e. not SOLD, LOST,
// RESET or TRANSFERRED. That is a .ts file this script cannot import, so the list is copied
// below — keep the two equal.
//
// Prints the host and database only, never the URL (it carries the password).

import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

// Must equal LIVE_UNIT_STATUSES in src/lib/units/constants.ts.
const LIVE_UNIT_STATUSES = ["RECEIVED", "PUT_AWAY", "ASSIGNED", "IN_ASSEMBLY", "ASSEMBLED", "RESERVED", "RETURNED", "DAMAGED"];

function fail(message) {
  console.error(`db:check:unbinned: ${message}`);
  process.exit(1);
}

let env;
try {
  env = readFileSync(".env", "utf8");
} catch {
  fail(".env not found — run this from the project root.");
}
// `^KEY=` only: a commented-out line is not the active database.
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
console.log(`\ntarget: ${dbName} at ${parsed.hostname}:${parsed.port || 5432}  (read-only)\n`);

const prisma = new PrismaClient({ datasourceUrl: url });

async function main() {
  // Reads only, in one read-only transaction so a mistake below cannot write.
  const [uncovered, binless, totals] = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");

    const uncovered = await tx.$queryRaw`
      SELECT w.code AS warehouse, p.sku, p.name AS product,
             sl.quantity::int AS quantity,
             COALESCE(u.binned, 0)::int AS binned,
             (sl.quantity - COALESCE(u.binned, 0))::int AS "notInBin"
      FROM "StockLevel" sl
      JOIN "Warehouse" w ON w.id = sl."warehouseId"
      JOIN "Product"   p ON p.id = sl."productId"
      LEFT JOIN (
        SELECT warehouse_id, product_id, count(*) AS binned
        FROM inventory_units
        WHERE bin_id IS NOT NULL AND status::text = ANY(${LIVE_UNIT_STATUSES})
        GROUP BY warehouse_id, product_id
      ) u ON u.warehouse_id = sl."warehouseId" AND u.product_id = sl."productId"
      WHERE sl.quantity - COALESCE(u.binned, 0) > 0
      ORDER BY w.code, p.name`;

    const binless = await tx.$queryRaw`
      SELECT w.code AS warehouse, p.sku, p.name AS product, u.status::text AS status,
             count(*)::int AS units, min(u.unit_code) AS "firstCode"
      FROM inventory_units u
      JOIN "Warehouse" w ON w.id = u.warehouse_id
      JOIN "Product"   p ON p.id = u.product_id
      WHERE u.bin_id IS NULL AND u.status::text = ANY(${LIVE_UNIT_STATUSES})
      GROUP BY w.code, p.sku, p.name, u.status
      ORDER BY w.code, p.name, u.status`;

    const [totals] = await tx.$queryRaw`
      SELECT (SELECT count(*) FROM "StockLevel" WHERE quantity > 0)::int AS "stockRows",
             (SELECT COALESCE(sum(quantity), 0) FROM "StockLevel")::int AS "stockQty",
             (SELECT count(*) FROM inventory_units WHERE status::text = ANY(${LIVE_UNIT_STATUSES}))::int AS "liveUnits",
             (SELECT count(*) FROM inventory_units
                WHERE bin_id IS NOT NULL AND status::text = ANY(${LIVE_UNIT_STATUSES}))::int AS "binnedUnits"`;

    return [uncovered, binless, totals];
  });

  console.log(
    `StockLevel: ${totals.stockRows} row(s) with quantity > 0, total quantity ${totals.stockQty}.` +
      `\nLive units: ${totals.liveUnits}, of which in a bin: ${totals.binnedUnits}.\n`
  );

  const qty = uncovered.reduce((n, r) => n + r.notInBin, 0);
  console.log(`1. Quantity not covered by binned units: ${uncovered.length} warehouse × product row(s), ${qty} item(s)`);
  if (uncovered.length === 0) console.log("   none");
  for (const r of uncovered) {
    console.log(`   ${r.warehouse}  ${r.sku}  ${r.product}  — stock ${r.quantity}, in bins ${r.binned}, NOT IN A BIN ${r.notInBin}`);
  }

  const units = binless.reduce((n, r) => n + r.units, 0);
  console.log(`\n2. Live units with no bin: ${units}`);
  if (binless.length === 0) console.log("   none");
  for (const r of binless) {
    console.log(`   ${r.warehouse}  ${r.sku}  ${r.product}  — ${r.units} × ${r.status} (e.g. ${r.firstCode})`);
  }

  console.log(
    uncovered.length === 0 && binless.length === 0
      ? "\nOK: no stock sits outside a bin."
      : "\nACTION: count the items above into bins (bin by bin) before go-live."
  );
}

main()
  .catch((e) => {
    console.error(`db:check:unbinned: failed — ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
