// ─── The /notifications inbox ─────────────────────────────────────────────────
//
// Plan 2309, Part D. notify() writes one NotificationInbox row per active recipient of an event
// that is switched on, and this module owns that write, the 200-row trim and the unread count
// that rides along on each push so the service worker can badge the app icon.
//
// No cron prunes this table (CLAUDE.md, "There are no scheduled jobs"), so the trim happens in
// the same transaction as the insert: a user's inbox can never hold more than INBOX_KEEP rows
// for longer than one write.

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { createLogger } from "@/lib/logger";

const log = createLogger("notify:inbox");

/** Rows kept per user (owner, 23 Sep 2026, plan 2309 Q15). */
export const INBOX_KEEP = 200;

export interface InboxEntry {
  eventKey: string;
  title: string;
  body: string;
  link: string | null;
  refId: string | null;
}

/**
 * Write `entry` into each user's inbox, trim each to the newest INBOX_KEEP, and return every
 * user's unread count afterwards.
 *
 * Never throws — notify() must not fail its caller (rule 1 in index.ts). On failure it logs
 * and returns an empty map; the pushes then simply go out without a badge count.
 */
export async function writeInbox(userIds: string[], entry: InboxEntry): Promise<Map<string, number>> {
  const unread = new Map<string, number>();
  if (userIds.length === 0) return unread;

  try {
    await prisma.$transaction([
      prisma.notificationInbox.createMany({
        data: userIds.map((userId) => ({ userId, ...entry })),
      }),
      // Everything past each user's newest INBOX_KEEP. `id DESC` breaks ties between rows that
      // share a createdAt, so the trim is deterministic. Parameterised: ${} is a bind value.
      prisma.$executeRaw`
        DELETE FROM "notification_inbox" WHERE "id" IN (
          SELECT "id" FROM (
            SELECT "id", row_number() OVER (PARTITION BY "userId" ORDER BY "createdAt" DESC, "id" DESC) AS rn
            FROM "notification_inbox"
            WHERE "userId" IN (${Prisma.join(userIds)})
          ) ranked
          WHERE rn > ${INBOX_KEEP}
        )`,
    ]);

    const counts = await prisma.notificationInbox.groupBy({
      by: ["userId"],
      where: { userId: { in: userIds }, readAt: null },
      _count: { _all: true },
    });
    for (const c of counts) unread.set(c.userId, c._count._all);

    log.debug("inbox written", { eventKey: entry.eventKey, refId: entry.refId, users: userIds.length });
  } catch (error) {
    log.error("inbox write failed", {
      eventKey: entry.eventKey,
      refId: entry.refId,
      users: userIds.length,
      error: error instanceof Error ? error.message : String(error),
    });
    unread.clear();
  }
  return unread;
}

/** One user's unread count. Shared by the inbox routes so the bell and the list never disagree. */
export function unreadCount(userId: string): Promise<number> {
  return prisma.notificationInbox.count({ where: { userId, readAt: null } });
}
