// ─── Shared CRUD for the three question tables ───────────────────────────────
// SERVER ONLY.
//
// `lms_lesson_questions`, `lms_quiz_questions` and `lms_weekly_test_questions` have
// IDENTICAL columns and differ only in the name of their parent foreign key. Written out
// per table that is six route files repeating the same eight operations — and the failure
// mode of that duplication is specific and nasty: the answer-key strip (§4.4) gets applied
// in two of the three, and the third quietly serves `correctIndex` to learners forever.
//
// So the shape is declared once here, and the route files supply only which table they are.
// Each route file still names its own module and action in `guarded(...)`, so the guards
// stay greppable — see src/lib/staff-lms/route.ts for why that matters.

import { prisma } from "@/lib/db";
import { successResponse } from "@/lib/api-utils";
import { lmsQuestionSchema } from "@/lib/validations";
import { readBody, type LmsRouteContext } from "@/lib/staff-lms/route";
import { AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";

const log = createLogger("staff-lms:questions");

export type QuestionTable = "lesson" | "quiz" | "weeklyTest";

/** Everything that differs between the three tables, in one place. */
const TABLES = {
  lesson: {
    delegate: () => prisma.lmsLessonQuestion,
    parentField: "lessonId" as const,
    parentParam: "id",
    parentExists: (id: string) => prisma.lmsLesson.count({ where: { id } }),
    label: "lms_lesson_questions",
  },
  quiz: {
    delegate: () => prisma.lmsQuizQuestion,
    parentField: "quizId" as const,
    parentParam: "id",
    parentExists: (id: string) => prisma.lmsQuiz.count({ where: { id } }),
    label: "lms_quiz_questions",
  },
  weeklyTest: {
    delegate: () => prisma.lmsWeeklyTestQuestion,
    parentField: "testId" as const,
    parentParam: "id",
    parentExists: (id: string) => prisma.lmsWeeklyTest.count({ where: { id } }),
    label: "lms_weekly_test_questions",
  },
};

/**
 * List every question for a parent, WITH the answer key.
 *
 * Callers must gate this on `edit`, never `view`. The learner-facing read is a different
 * endpoint that runs the rows through `toLearnerQuestion()` to strip `correctIndex`; this
 * one exists so the content editor can see and change the key.
 */
export async function listQuestions(table: QuestionTable, ctx: LmsRouteContext) {
  const t = TABLES[table];
  const parentId = ctx.params[t.parentParam];
  if (!parentId) throw new AuthError("Missing parent id", 400);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = await (t.delegate() as any).findMany({
    where: { [t.parentField]: parentId },
    orderBy: { sortOrder: "asc" },
  });
  return successResponse(rows);
}

export async function createQuestion(table: QuestionTable, ctx: LmsRouteContext) {
  const t = TABLES[table];
  const parentId = ctx.params[t.parentParam];
  if (!parentId) throw new AuthError("Missing parent id", 400);

  // Checked explicitly rather than relying on the FK: Prisma surfaces a violation as
  // P2003, which `failure()` would report as a 500. A question posted against a lesson
  // that does not exist is a 404, and the client can act on that.
  if ((await t.parentExists(parentId)) === 0) {
    throw new AuthError("Parent not found", 404);
  }

  const data = lmsQuestionSchema.parse(await readBody(ctx.req));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const created = await (t.delegate() as any).create({
    data: { ...data, [t.parentField]: parentId },
  });
  log.info("question created", { table: t.label, parentId, questionId: created.id });
  return successResponse(created, 201);
}

export async function updateQuestion(table: QuestionTable, ctx: LmsRouteContext) {
  const t = TABLES[table];
  const questionId = ctx.params.questionId;
  if (!questionId) throw new AuthError("Missing questionId", 400);

  const data = lmsQuestionSchema.parse(await readBody(ctx.req));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const existing = await (t.delegate() as any).findUnique({ where: { id: questionId } });
  if (!existing) throw new AuthError("Question not found", 404);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updated = await (t.delegate() as any).update({ where: { id: questionId }, data });
  log.info("question updated", { table: t.label, questionId });
  return successResponse(updated);
}

export async function deleteQuestion(table: QuestionTable, ctx: LmsRouteContext) {
  const t = TABLES[table];
  const questionId = ctx.params.questionId;
  if (!questionId) throw new AuthError("Missing questionId", 400);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const existing = await (t.delegate() as any).findUnique({ where: { id: questionId } });
  if (!existing) throw new AuthError("Question not found", 404);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (t.delegate() as any).delete({ where: { id: questionId } });
  log.info("question deleted", { table: t.label, questionId });
  return successResponse({ id: questionId });
}
