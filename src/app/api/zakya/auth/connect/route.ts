export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { exchangeGrantTokenZakya } from "@/lib/zakya";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";

// POST: Connect to Zakya POS using grant token (self-client flow)
export async function POST(req: NextRequest) {
  try {
    await requireFeature("zoho", "fetch");
    const body = await req.json();
    const { clientId, clientSecret, grantToken, organizationId, organizationName } = body;

    if (!clientId || !clientSecret || !grantToken) {
      return errorResponse("Client ID, Client Secret, and Grant Token are required", 400);
    }

    // Exchange grant token for access + refresh tokens
    const tokens = await exchangeGrantTokenZakya(clientId, clientSecret, grantToken);

    const expiresAt = new Date(Date.now() + tokens.expiresIn * 1000);

    // Upsert the singleton config
    await prisma.zakyaConfig.upsert({
      where: { id: "singleton" },
      update: {
        clientId,
        clientSecret,
        refreshToken: tokens.refreshToken,
        accessToken: tokens.accessToken,
        accessTokenExpiresAt: expiresAt,
        organizationId: organizationId || null,
        organizationName: organizationName || null,
        isConnected: true,
      },
      create: {
        id: "singleton",
        clientId,
        clientSecret,
        refreshToken: tokens.refreshToken,
        accessToken: tokens.accessToken,
        accessTokenExpiresAt: expiresAt,
        organizationId: organizationId || null,
        organizationName: organizationName || null,
        isConnected: true,
      },
    });

    return successResponse({ connected: true, organizationName });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to connect to Zakya", 500);
  }
}
