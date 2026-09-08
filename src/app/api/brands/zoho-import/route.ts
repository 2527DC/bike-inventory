export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { getInventory } from "@/lib/integrations";
import { createLogger } from "@/lib/logger";

const log = createLogger("zoho:taxonomy:brands");

// `create` carries the Zoho ids the person ticked, and NOTHING else. Adoptions are
// deliberately absent from the body: they are recomputed here exactly as the preview
// computes them and always applied (owner decision D3, 8 Sep 2026), so the client cannot
// ask for a link the server did not independently decide on.
const importSchema = z.object({
  create: z.array(z.string()).default([]),
});

/**
 * POST /api/brands/zoho-import — the only new writer in this plan.
 *
 * Adoption fills `zohoBrandId` on an existing row and NEVER renames it. Creation is limited
 * to ticked ids whose status is `new`, behind a case-insensitive name check that
 * `POST /api/brands` does not have and that this path must not inherit the lack of.
 */
export async function POST(req: NextRequest) {
  try {
    await requireFeature("brands", "create");

    const parsed = importSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return errorResponse(parsed.error.issues[0]?.message ?? "Invalid import request", 400);
    }
    const requested = new Set(parsed.data.create);

    const zoho = await getInventory();
    if (!zoho) {
      log.warn("brand import refused - Zoho Inventory is not connected");
      return errorResponse(
        "Zoho Inventory is not connected. Connect it in Settings > Integrations, then try Fetch again.",
        503
      );
    }

    const zohoBrands = await zoho.listAllBrands();
    log.debug("brand import source rows", { zoho: zohoBrands.length, ticked: requested.size });

    const result = await prisma.$transaction(
      async (tx) => {
        // One read inside the transaction IS the case-insensitive existence check for every
        // row below. Doing it per create would be N round trips for the same answer, and a
        // failed INSERT cannot be caught and stepped over here anyway: Postgres aborts the
        // whole transaction on a constraint violation, so the check has to come first.
        const local = await tx.brand.findMany({
          select: { id: true, name: true, zohoBrandId: true },
        });

        const byZohoId = new Map(
          local.filter((b) => b.zohoBrandId).map((b) => [b.zohoBrandId as string, b])
        );
        const byName = new Map(local.map((b) => [b.name.trim().toLowerCase(), b]));
        const takenNames = new Set(byName.keys());
        const claimedLocalIds = new Set<string>();

        const errors: string[] = [];
        let adopted = 0;
        let created = 0;
        let skipped = 0;

        const seenZohoIds = new Set<string>();

        for (const b of zohoBrands) {
          const zohoId = b.brand_id;
          const name = (b.name ?? "").trim();
          if (!zohoId || !name) continue;
          seenZohoIds.add(zohoId);

          const key = name.toLowerCase();

          // ── linked: some local row already carries this Zoho id ──────────────
          const alreadyLinked = byZohoId.get(zohoId);
          if (alreadyLinked) {
            if (requested.has(zohoId)) {
              skipped++;
              errors.push(
                `Zoho brand "${name}" is already linked to local brand "${alreadyLinked.name}" - nothing was created.`
              );
            }
            continue;
          }

          // ── adopt: same name, no Zoho id yet. Always applied, never ticked ───
          const sameName = byName.get(key);
          if (sameName) {
            if (claimedLocalIds.has(sameName.id)) {
              skipped++;
              errors.push(
                `Zoho returned more than one brand named "${name}"; local brand "${sameName.name}" was linked to the first, and Zoho brand ${zohoId} was skipped.`
              );
              continue;
            }
            if (sameName.zohoBrandId) {
              // The Zoho id on that row is a DIFFERENT one - re-pointing it would silently
              // move the link, so refuse and name both rows instead.
              skipped++;
              errors.push(
                `Local brand "${sameName.name}" is already linked to Zoho brand ${sameName.zohoBrandId}, so Zoho brand "${name}" (${zohoId}) was skipped.`
              );
              continue;
            }
            // Only zohoBrandId. The local name is never touched.
            await tx.brand.update({ where: { id: sameName.id }, data: { zohoBrandId: zohoId } });
            claimedLocalIds.add(sameName.id);
            adopted++;
            continue;
          }

          // ── new: creatable, but only if this id was ticked ───────────────────
          if (!requested.has(zohoId)) continue;

          if (takenNames.has(key)) {
            skipped++;
            errors.push(
              `A brand named "${name}" already exists, so Zoho brand ${zohoId} was skipped.`
            );
            continue;
          }

          await tx.brand.create({ data: { name, zohoBrandId: zohoId } });
          takenNames.add(key);
          created++;
        }

        // A tick for something Zoho no longer returns is worth a sentence, not silence.
        for (const id of requested) {
          if (!seenZohoIds.has(id)) {
            skipped++;
            errors.push(`Zoho brand ${id} was not returned by Zoho and was skipped.`);
          }
        }

        return { adopted, created, skipped, errors };
      },
      // 151 brands can mean ~150 writes behind them. The 5 s default would abort a run that
      // is doing exactly what it was asked to do.
      { maxWait: 10000, timeout: 60000 }
    );

    log.info("zoho brand import", {
      adopted: result.adopted,
      created: result.created,
      skipped: result.skipped,
    });

    return successResponse(result);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);

    log.error("brand import failed", {
      message: error instanceof Error ? error.message : String(error),
      code: (error as { code?: string } | null)?.code,
    });

    // A concurrent writer can still take a name or a Zoho id between the read above and the
    // write. The transaction rolls back whole, so "nothing was written" is the truth.
    if ((error as { code?: string } | null)?.code === "P2002") {
      return errorResponse(
        "A brand name or Zoho brand id was claimed by another request while this import was running. Nothing was written - run Fetch again.",
        409
      );
    }

    return errorResponse(
      error instanceof Error ? error.message : "Failed to import Zoho brands",
      500
    );
  }
}
