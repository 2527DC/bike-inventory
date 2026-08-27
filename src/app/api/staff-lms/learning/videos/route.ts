export const dynamic = "force-dynamic";

import { prisma } from "@/lib/db";
import { successResponse } from "@/lib/api-utils";
import { lmsVideoSchema } from "@/lib/validations";
import { guarded, readBody } from "@/lib/staff-lms/route";
import { createLogger } from "@/lib/logger";

const log = createLogger("staff-lms:videos");

/**
 * The training video library, grouped by category on the client.
 *
 * Worth knowing while working on this: in the source app the videos SCREEN had no inbound
 * link from anywhere, so "Mark as watched" — which writes `lms_progress.videosWatched` —
 * was unreachable. That column feeds a stat tile on two screens and the `videos_watched`
 * achievement, so all three could only ever read zero. Phase 8 puts the screen in the
 * dashboard's Continue Learning list.
 */
export const GET = guarded("staff_lms_learning", "view", "staff-lms:videos", async ({ req }) => {
  const url = new URL(req.url);
  const categoryId = url.searchParams.get("categoryId");
  const includeInactive = url.searchParams.get("includeInactive") === "true";

  const videos = await prisma.lmsVideo.findMany({
    where: {
      ...(includeInactive ? {} : { isActive: true }),
      ...(categoryId ? { categoryId } : {}),
    },
    orderBy: [{ sortOrder: "asc" }, { title: "asc" }],
    include: {
      category: { select: { id: true, name: true } },
      lmsProduct: { select: { id: true, name: true } },
    },
  });
  return successResponse(videos);
});

export const POST = guarded(
  "staff_lms_learning",
  "create",
  "staff-lms:videos",
  async ({ req, user }) => {
    const data = lmsVideoSchema.parse(await readBody(req));
    const created = await prisma.lmsVideo.create({ data });
    log.info("video created", { videoId: created.id, by: user.id });
    return successResponse(created, 201);
  }
);
