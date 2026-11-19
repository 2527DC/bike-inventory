// Flush all stock on hand: InventoryUnit, BinStock, StockLevel, AssemblyTask, BinMovementLog,
// and reset Product.currentStock / reservedStock to 0.
// Master data (Products, Brands, Categories, Warehouses, Bins, HomeBinRules, Users) is kept.
import { readFileSync, mkdirSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function takeSnapshot() {
  console.log("Taking safety snapshot before flushing stock...");
  const env = readFileSync(".env", "utf8");
  const directUrlLine = env.match(/^DIRECT_URL=\"?([^\"\n]+)/m)?.[1] || env.match(/^DATABASE_URL=\"?([^\"\n]+)/m)?.[1];
  if (!directUrlLine) throw new Error("No database URL in .env");

  const proto = directUrlLine.slice(0, directUrlLine.indexOf("://") + 3);
  const rest = directUrlLine.slice(directUrlLine.indexOf("://") + 3);
  const lastAt = rest.lastIndexOf("@");
  const userInfo = rest.slice(0, lastAt);
  const hostAndDb = rest.slice(lastAt + 1);
  const firstColon = userInfo.indexOf(":");
  const user = userInfo.slice(0, firstColon);
  const pass = userInfo.slice(firstColon + 1);
  const encodedUrl = proto + user + ":" + encodeURIComponent(pass) + "@" + hostAndDb;

  mkdirSync("backups", { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
  const outFile = join("backups", `postgres-pre-stock-flush-${stamp}.dump`);

  const res = spawnSync("/opt/homebrew/opt/postgresql@17/bin/pg_dump", [
    "-Fc", "--no-owner", "--no-acl", "-f", outFile, encodedUrl
  ], { stdio: "inherit" });

  if (res.status === 0 && statSync(outFile).size > 0) {
    console.log(`Snapshot saved: ${outFile} (${(statSync(outFile).size / 1024 / 1024).toFixed(2)} MB)\n`);
  } else {
    throw new Error(`Snapshot failed with status ${res.status}`);
  }
}

async function getStockCounts() {
  const [
    inventoryUnits,
    assemblyTasks,
    binMovementLogs,
    binStocks,
    stockLevels,
    productsWithStock
  ] = await Promise.all([
    prisma.inventoryUnit.count(),
    prisma.assemblyTask.count(),
    prisma.binMovementLog.count(),
    prisma.binStock.count(),
    prisma.stockLevel.count(),
    prisma.product.count({ where: { currentStock: { not: 0 } } })
  ]);

  return {
    inventoryUnits,
    assemblyTasks,
    binMovementLogs,
    binStocks,
    stockLevels,
    productsWithStock
  };
}

async function main() {
  console.log("=== Flushing All Stock On Hand ===");
  const before = await getStockCounts();
  console.log("Current stock counts before flush:", JSON.stringify(before, null, 2));

  await takeSnapshot();

  const startTime = Date.now();
  const results = await prisma.$transaction(async (tx) => {
    // 1. Delete rows pointing to InventoryUnit
    const delComplaints = await tx.complaint.deleteMany({});
    const delAssemblyTasks = await tx.assemblyTask.deleteMany({});
    const delBinMovementLogs = await tx.binMovementLog.deleteMany({});

    // 2. Delete InventoryUnits
    const delUnits = await tx.inventoryUnit.deleteMany({});

    // 3. Delete Serial Items (if any)
    const delSerialTx = await tx.serialTransactionItem.deleteMany({});
    const delSerials = await tx.serialItem.deleteMany({});

    // 4. Delete stock quantities
    const delBinStock = await tx.binStock.deleteMany({});
    const delStockLevel = await tx.stockLevel.deleteMany({});

    // 5. Reset product currentStock & reservedStock to 0
    const resetProducts = await tx.product.updateMany({
      where: {
        OR: [
          { currentStock: { not: 0 } },
          { reservedStock: { not: 0 } }
        ]
      },
      data: {
        currentStock: 0,
        reservedStock: 0
      }
    });

    return {
      complaints: delComplaints.count,
      assemblyTasks: delAssemblyTasks.count,
      binMovementLogs: delBinMovementLogs.count,
      inventoryUnits: delUnits.count,
      serialTransactionItems: delSerialTx.count,
      serialItems: delSerials.count,
      binStocks: delBinStock.count,
      stockLevels: delStockLevel.count,
      productsResetToZero: resetProducts.count
    };
  }, {
    timeout: 120000
  });

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\nTransaction completed in ${durationSec} s:`);
  console.log(JSON.stringify(results, null, 2));

  const after = await getStockCounts();
  console.log("\nStock counts after flush:", JSON.stringify(after, null, 2));
}

main()
  .catch((e) => {
    console.error("Stock flush failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
