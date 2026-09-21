export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { z } from "zod";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireAuth, requireFeature, AuthError } from "@/lib/auth-helpers";
import { getStuckHours, setStuckHours, stuckHoursSchema } from "@/lib/settings/stuck-hours";
import { createLogger } from "@/lib/logger";

const log = createLogger("settings:stuck-hours");

/**
 * When the dashboard calls something "stuck" (plan 1709-priority-build-and-stock-flow, R35–R37,
 * Q30): approvals waiting > `approvals` h, inbound not received > `inbound` h, builds on hold >
 * `holds` h. A short outward is stuck from the moment it is scheduled and has no threshold.
 *
 * ─── WHY NOT `api/approvals/rules` ────────────────────────────────────────────────────────
 *
 * The editor sits on the same screen, so extending that route was the obvious move — and it
 * would have been wrong. `PUT /api/approvals/rules` takes the WHOLE rule object, so folding
 * three unrelated hour values into it means every change to a dashboard threshold rewrites the
 * approver-error rule and vice versa, and a stale form on one half silently reverts the other.
 * They are also different settings with different readers: the rule is read by
 * `api/approvals/error-rate`, these hours by `api/dashboard/overview`. So it lives beside
 * `api/settings/bin-tracking` (removed in plan 2109, Q27), which had this exact shape.
 *
 * GET is `requireAuth`: the dashboard's own card labels print the numbers ("Approvals waiting >
 * 24 h") for everyone, so the values are not a secret and gating them would make the settings
 * form ask for a grant it does not need to READ. PUT needs `settings.edit`, as Q30 says.
 */
export async function GET() {
  try {
    await requireAuth();
    const hours = await getStuckHours();
    return successResponse(hours);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    const message = error instanceof Error ? error.message : "Failed to read the stuck hours";
    log.error("stuck hours read failed", { message });
    return errorResponse(message, 500);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const user = await requireFeature("settings", "edit");
    const body = await req.json();
    // Validated here AND inside `setStuckHours`, which is what every reader trusts.
    const parsed = stuckHoursSchema.parse(body);
    const saved = await setStuckHours(parsed);
    log.info("stuck hours updated", { userId: user.id, ...saved });
    return successResponse(saved);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    if (error instanceof z.ZodError) {
      return errorResponse(error.issues[0]?.message ?? "Invalid stuck hours", 400);
    }
    const message = error instanceof Error ? error.message : "Failed to save the stuck hours";
    log.error("stuck hours write failed", { message });
    return errorResponse(message, 400);
  }
}
