/*
 * Generate ONE self-contained SQL file that seeds Category, Brand and Product from the Zoho
 * item export, with the real brand and category on every product.
 *
 *   node scripts/gen-catalog-sql.js prisma/data/Item.xls > prisma/data/catalog.sql
 *
 * Differs from `scripts/import-products.ts` on purpose: that script forces every row to
 * "Unbranded"/"Uncategorized" (FORCE_DEFAULT_BRAND). This one keeps the sheet's real Brand
 * and Category Name, which is the whole point.
 *
 * Rules carried over from that script, unchanged:
 *   - Status must be "Active" (case-insensitive). Inactive rows are dropped outright.
 *   - `Product Name` is the name, NOT `Item Name`.
 *   - Deduped on `Item ID`, first wins (the export repeats 37 ids on adjacent rows).
 *   - currentStock 0 and NO StockLevel rows — quantities come from a stock audit.
 *
 * Ids are deterministic (derived from the Zoho id or from the name), so the file is
 * re-runnable: every statement is ON CONFLICT DO UPDATE / DO NOTHING and running it twice
 * changes nothing the second time.
 *
 * Zoho brand_id / category_id are attached where `zoho-brands.json` and
 * `zoho-categories.json` are present next to the sheet or in the repo root.
 */

const XLSX = require("xlsx");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const COL = {
  name: "Product Name",
  zohoId: "Item ID",
  sku: "SKU",
  sellingPrice: "Selling Price",
  costPrice: "Purchase Price",
  brand: "Brand",
  category: "Category Name",
  hsn: "HSN/SAC",
  gstRate: "Intra State Tax Rate",
  status: "Status",
};

const ACTIVE_STATUS = "active";
const DEFAULT_BRAND = "Unbranded";
const DEFAULT_CATEGORY = "Uncategorized";

const file = process.argv[2];
if (!file) {
  console.error("usage: node scripts/gen-catalog-sql.js <Item.xls> [> out.sql]");
  process.exit(1);
}

