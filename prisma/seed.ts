// ─── The one seed entry point ────────────────────────────────────────────────
//
//   npm run db:seed
//
// Seeds RBAC and nothing else: modules, permissions, the ADMIN role holding every
// permission, the default roles, and the single admin user. What that covers in
// detail — including the ADMIN_EMAIL / ADMIN_ACCESS_CODE overrides — is documented
// at the top of prisma/seed-rbac.ts.
//
// There is deliberately NO sample data. Categories, brands, bins, products, serial
// items, transactions and the Staff LMS content were all seeded here and have been
// removed: they were invented records that then had to be recognised and cleaned
// out of every environment they reached. Create the real ones through the app —
// /api/categories, /api/brands and /api/bins all accept POST.
//
// ONE EXCEPTION, and it is not the policy eroding: stores and warehouses.
// Those are INFRASTRUCTURE, not sample data. The stock system cannot function with
// zero warehouses any more than it can with zero roles — every StockLevel row points
// at a warehouse and has nowhere to point until one exists. A category is a thing
// someone invented for a demo; a warehouse is a precondition for the app running at
// all. See prisma/seed-stores.ts, which says the same thing at more length, and
// docs/implementation/pending/store-hierarchy-and-team-plan.md §2.1 for why the
// starting shape is two stores with one warehouse each rather than four locations.
//
// Note that stripping this file does not remove rows an earlier seed already wrote.
// A database seeded before this change still holds that sample data until it is
// reset or deleted.
//
// SAFE TO RE-RUN. seedRbac is idempotent: it syncs the catalog in prisma/rbac-catalog.ts,
// re-grants the full permission set to ADMIN, and leaves every other role's grants
// untouched — an admin who tightened a role in the UI does not lose that to a seed.
//
// This file remains even though it now does nothing but call seedRbac, because
// `prisma db seed` is the hook Prisma invokes on `prisma migrate reset`. Day to day
// the narrower command is the same work without Prisma's wrapper:
//
//   npm run db:seed:rbac
//
import { PrismaClient } from "@prisma/client";
import { seedRbac } from "./seed-rbac";
import { seedStores } from "./seed-stores";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding database...");

  console.log("\nRBAC:");
  await seedRbac(prisma);

  // After RBAC, not before: seedRbac creates the admin user, and a store seeded first would
  // have nobody to assign it to. Order is not load-bearing beyond that — the two are
  // independent — but keeping it stable makes the output readable.
  console.log("\nStores & warehouses:");
  await seedStores(prisma);

  console.log("\nSeeding complete!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
