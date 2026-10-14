export const dynamic = "force-dynamic";
// Walks every page of Zoho's vendor list (200 per page); 60 s is headroom, not the norm.
export const maxDuration = 60;

import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { getBooks } from "@/lib/integrations";
import { createLogger } from "@/lib/logger";
import { matchAll, normaliseGstin, type AppVendorRef, type MatchKind, type VendorMatch } from "@/lib/vendors/zoho-match";
import { listVendorsForMatching } from "@/lib/vendors/zoho-link";

const log = createLogger("vendors:zoho-sync");

/**
 *   linked    a vendor here already has this Zoho id
 *   match     the GSTIN pairs it with one vendor here — ticked for linking (gstin, gstin+name)
 *   review    a vendor here may be it — linked only when a person ticks or picks (name, ambiguous)
 *   conflict  the same name with a different GSTIN, or a GSTIN or name already held by a vendor
 *             linked to another Zoho vendor — shown, never linked or imported
 *   new       nothing here — importable
 * (plan 1410-link-vendors-to-zoho, B1; replaces plan 2409's name-only "clash").
 */
type Status = "linked" | "new" | "match" | "review" | "conflict";

interface PreviewRow {
  zohoId: string;
  name: string;
  gstin: string | null;
  city: string | null;
  status: Status;
  /** match / review / conflict: what decided it (src/lib/vendors/zoho-match.ts). */
  kind?: MatchKind;
  /** linked: the vendor holding the id. match / name review / conflict: the vendor it meets. */
  localId?: string;
  localName?: string;
  /** match / review / conflict: the vendors here it was weighed against — an ambiguous row's choices. */
  candidates?: AppVendorRef[];
  /** conflict: why. */
  reason?: VendorMatch["reason"];
}

/**
 * GET /api/vendors/zoho-preview — WRITES NOTHING (plan 2409-zoho-vendor-sync, Part A).
 *
 * Classifies every Zoho vendor against the local Vendor table (statuses above). Vendors with no
 * Zoho id are matched by GSTIN first (plan 1410-link-vendors-to-zoho): on 14 Oct 2026 none of the
 * 83 app vendors carried one, so plan 2409's name-only "clash" made every one of them a dead end.
 *
 * The Link and Import routes recompute the match with the same matcher; this response is for the
 * screen only.
 */
export async function GET() {
  try {
    // vendors.fetch — preview and import are one tick (plan 1410-per-module-fetch-permissions,
    // R2). Was vendors.create; the seeder copied that grant to vendors.fetch once (R3).
    await requireFeature("vendors", "fetch");

    const zoho = await getBooks();
    if (!zoho) {
      log.warn("vendor preview refused — Zoho Books is not connected");
      return errorResponse(
        "Zoho Books is not connected. Connect it in Settings › Integrations, then try again.",
        503
      );
    }

    log.debug("-> GET all Zoho vendors");
    const [zohoVendors, local] = await Promise.all([
      zoho.listAllContacts(),
      listVendorsForMatching(),
    ]);
    log.debug("vendor preview source rows", { zoho: zohoVendors.length, local: local.length });

    const byZohoId = new Map(local.filter((v) => v.zohoVendorId).map((v) => [v.zohoVendorId as string, v]));

    // listContacts asks for contact_type=vendor; a customer row slipping through is not ours.
    const candidates = zohoVendors
      .filter((c) => c.contact_id && (c.contact_name ?? "").trim() && (!c.contact_type || c.contact_type === "vendor"))
      .map((c) => ({
        zohoId: c.contact_id,
        name: (c.contact_name ?? "").trim(),
        gstin: normaliseGstin(c.gst_no),
        city: c.billing_address?.city?.trim() || null,
      }));
    const toMatch = candidates.filter((z) => !byZohoId.has(z.zohoId));
    const matches = matchAll(toMatch, local);

    const rows: PreviewRow[] = [];
    const counts = { linked: 0, new: 0, match: 0, review: 0, conflict: 0, total: 0 };

    for (const z of candidates) {
      const base = { zohoId: z.zohoId, name: z.name, gstin: z.gstin, city: z.city };

      const linked = byZohoId.get(z.zohoId);
      if (linked) {
        counts.linked++;
        rows.push({ ...base, status: "linked", localId: linked.id, localName: linked.name });
        continue;
      }

      const m = matches.get(z.zohoId)!;
      const paired = m.vendorId ? m.candidates.find((v) => v.id === m.vendorId) : undefined;
      const pairedRef = paired ? { localId: paired.id, localName: paired.name } : {};
      if (m.kind === "gstin" || m.kind === "gstin+name") {
        counts.match++;
        rows.push({ ...base, status: "match", kind: m.kind, ...pairedRef, candidates: m.candidates });
      } else if (m.kind === "name" || m.kind === "ambiguous") {
        counts.review++;
        rows.push({ ...base, status: "review", kind: m.kind, ...pairedRef, candidates: m.candidates });
      } else if (m.kind === "conflict") {
        counts.conflict++;
        const c = m.candidates[0];
        rows.push({ ...base, status: "conflict", kind: m.kind, reason: m.reason, localId: c.id, localName: c.name, candidates: m.candidates });
      } else {
        counts.new++;
        rows.push({ ...base, status: "new" });
      }
    }
    counts.total = rows.length;

    log.info("vendor preview built", counts);
    return successResponse({ rows, counts });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    log.error("vendor preview failed", { message: error instanceof Error ? error.message : String(error) });
    return errorResponse(error instanceof Error ? error.message : "Failed to preview Zoho vendors", 500);
  }
}
