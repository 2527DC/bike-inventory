export const dynamic = "force-dynamic";

import { prisma } from "@/lib/db";
import { successResponse } from "@/lib/api-utils";
import { lmsVideoCategorySchema } from "@/lib/validations";
import { guarded, readBody } from "@/lib/staff-lms/route";
import { AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";

const log = createLogger("staff-lms:video-categories");

export const GET = guarded("staff_lms_learning", "view", "staff-lms:video-categories", async () => {
  const categories = await prisma.lmsVideoCategory.findMany({
    orderBy: { sortOrder: "asc" },
    include: { _count: { select: { videos: true } } },
  });
  return successResponse(categories);
});

export const POST = guarded(
  "staff_lms_learning",
  "create",
  "staff-lms:video-categories",
  async ({ req, user }) => {
    const data = lmsVideoCategorySchema.parse(await readBody(req));
    const created = await prisma.lmsVideoCategory.create({ data });
    log.info("video category created", { categoryId: created.id, by: user.id });
    return successResponse(created, 201);
  }
);

/**
 * Categories have no `isActive` column, so this is a real delete.
 *
 * Safe to do so: `LmsVideo.categoryId` is `onDelete: SetNull`, so the videos survive and
 * simply become uncategorised. Nothing a learner earned is attached to a category.
 *
 * `?id=` rather than a `[id]` sub-route — this resource has no detail view worth a folder,
 * and an editor row deletes in place.
 */
export const DELETE = guarded(
  "staff_lms_learning",
  "delete",
  "staff-lms:video-categories",
  async ({ req, user }) => {
    const id = new URL(req.url).searchParams.get("id");
    if (!id) throw new AuthError("id is required", 400);
    if ((await prisma.lmsVideoCategory.count({ where: { id } })) === 0) {
      throw new AuthError("Category not found", 404);
    }
    await prisma.lmsVideoCategory.delete({ where: { id } });
    log.info("video category deleted", { categoryId: id, by: user.id });
    return successResponse({ id });
  }
);

export const PUT = guarded(
  "staff_lms_learning",
  "edit",
  "staff-lms:video-categories",
  async ({ req, user }) => {
    const id = new URL(req.url).searchParams.get("id");
    if (!id) throw new AuthError("id is required", 400);
    const data = lmsVideoCategorySchema.partial().parse(await readBody(req));
    if ((await prisma.lmsVideoCategory.count({ where: { id } })) === 0) {
      throw new AuthError("Category not found", 404);
    }
    const updated = await prisma.lmsVideoCategory.update({ where: { id }, data });
    log.info("video category updated", { categoryId: id, by: user.id });
    return successResponse(updated);
  }
);
