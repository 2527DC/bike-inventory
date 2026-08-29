export const dynamic = "force-dynamic";

import { prisma } from "@/lib/db";
import { successResponse } from "@/lib/api-utils";
import { lmsAnnouncementSchema, lmsAnnouncementUpdateSchema } from "@/lib/validations";
import { guarded, readBody } from "@/lib/staff-lms/route";
import { AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";

const log = createLogger("staff-lms:announcements");

/**
 * Announcements, newest first, INCLUDING expired ones — this is the editor's list and an
 * expired announcement is still something you want to see, copy or reactivate.
 *
 * The learner's dashboard filters to `isActive AND (expiresAt IS NULL OR expiresAt > now)`.
 * Those are two different questions and they get two different endpoints, which is what
 * stops a "just add a flag" query param from quietly becoming the guard.
 */
export const GET = guarded("staff_lms", "view", "staff-lms:announcements", async () => {
  const rows = await prisma.lmsAnnouncement.findMany({ orderBy: { createdAt: "desc" } });
  return successResponse(rows);
});

export const POST = guarded("staff_lms", "create", "staff-lms:announcements", async ({ req, user }) => {
  const data = lmsAnnouncementSchema.parse(await readBody(req));
  const created = await prisma.lmsAnnouncement.create({ data });
  log.info("announcement created", { announcementId: created.id, by: user.id });
  return successResponse(created, 201);
});

export const PUT = guarded("staff_lms", "edit", "staff-lms:announcements", async ({ req, user }) => {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) throw new AuthError("id is required", 400);
  const data = lmsAnnouncementUpdateSchema.parse(await readBody(req));
  if ((await prisma.lmsAnnouncement.count({ where: { id } })) === 0) {
    throw new AuthError("Announcement not found", 404);
  }
  const updated = await prisma.lmsAnnouncement.update({ where: { id }, data });
  log.info("announcement updated", { announcementId: id, by: user.id });
  return successResponse(updated);
});

/** Hard delete — nothing references an announcement, and expiry already handles the soft case. */
export const DELETE = guarded("staff_lms", "delete", "staff-lms:announcements", async ({ req, user }) => {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) throw new AuthError("id is required", 400);
  if ((await prisma.lmsAnnouncement.count({ where: { id } })) === 0) {
    throw new AuthError("Announcement not found", 404);
  }
  await prisma.lmsAnnouncement.delete({ where: { id } });
  log.info("announcement deleted", { announcementId: id, by: user.id });
  return successResponse({ id });
});
