export const dynamic = "force-dynamic";

import { prisma } from "@/lib/db";
import { successResponse } from "@/lib/api-utils";
import { lmsCourseUpdateSchema } from "@/lib/validations";
import { guarded, readBody, requireParam } from "@/lib/staff-lms/route";
import { AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";

const log = createLogger("staff-lms:courses");

export const GET = guarded("staff_lms_learning", "view", "staff-lms:courses", async ({ params }) => {
  const id = requireParam(params, "id");
  const course = await prisma.lmsCourse.findUnique({
    where: { id },
    include: {
      levels: {
        orderBy: { sortOrder: "asc" },
        include: { lessons: { orderBy: { sortOrder: "asc" } } },
      },
    },
  });
  if (!course) throw new AuthError("Course not found", 404);
  return successResponse(course);
});

export const PUT = guarded(
  "staff_lms_learning",
  "edit",
  "staff-lms:courses",
  async ({ req, params, user }) => {
    const id = requireParam(params, "id");
    const data = lmsCourseUpdateSchema.parse(await readBody(req));
    if ((await prisma.lmsCourse.count({ where: { id } })) === 0) {
      throw new AuthError("Course not found", 404);
    }
    const updated = await prisma.lmsCourse.update({ where: { id }, data });
    log.info("course updated", { courseId: id, by: user.id });
    return successResponse(updated);
  }
);

/**
 * Soft delete. `isActive: false` hides the course from learners and leaves every
 * `lms_lesson_progress` row intact.
 *
 * A hard delete would cascade course -> levels -> lessons -> lesson_progress, silently
 * erasing completions people earned. The schema's Cascade is right for a genuine removal;
 * it is the wrong default for a button labelled "delete" on a content screen.
 */
export const DELETE = guarded(
  "staff_lms_learning",
  "delete",
  "staff-lms:courses",
  async ({ params, user }) => {
    const id = requireParam(params, "id");
    if ((await prisma.lmsCourse.count({ where: { id } })) === 0) {
      throw new AuthError("Course not found", 404);
    }
    await prisma.lmsCourse.update({ where: { id }, data: { isActive: false } });
    log.info("course deactivated", { courseId: id, by: user.id });
    return successResponse({ id, isActive: false });
  }
);
