// Empty the catalog (products, brands, categories) and everything that moved stock — inbound,
// outbound, units, bins' contents, audits, transfers — in the database `.env` points at, so the
// catalog can be imported again from scratch.
//
//     npm run db:snapshot                 <- first, always
//     npm run db:wipe:catalog
//     then reload: npm run db:import -- --only=catalog   (or npm run import:products -- <file>)
//                  /categories -> Fetch from Zoho -> Import
//                  /more/brands -> Zoho import
//
// Owner, 21 Sep 2026: "clear the data of product and category and brand ... inbound and outbound
// ... i dont want to lose integration and setting level tables ... must be able to run it for any
// database". Any database = switch `.env` to it and run again, exactly like db:snapshot,
// db:wipe:deliveries and db:wipe:categories — the snapshot check below only works because both
// scripts read the same `.env`.
//
// WHAT IT DELETES, in one transaction (children before parents — the order below is the FK order)
// -----------------------------------------------------------------------------------------------
//   Complaint                  every row — each one points at an InventoryUnit (Restrict)
//   TransferOrder              + items + units: every transfer moves products/units
//   AssemblyTask, BinMovementLog, SerialItem (+ SerialTransactionItem)
//   InventoryUnit              every unit
//   InventoryTransaction       every stock movement, inward and outward
//   StockCount (+ items)       every stock audit
//   StockLevel, BinStock       every stock quantity
//   HomeBinRule                every rule — each names a brand, a category or a product
//   PreBooking, InboundShipment (+ InboundLineItem)            = INBOUND
//   Delivery                                                   = OUTBOUND
//   ZohoPullPreview of type bill / invoice / item — otherwise an APPROVED preview would stop the
//                              same Zoho bill or invoice from being pulled and imported again
//   BrandStockUpload (+ items), BrandSkuMapping
//   VendorDiscountTerm         only the BRAND-SPECIFIC ones. Nulling the brand would silently turn
//                              "10% on brand X" into "10% on everything from this vendor"
//   BrandVendor                every brand <-> vendor link
//   Product, Category, Brand   every row
//
// WHAT IT KEEPS, with the link to a deleted row cleared
// -----------------------------------------------------
//   PurchaseOrder + items      productId -> null; the line keeps its `name` and quantity
//   PoExtractionItem           productId -> null
//   BrandLedgerEntry, LedgerGap  brandId -> null (money records; they stay on their vendor)
//   ApprovalEvent              productId -> null (history)
//   LmsProduct                 stockProductId -> null
//
// WHAT IT DOES NOT TOUCH
// ----------------------
// Users, roles, permissions, stores, warehouses, bins (the locations), vendors, vendor bills and
// payments, customers, service jobs, second-hand cycles, expenses, Zoho / storage / SMTP settings,
// WhatsApp templates, alert settings, ZohoPullLog, contact previews, LMS content, counters.
//
// SAFETY — same as wipe-deliveries.mjs
// ------------------------------------
// - Prints the host, the database and the row counts, then deletes only after you type the
//   database name (or pass `--yes <database name>`).
// - Refuses unless `backups/` holds a `db:snapshot` of THIS database taken in the last 60 minutes
//   (`--no-snapshot` overrides; do not use it on anything that matters). The snapshot is the
//   only way back.
// - One transaction: all of it happens or none of it does.
// - Prints hostnames only, never a URL (it carries the password).

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { PrismaClient } from "@prisma/client";

const SNAPSHOT_MAX_AGE_MIN = 60;
const PREVIEW_TYPES = ["bill", "invoice", "item"];

