// ─── Stores and warehouses ───────────────────────────────────────────────────
//
//   npm run db:seed:stores        (or as part of npm run db:seed)
//
// THIS IS NOT SAMPLE DATA, and the distinction matters — prisma/seed.ts says in its header
// that no sample data is seeded. Stores and warehouses are INFRASTRUCTURE: the stock system
// cannot function with zero warehouses any more than it can with zero roles, because after
// Phase 4 of the store-hierarchy plan every StockLevel row points at a warehouse and has
// nowhere to point until one exists. Categories and brands are sample data; these are not.
//
// SAFE TO RE-RUN. Idempotent on `code`, which is why `code` reuses the old StockLocation
// enum strings ("BCH_WAREHOUSE", "BCH_STORE", ...) — the Phase 4 backfill becomes a plain
// lookup by the value already sitting in the column, rather than a mapping table.
//
// The shape below is the STARTING shape, not the permanent one. Two sites, one warehouse
// each. Adding a second warehouse under a store is an INSERT through /stores with no
// migration and no redeploy — that is the whole reason these are rows instead of an enum.
// See docs/implementation/pending/store-hierarchy-and-team-plan.md §2.1.
import { PrismaClient } from "@prisma/client";

interface StoreSeed {
  code: string;
  name: string;
  sortOrder: number;
  warehouses: Array<{ code: string; name: string; sortOrder: number }>;
}

const STORES: StoreSeed[] = [
  {
    code: "BCH_STORE",
    name: "BCH Store",
    sortOrder: 10,
    warehouses: [{ code: "BCH_WAREHOUSE", name: "BCH Warehouse", sortOrder: 10 }],
  },
  {
    code: "BCC_STORE",
    name: "BCC Store",
    sortOrder: 20,
    warehouses: [{ code: "BCC_WAREHOUSE", name: "BCC Warehouse", sortOrder: 10 }],
  },
];

export async function seedStores(prisma: PrismaClient) {
  let storesCreated = 0;
  let warehousesCreated = 0;

  for (const s of STORES) {
    // `update` deliberately carries name and sortOrder but NOT isActive: an admin who
    // deactivated a store in the UI must not have that undone by a seed run. Same reasoning
    // seed-rbac.ts applies to a role's edited grants.
    const existing = await prisma.store.findUnique({ where: { code: s.code } });
    const store = await prisma.store.upsert({
      where: { code: s.code },
      update: { name: s.name, sortOrder: s.sortOrder },
      create: { code: s.code, name: s.name, sortOrder: s.sortOrder },
    });
    if (!existing) storesCreated++;

    for (const w of s.warehouses) {
      const had = await prisma.warehouse.findUnique({ where: { code: w.code } });
      await prisma.warehouse.upsert({
        where: { code: w.code },
        update: { name: w.name, sortOrder: w.sortOrder, storeId: store.id },
        create: { code: w.code, name: w.name, sortOrder: w.sortOrder, storeId: store.id },
      });
      if (!had) warehousesCreated++;
    }
  }

  const totalStores = await prisma.store.count();
  const totalWarehouses = await prisma.warehouse.count();

  console.log(
    `  stores       : ${totalStores} synced (${storesCreated} new)\n` +
      `  warehouses   : ${totalWarehouses} synced (${warehousesCreated} new)`
  );
}

// Allow `ts-node prisma/seed-stores.ts` on its own.
if (require.main === module) {
  const prisma = new PrismaClient();
  seedStores(prisma)
    .then(() => console.log("\nStore seed complete."))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
