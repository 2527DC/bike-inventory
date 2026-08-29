export const dynamic = "force-dynamic";

import { prisma } from "@/lib/db";
import { successResponse } from "@/lib/api-utils";
import { lmsWeeklyTestAttemptSchema } from "@/lib/validations";
import { guarded, readBody, requireParam } from "@/lib/staff-lms/route";
import { awardXp } from "@/lib/staff-lms/progress";
import { AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";

const log = createLogger("staff-lms:weekly-test-attempts");

/**
 * Weekly test attempt submission. Same shape as quiz attempts.
 *
 * THE SELF-PROGRESS CONTRACT — userId from session, never from body.
 * lmsWeeklyTestAttemptSchema is .strict() and declares only `answers`.
 */
export const POST = guarded(
  "staff_lms_learning",
  "view",
  "staff-lms:weekly-test-attempts",
  async ({ req, params, user }) => {
    const testId = requireParam(params, "id");
    const body = lmsWeeklyTestAttemptSchema.parse(await readBody(req));

    const test = await prisma.lmsWeeklyTest.findUnique({
      where: { id: testId },
      include: { questions: { orderBy: { sortOrder: "asc" } } },
    });
    if (!test) throw new AuthError("Weekly test not found", 404);

    // Grade
    const total = test.questions.length;
    let score = 0;
    for (let i = 0; i < total; i++) {
      if (body.answers[i] === test.questions[i]?.correctIndex) score++;
    }
    const passed = total > 0 && (score / total) * 100 >= test.passingScore;
    const xpEarned = passed ? test.xpReward : 0;

    // Record the attempt
    await prisma.lmsWeeklyTestAttempt.create({
      data: {
        userId: user.id,
        testId,
        score,
        total,
        passed,
        answers: body.answers,
        xpEarned,
      },
    });

    // Award XP if passed
    if (passed) {
      await awardXp(user.id, test.xpReward, "weekly_test_completed", { testId });
    }

    log.info("weekly test attempt recorded", { userId: user.id, testId, score, total, passed });

    return successResponse({ testId, score, total, passed, xpEarned });
  }
);
