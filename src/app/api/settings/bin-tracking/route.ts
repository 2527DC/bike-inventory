export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { isBinTrackingEnabled, setBinTrackingEnabled } from "@/lib/settings/bin-tracking";

// GET: Check current bin tracking status
export async function GET() {
  try {
    const enabled = await isBinTrackingEnabled();
    return successResponse({ enabled });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to get bin tracking status", 500);
  }
}

// PUT: Toggle bin tracking ON or OFF (requires bins.edit permission)
export async function PUT(req: NextRequest) {
  try {
    await requireFeature("bins", "edit");
    const body = await req.json();
    const { enabled } = body as { enabled?: boolean };

    if (typeof enabled !== "boolean") {
      return errorResponse("enabled (boolean) is required", 400);
    }

    const updated = await setBinTrackingEnabled(enabled);
    return successResponse({ enabled: updated });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to update bin tracking setting", 400);
  }
}
