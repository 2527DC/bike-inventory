export const dynamic = "force-dynamic";

import { prisma } from "@/lib/db";
import { successResponse } from "@/lib/api-utils";
import { lmsQuizUpdateSchema } from "@/lib/validations";
import { guarded, readBody, requireParam } from "@/lib/staff-lms/route";
import { AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";

const log = createLogger("staff-lms:quizzes");

/** Editor view — includes questions WITH their answer keys, hence `edit`. */
export const GET = guarded("staff_lms_learning", "edit", "staff-lms:quizzes", async ({ params }) => {
  const id = requireParam(params, "id");
  const quiz = await prisma.lmsQuiz.findUnique({
    where: { id },
    include: { questions: { orderBy: { sortOrder: "asc" } } },
  });
  if (!quiz) throw new AuthError("Quiz not found", 404);
  return successResponse(quiz);
});

export const PUT = guarded(
  "staff_lms_learning",
  "edit",
  "staff-lms:quizzes",
  async ({ req, params, user }) => {
    const id = requireParam(params, "id");
    const data = lmsQuizUpdateSchema.parse(await readBody(req));
    if ((await prisma.lmsQuiz.count({ where: { id } })) === 0) {
      throw new AuthError("Quiz not found", 404);
    }
    const updated = await prisma.lmsQuiz.update({ where: { id }, data });
    log.info("quiz updated", { quizId: id, by: user.id });
    return successResponse(updated);
  }
);

/** Soft delete — `lms_quiz_attempts` are a learner's history and must survive. */
export const DELETE = guarded(
  "staff_lms_learning",
  "delete",
  "staff-lms:quizzes",
  async ({ params, user }) => {
    const id = requireParam(params, "id");
    if ((await prisma.lmsQuiz.count({ where: { id } })) === 0) {
      throw new AuthError("Quiz not found", 404);
    }
    await prisma.lmsQuiz.update({ where: { id }, data: { isActive: false } });
    log.info("quiz deactivated", { quizId: id, by: user.id });
    return successResponse({ id, isActive: false });
  }
);
