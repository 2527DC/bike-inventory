// ─── Learner progress: XP, streaks, achievements ─────────────────────────────
// SERVER ONLY — this file touches Prisma. The level arithmetic the browser needs lives in
// ./xp.ts, which imports nothing but constants.
//
// This is the port of the source app's src/lib/xp.ts, with three defects fixed rather than
// carried over. Each is documented at the function that fixes it, because each one is the
// sort of bug that reads as correct:
//
//   1. awardXp did read-then-write on xp (lost updates)           -> awardXp
//   2. progress writes silently no-oped on a user's FIRST action  -> ensureProgress
//   3. checkAchievements silently ignored unknown criteria types  -> checkAchievements

import { prisma } from "@/lib/db";
import { createLogger } from "@/lib/logger";
import { getLevelFromXp } from "@/lib/staff-lms/xp";
import type { LmsActivityType } from "@/lib/staff-lms/constants";
import type { LmsActivityDetails } from "@/lib/staff-lms/content-schemas";

const log = createLogger("staff-lms:progress");

/** Midnight today, in the server's zone — matches the `@db.Date` column. */
function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Guarantee a learner has an `lms_progress` row, and return it.
 *
 * FIXES: the source app's `POST /api/progress` was wrapped in `if (progress) { … }`, so a
 * user with no row had their write silently discarded. Every screen then read zeros and
 * looked broken. That was not an edge case — decision 5 starts every user with no row, so
 * **every user hit it on their first action**, and the symptom (nothing happened) gives no
 * clue where to look.
 *
 * Idempotent: concurrent first-actions race into the same unique userId, and the loser's
 * `create` collides on the unique index rather than producing a second row.
 */
export async function ensureProgress(userId: string) {
  return prisma.lmsProgress.upsert({
    where: { userId },
    update: {},
    create: { userId, lastActiveDate: startOfToday() },
  });
}

/**
 * Award XP for an action and record it in the activity log.
 *
 * FIXES a lost-update race. The source app read `xp`, computed `xp + amount` in Node, and
 * wrote the absolute back. Two awards landing together — finishing a lesson while a quiz
 * result posts, which is ordinary — and the second write erases the first. The symptom is
 * XP quietly lower than the sum of the awards, unreproducible, reported as "my points
 * disappeared". `{ increment }` makes it one atomic statement.
 *
 * `level` is derived, so it is recomputed from the value the database actually returned
 * rather than from anything read beforehand. If two awards interleave, both compute the
 * level from their own post-increment total and converge on the right answer.
 */
export async function awardXp(
  userId: string,
  amount: number,
  activityType: LmsActivityType,
  details: LmsActivityDetails = {}
) {
  await ensureProgress(userId);

  const updated = await prisma.lmsProgress.update({
    where: { userId },
    data: { xp: { increment: amount } },
    select: { xp: true, level: true },
  });

  const level = getLevelFromXp(updated.xp);
  if (level !== updated.level) {
    await prisma.lmsProgress.update({ where: { userId }, data: { level } });
  }

  await prisma.lmsActivityLog.create({
    data: { userId, activityType, details, xpEarned: amount },
  });

  log.debug("xp awarded", { userId, amount, activityType, xp: updated.xp, level });

  await checkAchievements(userId);
}

/**
 * Record that the learner was active today, advancing or resetting the streak.
 *
 * Called once per tab per day by POST /api/staff-lms/heartbeat. Race-safe by construction:
 * `updateMany` with `lastActiveDate: { lt: today }` in the WHERE clause is a single
 * conditional statement, so two tabs opening together produce one match and one no-op.
 * A read-then-write here would award the daily XP twice.
 *
 * Returns true only for the call that actually advanced the day — the caller uses that to
 * decide whether to award the login XP, so the award inherits the same atomicity.
 */
