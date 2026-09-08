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
// TWO EXCEPTIONS, and neither is the policy eroding.
//
// EXCEPTION 1: stores and warehouses.
// Those are INFRASTRUCTURE, not sample data. The stock system cannot function with
// zero warehouses any more than it can with zero roles — every StockLevel row points
// at a warehouse and has nowhere to point until one exists. A category is a thing
// someone invented for a demo; a warehouse is a precondition for the app running at
// all. See prisma/seed-stores.ts, which says the same thing at more length, and
// docs/implementation/pending/store-hierarchy-and-team-plan.md §2.1 for why the
// starting shape is two stores with one warehouse each rather than four locations.
//
// EXCEPTION 2: the two import placeholders, `Uncategorized` and `Unbranded`.
// A category invented for a demo is sample data; these two are the OPPOSITE of that. They
// are the only rows that mean "this fact is not known yet", and they exist because
// Product.brandId and Product.categoryId are non-null on a model where both facts are
// routinely unknown (see src/lib/import-placeholders.ts, which says it at length). Every
// import needs somewhere to file a product it cannot describe, and the "Needs details" queue
// on /stock is defined as the products sitting on exactly these rows.
//
// They are seeded here so that no IMPORT ever has to create them. Until now the Zoho bill
// approve route created `Uncategorized` itself if it was missing — an import inventing
// taxonomy as a side effect, which is the whole class of bug the 0809 plan closes. With the
// rows guaranteed to exist, that route becomes a plain lookup that fails loudly rather than
// a silent writer. See docs/implementation/pending/0809-brand-category-single-creation-path-plan.md §6.
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
// Relative, not "@/lib/...": prisma/tsconfig.json runs under ts-node with CommonJS and no
// tsconfig-paths hook, so the `@/*` alias compiles but does not RESOLVE at run time. This is
// the first import from src/ under prisma/ and it is safe only because
// import-placeholders.ts is deliberately dependency-free — no prisma, nothing server-only.
import { PLACEHOLDER_CATEGORY } from "../src/lib/import-placeholders";

const prisma = new PrismaClient();

/**
 * The placeholder brand this seeds — and it is NOT `PLACEHOLDER_BRAND`.
 *
 * `import-placeholders.ts` exports `PLACEHOLDER_BRAND = "Imported"`, but nothing writes that
 * spelling any more: the Zoho item import that did was deleted, and the catalog import wrote
 * `"Unbranded"` instead. 1,289 products currently sit on `Unbranded` and none are being
 * created on `Imported`, so `Unbranded` is the row an import actually needs to find.
 *
 * Both names are recognised by `isPlaceholderBrand()`, so a product on either one lands in
 * the "Needs details" queue and renders muted on /stock — the two spellings differ in
 * history, not in meaning. Seeding `Imported` as well would create a second empty row that
 * means the same thing, which is how three spellings happened in the first place.
 *
 * If the exported constant is ever corrected to "Unbranded", replace this literal with it.
 */
const PLACEHOLDER_BRAND_TO_SEED = "Unbranded";

/**
 * Idempotent: `upsert` on the `@unique` name column, with an EMPTY `update`.
 *
 * Empty on purpose. Re-running the seed must not undo an edit someone made in the app — the
 * same reasoning seed-stores.ts applies to a deactivated store and seed-rbac.ts to a
 * tightened role. All this guarantees is that the row EXISTS.
 */
async function seedImportPlaceholders(prisma: PrismaClient) {
  const hadCategory = await prisma.category.findUnique({
    where: { name: PLACEHOLDER_CATEGORY },
    select: { id: true },
  });
  await prisma.category.upsert({
    where: { name: PLACEHOLDER_CATEGORY },
    update: {},
    create: { name: PLACEHOLDER_CATEGORY },
  });

  const hadBrand = await prisma.brand.findUnique({
    where: { name: PLACEHOLDER_BRAND_TO_SEED },
    select: { id: true },
  });
  await prisma.brand.upsert({
    where: { name: PLACEHOLDER_BRAND_TO_SEED },
    update: {},
    create: { name: PLACEHOLDER_BRAND_TO_SEED },
  });

  console.log(
    `  category     : ${PLACEHOLDER_CATEGORY} ${hadCategory ? "present" : "created"}\n` +
      `  brand        : ${PLACEHOLDER_BRAND_TO_SEED} ${hadBrand ? "present" : "created"}`
  );
}

async function main() {
  console.log("Seeding database...");

  console.log("\nRBAC:");
  await seedRbac(prisma);

  // After RBAC, not before: seedRbac creates the admin user, and a store seeded first would
  // have nobody to assign it to. Order is not load-bearing beyond that — the two are
  // independent — but keeping it stable makes the output readable.
  console.log("\nStores & warehouses:");
  await seedStores(prisma);

  // Independent of both steps above — no user and no warehouse is involved. Last only
  // because it is the smallest, and the output reads better with the infrastructure first.
  console.log("\nImport placeholders:");
  await seedImportPlaceholders(prisma);

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
