export const dynamic = "force-dynamic";

import { prisma } from "@/lib/db";
import { successResponse } from "@/lib/api-utils";
import { lmsLessonProgressSchema } from "@/lib/validations";
import { guarded, readBody, requireParam } from "@/lib/staff-lms/route";
import { awardXp } from "@/lib/staff-lms/progress";
import { AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";

const log = createLogger("staff-lms:lesson-progress");

/**
 * Lesson progress: video watched, checklist done, quiz answers.
 *
 * THE SELF-PROGRESS CONTRACT — userId from session, never from body.
 * lmsLessonProgressSchema is .strict() and declares no userId.
 *
 * Grading is server-side: if `answers` is provided, they are compared against the lesson's
 * questions' `correctIndex`. Completion awards XP only once (tracked by `xpEarned`).
 */
export const POST = guarded(
  "staff_lms_learning",
  "view",
  "staff-lms:lesson-progress",
  async ({ req, params, user }) => {
    const lessonId = requireParam(params, "id");
    const body = lmsLessonProgressSchema.parse(await readBody(req));

    // Verify lesson exists
    const lesson = await prisma.lmsLesson.findUnique({
      where: { id: lessonId },
      include: { questions: { orderBy: { sortOrder: "asc" } } },
    });
    if (!lesson) throw new AuthError("Lesson not found", 404);

    // Build the update data
    const updateData: Record<string, unknown> = {};

    if (body.videoWatched !== undefined) updateData.videoWatched = body.videoWatched;
    if (body.checklistDone !== undefined) updateData.checklistDone = body.checklistDone;

    // Grade quiz answers server-side
    let quizScore: number | null = null;
    let quizTotal: number | null = null;
    let quizPassed = false;

    if (body.answers && lesson.questions.length > 0) {
      quizTotal = lesson.questions.length;
      quizScore = 0;
      for (let i = 0; i < lesson.questions.length; i++) {
        if (body.answers[i] === lesson.questions[i].correctIndex) {
          quizScore++;
        }
      }
      quizPassed = quizTotal > 0 && (quizScore / quizTotal) * 100 >= 70;
      updateData.quizScore = quizScore;
      updateData.quizTotal = quizTotal;
      updateData.quizPassed = quizPassed;
    }

    // Upsert progress row
    const progress = await prisma.lmsLessonProgress.upsert({
      where: { userId_lessonId: { userId: user.id, lessonId } },
      create: {
        userId: user.id,
        lessonId,
        ...updateData,
      },
      update: updateData,
    });

    // Check completion: video watched + quiz passed (if there are questions)
    const isComplete =
      progress.videoWatched &&
      (lesson.questions.length === 0 || progress.quizPassed);

    let xpEarned = 0;
    if (isComplete && !progress.completed) {
      // Mark completed and award XP — only once
      await prisma.lmsLessonProgress.update({
        where: { id: progress.id },
        data: { completed: true, completedAt: new Date(), xpEarned: lesson.xpReward },
      });
      await awardXp(user.id, lesson.xpReward, "lesson_completed", { lessonId });
      xpEarned = lesson.xpReward;
      log.info("lesson completed", { userId: user.id, lessonId, xpEarned });
    }

    return successResponse({
      lessonId,
      videoWatched: progress.videoWatched,
      quizScore,
      quizTotal,
      quizPassed,
      completed: isComplete || progress.completed,
      xpEarned,
    });
  }
);
