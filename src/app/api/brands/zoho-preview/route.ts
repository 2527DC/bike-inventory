export const dynamic = "force-dynamic";

import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { getInventory } from "@/lib/integrations";
import { createLogger } from "@/lib/logger";

const log = createLogger("zoho:taxonomy:brands");

// ─── vendor-shaped name heuristic ────────────────────────────────────────────
// Nothing is hidden or auto-unticked by this (owner decision D2, 8 Sep 2026); it only
// renders as a "looks like a vendor" chip so the person ticking can see what they are
// about to make a brand out of. The bug it exists to prevent is the one in §6 of the
// plan: a brand minted from a bill's vendor name looks like a real brand everywhere.
const COMPANY_TOKENS = new Set([
  "PVT",
  "LTD",
  "LIMITED",
  "ENTERPRISE",
  "ENTERPRISES",
  "INDUSTRIES",
  "TRADERS",
  "AGENCIES",
]);

/** Uppercase word tokens, with `&` always standing alone so "& CO" is findable. */
function tokenize(name: string): string[] {
  return name
    .toUpperCase()
    .replace(/&/g, " & ")
    .replace(/[^A-Z0-9&]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function looksLikeCompany(name: string): boolean {
  const parts = tokenize(name);
  // Token equality, not substring: "LTD" must not fire on "ALTDA".
  if (parts.some((p) => COMPANY_TOKENS.has(p))) return true;
  for (let i = 0; i < parts.length - 1; i++) {
    if (parts[i] === "&" && parts[i + 1] === "CO") return true;
  }
  return false;
}

type Status = "linked" | "adopt" | "new";

interface PreviewRow {
  zohoId: string;
  name: string;
  status: Status;
  localId?: string;
  localName?: string;
  vendorLike: boolean;
}

/**
 * GET /api/brands/zoho-preview — WRITES NOTHING.
 *
 * Classifies every brand Zoho holds against the local Brand master so the sheet can show
 * what an import would do before anything is done. The import route recomputes all of this
 * server-side; this response is for the screen, never a token the client hands back.
 */
export async function GET() {
  try {
    await requireFeature("brands", "fetch");

    const zoho = await getInventory();
    if (!zoho) {
      log.warn("brand preview refused - Zoho Inventory is not connected");
      return errorResponse(
        "Zoho Inventory is not connected. Connect it in Settings > Integrations, then try Fetch again.",
        503
      );
    }

    // One vendor query for the whole sheet, never one per row.
    const [zohoBrands, localBrands, vendors] = await Promise.all([
      zoho.listAllBrands(),
      prisma.brand.findMany({ select: { id: true, name: true, zohoBrandId: true } }),
      prisma.vendor.findMany({ select: { name: true } }),
    ]);

    log.debug("brand preview source rows", {
      zoho: zohoBrands.length,
      local: localBrands.length,
      vendors: vendors.length,
    });

    const byZohoId = new Map(
      localBrands.filter((b) => b.zohoBrandId).map((b) => [b.zohoBrandId as string, b])
    );
    const byName = new Map(localBrands.map((b) => [b.name.trim().toLowerCase(), b]));
    const vendorNames = new Set(vendors.map((v) => v.name.trim().toLowerCase()));

    const rows: PreviewRow[] = [];
    let linked = 0;
    let adopt = 0;
    let fresh = 0; // `new` is a reserved word; the JSON key below is still `new`.

    for (const b of zohoBrands) {
      const zohoId = b.brand_id;
      const name = (b.name ?? "").trim();
      if (!zohoId || !name) continue; // an unnamed Zoho row is nothing we can create

      const key = name.toLowerCase();
      const vendorLike = vendorNames.has(key) || looksLikeCompany(name);

      const alreadyLinked = byZohoId.get(zohoId);
      if (alreadyLinked) {
        linked++;
        rows.push({
          zohoId,
          name,
          status: "linked",
          localId: alreadyLinked.id,
          localName: alreadyLinked.name,
          vendorLike,
        });
        continue;
      }

      const sameName = byName.get(key);
      if (sameName) {
        adopt++;
        rows.push({
          zohoId,
          name,
          status: "adopt",
          localId: sameName.id,
          localName: sameName.name,
          vendorLike,
        });
        continue;
      }

      fresh++;
      rows.push({ zohoId, name, status: "new", vendorLike });
    }

    log.info("brand preview built", { linked, adopt, new: fresh, total: rows.length });

    return successResponse({
      rows,
      counts: { linked, adopt, new: fresh, total: rows.length },
    });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    log.error("brand preview failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return errorResponse(
      error instanceof Error ? error.message : "Failed to preview Zoho brands",
      500
    );
  }
}
