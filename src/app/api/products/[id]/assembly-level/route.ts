export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { productAssemblyLevelSchema } from "@/lib/validations";
import { assemblyLevelLabel } from "@/lib/assembly-level";
import { logActivity } from "@/lib/activity-log";
import { createLogger } from "@/lib/logger";

const log = createLogger("api:product-assembly-level");

/**
 * Set one product's assembly condition level (A50 / A85 / FULL), or clear it. Nothing else.
 *
 * Plan 1509-assembly-queue-single-bin-and-product-assembly-level, B1 / D3 / D4.
 *
 * ─── WHY A SEPARATE ROUTE ────────────────────────────────────────────────────────────────
 *
 * Same reason as `[id]/reorder`: the product PUT spreads the whole `productUpdateSchema` behind
 * `stock.edit`, so wiring this to it would make the level a `stock.edit` decision and the modal
 * a price editor. The level decides how a bicycle is BUILT, which is the assigner's call.
 *
 * ─── WHY `assembly.approve` (owner, 15 Sep, Q5/D4) ───────────────────────────────────────
 *
 * `POST /api/assembly/tasks` — the Assign modal — writes this same column the first time an
 * unset product is assigned, and that route guards on `assembly.approve`. One column, one
 * permission: the /stock button is gated on `canApprove("assembly")` to match, so a role with
 * `stock.edit` alone does not see it (the P7 lesson — a button and its route gated differently
 * is a silent 403 on every click).
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireFeature("assembly", "approve");
    const { id } = await params;

    const parsed = productAssemblyLevelSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      log.warn("assembly level refused", { productId: id, field: issue?.path.join("."), code: issue?.code });
      return errorResponse(issue?.message ?? "Choose an assembly level", 400);
    }
    const nextLevel = parsed.data.level;

    const existing = await prisma.product.findUnique({
      where: { id },
      select: { id: true, sku: true, assemblyLevel: true },
    });
    if (!existing) return errorResponse("Product not found", 404);

    const changed = existing.assemblyLevel !== nextLevel;

    const product = await prisma.$transaction(async (tx) => {
      const row = await tx.product.update({
        where: { id },
        data: { assemblyLevel: nextLevel },
        select: { id: true, assemblyLevel: true },
      });

      // Logged only when it moved — a Save that re-picks the same level is not an event.
      if (changed) {
        await logActivity(tx, {
          module: "stock",
          action: "updated",
          entityType: "Product",
          entityId: id,
          entityRef: existing.sku,
          fromValue: assemblyLevelLabel(existing.assemblyLevel),
          toValue: assemblyLevelLabel(nextLevel),
          details: "Assembly level",
          userId: user.id,
          userName: user.name,
        });
      }

      return row;
    });

    log.info("assembly level saved", {
      productId: id,
      from: existing.assemblyLevel,
      to: nextLevel,
      changed,
    });
    return successResponse(product);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    const message = error instanceof Error ? error.message : "Failed to save the assembly level";
    log.error("assembly level save failed", { message });
    return errorResponse(message, 400);
  }
}
