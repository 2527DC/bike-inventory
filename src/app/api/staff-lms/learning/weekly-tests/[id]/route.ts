export const dynamic = "force-dynamic";

import { prisma } from "@/lib/db";
import { successResponse } from "@/lib/api-utils";
import { lmsWeeklyTestUpdateSchema } from "@/lib/validations";
import { guarded, readBody, requireParam } from "@/lib/staff-lms/route";
import { AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";

const log = createLogger("staff-lms:weekly-tests");

/** Editor view — questions with answer keys. `edit`, never `view`. */
export const GET = guarded(
  "staff_lms_learning",
  "edit",
  "staff-lms:weekly-tests",
  async ({ params }) => {
    const id = requireParam(params, "id");
    const test = await prisma.lmsWeeklyTest.findUnique({
      where: { id },
      include: { questions: { orderBy: { sortOrder: "asc" } } },
    });
    if (!test) throw new AuthError("Weekly test not found", 404);
    return successResponse(test);
  }
);

export const PUT = guarded(
  "staff_lms_learning",
  "edit",
  "staff-lms:weekly-tests",
  async ({ req, params, user }) => {
    const id = requireParam(params, "id");
    const data = lmsWeeklyTestUpdateSchema.parse(await readBody(req));
    if ((await prisma.lmsWeeklyTest.count({ where: { id } })) === 0) {
      throw new AuthError("Weekly test not found", 404);
    }
    const updated = await prisma.lmsWeeklyTest.update({ where: { id }, data });
    log.info("weekly test updated", { testId: id, by: user.id });
    return successResponse(updated);
  }
);

/** Soft delete — attempts are learner history. */
export const DELETE = guarded(
  "staff_lms_learning",
  "delete",
  "staff-lms:weekly-tests",
  async ({ params, user }) => {
    const id = requireParam(params, "id");
    if ((await prisma.lmsWeeklyTest.count({ where: { id } })) === 0) {
      throw new AuthError("Weekly test not found", 404);
    }
    await prisma.lmsWeeklyTest.update({ where: { id }, data: { isActive: false } });
    log.info("weekly test deactivated", { testId: id, by: user.id });
    return successResponse({ id, isActive: false });
  }
);
