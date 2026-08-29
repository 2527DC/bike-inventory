export const dynamic = "force-dynamic";

import { prisma } from "@/lib/db";
import { successResponse } from "@/lib/api-utils";
import { lmsLessonSchema } from "@/lib/validations";
import { guarded, readBody } from "@/lib/staff-lms/route";
import { serializeLmsLesson } from "@/lib/staff-lms/serialize";
import { AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";

const log = createLogger("staff-lms:lessons");

/** Lessons for one level. `?levelId=` required, same reasoning as levels. */
export const GET = guarded("staff_lms_learning", "view", "staff-lms:lessons", async ({ req }) => {
  const levelId = new URL(req.url).searchParams.get("levelId");
  if (!levelId) throw new AuthError("levelId is required", 400);

  const lessons = await prisma.lmsLesson.findMany({
    where: { levelId },
    orderBy: { sortOrder: "asc" },
    include: { _count: { select: { questions: true } } },
  });

  return successResponse(
    lessons.map(({ _count, ...l }) => ({ ...serializeLmsLesson(l), questionCount: _count.questions }))
  );
});

export const POST = guarded(
  "staff_lms_learning",
  "create",
  "staff-lms:lessons",
  async ({ req, user }) => {
    const data = lmsLessonSchema.parse(await readBody(req));
    if ((await prisma.lmsCourseLevel.count({ where: { id: data.levelId } })) === 0) {
      throw new AuthError("Level not found", 404);
    }
    const created = await prisma.lmsLesson.create({ data });
    log.info("lesson created", { lessonId: created.id, levelId: data.levelId, by: user.id });
    return successResponse(serializeLmsLesson(created), 201);
  }
);
