#!/usr/bin/env node
/**
 * One-time migration: copy every media file referenced in the DB from Supabase Storage
 * to Cloudflare R2, then rewrite the stored URLs to the R2 public URL.
 *
 * Dry-run by default (prints what it would do). Run with --apply to execute.
 *
 *   node scripts/migrate-media-to-r2.js            # dry run
 *   node scripts/migrate-media-to-r2.js --apply    # copy files + rewrite DB urls
 *
 * Needs in .env: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET,
 * R2_PUBLIC_BASE_URL, NEXT_PUBLIC_SUPABASE_URL. Also applies a CORS policy to the
 * bucket so browser presigned uploads work (idempotent).
 *
 * Safe to re-run: already-migrated URLs (non-Supabase) are skipped, and copying the
 * same file twice just overwrites the identical object.
 *
 * NOTE: downloading the old files counts as Supabase egress — if the project is still
 * frozen for exceeding the egress quota, downloads will fail; run this after the plan
 * is upgraded (or the quota has reset). Failures are listed at the end and the DB row
 * is left untouched, so nothing breaks mid-way.
 */
require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const { AwsClient } = require("aws4fetch");

const APPLY = process.argv.includes("--apply");
const ONE_YEAR = "public, max-age=31536000, immutable";

const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_BASE_URL, NEXT_PUBLIC_SUPABASE_URL } = process.env;
for (const [k, v] of Object.entries({ R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_BASE_URL, NEXT_PUBLIC_SUPABASE_URL })) {
  if (!v) { console.error(`Missing ${k} in .env`); process.exit(1); }
}

const supabaseHost = new URL(NEXT_PUBLIC_SUPABASE_URL).host;
const prisma = new PrismaClient();
const r2 = new AwsClient({ accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY, service: "s3", region: "auto" });

const bucketUrl = (key = "") =>
  `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${R2_BUCKET}${key ? "/" + key.split("/").map(encodeURIComponent).join("/") : ""}`;
const publicUrl = (key) => `${R2_PUBLIC_BASE_URL.replace(/\/+$/, "")}/${key.split("/").map(encodeURIComponent).join("/")}`;

function isSupabaseUrl(u) {
  try { return new URL(u).host === supabaseHost; } catch { return false; }
}

// ".../storage/v1/object/public/product images/vendor-issues/123-abc.jpg" -> "vendor-issues/123-abc.jpg"
function keyFromSupabaseUrl(u) {
  const path = decodeURIComponent(new URL(u).pathname);
  const m = path.match(/\/object\/(?:public\/)?[^/]+\/(.+)$/);
  return m ? m[1] : null;
}

