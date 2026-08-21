// Footfall dashboard data. HUMAN endpoint — NextAuth session plus the `analytics.view` grant.
//
// findings-2026-08-01 C1: in the pilot this was a bare GET with no auth at all, so anyone
// holding the URL could read BCH's footfall, bill count and conversion. It is gated now, and
// unlike the ingest routes it stays INSIDE the middleware matcher as well.

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { StockLocation } from "@prisma/client";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { dashboard, resolveDefaultStore } from "@/lib/analytics/store";
import { businessDate, isBusinessDate } from "@/lib/analytics/time";

const STORE_VALUES = Object.values(StockLocation);

function isStoreLocation(value: string): value is StockLocation {
  return (STORE_VALUES as string[]).includes(value);
}

export async function GET(req: NextRequest) {
  try {
    await requireFeature("analytics", "view");

    const { searchParams } = new URL(req.url);

    const storeParam = searchParams.get("store");
    let storeId: StockLocation | null;

    if (storeParam) {
      if (!isStoreLocation(storeParam)) {
        return errorResponse(`unknown store "${storeParam}"`, 400);
      }
      storeId = storeParam;
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
    console.error("analytics dashboard query failed", error);
    return errorResponse(
      error instanceof Error ? error.message : "dashboard unavailable",
      500
    );
  }
}
