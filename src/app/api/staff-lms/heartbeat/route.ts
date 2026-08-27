export const dynamic = "force-dynamic";

import { successResponse } from "@/lib/api-utils";
import { lmsHeartbeatSchema } from "@/lib/validations";
import { guarded, readBody } from "@/lib/staff-lms/route";
import { touchStreak, awardXp } from "@/lib/staff-lms/progress";
import { LMS_XP } from "@/lib/staff-lms/constants";

/**
 * Daily streak ping — the layout side effect, moved to an endpoint (§5.5).
 *
 * Called once per tab per day from _components/streak-heartbeat.tsx. Uses `touchStreak`,
 * which is race-safe: `updateMany` with `lastActiveDate < today` in the WHERE is a single
 * conditional statement, so two tabs posting together produce one match and one no-op.
 *
 * THE SELF-PROGRESS CONTRACT — the body is empty. The session IS the whole request.
 * lmsHeartbeatSchema is .strict() and z.object({}) — anything in the body is a 400.
 */
export const POST = guarded(
  "staff_lms",
  "view",
  "staff-lms:heartbeat",
  async ({ req, user }) => {
    // Validate the body is empty (strict schema rejects any keys)
    lmsHeartbeatSchema.parse(await readBody(req));

    const advanced = await touchStreak(user.id);

    if (advanced) {
      await awardXp(user.id, LMS_XP.dailyLogin, "login");
    }

    return successResponse({ advanced, streakDays: advanced ? undefined : null });
  }
);
