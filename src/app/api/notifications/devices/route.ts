export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { z } from "zod";
import type { PushDevice } from "@prisma/client";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireAuth, AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";
import { tokenTail } from "@/lib/notify/push";
import type { DeviceView } from "@/lib/notify/types";

const log = createLogger("notify:push:devices");

// The device-token registry. One route for both clients: the PWA posts `platform: "WEB"`
// after getToken(); the Expo app posts its native FCM token with `platform: "ANDROID"`
// (plan D.3). The server does not care which — a row is a row and the sender branches on
// `platform` alone.
//
// requireAuth on everything. Ownership comes from the SESSION, never the body: a client that
// could name a userId could hand its token to someone else's account and receive their
// notifications. The same rule makes GET and DELETE self-scoped — you see and remove your own
// devices only, and someone else's id is indistinguishable from a missing one.
//
// The full token is a credential for the owner's screen. It is stored, matched on, and
// returned to nobody — every response and every log line carries `tokenTail` (last 6) instead.

const RegisterSchema = z.object({
  // Real FCM tokens are ~150 characters. 20 is low enough for any future format and high
  // enough to reject an empty string or a stray "undefined".
  token: z.string().trim().min(20, "token must be at least 20 characters").max(4096),
  platform: z.enum(["WEB", "ANDROID"]),
  userAgent: z.string().trim().max(500).optional(),
});

function toView(row: PushDevice): DeviceView {
  return {
    id: row.id,
    platform: row.platform,
    tokenTail: tokenTail(row.token),
    userAgent: row.userAgent,
    lastSeenAt: row.lastSeenAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

async function readBody(req: NextRequest): Promise<unknown> {
  try {
    return await req.json();
  } catch (error) {
    log.warn("device registration body is not JSON", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The caller's own devices, newest first. */
export async function GET() {
  try {
    const user = await requireAuth();

    const rows = await prisma.pushDevice.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
    });

    log.debug("devices listed", { userId: user.id, count: rows.length });
    return successResponse(rows.map(toView));
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    log.error("could not list devices", { error: errorText(error) });
    return errorResponse("Could not list your devices", 500);
  }
}

/** Register (or re-register) this device for the session user. Upsert on token. */
export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth();

    const parsed = RegisterSchema.safeParse(await readBody(req));
    if (!parsed.success) {
      return errorResponse(parsed.error.issues[0]?.message || "Invalid device registration", 400);
    }
    const { token, platform, userAgent } = parsed.data;
    const tail = tokenTail(token);

    // FCM never issues the same token twice, so a token already on file belongs to THIS
    // physical device. If it is filed under another user, the device changed hands — a shared
    // shop phone logged in by someone else — and it must follow the person now holding it.
    // Worth a warning because it also describes an account left signed in on a shared device.
    const existing = await prisma.pushDevice.findUnique({
      where: { token },
      select: { id: true, userId: true },
    });
    if (existing && existing.userId !== user.id) {
      log.warn("device token moved to another user", {
        deviceId: existing.id,
        fromUserId: existing.userId,
        toUserId: user.id,
        platform,
        tail,
      });
    }

    const row = await prisma.pushDevice.upsert({
      where: { token },
      update: {
        userId: user.id,
        platform,
        // `undefined` leaves the stored value alone when the client sent none.
        userAgent: userAgent ?? undefined,
        lastSeenAt: new Date(),
      },
      create: {
        userId: user.id,
        token,
        platform,
        userAgent: userAgent ?? null,
      },
    });

    log.info(existing ? "device re-registered" : "device registered", {
      deviceId: row.id,
      userId: user.id,
      platform,
      tail,
    });
    return successResponse(toView(row), existing ? 200 : 201);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    log.error("could not register device", { error: errorText(error) });
    return errorResponse("Could not register this device", 500);
  }
}

/** Remove one of the caller's own devices: DELETE /api/notifications/devices?id=… */
export async function DELETE(req: NextRequest) {
  try {
    const user = await requireAuth();

    const id = new URL(req.url).searchParams.get("id")?.trim();
    if (!id) return errorResponse("id is required", 400);

    // Ownership is in the WHERE itself: someone else's id deletes nothing and gets the same
    // 404 as an id that never existed, so the route cannot be used to probe for devices.
    const { count } = await prisma.pushDevice.deleteMany({ where: { id, userId: user.id } });
    if (count === 0) return errorResponse("Device not found", 404);

    log.info("device removed", { deviceId: id, userId: user.id });
    return successResponse({ id });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    log.error("could not remove device", { error: errorText(error) });
    return errorResponse("Could not remove this device", 500);
  }
}
