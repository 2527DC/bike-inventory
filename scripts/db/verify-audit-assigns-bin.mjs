// Verify plan 2209-audit-assigns-product-bin against the REAL code, inside ONE transaction that
// is always rolled back. Nothing is left behind.
//
//   node scripts/db/verify-audit-assigns-bin.mjs
//
// Localhost only: it refuses to run unless the database URL points at localhost. The URL comes
// from DATABASE_URL in the environment when set, else from .env — either way it must be local.
// It needs an active warehouse and any existing category and brand to hang its throwaway rows on.
//
// What it runs — the same pieces PUT /api/stock-counts/[id] (applyToStock) and GET /api/products
// use, not copies of them:
//   - `applyBinCountLine` + `syncBinStock` (the stock half of the approval, as in verify-bin-count-r33)
//   - `assignBinToCountedProducts` (Part A — called by the route with the counted lines)
//   - `productInBinWhere` / `productHasNoBinWhere` (Part B — the route's bin filter and the
//     "Needs details" bin test)
//
// Checks:
//   1. P (no home bin) counted 3 in L1 → P.binId = L1
//   2. Q (home bin L2) counted 2 in L1 → stays L2
//   3. R (no home bin) counted 0 in L1 → stays null
//   4. the bin filter for L1 returns P and Q (Q through its units in L1), not R;
//      for L2 it returns Q (home bin)
//   5. "no bin" excludes S — units in a bin but no home bin — and includes T, which has nothing
//
// Uses console output on purpose: this is a terminal script, not app code.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createJiti } from "jiti";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// ── localhost guard ──────────────────────────────────────────────────────────────────────
let url = process.env.DATABASE_URL;
if (!url) {
  const envText = readFileSync(path.join(root, ".env"), "utf8");
  url = envText.match(/^DATABASE_URL="?([^"\n]+)/m)?.[1];
}
if (!url) {
  console.error("verify-audit-assigns-bin: DATABASE_URL is not set");
  process.exit(1);
}
const host = new URL(url).hostname;
const dbName = new URL(url).pathname.replace(/^\//, "");
if (!["localhost", "127.0.0.1", "::1"].includes(host)) {
  console.error(`verify-audit-assigns-bin: refusing — DATABASE_URL points at ${host}, not localhost`);
  process.exit(1);
}
process.env.DATABASE_URL = url;
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? "3";
console.log(`database: ${host}/${dbName} (every change below is rolled back)\n`);

const jiti = createJiti(pathToFileURL(path.join(root, "scripts", "db", "x.mjs")).href, {
  alias: { "@": path.join(root, "src") },
});
const { prisma } = await jiti.import(path.join(root, "src/lib/db.ts"));
const { createUnits, syncBinStock } = await jiti.import(path.join(root, "src/lib/units/index.ts"));
const { getBinQtyMap } = await jiti.import(path.join(root, "src/lib/units/bin-qty.ts"));
const { applyBinCountLine } = await jiti.import(path.join(root, "src/app/api/stock-counts/_lib/apply-bin-line.ts"));
const { assignBinToCountedProducts } = await jiti.import(path.join(root, "src/app/api/stock-counts/_lib/assign-product-bin.ts"));
const { productInBinWhere, productHasNoBinWhere } = await jiti.import(path.join(root, "src/lib/products/bin-filter.ts"));

class Rollback extends Error {}
let failures = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}: ${JSON.stringify(actual)}${ok ? "" : `  (expected ${JSON.stringify(expected)})`}`);
};

try {
  await prisma.$transaction(
    async (tx) => {
      const warehouse = await tx.warehouse.findFirst({ where: { isActive: true }, select: { id: true } });
      const category = await tx.category.findFirst({ select: { id: true } });
      const brand = await tx.brand.findFirst({ select: { id: true } });
      if (!warehouse || !category || !brand) throw new Error("needs an active warehouse, a category and a brand");

      const tag = `ABT${Date.now().toString(36).toUpperCase()}`;
      const mkBin = (suffix) =>
        tx.bin.create({
          data: { code: `${tag}${suffix}`, name: `audit-bin test ${suffix}`, warehouseId: warehouse.id },
          select: { id: true, code: true },
        });
      const mkProduct = (suffix, binId = null) =>
        tx.product.create({
          data: { sku: `${tag}-${suffix}`, name: `audit-bin test ${suffix}`, categoryId: category.id, brandId: brand.id, binId },
          select: { id: true },
        });
      const L1 = await mkBin("L1");
      const L2 = await mkBin("L2");
      const L3 = await mkBin("L3");

      const P = await mkProduct("P");
      const Q = await mkProduct("Q", L2.id);
      const R = await mkProduct("R");
      const S = await mkProduct("S");
      const T = await mkProduct("T");
      const binOf = async (p) => (await tx.product.findUnique({ where: { id: p.id }, select: { binId: true } })).binId;

      // ── The approval of a bin audit of L1, as the route runs it ─────────────────────────
      const lines = [
        { productId: P.id, countedQty: 3 },
        { productId: Q.id, countedQty: 2 },
        { productId: R.id, countedQty: 0 },
      ];
      const live = await getBinQtyMap(L1.id, lines.map((l) => l.productId), tx);
      for (const l of lines) {
        await applyBinCountLine(tx, {
          productId: l.productId, warehouseId: warehouse.id, binId: L1.id, nonAssemblable: false,
          counted: l.countedQty, live: live.get(l.productId) ?? 0, assembledQty: 0, unassembledQty: l.countedQty,
        });
      }
      await syncBinStock(tx, [L1.id]);
      const given = await assignBinToCountedProducts(tx, L1.id, lines);

      console.log("Part A — approve a bin audit of L1 (P 3, Q 2, R 0)");
      check("productsGivenBin", given, 1);
      check("1. P (no bin, counted 3) → L1", (await binOf(P)) === L1.id, true);
      check("2. Q (home L2, counted 2) keeps L2", (await binOf(Q)) === L2.id, true);
      check("3. R (counted 0) stays null", await binOf(R), null);
      check("re-running the approval assigns nothing more", await assignBinToCountedProducts(tx, L1.id, lines), 0);

      // ── Part B ───────────────────────────────────────────────────────────────────────────
      // S: 2 live units in L3, no home bin. T: nothing anywhere.
      await createUnits(tx, { productId: S.id, warehouseId: warehouse.id, binId: L3.id, qty: 2 });
      await syncBinStock(tx, [L3.id]);
      const ours = { id: { in: [P.id, Q.id, R.id, S.id, T.id] } };
      const idsWhere = async (w) =>
        (await tx.product.findMany({ where: { AND: [ours, w] }, select: { sku: true }, orderBy: { sku: "asc" } }))
          .map((p) => p.sku.split("-").pop());

      console.log("\nPart B — /stock bin filter");
      check("4. filter L1 → P and Q (Q by its units), not R", await idsWhere(productInBinWhere(L1.id)), ["P", "Q"]);
      check("   filter L2 → Q (home bin)", await idsWhere(productInBinWhere(L2.id)), ["Q"]);
      check("   filter L3 → S (units only, no home bin)", await idsWhere(productInBinWhere(L3.id)), ["S"]);

      console.log("\nPart B — \"Needs details\" bin test");
      check("5. no bin → R and T only (S has units in L3)", await idsWhere(productHasNoBinWhere()), ["R", "T"]);

      // The same filter inside the route's full where, combined with a search OR group.
      const routeLike = {
        AND: [ours, { OR: [{ name: { contains: "audit-bin", mode: "insensitive" } }] }, productInBinWhere(L1.id)],
        status: "ACTIVE",
      };
      check("   combined with a search OR", (await tx.product.findMany({ where: routeLike, select: { sku: true }, orderBy: { sku: "asc" } })).map((p) => p.sku.split("-").pop()), ["P", "Q"]);

      throw new Rollback();
    },
    { timeout: 120000 }
  );
} catch (e) {
  if (!(e instanceof Rollback)) {
    console.error("\nverify-audit-assigns-bin: failed —", e instanceof Error ? e.message : String(e));
    await prisma.$disconnect();
    process.exit(1);
  }
}
await prisma.$disconnect();
console.log(`\nrolled back. ${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
