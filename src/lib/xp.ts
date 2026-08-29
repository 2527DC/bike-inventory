import { prisma } from './db';

export function getLevelFromXp(xp: number): number {
  const thresholds = [0, 100, 300, 600, 1000, 1500, 2100, 2800, 3600, 4500, 5500];
  let level = 1;
  for (let i = 1; i < thresholds.length; i++) {
    if (xp >= thresholds[i]) level = i + 1;
    else break;
  }
  return level;
}

export function getXpForNextLevel(currentXp: number): { needed: number; total: number } {
  const thresholds = [0, 100, 300, 600, 1000, 1500, 2100, 2800, 3600, 4500, 5500];
  const level = getLevelFromXp(currentXp);
  if (level >= thresholds.length) return { needed: 0, total: 0 };
  const nextThreshold = thresholds[level];
  return { needed: nextThreshold - currentXp, total: nextThreshold };
}

export const LEVEL_TITLES = [
  'Rookie', 'Learner', 'Apprentice', 'Seller', 'Skilled Seller',
  'Senior Seller', 'Expert', 'Master', 'Sales Leader', 'Sales Champion', 'BCH Legend',
];

export function getLevelTitle(level: number): string {
  return LEVEL_TITLES[Math.min(level - 1, LEVEL_TITLES.length - 1)];
}

export async function awardXp(userId: string, amount: number, activityType: string, details: Record<string, string | number | boolean> = {}) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const progress = await prisma.lmsProgress.findUnique({ where: { userId } });

  let streakDays = progress?.streakDays || 0;
  let longestStreak = progress?.longestStreak || 0;

  if (progress) {
    const lastActive = new Date(progress.lastActiveDate);
    lastActive.setHours(0, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (lastActive.getTime() === yesterday.getTime()) {
      streakDays += 1;
    } else if (lastActive.getTime() !== today.getTime()) {
      streakDays = 1;
    }
    longestStreak = Math.max(longestStreak, streakDays);

    const newXp = progress.xp + amount;
    await prisma.lmsProgress.update({
      where: { userId },
      data: {
        xp: newXp,
        level: getLevelFromXp(newXp),
        streakDays,
        longestStreak,
        lastActiveDate: today,
      },
    });
  } else {
    await prisma.lmsProgress.create({
      data: {
        userId,
        xp: amount,
        level: getLevelFromXp(amount),
        streakDays: 1,
        longestStreak: 1,
        lastActiveDate: today,
      },
    });
  }

  await prisma.lmsActivityLog.create({
    data: { userId, activityType, details, xpEarned: amount },
  });

  await checkAchievements(userId);
}

async function checkAchievements(userId: string) {
  const [progress, achievements, earned, quizCount] = await Promise.all([
    prisma.lmsProgress.findUnique({ where: { userId } }),
    prisma.lmsAchievement.findMany(),
    prisma.lmsUserAchievement.findMany({ where: { userId }, select: { achievementId: true } }),
    prisma.lmsQuizAttempt.count({ where: { userId, passed: true } }),
  ]);
  const roleplayCount = 0;

  if (!progress) return;

  const earnedIds = new Set(earned.map((e: { achievementId: string }) => e.achievementId));

  for (const achievement of achievements) {
    if (earnedIds.has(achievement.id)) continue;

    let met = false;
    switch (achievement.criteriaType) {
      case 'quizzes_passed': met = quizCount >= achievement.criteriaValue; break;
      case 'roleplay_count': met = roleplayCount >= achievement.criteriaValue; break;
      case 'streak_days': met = progress.streakDays >= achievement.criteriaValue; break;
      case 'xp_total': met = progress.xp >= achievement.criteriaValue; break;
      case 'videos_watched': met = progress.videosWatched.length >= achievement.criteriaValue; break;
    }

    if (met) {
      await prisma.lmsUserAchievement.create({
        data: { userId, achievementId: achievement.id },
      });
      const newXp = progress.xp + achievement.xpReward;
      await prisma.lmsProgress.update({
        where: { userId },
        data: { xp: newXp, level: getLevelFromXp(newXp) },
      });
    }
  }
}
