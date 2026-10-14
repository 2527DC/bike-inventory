import { Prisma, type Vendor } from "@prisma/client";
import { prisma } from "@/lib/db";
import { createLogger } from "@/lib/logger";
import { toPlus91 } from "@/lib/phone";
import type { IntegrationContact } from "@/lib/integrations";
import { vendorCodeFor, randomCodeSuffix } from "./code";
import { isAutomatic, matchOne, normaliseGstin, normaliseName } from "./zoho-match";
import { linkVendorToZoho, listVendorsForMatching } from "./zoho-link";

const log = createLogger("vendors:zoho-resolve");

/** What the bill preview carries about its vendor (written by api/zoho/trigger-pull). */
export interface BillVendorRef {
  billNo: string;
  vendorName: string;
  /** Zoho's `vendor_id`. Absent only on a preview fetched before plan 2409 shipped. */
  vendorId: string | null;
  /** Which client fetched the bill — "books" or "pos" (Zakya). Decides who reads the contact. */
  vendorSource: string | null;
  /** Who is approving — named in the activity log when the approval links an existing vendor. */
  actor: { id: string; name: string };
}

export interface ResolvedVendor {
  vendor: Vendor;
  /** Something the import did that a person should know about (goes to `results.notices`). */
  notice?: string;
}

/**
 * The bill import's vendor, by Zoho vendor id (plan 2409-zoho-vendor-id-on-bill-import).
 *
 *   1. A Vendor already carries this `zohoVendorId` → that vendor, as-is. Its details are
 *      NOT refreshed from Zoho: they are copied once, at creation (owner, Q4).
 *   2. Otherwise → read the contact from Zoho once. If an app vendor with no Zoho id has the
 *      contact's GSTIN (plan 1410-link-vendors-to-zoho, R4) → save the id on it and use it.
 *   3. Otherwise → create the Vendor with the id and its GSTIN, PAN, address, phone, email,
 *      contact person and payment terms.
 *
 * Plan 2409's comment here said "vendors were wiped on 24 Sep 2026, so no vendor exists that
 * predates the id". Production says otherwise: on 14 Oct 2026 all 83 vendors predated it and none
 * was linked, so every bill from an existing vendor failed on the name. Step 2 links them by
 * GSTIN. A name alone still never links (the intent of R4): a vendor that matches only by name,
 * or whose GSTIN is shared by several app vendors, stops the bill with a sentence pointing to the
 * Link step on /vendors, where a person chooses. A same-name vendor carrying a different id is two
 * Zoho vendors that the app cannot merge, and the bill fails with a sentence saying so.
 *
 * A preview with no `vendorId` (fetched before this shipped) fails rather than falling back
 * to a name match — every such preview was deleted on 24 Sep, so a fresh fetch fixes it.
 */
