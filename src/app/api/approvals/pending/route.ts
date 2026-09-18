export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireAuth, AuthError } from "@/lib/auth-helpers";
import { listPendingApprovals } from "@/lib/approvals/pending";
import { createLogger } from "@/lib/logger";

const log = createLogger("approvals:pending");

/**
 * GET: everything waiting for an approval THIS person can give
 * (plan 1709-priority-build-and-stock-flow, P17, R24).
 *
 * `requireAuth` only — the four sections gate themselves on their own module's `approve` grant
 * inside `listPendingApprovals`, so somebody who approves nothing gets an empty list rather than
 * a 403. The header badge links here for everybody, and a permission error would read as a fault.
 *
 * The query itself lives in `src/lib/approvals/pending.ts` because three readers need exactly the
 * same rows: this page, the header/sidebar badge (`?count=1`) and the dashboard's "Approvals
 * waiting" card. A second copy would drift.
 *
 * `?count=1` returns the total alone, for that badge.
 */
export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth();
    const countOnly = new URL(req.url).searchParams.get("count") === "1";

    const pending = await listPendingApprovals(user.id);

    if (countOnly) {
      log.debug("pending approvals counted", { userId: user.id, total: pending.total });
      return successResponse({ total: pending.total });
    }

    log.debug("pending approvals served", { userId: user.id, total: pending.total });
    return successResponse(pending);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    const message = error instanceof Error ? error.message : "Failed to load pending approvals";
    log.error("pending approvals failed", { message });
    return errorResponse(message, 500);
  }
}
