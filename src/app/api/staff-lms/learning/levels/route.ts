export const dynamic = "force-dynamic";

import { prisma } from "@/lib/db";
import { successResponse } from "@/lib/api-utils";
import { lmsCourseLevelSchema } from "@/lib/validations";
import { guarded, readBody } from "@/lib/staff-lms/route";
import { AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";

const log = createLogger("staff-lms:levels");

/**
 * Levels for one course. `?courseId=` is required — a flat list of every level in the
 * system belongs to no screen, and returning one invites a client to filter in the browser.
 */
export const GET = guarded("staff_lms_learning", "view", "staff-lms:levels", async ({ req }) => {
  const courseId = new URL(req.url).searchParams.get("courseId");
  if (!courseId) throw new AuthError("courseId is required", 400);

  const levels = await prisma.lmsCourseLevel.findMany({
    where: { courseId },
    orderBy: { sortOrder: "asc" },
    include: { _count: { select: { lessons: true } } },
  });
  return successResponse(levels);
});

export const POST = guarded(
  "staff_lms_learning",
  "create",
  "staff-lms:levels",
  async ({ req, user }) => {
    const data = lmsCourseLevelSchema.parse(await readBody(req));
    if ((await prisma.lmsCourse.count({ where: { id: data.courseId } })) === 0) {
      throw new AuthError("Course not found", 404);
    }
    const created = await prisma.lmsCourseLevel.create({ data });
    log.info("level created", { levelId: created.id, courseId: data.courseId, by: user.id });
    return successResponse(created, 201);
  }
);
