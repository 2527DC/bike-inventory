export const dynamic = "force-dynamic";

import { prisma } from "@/lib/db";
import { successResponse } from "@/lib/api-utils";
import { lmsWeeklyTestSchema } from "@/lib/validations";
import { guarded, readBody } from "@/lib/staff-lms/route";
import { createLogger } from "@/lib/logger";

const log = createLogger("staff-lms:weekly-tests");

/**
 * Weekly test list, newest week first. No questions in the payload, so `view` is safe.
 *
 * The source app's equivalent returned the answer key whenever `user.role === 'admin'` —
 * a role-name comparison that would not compile here, and a leak in any case. The key now
 * lives behind `edit` on the detail route and nowhere else.
 */
export const GET = guarded(
  "staff_lms_learning",
  "view",
  "staff-lms:weekly-tests",
  async ({ req }) => {
    const includeInactive = new URL(req.url).searchParams.get("includeInactive") === "true";
    const tests = await prisma.lmsWeeklyTest.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: { weekNumber: "desc" },
      include: { _count: { select: { questions: true } } },
    });
    return successResponse(tests);
  }
);

export const POST = guarded(
  "staff_lms_learning",
  "create",
  "staff-lms:weekly-tests",
  async ({ req, user }) => {
    const data = lmsWeeklyTestSchema.parse(await readBody(req));
    const created = await prisma.lmsWeeklyTest.create({ data });
    log.info("weekly test created", { testId: created.id, week: data.weekNumber, by: user.id });
    return successResponse(created, 201);
  }
);
