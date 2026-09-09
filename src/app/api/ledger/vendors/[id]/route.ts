export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { successResponse, errorResponse, failure } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { userCan } from "@/lib/rbac";
import { createLogger } from "@/lib/logger";
import { buildLedgerView } from "@/lib/brand-ledger/view";

const log = createLogger("ledger:view");

// GET — one vendor's ledger, in the shape the ledger screen reads (LedgerBrandView).
//
// The screen is a verbatim port of the ledger app's BrandPage, so the payload is the app's
// own `brand` object: profile header, entries with their audit verdicts, and the claim
// register with notes and evidence. Nothing here writes.
//
// Claims are gated separately: `brand_ledger.view` opens the ledger, `brand_ledger_gaps.view`
// opens the register. Without the second the view carries `gaps: []` and `canSeeGaps: false`
// so the Gaps tab simply does not render — the API decides, the client only hides.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireFeature("brand_ledger", "view");
    const { id } = await params;

    const canSeeGaps = await userCan(user.id, "brand_ledger_gaps", "view");
    const view = await buildLedgerView(id, { canSeeGaps });
    if (!view) return errorResponse("Vendor not found", 404);

    log.debug("<- ledger view", { vendorId: id, entries: view.entries.length, gaps: view.gaps.length });
    return successResponse(view);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return failure(error, { scope: "ledger:view" });
  }
}
