export const dynamic = "force-dynamic";

import { prisma } from "@/lib/db";
import { successResponse } from "@/lib/api-utils";
import { guarded } from "@/lib/staff-lms/route";
import { ensureProgress } from "@/lib/staff-lms/progress";
import { getLevelProgress } from "@/lib/staff-lms/xp";
import { serializeLmsProduct } from "@/lib/staff-lms/serialize";

/**
 * Dashboard data: XP/level/streak, daily tip, announcements, stat tiles, continue-learning.
 *
 * This is the heaviest read in the module — seven parallel queries, each index-backed. The
 * alternative is a single screen-specific view, which is more coupling than ~7ms of latency.
 */
export const GET = guarded("staff_lms", "view", "staff-lms:dashboard", async ({ user }) => {
  const progress = await ensureProgress(user.id);
  const today = new Date();

  const [
    tip,
    announcements,
    lessonsCompleted,
    videosWatched,
    quizzesPassed,
    playbooksDone,
    recentActivity,
    achievements,
  ] = await Promise.all([
    // Random active tip for today (or any active tip if none scheduled)
    prisma.lmsDailyTip
      .findFirst({
        where: {
          isActive: true,
          OR: [{ scheduledFor: null }, { scheduledFor: { lte: today } }],
        },
        orderBy: { createdAt: "desc" },
      })
      .then((t) => t?.content ?? null),

    // Active, non-expired announcements
    prisma.lmsAnnouncement.findMany({
      where: {
        isActive: true,
        OR: [{ expiresAt: null }, { expiresAt: { gt: today } }],
      },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),

    // Stat tiles
    prisma.lmsLessonProgress.count({ where: { userId: user.id, completed: true } }),
    // videosWatched is a String[] on progress — its length IS the count
    Promise.resolve(progress.videosWatched.length),
    prisma.lmsQuizAttempt.count({ where: { userId: user.id, passed: true } }),
    Promise.resolve(progress.scenariosCompleted.length),

    // Continue learning: last 4 activity entries
    prisma.lmsActivityLog.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 4,
    }),

    // Earned achievements
    prisma.lmsUserAchievement.findMany({
      where: { userId: user.id },
      include: { achievement: true },
    }),
  ]);

  return successResponse({
    progress: {
      xp: progress.xp,
      streakDays: progress.streakDays,
      longestStreak: progress.longestStreak,
      lastActiveDate: progress.lastActiveDate,
      ...getLevelProgress(progress.xp),
    },
    tip,
    announcements,
    stats: {
      lessonsCompleted,
      videosWatched,
      quizzesPassed,
      playbooksDone,
    },
    recentActivity,
    achievements: achievements.map((ua) => ({
      ...ua.achievement,
      earnedAt: ua.earnedAt,
    })),
  });
});
