// ─── XP and levels — PURE ────────────────────────────────────────────────────
// No imports beyond constants. No Prisma, no logger, no `server-only`.
//
// That is deliberate and load-bearing: the XP bar, the level badge and the "N XP to
// <title>" caption all render in the browser, and every LMS screen is a client component.
// A single `import { prisma }` here would pull the query engine into a client bundle and
// fail the build with an error that names webpack, not this file.
//
// Anything that WRITES progress lives in ./progress.ts, which is server-only.

import { LMS_LEVEL_THRESHOLDS, LMS_LEVEL_TITLES } from "@/lib/staff-lms/constants";

/** Level for a given XP total. Level 1 at 0 XP; capped at the last threshold. */
export function getLevelFromXp(xp: number): number {
  let level = 1;
  for (let i = 1; i < LMS_LEVEL_THRESHOLDS.length; i++) {
    if (xp >= LMS_LEVEL_THRESHOLDS[i]) level = i + 1;
    else break;
  }
  return level;
}

/** Display title for a level, e.g. 3 -> "Apprentice". Clamped at both ends. */
export function getLevelTitle(level: number): string {
  const i = Math.min(Math.max(level, 1) - 1, LMS_LEVEL_TITLES.length - 1);
  return LMS_LEVEL_TITLES[i];
}

export interface LevelProgress {
  level: number;
  title: string;
  /** XP still needed to reach the next level. 0 at max level. */
  needed: number;
  /** XP total at which the next level begins. 0 at max level. */
  nextAt: number;
  /** 0-1, how far through the CURRENT level this XP sits. 1 at max level. */
  fraction: number;
  /** True once no further level exists. */
  isMax: boolean;
}

/**
 * Everything the XP bar needs, in one call.
 *
 * `fraction` measures progress through the current band, not through the whole scale —
 * the source app's bar divided by the next threshold alone, so a learner at level 5 with
 * 1,000 XP showed a bar two-thirds full and it never appeared to reset. Here each level
 * starts the bar at empty, which is what makes the animation mean anything.
 */
export function getLevelProgress(xp: number): LevelProgress {
  const level = getLevelFromXp(xp);
  const title = getLevelTitle(level);
  const isMax = level >= LMS_LEVEL_THRESHOLDS.length;

  if (isMax) return { level, title, needed: 0, nextAt: 0, fraction: 1, isMax: true };

  const bandStart = LMS_LEVEL_THRESHOLDS[level - 1];
  const bandEnd = LMS_LEVEL_THRESHOLDS[level];
  const span = bandEnd - bandStart;

  return {
    level,
    title,
    needed: bandEnd - xp,
    nextAt: bandEnd,
    // `span` cannot be 0 with the current thresholds, but a future edit that repeats a
    // value would otherwise produce NaN and render an invisible bar.
    fraction: span > 0 ? Math.min(Math.max((xp - bandStart) / span, 0), 1) : 0,
    isMax: false,
  };
}
