import { Prisma, type Vendor } from "@prisma/client";
import { prisma } from "@/lib/db";
import { createLogger } from "@/lib/logger";
import { toPlus91 } from "@/lib/phone";
import type { IntegrationContact } from "@/lib/integrations";
import { vendorCodeFor, randomCodeSuffix } from "./code";

const log = createLogger("vendors:zoho-resolve");

/** What the bill preview carries about its vendor (written by api/zoho/trigger-pull). */
export interface BillVendorRef {
  billNo: string;
  vendorName: string;
  /** Zoho's `vendor_id`. Absent only on a preview fetched before plan 2409 shipped. */
  vendorId: string | null;
  /** Which client fetched the bill — "books" or "pos" (Zakya). Decides who reads the contact. */
  vendorSource: string | null;
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
 *   2. Otherwise → read the contact from Zoho once and create the Vendor with the id and its
 *      GSTIN, PAN, address, phone, email, contact person and payment terms.
 *
 * There is deliberately NO name match (owner, R4). Vendors were wiped on 24 Sep 2026, so no
 * vendor exists that predates the id. A same-name vendor carrying a different id is two Zoho
 * vendors that the app cannot merge, and the bill fails with a sentence saying so.
 *
 * A preview with no `vendorId` (fetched before this shipped) fails rather than falling back
 * to a name match — every such preview was deleted on 24 Sep, so a fresh fetch fixes it.
 */
export async function resolveBillVendor(ref: BillVendorRef): Promise<ResolvedVendor> {
  const { billNo, vendorName, vendorId, vendorSource } = ref;

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
    log.warn("Zoho contact read failed — creating vendor with name and id only", {
      zohoVendorId: vendorId,
      billNo,
      error: e instanceof Error ? e.message : String(e),
    });
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
        log.error("vendor name taken by a vendor not linked to Zoho", { zohoVendorId: vendorId, existingVendorId: clash.id, billNo });
        throw new Error(
          `Vendor "${data.name}" already exists in the app but is not linked to Zoho (it was added by hand ` +
            `or from an inbound issue). Rename it on /vendors and approve this bill again.`
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
