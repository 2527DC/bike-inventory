// Put back every product whose shown stock disagrees with its stock rows.
//
//     npm run db:repair:stock-total                                  dry run — READ-ONLY, the default
//     npm run db:repair:stock-total -- --apply --user <email>        writes
//
// Plan 0310-audit-delete-reverses-another-audit, R1 (owner, 3 Oct 2026). Take a snapshot first:
// `npm run db:snapshot`.
//
// WHY
// ---
// `Product.currentStock` is a cache of SUM(StockLevel.quantity) — what /stock shows and sorts by.
// Until 3 Oct 2026, deleting a COMPLETED stock audit "reversed" it by writing that cache back to
// the `previousStock` of every ledger row carrying the audit's TITLE — and every audit of a bin
// carries the same default title. On 30 Sep it zeroed the cache of 25 products counted by the
// approved SC-202609-0003, cleared their bins and erased their ledger rows, while their StockLevel
// rows and units stayed. 7002 showed 0 with 6 bicycles in bin EMOTORAD.
//
// WHAT IT DOES, per product whose `currentStock` ≠ SUM(StockLevel.quantity)
// --------------------------------------------------------------------------
// - sets `currentStock` to the sum — StockLevel is the source of truth; the same arithmetic as
//   `recomputeCurrentStock` (src/lib/stock-location.ts);
// - writes ONE `ADJUSTMENT` ledger row, dated now (plan Q2a): previous = the shown figure, new = the
//   sum, reference `REPAIR-0310`, by the `--user` given. The notes deliberately do NOT contain
//   `[STOCK_COUNT]`, so no audit code ever matches them;
// - gives the product a bin when it has none and every live unit of it sits in ONE bin (plan Q3a) —
//   the bin the reversal cleared.
//
// Each product is its own transaction, re-read inside it, so a product that changed since the dry
// run is skipped rather than overwritten. IDEMPOTENT: a second run finds nothing to repair.
//
// `Product.reservedStock` is not touched (plan §5).
//
// "Live" = LIVE_UNIT_STATUSES (src/lib/units/constants.ts). That is a .ts file this script cannot
// import, so the list is copied below — keep the two equal.
//
// Prints the host and database only, never the URL (it carries the password).

import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

// Must equal LIVE_UNIT_STATUSES in src/lib/units/constants.ts.
const LIVE_UNIT_STATUSES = ["RECEIVED", "PUT_AWAY", "ASSIGNED", "IN_ASSEMBLY", "ASSEMBLED", "RESERVED", "RETURNED", "DAMAGED"];
const REFERENCE = "REPAIR-0310";
const NOTE =
  "[REPAIR] Shown stock restored to the sum of its stock rows — a deleted completed audit had reversed " +
  "an approved audit's ledger row by title (plan 0310-audit-delete-reverses-another-audit)";

function fail(message) {
  console.error(`db:repair:stock-total: ${message}`);
  process.exit(1);
}

// ── Arguments ──────────────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const apply = args.includes("--apply");
const userIdx = args.indexOf("--user");
const userEmail = userIdx >= 0 ? args[userIdx + 1] : undefined;
if (apply && !userEmail) fail("--apply needs --user <email> — the ledger rows are written in that person's name.");

// ── The connection, read the way snapshot.mjs / backfill-vendor-contact.mjs read it ──────────
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
console.log(`\ntarget: ${dbName} at ${parsed.hostname}:${parsed.port || 5432}  (${apply ? "APPLY — writes" : "dry run — read-only"})\n`);

const prisma = new PrismaClient({ datasourceUrl: url });

