export const dynamic = "force-dynamic";

import { prisma } from "@/lib/db";
import { successResponse } from "@/lib/api-utils";
import { lmsQuizAttemptSchema } from "@/lib/validations";
import { guarded, readBody, requireParam } from "@/lib/staff-lms/route";
import { awardXp } from "@/lib/staff-lms/progress";
import { AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";

const log = createLogger("staff-lms:quiz-attempts");

/**
 * Quiz attempt submission.
 *
 * THE SELF-PROGRESS CONTRACT — userId from session, never from body.
 * lmsQuizAttemptSchema is .strict() and declares only `answers`.
 *
 * Grading is entirely server-side: answers[i] is compared to questions[i].correctIndex.
 * The response never includes correctIndex — the quiz cannot be beaten from devtools.
 */
export const POST = guarded(
  "staff_lms_learning",
  "view",
  "staff-lms:quiz-attempts",
  async ({ req, params, user }) => {
    const quizId = requireParam(params, "id");
    const body = lmsQuizAttemptSchema.parse(await readBody(req));

    const quiz = await prisma.lmsQuiz.findUnique({
      where: { id: quizId },
      include: { questions: { orderBy: { sortOrder: "asc" } } },
    });
    if (!quiz) throw new AuthError("Quiz not found", 404);

    // Grade
    const total = quiz.questions.length;
    let score = 0;
    for (let i = 0; i < total; i++) {
      if (body.answers[i] === quiz.questions[i]?.correctIndex) score++;
    }
    const passed = total > 0 && (score / total) * 100 >= quiz.passingScore;
    const xpEarned = passed ? quiz.xpReward : 0;

    // Record the attempt
    await prisma.lmsQuizAttempt.create({
      data: {
        userId: user.id,
        quizId,
        score,
        total,
        passed,
        answers: body.answers,
        xpEarned,
      },
    });

    // Award XP if passed
    if (passed) {
      await awardXp(user.id, quiz.xpReward, "quiz_completed", { quizId });
    }

    log.info("quiz attempt recorded", { userId: user.id, quizId, score, total, passed });

    return successResponse({ quizId, score, total, passed, xpEarned });
  }
);
