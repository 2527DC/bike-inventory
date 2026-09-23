export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireAuth, AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";
import { unreadCount } from "@/lib/notify/inbox";

const log = createLogger("notifications:inbox");

// Mark the SESSION user's notifications read (plan 2309, Part D). Authentication only; the
// `where` always carries `userId: user.id`, so an id belonging to someone else matches nothing
// rather than marking their row. Idempotent: only unread rows are touched, and running it
// twice changes nothing the second time.
//
//   { ids: [...] }   → those rows      (opening one item)
//   { all: true }    → every unread row (Mark all read)
//
// Returns the new unread count so the bell and the app-icon badge update without a re-read.

const BodySchema = z.union([
  z.object({ ids: z.array(z.string().trim().min(1).max(64)).min(1).max(100) }).strict(),
  z.object({ all: z.literal(true) }).strict(),
]);

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth();

    const parsed = BodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return errorResponse("Send { ids: [...] } or { all: true }", 400);
    }

    const result = await prisma.notificationInbox.updateMany({
      where: {
        userId: user.id,
        readAt: null,
        ...("ids" in parsed.data ? { id: { in: parsed.data.ids } } : {}),
      },
      data: { readAt: new Date() },
    });
    const unread = await unreadCount(user.id);

    if ("all" in parsed.data) log.info("inbox marked all read", { userId: user.id, marked: result.count });
    else log.debug("inbox items marked read", { userId: user.id, marked: result.count });

    return successResponse({ marked: result.count, unread });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    log.error("could not mark notifications read", {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse("Could not update your notifications", 500);
  }
}
