export const dynamic = "force-dynamic";

import { guarded } from "@/lib/staff-lms/route";
import { listQuestions, createQuestion } from "@/lib/staff-lms/question-routes";

// Both handlers are gated on `edit`, not `view` — these rows carry `correctIndex`.
// The learner never reads questions from here; see src/lib/staff-lms/question-routes.ts.
export const GET = guarded("staff_lms_learning", "edit", "staff-lms:questions", (ctx) =>
  listQuestions("quiz", ctx)
);

export const POST = guarded("staff_lms_learning", "create", "staff-lms:questions", (ctx) =>
  createQuestion("quiz", ctx)
);
