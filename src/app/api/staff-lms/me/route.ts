export const dynamic = "force-dynamic";

import { prisma } from "@/lib/db";
import { successResponse } from "@/lib/api-utils";
import { guarded } from "@/lib/staff-lms/route";
import { ensureProgress } from "@/lib/staff-lms/progress";
import { getLevelProgress } from "@/lib/staff-lms/xp";

/**
 * Learner profile: progress, achievements earned, recent activity.
 */
export const GET = guarded("staff_lms", "view", "staff-lms:me", async ({ user }) => {
  const progress = await ensureProgress(user.id);

  const [achievements, recentActivity] = await Promise.all([
    prisma.lmsUserAchievement.findMany({
      where: { userId: user.id },
      include: { achievement: true },
      orderBy: { earnedAt: "desc" },
    }),
    prisma.lmsActivityLog.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
  ]);

  return successResponse({
    user: { id: user.id, name: user.name },
    progress: {
      xp: progress.xp,
      streakDays: progress.streakDays,
      longestStreak: progress.longestStreak,
      lastActiveDate: progress.lastActiveDate,
      videosWatched: progress.videosWatched.length,
      scenariosCompleted: progress.scenariosCompleted.length,
      ...getLevelProgress(progress.xp),
    },
    achievements: achievements.map((ua) => ({
      ...ua.achievement,
      earnedAt: ua.earnedAt,
    })),
    recentActivity,
  });
});
