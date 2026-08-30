// Footfall dashboard data. HUMAN endpoint — NextAuth session plus the `analytics.view` grant.
//
// findings-2026-08-01 C1: in the pilot this was a bare GET with no auth at all, so anyone
// holding the URL could read BCH's footfall, bill count and conversion. It is gated now, and
// unlike the ingest routes it stays INSIDE the middleware matcher as well.

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { resolveStoreParam } from "@/lib/stores";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { dashboard, resolveDefaultStore } from "@/lib/analytics/store";
import { businessDate, isBusinessDate } from "@/lib/analytics/time";
import { createLogger } from "@/lib/logger";

const log = createLogger("analytics:dashboard");

// Stores are rows now, so a valid ?store= is whatever the database says it is, resolved by
// CODE or id. The old check was Object.values(StockLocation) — a compile-time list that
// could not know about a store an admin created this morning.

export async function GET(req: NextRequest) {
  try {
    await requireFeature("analytics", "view");

    const { searchParams } = new URL(req.url);

    const storeParam = searchParams.get("store");
    let storeId: string | null;

    if (storeParam) {
      const store = await resolveStoreParam(storeParam);
      if (!store) {
        return errorResponse(`unknown store "${storeParam}"`, 400);
      }
      storeId = store.id;
    } else {
      // No hardcoded default — see resolveDefaultStore(). Showing one store's numbers under
      // another store's name is worse than asking the caller to be explicit.
      storeId = await resolveDefaultStore();
      if (!storeId) {
        return errorResponse(
          "specify ?store= — no single counting store could be resolved (none registered, or more than one)",
          400
        );
      }
    }

    const dateParam = searchParams.get("date") ?? businessDate();
    if (!isBusinessDate(dateParam)) {
      return errorResponse("date must be YYYY-MM-DD", 400);
    }

    return successResponse(await dashboard({ storeId, date: dateParam }));
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    log.error("dashboard query failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse(
      error instanceof Error ? error.message : "dashboard unavailable",
      500
    );
  }
}
