/*
 * Import products from a Zoho item export (.xls / .xlsx / .csv) into `Product`.
 *
 *   npm run import:products -- <file> [--wipe] [--dry-run] [--limit=N]
 *
 * Deliberately dumb. It moves columns into columns and derives NOTHING.
 *
 * Owner's instruction, 1 Sep 2026: *"don't use any auto type regex"*. So there is no
 * name-matching, no HSN classification and no size parsing anywhere in this file. Every
 * product lands with a single default type, in one default category, and is re-typed later
 * from the Product Types screen once that exists (Part B of the plan). A guess that is
 * wrong on thousands of rows is worse than a blank someone can filter and fix in bulk.
 *
 * `productTypeId`, `categoryId` and `brandId` are all REQUIRED on Product, which is why each
 * gets a real default row rather than null.
 *
 * NOT written, deliberately: no `StockLevel` rows and `currentStock: 0`.
 * `Product.currentStock` is a cached SUM of `StockLevel` (src/lib/stock-location.ts);
 * writing one without the other yields a catalog that looks right on /stock and reports zero
 * everywhere location matters. Quantities come from a stock audit, not from this file.
 */

import { PrismaClient, ProductStatus } from "@prisma/client";
import * as XLSX from "xlsx";
import * as path from "path";
import * as fs from "fs";

const prisma = new PrismaClient();

// ─── The judgement calls, all in one place ───────────────────────────────────────────────

/** Every product lands here. `Product.categoryId` is REQUIRED, so "no category" has to be a
 *  real row. Re-file from /more/categories, which already supports a parent/child tree. */
const DEFAULT_CATEGORY = "Uncategorized";

/**
 * Every product lands under this brand. Owner's instruction, 1 Sep 2026: *"at this script
 * insert make them under unbranded and uncategorized."*
 *
 * `FORCE_DEFAULT_BRAND = true` means the file's `Brand` column is IGNORED, including the
 * 5,577 rows that carry a real brand across 122 distinct names. That is a deliberate choice
 * to start from one flat bucket rather than a half-populated one.
 *
 * It is recoverable and nothing is lost: `zohoItemId` is stored on every row, so a later
 * backfill can re-read this same file and match on it to assign the real brands. Note that
 * re-running THIS script will not do it — `createMany({ skipDuplicates: true })` skips rows
 * that already exist rather than updating them.
 *
 * Set to false to keep the real brand where the column has one.
 */
const DEFAULT_BRAND = "Unbranded";
const FORCE_DEFAULT_BRAND = true;

/**
 * ⚠️ EVERY imported product gets this type, by NAME.
 *
 * There is no classifier, by instruction. `Product.productTypeId` is required, so the import
 * has to pick one — it looks this name up in the `ProductType` table and fails loudly if it
 * is missing, rather than inventing a type nobody asked for.
 *
 * The consequence, stated plainly: after the import every item sits under Spares and
 * /stock's Cycles tab is empty. That is the expected state, corrected by re-typing in bulk
 * from /product-types.
 */
const DEFAULT_TYPE_NAME = "Spares";

/** The file has no MRP column. Selling price is the closest true value; 0 renders an empty
 *  MRP on every label and product card. */
const MRP_FROM_SELLING = true;

/**
 * ⚠️ INACTIVE ROWS ARE SKIPPED ENTIRELY — owner's instruction, 1 Sep 2026:
 * *"remove the inactive product or rows, don't consider those, only insert the active
 * product."*
 *
 * This REVERSES an earlier decision. The plan originally said import all 8,175 as ACTIVE and
 * deactivate later from the product screen. It does not any more: a row whose Zoho `Status`
 * is anything but `Active` is dropped before it reaches the database, and the summary says
 * how many.
 *
 * Consequence to be clear about: those SKUs will not exist here at all. If one later turns up
 * on a bill, the bill import creates a fresh product for it rather than matching — see the
 * bill branch of `api/zoho/pull-review/approve`. Re-running with `ONLY_ACTIVE = false` is
 * how they would be brought in.
 */
const ONLY_ACTIVE = true;

/** The value `Status` must hold for a row to be imported. Compared case-insensitively. */
const ACTIVE_STATUS = "active";

/** Every imported product is created ACTIVE — which, with ONLY_ACTIVE, is now a tautology. */
const IMPORT_STATUS = ProductStatus.ACTIVE;

const CHUNK = 500;

// ─── Columns ─────────────────────────────────────────────────────────────────────────────

const COL = {
  name: "Product Name", // NOT "Item Name" — see the note below
  zohoId: "Item ID",
  sku: "SKU",
  sellingPrice: "Selling Price",
  costPrice: "Purchase Price",
  brand: "Brand",
  hsn: "HSN/SAC",
  gstRate: "Intra State Tax Rate",
  status: "Status", // read to FILTER on, never stored — see ONLY_ACTIVE
} as const;