export async function resolveBillVendor(ref: BillVendorRef): Promise<ResolvedVendor> {
  const { billNo, vendorName, vendorId, vendorSource, actor } = ref;

  if (!vendorId) {
    log.error("bill preview carries no Zoho vendor id", { billNo });
    throw new Error(`Bill ${billNo} has no Zoho vendor id — reject this pull and fetch the bills again`);
  }

  const existing = await prisma.vendor.findUnique({ where: { zohoVendorId: vendorId } });
  if (existing) {
    log.debug("vendor resolved by Zoho id", { vendorId: existing.id, zohoVendorId: vendorId, billNo });
    return { vendor: existing };
  }

  // ── Not seen before: read its details from Zoho, once ──
  let contact: IntegrationContact | null = null;
  let notice: string | undefined;
  try {
    contact = await fetchContact(vendorId, vendorSource);
  } catch (e) {
    // A Books bill then stops below (no GSTIN to match on); a Zakya bill's vendor is created with
    // its name and id only, as before.
    log.warn("Zoho contact read failed", {
      zohoVendorId: vendorId,
      billNo,
      source: vendorSource,
      error: e instanceof Error ? e.message : String(e),
    });
  }

  // ── An existing app vendor this Zoho vendor already is? Found by GSTIN (plan 1410, C1) ──
  // Books bills only. A Zakya (POS) bill carries Zakya's contact id, a separate id space: linking a
  // vendor to it would leave the vendor unlinkable to its Books id, and every later Books bill would
  // fail. A Zakya bill's vendor keeps the plan 2409 path below.
  if (vendorSource !== "pos") {
    if (!contact) {
      // Without the contact there is no GSTIN to find the existing vendor by. Creating a vendor
      // from the name alone would take this Zoho id and block the real vendor from ever being
      // linked — so the bill waits for a retry instead (review of 14 Oct 2026).
      log.warn("bill vendor not resolved — Zoho contact unreadable, not creating", { zohoVendorId: vendorId, billNo });
      throw new Error(
        `Could not read vendor "${vendorName}" from Zoho just now, so the app cannot tell whether it is a vendor ` +
          `already here. Check Zoho Books is connected (Settings › Integrations) and approve this bill again.`
      );
    }
    const linked = await linkExistingByGstin({ vendorId, vendorName, contact, billNo, actor });
    if (linked) return linked;
  }

  if (!contact) {
    notice = `Vendor "${vendorName}" was created without its Zoho details — fill them in on /vendors`;
  }

  const data = vendorDataFrom(vendorId, vendorName, contact);

  try {
    const vendor = await prisma.vendor.create({ data });
    log.info("vendor created from Zoho", {
      vendorId: vendor.id,
      zohoVendorId: vendorId,
      billNo,
      withDetails: !!contact,
    });
    return { vendor, notice };
  } catch (e) {
    if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== "P2002") {
      log.error("vendor create failed", { zohoVendorId: vendorId, billNo, error: e instanceof Error ? e.message : String(e) });
      throw e;
    }
    const target = String(e.meta?.target ?? "");

    // A parallel approve created this vendor first — use it rather than failing the bill.
    if (target.includes("zohoVendorId")) {
      const raced = await prisma.vendor.findUnique({ where: { zohoVendorId: vendorId } });
      if (raced) {
        log.warn("vendor create raced — using the row created concurrently", { vendorId: raced.id, zohoVendorId: vendorId });
        return { vendor: raced, notice };
      }
    }

    // `code` is the name's first 6 alphanumerics + the last 4 digits of epoch-ms, which repeat
    // every 10 s — so two vendors with the same prefix can collide at any time. One retry with
    // a random suffix.
    if (target.includes("code")) {
      log.warn("vendor code collided — retrying with a new code", { zohoVendorId: vendorId, billNo });
      const vendor = await prisma.vendor.create({ data: { ...data, code: vendorCodeFor(data.name, randomCodeSuffix()) } });
      return { vendor, notice };
    }

    if (target.includes("name")) {
      const clash = await prisma.vendor.findUnique({ where: { name: data.name }, select: { id: true, zohoVendorId: true } });
      // Two different causes, two different fixes — the message must say which.
      if (clash && !clash.zohoVendorId) {
        // Reached only when the matcher above found no name match — Zoho's contact name differs
        // from the bill's in case or spacing only, or the vendor appeared since. Renaming would
        // create a duplicate, so the message points to the Link step instead (plan 1410, C2).
        log.error("vendor name taken by a vendor not linked to Zoho", { zohoVendorId: vendorId, existingVendorId: clash.id, billNo });
        throw new Error(
          `Vendor "${data.name}" already exists in the app but is not linked to Zoho. Link it on ` +
            `/vendors ▸ Import from Zoho, then approve this bill again.`
        );
      }
      log.error("vendor name already belongs to a different Zoho vendor", {
        zohoVendorId: vendorId,
        existingVendorId: clash?.id,
        existingZohoVendorId: clash?.zohoVendorId,
        billNo,
      });
      throw new Error(
        `Vendor "${data.name}" already exists in the app with a different Zoho vendor id — ` +
          `two Zoho vendors share this name. Rename one of them in Zoho and fetch again.`
      );
    }

    log.error("vendor create hit an unexpected unique constraint", { zohoVendorId: vendorId, billNo, target });
    throw e;
  }
}

/**
 * Step 2 of `resolveBillVendor` (plan 1410-link-vendors-to-zoho, C1): is this Zoho vendor one the
 * app already has? `matchOne` against every vendor here — the matcher the Link step on /vendors
 * uses. Returns the vendor when the GSTIN decides (it is linked now), null when nothing here
 * matches (the caller creates one, as before), and throws when a person has to choose or a
 * conflict stands — the message says what to do. It never creates a second vendor for a GSTIN
 * already here.
 */
