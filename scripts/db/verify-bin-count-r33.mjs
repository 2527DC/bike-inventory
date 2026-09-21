// Verify plan 2109 R33 (a bin count changes only that bin) against the REAL approval code,
// inside ONE transaction that is always rolled back. Nothing is left behind.
//
//   node scripts/db/verify-bin-count-r33.mjs
//
// Localhost only: it refuses to run unless DATABASE_URL in .env points at localhost. It needs an
// active warehouse and any existing category and brand to hang its throwaway rows on.
//
// What it checks — the plan's worked examples, run through `applyBinCountLine` (the stock half
// of PUT /api/stock-counts/[id] with applyToStock) and `getBinQtyMap` (the "system" figure the
// counter is shown and the approval compares against):
//   1. P has 5 units in bin A, 4 in bin B, warehouse 9. Count A = 5 → nothing changes.
//   2. Count A = 3 → 2 of A's units retired LOST, warehouse 7, B still 4 with the same codes.
//   3. Day one: Q at 0. Count A = 3 → warehouse 3, 3 new codes in A. Count B = 7 → warehouse
//      10, A still 3.
//   4. R32: a non-assemblable bin counted 2 with no split → 2 unassembled units stamped
//      non-assemblable.
//   5. A count without the split in an assemblable bin keeps what is built.
//
// Uses console output on purpose: this is a terminal script, not app code.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createJiti } from "jiti";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// ── localhost guard ──────────────────────────────────────────────────────────────────────
const envText = readFileSync(path.join(root, ".env"), "utf8");
const m = envText.match(/^DATABASE_URL="?([^"\n]+)/m);
if (!m) {
  console.error("verify-bin-count-r33: DATABASE_URL is not set in .env");
  process.exit(1);
}
const host = new URL(m[1]).hostname;
const dbName = new URL(m[1]).pathname.replace(/^\//, "");
if (!["localhost", "127.0.0.1", "::1"].includes(host)) {
  console.error(`verify-bin-count-r33: refusing — DATABASE_URL points at ${host}, not localhost`);
  process.exit(1);
}
process.env.DATABASE_URL = m[1];
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? "3"; // errors only; the checks print their own lines
console.log(`database: ${host}/${dbName} (every change below is rolled back)\n`);

const jiti = createJiti(pathToFileURL(path.join(root, "scripts", "db", "x.mjs")).href, {
  alias: { "@": path.join(root, "src") },
});
const { prisma } = await jiti.import(path.join(root, "src/lib/db.ts"));
const { createUnits } = await jiti.import(path.join(root, "src/lib/units/create.ts"));
const { getBinQtyMap } = await jiti.import(path.join(root, "src/lib/units/bin-qty.ts"));
const { setWarehouseQty } = await jiti.import(path.join(root, "src/lib/stock-location.ts"));
const { applyBinCountLine } = await jiti.import(path.join(root, "src/app/api/stock-counts/_lib/apply-bin-line.ts"));

class Rollback extends Error {}
let failures = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}: ${JSON.stringify(actual)}${ok ? "" : `  (expected ${JSON.stringify(expected)})`}`);
};

const LIVE = ["RECEIVED", "PUT_AWAY", "ASSIGNED", "IN_ASSEMBLY", "ASSEMBLED", "RESERVED", "RETURNED", "DAMAGED"];

try {
  await prisma.$transaction(
    async (tx) => {
      const warehouse = await tx.warehouse.findFirst({ where: { isActive: true }, select: { id: true, name: true } });
      const category = await tx.category.findFirst({ select: { id: true } });
      const brand = await tx.brand.findFirst({ select: { id: true } });
      if (!warehouse || !category || !brand) throw new Error("needs an active warehouse, a category and a brand");

      const tag = `R33T${Date.now().toString(36).toUpperCase()}`;
      const mkBin = (suffix, nonAssemblable = false) =>
        tx.bin.create({
          data: { code: `${tag}${suffix}`, name: `R33 test ${suffix}`, warehouseId: warehouse.id, nonAssemblable },
          select: { id: true, code: true },
        });
      const mkProduct = (suffix) =>
        tx.product.create({
          data: { sku: `${tag}-${suffix}`, name: `R33 test product ${suffix}`, categoryId: category.id, brandId: brand.id },
          select: { id: true },
        });
      const binA = await mkBin("A");
      const binB = await mkBin("B");
      const binN = await mkBin("N", true);

      const liveIn = (productId, binId) =>
        tx.inventoryUnit.findMany({
          where: { productId, binId, status: { in: LIVE } },
          select: { unitCode: true, assembledAt: true, nonAssemblable: true },
          orderBy: { unitCode: "asc" },
        });
      const whQty = async (productId) =>
        (await tx.stockLevel.findUnique({
          where: { productId_warehouseId: { productId, warehouseId: warehouse.id } },
          select: { quantity: true },
        }))?.quantity ?? 0;
      // What the approval does for one line: read the bin's figure, then apply.
      const approveLine = async (productId, bin, counted, split = null, nonAssemblable = false) => {
        const live = (await getBinQtyMap(bin.id, [productId], tx)).get(productId) ?? 0;
        return applyBinCountLine(tx, {
          productId,
          warehouseId: warehouse.id,
          binId: bin.id,
          nonAssemblable,
          counted,
          live,
          assembledQty: split ? split[0] : null,
          unassembledQty: split ? split[1] : null,
        });
      };

      // ── 1 and 2: A 5 + B 4, warehouse 9 ───────────────────────────────────────────────
      const P = await mkProduct("P");
      await createUnits(tx, { productId: P.id, warehouseId: warehouse.id, binId: binA.id, qty: 5 });
      await createUnits(tx, { productId: P.id, warehouseId: warehouse.id, binId: binB.id, qty: 4 });
      await setWarehouseQty(tx, P.id, warehouse.id, 9);
      const bCodesBefore = (await liveIn(P.id, binB.id)).map((u) => u.unitCode);

      console.log("1. P: A 5, B 4, warehouse 9 — count bin A = 5");
      check("bin A system figure shown to the counter", (await getBinQtyMap(binA.id, [P.id], tx)).get(P.id), 5);
      const r1 = await approveLine(P.id, binA, 5, [0, 5]);
      check("delta", r1.delta, 0);
      check("units retired", r1.synced.retired.length, 0);
      check("units created", r1.synced.createdUnitIds.length, 0);
      check("bin A live units", (await liveIn(P.id, binA.id)).length, 5);
      check("bin B live units", (await liveIn(P.id, binB.id)).length, 4);
      check("warehouse", await whQty(P.id), 9);

      console.log("\n2. count bin A = 3");
      const aCodesBefore = (await liveIn(P.id, binA.id)).map((u) => u.unitCode);
      const r2 = await approveLine(P.id, binA, 3, [0, 3]);
      check("delta", r2.delta, -2);
      check("units retired LOST", r2.synced.retired.length, 2);
      check("retired codes all came from bin A", r2.synced.retired.every((r) => aCodesBefore.includes(r.unitCode)), true);
      check("bin A live units", (await liveIn(P.id, binA.id)).length, 3);
      check("bin B live units", (await liveIn(P.id, binB.id)).length, 4);
      check("bin B codes unchanged", (await liveIn(P.id, binB.id)).map((u) => u.unitCode), bCodesBefore);
      check("warehouse", await whQty(P.id), 7);
      check("BinStock A", (await tx.binStock.findUnique({ where: { binId_productId: { binId: binA.id, productId: P.id } } }))?.quantity, 3);
      check("BinStock B", (await tx.binStock.findUnique({ where: { binId_productId: { binId: binB.id, productId: P.id } } }))?.quantity, 4);

      // ── 3: day one ─────────────────────────────────────────────────────────────────────
      console.log("\n3. day one: Q at 0 — count A = 3, then B = 7");
      const Q = await mkProduct("Q");
      check("bin A system figure for Q", (await getBinQtyMap(binA.id, [Q.id], tx)).get(Q.id) ?? 0, 0);
      const r3 = await approveLine(Q.id, binA, 3, [0, 3]);
      check("codes created in A", r3.synced.createdUnitIds.length, 3);
      check("warehouse after A", await whQty(Q.id), 3);
      const r4 = await approveLine(Q.id, binB, 7, [2, 5]);
      check("codes created in B", r4.synced.createdUnitIds.length, 7);
      check("warehouse after B", await whQty(Q.id), 10);
      check("bin A still 3", (await liveIn(Q.id, binA.id)).length, 3);
      check("bin B assembled", (await liveIn(Q.id, binB.id)).filter((u) => u.assembledAt).length, 2);

      // ── 4: R32 non-assemblable bin ─────────────────────────────────────────────────────
      console.log("\n4. R32: non-assemblable bin N, count 2 with no split");
      const R = await mkProduct("R");
      const r5 = await approveLine(R.id, binN, 2, null, true);
      const nUnits = await liveIn(R.id, binN.id);
      check("codes created in N", r5.synced.createdUnitIds.length, 2);
      check("all unassembled", nUnits.every((u) => u.assembledAt === null), true);
      check("all stamped non-assemblable", nUnits.every((u) => u.nonAssemblable), true);
      check("warehouse", await whQty(R.id), 2);

      // ── 5: no split in an assemblable bin keeps what is built ─────────────────────────
      console.log("\n5. Q in B (2 assembled + 5 unassembled), recount B = 6 without the split");
      const r6 = await approveLine(Q.id, binB, 6, null);
      check("retired", r6.synced.retired.length, 1);
      check("assembled kept", (await liveIn(Q.id, binB.id)).filter((u) => u.assembledAt).length, 2);
      check("warehouse", await whQty(Q.id), 9);
      check("bin A untouched", (await liveIn(Q.id, binA.id)).length, 3);

      throw new Rollback();
    },
    { timeout: 120000 }
  );
} catch (e) {
  if (!(e instanceof Rollback)) {
    console.error("\nverify-bin-count-r33: failed —", e instanceof Error ? e.message : String(e));
    await prisma.$disconnect();
    process.exit(1);
  }
}
await prisma.$disconnect();
console.log(`\nrolled back. ${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
