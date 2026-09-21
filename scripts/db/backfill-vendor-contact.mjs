// Copy each vendor's VendorContact onto the Vendor row itself.
//
//     npm run db:backfill:vendor-contact
//
// Plan 2109 R28, step 1 (Q17a, owner, 21 Sep 2026): a vendor has ONE contact, held on `Vendor`
// (`contactPerson`, `contactDesignation`, plus the existing `phone`, `email`, `whatsappNumber`).
// The `VendorContact` table stays until a later release drops it (rule 7). Run this after
// migration `20260921141632_vendor_contact_fields` is applied to the database `.env` points at.
//
// WHAT IT DOES, per vendor that has at least one VendorContact
// ------------------------------------------------------------
// - picks the contact marked `isPrimary`, else the OLDEST (`createdAt`, then id);
// - sets `contactPerson` / `contactDesignation` from it, only where the Vendor field is empty;
// - fills `phone` / `email` / `whatsappNumber` from it ONLY where the Vendor field is empty.
//   A value already on the Vendor is never overwritten.
//
// IDEMPOTENT: every write is "only where empty", so a second run finds nothing to change.
//
// It then prints every vendor with MORE THAN ONE contact — what dropping the table would lose —
// so the owner can decide before the later release drops `VendorContact`.
//
// Prints the host and database only, never the URL (it carries the password).

import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

function fail(message) {
  console.error(`db:backfill:vendor-contact: ${message}`);
  process.exit(1);
}

// ── The connection, read the way snapshot.mjs / wipe-categories.mjs read it ──────────────────
let env;
try {
  env = readFileSync(".env", "utf8");
} catch {
  fail(".env not found — run this from the project root.");
}
// `^KEY=` only: a commented-out line is not the active database.
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
console.log(`\ntarget: ${dbName} at ${parsed.hostname}:${parsed.port || 5432}\n`);

const prisma = new PrismaClient({ datasourceUrl: url });

const empty = (v) => v == null || String(v).trim() === "";
const clean = (v) => (empty(v) ? null : String(v).trim());

async function main() {
  // Two queries, no N+1: every vendor that has a contact, with all its contacts.
  const vendors = await prisma.vendor.findMany({
    where: { contacts: { some: {} } },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      whatsappNumber: true,
      contactPerson: true,
      contactDesignation: true,
      contacts: {
        orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }, { id: "asc" }],
        select: { id: true, name: true, designation: true, phone: true, email: true, whatsapp: true, isPrimary: true },
      },
    },
  });
  const totalVendors = await prisma.vendor.count();
  const totalContacts = vendors.reduce((n, v) => n + v.contacts.length, 0);

  let updated = 0;
  const fieldCounts = { contactPerson: 0, contactDesignation: 0, phone: 0, email: 0, whatsappNumber: 0 };

  for (const v of vendors) {
    const c = v.contacts[0]; // primary first, else oldest (orderBy above)
    const data = {};
    if (empty(v.contactPerson) && clean(c.name)) data.contactPerson = clean(c.name);
    if (empty(v.contactDesignation) && clean(c.designation)) data.contactDesignation = clean(c.designation);
    if (empty(v.phone) && clean(c.phone)) data.phone = clean(c.phone);
    if (empty(v.email) && clean(c.email)) data.email = clean(c.email);
    if (empty(v.whatsappNumber) && clean(c.whatsapp)) data.whatsappNumber = clean(c.whatsapp);

    const keys = Object.keys(data);
    if (keys.length === 0) continue;
    await prisma.vendor.update({ where: { id: v.id }, data });
    updated++;
    for (const k of keys) fieldCounts[k]++;
    console.log(`  updated  ${v.name}  (${keys.join(", ")})  <- ${c.isPrimary ? "primary" : "oldest"} contact "${c.name}"`);
  }

  console.log(
    `\n${totalVendors} vendors, ${vendors.length} with contacts, ${totalContacts} contact rows.` +
      `\n${updated} vendor(s) updated; fields filled: ` +
      Object.entries(fieldCounts).map(([k, n]) => `${k} ${n}`).join(", ") +
      (updated === 0 ? "\n(nothing to change — already backfilled, or nothing to copy)" : "")
  );

  const multi = vendors.filter((v) => v.contacts.length > 1);
  console.log(`\nVendors with MORE THAN ONE contact (${multi.length}) — only the first is kept on Vendor:`);
  if (multi.length === 0) console.log("  none");
  for (const v of multi) {
    console.log(`  ${v.name}  (${v.contacts.length} contacts)`);
    v.contacts.forEach((c, i) => {
      const bits = [c.designation, c.phone, c.email, c.whatsapp && c.whatsapp !== c.phone ? `wa ${c.whatsapp}` : null]
        .filter(Boolean)
        .join(" · ");
      console.log(`    ${i === 0 ? "kept   " : "dropped"}  ${c.name}${c.isPrimary ? " [primary]" : ""}${bits ? `  — ${bits}` : ""}`);
    });
  }
}

main()
  .catch((e) => {
    console.error(`db:backfill:vendor-contact: failed — ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
