export const dynamic = "force-dynamic";
// Walks every page of Zoho's vendor list (200 per page); 60 s is headroom, not the norm.
export const maxDuration = 60;

import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { getBooks } from "@/lib/integrations";
import { createLogger } from "@/lib/logger";

const log = createLogger("vendors:zoho-sync");

type Status = "linked" | "new" | "clash";

interface PreviewRow {
  zohoId: string;
  name: string;
  gstin: string | null;
  city: string | null;
  status: Status;
  /** For linked / clash: the local vendor this row meets. */
  localId?: string;
  localName?: string;
}

/**
 * GET /api/vendors/zoho-preview — WRITES NOTHING (plan 2409-zoho-vendor-sync, Part A).
 *
 * Classifies every Zoho vendor against the local Vendor table:
 *   linked — a Vendor already carries this Zoho id. Skipped by the import, never updated
 *            (details are copied once, at creation — plan 2409-zoho-vendor-id, Q4).
 *   new    — no Vendor has this id and none has this name. Importable.
 *   clash  — a Vendor has this exact name (case-insensitive) but no or another Zoho id.
 *            Shown, never imported: `Vendor.name` is unique, and linking by name is the
 *            thing this whole design avoids. The person renames one side.
 *
 * The import recomputes all of this; this response is for the screen only.
 */
export async function GET() {
  try {
    await requireFeature("vendors", "create");

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
      prisma.vendor.findMany({ select: { id: true, name: true, zohoVendorId: true } }),
    ]);
    log.debug("vendor preview source rows", { zoho: zohoVendors.length, local: local.length });

    const byZohoId = new Map(local.filter((v) => v.zohoVendorId).map((v) => [v.zohoVendorId as string, v]));
    const byName = new Map(local.map((v) => [v.name.trim().toLowerCase(), v]));

    const rows: PreviewRow[] = [];
    const counts = { linked: 0, new: 0, clash: 0, total: 0 };

    for (const c of zohoVendors) {
      const zohoId = c.contact_id;
      const name = (c.contact_name ?? "").trim();
      if (!zohoId || !name) continue;
      // listContacts asks for contact_type=vendor; a customer row slipping through is not ours.
      if (c.contact_type && c.contact_type !== "vendor") continue;

      const base = {
        zohoId,
        name,
        gstin: c.gst_no?.trim() || null,
        city: c.billing_address?.city?.trim() || null,
      };

      const linked = byZohoId.get(zohoId);
      if (linked) {
        counts.linked++;
        rows.push({ ...base, status: "linked", localId: linked.id, localName: linked.name });
        continue;
      }
      const sameName = byName.get(name.toLowerCase());
      if (sameName) {
        counts.clash++;
        rows.push({ ...base, status: "clash", localId: sameName.id, localName: sameName.name });
        continue;
      }
      counts.new++;
      rows.push({ ...base, status: "new" });
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
