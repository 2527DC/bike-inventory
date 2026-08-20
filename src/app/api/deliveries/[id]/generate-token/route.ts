export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import crypto from "crypto";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireFeature("deliveries", "create");
    const { id } = await params;

    const delivery = await prisma.delivery.findUnique({
      where: { id },
      select: { id: true, selfFillToken: true, selfFillTokenExpiry: true },
    });

    if (!delivery) return errorResponse("Delivery not found", 404);

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
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to generate link", 500);
  }
}
