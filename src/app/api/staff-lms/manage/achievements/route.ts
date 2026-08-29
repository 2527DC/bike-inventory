export const dynamic = "force-dynamic";

import { prisma } from "@/lib/db";
import { successResponse } from "@/lib/api-utils";
import { lmsAchievementSchema, lmsAchievementUpdateSchema } from "@/lib/validations";
import { guarded, readBody } from "@/lib/staff-lms/route";
import { AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";

const log = createLogger("staff-lms:achievements");

/**
 * Achievement definitions, with how many people hold each.
 *
 * `criteriaType` is a Zod enum on write (see lmsAchievementSchema), so a badge whose
 * criteria the award engine cannot evaluate is rejected at the boundary rather than sitting
 * in the list forever as something nobody can earn. `checkAchievements` also warns if it
 * meets one at runtime — belt and braces, because a seed script can bypass this route.
 */
export const GET = guarded("staff_lms", "view", "staff-lms:achievements", async () => {
  const rows = await prisma.lmsAchievement.findMany({
    orderBy: [{ criteriaType: "asc" }, { criteriaValue: "asc" }],
    include: { _count: { select: { userAchievements: true } } },
  });
  return successResponse(rows);
});

export const POST = guarded("staff_lms", "create", "staff-lms:achievements", async ({ req, user }) => {
  const data = lmsAchievementSchema.parse(await readBody(req));
  const created = await prisma.lmsAchievement.create({ data });
  log.info("achievement created", { achievementId: created.id, by: user.id });
  return successResponse(created, 201);
});

export const PUT = guarded("staff_lms", "edit", "staff-lms:achievements", async ({ req, user }) => {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) throw new AuthError("id is required", 400);
  const data = lmsAchievementUpdateSchema.parse(await readBody(req));
  if ((await prisma.lmsAchievement.count({ where: { id } })) === 0) {
    throw new AuthError("Achievement not found", 404);
  }
  const updated = await prisma.lmsAchievement.update({ where: { id }, data });
  log.info("achievement updated", { achievementId: id, by: user.id });
  return successResponse(updated);
});

/**
 * Refused once anyone holds it.
 *
 * `LmsUserAchievement.achievementId` cascades, so deleting a badge would erase it from
 * every profile that earned it — silently, and with no way back. Someone earning a badge is
 * a fact about the past; retiring a badge is a different operation, and there is no column
 * for it yet. Refusing is the honest answer until there is.
 */
export const DELETE = guarded("staff_lms", "delete", "staff-lms:achievements", async ({ req, user }) => {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) throw new AuthError("id is required", 400);

  const achievement = await prisma.lmsAchievement.findUnique({
    where: { id },
    include: { _count: { select: { userAchievements: true } } },
  });
  if (!achievement) throw new AuthError("Achievement not found", 404);

  if (achievement._count.userAchievements > 0) {
    throw new AuthError(
      `${achievement._count.userAchievements} learner(s) have earned this achievement. ` +
        `Deleting it would remove it from their profiles.`,
      409
    );
  }

  await prisma.lmsAchievement.delete({ where: { id } });
  log.info("achievement deleted", { achievementId: id, by: user.id });
  return successResponse({ id });
});
