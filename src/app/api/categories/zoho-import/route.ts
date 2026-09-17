export const dynamic = "force-dynamic";
// Two Zoho reads (the category master and ~29 pages of items) plus three database passes in
// one request. The codebase's long routes all use 60; the item pull is windowed three pages at
// a time (InventoryClient.listAllItems) to stay inside it, and the timings are logged.
export const maxDuration = 60;

import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { getInventory } from "@/lib/integrations";
import { createLogger } from "@/lib/logger";
import { PLACEHOLDER_CATEGORY } from "@/lib/import-placeholders";

const log = createLogger("zoho:taxonomy:categories");

/** Zoho's synthetic tree root, returned by /categories and never a real category. */
const ROOT_CATEGORY_ID = "-1";

/** Rows per `updateMany ... where id IN (...)`. Keeps each statement's parameter list modest. */
const PRODUCT_CHUNK = 1000;

// Ticked Zoho ids only. Adoptions are recomputed server-side and always applied (owner
// decision D3, 8 Sep 2026) so the client cannot request one the server did not decide on.
const importSchema = z.object({
  create: z.array(z.string()).default([]),
});

/**
 * POST /api/categories/zoho-import.
 *
 * Zoho is the source of the category tree AND of which category each product sits in
 * (plan 1709-priority-build-and-stock-flow, P12 and R47, 17 Sep 2026). That reverses the
 * flat-import decision D4 of 8 Sep 2026. Nothing is ever sent to Zoho.
 *
 *   Pass 1 — create / link categories by `zohoCategoryId` (unchanged: ticked rows are created,
 *            same-name rows adopt the Zoho id, ROOT "-1" is skipped).
 *   Pass 2 — set `parentId` on every linked row from Zoho's `parent_category_id`. A parent of
 *            ROOT, or one with no local row, is `null`. A link that would close a cycle is
 *            skipped and logged.
 *   Pass 3 — re-link products: every product with a `zohoItemId` is filed under our row whose
 *            `zohoCategoryId` is its Zoho item's `category_id`.
 *
 * `Product.categoryId` is NOT NULL in the schema, so "no category in Zoho" (or a Zoho category
 * that has no local row, because it was not ticked) cannot be written as null. Those products
 * go to the `Uncategorized` placeholder — the codebase's existing marker for "no category"
 * (`lib/import-placeholders.ts`) — created if it is missing. A product whose item Zoho did not
 * return at all is left where it is and counted.
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

    // Every Zoho read happens before the transaction opens: a database transaction held open
    // across 30 HTTP calls would pin a pooled connection for the whole pull.
    const fetchStarted = Date.now();
    const [zohoCategories, zohoItems] = await Promise.all([
      zoho.listAllCategories(),
      zoho.listAllItems(),
    ]);
    log.debug("category import source rows", {
      zohoCategories: zohoCategories.length,
      zohoItems: zohoItems.length,
      ticked: requested.size,
      ms: Date.now() - fetchStarted,
    });

    // item_id -> Zoho category_id ("" when the item has none).
    const itemCategory = new Map<string, string>();
    for (const item of zohoItems) {
      if (!item.item_id) continue;
      const cid = (item.category_id ?? "").trim();
      itemCategory.set(item.item_id, cid === ROOT_CATEGORY_ID ? "" : cid);
    }

    const dbStarted = Date.now();
    const result = await prisma.$transaction(
      async (tx) => {
        // One read inside the transaction IS the case-insensitive existence check for every
        // row below - and it is what avoids the defect the plan names at approve/route.ts:237,
        // where a case-sensitive findFirst against a @unique name threw a constraint error.
        // A failed INSERT cannot be caught and stepped over inside a transaction (Postgres
        // aborts the whole thing), so the check has to come first.
        const local = await tx.category.findMany({
          select: { id: true, name: true, zohoCategoryId: true, isActive: true, parentId: true },
        });

        const byZohoId = new Map(
          local.filter((c) => c.zohoCategoryId).map((c) => [c.zohoCategoryId as string, c])
        );
        const byName = new Map(local.map((c) => [c.name.trim().toLowerCase(), c]));
        const takenNames = new Set(byName.keys());
        const claimedLocalIds = new Set<string>();
        // Zoho id -> our id, filled as pass 1 links or creates. Seeded with what is already linked.
        const localIdByZohoId = new Map<string, string>(
          local.filter((c) => c.zohoCategoryId).map((c) => [c.zohoCategoryId as string, c.id])
        );
        // Our id -> parentId as it stands, kept current through pass 2 for the cycle check.
        const parentOf = new Map<string, string | null>(local.map((c) => [c.id, c.parentId]));

        const errors: string[] = [];
        // Things the import DID that the person should hear about — not failures.
        const notices: string[] = [];
        let adopted = 0;
        let created = 0;
        let skipped = 0;

        const seenZohoIds = new Set<string>();

        // ── Pass 1: categories ────────────────────────────────────────────────────────────
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
            // Only zohoCategoryId here. The name is never touched; the parent is pass 2's job.
            await tx.category.update({
              where: { id: sameName.id },
              data: { zohoCategoryId: zohoId },
            });
            claimedLocalIds.add(sameName.id);
            localIdByZohoId.set(zohoId, sameName.id);
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

          // Created without a parent: the parent may not exist yet in this loop. Pass 2 sets it.
          const row = await tx.category.create({
            data: { name, zohoCategoryId: zohoId },
            select: { id: true },
          });
          localIdByZohoId.set(zohoId, row.id);
          parentOf.set(row.id, null);
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

        // ── Pass 2: parents, as in Zoho ───────────────────────────────────────────────────
        // Walk up from the proposed parent; reaching the child means the link closes a loop.
        const wouldCycle = (childId: string, parentId: string): boolean => {
          const seen = new Set<string>();
          let cursor: string | null | undefined = parentId;
          while (cursor) {
            if (cursor === childId) return true;
            if (seen.has(cursor)) return true; // an existing loop above; do not extend it
            seen.add(cursor);
            cursor = parentOf.get(cursor);
          }
          return false;
        };

        let parentsSet = 0;
        let cyclesSkipped = 0;
        for (const c of zohoCategories) {
          if (!c.category_id || c.category_id === ROOT_CATEGORY_ID) continue;
          const childId = localIdByZohoId.get(c.category_id);
          if (!childId) continue; // not linked or created here — nothing of ours to arrange

          const zohoParent = (c.parent_category_id ?? "").trim();
          const wanted =
            zohoParent && zohoParent !== ROOT_CATEGORY_ID
              ? localIdByZohoId.get(zohoParent) ?? null
              : null;
          const current = parentOf.get(childId) ?? null;
          if (wanted === current) continue;

          if (wanted && (wanted === childId || wouldCycle(childId, wanted))) {
            cyclesSkipped++;
            log.warn("parent link skipped - would create a cycle", {
              categoryId: childId,
              zohoCategoryId: c.category_id,
              parentCategoryId: wanted,
              zohoParentCategoryId: zohoParent,
            });
            errors.push(
              `Zoho category "${(c.name ?? "").trim()}" was not moved under its Zoho parent: that would put it inside its own sub-tree.`
            );
            continue;
          }

          await tx.category.update({ where: { id: childId }, data: { parentId: wanted } });
          parentOf.set(childId, wanted);
          parentsSet++;
        }

        // ── Pass 3: products, filed as in Zoho ────────────────────────────────────────────
        const products = await tx.product.findMany({
          where: { zohoItemId: { not: null } },
          select: { id: true, zohoItemId: true, categoryId: true },
        });

        let placeholderId: string | null = null;
        const placeholder = async (): Promise<string> => {
          if (placeholderId) return placeholderId;
          const existing = await tx.category.findFirst({
            where: { name: { equals: PLACEHOLDER_CATEGORY, mode: "insensitive" } },
            select: { id: true },
          });
          placeholderId =
            existing?.id ??
            (await tx.category.create({ data: { name: PLACEHOLDER_CATEGORY }, select: { id: true } })).id;
          return placeholderId;
        };

        const moves = new Map<string, string[]>(); // target categoryId -> product ids
        let productsWithoutCategory = 0;
        let productsNotInZoho = 0;
        for (const p of products) {
          const zohoCategoryId = itemCategory.get(p.zohoItemId as string);
          if (zohoCategoryId === undefined) {
            productsNotInZoho++;
            continue;
          }
          let target = zohoCategoryId ? localIdByZohoId.get(zohoCategoryId) : undefined;
          if (!target) {
            productsWithoutCategory++;
            target = await placeholder();
          }
          if (target === p.categoryId) continue;
          const list = moves.get(target) ?? [];
          list.push(p.id);
          moves.set(target, list);
        }

        let productsRelinked = 0;
        for (const [categoryId, ids] of moves) {
          for (let i = 0; i < ids.length; i += PRODUCT_CHUNK) {
            const res = await tx.product.updateMany({
              where: { id: { in: ids.slice(i, i + PRODUCT_CHUNK) } },
              data: { categoryId },
            });
            productsRelinked += res.count;
          }
        }

        if (parentsSet > 0) notices.push(`${parentsSet} categor${parentsSet === 1 ? "y was" : "ies were"} placed under their Zoho parent.`);
        if (productsRelinked > 0) notices.push(`${productsRelinked} product${productsRelinked === 1 ? "" : "s"} moved to their Zoho category.`);
        if (productsWithoutCategory > 0) {
          notices.push(
            `${productsWithoutCategory} product${productsWithoutCategory === 1 ? " has" : "s have"} no category in Zoho (or one that was not imported) and ${productsWithoutCategory === 1 ? "is" : "are"} filed under ${PLACEHOLDER_CATEGORY}.`
          );
        }
        if (productsNotInZoho > 0) {
          notices.push(
            `${productsNotInZoho} product${productsNotInZoho === 1 ? "" : "s"} linked to a Zoho item that Zoho did not return ${productsNotInZoho === 1 ? "was" : "were"} left in ${productsNotInZoho === 1 ? "its" : "their"} current category.`
          );
        }

        return {
          adopted,
          created,
          skipped,
          errors,
          notices,
          categoriesCreated: created,
          categoriesLinked: adopted,
          parentsSet,
          cyclesSkipped,
          productsRelinked,
          productsWithoutCategory,
          productsNotInZoho,
        };
      },
      // The 5 s default would abort a run that is doing exactly what it was asked to do.
      { maxWait: 10000, timeout: 45000 }
    );

    log.info("zoho category import", {
      categoriesCreated: result.categoriesCreated,
      categoriesLinked: result.categoriesLinked,
      skipped: result.skipped,
      parentsSet: result.parentsSet,
      cyclesSkipped: result.cyclesSkipped,
      productsRelinked: result.productsRelinked,
      productsWithoutCategory: result.productsWithoutCategory,
      productsNotInZoho: result.productsNotInZoho,
      zohoMs: dbStarted - fetchStarted,
      dbMs: Date.now() - dbStarted,
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