/*
 * Present in the export and deliberately NOT imported:
 *
 *   Item Name       the per-variant name ("…EPIC RIDE -S"). `Product Name` is used instead,
 *                   by instruction. They differ on 51 of 8,175 rows; everywhere else they
 *                   are identical, so this changes 51 names and nothing more.
 *   Manufacturer    dropped by instruction. It was only ever a brand fallback and rescued
 *                   24 rows.
 *   Taxable         constant "true" on all 8,216 rows. Nothing to store.
 *   Category Name   dropped by instruction, along with the type/size derivation that read
 *                   it. Its 32 values are a mix of wheel sizes and category words; without
 *                   a classifier there is nothing to map them onto, and `Product` has no
 *                   column that takes the raw value.
 *   Status          not stored, but READ: an inactive row is skipped outright. See
 *                   ONLY_ACTIVE. Every product that is imported is created ACTIVE.
 */

type Row = Record<string, unknown>;

const str = (v: unknown) => String(v ?? "").trim();

/** "INR 6499.00" -> 6499. Survives bare numbers, ₹ and thousands separators. */
function money(v: unknown): number {
  const n = Number(str(v).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

// ─── Main ────────────────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith("--"));
  const wipe = args.includes("--wipe");
  const dryRun = args.includes("--dry-run");
  const limitArg = args.find((a) => a.startsWith("--limit="));
  const limit = limitArg ? Number(limitArg.split("=")[1]) : Infinity;

  if (!file) {
    console.error("usage: npm run import:products -- <file.xls> [--wipe] [--dry-run] [--limit=N]");
    process.exit(1);
  }
  const abs = path.resolve(file);
  if (!fs.existsSync(abs)) {
    console.error(`file not found: ${abs}`);
    process.exit(1);
  }

  console.log(`reading ${abs}`);
  const wb = XLSX.readFile(abs);
  const sheetName = wb.SheetNames[0];
  const sheet = sheetName ? wb.Sheets[sheetName] : undefined;
  if (!sheet) {
    console.error("no sheet in workbook");
    process.exit(1);
  }
  const raw = XLSX.utils.sheet_to_json<Row>(sheet, { defval: "" });
  console.log(`  ${raw.length} data rows, sheet "${sheetName}"`);

  const headers = Object.keys(raw[0] ?? {});
  const missing = Object.values(COL).filter((c) => !headers.includes(c));
  if (missing.length) {
    console.error(`\nmissing expected column(s): ${missing.join(", ")}`);
    console.error(`file has: ${headers.join(", ")}`);
    process.exit(1);
  }

  // ── Dedupe on Item ID.
  //
  // Item ID is NOT unique in the export — 37 ids appear twice, 78 rows. Every one of those
  // 37 groups is a byte-identical pair on adjacent rows, so first-wins loses nothing. It is
  // still the best key available: `SKU` carries exactly the same 37 collisions, and
  // `Product Name` is not unique by design (variants share it).
  const byZohoId = new Map<string, Row>();
  let noId = 0;
  let dupes = 0;
  for (const r of raw) {
    const id = str(r[COL.zohoId]);
    if (!id) { noId++; continue; }
    if (byZohoId.has(id)) { dupes++; continue; }
    byZohoId.set(id, r);
  }
  const deduped = [...byZohoId.values()];
  console.log(`  ${deduped.length} unique by Item ID — ${dupes} duplicate row(s) dropped${noId ? `, ${noId} with no Item ID skipped` : ""}`);

  // ── Drop inactive rows. Before validation on purpose: a row that is not being imported
  // must not be able to fail the whole file for a missing SKU.
  const active = ONLY_ACTIVE
    ? deduped.filter((r) => str(r[COL.status]).toLowerCase() === ACTIVE_STATUS)
    : deduped;
  if (ONLY_ACTIVE) {
    const skipped = deduped.length - active.length;
    console.log(`  ${active.length} active — ${skipped} inactive row(s) skipped and NOT imported`);
  }

  const rows = active.slice(0, limit);

  // ── Validate the whole file before writing any of it. A half-loaded catalog is worse
  // than a rejected one.
  const problems: string[] = [];
  const skuSeen = new Map<string, string>();
  rows.forEach((r, i) => {
    const line = i + 2;
    if (!str(r[COL.name])) problems.push(`row ${line}: no ${COL.name}`);
    const sku = str(r[COL.sku]);
    if (!sku) problems.push(`row ${line}: no SKU`);
    else if (skuSeen.has(sku)) problems.push(`row ${line}: SKU "${sku}" already used by Item ID ${skuSeen.get(sku)}`);
    else skuSeen.set(sku, str(r[COL.zohoId]));
  });
  if (problems.length) {
    console.error(`\n${problems.length} problem row(s) — nothing was written:`);
    problems.slice(0, 25).forEach((p) => console.error("  " + p));
    if (problems.length > 25) console.error(`  … and ${problems.length - 25} more`);
    process.exit(1);
  }

  // ── Brands: one upsert per distinct name, not one per product.
  const brandOf = (r: Row) =>
    FORCE_DEFAULT_BRAND ? DEFAULT_BRAND : str(r[COL.brand]) || DEFAULT_BRAND;

  const brandNames = new Set(rows.map(brandOf));
  if (FORCE_DEFAULT_BRAND) {
    const realBrands = new Set(rows.map((r) => str(r[COL.brand])).filter(Boolean)).size;
    console.log(`\nbrand:    all ${rows.length} products -> "${DEFAULT_BRAND}"`);
    console.log(`          (${realBrands} real brand name(s) in the file are ignored — see FORCE_DEFAULT_BRAND)`);
  } else {
    const usingDefault = rows.filter((r) => brandOf(r) === DEFAULT_BRAND).length;
    console.log(`\nbrand:    ${brandNames.size} distinct; ${usingDefault} row(s) fall back to "${DEFAULT_BRAND}"`);
  }
  console.log(`category: all ${rows.length} products -> "${DEFAULT_CATEGORY}"`);
  console.log(`type:     all ${rows.length} products -> "${DEFAULT_TYPE_NAME}" (no classifier, by instruction)`);

  if (dryRun) {
    const r = rows[0];
    console.log("\n--dry-run: nothing written. First row would become:");
    console.log(JSON.stringify({
      sku: str(r[COL.sku]),
      name: str(r[COL.name]),
      zohoItemId: str(r[COL.zohoId]),
      brand: brandOf(r),
      category: DEFAULT_CATEGORY,
      type: DEFAULT_TYPE_NAME,
      status: IMPORT_STATUS,
      costPrice: money(r[COL.costPrice]),
      sellingPrice: money(r[COL.sellingPrice]),
      mrp: MRP_FROM_SELLING ? money(r[COL.sellingPrice]) : 0,
      gstRate: Number(str(r[COL.gstRate])) || 18,
      hsnCode: str(r[COL.hsn]) || null,
      currentStock: 0,
    }, null, 2));
    return;
  }

  // Required FK: resolve it before building any rows, and fail loudly rather than creating a
  // type nobody asked for. `npm run db:seed:rbac` does not seed these; the three defaults are
  // created with the schema change and the rest come from /product-types.
  const productType = await prisma.productType.findFirst({
    where: { name: { equals: DEFAULT_TYPE_NAME, mode: "insensitive" } },
    select: { id: true, name: true },
  });
  if (!productType) {
    console.error(`
No ProductType named "${DEFAULT_TYPE_NAME}". Create it at /product-types first.`);
    process.exit(1);
  }

  const category = await prisma.category.upsert({
    where: { name: DEFAULT_CATEGORY },
    update: {},
    create: { name: DEFAULT_CATEGORY, description: "Products imported without a category. Re-file from /more/categories." },
    select: { id: true },
  });

  const brandIdByName = new Map<string, string>();
  for (const name of brandNames) {
    const b = await prisma.brand.upsert({
      where: { name },
      update: {},
      create: { name },
      select: { id: true, name: true },
    });
    brandIdByName.set(b.name, b.id);
  }

  if (wipe) {
    console.log("\n--wipe: deleting Product and everything that hangs off it…");
    await prisma.$transaction([
      prisma.inventoryTransaction.deleteMany({}),
      prisma.stockCountItem.deleteMany({}),
      prisma.serialItem.deleteMany({}),
      prisma.stockLevel.deleteMany({}),
      prisma.purchaseOrderItem.deleteMany({}),
      prisma.transferOrderItem.deleteMany({}),
      prisma.inboundLineItem.deleteMany({}),
      prisma.product.deleteMany({}),
    ]);
    console.log("  done.");
  }

  const data = rows.map((r) => {
    const sellingPrice = money(r[COL.sellingPrice]);
    return {
      sku: str(r[COL.sku]),
      name: str(r[COL.name]),
      zohoItemId: str(r[COL.zohoId]),
      brandId: brandIdByName.get(brandOf(r))!,
      categoryId: category.id,
      productTypeId: productType.id,
      status: IMPORT_STATUS,
      costPrice: money(r[COL.costPrice]),
      sellingPrice,
      mrp: MRP_FROM_SELLING ? sellingPrice : 0,
      gstRate: Number(str(r[COL.gstRate])) || 18,
      hsnCode: str(r[COL.hsn]) || null,
      currentStock: 0,
    };
  });

  console.log(`\ninserting ${data.length} products in chunks of ${CHUNK}…`);
  let created = 0;
  for (let i = 0; i < data.length; i += CHUNK) {
    const res = await prisma.product.createMany({ data: data.slice(i, i + CHUNK), skipDuplicates: true });
    created += res.count;
    process.stdout.write(`\r  ${Math.min(i + CHUNK, data.length)}/${data.length}`);
  }
  console.log(`\n\ncreated ${created}; ${data.length - created} skipped as already present (matched on sku or zohoItemId).`);
}

main()
  .catch((e) => {
    console.error("\nimport failed:", e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
