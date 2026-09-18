export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { z } from "zod";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireAuth, requireFeature, AuthError } from "@/lib/auth-helpers";
import { getApprovalRules, setApprovalRules } from "@/lib/settings/approval-rules";
import { createLogger } from "@/lib/logger";

const log = createLogger("approvals:rules");

/**
 * The approver-error rule (plan 1709-priority-build-and-stock-flow, R26, Q18).
 *
 * GET is `requireAuth` only: the rule is not a secret, the error-rate table behind
 * `reports.view` renders it as its own caption, and gating it would make that page ask for two
 * grants to show one sentence. PUT needs `settings.edit`, as R26 says.
 *
 * Kept under `/api/approvals/` rather than `/api/settings/` on purpose: it is the approvals
 * feature's own setting, it is read by the error-rate route beside it, and `src/app/api/settings`
 * is being edited by other parts of this build.
 */

const putSchema = z.object({
  countCorrection: z.boolean(),
  countShortReceive: z.boolean(),
  countReversal: z.boolean(),
  countFlag: z.boolean(),
  windowDays: z.number().int().min(1).max(365),
});

export async function GET() {
  try {
    await requireAuth();
    const rules = await getApprovalRules();
    return successResponse(rules);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    const message = error instanceof Error ? error.message : "Failed to read the approval rule";
    log.error("rules read failed", { message });
    return errorResponse(message, 500);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const user = await requireFeature("settings", "edit");
    const body = await req.json();
    // Validated here AND inside `setApprovalRules`, which is what the reader trusts.
    const parsed = putSchema.parse(body);
    const saved = await setApprovalRules(parsed);
    log.info("approval rule updated", { userId: user.id, windowDays: saved.windowDays });
    return successResponse(saved);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    if (error instanceof z.ZodError) {
      return errorResponse(error.issues[0]?.message ?? "Invalid approval rule", 400);
    }
    const message = error instanceof Error ? error.message : "Failed to save the approval rule";
    log.error("rules write failed", { message });
    return errorResponse(message, 400);
  }
}
