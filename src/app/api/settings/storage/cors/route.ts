export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";
import { loadStorageSettings, buildProvider, S3Provider } from "@/lib/storage";

const log = createLogger("settings:storage:cors");

// Apply the bucket CORS policy that browser presigned uploads require.
//
// This exists as a button because the failure it prevents is close to undiagnosable from
// the browser: without the policy the preflight is rejected, and fetch reports a generic
// network error with status 0 that names neither CORS nor the bucket. People conclude the
// upload feature is broken.
//
// Needs s3:PutBucketCors on the IAM user. If that grant is missing this fails, and the UI
// falls back to showing the policy to paste into the AWS console by hand.
export async function POST(req: NextRequest) {
  try {
    const user = await requireFeature("settings_storage", "edit");

    const settings = await loadStorageSettings();
    if (!settings) return errorResponse("Save the storage settings first", 400);

    const store = buildProvider({ ...settings, provider: "S3" });
    if (!(store instanceof S3Provider)) {
      return errorResponse("CORS only applies to S3 buckets", 400);
    }

    // Every origin this application is served from, not just the one that happened to click
    // the button. The request's own Origin header is authoritative for "where the browser
    // is right now"; NEXTAUTH_URL covers the deployed app when the button is clicked from
    // localhost, and localhost covers development when it is clicked from production.
    // applyCors merges these with whatever the bucket already allows, so no environment
    // loses access by someone else pressing the button.
    const origins = [
      req.headers.get("origin"),
      process.env.NEXTAUTH_URL?.replace(/\/+$/, ""),
      "http://localhost:3000",
    ].filter((o): o is string => !!o);

    if (origins.length === 0) {
      return errorResponse(
        "Could not determine the app origin. Set NEXTAUTH_URL, or apply the policy by hand.",
        400
      );
    }

    const allowed = await store.applyCors(origins);
    log.info("bucket CORS applied", { userId: user.id, origins: allowed.length });

    return successResponse({
      applied: true,
      origins: allowed,
      note: `Uploads are allowed from ${allowed.length} origin(s): ${allowed.join(", ")}. Existing entries were kept.`,
    });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    const message = error instanceof Error ? error.message : "Could not apply the CORS policy";
    log.error("CORS apply failed", { error: message });
    // 400 not 500: the overwhelmingly likely cause is a missing s3:PutBucketCors grant,
    // which is the user's configuration rather than a server fault.
    return errorResponse(message, 400);
  }
}
