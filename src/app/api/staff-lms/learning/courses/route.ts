export const dynamic = "force-dynamic";

import { prisma } from "@/lib/db";
import { successResponse } from "@/lib/api-utils";
import { lmsCourseSchema } from "@/lib/validations";
import { guarded, readBody } from "@/lib/staff-lms/route";
import { createLogger } from "@/lib/logger";

const log = createLogger("staff-lms:courses");

/**
 * The course tree for the CONTENT EDITOR — courses, their levels, and a lesson count.
 *
 * Not the learner's view of the same data. The learner endpoint (`GET
 * /api/staff-lms/learning`) additionally computes unlock state per lesson and never returns
 * inactive rows; keeping them apart is what stopped the source app's single
 * type-discriminated handler from being guardable at all.
 */
export const GET = guarded("staff_lms_learning", "view", "staff-lms:courses", async () => {
  const courses = await prisma.lmsCourse.findMany({
    orderBy: { createdAt: "asc" },
    include: {
      levels: {
        orderBy: { sortOrder: "asc" },
        include: { _count: { select: { lessons: true } } },
      },
    },
  });
  return successResponse(courses);
});

export const POST = guarded(
  "staff_lms_learning",
  "create",
  "staff-lms:courses",
  async ({ req, user }) => {
    const data = lmsCourseSchema.parse(await readBody(req));
    const created = await prisma.lmsCourse.create({ data });
    log.info("course created", { courseId: created.id, by: user.id });
    return successResponse(created, 201);
  }
);