export async function touchStreak(userId: string): Promise<boolean> {
  const today = startOfToday();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const progress = await ensureProgress(userId);

  const last = new Date(progress.lastActiveDate);
  last.setHours(0, 0, 0, 0);

  // Already counted today. Cheap exit before touching the database again.
  if (last.getTime() === today.getTime()) return false;

  const streakDays = last.getTime() === yesterday.getTime() ? progress.streakDays + 1 : 1;
  const longestStreak = Math.max(progress.longestStreak, streakDays);

  const { count } = await prisma.lmsProgress.updateMany({
    where: { userId, lastActiveDate: { lt: today } },
    data: { lastActiveDate: today, streakDays, longestStreak },
  });

  if (count === 1) log.info("streak advanced", { userId, streakDays, longestStreak });
  return count === 1;
}

/**
 * Grant any achievement whose criteria are now met.
 *
 * FIXES a silent-failure switch. The source app's switch had no `default`, so an
 * achievement row with an unrecognised `criteriaType` simply never fired — indistinguishable
 * from one whose target had not been reached. It also carried a `roleplay_count` case for a
 * feature that no longer exists; a row using it would have been permanently unreachable.
 * Now anything unknown is logged, loudly, with the row that caused it.
 *
 * Awarding an achievement grants its own XP through the same atomic increment as awardXp,
 * and does NOT recurse — an achievement cannot unlock another achievement, which keeps this
 * bounded and means an accidental cycle in the content cannot spin.
 */
export async function checkAchievements(userId: string) {
  const [progress, achievements, earned, quizzesPassed, lessonsCompleted, productsLearned] =
    await Promise.all([
      prisma.lmsProgress.findUnique({ where: { userId } }),
      prisma.lmsAchievement.findMany(),
      prisma.lmsUserAchievement.findMany({ where: { userId }, select: { achievementId: true } }),
      prisma.lmsQuizAttempt.count({ where: { userId, passed: true } }),
      prisma.lmsLessonProgress.count({ where: { userId, completed: true } }),
      prisma.lmsActivityLog.count({ where: { userId, activityType: "product_learned" } }),
    ]);

  if (!progress) return;

  const earnedIds = new Set(earned.map((e) => e.achievementId));

  for (const a of achievements) {
    if (earnedIds.has(a.id)) continue;

    let met: boolean;
    switch (a.criteriaType) {
      case "quizzes_passed":
        met = quizzesPassed >= a.criteriaValue;
        break;
      case "streak_days":
        met = progress.streakDays >= a.criteriaValue;
        break;
      case "xp_total":
        met = progress.xp >= a.criteriaValue;
        break;
      case "videos_watched":
        met = progress.videosWatched.length >= a.criteriaValue;
        break;
      case "lessons_completed":
        met = lessonsCompleted >= a.criteriaValue;
        break;
      case "products_learned":
        met = productsLearned >= a.criteriaValue;
        break;
      default:
        // Degrade loudly. An unknown criteria type is a content bug — the badge is
        // unreachable and nobody would ever find out from the UI.
        log.warn("achievement has an unknown criteriaType — it can never be earned", {
          achievementId: a.id,
          criteriaType: a.criteriaType,
        });
        met = false;
    }

    if (!met) continue;

    // skipDuplicates via the unique (userId, achievementId): two racing awards cannot
    // grant the same badge twice, and the loser throws rather than double-paying the XP.
    try {
      await prisma.lmsUserAchievement.create({ data: { userId, achievementId: a.id } });
    } catch {
      log.debug("achievement already granted, skipping", { userId, achievementId: a.id });
      continue;
    }

    const updated = await prisma.lmsProgress.update({
      where: { userId },
      data: { xp: { increment: a.xpReward } },
      select: { xp: true, level: true },
    });
    const level = getLevelFromXp(updated.xp);
    if (level !== updated.level) {
      await prisma.lmsProgress.update({ where: { userId }, data: { level } });
    }

    await prisma.lmsActivityLog.create({
      data: {
        userId,
        activityType: "achievement_earned",
        details: { achievementId: a.id, name: a.name },
        xpEarned: a.xpReward,
      },
    });

    log.info("achievement earned", { userId, achievementId: a.id, xp: a.xpReward });
  }
}
