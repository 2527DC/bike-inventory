export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { getInventory } from "@/lib/integrations";
import { createLogger } from "@/lib/logger";

const log = createLogger("zoho:taxonomy:categories");

/** Zoho's synthetic tree root, returned by /categories and never a real category. */
const ROOT_CATEGORY_ID = "-1";

// Ticked Zoho ids only. Adoptions are recomputed server-side and always applied (owner
// decision D3, 8 Sep 2026) so the client cannot request one the server did not decide on.
const importSchema = z.object({
  create: z.array(z.string()).default([]),
});

/**
 * POST /api/categories/zoho-import.
 *
 * Zoho's `parent_category_id` is deliberately IGNORED - the import is flat and the tree is
 * arranged by hand on /categories (owner decision D4, 8 Sep 2026). Nothing here reads or
 * writes `parentId`; that is a decision, not an oversight.
 *
 * `POST /api/categories` answers a name clash with a 409. Per row that would be the wrong
 * shape here, so a clash is skipped and reported instead of failing the whole import.
 */
export async function POST(req: NextRequest) {
  try {
    await requireFeature("categories", "create");

    const parsed = importSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return errorResponse(parsed.error.issues[0]?.message ?? "Invalid import request", 400);
    }
    const requested = new Set(parsed.data.create);

    const zoho = await getInventory();
    if (!zoho) {
      log.warn("category import refused - Zoho Inventory is not connected");
      return errorResponse(
        "Zoho Inventory is not connected. Connect it in Settings > Integrations, then try Fetch again.",
        503
      );
    }

    const zohoCategories = await zoho.listAllCategories();
    log.debug("category import source rows", {
      zoho: zohoCategories.length,
      ticked: requested.size,
    });

    const result = await prisma.$transaction(
      async (tx) => {
        // One read inside the transaction IS the case-insensitive existence check for every
        // row below - and it is what avoids the defect the plan names at approve/route.ts:237,
        // where a case-sensitive findFirst against a @unique name threw a constraint error.
        // A failed INSERT cannot be caught and stepped over inside a transaction (Postgres
        // aborts the whole thing), so the check has to come first.
        const local = await tx.category.findMany({
          select: { id: true, name: true, zohoCategoryId: true, isActive: true },
        });

        const byZohoId = new Map(
          local.filter((c) => c.zohoCategoryId).map((c) => [c.zohoCategoryId as string, c])
        );
        const byName = new Map(local.map((c) => [c.name.trim().toLowerCase(), c]));
        const takenNames = new Set(byName.keys());
        const claimedLocalIds = new Set<string>();

        const errors: string[] = [];
        // Things the import DID that the person should hear about — not failures.
        const notices: string[] = [];
        let adopted = 0;
        let created = 0;
        let skipped = 0;

        const seenZohoIds = new Set<string>();

        for (const c of zohoCategories) {
          const zohoId = c.category_id;
          const name = (c.name ?? "").trim();
          if (!zohoId || !name) continue;
          // Zoho prepends a synthetic tree root — category_id "-1", name "ROOT", its own parent.
          // It is not a category anything is filed under, and importing it would put "ROOT" in the
          // taxonomy. Verified live 8 Sep 2026: /categories returns 33 rows — ROOT plus 32 real.
          if (zohoId === ROOT_CATEGORY_ID) continue;
          seenZohoIds.add(zohoId);

          const key = name.toLowerCase();

          // -- linked: some local row already carries this Zoho id --------------
          const alreadyLinked = byZohoId.get(zohoId);
          if (alreadyLinked) {
            if (requested.has(zohoId)) {
              skipped++;
              errors.push(
                `Zoho category "${name}" is already linked to local category "${alreadyLinked.name}" - nothing was created.`
              );
            }
            continue;
          }

          // -- adopt: same name, no Zoho id yet. Always applied, never ticked ---
          const sameName = byName.get(key);
          if (sameName) {
            if (claimedLocalIds.has(sameName.id)) {
              skipped++;
              errors.push(
                `Zoho returned more than one category named "${name}"; local category "${sameName.name}" was linked to the first, and Zoho category ${zohoId} was skipped.`
              );
              continue;
            }
            if (sameName.zohoCategoryId) {
              // That row already points at a DIFFERENT Zoho category; re-pointing it would
              // silently move the link, so refuse and name both rows instead.
              skipped++;
              errors.push(
                `Local category "${sameName.name}" is already linked to Zoho category ${sameName.zohoCategoryId}, so Zoho category "${name}" (${zohoId}) was skipped.`
              );
              continue;
            }
            // Only zohoCategoryId. The local name and the local parent are never touched.
            await tx.category.update({
              where: { id: sameName.id },
              data: { zohoCategoryId: zohoId },
            });
            claimedLocalIds.add(sameName.id);
            adopted++;
            // Identity is identity: an inactive row still adopts its Zoho id. It stays
            // inactive — a sync is not the thing that un-retires a category.
            if (!sameName.isActive) {
              notices.push(`Category "${sameName.name}" is inactive — re-activate it on /categories`);
            }
            continue;
          }

          // -- new: creatable, but only if this id was ticked -------------------
          if (!requested.has(zohoId)) continue;

          if (takenNames.has(key)) {
            skipped++;
            errors.push(
              `A category named "${name}" already exists, so Zoho category ${zohoId} was skipped.`
            );
            continue;
          }

          // Flat by design: no parentId, because parent_category_id is ignored (D4).
          await tx.category.create({ data: { name, zohoCategoryId: zohoId } });
          takenNames.add(key);
          created++;
        }

        // A tick for something Zoho no longer returns is worth a sentence, not silence.
        for (const id of requested) {
          if (!seenZohoIds.has(id)) {
            skipped++;
            errors.push(`Zoho category ${id} was not returned by Zoho and was skipped.`);
          }
        }

        return { adopted, created, skipped, errors, notices };
      },
      // The 5 s default would abort a run that is doing exactly what it was asked to do.
      { maxWait: 10000, timeout: 60000 }
    );

    log.info("zoho category import", {
      adopted: result.adopted,
      created: result.created,
      skipped: result.skipped,
      notices: result.notices.length,
    });

    return successResponse(result);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);

    log.error("category import failed", {
      message: error instanceof Error ? error.message : String(error),
      code: (error as { code?: string } | null)?.code,
    });

    // A concurrent writer can still take a name or a Zoho id between the read above and the
    // write. The transaction rolls back whole, so "nothing was written" is the truth.
    if ((error as { code?: string } | null)?.code === "P2002") {
      return errorResponse(
        "A category name or Zoho category id was claimed by another request while this import was running. Nothing was written - run Fetch again.",
        409
      );
    }

    return errorResponse(
      error instanceof Error ? error.message : "Failed to import Zoho categories",
      500
    );
  }
}
