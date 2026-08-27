export const dynamic = "force-dynamic";

import { prisma } from "@/lib/db";
import { successResponse } from "@/lib/api-utils";
import { guarded } from "@/lib/staff-lms/route";
import { getLevelProgress } from "@/lib/staff-lms/xp";

/**
 * Leaderboard: all users with LMS progress, sorted by XP descending.
 *
 * Returns name, XP, level, title, streak — no personal detail. The per-person quiz/activity
 * breakdown is behind `approve` at GET /api/staff-lms/performance.
 */
export const GET = guarded("staff_lms_rank", "view", "staff-lms:rank", async () => {
  const rows = await prisma.lmsProgress.findMany({
    orderBy: { xp: "desc" },
    include: {
      user: { select: { id: true, name: true } },
    },
  });

  return successResponse(
    rows.map((r, i) => ({
      rank: i + 1,
      userId: r.user.id,
      name: r.user.name,
      xp: r.xp,
      streakDays: r.streakDays,
      ...getLevelProgress(r.xp),
    }))
  );
});
