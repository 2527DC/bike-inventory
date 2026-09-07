/*
 * Generate SQL that re-files EXISTING products onto their real brand and category.
 *
 *   node scripts/gen-catalog-backfill.js prisma/data/Item.xls > prisma/data/catalog-backfill.sql
 *
 * `catalog.sql` inserts; this one UPDATEs. It exists because every SKU in the export is
 * already in Product, so the insert's ON CONFLICT (sku) DO NOTHING skips all 5,738 rows and
 * they stay on "Unbranded"/"Uncategorized".
 *
 * Keyed on `Product.zohoItemId`, which the original import stored on every row.
 *
 * SAFETY: a product whose brand is already REAL is never touched. Only rows sitting on a
 * placeholder (Unbranded / Imported / General — the list in src/lib/import-placeholders.ts)
 * are re-filed. Category is re-filed only from "Uncategorized" or NULL.
 */
const XLSX = require("xlsx");
const path = require("path");

const COL = { name: "Product Name", zohoId: "Item ID", sku: "SKU", brand: "Brand",
              category: "Category Name", status: "Status" };
const PLACEHOLDERS = ["unbranded", "imported", "general"];
const CHUNK = 1000;

const file = process.argv[2];
if (!file) { console.error("usage: node scripts/gen-catalog-backfill.js <Item.xls>"); process.exit(1); }

const str = (v) => String(v ?? "").trim();
const q = (v) => (v == null ? "NULL" : "'" + String(v).replace(/'/g, "''") + "'");

const wb = XLSX.readFile(path.resolve(file));
const raw = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" });

const seen = new Set();
const rows = [];
let inactive = 0, noBrand = 0;
for (const r of raw) {
  if (str(r[COL.status]).toLowerCase() !== "active") { inactive++; continue; }
  const zid = str(r[COL.zohoId]);
  if (!zid || seen.has(zid)) continue;
  seen.add(zid);
  const brand = str(r[COL.brand]);
  const cat = str(r[COL.category]);
  if (!brand && !cat) { noBrand++; continue; }
  rows.push({ zid, brand: brand || null, cat: cat || null });
}

const out = [];
const W = (s) => out.push(s);
W("--");
W("-- Re-file EXISTING products onto their real brand and category.");
W("-- generated " + new Date().toISOString() + " from " + path.basename(file));
W("-- " + rows.length + " rows carry a brand and/or category. Skipped: " + inactive + " inactive, " + noBrand + " with neither.");
W("--");
W("-- Only re-files a product whose brand is a PLACEHOLDER (unbranded/imported/general).");
W("-- A product someone has already given a real brand is left alone.");
W("-- Run prisma/data/catalog.sql FIRST — it creates the brands and categories this needs.");
W("--");
W("BEGIN;");
W("");

for (let i = 0; i < rows.length; i += CHUNK) {
  const chunk = rows.slice(i, i + CHUNK);
  W("-- rows " + (i + 1) + "–" + (i + chunk.length));
  W('UPDATE "Product" p SET');
  W('  "brandId"    = COALESCE(b.id, p."brandId"),');
  W('  "categoryId" = COALESCE(c.id, p."categoryId"),');
  W('  "updatedAt"  = now()');
  W("FROM (VALUES");
  W(chunk.map((r) => "  (" + [q(r.zid), q(r.brand), q(r.cat)].join(", ") + ")").join(",\n"));
  W(') AS v(zoho_id, brand_name, cat_name)');
  W('LEFT JOIN "Brand"    b ON lower(b.name) = lower(v.brand_name)');
  W('LEFT JOIN "Category" c ON lower(c.name) = lower(v.cat_name)');
  W('WHERE p."zohoItemId" = v.zoho_id');
  W('  AND EXISTS (SELECT 1 FROM "Brand" ob WHERE ob.id = p."brandId"');
  W("              AND lower(ob.name) IN (" + PLACEHOLDERS.map(q).join(", ") + "));");
  W("");
}

W("SELECT '--- after backfill ---' AS check;");
W('SELECT b.name AS brand, count(*) AS products FROM "Product" p JOIN "Brand" b ON b.id = p."brandId" GROUP BY b.name ORDER BY 2 DESC LIMIT 15;');
W("");
W("COMMIT;");
process.stdout.write(out.join("\n") + "\n");
console.error("backfill rows: " + rows.length + " | inactive skipped: " + inactive);
