export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireAuth, AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";
import { unreadCount } from "@/lib/notify/inbox";
import type { InboxItem } from "@/lib/notify/types";

const log = createLogger("notifications:inbox");

// The SESSION user's own notifications (plan 2309, Part D). Authentication only, like
// /api/notifications/preferences: there is no module to check, because the only rows this can
// ever return are the caller's own — every query is pinned to `user.id`, never to a parameter.
//
//   GET ?count=1        → { unread }             the header bell and the app-icon badge
//   GET ?cursor=<id>    → { items, nextCursor, unread }   30 at a time, newest first

const PAGE = 30;

const QuerySchema = z.object({
  count: z.enum(["1"]).optional(),
  cursor: z.string().trim().min(1).max(64).optional(),
});

export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth();

    const parsed = QuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
    if (!parsed.success) {
      return errorResponse(parsed.error.issues[0]?.message || "Invalid query", 400);
    }

    if (parsed.data.count) {
      const unread = await unreadCount(user.id);
      log.debug("<- GET inbox count", { userId: user.id, unread });
      return successResponse({ unread });
    }

    const cursor = parsed.data.cursor;
    const rows = await prisma.notificationInbox.findMany({
      where: { userId: user.id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: PAGE + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, eventKey: true, title: true, body: true, link: true, readAt: true, createdAt: true },
    });
    const hasMore = rows.length > PAGE;
    const page = hasMore ? rows.slice(0, PAGE) : rows;

    const items: InboxItem[] = page.map((r) => ({
      ...r,
      readAt: r.readAt ? r.readAt.toISOString() : null,
      createdAt: r.createdAt.toISOString(),
    }));
    const unread = await unreadCount(user.id);

    log.debug("<- GET inbox", { userId: user.id, items: items.length, hasMore, unread });
    return successResponse({ items, nextCursor: hasMore ? page[page.length - 1].id : null, unread });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    log.error("could not read inbox", {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse("Could not load your notifications", 500);
  }
}
