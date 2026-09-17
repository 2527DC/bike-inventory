export const dynamic = "force-dynamic";

import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { getInventory } from "@/lib/integrations";
import { createLogger } from "@/lib/logger";

const log = createLogger("zoho:taxonomy:categories");

/** Zoho's synthetic tree root, returned by /categories and never a real category. */
const ROOT_CATEGORY_ID = "-1";

type Status = "linked" | "adopt" | "new";

interface PreviewRow {
  zohoId: string;
  name: string;
  status: Status;
  localId?: string;
  localName?: string;
  /** The Zoho parent's name; absent for a top-level category (parent ROOT "-1"). */
  parentName?: string;
  parentZohoId?: string;
  // Always false for categories. The field is kept so both sheets render from one shape;
  // a category is never vendor-shaped, so no Vendor query is run on this route at all.
  vendorLike: boolean;
}

/**
 * GET /api/categories/zoho-preview — WRITES NOTHING.
 *
 * Zoho returns categories as a tree and every node carries `parent_category_id`. Each row
 * names its Zoho parent, because the import now files every category under that parent
 * (plan 1709, P12 — reversing the flat-import decision D4 of 8 Sep 2026).
 */
export async function GET() {
  try {
    await requireFeature("categories", "fetch");

    const zoho = await getInventory();
    if (!zoho) {
      log.warn("category preview refused - Zoho Inventory is not connected");
      return errorResponse(
        "Zoho Inventory is not connected. Connect it in Settings > Integrations, then try Fetch again.",
        503
      );
    }

    const [zohoCategories, localCategories] = await Promise.all([
      zoho.listAllCategories(),
      prisma.category.findMany({ select: { id: true, name: true, zohoCategoryId: true } }),
    ]);

    log.debug("category preview source rows", {
      zoho: zohoCategories.length,
      local: localCategories.length,
    });

    const byZohoId = new Map(
      localCategories.filter((c) => c.zohoCategoryId).map((c) => [c.zohoCategoryId as string, c])
    );
    const byName = new Map(localCategories.map((c) => [c.name.trim().toLowerCase(), c]));
    const zohoNameById = new Map(
      zohoCategories
        .filter((c) => c.category_id && c.category_id !== ROOT_CATEGORY_ID)
        .map((c) => [c.category_id, (c.name ?? "").trim()])
    );

    const rows: PreviewRow[] = [];
    let linked = 0;
    let adopt = 0;
    let fresh = 0; // `new` is a reserved word; the JSON key below is still `new`.

    for (const c of zohoCategories) {
      const zohoId = c.category_id;
      const name = (c.name ?? "").trim();
      if (!zohoId || !name) continue;
      // Zoho prepends a synthetic tree root — category_id "-1", name "ROOT", its own parent.
      // It is not a category anything is filed under, and importing it would put "ROOT" in the
      // taxonomy. Verified live 8 Sep 2026: /categories returns 33 rows — ROOT plus 32 real.
      if (zohoId === ROOT_CATEGORY_ID) continue;

      const key = name.toLowerCase();
      const parentZohoId = (c.parent_category_id ?? "").trim();
      const parent =
        parentZohoId && parentZohoId !== ROOT_CATEGORY_ID && zohoNameById.get(parentZohoId)
          ? { parentZohoId, parentName: zohoNameById.get(parentZohoId) }
          : {};

      const alreadyLinked = byZohoId.get(zohoId);
      if (alreadyLinked) {
        linked++;
        rows.push({
          zohoId,
          name,
          status: "linked",
          localId: alreadyLinked.id,
          localName: alreadyLinked.name,
          ...parent,
          vendorLike: false,
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
          ...parent,
          vendorLike: false,
        });
        continue;
      }

      fresh++;
      rows.push({ zohoId, name, status: "new", ...parent, vendorLike: false });
    }

    log.info("category preview built", { linked, adopt, new: fresh, total: rows.length });

    return successResponse({
      rows,
      counts: { linked, adopt, new: fresh, total: rows.length },
    });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    log.error("category preview failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return errorResponse(
      error instanceof Error ? error.message : "Failed to preview Zoho categories",
      500
    );
  }
}
