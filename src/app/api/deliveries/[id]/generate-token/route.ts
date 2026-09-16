export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { isDummy } from "@/lib/deliveries/floor-stock";
import { createLogger } from "@/lib/logger";
import crypto from "crypto";

const log = createLogger("deliveries:api");

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let deliveryId: string | undefined;
  try {
    await requireFeature("deliveries", "create");
    const { id } = await params;
    deliveryId = id;

    const delivery = await prisma.delivery.findUnique({
      where: { id },
      select: { id: true, selfFillToken: true, selfFillTokenExpiry: true, warehouseId: true, status: true },
    });

    if (!delivery) return errorResponse("Delivery not found", 404);

    // A Dummy takes no action (A41b, T2) — no customer link either.
    if (isDummy(delivery)) {
      log.warn("generate link refused: dummy delivery", { deliveryId: id });
      return errorResponse("Dummy delivery: no warehouse matched this invoice number. No actions are allowed.", 409);
    }

    // Reuse existing valid token
    if (delivery.selfFillToken && delivery.selfFillTokenExpiry && new Date() < delivery.selfFillTokenExpiry) {
      return successResponse({
        token: delivery.selfFillToken,
        expiresAt: delivery.selfFillTokenExpiry,
      });
    }

    // Generate new token — 48 hours expiry
    const token = crypto.randomBytes(24).toString("base64url");
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);

    await prisma.delivery.update({
      where: { id },
      data: {
        selfFillToken: token,
        selfFillTokenExpiry: expiresAt,
        selfFillCompletedAt: null,
      },
    });

    return successResponse({ token, expiresAt });
  } catch (error) {
    if (error instanceof AuthError) {
      log.warn("generate link refused", { deliveryId, status: error.status });
      return errorResponse(error.message, error.status);
    }
    log.error("generate link failed", { deliveryId, error: error instanceof Error ? error.message : String(error) });
    return errorResponse(error instanceof Error ? error.message : "Failed to generate link", 500);
  }
}
