export const dynamic = "force-dynamic";

import { prisma } from "@/lib/db";
import { successResponse } from "@/lib/api-utils";
import { lmsLessonUpdateSchema } from "@/lib/validations";
import { guarded, readBody, requireParam } from "@/lib/staff-lms/route";
import { serializeLmsLesson } from "@/lib/staff-lms/serialize";
import { AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";

const log = createLogger("staff-lms:lessons");

/**
 * One lesson FOR THE EDITOR — questions included, answer keys and all.
 *
 * The learner reads a lesson from `GET /api/staff-lms/learning/lessons/[id]/player`
 * (Phase 6), which strips `correctIndex`. This route is gated on `edit` for exactly that
 * reason: the difference between the two is the answer key, so the guard must be the thing
 * that separates them, not a query flag someone can flip.
 */
export const GET = guarded("staff_lms_learning", "edit", "staff-lms:lessons", async ({ params }) => {
  const id = requireParam(params, "id");
  const lesson = await prisma.lmsLesson.findUnique({
    where: { id },
    include: {
      questions: { orderBy: { sortOrder: "asc" } },
      level: { select: { id: true, title: true, courseId: true } },
    },
  });
  if (!lesson) throw new AuthError("Lesson not found", 404);

  const { questions, level, ...rest } = lesson;
  return successResponse({ ...serializeLmsLesson(rest), questions, level });
});

export const PUT = guarded(
  "staff_lms_learning",
  "edit",
  "staff-lms:lessons",
  async ({ req, params, user }) => {
    const id = requireParam(params, "id");
    const data = lmsLessonUpdateSchema.parse(await readBody(req));
    if ((await prisma.lmsLesson.count({ where: { id } })) === 0) {
      throw new AuthError("Lesson not found", 404);
    }
    const updated = await prisma.lmsLesson.update({ where: { id }, data });
    log.info("lesson updated", { lessonId: id, by: user.id });
    return successResponse(serializeLmsLesson(updated));
  }
);

/** Soft delete — `lms_lesson_progress` rows survive. See the courses route for why. */
export const DELETE = guarded(
  "staff_lms_learning",
  "delete",
  "staff-lms:lessons",
  async ({ params, user }) => {
    const id = requireParam(params, "id");
    if ((await prisma.lmsLesson.count({ where: { id } })) === 0) {
      throw new AuthError("Lesson not found", 404);
    }
    await prisma.lmsLesson.update({ where: { id }, data: { isActive: false } });
    log.info("lesson deactivated", { lessonId: id, by: user.id });
    return successResponse({ id, isActive: false });
  }
);
