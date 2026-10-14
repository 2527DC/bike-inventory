export const dynamic = "force-dynamic";
// One read of Zoho's vendor list (200 per page) plus at most MAX_LINKS small writes.
export const maxDuration = 60;

import { NextRequest } from "next/server";
import { z } from "zod";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { getBooks } from "@/lib/integrations";
import { createLogger } from "@/lib/logger";
import { matchAll, normaliseGstin, pairAllowed } from "@/lib/vendors/zoho-match";
import { linkVendorToZoho, listVendorsForMatching } from "@/lib/vendors/zoho-link";

const log = createLogger("vendors:zoho-link");

/** Must not be below the sheet's LINK_BATCH. */
const MAX_LINKS = 50;

const linkSchema = z.object({
  links: z
    .array(z.object({ zohoId: z.string().min(1), vendorId: z.string().min(1) }))
    .min(1, "Choose at least one vendor to link")
    .max(MAX_LINKS, `At most ${MAX_LINKS} per request`),
});

type Outcome =
  | { zohoId: string; vendorId: string; result: "linked" }
  | { zohoId: string; vendorId: string; result: "skipped"; reason: string };

/**
 * POST /api/vendors/zoho-link — save Zoho vendor ids on vendors that are already here (plan
 * 1410-link-vendors-to-zoho, B2). Writes `zohoVendorId` and nothing else (R5).
 *
 * The screen's ticks are not trusted: Zoho's vendor list is read again and every pair is re-checked
 * with the same matcher the preview used — the vendor still has no Zoho id, no vendor has this Zoho
 * id, and the matcher still pairs them (by GSTIN, a ticked name match, or one of an ambiguous row's
 * candidates). Each link is its own guarded write (`linkVendorToZoho`), so one refusal does not
 * undo the others, and a second tab cannot double-link.
 */
export async function POST(req: NextRequest) {
  try {
    // vendors.fetch — the tick that runs this sheet's preview and import (plan 1410-link, Q1).
    const user = await requireFeature("vendors", "fetch");

    const body = await req.json().catch((e: unknown) => {
      log.warn("link request body is not JSON", { error: e instanceof Error ? e.message : String(e) });
      return null;
    });
    if (!body) return errorResponse("Send the vendors to link as JSON: { links: [{ zohoId, vendorId }] }", 400);
    const parsed = linkSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse(parsed.error.issues[0]?.message ?? "Invalid link request", 400);
    }
    const links = parsed.data.links;

    const zoho = await getBooks();
    if (!zoho) {
      log.warn("vendor link refused — Zoho Books is not connected");
      return errorResponse("Zoho Books is not connected. Connect it in Settings › Integrations, then try again.", 503);
    }

    log.debug("-> GET all Zoho vendors", { links: links.length });
    const [zohoVendors, vendors] = await Promise.all([zoho.listAllContacts(), listVendorsForMatching()]);
    // Matched exactly as the preview matches: every vendor here, against the Zoho vendors not yet
    // linked here — so a row the preview showed as a GSTIN match is still one here.
    const taken = new Set(vendors.flatMap((v) => (v.zohoVendorId ? [v.zohoVendorId] : [])));
    const zohoRefs = zohoVendors
      .filter((c) => c.contact_id && (c.contact_name ?? "").trim() && (!c.contact_type || c.contact_type === "vendor"))
      .filter((c) => !taken.has(c.contact_id))
      .map((c) => ({ zohoId: c.contact_id, name: (c.contact_name ?? "").trim(), gstin: normaliseGstin(c.gst_no) }));
    const matches = matchAll(zohoRefs, vendors);
    const byId = new Map(vendors.map((v) => [v.id, v]));

    const outcomes: Outcome[] = [];
    const usedVendors = new Set<string>();
    for (const { zohoId, vendorId } of links) {
      const skip = (reason: string) => outcomes.push({ zohoId, vendorId, result: "skipped", reason });
      const vendor = byId.get(vendorId);
      const m = matches.get(zohoId);
      if (taken.has(zohoId)) { skip("this Zoho vendor is already linked to a vendor here"); continue; }
      if (!vendor) { skip("the vendor here no longer exists"); continue; }
      if (vendor.zohoVendorId) { skip("the vendor here is already linked to Zoho"); continue; }
      if (!m) { skip("not a vendor in Zoho any more"); continue; }
      if (!pairAllowed(m, vendorId)) { skip("no longer matches — fetch again"); continue; }
      if (usedVendors.has(vendorId)) { skip("the same vendor was chosen for two Zoho vendors"); continue; }
      usedVendors.add(vendorId);

      const result = await linkVendorToZoho({
        vendor,
        zohoVendorId: zohoId,
        kind: m.kind,
        actor: { id: user.id, name: user.name },
        via: "the Link step on /vendors",
      });
      if (result === "linked") outcomes.push({ zohoId, vendorId, result: "linked" });
      else skip(result === "already-linked" ? "linked a moment ago by someone else" : "this Zoho vendor is already linked to a vendor here");
    }

    const linked = outcomes.filter((o) => o.result === "linked").length;
    const errors = outcomes.flatMap((o) => (o.result === "skipped" ? [`${byId.get(o.vendorId)?.name ?? o.vendorId}: ${o.reason}`] : []));
    log.info("vendor link batch", { asked: links.length, linked, skipped: outcomes.length - linked });
    return successResponse({ linked, skipped: outcomes.length - linked, errors, outcomes });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    log.error("vendor link failed", { message: error instanceof Error ? error.message : String(error) });
    return errorResponse(error instanceof Error ? error.message : "Failed to link vendors", 500);
  }
}
