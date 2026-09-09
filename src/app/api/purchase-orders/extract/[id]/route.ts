export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { userCan } from "@/lib/rbac";
import { createLogger } from "@/lib/logger";
import { discardExtractions, loadExtraction } from "@/lib/po-extraction/store";

const log = createLogger("purchase-orders:extract");

type Ctx = { params: Promise<{ id: string }> };

/**
 * Re-load a review after a refresh. The screen keeps the extraction id in sessionStorage so
 * a reload — or a phone that locked during the 30–60 s AI call — does not lose the upload.
 * Somebody else's extraction answers 404, not 403: the id is not worth confirming.
 */
export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    const user = await requireFeature("purchase_orders", "create");
    const { id } = await params;
    const canSeeCost = await userCan(user.id, "cost_price", "view");

    const view = await loadExtraction(id, user.id, canSeeCost);
    if (!view) return errorResponse("Extraction not found", 404);

    log.debug("extraction loaded", { extractionId: id, items: view.items.length });
    return successResponse(view);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    log.error("extraction load failed", { message: error instanceof Error ? error.message : String(error) });
    return errorResponse(error instanceof Error ? error.message : "Could not load the extraction", 500);
  }
}

/** The Discard button: the rows go, the items cascade, the stored file goes best-effort. */
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  try {
    const user = await requireFeature("purchase_orders", "create");
    const { id } = await params;

    const existing = await prisma.poExtraction.findFirst({ where: { id, createdById: user.id }, select: { id: true } });
    if (!existing) return errorResponse("Extraction not found", 404);

    await discardExtractions({ id, createdById: user.id });
    log.info("extraction discarded", { extractionId: id, userId: user.id });
    return successResponse({ id });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    log.error("extraction discard failed", { message: error instanceof Error ? error.message : String(error) });
    return errorResponse(error instanceof Error ? error.message : "Could not discard the extraction", 500);
  }
}