const str = (v) => String(v ?? "").trim();
const money = (v) => {
  const n = Number(str(v).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
/** Postgres string literal, single quotes doubled. */
const q = (v) => (v === null || v === undefined ? "NULL" : "'" + String(v).replace(/'/g, "''") + "'");
/** Stable 24-char id from a namespace + key, so the file is re-runnable. */
const id = (ns, key) => ns + crypto.createHash("sha1").update(ns + ":" + key).digest("hex").slice(0, 21);

// ─── Optional Zoho masters, for the zohoBrandId / zohoCategoryId columns ─────────────────

function loadJson(names) {
  for (const n of names) {
    for (const dir of [path.dirname(file), process.cwd(), path.join(process.cwd(), "prisma", "data")]) {
      const p = path.join(dir, n);
      if (fs.existsSync(p)) {
        try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { /* keep looking */ }
      }
    }
  }
  return null;
}

const zBrands = loadJson(["zoho-brands.json"]);
const zCats = loadJson(["zoho-categories.json"]);

const zBrandIdByName = new Map();
if (zBrands && zBrands.brands) for (const b of zBrands.brands) zBrandIdByName.set(b.name.trim().toLowerCase(), b.brand_id);

const zCatByName = new Map();
const zCatById = new Map();
if (zCats && zCats.categories) {
  for (const c of zCats.categories) {
    if (c.category_id === "-1") continue;
    zCatByName.set(c.name.trim().toLowerCase(), c);
    zCatById.set(c.category_id, c);
  }
}

// ─── Read the sheet ──────────────────────────────────────────────────────────────────────

const wb = XLSX.readFile(path.resolve(file));
const sheet = wb.Sheets[wb.SheetNames[0]];
const raw = XLSX.utils.sheet_to_json(sheet, { defval: "" });

const headers = Object.keys(raw[0] || {});
const missing = Object.values(COL).filter((c) => !headers.includes(c));
if (missing.length) {
  console.error("missing column(s): " + missing.join(", "));
  console.error("file has: " + headers.join(", "));
  process.exit(1);
}

const stats = { rows: raw.length, noId: 0, dupes: 0, inactive: 0, noSku: 0, kept: 0 };
const byZohoId = new Map();

for (const r of raw) {
  if (str(r[COL.status]).toLowerCase() !== ACTIVE_STATUS) { stats.inactive++; continue; }
  const zid = str(r[COL.zohoId]);
  if (!zid) { stats.noId++; continue; }
  if (byZohoId.has(zid)) { stats.dupes++; continue; }
  byZohoId.set(zid, r);
}

const rows = [...byZohoId.values()];

// SKU is @unique on Product. Keep the first row for a SKU and drop later collisions rather
// than letting the INSERT fail halfway through the file.
const seenSku = new Set();
const kept = [];
for (const r of rows) {
  const sku = str(r[COL.sku]);
  if (!sku || seenSku.has(sku)) { stats.noSku++; continue; }
  seenSku.add(sku);
  kept.push(r);
}
stats.kept = kept.length;

// ─── Collect the taxonomy actually used by the kept rows ─────────────────────────────────

const brandNames = new Set([DEFAULT_BRAND]);
const catNames = new Set([DEFAULT_CATEGORY]);
for (const r of kept) {
  brandNames.add(str(r[COL.brand]) || DEFAULT_BRAND);
  catNames.add(str(r[COL.category]) || DEFAULT_CATEGORY);
}

// Pull in every Zoho parent of a used category, so the tree is not left dangling.
const catsToEmit = new Map(); // lowerName -> { name, zohoId, parentZohoId }
for (const name of catNames) {
  const z = zCatByName.get(name.toLowerCase());
  catsToEmit.set(name.toLowerCase(), {
    name,
    zohoId: z ? z.category_id : null,
    parentZohoId: z && z.parent_category_id !== "-1" ? z.parent_category_id : null,
  });
}
let added = true;
while (added) {
  added = false;
  for (const c of [...catsToEmit.values()]) {
    if (!c.parentZohoId) continue;
    const p = zCatById.get(c.parentZohoId);
    if (!p) continue;
    if (!catsToEmit.has(p.name.trim().toLowerCase())) {
      catsToEmit.set(p.name.trim().toLowerCase(), {
        name: p.name.trim(),
        zohoId: p.category_id,
        parentZohoId: p.parent_category_id !== "-1" ? p.parent_category_id : null,
      });
      added = true;
    }
  }
}

const brandId = (name) => id("br", name.toLowerCase());
const catId = (name) => id("ct", name.toLowerCase());

// ─── Emit ────────────────────────────────────────────────────────────────────────────────

const out = [];
const W = (s) => out.push(s);

W("--");
W("-- Catalog seed: Category, Brand, Product — generated from " + path.basename(file));
W("-- generated " + new Date().toISOString());
W("--");
W("-- Source rows " + stats.rows + " | inactive dropped " + stats.inactive + " | no Item ID " + stats.noId);
W("--   duplicate Item ID " + stats.dupes + " | blank/duplicate SKU " + stats.noSku + " | INSERTED " + stats.kept);
W("-- Brands " + brandNames.size + " (" + [...brandNames].filter(n => zBrandIdByName.has(n.toLowerCase())).length + " matched to a Zoho brand_id)");
W("-- Categories " + catsToEmit.size + " (" + [...catsToEmit.values()].filter(c => c.zohoId).length + " matched to a Zoho category_id)");
W("--");
W("-- Re-runnable: deterministic ids + ON CONFLICT. Running twice changes nothing.");
W("-- Deliberately NOT written: StockLevel rows. currentStock stays 0 — quantities come");
W("-- from a stock audit, not from this file.");
W("--");
W("");
W("BEGIN;");
W("");
W("-- ── Zoho id columns (additive, safe to re-run) ─────────────────────────────────────");
W('ALTER TABLE "Brand"    ADD COLUMN IF NOT EXISTS "zohoBrandId"    TEXT;');
W('ALTER TABLE "Category" ADD COLUMN IF NOT EXISTS "zohoCategoryId" TEXT;');
W('CREATE UNIQUE INDEX IF NOT EXISTS "Brand_zohoBrandId_key"       ON "Brand"("zohoBrandId");');
W('CREATE UNIQUE INDEX IF NOT EXISTS "Category_zohoCategoryId_key" ON "Category"("zohoCategoryId");');
W("");

W("-- ── Categories ────────────────────────────────────────────────────────────────────");
W("-- Pass 1: every category flat, parentId left NULL (self-FK cannot be satisfied yet).");
for (const c of catsToEmit.values()) {
  W(
    'INSERT INTO "Category" (id, name, description, "parentId", "reorderLevel", "zohoCategoryId", "createdAt", "updatedAt") VALUES (' +
      [q(catId(c.name)), q(c.name), q("From Zoho item export"), "NULL", "0", q(c.zohoId), "now()", "now()"].join(", ") +
      ") ON CONFLICT (name) DO UPDATE SET \"zohoCategoryId\" = COALESCE(\"Category\".\"zohoCategoryId\", EXCLUDED.\"zohoCategoryId\"), \"updatedAt\" = now();"
  );
}
W("");
W("-- Pass 2: resolve the parent tree through the Zoho ids.");
for (const c of catsToEmit.values()) {
  if (!c.parentZohoId || !c.zohoId) continue;
  W(
    'UPDATE "Category" c SET "parentId" = p.id, "updatedAt" = now() FROM "Category" p ' +
      'WHERE p."zohoCategoryId" = ' + q(c.parentZohoId) + ' AND c."zohoCategoryId" = ' + q(c.zohoId) + ' AND c."parentId" IS DISTINCT FROM p.id;'
  );
}
W("");

W("-- ── Brands ────────────────────────────────────────────────────────────────────────");
W("-- A brand that already exists by name is ADOPTED (its zohoBrandId is filled in), never");
W("-- duplicated. Local-only fields (contact, leadDays) are never overwritten.");
for (const name of [...brandNames].sort()) {
  const zid = zBrandIdByName.get(name.toLowerCase()) || null;
  W(
    'INSERT INTO "Brand" (id, name, "zohoBrandId", "leadDays", "createdAt", "updatedAt") VALUES (' +
      [q(brandId(name)), q(name), q(zid), "7", "now()", "now()"].join(", ") +
      ") ON CONFLICT (name) DO UPDATE SET \"zohoBrandId\" = COALESCE(\"Brand\".\"zohoBrandId\", EXCLUDED.\"zohoBrandId\"), \"updatedAt\" = now();"
  );
}
W("");

W("-- ── Products ──────────────────────────────────────────────────────────────────────");
W("-- brandId / categoryId are resolved by NAME through the two blocks above, so a brand");
W("-- that already existed here keeps its original id and its products attach to it.");
for (const r of kept) {
  const bname = str(r[COL.brand]) || DEFAULT_BRAND;
  const cname = str(r[COL.category]) || DEFAULT_CATEGORY;
  const selling = money(r[COL.sellingPrice]);
  const gst = Number(str(r[COL.gstRate])) || 18;
  const hsn = str(r[COL.hsn]) || null;
  W(
    'INSERT INTO "Product" (id, sku, name, "zohoItemId", "categoryId", "brandId", status, condition, "costPrice", "sellingPrice", mrp, "gstRate", "hsnCode", "currentStock", "reservedStock", "minStock", "maxStock", "reorderLevel", "reorderQty", "imageUrls", tags, "createdAt", "updatedAt") ' +
      "SELECT " +
      [
        q(id("pr", str(r[COL.zohoId]))),
        q(str(r[COL.sku])),
        q(str(r[COL.name])),
        q(str(r[COL.zohoId])),
        "c.id",
        "b.id",
        "'ACTIVE'",
        "'NEW'",
        String(money(r[COL.costPrice])),
        String(selling),
        String(selling),
        String(gst),
        q(hsn),
        "0", "0", "0", "0", "0", "0",
        "'{}'", "'{}'",
        "now()", "now()",
      ].join(", ") +
      ' FROM "Category" c, "Brand" b WHERE c.name = ' + q(cname) + " AND b.name = " + q(bname) +
      ' ON CONFLICT (sku) DO NOTHING;'
  );
}
W("");
W("COMMIT;");
W("");

process.stdout.write(out.join("\n"));

console.error(
  "rows " + stats.rows +
  " | inactive " + stats.inactive +
  " | noId " + stats.noId +
  " | dupId " + stats.dupes +
  " | badSku " + stats.noSku +
  " | INSERTED " + stats.kept +
  " | brands " + brandNames.size +
  " | categories " + catsToEmit.size
);
