export const dynamic = "force-dynamic";

import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";

export async function GET() {
  try {
    await requireFeature("dashboard", "view");
    return successResponse({
      note: "Tasks, SOPs, and checklists have been moved to the Ops Hub app.",
      tasks: { total: 0, pending: 0, inProgress: 0, blocked: 0, doneThisWeek: 0 },
      sops: { total: 0, compliance: 0, violations: 0 },
    });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed", 500);
  }
}
