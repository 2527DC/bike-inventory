export const dynamic = "force-dynamic";

import { prisma } from "@/lib/db";
import { successResponse } from "@/lib/api-utils";
import { guarded } from "@/lib/staff-lms/route";
import { getLevelProgress } from "@/lib/staff-lms/xp";

/**
 * Team performance detail — guarded on `approve`, not `view`.
 *
 * Per-person: XP, level, streak, quiz pass/fail, last-active, 7-day activity.
 * No roleplay column (R7). Names are read-only — team management is at /team (R11).
 */
export const GET = guarded("staff_lms", "approve", "staff-lms:performance", async () => {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const users = await prisma.lmsProgress.findMany({
    orderBy: { xp: "desc" },
    include: {
      user: { select: { id: true, name: true } },
    },
  });

  const userIds = users.map((u) => u.userId);

  const [quizAttempts, weeklyTestAttempts, recentActivity] = await Promise.all([
    prisma.lmsQuizAttempt.groupBy({
      by: ["userId"],
      where: { userId: { in: userIds } },
      _count: { id: true },
      _sum: { score: true },
    }),
    prisma.lmsWeeklyTestAttempt.groupBy({
      by: ["userId"],
      where: { userId: { in: userIds } },
      _count: { id: true },
    }),
    prisma.lmsActivityLog.findMany({
      where: { userId: { in: userIds }, createdAt: { gte: sevenDaysAgo } },
      select: { userId: true, activityType: true, createdAt: true, xpEarned: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  // Index for O(1) lookup
  const quizMap = new Map(quizAttempts.map((q) => [q.userId, q]));
  const testMap = new Map(weeklyTestAttempts.map((t) => [t.userId, t]));
  const activityByUser = new Map<string, typeof recentActivity>();
  for (const a of recentActivity) {
    const list = activityByUser.get(a.userId) ?? [];
    list.push(a);
    activityByUser.set(a.userId, list);
  }

  return successResponse(
    users.map((r) => {
      const quiz = quizMap.get(r.userId);
      const test = testMap.get(r.userId);
      return {
        userId: r.user.id,
        name: r.user.name,
        xp: r.xp,
        streakDays: r.streakDays,
        lastActiveDate: r.lastActiveDate,
        ...getLevelProgress(r.xp),
        quizAttempts: quiz?._count.id ?? 0,
        weeklyTestAttempts: test?._count.id ?? 0,
        recentActivity: activityByUser.get(r.userId) ?? [],
      };
    })
  );
});