/** Every product whose cache disagrees with its stock rows, with what the repair would do. */
async function findDrift(db) {
  return db.$queryRaw`
    WITH lv AS (
      SELECT "productId" AS pid, SUM(quantity)::int AS real FROM "StockLevel" GROUP BY 1
    ),
    un AS (
      SELECT product_id AS pid,
             COUNT(*)::int AS live,
             COUNT(DISTINCT bin_id)::int AS bins,
             COUNT(*) FILTER (WHERE bin_id IS NULL)::int AS unbinned,
             MIN(bin_id) AS "onlyBinId"
      FROM inventory_units
      WHERE status::text = ANY(${LIVE_UNIT_STATUSES})
      GROUP BY 1
    )
    SELECT p.id, p.sku, p.name,
           p."currentStock"::int AS shown,
           COALESCE(lv.real, 0)::int AS real,
           COALESCE(un.live, 0)::int AS live,
           pb.code AS "binCode",
           CASE WHEN p."binId" IS NULL AND un.bins = 1 AND un.unbinned = 0 THEN un."onlyBinId" END AS "restoreBinId",
           CASE WHEN p."binId" IS NULL AND un.bins = 1 AND un.unbinned = 0 THEN rb.code END AS "restoreBinCode"
    FROM "Product" p
    LEFT JOIN lv ON lv.pid = p.id
    LEFT JOIN un ON un.pid = p.id
    LEFT JOIN bins pb ON pb.id = p."binId"
    LEFT JOIN bins rb ON rb.id = un."onlyBinId"
    WHERE p."currentStock" <> COALESCE(lv.real, 0)
    ORDER BY p.sku`;
}

async function main() {
  const drift = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
    return findDrift(tx);
  });

  const hidden = drift.reduce((n, r) => n + (r.real - r.shown), 0);
  console.log(`Products whose shown stock ≠ their stock rows: ${drift.length} (net ${hidden >= 0 ? "+" : ""}${hidden} to show)`);
  if (drift.length === 0) {
    console.log("   none — nothing to repair.");
    return;
  }
  for (const r of drift) {
    const bin = r.binCode ? `bin ${r.binCode}` : r.restoreBinCode ? `no bin → ${r.restoreBinCode}` : "no bin";
    console.log(`   ${r.sku.padEnd(8)} ${r.name.slice(0, 48).padEnd(48)} shown ${String(r.shown).padStart(4)} → ${String(r.real).padStart(4)}   live units ${String(r.live).padStart(3)}   ${bin}`);
  }

  if (!apply) {
    console.log("\nDry run: nothing written. To repair, after `npm run db:snapshot`:");
    console.log("   npm run db:repair:stock-total -- --apply --user <email>");
    return;
  }

  const user = await prisma.user.findUnique({ where: { email: userEmail }, select: { id: true, name: true, isActive: true } });
  if (!user || !user.isActive) fail(`no active user with email ${userEmail}`);

  let repaired = 0;
  let skipped = 0;
  let binsRestored = 0;
  for (const r of drift) {
    const outcome = await prisma.$transaction(async (tx) => {
      // Re-read inside the transaction: a product that moved since the dry run is left alone.
      const product = await tx.product.findUnique({ where: { id: r.id }, select: { currentStock: true, binId: true } });
      const agg = await tx.stockLevel.aggregate({ where: { productId: r.id }, _sum: { quantity: true } });
      const real = agg._sum.quantity ?? 0;
      if (!product || product.currentStock !== r.shown || real !== r.real) return "skipped";

      const giveBin = r.restoreBinId && product.binId === null;
      await tx.product.update({
        where: { id: r.id },
        data: { currentStock: real, ...(giveBin && { binId: r.restoreBinId }) },
      });
      await tx.inventoryTransaction.create({
        data: {
          type: "ADJUSTMENT",
          productId: r.id,
          quantity: Math.abs(real - r.shown),
          previousStock: r.shown,
          newStock: real,
          referenceNo: REFERENCE,
          notes: NOTE,
          userId: user.id,
        },
      });
      return giveBin ? "repaired+bin" : "repaired";
    });
    if (outcome === "skipped") {
      skipped += 1;
      console.log(`   skipped ${r.sku}: it changed since the dry run — run the dry run again`);
    } else {
      repaired += 1;
      if (outcome === "repaired+bin") binsRestored += 1;
    }
  }

  console.log(`\nRepaired ${repaired} product(s), ${binsRestored} given their bin back, ${skipped} skipped. Ledger reference ${REFERENCE}, by ${user.name}.`);
  const left = await findDrift(prisma);
  console.log(left.length === 0 ? "Check: no product's shown stock disagrees with its stock rows." : `Check: ${left.length} still disagree — run again.`);
}

main()
  .catch((e) => {
    console.error(`db:repair:stock-total: failed — ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
