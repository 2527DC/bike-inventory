export const dynamic = "force-dynamic";

import { prisma } from "@/lib/db";
import { successResponse } from "@/lib/api-utils";
import { lmsQuizSchema } from "@/lib/validations";
import { guarded, readBody } from "@/lib/staff-lms/route";
import { createLogger } from "@/lib/logger";

const log = createLogger("staff-lms:quizzes");

/**
 * Quiz list. Safe on `view` because it returns no questions — only titles, difficulty and
 * counts. The moment a handler here includes `questions`, its guard must become `edit`.
 */
export const GET = guarded("staff_lms_learning", "view", "staff-lms:quizzes", async ({ req }) => {
  const includeInactive = new URL(req.url).searchParams.get("includeInactive") === "true";
  const quizzes = await prisma.lmsQuiz.findMany({
    where: includeInactive ? {} : { isActive: true },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { questions: true } } },
  });
  return successResponse(quizzes);
});

export const POST = guarded(
  "staff_lms_learning",
  "create",
  "staff-lms:quizzes",
  async ({ req, user }) => {
    const data = lmsQuizSchema.parse(await readBody(req));
    const created = await prisma.lmsQuiz.create({ data });
    log.info("quiz created", { quizId: created.id, by: user.id });
    return successResponse(created, 201);
  }
);
