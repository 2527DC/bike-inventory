// ─── The one seed entry point ────────────────────────────────────────────────
//
//   npm run db:seed
//
// Seeds EVERYTHING, in dependency order, in a single run:
//
//   1. RBAC          modules, permissions, the ADMIN role and the admin user  (seed-rbac.ts)
//   2. Categories
//   3. Brands
//   4. Bins          all 12, refreshed on re-run, stale ones deactivated
//   5. Products
//   6. Serial items  one per unit of bicycle stock
//   7. Transactions  a small sample history
//   8. Staff LMS     videos, achievements, playbooks, quizzes, products  (seed-staff-lms.ts)
//
// RBAC runs first because everything below needs the admin user to exist — it owns every
// sample record.
//
// SAFE TO RE-RUN. Every write is an upsert or is guarded by an existence check, so seeding
// twice changes nothing the second time. There is no separate bin script: prisma/setup-bins.ts
// used to hold a byte-identical copy of the bin list and was deleted, because two catalogs of
// the same 12 bins is a drift waiting to happen.
//
// Narrower command, for when only the catalog changed:
//
//   npm run db:seed:rbac      RBAC only — much faster, touches no sample data
//
import { PrismaClient } from "@prisma/client";
import { seedRbac } from "./seed-rbac";
import { seedStaffLms } from "./seed-staff-lms";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding database...");

  // RBAC first — modules, permissions, the ADMIN role and the single admin user.
  // Everything below needs the admin to exist, since it owns the sample records.
  console.log("\nRBAC:");
  const { admin } = await seedRbac(prisma);
  console.log("");

  // Create categories
  const categories = await Promise.all([
    prisma.category.upsert({ where: { name: "Bicycles" }, update: {}, create: { name: "Bicycles", movingLevel: "FAST", reorderLevel: 5 } }),
    prisma.category.upsert({ where: { name: "Spare Parts" }, update: {}, create: { name: "Spare Parts", movingLevel: "FAST", reorderLevel: 20 } }),
    prisma.category.upsert({ where: { name: "Accessories" }, update: {}, create: { name: "Accessories", movingLevel: "NORMAL", reorderLevel: 10 } }),
    prisma.category.upsert({ where: { name: "Tyres & Tubes" }, update: {}, create: { name: "Tyres & Tubes", movingLevel: "FAST", reorderLevel: 15 } }),
    prisma.category.upsert({ where: { name: "Brakes" }, update: {}, create: { name: "Brakes", movingLevel: "NORMAL", reorderLevel: 10 } }),
    prisma.category.upsert({ where: { name: "Chains & Gears" }, update: {}, create: { name: "Chains & Gears", movingLevel: "SLOW", reorderLevel: 5 } }),
    prisma.category.upsert({ where: { name: "Lights" }, update: {}, create: { name: "Lights", movingLevel: "NORMAL", reorderLevel: 8 } }),
    prisma.category.upsert({ where: { name: "Helmets & Safety" }, update: {}, create: { name: "Helmets & Safety", movingLevel: "NORMAL", reorderLevel: 5 } }),
  ]);

  console.log(`Created ${categories.length} categories`);

  // Create brands
  const brandData = [
    { name: "Hero", contactPhone: "9876543210", whatsappNumber: "919876543210", cdTermsDays: 15, cdPercentage: 2 },
    { name: "BSA", contactPhone: "9876543211", whatsappNumber: "919876543211", cdTermsDays: 10, cdPercentage: 1.5 },
    { name: "Firefox", contactPhone: "9876543212", whatsappNumber: "919876543212", cdTermsDays: 20, cdPercentage: 3 },
    { name: "Hercules", contactPhone: "9876543213", whatsappNumber: "919876543213" },
    { name: "Trek", contactPhone: "9876543214", whatsappNumber: "919876543214", cdTermsDays: 30, cdPercentage: 2.5 },
    { name: "Giant", contactPhone: "9876543215", whatsappNumber: "919876543215" },
    { name: "Btwin", contactPhone: "9876543216", whatsappNumber: "919876543216" },
    { name: "Atlas", contactPhone: "9876543217", whatsappNumber: "919876543217" },
    { name: "Avon", contactPhone: "9876543218", whatsappNumber: "919876543218" },
    { name: "Montra", contactPhone: "9876543219", whatsappNumber: "919876543219" },
    { name: "Schwinn" },
    { name: "Cannondale" },
    { name: "Scott" },
    { name: "Specialized" },
    { name: "Raliegh" },
  ];

  const brands = await Promise.all(
    brandData.map((b) =>
      prisma.brand.upsert({ where: { name: b.name }, update: {}, create: b })
    )
  );

  console.log(`Created ${brands.length} brands`);

  // Create bins — real locations for Bharath Cycle Hub & Centre
  const binData = [
    // Bharath Cycle Hub — Ground Floor
    { code: "BCH-GF-01", name: "Assembly Bin", location: "Bharath Cycle Hub - Ground Floor", zone: "BCH-GF" },
    { code: "BCH-GF-02", name: "Second Hand Bin", location: "Bharath Cycle Hub - Ground Floor", zone: "BCH-GF" },
    { code: "BCH-GF-03", name: "Electric Cycle Bin", location: "Bharath Cycle Hub - Ground Floor", zone: "BCH-GF" },
    { code: "BCH-GF-04", name: "Hybrid Bin", location: "Bharath Cycle Hub - Ground Floor", zone: "BCH-GF" },
    { code: "BCH-GF-05", name: "Road Bin", location: "Bharath Cycle Hub - Ground Floor", zone: "BCH-GF" },
    // Bharath Cycle Hub — First Floor
    { code: "BCH-FF-01", name: "Gear MTB Bin", location: "Bharath Cycle Hub - First Floor", zone: "BCH-FF" },
    { code: "BCH-FF-02", name: "Non-Gear MTB Bin", location: "Bharath Cycle Hub - First Floor", zone: "BCH-FF" },
    { code: "BCH-FF-03", name: "Ladies Cycle Bin", location: "Bharath Cycle Hub - First Floor", zone: "BCH-FF" },
    { code: "BCH-FF-04", name: "Kids Cycle Bin", location: "Bharath Cycle Hub - First Floor", zone: "BCH-FF" },
    // Bharath Cycle Centre
    { code: "BCC-01", name: "Bharath Cycle Centre - Main", location: "Bharath Cycle Centre", zone: "BCC" },
    // Warehouses
    { code: "G1-01", name: "Warehouse G1", location: "Warehouse G1", zone: "G1" },
    { code: "G2-01", name: "Warehouse G2", location: "Warehouse G2", zone: "G2" },
  ];

  // `update` is populated rather than `{}`: an existing bin must pick up a corrected name,
  // location or zone on the next seed. Leaving it empty let the catalog here and the row in
  // the database drift apart with nothing to reconcile them.
  const bins = await Promise.all(
    binData.map((b) =>
      prisma.bin.upsert({
        where: { code: b.code },
        update: { name: b.name, location: b.location, zone: b.zone },
        create: b,
      })
    )
  );

  // Retire bins no longer in the catalog. Deactivated, never deleted — a bin can still be
  // referenced by historical stock and transaction rows, and deleting one would orphan them.
  const staleBins = await prisma.bin.updateMany({
    where: { code: { notIn: binData.map((b) => b.code) }, isActive: true },
    data: { isActive: false },
  });

  console.log(
    `Created ${bins.length} bins` +
      (staleBins.count ? `, deactivated ${staleBins.count} stale` : "")
  );

  // Create products
  const productData = [
    { sku: "HRO-MTB26", name: "Hero Sprint 26T MTB", categoryId: categories[0].id, brandId: brands[0].id, type: "BICYCLE" as const, costPrice: 8500, sellingPrice: 12000, mrp: 13500, gstRate: 12, hsnCode: "8712", currentStock: 8, reorderLevel: 5, reorderQty: 10, maxStock: 20, size: "26\"", color: "Red", binId: bins[0].id },
    { sku: "BSA-RD700", name: "BSA Roadster 700C", categoryId: categories[0].id, brandId: brands[1].id, type: "BICYCLE" as const, costPrice: 12000, sellingPrice: 16500, mrp: 18000, gstRate: 12, hsnCode: "8712", currentStock: 3, reorderLevel: 3, reorderQty: 5, maxStock: 10, size: "700C", color: "Blue", binId: bins[1].id },
    { sku: "FFX-HYB24", name: "Firefox Hybrid 24T", categoryId: categories[0].id, brandId: brands[2].id, type: "BICYCLE" as const, costPrice: 15000, sellingPrice: 21000, mrp: 24000, gstRate: 12, hsnCode: "8712", currentStock: 2, reorderLevel: 3, reorderQty: 4, maxStock: 8, size: "24\"", color: "Black", binId: bins[2].id },
    { sku: "HRO-TUB26", name: "Hero Tube 26x1.95", categoryId: categories[3].id, brandId: brands[0].id, type: "SPARE_PART" as const, costPrice: 120, sellingPrice: 200, mrp: 250, gstRate: 18, hsnCode: "4011", currentStock: 45, reorderLevel: 15, reorderQty: 30, maxStock: 100, binId: bins[4].id },
    { sku: "GEN-BRK01", name: "V-Brake Pad Set", categoryId: categories[4].id, brandId: brands[3].id, type: "SPARE_PART" as const, costPrice: 80, sellingPrice: 150, mrp: 180, gstRate: 18, hsnCode: "8714", currentStock: 30, reorderLevel: 10, reorderQty: 20, maxStock: 60, binId: bins[7].id },
    { sku: "GEN-CHN01", name: "Single Speed Chain", categoryId: categories[5].id, brandId: brands[3].id, type: "SPARE_PART" as const, costPrice: 150, sellingPrice: 280, mrp: 320, gstRate: 18, hsnCode: "7315", currentStock: 18, reorderLevel: 8, reorderQty: 15, maxStock: 40, binId: bins[7].id },
    { sku: "GEN-LGT01", name: "USB Rechargeable Front Light", categoryId: categories[6].id, brandId: brands[6].id, type: "ACCESSORY" as const, costPrice: 250, sellingPrice: 450, mrp: 500, gstRate: 18, currentStock: 12, reorderLevel: 5, reorderQty: 10, maxStock: 30, binId: bins[8].id },
    { sku: "GEN-HLM01", name: "Adult Helmet - L", categoryId: categories[7].id, brandId: brands[6].id, type: "ACCESSORY" as const, costPrice: 400, sellingPrice: 700, mrp: 800, gstRate: 18, currentStock: 6, reorderLevel: 4, reorderQty: 8, maxStock: 15, binId: bins[8].id },
    { sku: "HRO-TYR26", name: "Hero Tyre 26x2.10", categoryId: categories[3].id, brandId: brands[0].id, type: "SPARE_PART" as const, costPrice: 350, sellingPrice: 550, mrp: 650, gstRate: 18, hsnCode: "4011", currentStock: 22, reorderLevel: 10, reorderQty: 20, maxStock: 50, binId: bins[9].id },
    { sku: "HRC-KDS20", name: "Hercules Kids 20T", categoryId: categories[0].id, brandId: brands[3].id, type: "BICYCLE" as const, costPrice: 5500, sellingPrice: 7800, mrp: 8500, gstRate: 12, hsnCode: "8712", currentStock: 4, reorderLevel: 3, reorderQty: 5, maxStock: 10, size: "20\"", color: "Green", binId: bins[2].id },
    { sku: "TRK-MRV29", name: "Trek Marlin 29er", categoryId: categories[0].id, brandId: brands[4].id, type: "BICYCLE" as const, costPrice: 35000, sellingPrice: 45000, mrp: 52000, gstRate: 12, hsnCode: "8712", currentStock: 1, reorderLevel: 2, reorderQty: 3, maxStock: 5, size: "29\"", color: "Matte Black", binId: bins[0].id },
    { sku: "GEN-PDL01", name: "Alloy Pedal Set", categoryId: categories[1].id, brandId: brands[3].id, type: "SPARE_PART" as const, costPrice: 200, sellingPrice: 380, mrp: 450, gstRate: 18, currentStock: 25, reorderLevel: 8, reorderQty: 15, maxStock: 50, binId: bins[5].id },
    { sku: "GEN-SDL01", name: "Comfort Saddle", categoryId: categories[1].id, brandId: brands[6].id, type: "SPARE_PART" as const, costPrice: 350, sellingPrice: 600, mrp: 700, gstRate: 18, currentStock: 10, reorderLevel: 4, reorderQty: 8, maxStock: 20, binId: bins[5].id },
    { sku: "GEN-GRP01", name: "Handlebar Grip Set", categoryId: categories[1].id, brandId: brands[3].id, type: "SPARE_PART" as const, costPrice: 60, sellingPrice: 120, mrp: 150, gstRate: 18, currentStock: 40, reorderLevel: 12, reorderQty: 25, maxStock: 80, binId: bins[6].id },
    { sku: "GEN-BEL01", name: "Cycle Bell - Chrome", categoryId: categories[2].id, brandId: brands[7].id, type: "ACCESSORY" as const, costPrice: 30, sellingPrice: 80, mrp: 100, gstRate: 18, currentStock: 50, reorderLevel: 15, reorderQty: 30, maxStock: 100, binId: bins[6].id },
    { sku: "GEN-LCK01", name: "Cable Lock 4-Digit", categoryId: categories[2].id, brandId: brands[6].id, type: "ACCESSORY" as const, costPrice: 150, sellingPrice: 300, mrp: 350, gstRate: 18, currentStock: 15, reorderLevel: 5, reorderQty: 10, maxStock: 30, binId: bins[8].id },
    { sku: "GEN-PMP01", name: "Floor Pump with Gauge", categoryId: categories[2].id, brandId: brands[6].id, type: "ACCESSORY" as const, costPrice: 500, sellingPrice: 900, mrp: 1050, gstRate: 18, currentStock: 7, reorderLevel: 3, reorderQty: 6, maxStock: 15, binId: bins[9].id },
    { sku: "GEN-BTL01", name: "Water Bottle + Cage", categoryId: categories[2].id, brandId: brands[6].id, type: "ACCESSORY" as const, costPrice: 120, sellingPrice: 220, mrp: 280, gstRate: 18, currentStock: 20, reorderLevel: 8, reorderQty: 15, maxStock: 40, binId: bins[10].id },
    { sku: "HRO-SPK26", name: "Hero Spoke Set 26\"", categoryId: categories[1].id, brandId: brands[0].id, type: "SPARE_PART" as const, costPrice: 100, sellingPrice: 180, mrp: 200, gstRate: 18, currentStock: 35, reorderLevel: 10, reorderQty: 20, maxStock: 60, binId: bins[11].id },
    { sku: "GEN-RFL01", name: "Rear Reflector Set", categoryId: categories[2].id, brandId: brands[7].id, type: "ACCESSORY" as const, costPrice: 40, sellingPrice: 90, mrp: 120, gstRate: 18, currentStock: 30, reorderLevel: 10, reorderQty: 20, maxStock: 50, binId: bins[10].id },
  ];

  const products = [];
  for (const p of productData) {
    const product = await prisma.product.upsert({
      where: { sku: p.sku },
      update: {},
      create: p,
    });
    products.push(product);
  }

  console.log(`Created ${products.length} products`);

  // Create serial items for bicycles
  const bicycleProducts = products.filter((p) => p.type === "BICYCLE");
  let serialCount = 0;
  for (const bike of bicycleProducts) {
    for (let i = 1; i <= bike.currentStock; i++) {
      const serialCode = `${bike.sku}-${String(i).padStart(4, "0")}`;
      await prisma.serialItem.upsert({
        where: { serialCode },
        update: {},
        create: {
          serialCode,
          productId: bike.id,
          status: "IN_STOCK",
          condition: "NEW",
          barcodeData: serialCode,
          binId: bike.binId,
        },
      });
      serialCount++;
    }
  }

  console.log(`Created ${serialCount} serial items`);

  // Create sample transactions. The admin is the only seeded user, so it owns them.
  const txns = [
    { type: "INWARD" as const, productId: products[3].id, quantity: 20, previousStock: 25, newStock: 45, referenceNo: "INV-2024-0312", userId: admin.id },
    { type: "INWARD" as const, productId: products[8].id, quantity: 10, previousStock: 12, newStock: 22, referenceNo: "INV-2024-0313", userId: admin.id },
    { type: "OUTWARD" as const, productId: products[0].id, quantity: 1, previousStock: 9, newStock: 8, referenceNo: "SALE-0456", userId: admin.id },
    { type: "OUTWARD" as const, productId: products[3].id, quantity: 3, previousStock: 48, newStock: 45, referenceNo: "SALE-0457", userId: admin.id },
    { type: "OUTWARD" as const, productId: products[6].id, quantity: 2, previousStock: 14, newStock: 12, referenceNo: "SALE-0458", userId: admin.id },
  ];

  // Guarded rather than upserted: InventoryTransaction has no unique key to upsert on —
  // `referenceNo` is a nullable String with no @unique. A plain create therefore re-ran the
  // whole sample set on every seed, so three seeds left three copies and a stock history
  // that disagreed with the product rows on every dashboard that reads it.
  let txnsCreated = 0;
  for (const txn of txns) {
    const exists = await prisma.inventoryTransaction.findFirst({
      where: { referenceNo: txn.referenceNo, productId: txn.productId, type: txn.type },
      select: { id: true },
    });
    if (exists) continue;
    await prisma.inventoryTransaction.create({ data: txn });
    txnsCreated++;
  }

  console.log(
    `Created ${txnsCreated} transactions` +
      (txnsCreated < txns.length ? ` (${txns.length - txnsCreated} already present)` : "")
  );
  
  // Seed Staff LMS Content
  await seedStaffLms(prisma);

  console.log("Seeding complete!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
