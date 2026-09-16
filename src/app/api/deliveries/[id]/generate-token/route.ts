export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { isDummy } from "@/lib/deliveries/floor-stock";
import { createLogger } from "@/lib/logger";
import crypto from "crypto";

const log = createLogger("deliveries:self-fill");

/** The customer's link lasts 24 hours (owner, A7). */
const LINK_LIFETIME_MS = 24 * 60 * 60 * 1000;

/**
 * Generate (or reuse) the customer's self-fill link (plan 1609-deliveries, Phase 2 §2.5).
 *
 * Refused on a Dummy (A41b), until the customer is saved (A5, A6), and once the customer has
 * submitted — the form is locked after a submit and staff correct mistakes themselves (A8).
 * `selfFillCompletedAt` is never cleared here: a new link must not unlock a submitted form.
 *
 * The token is never logged.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let deliveryId: string | undefined;
  try {
    await requireFeature("deliveries", "create");
    const { id } = await params;
    deliveryId = id;

    const delivery = await prisma.delivery.findUnique({
      where: { id },
      select: {
        id: true,
        invoiceNo: true,
        selfFillToken: true,
        selfFillTokenExpiry: true,
        selfFillCompletedAt: true,
        customerId: true,
        warehouseId: true,
        status: true,
      },
    });

    if (!delivery) return errorResponse("Delivery not found", 404);

    // A Dummy takes no action (A41b, T2) — no customer link either.
    if (isDummy(delivery)) {
      log.warn("generate link refused: dummy delivery", { deliveryId: id, invoiceNo: delivery.invoiceNo });
      return errorResponse("Dummy delivery: no warehouse matched this invoice number. No actions are allowed.", 409);
    }

    if (!delivery.customerId) {
      log.warn("generate link refused: customer not saved", { deliveryId: id, invoiceNo: delivery.invoiceNo });
      return errorResponse("Save the customer first.", 409);
    }

    if (delivery.selfFillCompletedAt) {
      log.warn("generate link refused: customer already submitted", {
        deliveryId: id,
        invoiceNo: delivery.invoiceNo,
      });
      return errorResponse("The customer has already submitted; edit the delivery instead.", 409);
    }

    // Reuse a still-valid token
    if (delivery.selfFillToken && delivery.selfFillTokenExpiry && new Date() < delivery.selfFillTokenExpiry) {
      log.debug("self-fill link reused", { deliveryId: id, expiresAt: delivery.selfFillTokenExpiry.toISOString() });
      return successResponse({
        token: delivery.selfFillToken,
        expiresAt: delivery.selfFillTokenExpiry,
      });
    }

    const token = crypto.randomBytes(24).toString("base64url");
    const expiresAt = new Date(Date.now() + LINK_LIFETIME_MS);

    await prisma.delivery.update({
      where: { id },
      data: {
        selfFillToken: token,
        selfFillTokenExpiry: expiresAt,
      },
    });

    log.info("self-fill link generated", {
      deliveryId: id,
      invoiceNo: delivery.invoiceNo,
      customerId: delivery.customerId,
      expiresAt: expiresAt.toISOString(),
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
