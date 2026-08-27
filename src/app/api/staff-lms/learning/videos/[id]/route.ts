export const dynamic = "force-dynamic";

import { prisma } from "@/lib/db";
import { successResponse } from "@/lib/api-utils";
import { lmsVideoUpdateSchema } from "@/lib/validations";
import { guarded, readBody, requireParam } from "@/lib/staff-lms/route";
import { AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";

const log = createLogger("staff-lms:videos");

export const PUT = guarded(
  "staff_lms_learning",
  "edit",
  "staff-lms:videos",
  async ({ req, params, user }) => {
    const id = requireParam(params, "id");
    const data = lmsVideoUpdateSchema.parse(await readBody(req));
    if ((await prisma.lmsVideo.count({ where: { id } })) === 0) {
      throw new AuthError("Video not found", 404);
    }
    const updated = await prisma.lmsVideo.update({ where: { id }, data });
    log.info("video updated", { videoId: id, by: user.id });
    return successResponse(updated);
  }
);

/**
 * Soft delete. A hard delete would strand this id inside every learner's
 * `lms_progress.videosWatched` array — a String[] with no foreign key, so nothing would
 * clean it up and the watched count would keep including a video that no longer exists.
 */
export const DELETE = guarded(
  "staff_lms_learning",
  "delete",
  "staff-lms:videos",
  async ({ params, user }) => {
    const id = requireParam(params, "id");
    if ((await prisma.lmsVideo.count({ where: { id } })) === 0) {
      throw new AuthError("Video not found", 404);
    }
    await prisma.lmsVideo.update({ where: { id }, data: { isActive: false } });
    log.info("video deactivated", { videoId: id, by: user.id });
    return successResponse({ id, isActive: false });
  }
);