async function applyCors() {
  const cors = `<?xml version="1.0" encoding="UTF-8"?>
<CORSConfiguration><CORSRule>
  <AllowedOrigin>*</AllowedOrigin>
  <AllowedMethod>GET</AllowedMethod><AllowedMethod>PUT</AllowedMethod><AllowedMethod>HEAD</AllowedMethod>
  <AllowedHeader>*</AllowedHeader>
  <MaxAgeSeconds>86400</MaxAgeSeconds>
</CORSRule></CORSConfiguration>`;
  const res = await r2.fetch(`${bucketUrl()}?cors`, { method: "PUT", headers: { "Content-Type": "application/xml" }, body: cors });
  if (!res.ok) throw new Error(`CORS setup failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  console.log("✔ Bucket CORS policy applied (browser uploads allowed)");
}

const migrated = new Map(); // old url -> new url (dedupe across rows)
const failures = [];
let copied = 0;

async function migrateUrl(oldUrl) {
  if (!isSupabaseUrl(oldUrl)) return oldUrl; // already migrated / external (e.g. Zoho)
  if (migrated.has(oldUrl)) return migrated.get(oldUrl);
  const key = keyFromSupabaseUrl(oldUrl);
  if (!key) { failures.push({ url: oldUrl, reason: "unrecognized supabase path" }); return oldUrl; }
  if (!APPLY) { migrated.set(oldUrl, publicUrl(key)); copied++; return publicUrl(key); }
  try {
    const dl = await fetch(oldUrl);
    if (!dl.ok) throw new Error(`download ${dl.status}`);
    const body = Buffer.from(await dl.arrayBuffer());
    const contentType = dl.headers.get("content-type") || "application/octet-stream";
    const up = await r2.fetch(bucketUrl(key), {
      method: "PUT",
      headers: { "Content-Type": contentType, "Cache-Control": ONE_YEAR },
      body,
    });
    if (!up.ok) throw new Error(`upload ${up.status}`);
    const newUrl = publicUrl(key);
    migrated.set(oldUrl, newUrl);
    copied++;
    console.log(`  copied ${key} (${(body.length / 1024).toFixed(0)} KB)`);
    return newUrl;
  } catch (e) {
    failures.push({ url: oldUrl, reason: e.message });
    return oldUrl; // leave the row pointing at supabase; re-run later
  }
}

async function migrateArrayField(rows, model, field) {
  for (const row of rows) {
    const urls = row[field] || [];
    if (!urls.some(isSupabaseUrl)) continue;
    const newUrls = [];
    for (const u of urls) newUrls.push(await migrateUrl(u));
    if (JSON.stringify(newUrls) !== JSON.stringify(urls)) {
      console.log(`${APPLY ? "UPDATE" : "would update"} ${model}.${field} ${row.id}`);
      if (APPLY) await prisma[model].update({ where: { id: row.id }, data: { [field]: newUrls } });
    }
  }
}

async function main() {
  console.log(APPLY ? "APPLY mode — copying files and rewriting URLs\n" : "DRY RUN — pass --apply to execute\n");
  if (APPLY) {
    // Needs an Admin-level token; the safer Object-only token gets a 403 here. Not fatal —
    // CORS only affects browser presigned uploads and can be set once in the dashboard.
    try { await applyCors(); } catch (e) { console.warn(`⚠ Skipping CORS setup (${e.message.slice(0, 80)}) — set it in the dashboard: bucket → Settings → CORS Policy`); }
  }

  await migrateArrayField(await prisma.vendorIssue.findMany({ select: { id: true, photoUrls: true } }), "vendorIssue", "photoUrls");
  await migrateArrayField(await prisma.product.findMany({ select: { id: true, imageUrls: true } }), "product", "imageUrls");

  for (const row of await prisma.secondHandCycle.findMany({ select: { id: true, photoUrl: true, photoUrls: true } })) {
    const newPrimary = await migrateUrl(row.photoUrl);
    const newAll = [];
    for (const u of row.photoUrls || []) newAll.push(await migrateUrl(u));
    if (newPrimary !== row.photoUrl || JSON.stringify(newAll) !== JSON.stringify(row.photoUrls)) {
      console.log(`${APPLY ? "UPDATE" : "would update"} secondHandCycle ${row.id}`);
      if (APPLY) await prisma.secondHandCycle.update({ where: { id: row.id }, data: { photoUrl: newPrimary, photoUrls: newAll } });
    }
  }

  for (const row of await prisma.expense.findMany({ where: { receiptUrl: { not: null } }, select: { id: true, receiptUrl: true } })) {
    const newUrl = await migrateUrl(row.receiptUrl);
    if (newUrl !== row.receiptUrl) {
      console.log(`${APPLY ? "UPDATE" : "would update"} expense.receiptUrl ${row.id}`);
      if (APPLY) await prisma.expense.update({ where: { id: row.id }, data: { receiptUrl: newUrl } });
    }
  }

  console.log(`\n${APPLY ? "Copied" : "Would copy"} ${copied} file(s).`);
  if (failures.length) {
    console.log(`\n${failures.length} failure(s) — rows left pointing at Supabase; fix the cause and re-run:`);
    for (const f of failures) console.log(`  ${f.reason}: ${f.url}`);
    process.exitCode = 2;
  } else {
    console.log("No failures.");
  }
}

main().finally(() => prisma.$disconnect());
