export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextRequest } from "next/server";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireAuth, AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";
import { getStorage, StorageNotConfiguredError } from "@/lib/storage";
import { buildKey, checkUpload } from "@/lib/storage/upload-policy";

const log = createLogger("media:upload");

// Server-side upload. Two callers:
//   1. providers that cannot issue a presigned URL (the local filesystem) — the browser is
//      told to post here by /api/media/presign, and sends the key it was going to use;
//   2. older callers that just post a file and let the server pick the key.
//
// The file passes through the serverless function here, so the size cap genuinely matters
// on this path in a way it does not for a presigned PUT straight to the bucket.
export async function POST(req: NextRequest) {
  try {
    await requireAuth();

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) return errorResponse("No file provided", 400);

    // A caller may name the key (path 1). Otherwise keep the historical default so existing
    // callers that post a bare file keep working unchanged.
    const requested = formData.get("key");
    const key =
      typeof requested === "string" && requested
        ? requested
        : buildKey("vendor-issues", file.name || "upload.jpg");

    const contentType = file.type || "application/octet-stream";
    const check = checkUpload(key, contentType, file.size);
    if (!check.ok) return errorResponse(check.error!, 400);

    const storage = await getStorage();
    log.debug("-> put via API", { key, provider: storage.key, bytes: file.size });

    const url = await storage.put(key, Buffer.from(await file.arrayBuffer()), contentType);

    log.info("upload stored", { key, provider: storage.key });
    return successResponse({ url }, 201);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    if (error instanceof StorageNotConfiguredError) {
      log.warn("upload attempted with no storage configured");
      return errorResponse(error.message, 501);
    }
    log.error("upload failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse(error instanceof Error ? error.message : "Upload failed", 500);
  }
}
