// Counting devices — list and register.
//
// The raw API key is generated here, returned EXACTLY ONCE in the create response, and never
// stored: only its sha-256 goes to the database. There is deliberately no endpoint that can
// read a key back. If it is lost, rotate it — that is what /[id]/rotate is for.
//
// Why this exists at all: the pilot kept keys in a STORE_KEYS environment JSON, so rotating a
// camera credential meant a redeploy and the key sat in plaintext in the Vercel dashboard.
// "Access control is DATA, not code" (CLAUDE.md) applies to machine credentials too.

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { generateDeviceKey, hashDeviceKey } from "@/lib/analytics/device-auth";
import { HEARTBEAT_STALE_MS } from "@/lib/analytics/store";
import { analyticsDeviceCreateSchema } from "@/lib/validations";
import { createLogger } from "@/lib/logger";

const log = createLogger("analytics:devices");

// keyHash is never selected. It cannot leak through a response that does not fetch it.
const DEVICE_FIELDS = {
  id: true,
  label: true,
  storeId: true,
  agentId: true,
  isActive: true,
  lastSeenAt: true,
  createdAt: true,
} as const;

export async function GET() {
  try {
    await requireFeature("analytics", "view");

    const devices = await prisma.analyticsDevice.findMany({
      select: DEVICE_FIELDS,
      orderBy: [{ isActive: "desc" }, { createdAt: "asc" }],
    });

    const now = Date.now();
    return successResponse(
      devices.map((d) => ({
        ...d,
        // Same staleness rule the dashboard uses, so a device cannot read "online" here and
        // "offline" there.
        online:
          d.isActive && d.lastSeenAt != null && now - d.lastSeenAt.getTime() < HEARTBEAT_STALE_MS,
      }))
    );
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    log.error("device list failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse("Failed to load devices", 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    // `edit`, not `view`: seeing footfall must not imply being able to mint a credential
    // that can write footfall.
    await requireFeature("analytics", "edit");

    const body = await req.json().catch(() => null);
    const parsed = analyticsDeviceCreateSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse(parsed.error.issues[0]?.message ?? "Invalid device", 400);
    }

    const key = generateDeviceKey();

    const device = await prisma.analyticsDevice.create({
      data: {
        label: parsed.data.label,
        storeId: parsed.data.storeId,
        agentId: parsed.data.agentId,
        keyHash: hashDeviceKey(key),
      },
      select: DEVICE_FIELDS,
    });

    // `key` appears in this response and nowhere else, ever.
    return successResponse({ device, key }, 201);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return errorResponse(
        "A device already exists for that store and agent id. Rotate its key instead of adding a second one.",
        409
      );
    }
    log.error("device create failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse("Failed to register device", 500);
  }
}