function fail(message) {
  console.error(`db:wipe:catalog: ${message}`);
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

// [label, count query] — the same list is printed before and verified empty after.
const DELETED = [
  ["Complaint", () => prisma.complaint.count()],
  ["TransferOrder", () => prisma.transferOrder.count()],
  ["TransferOrderItem", () => prisma.transferOrderItem.count()],
  ["TransferOrderUnit", () => prisma.transferOrderUnit.count()],
  ["AssemblyTask", () => prisma.assemblyTask.count()],
  ["BinMovementLog", () => prisma.binMovementLog.count()],
  ["SerialItem", () => prisma.serialItem.count()],
  ["SerialTransactionItem", () => prisma.serialTransactionItem.count()],
  ["InventoryUnit", () => prisma.inventoryUnit.count()],
  ["InventoryTransaction", () => prisma.inventoryTransaction.count()],
  ["StockCount", () => prisma.stockCount.count()],
  ["StockCountItem", () => prisma.stockCountItem.count()],
  ["StockLevel", () => prisma.stockLevel.count()],
  ["BinStock", () => prisma.binStock.count()],
  ["HomeBinRule", () => prisma.homeBinRule.count()],
  ["PreBooking", () => prisma.preBooking.count()],
  ["InboundShipment", () => prisma.inboundShipment.count()],
  ["InboundLineItem", () => prisma.inboundLineItem.count()],
  ["Delivery", () => prisma.delivery.count()],
  [`ZohoPullPreview (${PREVIEW_TYPES.join("/")})`, () => prisma.zohoPullPreview.count({ where: { entityType: { in: PREVIEW_TYPES } } })],
  ["BrandStockUpload", () => prisma.brandStockUpload.count()],
  ["BrandStockItem", () => prisma.brandStockItem.count()],
  ["BrandSkuMapping", () => prisma.brandSkuMapping.count()],
  ["VendorDiscountTerm (brand-specific)", () => prisma.vendorDiscountTerm.count({ where: { brandId: { not: null } } })],
  ["BrandVendor", () => prisma.brandVendor.count()],
  ["Product", () => prisma.product.count()],
  ["Category", () => prisma.category.count()],
  ["Brand", () => prisma.brand.count()],
];

const UNLINKED = [
  ["PurchaseOrderItem productId", () => prisma.purchaseOrderItem.count({ where: { productId: { not: null } } })],
  ["PoExtractionItem productId", () => prisma.poExtractionItem.count({ where: { productId: { not: null } } })],
  ["BrandLedgerEntry brandId", () => prisma.brandLedgerEntry.count({ where: { brandId: { not: null } } })],
  ["LedgerGap brandId", () => prisma.ledgerGap.count({ where: { brandId: { not: null } } })],
  ["ApprovalEvent productId", () => prisma.approvalEvent.count({ where: { productId: { not: null } } })],
  ["LmsProduct stockProductId", () => prisma.lmsProduct.count({ where: { stockProductId: { not: null } } })],
];

async function counts(list) {
  const values = await Promise.all(list.map(([, q]) => q()));
  return list.map(([label], i) => [label, values[i]]);
}

function print(rows) {
  for (const [label, n] of rows) console.log(`  ${label.padEnd(38)} ${String(n).padStart(8)}`);
}

const sum = (rows) => rows.reduce((s, [, n]) => s + n, 0);

async function main() {
  const deleted = await counts(DELETED);
  const unlinked = await counts(UNLINKED);

  console.log("\nwill DELETE:");
  print(deleted);
  console.log("\nwill KEEP, with the link cleared:");
  print(unlinked);
  console.log("\nuntouched: users, roles, stores, warehouses, bins, vendors, bills, customers, settings, integrations.");

  if (sum(deleted) + sum(unlinked) === 0) {
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
  await prisma.$transaction(
    async (tx) => {
      const step = async (label, op) => {
        const r = await op();
        console.log(`  ${label.padEnd(38)} ${String(r.count).padStart(8)}`);
      };
      console.log("");

      // Units and everything that points at a unit.
      await step("Complaint deleted", () => tx.complaint.deleteMany({}));
      await step("TransferOrderUnit deleted", () => tx.transferOrderUnit.deleteMany({}));
      await step("TransferOrderItem deleted", () => tx.transferOrderItem.deleteMany({}));
      await step("TransferOrder deleted", () => tx.transferOrder.deleteMany({}));
      await step("AssemblyTask deleted", () => tx.assemblyTask.deleteMany({}));
      await step("BinMovementLog deleted", () => tx.binMovementLog.deleteMany({}));
      await step("SerialTransactionItem deleted", () => tx.serialTransactionItem.deleteMany({}));
      await step("SerialItem deleted", () => tx.serialItem.deleteMany({}));
      await step("InventoryUnit deleted", () => tx.inventoryUnit.deleteMany({}));

      // Stock quantities and history.
      await step("InventoryTransaction deleted", () => tx.inventoryTransaction.deleteMany({}));
      await step("StockCountItem deleted", () => tx.stockCountItem.deleteMany({}));
      await step("StockCount deleted", () => tx.stockCount.deleteMany({}));
      await step("StockLevel deleted", () => tx.stockLevel.deleteMany({}));
      await step("BinStock deleted", () => tx.binStock.deleteMany({}));
      await step("HomeBinRule deleted", () => tx.homeBinRule.deleteMany({}));

      // Inbound and outbound.
      await step("PreBooking deleted", () => tx.preBooking.deleteMany({}));
      await step("InboundLineItem deleted", () => tx.inboundLineItem.deleteMany({}));
      await step("InboundShipment deleted", () => tx.inboundShipment.deleteMany({}));
      await step("Delivery deleted", () => tx.delivery.deleteMany({}));
      await step("ZohoPullPreview deleted", () => tx.zohoPullPreview.deleteMany({ where: { entityType: { in: PREVIEW_TYPES } } }));

      // Kept rows lose their link to a product.
      await step("PurchaseOrderItem unlinked", () => tx.purchaseOrderItem.updateMany({ where: { productId: { not: null } }, data: { productId: null } }));
      await step("PoExtractionItem unlinked", () => tx.poExtractionItem.updateMany({ where: { productId: { not: null } }, data: { productId: null } }));
      await step("ApprovalEvent unlinked", () => tx.approvalEvent.updateMany({ where: { productId: { not: null } }, data: { productId: null } }));
      await step("LmsProduct unlinked", () => tx.lmsProduct.updateMany({ where: { stockProductId: { not: null } }, data: { stockProductId: null } }));

      // Brand-owned rows, then the catalog itself.
      await step("BrandStockItem deleted", () => tx.brandStockItem.deleteMany({}));
      await step("BrandStockUpload deleted", () => tx.brandStockUpload.deleteMany({}));
      await step("BrandSkuMapping deleted", () => tx.brandSkuMapping.deleteMany({}));
      await step("Product deleted", () => tx.product.deleteMany({}));
      await step("BrandLedgerEntry unlinked", () => tx.brandLedgerEntry.updateMany({ where: { brandId: { not: null } }, data: { brandId: null } }));
      await step("LedgerGap unlinked", () => tx.ledgerGap.updateMany({ where: { brandId: { not: null } }, data: { brandId: null } }));
      await step("VendorDiscountTerm deleted", () => tx.vendorDiscountTerm.deleteMany({ where: { brandId: { not: null } } }));
      await step("BrandVendor deleted", () => tx.brandVendor.deleteMany({}));
      await step("Category parent cleared", () => tx.category.updateMany({ where: { parentId: { not: null } }, data: { parentId: null } }));
      await step("Category deleted", () => tx.category.deleteMany({}));
      await step("Brand deleted", () => tx.brand.deleteMany({}));
    },
    { maxWait: 10_000, timeout: 600_000 }
  );

  console.log(`\ndone on ${where} in ${((Date.now() - started) / 1000).toFixed(1)} s`);

  const after = [...(await counts(DELETED)), ...(await counts(UNLINKED))].filter(([, n]) => n !== 0);
  if (after.length) {
    console.error("\nWARNING: rows remain — something wrote while this ran:");
    print(after);
    process.exitCode = 1;
    return;
  }
  console.log("verified: every table above is empty or unlinked.");
  console.log("\nnext:");
  console.log("  1. npm run db:import -- --only=catalog     (or: npm run import:products -- prisma/data/Item.xls)");
  console.log("  2. /categories -> Fetch from Zoho -> Import");
  console.log("  3. /more/brands -> Zoho import");
  console.log("  4. Re-create home-bin rules on /bins; stock comes back through inbound / stock counts.");
}

main()
  .catch((e) => {
    // Prisma errors can echo the connection target; print the message only, never the URL.
    console.error("\ndb:wipe:catalog failed — nothing was deleted (the transaction rolled back):");
    console.error(`  ${e instanceof Error ? e.message.split("\n").slice(-3).join(" ").slice(0, 400) : String(e)}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