async function linkExistingByGstin(args: {
  vendorId: string;
  vendorName: string;
  contact: IntegrationContact;
  billNo: string;
  actor: { id: string; name: string };
}): Promise<ResolvedVendor | null> {
  const { vendorId, vendorName, contact, billNo, actor } = args;
  const zohoName = clean(contact.contact_name) ?? vendorName.trim();
  const zohoGstin = normaliseGstin(contact.gst_no);
  const vendors = await listVendorsForMatching();
  const match = matchOne({ zohoId: vendorId, name: zohoName, gstin: zohoGstin }, vendors);
  log.debug("bill vendor matched", { zohoVendorId: vendorId, billNo, kind: match.kind, reason: match.reason, candidates: match.candidates.length });

  if (isAutomatic(match.kind) && match.vendorId) {
    const vendor = vendors.find((v) => v.id === match.vendorId)!;
    const result = await linkVendorToZoho({ vendor, zohoVendorId: vendorId, kind: match.kind, actor, via: `bill ${billNo}` });
    // Linked here, or by another tab a moment ago — either way the id resolves now.
    const resolved = await prisma.vendor.findUnique({ where: { zohoVendorId: vendorId } });
    if (resolved) {
      // Say what a person should look at: the bill now sits on a vendor whose name differs from
      // Zoho's, or one that is inactive (and hidden from the default /vendors list).
      const caveats = [
        normaliseName(resolved.name) !== normaliseName(zohoName) ? `named "${zohoName}" in Zoho` : null,
        resolved.isActive ? null : "inactive here",
      ].filter(Boolean);
      return {
        vendor: resolved,
        notice:
          result === "linked"
            ? `Linked existing vendor "${resolved.name}" (${resolved.code}) to Zoho by GSTIN` +
              (caveats.length ? ` — ${caveats.join(", ")}` : "")
            : undefined,
      };
    }
    log.warn("GSTIN match was linked to another Zoho vendor meanwhile", { vendorId: vendor.id, zohoVendorId: vendorId, billNo, result });
    throw new Error(
      `Vendor "${vendor.name}" was just linked to a different Zoho vendor. Check it on /vendors ▸ Import from Zoho, ` +
        `then approve this bill again.`
    );
  }

  const named = (v: { name: string; code: string }) => `"${v.name}" (${v.code})`;
  const linkThere = "Link the right one on /vendors ▸ Import from Zoho, then approve this bill again.";
  switch (match.kind) {
    case "ambiguous":
      log.warn("bill vendor needs a person to choose", { zohoVendorId: vendorId, billNo, candidates: match.candidates.length });
      throw new Error(
        `Zoho vendor "${zohoName}" could be any of ${match.candidates.length} vendors here: ` +
          `${match.candidates.map(named).join(", ")}. ${linkThere}`
      );
    case "name":
      log.warn("bill vendor matched on name only", { zohoVendorId: vendorId, billNo, existingVendorId: match.candidates[0].id });
      throw new Error(
        `Vendor ${named(match.candidates[0])} exists here but is not linked to Zoho, and the GSTIN cannot confirm it is ` +
          `the same vendor (${zohoGstin ? "the app has none" : "Zoho has none"}). Check it and link it on /vendors ▸ ` +
          `Import from Zoho, then approve this bill again.`
      );
    case "conflict":
      log.warn("bill vendor conflicts with a vendor here", { zohoVendorId: vendorId, billNo, reason: match.reason, existingVendorId: match.candidates[0]?.id });
      throw new Error(
        match.reason === "linked-elsewhere"
          ? `Vendor ${named(match.candidates[0])} here already has this ${zohoGstin && normaliseGstin(match.candidates[0].gstin) === zohoGstin ? `GSTIN (${zohoGstin})` : "name"} ` +
              `and is linked to a different Zoho vendor — Zoho seems to hold two vendors for one business. Merge them in ` +
              `Zoho, then approve this bill again.`
          : `Vendor ${named(match.candidates[0])} exists here with GSTIN ${normaliseGstin(match.candidates[0].gstin)}, but ` +
              `Zoho's "${zohoName}" has ${zohoGstin}. Check which is right, fix it, and approve this bill again.`
      );
    default:
      return null;
  }
}

/** Books ids and Zakya ids are separate spaces, so the contact is read from the same provider. */
async function fetchContact(contactId: string, source: string | null): Promise<IntegrationContact | null> {
  const { getBooks, getZakya } = await import("@/lib/integrations");
  const client = source === "pos" ? await getZakya() : await getBooks();
  if (!client) {
    log.warn("no Zoho client for contact read", { zohoVendorId: contactId, source });
    return null;
  }
  log.debug("-> GET contact", { zohoVendorId: contactId, source });
  const res = await client.getContact(contactId);
  return res.contact ?? null;
}

function clean(v: string | null | undefined): string | null {
  const t = (v ?? "").trim();
  return t ? t : null;
}

/**
 * A Zoho contact → the Vendor row we create from it. Exported so the "Import vendors from
 * Zoho" route (plan 2409-zoho-vendor-sync, Part A) writes exactly the same fields a bill
 * import does — one mapping, not two that drift.
 */
export function vendorDataFrom(
  zohoVendorId: string,
  billVendorName: string,
  c: IntegrationContact | null
): Prisma.VendorCreateInput {
  const name = clean(c?.contact_name) ?? billVendorName.trim();
  const base: Prisma.VendorCreateInput = { name, code: vendorCodeFor(name), zohoVendorId };
  if (!c) return base;

  const person = c.contact_persons?.find((p) => p.is_primary_contact) ?? c.contact_persons?.[0];
  // Zoho often leaves the top-level phone/email empty and keeps them on the contact person.
  const rawPhone = clean(c.mobile) ?? clean(c.phone) ?? clean(person?.mobile) ?? clean(person?.phone);
  const personName = clean([person?.first_name, person?.last_name].filter(Boolean).join(" "));
  const addr = c.billing_address;

  return {
    ...base,
    gstin: clean(c.gst_no)?.toUpperCase() ?? null,
    pan: clean(c.pan_no)?.toUpperCase() ?? null,
    addressLine1: clean(addr?.address),
    addressLine2: clean(addr?.street2),
    city: clean(addr?.city),
    state: clean(addr?.state),
    pincode: clean(addr?.zip),
    phone: rawPhone ? toPlus91(rawPhone) ?? rawPhone : null,
    email: clean(c.email) ?? clean(person?.email),
    contactPerson: personName,
    contactDesignation: clean(person?.designation),
    ...(typeof c.payment_terms === "number" && c.payment_terms > 0 ? { paymentTermDays: c.payment_terms } : {}),
  };
}
