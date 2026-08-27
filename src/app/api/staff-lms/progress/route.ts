export const dynamic = "force-dynamic";

import { prisma } from "@/lib/db";
import { successResponse } from "@/lib/api-utils";
import { lmsProgressSchema } from "@/lib/validations";
import { guarded, readBody } from "@/lib/staff-lms/route";
import { ensureProgress, awardXp } from "@/lib/staff-lms/progress";
import { LMS_XP } from "@/lib/staff-lms/constants";
import { createLogger } from "@/lib/logger";

const log = createLogger("staff-lms:progress");

/**
 * Marks a video watched, a playbook completed, or a product learned.
 *
 * THE SELF-PROGRESS CONTRACT — userId comes from the session, never the body.
 * lmsProgressSchema is .strict() and declares no userId. A forged userId in the
 * body returns 400.
 *
 * Idempotent for videos and scenarios: the id is appended to a String[] only if
 * it is not already there.
 */
export const POST = guarded("staff_lms", "view", "staff-lms:progress", async ({ req, user }) => {
  const body = lmsProgressSchema.parse(await readBody(req));
  const progress = await ensureProgress(user.id);

  if (body.videoId) {
    if (!progress.videosWatched.includes(body.videoId)) {
      await prisma.lmsProgress.update({
        where: { userId: user.id },
        data: { videosWatched: { push: body.videoId } },
      });
      await awardXp(user.id, LMS_XP.videoWatched, "video_watched", { videoId: body.videoId });
      log.info("video marked watched", { userId: user.id, videoId: body.videoId });
    }
    return successResponse({ videoId: body.videoId, recorded: true });
  }

  if (body.scenarioId) {
    if (!progress.scenariosCompleted.includes(body.scenarioId)) {
      await prisma.lmsProgress.update({
        where: { userId: user.id },
        data: { scenariosCompleted: { push: body.scenarioId } },
      });
      await awardXp(user.id, LMS_XP.playbookCompleted, "playbook_completed", {
        scenarioId: body.scenarioId,
      });
      log.info("playbook completed", { userId: user.id, scenarioId: body.scenarioId });
    }
    return successResponse({ scenarioId: body.scenarioId, recorded: true });
  }

  if (body.productId) {
    await awardXp(user.id, LMS_XP.productLearned, "product_learned", {
      productId: body.productId,
    });
    log.info("product learned", { userId: user.id, productId: body.productId });
    return successResponse({ productId: body.productId, recorded: true });
  }

  // lmsProgressSchema.refine guarantees at least one id — this is unreachable.
  return successResponse({ recorded: false });
});
