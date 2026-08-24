// Issue a new API key for an existing device, invalidating the old one immediately.
//
// This is the endpoint that justifies the whole AnalyticsDevice table: with keys in an
// environment variable, rotating a camera credential meant editing Vercel config and
// redeploying. Here it is one write, effective on the next request.
//
// The old key stops working the moment this returns — the row holds exactly one hash. Whoever
// rotates must be ready to update agent/.env on the store laptop, or that counter goes quiet
// (its events queue locally and backfill once the new key is in place, so nothing is lost).

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { generateDeviceKey, hashDeviceKey } from "@/lib/analytics/device-auth";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireFeature("analytics", "edit");
    const { id } = await params;

    const key = generateDeviceKey();

    const device = await prisma.analyticsDevice.update({
      where: { id },
      data: { keyHash: hashDeviceKey(key) },
      select: { id: true, label: true, storeId: true, agentId: true, isActive: true },
    });

    // Shown once. There is no way to read it back.
    return successResponse({ device, key });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return errorResponse("Device not found", 404);
    }
    console.error("analytics device rotate failed", error);
    return errorResponse("Failed to rotate key", 500);
  }
}
