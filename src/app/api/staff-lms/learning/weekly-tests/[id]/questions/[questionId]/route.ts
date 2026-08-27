export const dynamic = "force-dynamic";

import { guarded } from "@/lib/staff-lms/route";
import { updateQuestion, deleteQuestion } from "@/lib/staff-lms/question-routes";

export const PUT = guarded("staff_lms_learning", "edit", "staff-lms:questions", (ctx) =>
  updateQuestion("weeklyTest", ctx)
);

export const DELETE = guarded("staff_lms_learning", "delete", "staff-lms:questions", (ctx) =>
  deleteQuestion("weeklyTest", ctx)
);
