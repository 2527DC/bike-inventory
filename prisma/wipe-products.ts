/*
 * Empty `Product` and everything that hangs off it.
 *
 *   npm run db:wipe:products
 *
 * ─── WHY THIS IS ITS OWN FILE ────────────────────────────────────────────────────────────
 *
 * It runs BEFORE the schema moves, against the OLD generated client, so it must not mention
 * NOTE: ProductType and productTypeId no longer exist — both were dropped in P3 of the
 * 0409 plan. Any reference below is historical.
 * wipe would never run, and the `db:push` behind it would then hit a populated table and
 * demand `--accept-data-loss`. Two files avoid that entirely.
 *
 * Do not merge this back into the seed. See §15.1 of
 * docs/implementation/pending/stock-management-module-and-zoho-item-removal-plan.md.
 *
 * ─── WHY IT IS NEEDED AT ALL ─────────────────────────────────────────────────────────────
 *
 * to a table that already holds rows — it refuses, or demands `--accept-data-loss`. Emptying
 * the table first turns a data-loss prompt into an ordinary ALTER.
 *
 * ─── WHAT IT DESTROYS ────────────────────────────────────────────────────────────────────
 *
 * `Product` parents ten relations. Counted against the live database on 1 Sep 2026 before
 * this was written: 59 products, and every one of the ten children at ZERO. That is the only
 * reason this is safe to run. If it is ever re-run against a database with real history, it
 * will delete stock movements, audit lines, and the line items of open purchase orders,
 * transfers and inbound shipments.
 *
 * COUNT FIRST. It refuses to run without --force when it finds any child rows.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export async function wipeProducts(client: PrismaClient = prisma) {
  // Children first — Prisma will not cascade what the schema does not declare.
  return client.$transaction([
    client.inventoryTransaction.deleteMany({}),
    client.stockCountItem.deleteMany({}),
    client.serialItem.deleteMany({}),
    client.stockLevel.deleteMany({}),
    client.purchaseOrderItem.deleteMany({}),
    client.transferOrderItem.deleteMany({}),
    client.inboundLineItem.deleteMany({}),
    client.product.deleteMany({}),
  ]);
}

async function main() {
  const force = process.argv.includes("--force");

  const [products, transactions, stockCounts, serials, levels, po, transfer, inbound] =
    await Promise.all([
      prisma.product.count(),
      prisma.inventoryTransaction.count(),
      prisma.stockCountItem.count(),
      prisma.serialItem.count(),
      prisma.stockLevel.count(),
      prisma.purchaseOrderItem.count(),
      prisma.transferOrderItem.count(),
      prisma.inboundLineItem.count(),
    ]);

  console.log(`products              ${String(products).padStart(6)}`);
  console.log(`inventoryTransaction  ${String(transactions).padStart(6)}`);
  console.log(`stockCountItem        ${String(stockCounts).padStart(6)}`);
  console.log(`serialItem            ${String(serials).padStart(6)}`);
  console.log(`stockLevel            ${String(levels).padStart(6)}`);
  console.log(`purchaseOrderItem     ${String(po).padStart(6)}`);
  console.log(`transferOrderItem     ${String(transfer).padStart(6)}`);
  console.log(`inboundLineItem       ${String(inbound).padStart(6)}`);

  const history = transactions + stockCounts + serials + levels + po + transfer + inbound;
  if (history > 0 && !force) {
    console.error(
      `\nREFUSED: ${history} child row(s) exist. This would destroy stock history and the line\n` +
      `items of open purchase orders, transfers and inbound shipments. Re-run with --force\n` +
      `only if that loss is intended and has been agreed.`
    );
    process.exit(1);
  }

  if (products === 0 && history === 0) {
    console.log("\nAlready empty — nothing to do.");
    return;
  }

  const res = await wipeProducts();
  const deleted = res.reduce((sum, r) => sum + r.count, 0);
  console.log(`\nDeleted ${deleted} row(s) across 8 tables. Product is now empty.`);
}

if (require.main === module) {
  main()
    .catch((e) => { console.error("wipe failed:", e instanceof Error ? e.message : e); process.exit(1); })
    .finally(() => prisma.$disconnect());
}
