export const dynamic = "force-dynamic";

import { prisma } from "@/lib/db";
import { successResponse } from "@/lib/api-utils";
import { lmsCourseLevelUpdateSchema } from "@/lib/validations";
import { guarded, readBody, requireParam } from "@/lib/staff-lms/route";
import { AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";

const log = createLogger("staff-lms:levels");

export const PUT = guarded(
  "staff_lms_learning",
  "edit",
  "staff-lms:levels",
  async ({ req, params, user }) => {
    const id = requireParam(params, "id");
    const data = lmsCourseLevelUpdateSchema.parse(await readBody(req));
    if ((await prisma.lmsCourseLevel.count({ where: { id } })) === 0) {
      throw new AuthError("Level not found", 404);
    }
    const updated = await prisma.lmsCourseLevel.update({ where: { id }, data });
    log.info("level updated", { levelId: id, by: user.id });
    return successResponse(updated);
  }
);

/**
 * HARD delete — the one place in the content API that really removes a row.
 *
 * `LmsCourseLevel` has no `isActive` column, so there is nothing to soft-delete to. That is
 * fine because a level is a grouping, not a thing a learner has progress against; the
 * refusal below is what protects the progress underneath it.
 *
 * Deleting a level cascades to its lessons and to every `lms_lesson_progress` row beneath
 * them, so a level holding lessons is REFUSED rather than cascaded. Move or delete the
 * lessons first — an explicit two-step beats an irreversible one-click.
 */
export const DELETE = guarded(
  "staff_lms_learning",
  "delete",
  "staff-lms:levels",
  async ({ params, user }) => {
    const id = requireParam(params, "id");

    const level = await prisma.lmsCourseLevel.findUnique({
      where: { id },
      include: { _count: { select: { lessons: true } } },
    });
    if (!level) throw new AuthError("Level not found", 404);

    if (level._count.lessons > 0) {
      throw new AuthError(
        `This level still holds ${level._count.lessons} lesson(s). Move or delete them first — ` +
          `deleting the level would also delete every learner's progress on those lessons.`,
        409
      );
    }

    await prisma.lmsCourseLevel.delete({ where: { id } });
    log.info("level deleted", { levelId: id, by: user.id });
    return successResponse({ id });
  }
);
